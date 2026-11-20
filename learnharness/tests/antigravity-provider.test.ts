import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Type } from "typebox";
import { clampThinkingLevel, createModels, getSupportedThinkingLevels, type Api, type Message, type Model, type Tool, type ToolResultMessage } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type { AcpSessionListener } from "../src/agent/antigravity/acp-connection.ts";
import { ANTIGRAVITY_API, ANTIGRAVITY_PROVIDER } from "../src/agent/antigravity/constants.ts";
import { resolveAgyBinary } from "../src/agent/antigravity/binary.ts";
import { BRIDGE_TOKEN_HEADER, createAntigravityToolBridge } from "../src/agent/antigravity/mcp-bridge.ts";
import {
	normalizeAcpModels,
	resetAntigravityModelCacheForTests,
	setDiscoveredAntigravityModels,
} from "../src/agent/antigravity/models-catalog.ts";
import { evaluateAcpPermission } from "../src/agent/antigravity/permissions.ts";
import { resetAcpPermissionBrokerForTests } from "../src/agent/antigravity/permission-broker.ts";
import { createAntigravityProvider } from "../src/agent/antigravity/provider.ts";
import { createAntigravityStreamFunction, streamAntigravity, toAcpThoughtLevel, type AcpClient } from "../src/agent/antigravity/stream.ts";
import { configurationForReuse, toAntigravityInput, type AcpPromptBlock } from "../src/agent/antigravity/transcript.ts";

const testData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agy-provider-test-"));
process.env.LH_DATA_DIR = testData;
after(() => fs.rmSync(testData, { recursive: true, force: true }));

