/**
 * Phase 1 Seam 2 tests (`ChatKind = "arena"`):
 *  - store creation/projection + source-organization exclusion
 *  - prompt composition & segment API route
 *  - createArenaAgent built-in toolset + plugin contributions
 *  - POST /api/chats and handleChatInput plugin-active gating + no graph extraction
 *  - UI helpers (`isCompetitiveArenaActive`, `SessionRow`, `sectionedSegments`)
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Redirect data root off the workspace before loading config-bound modules.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-arena-kind-"));
process.env.LH_DATA_DIR = TMP_DATA;
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";

const { chatStore } = await import("../src/store/chats.ts");
const { stores } = await import("../src/server/stores.ts");
const { composeInstructions, createArenaAgent, createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { allSegmentPaths, effectivePromptSegments } = await import("../src/agent/prompt-segments.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { chainSourceDirectory } = await import("../src/core/source-organization.ts");
const { COMPETITIVE_ARENA_PLUGIN_ID } = await import("../src/core/contracts/chat.ts");
const { handleChatInput, pluginActiveOverride } = await import("../src/server/index.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { createPluginHost } = await import("../src/server/plugin-host.ts");
const { POST: postChats } = await import("../app/api/chats/route.ts");
const { GET: getPromptSegments } = await import("../app/api/settings/prompts/route.ts");
const { isCompetitiveArenaActive } = await import("../components/plugin-chrome.tsx");
const { SessionRow } = await import("../components/sidebar.tsx");
const { sectionedSegments } = await import("../components/settings/agent-section.tsx");

import type { PluginAgentService } from "../src/core/plugin-agents.ts";
import type { PluginInference, PluginLearningData } from "../src/core/plugins.ts";
import type { PluginWorkerService } from "../src/core/plugin-workers.ts";
import type { FrontendPlugin } from "../components/plugin-manager.ts";
import type { ChatListItem } from "../src/core/index.ts";

after(() => {
	pluginActiveOverride.current = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

function makeFauxEngine(reply = "Let us start Round 1.") {
	const faux = createFauxCore({});
	faux.setResponses([() => fauxAssistantMessage([fauxText(reply)])]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

function waitForTurn(chatId: string): Promise<string> {
	const handle = runningTurn(chatId);
	if (!handle) return Promise.resolve("");
	return new Response(handle.subscribe()).text();
}

describe("ChatKind = 'arena' store & source organization", () => {
	it("stamps kind:'arena' on record and list projection while leaving teach absent", () => {
		const arena = chatStore.createChat("ThemeCP Round 1", "arena");
		assert.equal(arena.kind, "arena");
		assert.equal(chatStore.getChat(arena.id)?.kind, "arena");
		const arenaSummary = chatStore.listChats().find((c) => c.id === arena.id);
		assert.equal(arenaSummary?.kind, "arena");

		const plain = chatStore.createChat("Ordinary Teaching");
		assert.equal("kind" in plain, false);
		assert.equal(chatStore.listChats().find((c) => c.id === plain.id)?.kind, "teach");
	});

	it("chainSourceDirectory filters out arena and practice sources", () => {
		const filtered = chainSourceDirectory({
			organization: { version: 1, folders: [], placements: {} },
			sources: [
				{ id: "c_teach", kind: "chat", chatKind: "teach", label: "Teach", createdAt: "2026-01-01T00:00:00Z" },
				{ id: "c_practice", kind: "chat", chatKind: "practice", label: "Practice", createdAt: "2026-01-01T00:00:00Z" },
				{ id: "c_arena", kind: "chat", chatKind: "arena", label: "Arena", createdAt: "2026-01-01T00:00:00Z" },
				{ id: "src_notes", kind: "notes", label: "Notes", createdAt: "2026-01-01T00:00:00Z" },
			],
		});
		assert.deepEqual(
			filtered.sources.map((s) => s.id),
			["c_teach", "src_notes"],
		);
	});
});

describe("Arena prompt composition & segments API", () => {
	it("composes arena/ fragments and ARENA_SHARED_FRAGMENTS without system-prompt.md", () => {
		const segments = effectivePromptSegments("arena", {});
		const paths = segments.map((s) => s.path);
		assert.ok(paths.includes("arena/00-base.md"));
		assert.ok(paths.includes("arena/10-themecp-doctrine.md"));
		assert.ok(paths.includes("shared/10-voice.md"));
		assert.ok(paths.includes("shared/30-learner-files.md"));
		assert.ok(paths.includes("shared/40-formatting.md"));
		assert.ok(!paths.includes("system-prompt.md"), "arena must not include teaching system-prompt.md");

		const prompt = composeInstructions("arena");
		assert.match(prompt, /# The Arena Agent/);
		assert.match(prompt, /ThemeCP/i);
		assert.equal(isValidSegmentPath("arena/00-base.md"), true);
		assert.equal(isValidSegmentPath("arena/10-themecp-doctrine.md"), true);
		assert.ok(allSegmentPaths().includes("arena/00-base.md"));
		assert.ok(allSegmentPaths().includes("arena/10-themecp-doctrine.md"));
	});

	it("GET /api/settings/prompts exposes arena segments", async () => {
		const res = await getPromptSegments();
		assert.equal(res.status, 200);
		const body = (await res.json()) as Record<string, Array<{ path: string }>>;
		assert.ok(Array.isArray(body.arena) && body.arena.length > 0);
		assert.ok(body.arena.some((s) => s.path === "arena/00-base.md"));
		assert.ok(body.arena.some((s) => s.path === "arena/10-themecp-doctrine.md"));
	});
});

describe("createArenaAgent built-in tools & plugin contributions", () => {
	it("exposes Arena built-in tools (including optional graph reader) and excludes quiz/plan/practice tools", () => {
		const engine = makeFauxEngine();
		const ctx = {
			chatId: "arena-agent-1",
			chatStore: stores.chatStore,
			jobStore: stores.jobStore,
			spawn: () => {},
			graphStore: stores.graphStore,
		};
		const agent = createArenaAgent(ctx, { engine, chatId: "arena-agent-1" });
		const names = agent.state.tools.map((t) => t.name);
		for (const expected of ["ask_user_question", "read", "ls", "find", "grep", "research", "pdf", "list_sessions", "list_propositions"]) {
			assert.ok(names.includes(expected), `expected tool ${expected}`);
		}
		for (const excluded of ["quiz", "explain", "plan_init", "problem", "conclude", "probe_done"]) {
			assert.ok(!names.includes(excluded), `did not expect tool ${excluded}`);
		}
	});

	it("attaches plugin contributions targeting agents: ['arena']", async () => {
		const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lh-arena-plugin-host-"));
		const pluginsDir = path.join(pluginRoot, "plugins");
		const distDir = path.join(pluginsDir, "arena-ext", "dist");
		fs.mkdirSync(distDir, { recursive: true });
		fs.writeFileSync(
			path.join(distDir, "manifest.json"),
			JSON.stringify({ apiVersion: 1, id: "arena-ext", name: "Arena Ext", version: "1.0.0", minAppVersion: "0.3.0", backend: "backend.cjs" }),
		);
		fs.writeFileSync(path.join(distDir, "backend.cjs"), "exports.activate = ctx => { ctx.handle('ctx', () => ctx); };");

		const host = createPluginHost({
			directory: pluginsDir,
			appVersion: "0.6.1",
			createServices: () => ({
				learning: {} as PluginLearningData,
				inference: {} as PluginInference,
				agents: { dispose: async () => {} } as PluginAgentService,
				workers: { dispose: async () => {} } as PluginWorkerService,
				createBackgroundTool() {
					throw new Error("unused");
				},
			}),
		});
		try {
			await host.initialize();
			await host.setEnabled("arena-ext", true);
			const ctx = (await host.call("arena-ext", "ctx")) as import("../src/core/plugins.ts").PluginBackendContext;
			ctx.registerInstructions({ agents: ["arena"], text: "ARENA_ADDITIVE_INSTRUCTIONS" });
			ctx.registerTools({
				agents: ["arena"],
				create: () => [
					{
						name: "arena_custom_tool",
						label: "Arena Custom Tool",
						description: "Custom arena test tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
					},
				],
			});

			const engine = makeFauxEngine();
			const agentCtx = { chatId: "arena-2", chatStore: stores.chatStore, jobStore: stores.jobStore, spawn: () => {} };
			const arenaAgent = createArenaAgent(agentCtx, {
				engine,
				chatId: "arena-2",
				pluginContributions: host.agentContributions,
			});
			assert.match(arenaAgent.state.systemPrompt, /ARENA_ADDITIVE_INSTRUCTIONS/);
			assert.ok(arenaAgent.state.tools.some((t) => t.name === "arena_custom_tool"));

			const teacherAgent = createTeacherAgent(undefined, {
				engine,
				chatId: "teach-2",
				pluginContributions: host.agentContributions,
			});
			assert.doesNotMatch(teacherAgent.state.systemPrompt, /ARENA_ADDITIVE_INSTRUCTIONS/);
			assert.ok(!teacherAgent.state.tools.some((t) => t.name === "arena_custom_tool"));
		} finally {
			await host.dispose();
			fs.rmSync(pluginRoot, { recursive: true, force: true });
		}
	});
});

describe("Arena route & handler gating", () => {
	it("POST /api/chats gates kind:'arena' on isPluginActive", async () => {
		try {
			pluginActiveOverride.current = () => false;
			const denied = await postChats(
				new Request("http://test/api/chats", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: "Round X", kind: "arena" }),
				}),
			);
			assert.equal(denied.status, 403);
			const deniedJson = (await denied.json()) as { code?: string; pluginId?: string };
			assert.equal(deniedJson.code, "plugin_disabled");
			assert.equal(deniedJson.pluginId, COMPETITIVE_ARENA_PLUGIN_ID);

			pluginActiveOverride.current = () => true;
			const allowed = await postChats(
				new Request("http://test/api/chats", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: "Round Y", kind: "arena" }),
				}),
			);
			assert.equal(allowed.status, 200);
			const created = (await allowed.json()) as { id: string; title: string };
			assert.equal(chatStore.getChat(created.id)?.kind, "arena");
		} finally {
			pluginActiveOverride.current = undefined;
		}
	});

	it("handleChatInput refuses disabled arena sessions and runs active ones without graph extraction", async () => {
		const chat = chatStore.createChat("Arena Flow Test", "arena");
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });

		try {
			pluginActiveOverride.current = () => false;
			const denied = await handleChatInput(chat.id, { type: "text", text: "Start ThemeCP round" });
			assert.equal(denied.status, 403);
			const deniedJson = (await denied.json()) as { code?: string };
			assert.equal(deniedJson.code, "plugin_disabled");

			pluginActiveOverride.current = () => true;
			const engine = makeFauxEngine("Round 1 ready. Paste your first problem.");
			const res = await handleChatInput(
				chat.id,
				{ type: "text", text: "Start ThemeCP round" },
				(opts) =>
					createArenaAgent(
						{ chatId: chat.id, chatStore: stores.chatStore, jobStore: stores.jobStore, spawn: () => {} },
						{ ...opts, engine },
					),
			);
			assert.equal(res.status, 200);
			await waitForTurn(chat.id);
			const saved = chatStore.getChat(chat.id)!;
			assert.equal(saved.messages.length, 2);
			assert.equal(saved.extractions, undefined, "arena sessions must never schedule graph extraction");
			assert.equal(stores.graphStore.readNodes().length, 0);
		} finally {
			pluginActiveOverride.current = undefined;
		}
	});
});

describe("Arena UI helpers", () => {
	function makePlugin(overrides: Partial<FrontendPlugin> & { id?: string; enabled?: boolean }): FrontendPlugin {
		return {
			info: {
				id: overrides.id ?? COMPETITIVE_ARENA_PLUGIN_ID,
				origin: "core",
				enabled: overrides.enabled ?? true,
				status: overrides.phase === "error" ? "error" : (overrides.enabled ?? true) ? "active" : "disabled",
				revision: "r1",
			},
			phase: overrides.phase ?? "active",
			views: [],
			actions: [],
			placements: [],
			actionBusy: [],
			busy: false,
		};
	}

	it("isCompetitiveArenaActive requires enabled && active phase on competitive-arena", () => {
		assert.equal(isCompetitiveArenaActive([]), false);
		assert.equal(isCompetitiveArenaActive([makePlugin({ id: "other-plugin", enabled: true, phase: "active" })]), false);
		assert.equal(isCompetitiveArenaActive([makePlugin({ enabled: false, phase: "disabled" })]), false);
		assert.equal(isCompetitiveArenaActive([makePlugin({ enabled: true, phase: "loading" })]), false);
		assert.equal(isCompetitiveArenaActive([makePlugin({ enabled: true, phase: "error" })]), false);
		assert.equal(isCompetitiveArenaActive([makePlugin({ enabled: true, phase: "active" })]), true);
	});

	it("SessionRow renders Arena badge with aria-label='Arena session'", () => {
		const chat: ChatListItem = {
			id: "arena-ui-1",
			title: "ThemeCP Round 4",
			kind: "arena",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			messageCount: 2,
			phase: "probe",
			pendingQuestion: false,
			pendingProblem: false,
			busy: false,
			compacting: false,
		};
		const html = renderToStaticMarkup(React.createElement(SessionRow, { chat, active: false, onOpen: () => {} }));
		assert.match(html, /aria-label="Arena session"/);
		assert.ok(html.includes("ThemeCP Round 4"));
	});

	it("sectionedSegments omits Arena when absent and includes Arena before Shared when provided", () => {
		const sharedSeg = { path: "shared/10-voice.md", sourceText: "voice", overrideText: null, enabled: false, shared: true };
		const baseView = {
			teacher: [{ path: "teacher/05-method.md", sourceText: "t", overrideText: null, enabled: false, shared: false }, sharedSeg],
			prober: [{ path: "prober/10-probe-doctrine.md", sourceText: "p", overrideText: null, enabled: false, shared: false }],
			practice: [{ path: "practice/00-base.md", sourceText: "pr", overrideText: null, enabled: false, shared: false }, sharedSeg],
		};
		assert.deepEqual(
			sectionedSegments(baseView).map((s) => s.id),
			["teacher", "prober", "practice", "shared"],
		);

		const withArena = sectionedSegments({
			...baseView,
			arena: [{ path: "arena/00-base.md", sourceText: "a", overrideText: null, enabled: false, shared: false }, sharedSeg],
		});
		assert.deepEqual(
			withArena.map((s) => s.id),
			["teacher", "prober", "practice", "arena", "shared"],
		);
		assert.equal(withArena.find((s) => s.id === "arena")?.segments[0]?.path, "arena/00-base.md");
		assert.match(withArena.at(-1)!.segments[0]!.usageHint ?? "", /Arena/);
	});
});
