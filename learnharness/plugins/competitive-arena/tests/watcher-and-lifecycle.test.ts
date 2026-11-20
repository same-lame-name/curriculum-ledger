import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureSeeded } from "../src/seed.ts";
import { defaultSettings } from "../src/settings-store.ts";
import { createArenaRunTool } from "../src/tools/arena-run-tool.ts";
import { ArenaWatcher, readActiveSnapshot } from "../src/watcher.ts";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
let tmpRoot = "";

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ca-watcher-test-"));
});

afterEach(() => {
	if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function stageTestSession(dataDir: string, practiceDir: string, pointerPath: string, watcher: ArenaWatcher) {
	const mockCtx = {
		dataDirectory: dataDir,
		directory: PLUGIN_ROOT,
		createExternalJob() {
			return {
				jobId: "ext-job-42",
				chatId: "chat-42",
				toolCallId: "tc-arena-42",
				ackDetails: { jobId: "ext-job-42", dispatched: true as const },
			};
		},
		events: { emit() {} },
	} as any;

	const settings = { ...defaultSettings(), practiceDir, pointerEnabled: true };
	const tool = createArenaRunTool({
		ctx: mockCtx,
		toolCtx: { chatId: "chat-42", agent: "arena" },
		getSettings: () => settings,
		watcher,
		pointerPath,
	});
	const res = await tool.execute(
		"tc-arena-42",
		{
			title: "DP Drill",
			purpose: "drill",
			problems: [
				{
					id: "dp_b",
					title: "Frog 2",
					url: "https://atcoder.jp/contests/dp/tasks/dp_b",
					difficulty: 1200,
					domain: "Dynamic Programming",
					statementSummary: "Min cost frog jumps.",
				},
			],
		},
		undefined,
	);
	assert.equal((res.details as { status?: string }).status, "staged");
}

describe("ArenaWatcher lifecycle", () => {
	it("streams events.jsonl updates and settles result.json via arena.py close_session", async () => {
		const dataDir = path.join(tmpRoot, "data");
		const practiceDir = path.join(tmpRoot, "practice");
		const pointerPath = path.join(tmpRoot, ".pi-arena-root");
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const delivered: { jobId: string; result: any }[] = [];
		const topics: { topic: string; data: unknown }[] = [];

		const watcher = new ArenaWatcher({
			dataDir,
			getPracticeDir: () => practiceDir,
			deliverExternalJobResult: async (jobId, result) => {
				delivered.push({ jobId, result });
			},
			emitNotification: (topic, data) => {
				topics.push({ topic, data });
			},
			pollIntervalMs: 50,
		});

		await stageTestSession(dataDir, practiceDir, pointerPath, watcher);
		assert.equal(watcher.isWatching(), true);

		const activeDir = path.join(dataDir, "arena", "active");
		fs.appendFileSync(
			path.join(activeDir, "events.jsonl"),
			JSON.stringify({ event: "approach_noted", problemId: "dp_b", approach: "O(NK) push DP" }) + "\n",
		);
		await watcher.tick();
		const snap = readActiveSnapshot(dataDir);
		assert.ok(snap);
		assert.equal(snap.lastEventText, "approach noted on dp_b");
		assert.ok(topics.some((t) => t.topic === "arena-status"));

		fs.mkdirSync(practiceDir, { recursive: true });
		fs.writeFileSync(path.join(practiceDir, "dp_b.cpp"), "int main(){return 0;}\n");
		fs.writeFileSync(
			path.join(activeDir, "result.json"),
			JSON.stringify({
				status: "completed",
				problems: [
					{
						id: "dp_b",
						verdict: "AC",
						durationSeconds: 320,
						thinkingSeconds: 120,
						wrongAttempts: 0,
						hintsUsed: 0,
						approach: "O(NK) push DP",
						reflection: "Clean state transition",
					},
				],
			}),
		);

		const settled = await watcher.finalize();
		assert.equal(settled, true);
		assert.equal(watcher.isWatching(), false);
		assert.equal(fs.existsSync(path.join(activeDir, "manifest.json")), false);
		assert.equal(delivered.length, 1);
		assert.equal(delivered[0]!.jobId, "ext-job-42");
		assert.equal(delivered[0]!.result.status, "succeeded");
		assert.match(delivered[0]!.result.text, /Verdict: `AC`/);
		assert.ok(delivered[0]!.result.data.rating_after > 1200);

		const history = JSON.parse(fs.readFileSync(path.join(dataDir, "arena", "history.json"), "utf-8"));
		assert.equal(history.length, 1);
		assert.equal(history[0].problem_id, "dp_b");

		watcher.dispose();
	});

	it("archives failed close_session artifacts under arena/failed/ and resumes result.json across restarts", async () => {
		const dataDir = path.join(tmpRoot, "data");
		const practiceDir = path.join(tmpRoot, "practice");
		const pointerPath = path.join(tmpRoot, ".pi-arena-root");
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const delivered: { jobId: string; result: any }[] = [];
		const watcher1 = new ArenaWatcher({
			dataDir,
			getPracticeDir: () => practiceDir,
			deliverExternalJobResult: async (jobId, result) => {
				delivered.push({ jobId, result });
			},
			emitNotification: () => {},
		});

		await stageTestSession(dataDir, practiceDir, pointerPath, watcher1);
		watcher1.dispose();

		const activeDir = path.join(dataDir, "arena", "active");
		// Break arena.py intentionally after staging so close_session fails while active result exists
		fs.writeFileSync(path.join(dataDir, "arena", "arena.py"), "raise RuntimeError('boom')\n");
		fs.writeFileSync(
			path.join(activeDir, "result.json"),
			JSON.stringify({ status: "completed", problems: [{ id: "dp_b", verdict: "WA" }] }),
		);

		const watcher2 = new ArenaWatcher({
			dataDir,
			getPracticeDir: () => practiceDir,
			deliverExternalJobResult: async (jobId, result) => {
				delivered.push({ jobId, result });
			},
			emitNotification: () => {},
		});

		await watcher2.resumeIfActive();
		assert.equal(delivered.length, 1);
		assert.equal(delivered[0]!.result.status, "failed");
		const failedDirs = fs.readdirSync(path.join(dataDir, "arena", "failed"));
		assert.equal(failedDirs.length, 1);
		assert.ok(fs.existsSync(path.join(dataDir, "arena", "failed", failedDirs[0]!, "result.json")));
		assert.equal(fs.existsSync(path.join(activeDir, "manifest.json")), false);

		watcher2.dispose();
	});
});