const { SETTINGS_FILE } = await import("../config.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { catalogProviders, modelCatalog, validateChatSettings } = await import("../src/server/model-catalog.ts");
const { providerKeyPresent } = await import("../src/server/keys.ts");
const { callCost } = await import("../src/server/pricing.ts");
const { antigravityInstallationResponse } = await import("../src/server/antigravity.ts");
const {
	antigravityPermissionsGetResponse,
	antigravityPermissionsPostResponse,
} = await import("../src/server/antigravity-permissions.ts");

const SAMPLE_SESSION_NEW = {
	sessionId: "sess-1",
	models: {
		availableModels: [
			{ modelId: "gemini-4-neon-low", name: "Gemini 4 Neon (Low)" },
			{ modelId: "gemini-4-neon-medium", name: "Gemini 4 Neon (Medium)" },
			{ modelId: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" },
			{ modelId: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" },
			{ modelId: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)" },
			{ modelId: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
			{ modelId: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" },
			{ modelId: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
			{ modelId: "claude-opus-5-5-low", name: "Claude Opus 5.5 (Low)" },
			{ modelId: "claude-opus-5-5-medium", name: "Claude Opus 5.5 (Medium)" },
			{ modelId: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High)" },
			{ modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
		],
	},
	configOptions: [
		{
			id: "model",
			options: [
				{ value: "gemini-4-neon", name: "Gemini 4 Neon" },
				{ value: "gemini-4-argon", name: "Gemini 4 Argon" },
				{ value: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
				{ value: "claude-opus-5-5", name: "Claude Opus 5.5" },
				{ value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
			],
		},
	],
};

describe("Antigravity ACP models-catalog & binary resolution", () => {
	beforeEach(() => resetAntigravityModelCacheForTests());

	it("normalizes live session/new catalog into per-model thinking maps and capabilities", () => {
		const models = normalizeAcpModels(SAMPLE_SESSION_NEW);
		assert.deepEqual(
			models.map((m) => m.id),
			["gemini-4-neon", "gemini-4-argon", "gemini-pro-orchestrator-neon", "claude-opus-5-5", "gpt-oss-120b-medium"],
		);

		const neon = models.find((m) => m.id === "gemini-4-neon")!;
		assert.equal(neon.reasoning, true);
		assert.deepEqual(getSupportedThinkingLevels(neon), ["low", "medium", "high", "xhigh"]);
		assert.equal(neon.contextWindow, 1_048_576);
		assert.deepEqual(neon.input, ["text", "image"]);

		const argon = models.find((m) => m.id === "gemini-4-argon")!;
		assert.deepEqual(getSupportedThinkingLevels(argon), ["low", "medium", "high"]);
		assert.equal(clampThinkingLevel(argon, "xhigh"), "high");

		const orch = models.find((m) => m.id === "gemini-pro-orchestrator-neon")!;
		assert.equal(orch.reasoning, false);
		assert.deepEqual(getSupportedThinkingLevels(orch), ["off"]);

		const opus = models.find((m) => m.id === "claude-opus-5-5")!;
		assert.equal(opus.contextWindow, 200_000);
		assert.deepEqual(opus.input, ["text", "image"]);

		const gptOss = models.find((m) => m.id === "gpt-oss-120b-medium")!;
		assert.equal(gptOss.reasoning, false);
		assert.deepEqual(gptOss.input, ["text"]);
	});

	it("resolves AGY_BIN first, then PATH and standard install dirs", () => {
		const foundExplicit = resolveAgyBinary({
			env: { AGY_BIN: "/custom/bin/agy", PATH: "/usr/bin" },
			platform: "linux",
			homeDir: "/home/dexter",
			isExecutable: (p) => p === "/custom/bin/agy",
		});
		assert.equal(foundExplicit, "/custom/bin/agy");

		const foundKnown = resolveAgyBinary({
			env: { PATH: "/usr/bin" },
			platform: "linux",
			homeDir: "/home/dexter",
			isExecutable: (p) => p === "/home/dexter/.local/bin/agy",
		});
		assert.equal(foundKnown, "/home/dexter/.local/bin/agy");
	});
});

describe("Antigravity non-cancelling permission gate", () => {
	const options = [
		{ optionId: "opt-allow", kind: "allow_once", name: "Allow" },
		{ optionId: "opt-deny", kind: "reject_once", name: "Reject" },
	];

	it("approves bridged LearnHarness MCP tools and denies native shell/fs tools without cancelled", () => {
		const bridged = new Set(["quiz", "plan_init"]);

		for (const allowedName of ["mcp__learnharness__quiz", "mcp_learnharness_quiz"]) {
			const mcpAllow = evaluateAcpPermission({ toolCall: { name: allowedName }, options }, bridged);
			assert.equal(mcpAllow.allowed, true);
			assert.deepEqual(mcpAllow.response, { outcome: { outcome: "selected", optionId: "opt-allow" } });
		}

		for (const nativeTool of ["run_command", "write_file", "edit_file", "read_file", "list_dir"]) {
			const denied = evaluateAcpPermission({ toolCall: { name: nativeTool }, options }, bridged);
			assert.equal(denied.allowed, false);
			assert.deepEqual(denied.response, { outcome: { outcome: "selected", optionId: "opt-deny" } });
			assert.notEqual(denied.response.outcome.outcome, "cancelled");
		}
	});
});

describe("Antigravity stateless HTTP MCP bridge", () => {
	it("enforces x-bridge-token, clamps headers, lists tools, and holds CallTool until resolved", async () => {
		const dummyTool: Tool = {
			name: "quiz",
			description: "Ask quiz question",
			parameters: Type.Object({ prompt: Type.String() }),
		};
		let calls = 0;
		const bridge = await createAntigravityToolBridge([dummyTool], {
			onCall: () => { calls += 1; },
			onError: () => {},
		});

		try {
			const badTokenRes = await fetch(bridge.mcpServer.url, {
				method: "POST",
				headers: { "content-type": "application/json", [BRIDGE_TOKEN_HEADER]: "wrong" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			});
			assert.equal(badTokenRes.status, 403);

			const token = bridge.mcpServer.headers[0]!.value;
			const listRes = await fetch(bridge.mcpServer.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"accept": "application/json, text/event-stream",
					"mcp-protocol-version": "2099-01-01",
					[BRIDGE_TOKEN_HEADER]: token,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			});
			assert.equal(listRes.status, 200);
			const listText = await listRes.text();
			assert.match(listText, /"name":"quiz"/);

			// Held CallTool
			const callPromise = fetch(bridge.mcpServer.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"accept": "application/json, text/event-stream",
					[BRIDGE_TOKEN_HEADER]: token,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "quiz", arguments: { prompt: "2+2?" } },
				}),
			});

			for (let i = 0; i < 40 && bridge.getPendingToolCalls().length === 0; i += 1) {
				await new Promise((r) => setTimeout(r, 10));
			}
			assert.equal(calls, 1);
			const pending = bridge.getPendingToolCalls();
			assert.equal(pending.length, 1);
			assert.equal(pending[0]!.name, "quiz");

			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: pending[0]!.id,
				toolName: "quiz",
				content: [{ type: "text", text: "Question posed." }],
				isError: false,
				timestamp: Date.now(),
			};
			bridge.resolveToolCall(pending[0]!, toolResult);

			const callRes = await callPromise;
			assert.equal(callRes.status, 200);
			const callText = await callRes.text();
			assert.match(callText, /Question posed\./);
		} finally {
			await bridge.close();
		}
	});
});

describe("Antigravity stream warm continuation, cold replay, and multi-session isolation", () => {
	const testTool: Tool = {
		name: "echo_tool",
		description: "Echo input",
		parameters: Type.Object({ x: Type.String() }),
	};
	const model: Model<Api> = {
		id: "gemini-4-argon",
		name: "Gemini 4 Argon",
		api: ANTIGRAVITY_API,
		provider: ANTIGRAVITY_PROVIDER,
		baseUrl: "",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: true,
		thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	};

	it("handles warm tool continuation, warm user continuation, cold transcript replay, and concurrent streams", async () => {
		const listeners = new Map<string, AcpSessionListener>();
		const promptCalls: Array<{ sessionId: string; blocks: AcpPromptBlock[]; mcpUrl?: string }> = [];
		const setConfigCalls: Array<{ sessionId: string; modelId?: string; thoughtLevel?: string }> = [];
		const mcpUrls = new Map<string, { url: string; token: string }>();
		let sidCounter = 0;

		const fakeClient: AcpClient = {
			async newSession(opts) {
				const sessionId = `fake-sid-${++sidCounter}`;
				listeners.set(sessionId, opts.listener);
				const mcp = opts.mcpServers?.[0];
				if (mcp) mcpUrls.set(sessionId, { url: mcp.url, token: mcp.headers[0]!.value });
				return { sessionId };
			},
			updateListener(sessionId, patch) {
				const l = listeners.get(sessionId);
				if (l) Object.assign(l, patch);
			},
			async setConfig(sessionId, modelId, thoughtLevel) {
				setConfigCalls.push({ sessionId, modelId, thoughtLevel });
			},
			async prompt(sessionId, blocks) {
				const listener = listeners.get(sessionId)!;
				const mcp = mcpUrls.get(sessionId)!;
				promptCalls.push({ sessionId, blocks, mcpUrl: mcp.url });

				// Concurrent check: SID 3 / 4 respond distinctly based on prompt text
				const joined = blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");
				if (joined.includes("CONCURRENT_A")) {
					await new Promise((r) => setTimeout(r, 25));
					listener.onDelta?.("RES_A", false);
					return { stopReason: "end_turn" };
				}
				if (joined.includes("CONCURRENT_B")) {
					listener.onDelta?.("RES_B", false);
					return { stopReason: "end_turn" };
				}

				// First turn calls MCP tool then waits for held resolution
				if (joined === "Run tool flow") {
					listener.onDelta?.("Thinking step", true);
					const res = await fetch(mcp.url, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"accept": "application/json, text/event-stream",
							[BRIDGE_TOKEN_HEADER]: mcp.token,
						},
						body: JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							method: "tools/call",
							params: { name: "echo_tool", arguments: { x: "ping" } },
						}),
					});
					const text = await res.text();
					assert.match(text, /pong-result/);
					listener.onDelta?.("Final answer after tool.", false);
					return { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, thoughtTokens: 3, totalTokens: 18 } };
				}

				// Warm user turn delta
				if (joined === "Follow-up user message") {
					listener.onDelta?.("Warm follow-up reply.", false);
					return { stopReason: "end_turn" };
				}

				// Cold replay verification
				listener.onDelta?.("Cold replayed: " + (joined.includes("pong-result") ? "saw pong" : "missing"), false);
				return { stopReason: "end_turn" };
			},
			cancel() {},
			async closeSession(sessionId) {
				listeners.delete(sessionId);
			},
		};

		const streamFn = createAntigravityStreamFunction({ getConnection: () => fakeClient });
		const user1: Message = { role: "user", content: "Run tool flow", timestamp: Date.now() };
		const ctx1 = normalizeContext({ systemPrompt: "You tutor algorithms.", messages: [user1], tools: [testTool] });
		const s1 = streamFn(model, ctx1, { sessionId: "chat-1", reasoning: "medium" });
		const msg1 = await s1.result();
		assert.equal(msg1.stopReason, "toolUse");
		const toolCall = msg1.content.find((b) => b.type === "toolCall")!;
		assert.equal(toolCall.name, "echo_tool");

		// Warm toolResult continuation reuses fake-sid-1 without calling newSession
		const tr1: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: "echo_tool",
			content: [{ type: "text", text: "pong-result" }],
			isError: false,
			timestamp: Date.now(),
		};
		const s2 = streamFn(model, normalizeContext({ systemPrompt: "You tutor algorithms.", messages: [user1, msg1, tr1], tools: [testTool] }), { sessionId: "chat-1", reasoning: "medium" });
		const msg2 = await s2.result();
		assert.equal(msg2.stopReason, "stop");
		assert.equal((msg2.content[0] as { type: "text"; text: string }).text, "Final answer after tool.");
		assert.equal(sidCounter, 1);

		// Warm user follow-up reuses fake-sid-1 and sends ONLY new user delta
		const user2: Message = { role: "user", content: "Follow-up user message", timestamp: Date.now() };
		const s3 = streamFn(model, normalizeContext({ systemPrompt: "You tutor algorithms.", messages: [user1, msg1, tr1, msg2, user2], tools: [testTool] }), { sessionId: "chat-1", reasoning: "medium" });
		const msg3 = await s3.result();
		assert.equal((msg3.content[0] as { type: "text"; text: string }).text, "Warm follow-up reply.");
		assert.equal(sidCounter, 1);

		// Cold replay when systemPrompt changes (or after restart on a fresh streamFn)
		const coldStreamFn = createAntigravityStreamFunction({ getConnection: () => fakeClient });
		const user3: Message = { role: "user", content: "What did tool return?", timestamp: Date.now() };
		const s4 = coldStreamFn(model, normalizeContext({ systemPrompt: "Teacher mode", messages: [user1, msg1, tr1, msg2, user2, msg3, user3], tools: [testTool] }), { sessionId: "chat-1", reasoning: "low" });
		const msg4 = await s4.result();
		assert.equal((msg4.content[0] as { type: "text"; text: string }).text, "Cold replayed: saw pong");

		// Concurrent two-session delta isolation
		const sa = streamFn(model, normalizeContext({ systemPrompt: "S", messages: [{ role: "user", content: "CONCURRENT_A", timestamp: Date.now() }] }), { sessionId: "chat-a", reasoning: "low" });
		const sb = streamFn(model, normalizeContext({ systemPrompt: "S", messages: [{ role: "user", content: "CONCURRENT_B", timestamp: Date.now() }] }), { sessionId: "chat-b", reasoning: "low" });
		const [ma, mb] = await Promise.all([sa.result(), sb.result()]);
		assert.equal((ma.content[0] as { type: "text"; text: string }).text, "RES_A");
		assert.equal((mb.content[0] as { type: "text"; text: string }).text, "RES_B");

		// Verify non-reasoning model omits thoughtLevel in toAcpThoughtLevel & setConfig
		const nonReasoningModel: Model<Api> = { ...model, id: "gemini-pro-orchestrator-neon", reasoning: false };
		assert.equal(toAcpThoughtLevel(nonReasoningModel, "high"), undefined);
		assert.ok(configurationForReuse(nonReasoningModel, ctx1, undefined));
		assert.ok(toAntigravityInput([user1, msg1, tr1]).promptBlocks.length >= 1);
	});
});

