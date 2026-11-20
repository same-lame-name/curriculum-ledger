/**
 * Phase 1 Seam 3 tests (`createExternalJob`, `deliverExternalJobResult`, `createTeachingSession`):
 *  - External job creation, idempotency, unknown-chat & cross-plugin guards, disable guard
 *  - Idle wake delivery & failed result delivery
 *  - Live-chat steering delivery without idle wake
 *  - Learner abort preservation + cross-plugin delivery guard
 *  - Restart recovery behavior (`recoverPluginBackgroundJob`) for external jobs
 *  - `createTeachingSession` strong-slot stamping, graph-context attachment, and URL output
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { SteerMessage } from "../src/core/contracts/jobs.ts";
import type { TurnInput } from "../src/core/input-events.ts";
import type { PluginAgentService } from "../src/core/plugin-agents.ts";
import type { PluginBackendContext, PluginInference, PluginLearningData } from "../src/core/plugins.ts";
import type { PluginWorkerService } from "../src/core/plugin-workers.ts";
import { CURRENT_SETTINGS_VERSION } from "../src/core/settings.ts";

// Isolate disk stores before config-dependent imports resolve PATHS.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plugin-external-job-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { stores } = await import("../src/server/stores.ts");
const {
	abortJob,
	deliverJobResult,
	noteSteersDurable,
	registerLiveAgent,
	setTurnRunner: setRawTurnRunner,
	settleSteers,
	unregisterLiveAgent,
} = await import("../src/server/jobs.ts");
const { beginTurn, endTurn } = await import("../src/server/turn-liveness.ts");
const { recoverPluginBackgroundJob } = await import("../src/server/plugin-background-tools.ts");
const { createPluginExternalJob, createPluginTeachingSession, deliverPluginExternalJobResult } = await import(
	"../src/server/plugin-external-jobs.ts"
);
const { createPluginHost } = await import("../src/server/plugin-host.ts");

function waitFor(cond: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`Timeout waiting for ${what}`));
			setTimeout(tick, 15);
		};
		tick();
	});
}

async function flush() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

function makeTestHost() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ext-plugin-host-"));
	const pluginsDir = path.join(root, "plugins");
	fs.mkdirSync(pluginsDir, { recursive: true });
	for (const id of ["plugin-a", "plugin-b"]) {
		const dist = path.join(pluginsDir, id, "dist");
		fs.mkdirSync(dist, { recursive: true });
		fs.writeFileSync(
			path.join(dist, "manifest.json"),
			JSON.stringify({ apiVersion: 1, id, name: id, version: "1.0.0", minAppVersion: "0.3.0", backend: "backend.cjs" }),
		);
		fs.writeFileSync(path.join(dist, "backend.cjs"), "exports.activate = ctx => { ctx.handle('ctx', () => ctx); };");
	}
	const host = createPluginHost({
		directory: pluginsDir,
		appVersion: "0.6.1",
		createServices({ manifest, signal }) {
			return {
				learning: {} as PluginLearningData,
				inference: {} as PluginInference,
				agents: { dispose: async () => {} } as PluginAgentService,
				workers: { dispose: async () => {} } as PluginWorkerService,
				createBackgroundTool() {
					throw new Error("unused");
				},
				createExternalJob(init) {
					return createPluginExternalJob(
						{
							pluginId: manifest.id,
							chatStore: stores.chatStore,
							jobStore: stores.jobStore,
							deliver: deliverJobResult,
							isActive: () => !signal.aborted,
						},
						init,
					);
				},
				deliverExternalJobResult(jobId, result) {
					return deliverPluginExternalJobResult(
						{
							pluginId: manifest.id,
							chatStore: stores.chatStore,
							jobStore: stores.jobStore,
							deliver: deliverJobResult,
							isActive: () => !signal.aborted,
						},
						jobId,
						result,
					);
				},
				createTeachingSession(init) {
					return createPluginTeachingSession(
						{
							chatStore: stores.chatStore,
							graphStore: stores.graphStore,
							readSettings,
							isActive: () => !signal.aborted,
						},
						init,
					);
				},
			};
		},
	});
	return {
		host,
		cleanup: async () => {
			await host.dispose();
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("Plugin external async jobs & teaching escalation", () => {
	it("createExternalJob creates external plugin job, deduplicates, and enforces guards", async () => {
		const { host, cleanup } = makeTestHost();
		try {
			await host.initialize();
			await host.setEnabled("plugin-a", true);
			await host.setEnabled("plugin-b", true);
			const ctxA = (await host.call("plugin-a", "ctx")) as PluginBackendContext;
			const ctxB = (await host.call("plugin-b", "ctx")) as PluginBackendContext;

			const chat = chatStore.createChat("Arena External Job", "arena");
			const handle = ctxA.createExternalJob({
				chatId: chat.id,
				toolCallId: "tc-ext-1",
				toolName: "problem_grader",
				input: { problemId: "cf-1900d" },
				label: "Grade submission",
				activity: "judging",
			});
			assert.equal(handle.chatId, chat.id);
			assert.equal(handle.toolCallId, "tc-ext-1");
			assert.deepEqual(handle.ackDetails, { jobId: handle.jobId, dispatched: true });

			const stored = stores.jobStore.getJob(handle.jobId);
			assert.ok(stored);
			assert.equal(stored.kind, "plugin");
			assert.equal(stored.status, "running");
			assert.equal(stored.activity, "judging");
			assert.equal(stored.plugin?.pluginId, "plugin-a");
			assert.equal(stored.plugin?.external, true);
			assert.equal(stored.plugin?.workerId, "external");

			const deduped = ctxA.createExternalJob({
				chatId: chat.id,
				toolCallId: "tc-ext-1",
				toolName: "problem_grader",
			});
			assert.equal(deduped.jobId, handle.jobId);
			assert.equal(stores.jobStore.listJobs(chat.id).length, 1);

			assert.throws(
				() => ctxA.createExternalJob({ chatId: "chat_missing", toolCallId: "tc-2", toolName: "problem_grader" }),
				/Chat not found/,
			);
			assert.throws(
				() => ctxB.createExternalJob({ chatId: chat.id, toolCallId: "tc-ext-1", toolName: "problem_grader" }),
				/different job/,
			);

			await host.setEnabled("plugin-b", false);
			assert.throws(
				() => ctxB.createExternalJob({ chatId: chat.id, toolCallId: "tc-b-after", toolName: "problem_grader" }),
				/no longer active/,
			);
		} finally {
			await cleanup();
		}
	});

	it("deliverExternalJobResult wakes idle chats for succeeded and failed outcomes", async () => {
		const { host, cleanup } = makeTestHost();
		const wakeInputs: Array<{ chatId: string; input: TurnInput }> = [];
		setRawTurnRunner(async (chatId, input) => {
			wakeInputs.push({ chatId, input });
			if (input.type === "steers") {
				const chat = chatStore.getChat(chatId);
				if (chat) {
					const messages = [...chat.messages, ...input.steers.filter((s) => !chat.messages.some((m) => m.id === s.id))];
					chatStore.saveMessages(chatId, messages);
					noteSteersDurable(chatId, messages);
				}
			}
			return 200;
		});

		try {
			await host.initialize();
			await host.setEnabled("plugin-a", true);
			const ctx = (await host.call("plugin-a", "ctx")) as PluginBackendContext;
			const chat = chatStore.createChat("Idle Wake Arena", "arena");

			const okJob = ctx.createExternalJob({ chatId: chat.id, toolCallId: "tc-idle-ok", toolName: "problem_grader" });
			await ctx.deliverExternalJobResult(okJob.jobId, {
				status: "succeeded",
				text: "Accepted on all 12 tests.",
				data: { verdict: "AC", passed: 12 },
			});
			await waitFor(() => stores.jobStore.getJob(okJob.jobId)?.delivery?.status === "delivered", 8000, "idle AC delivery");

			const savedOkJob = stores.jobStore.getJob(okJob.jobId)!;
			assert.equal(savedOkJob.status, "done");
			assert.equal(wakeInputs.filter((w) => w.chatId === chat.id).length, 1);
			assert.ok(chatStore.getChat(chat.id)!.messages.some((m) => m.id === `steer_${okJob.jobId}`));

			const failJob = ctx.createExternalJob({ chatId: chat.id, toolCallId: "tc-idle-fail", toolName: "problem_grader" });
			await ctx.deliverExternalJobResult(failJob.jobId, {
				status: "failed",
				text: "WA on test 3.",
				data: { verdict: "WA", failedTest: 3 },
			});
			await waitFor(() => stores.jobStore.getJob(failJob.jobId)?.delivery?.status === "delivered", 8000, "idle WA delivery");

			const savedFailJob = stores.jobStore.getJob(failJob.jobId)!;
			assert.equal(savedFailJob.status, "error");
			assert.equal(savedFailJob.error, "WA on test 3.");
			assert.ok(chatStore.getChat(chat.id)!.messages.some((m) => m.id === `steer_${failJob.jobId}`));
		} finally {
			await cleanup();
		}
	});

	it("deliverExternalJobResult hands steer to live agent without triggering idle wake", async () => {
		const { host, cleanup } = makeTestHost();
		let idleWakes = 0;
		setRawTurnRunner(async () => {
			idleWakes++;
			return 200;
		});

		try {
			await host.initialize();
			await host.setEnabled("plugin-a", true);
			const ctx = (await host.call("plugin-a", "ctx")) as PluginBackendContext;
			const chat = chatStore.createChat("Live Steer Arena", "arena");
			const job = ctx.createExternalJob({ chatId: chat.id, toolCallId: "tc-live-1", toolName: "problem_grader" });

			const handed: SteerMessage[] = [];
			assert.ok(beginTurn(chat.id));
			registerLiveAgent(chat.id, { steer: (msg: SteerMessage) => handed.push(msg) } as never);
			try {
				await ctx.deliverExternalJobResult(job.jobId, {
					status: "succeeded",
					text: "Passed hidden suite while turn is live.",
				});
				await waitFor(() => handed.length === 1, 8000, "live agent steer handoff");
				assert.equal(idleWakes, 0);
				assert.equal(handed[0]!.id, `steer_${job.jobId}`);

				const updatedMessages = [...chatStore.getChat(chat.id)!.messages, handed[0]! as never];
				chatStore.saveMessages(chat.id, updatedMessages);
				unregisterLiveAgent(chat.id);
				settleSteers(chat.id, updatedMessages, false);
			} finally {
				unregisterLiveAgent(chat.id);
				endTurn(chat.id);
			}

			await flush();
			assert.equal(idleWakes, 0);
			assert.equal(stores.jobStore.getJob(job.jobId)?.delivery?.status, "delivered");
		} finally {
			await cleanup();
		}
	});

	it("respects learner abort and blocks cross-plugin delivery", async () => {
		const { host, cleanup } = makeTestHost();
		let wakes = 0;
		setRawTurnRunner(async () => {
			wakes++;
			return 200;
		});

		try {
			await host.initialize();
			await host.setEnabled("plugin-a", true);
			await host.setEnabled("plugin-b", true);
			const ctxA = (await host.call("plugin-a", "ctx")) as PluginBackendContext;
			const ctxB = (await host.call("plugin-b", "ctx")) as PluginBackendContext;
			const chat = chatStore.createChat("Aborted External Job", "arena");

			const job = ctxA.createExternalJob({ chatId: chat.id, toolCallId: "tc-abort-1", toolName: "problem_grader" });
			await assert.rejects(
				() => ctxB.deliverExternalJobResult(job.jobId, { status: "succeeded", text: "hijack" }),
				/External job not found/,
			);

			assert.deepEqual(abortJob(job.jobId), { ok: true });
			await waitFor(() => wakes === 1, 8000, "abort steer wake");
			const abortedRecord = stores.jobStore.getJob(job.jobId)!;
			assert.equal(abortedRecord.delivery?.kind, "abort");

			const wakesBeforeLate = wakes;
			await ctxA.deliverExternalJobResult(job.jobId, {
				status: "succeeded",
				text: "Late result after abort",
			});
			await flush();
			const afterLate = stores.jobStore.getJob(job.jobId)!;
			assert.equal(afterLate.delivery?.kind, "abort");
			assert.equal(afterLate.result, undefined);
			assert.equal(afterLate.status, abortedRecord.status);
			assert.equal(wakes, wakesBeforeLate);
		} finally {
			await cleanup();
		}
	});

	it("recoverPluginBackgroundJob preserves running external jobs and re-delivers saved pending external results", async () => {
		const { host, cleanup } = makeTestHost();
		try {
			await host.initialize();
			await host.setEnabled("plugin-a", true);
			const ctx = (await host.call("plugin-a", "ctx")) as PluginBackendContext;
			const chat = chatStore.createChat("Recovery Arena", "arena");

			const runningHandle = ctx.createExternalJob({
				chatId: chat.id,
				toolCallId: "tc-rec-running",
				toolName: "problem_grader",
			});
			const pendingResultHandle = ctx.createExternalJob({
				chatId: chat.id,
				toolCallId: "tc-rec-done",
				toolName: "problem_grader",
			});
			const savedResult = {
				pluginId: "plugin-a",
				toolName: "problem_grader",
				input: {},
				text: "Persisted external verdict",
				outcome: { id: "ext_tc-rec-done", status: "succeeded" as const, result: null },
			};
			stores.jobStore.updateJob(pendingResultHandle.jobId, {
				status: "done",
				activity: "finished",
				result: savedResult,
				delivery: { kind: "result", status: "pending" },
			});

			const deliveries: SteerMessage[] = [];
			const aborts = new Map<string, AbortController>();
			await recoverPluginBackgroundJob(stores.jobStore.getJob(runningHandle.jobId)!, {
				jobStore: stores.jobStore,
				deliver: async (steer) => {
					deliveries.push(steer);
				},
				registerAbort: (id, c) => aborts.set(id, c),
				unregisterAbort: (id) => aborts.delete(id),
				readTask: () => {
					throw new Error("readTask must not be called for external jobs");
				},
			});
			assert.equal(stores.jobStore.getJob(runningHandle.jobId)?.status, "running");
			assert.equal(deliveries.length, 0);

			await recoverPluginBackgroundJob(stores.jobStore.getJob(pendingResultHandle.jobId)!, {
				jobStore: stores.jobStore,
				deliver: async (steer) => {
					deliveries.push(steer);
				},
				registerAbort: (id, c) => aborts.set(id, c),
				unregisterAbort: (id) => aborts.delete(id),
				readTask: () => {
					throw new Error("readTask must not be called for saved external result");
				},
			});
			assert.equal(deliveries.length, 1);
			assert.equal(deliveries[0]!.id, `steer_${pendingResultHandle.jobId}`);
			assert.equal(deliveries[0]!.content, "Persisted external verdict");
		} finally {
			await cleanup();
		}
	});

	it("createTeachingSession creates a teach chat stamped with strong slot, valid graph context, and prompt URL", async () => {
		const { host, cleanup } = makeTestHost();
		try {
			writeSettings({
				version: CURRENT_SETTINGS_VERSION,
				models: {
					strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "medium" },
				},
			});
			stores.graphStore.appendNode({
				id: "n_reroot",
				name: "Rerooting DP",
				statement: "Compute all-roots tree DP answers in two DFS passes.",
				aliases: [],
				createdAt: "2026-01-01T00:00:00.000Z",
				provenance: [{ chatId: "src-1", messageId: "m-1" }],
			});

			await host.initialize();
			await host.setEnabled("plugin-a", true);
			const ctx = (await host.call("plugin-a", "ctx")) as PluginBackendContext;

			const escalated = ctx.createTeachingSession({
				title: "  DP on Trees  ",
				propositionIds: ["n_reroot", "n_nonexistent"],
				openingPrompt: "Teach me rerooting DP from scratch",
			});
			assert.equal(escalated.title, "DP on Trees");
			assert.equal(escalated.path, `/chat/${escalated.id}?prompt=${encodeURIComponent("Teach me rerooting DP from scratch")}`);

			const rec = chatStore.getChat(escalated.id)!;
			assert.equal("kind" in rec, false, "teaching session omits kind marker");
			assert.deepEqual(rec.settings, {
				model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
				thinkingLevel: "medium",
			});
			assert.equal(rec.messages.length, 1);
			assert.match(JSON.stringify(rec.messages[0]), /Rerooting DP/);
			assert.doesNotMatch(JSON.stringify(rec.messages[0]), /n_nonexistent/);

			const plain = ctx.createTeachingSession({ title: "Shortest Paths" });
			assert.equal(plain.path, `/chat/${plain.id}`);
			assert.equal(chatStore.getChat(plain.id)!.messages.length, 0);
		} finally {
			await cleanup();
		}
	});
});