describe("Antigravity server catalog opt-in, pricing, and HTTP installation route", () => {
	it("stays hidden when disabled and federates dynamically with null cost when enabled + binary present", async () => {
		const prevSettings = readSettings();
		const prevAgyBin = process.env.AGY_BIN;
		const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fake-agy-"));
		const fakeAgy = path.join(binDir, "agy");
		fs.writeFileSync(fakeAgy, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		try {
			resetAntigravityModelCacheForTests();
			setDiscoveredAntigravityModels(normalizeAcpModels(SAMPLE_SESSION_NEW), { version: "1.5.10", tier: "Google AI Pro" });

			// Disabled by default
			writeSettings({ ...(prevSettings ?? { version: 1 }), antigravity: { enabled: false } });
			process.env.AGY_BIN = fakeAgy;
			assert.equal(providerKeyPresent(ANTIGRAVITY_PROVIDER), false);
			assert.equal(catalogProviders().find((p) => p.id === ANTIGRAVITY_PROVIDER)?.keyPresent, false);
			assert.equal(modelCatalog().models.some((m) => m.provider === ANTIGRAVITY_PROVIDER), false);
			assert.equal(validateChatSettings({ model: { provider: ANTIGRAVITY_PROVIDER, id: "gemini-4-neon" } }).ok, false);

			// Enabled + binary present
			writeSettings({ ...(prevSettings ?? { version: 1 }), antigravity: { enabled: true } });
			assert.equal(providerKeyPresent(ANTIGRAVITY_PROVIDER), true);
			assert.equal(catalogProviders().find((p) => p.id === ANTIGRAVITY_PROVIDER)?.keyPresent, true);
			const agyRow = modelCatalog().models.find((m) => m.provider === ANTIGRAVITY_PROVIDER && m.id === "gemini-4-neon");
			assert.ok(agyRow, "antigravity discovered model exposed when enabled");
			assert.equal(agyRow!.cost, null);
			assert.equal(agyRow!.contextWindow, 1_048_576);
			assert.equal(callCost({ inputTokens: 100, outputTokens: 50 }, `${ANTIGRAVITY_PROVIDER}:gemini-4-neon`), null);
			assert.equal(validateChatSettings({ model: { provider: ANTIGRAVITY_PROVIDER, id: "gemini-4-neon" } }).ok, true);

			// HTTP same-origin check
			const badRes = await antigravityInstallationResponse(new Request("http://127.0.0.1:3000/api/antigravity"));
			assert.equal(badRes.status, 403);
			const okRes = await antigravityInstallationResponse(
				new Request("http://127.0.0.1:3000/api/antigravity", { headers: { host: "127.0.0.1:3000", "x-learnharness-antigravity": "1" } }),
				async () => ({ state: "ready", version: "1.5.10", binaryPath: fakeAgy, tier: "Google AI Pro", modelCount: 5 }),
				() => true,
			);
			assert.equal(okRes.status, 200);
			const body = await okRes.json() as { state: string; version: string; tier: string; modelCount: number };
			assert.equal(body.state, "ready");
			assert.equal(body.version, "1.5.10");
			assert.equal(body.tier, "Google AI Pro");
			assert.equal(body.modelCount, 5);
		} finally {
			if (prevAgyBin === undefined) delete process.env.AGY_BIN;
			else process.env.AGY_BIN = prevAgyBin;
			if (prevSettings) writeSettings(prevSettings);
			else fs.rmSync(SETTINGS_FILE, { force: true });
			fs.rmSync(binDir, { recursive: true, force: true });
			resetAntigravityModelCacheForTests();
		}
	});

	it("builds a valid pi provider directly", () => {
		const c = createModels();
		c.setProvider(createAntigravityProvider(streamAntigravity));
		assert.ok(c.getModels(ANTIGRAVITY_PROVIDER).length >= 5);
	});
});

describe("Antigravity ACP MVP-1 multi-session isolation, hash normalization, and 3-tier permissions", () => {
	const options = [
		{ optionId: "opt-allow", kind: "allow_once", name: "Allow" },
		{ optionId: "opt-deny", kind: "reject_once", name: "Reject" },
	];

	it("approves disambiguated mcp_learnharness_<hex>_* names while blocking third-party spoofs", () => {
		const bridged = new Set(["list_sessions", "quiz"]);

		for (const name of [
			"mcp_learnharness_25066cd7_list_sessions",
			"mcp__learnharness_25066cd7__quiz",
			"mcp_learnharness_deadbeef12_quiz",
		]) {
			const res = evaluateAcpPermission({ toolCall: { name }, options }, bridged);
			assert.equal(res.allowed, true, name);
			assert.equal(res.action, "allow", name);
		}

		// Third-party server name must never auto-approve via Tier 1
		const spoof = evaluateAcpPermission({ toolCall: { name: "mcp_other_quiz" }, options }, bridged);
		assert.equal(spoof.allowed, false);
		assert.equal(spoof.action, "prompt");
	});

	it("enforces Tier 2 safe read-only paths and permission modes (safe_prompt / prompt_native / turbo)", () => {
		const bridged = new Set<string>(["quiz"]);
		const safeFile = path.join(testData, "notes-sample.md");
		fs.writeFileSync(safeFile, "# Note\n", "utf-8");

		// safe_prompt auto-allows validated safe read_file
		const safeRead = evaluateAcpPermission(
			{ toolCall: { name: "read_file", rawInput: { AbsolutePath: safeFile } }, options },
			bridged,
			{ mode: "safe_prompt" },
		);
		assert.equal(safeRead.action, "allow");
		assert.equal(safeRead.allowed, true);

		// safe_prompt refuses auto-allow for sensitive .env or .ssh paths
		const sensitiveEnv = evaluateAcpPermission(
			{ toolCall: { name: "read_file", rawInput: { AbsolutePath: path.join(os.homedir(), ".env") } }, options },
			bridged,
			{ mode: "safe_prompt" },
		);
		assert.equal(sensitiveEnv.action, "prompt");
		assert.equal(sensitiveEnv.allowed, false);

		// prompt_native holds even safe read_file for approval
		const promptRead = evaluateAcpPermission(
			{ toolCall: { name: "read_file", rawInput: { AbsolutePath: safeFile } }, options },
			bridged,
			{ mode: "prompt_native" },
		);
		assert.equal(promptRead.action, "prompt");

		// turbo auto-allows shell commands
		const turboShell = evaluateAcpPermission(
			{ toolCall: { name: "run_command", rawInput: { CommandLine: "echo hi" } }, options },
			bridged,
			{ mode: "turbo" },
		);
		assert.equal(turboShell.action, "allow");
		assert.equal(turboShell.allowed, true);

		// sessionAllowed skips prompt even under prompt_native
		const sessionAllow = evaluateAcpPermission(
			{ toolCall: { name: "run_command" }, options },
			bridged,
			{ mode: "prompt_native", sessionAllowed: new Set(["run_command"]) },
		);
		assert.equal(sessionAllow.action, "allow");
	});

	it("handles interactive chat permission prompts (Allow once / Allow for session / Deny), per-session client lifecycle, and never saves silent empty stops", async () => {
		resetAcpPermissionBrokerForTests();
		const createdClients: number[] = [];
		const stoppedClients: number[] = [];
		let clientSeq = 0;

		const model: Model<Api> = {
			id: "gemini-4-argon",
			name: "Gemini 4 Argon",
			api: ANTIGRAVITY_API,
			provider: ANTIGRAVITY_PROVIDER,
			baseUrl: "",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: false,
			contextWindow: 128_000,
			maxTokens: 16_384,
		};

		const streamFn = createAntigravityStreamFunction({
			getPermissionMode: () => "safe_prompt",
			createConnection: () => {
				const cid = ++clientSeq;
				createdClients.push(cid);
				let listener: AcpSessionListener | undefined;
				let sid = `s-${cid}`;
				return {
					async newSession(opts) {
						listener = opts.listener;
						return { sessionId: sid };
					},
					updateListener(_sid, patch) {
						if (listener) Object.assign(listener, patch);
					},
					async setConfig() {},
					async prompt(_sid, blocks) {
						const text = blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");
						if (text === "SILENT_STOP") {
							listener?.onDelta?.("thinking only...", true);
							return { stopReason: "end_turn" };
						}
						if (text === "PROMPT_DENY_STOP") {
							const resp = await listener!.onPermissionRequest!({
								sessionId: sid,
								toolCall: { name: "run_command", rawInput: { CommandLine: "rm -rf /tmp/x" } },
								options,
							});
							assert.deepEqual(resp, { outcome: { outcome: "selected", optionId: "opt-deny" } });
							return { stopReason: "end_turn" };
						}
						if (text === "PROMPT_SESSION_ALLOW") {
							const resp1 = await listener!.onPermissionRequest!({
								sessionId: sid,
								toolCall: { name: "write_file", rawInput: { TargetFile: "/tmp/out.txt" } },
								options,
							});
							assert.deepEqual(resp1, { outcome: { outcome: "selected", optionId: "opt-allow" } });
							// Second request for write_file in same session must auto-allow without prompting
							const resp2 = await listener!.onPermissionRequest!({
								sessionId: sid,
								toolCall: { name: "write_file", rawInput: { TargetFile: "/tmp/out2.txt" } },
								options,
							});
							assert.deepEqual(resp2, { outcome: { outcome: "selected", optionId: "opt-allow" } });
							listener?.onDelta?.("Wrote files with approval.", false);
							return { stopReason: "end_turn" };
						}
						listener?.onDelta?.("OK", false);
						return { stopReason: "end_turn" };
					},
					cancel() {},
					async closeSession() {},
					getRecentStderr() {
						return cid === 1 ? "fatal test stderr" : "";
					},
					async stop() {
						stoppedClients.push(cid);
					},
				};
			},
		});

		// 1. Silent thinking-only turn must fail with stderr context, not save empty stop
		const sEmpty = streamFn(
			model,
			normalizeContext({ systemPrompt: "S", messages: [{ role: "user", content: "SILENT_STOP", timestamp: Date.now() }] }),
			{ sessionId: "perm-chat-1" },
		);
		const mEmpty = await sEmpty.result();
		assert.equal(mEmpty.stopReason, "error");
		assert.match(mEmpty.errorMessage ?? "", /fatal test stderr/);
		await new Promise((r) => setTimeout(r, 10));
		assert.ok(stoppedClients.includes(1));

		// 2. Denied native tool causing empty stop surfaces denied tool name after POST deny
		const pDenyStream = streamFn(
			model,
			normalizeContext({ systemPrompt: "S", messages: [{ role: "user", content: "PROMPT_DENY_STOP", timestamp: Date.now() }] }),
			{ sessionId: "perm-chat-deny" },
		);
		let pendingList: Array<{ id: string; toolName: string }> = [];
		for (let i = 0; i < 40; i += 1) {
			const res = await antigravityPermissionsGetResponse(new Request("http://127.0.0.1:3000/api/antigravity/permissions?chatId=perm-chat-deny"));
			pendingList = ((await res.json()) as { pending: Array<{ id: string; toolName: string }> }).pending;
			if (pendingList.length > 0) break;
			await new Promise((r) => setTimeout(r, 10));
		}
		assert.equal(pendingList.length, 1);
		assert.equal(pendingList[0]!.toolName, "run_command");
		const denyPost = await antigravityPermissionsPostResponse(
			new Request("http://127.0.0.1:3000/api/antigravity/permissions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: pendingList[0]!.id, decision: "deny" }),
			}),
		);
		assert.equal(denyPost.status, 200);
		const mDeny = await pDenyStream.result();
		assert.equal(mDeny.stopReason, "error");
		assert.match(mDeny.errorMessage ?? "", /run_command.*denied/);

		// 3. Allow for session unlocks repeat calls cleanly
		const pAllowStream = streamFn(
			model,
			normalizeContext({ systemPrompt: "S", messages: [{ role: "user", content: "PROMPT_SESSION_ALLOW", timestamp: Date.now() }] }),
			{ sessionId: "perm-chat-allow" },
		);
		let allowPending: Array<{ id: string; toolName: string }> = [];
		for (let i = 0; i < 40; i += 1) {
			const res = await antigravityPermissionsGetResponse(new Request("http://127.0.0.1:3000/api/antigravity/permissions?chatId=perm-chat-allow"));
			allowPending = ((await res.json()) as { pending: Array<{ id: string; toolName: string }> }).pending;
			if (allowPending.length > 0) break;
			await new Promise((r) => setTimeout(r, 10));
		}
		assert.equal(allowPending.length, 1);
		assert.equal(allowPending[0]!.toolName, "write_file");
		const allowPost = await antigravityPermissionsPostResponse(
			new Request("http://127.0.0.1:3000/api/antigravity/permissions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: allowPending[0]!.id, decision: "allow_session" }),
			}),
		);
		assert.equal(allowPost.status, 200);
		const mAllow = await pAllowStream.result();
		assert.equal(mAllow.stopReason, "stop");
		assert.equal((mAllow.content[0] as { type: "text"; text: string }).text, "Wrote files with approval.");

		// Three separate sessions created three independent AcpClients
		assert.deepEqual(createdClients, [1, 2, 3]);
		resetAcpPermissionBrokerForTests();
	});
});
