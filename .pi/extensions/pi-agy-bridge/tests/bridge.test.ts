// Automated unit test suite for pi-agy-bridge.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { JsonRpcSession } from "../src/jsonrpc.ts";
import { bridgedPiTools } from "../src/bridge-catalog.ts";
import { RbacPermissionHandler, mapAcpToolCallToPi } from "../src/rbac-permission.ts";
import { EscalationRegistry, getEscalateTimeoutMs, ESCALATE_AFTER_MS, INTERACTIVE_ESCALATE_MS } from "../src/mcp-server.ts";
import { buildBlockedPromptOptions, formatBlockSourceLabel } from "../src/permission-prompt.ts";
import { SessionStore } from "../src/sessions.ts";
import { zeroUsage, AcpDriver, resolveEffectiveSystemPrompt } from "../src/acp-driver.ts";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

describe("pi-agy-bridge test suite", () => {
	describe("JsonRpcSession framing and dispatch", () => {
		it("correlates request and response over feed", async () => {
			let sentData = "";
			const session = new JsonRpcSession({
				send: (frame) => {
					sentData = frame;
				},
			});

			const reqPromise = session.request("initialize", { protocolVersion: 1 });
			const reqObj = JSON.parse(sentData);
			assert.equal(reqObj.method, "initialize");
			assert.equal(reqObj.params.protocolVersion, 1);

			// Simulate server responding across two chunk feeds
			const resStr = JSON.stringify({
				jsonrpc: "2.0",
				id: reqObj.id,
				result: { agentInfo: { name: "test-agent", version: "1.0.0" } },
			}) + "\n";

			session.feed(resStr.slice(0, 15));
			session.feed(resStr.slice(15));

			const res = (await reqPromise) as any;
			assert.equal(res.agentInfo.name, "test-agent");
		});

		it("dispatches server-to-client requests to onRequest handler", async () => {
			let replyFrame = "";
			const session = new JsonRpcSession({
				send: (frame) => {
					replyFrame = frame;
				},
				onRequest: async (method, params: any) => {
					if (method === "ping") return { pong: params.msg };
					throw new Error("unknown method");
				},
			});

			session.feed(JSON.stringify({
				jsonrpc: "2.0",
				id: 42,
				method: "ping",
				params: { msg: "hello" },
			}) + "\n");

			// Allow promise tick
			await new Promise((r) => setTimeout(r, 10));

			const repObj = JSON.parse(replyFrame);
			assert.equal(repObj.id, 42);
			assert.deepEqual(repObj.result, { pong: "hello" });
		});
	});

	describe("Bridge catalog filtering", () => {
		it("drops builtins and internal tools while keeping custom tools", () => {
			const allTools = [
				{ name: "read", sourceInfo: { source: "builtin" } },
				{ name: "write", sourceInfo: { source: "builtin" } },
				{ name: "bash", sourceInfo: { source: "builtin" } },
				{ name: "antigravity", sourceInfo: { source: "bridge" } },
				{ name: "bridge_poll_result", sourceInfo: { source: "bridge" } },
				{ name: "curriculum", sourceInfo: { source: "extension" } },
				{ name: "arena_run", sourceInfo: { source: "extension" } },
				{ name: "arena_ledger", sourceInfo: { source: "extension" } },
				{ name: "ladder", sourceInfo: { source: "extension" } },
				{ name: "catalog", sourceInfo: { source: "extension" } },
				{ name: "subagent", sourceInfo: { source: "extension" } },
			];
			const activeNames = allTools.map((t) => t.name);

			const filtered = bridgedPiTools(allTools as any, activeNames);
			const names = filtered.map((t) => t.name);

			assert.ok(!names.includes("read"), "Must not include read");
			assert.ok(!names.includes("write"), "Must not include write");
			assert.ok(!names.includes("bash"), "Must not include bash");
			assert.ok(!names.includes("antigravity"), "Must not include antigravity");
			assert.ok(!names.includes("bridge_poll_result"), "Must not include bridge_poll_result");

			assert.ok(names.includes("curriculum"), "Must include curriculum");
			assert.ok(names.includes("arena_run"), "Must include arena_run");
			assert.ok(names.includes("arena_ledger"), "Must include arena_ledger");
			assert.ok(names.includes("ladder"), "Must include ladder");
			assert.ok(names.includes("catalog"), "Must include catalog");
			assert.ok(names.includes("subagent"), "Must include subagent");
		});
	});

	describe("RBAC permission evaluation and tool mapping", () => {
		it("maps ACP native tool calls to standard Pi tool semantics", () => {
			const bash = mapAcpToolCallToPi({
				name: "run_command",
				rawInput: { CommandLine: "python3 sol.py" },
			});
			assert.deepEqual(bash, { toolName: "bash", input: { command: "python3 sol.py" } });

			const write = mapAcpToolCallToPi({
				name: "write_to_file",
				args: { TargetFile: "courses/dp/course.md", CodeContent: "# DP Course" },
			});
			assert.deepEqual(write, { toolName: "write", input: { path: "courses/dp/course.md", content: "# DP Course" } });

			const edit = mapAcpToolCallToPi({
				name: "edit_file",
				args: {
					TargetFile: "courses/dp/course.md",
					SearchText: "old",
					ReplacementContent: "new",
				},
			});
			assert.deepEqual(edit, {
				toolName: "edit",
				input: { path: "courses/dp/course.md", edits: [{ oldText: "old", newText: "new" }] },
			});

			// Innate Antigravity edit_file with Path, Target, Replacement
			const innateEdit = mapAcpToolCallToPi({
				name: "edit_file",
				args: {
					Path: "/vault/courses/typical90/course.md",
					Target: "## Where the student stands",
					Replacement: "## Where the student stands\nNew notes",
				},
			});
			assert.deepEqual(innateEdit, {
				toolName: "edit",
				input: {
					path: "/vault/courses/typical90/course.md",
					edits: [{ oldText: "## Where the student stands", newText: "## Where the student stands\nNew notes" }],
				},
			});

			// Innate Antigravity write_file with Path, Content
			const innateWrite = mapAcpToolCallToPi({
				name: "write_file",
				args: {
					Path: "/vault/courses/typical90/course.md",
					Content: "# Typical 90",
				},
			});
			assert.deepEqual(innateWrite, {
				toolName: "write",
				input: { path: "/vault/courses/typical90/course.md", content: "# Typical 90" },
			});

			// Innate Antigravity read_file with Path
			const innateRead = mapAcpToolCallToPi({
				name: "read_file",
				args: {
					Path: "/vault/courses/typical90/course.md",
				},
			});
			assert.deepEqual(innateRead, {
				toolName: "read",
				input: { path: "/vault/courses/typical90/course.md" },
			});

			const multiEdit = mapAcpToolCallToPi({
				name: "multi_replace_file_content",
				args: {
					TargetFile: "courses/dp/course.md",
					ReplacementChunks: [{ SearchText: "c1", ReplacementContent: "r1" }],
				},
			});
			assert.deepEqual(multiEdit, {
				toolName: "edit",
				input: { path: "courses/dp/course.md", edits: [{ oldText: "c1", newText: "r1" }] },
			});

			const read = mapAcpToolCallToPi({
				name: "view_file",
				args: { FilePath: "courses/dp/course.md" },
			});
			assert.deepEqual(read, { toolName: "read", input: { path: "courses/dp/course.md" } });

			const ls = mapAcpToolCallToPi({
				name: "list_dir",
				args: { DirectoryPath: "courses/dp" },
			});
			assert.deepEqual(ls, { toolName: "ls", input: { path: "courses/dp" } });

			const grep = mapAcpToolCallToPi({
				name: "grep_search",
				args: { SearchPath: "courses/dp", Query: "DP" },
			});
			assert.deepEqual(grep, { toolName: "grep", input: { path: "courses/dp", pattern: "DP" } });

			const find = mapAcpToolCallToPi({
				name: "find_by_name",
				args: { SearchDirectory: "courses", Pattern: "*.md" },
			});
			assert.deepEqual(find, { toolName: "find", input: { path: "courses", pattern: "*.md" } });
		});

		it("delegates decisions directly to globalThis.__piRbac.checkPermission", () => {
			const originalRbac = (globalThis as any).__piRbac;
			try {
				(globalThis as any).__piRbac = {
					checkPermission: (toolName: string, input: Record<string, unknown>) => {
						if (toolName === "bash" && typeof input.command === "string" && input.command.includes("rm -rf")) {
							return { allowed: false, reason: "Destructive commands blocked by RBAC" };
						}
						if (toolName === "write" && typeof input.path === "string" && input.path.includes(".pi/catalog")) {
							return { allowed: false, reason: "Catalog files are protected" };
						}
						return { allowed: true };
					},
				};

				const rbac = new RbacPermissionHandler();

				// Denied bash command
				const resDeniedBash = rbac.handle({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "run_command", rawInput: { CommandLine: "rm -rf /" } },
				});
				assert.equal(resDeniedBash.outcome.optionId, "deny");

				// Denied write to protected resource
				const resDeniedWrite = rbac.handle({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "write_to_file", args: { TargetFile: ".pi/catalog/problems.json", CodeContent: "{}" } },
				});
				assert.equal(resDeniedWrite.outcome.optionId, "deny");

				// Allowed safe bash command
				const resAllowedBash = rbac.handle({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "run_command", rawInput: { CommandLine: "g++ -O2 sol.cpp" } },
				});
				assert.equal(resAllowedBash.outcome.optionId, "allow");

				// Allowed safe write
				const resAllowedWrite = rbac.handle({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "write_to_file", args: { TargetFile: "sol.cpp", CodeContent: "int main(){}" } },
				});
				assert.equal(resAllowedWrite.outcome.optionId, "allow");
			} finally {
				(globalThis as any).__piRbac = originalRbac;
			}
		});

		it("supports custom validator fallback when running without Pi runtime", () => {
			const custom = new RbacPermissionHandler((toolName, input) => {
				if (toolName === "bash" && typeof input.command === "string" && input.command.includes("forbidden")) {
					return { allowed: false, reason: "Custom block" };
				}
				return { allowed: true };
			});

			const denied = custom.handle({
				options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
				toolCall: { name: "run_command", rawInput: { CommandLine: "forbidden_command" } },
			});
			assert.equal(denied.outcome.optionId, "deny");

			const allowed = custom.handle({
				options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
				toolCall: { name: "run_command", rawInput: { CommandLine: "echo hello" } },
			});
			assert.equal(allowed.outcome.optionId, "allow");
		});

		it("fires onDeny callback with tool identifier and exact reason upon denial", () => {
			const denials: { tool: string; reason: string }[] = [];
			const custom = new RbacPermissionHandler(
				(toolName, _input) => {
					if (toolName === "edit") {
						return { allowed: false, reason: "Notebook section budget exceeded: 3500 > 2600" };
					}
					return { allowed: true };
				},
				(tool, reason) => denials.push({ tool, reason }),
			);

			const denied = custom.handle({
				options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
				toolCall: {
					name: "edit_file",
					args: {
						Path: "courses/typical90/course.md",
						Target: "old",
						Replacement: "new",
					},
				},
			});

			assert.equal(denied.outcome.optionId, "deny");
			assert.equal(denials.length, 1);
			assert.equal(denials[0].tool, "edit_file");
			assert.equal(denials[0].reason, "Notebook section budget exceeded: 3500 > 2600");
		});
	});

	describe("EscalationRegistry", () => {
		it("records long-running calls and delivers terminal results", () => {
			const reg = new EscalationRegistry();
			reg.escalate("call-123", "subagent");

			let view = reg.poll("call-123");
			assert.equal(view?.state, "running");
			assert.equal(view?.name, "subagent");

			reg.settleDone("call-123", "Task completed successfully", false);

			view = reg.poll("call-123");
			assert.equal(view?.state, "done");
			assert.equal(view?.text, "Task completed successfully");
			assert.equal(view?.isError, false);

			reg.markDelivered("call-123");
			assert.equal(view?.delivered, true);
		});
	});

	describe("SessionStore persistence", () => {
		it("persists session mappings atomically", () => {
			const tmpFile = path.join(os.tmpdir(), `test-sessions-${Date.now()}.json`);
			try {
				const store1 = new SessionStore(tmpFile);
				store1.set("pi-conv-1", "agy-sess-42");
				assert.equal(store1.get("pi-conv-1"), "agy-sess-42");

				// Reload in fresh instance
				const store2 = new SessionStore(tmpFile);
				assert.equal(store2.get("pi-conv-1"), "agy-sess-42");
				assert.equal(store2.get("pi-conv-unknown"), undefined);
			} finally {
				try { fs.unlinkSync(tmpFile); } catch {}
			}
		});
	});

	describe("Pi Usage contract", () => {
		it("provides zeroUsage compatible with Pi's addUsageToTotals", () => {
			const u = zeroUsage();
			const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
			// Exact formula from Pi's chunk-4UNPP53I.js:
			totals.input += u.input;
			totals.output += u.output;
			totals.cacheRead += u.cacheRead;
			totals.cacheWrite += u.cacheWrite;
			totals.cost += u.cost.total;
			assert.equal(totals.input, 0);
			assert.equal(totals.cost, 0);
		});
	});

	describe("AcpDriver toolUse round-trip and continuation", () => {
		it("parks turn with toolUse stopReason, then resolves and continues upon toolResult", async () => {
			let onDeltaCb: any;
			let promptPromiseResolve: any;
			const mockConn = {
				alive: true,
				start: async () => {},
				newSession: async () => ({ sessionId: "test-sess", models: [] }),
				setConfig: async () => {},
				cancel: () => {},
				prompt: (_sid: string, _text: string, _images: any, onDelta: any) => {
					onDeltaCb = onDelta;
					return new Promise((r) => {
						promptPromiseResolve = r;
					});
				},
			};
			const store = new SessionStore();
			store.set("cwd:/tmp", "test-sess");

			const driver = new AcpDriver(mockConn as any, store);

			// 1. Start Turn 1
			const stream1 = createAssistantMessageEventStream();
			const turn1Promise = driver.runTurn(
				stream1,
				{ id: "gemini-3.8-flash", api: "agy" } as any,
				{ messages: [{ role: "user", content: "Check ladder status" }] },
				{ cwd: "/tmp" },
			);

			// Wait a tick for prompt to be invoked
			await new Promise((r) => setTimeout(r, 10));

			// Model streams some thoughts
			onDeltaCb("Thinking about checking ladder...", true);

			// Bridge receives tool call from agy
			const toolPromise = driver.parkToolCall("call-abc-123", "ladder", { action: "status" });

			// Turn 1 should end with toolUse
			await turn1Promise;

			// Verify stream 1 events
			const events1: any[] = [];
			for await (const ev of stream1) {
				events1.push(ev);
			}

			const toolEndEv = events1.find((e) => e.type === "toolcall_end");
			assert.ok(toolEndEv, "Stream 1 must have toolcall_end event");
			assert.equal(toolEndEv.toolCall.name, "ladder");

			const done1Ev = events1.find((e) => e.type === "done");
			assert.equal(done1Ev.reason, "toolUse");

			// 2. Start Turn 2 (Continuation with toolResult)
			const stream2 = createAssistantMessageEventStream();
			const turn2Promise = driver.runTurn(
				stream2,
				{ id: "gemini-3.8-flash", api: "agy" } as any,
				{
					messages: [
						{ role: "user", content: "Check ladder status" },
						{ role: "assistant", content: [{ type: "toolCall", id: "call-abc-123", name: "ladder", arguments: {} }] },
						{ role: "toolResult", toolCallId: "call-abc-123", content: "L17 perf 1500" },
					],
				},
				{ cwd: "/tmp" },
			);

			// Tool promise should have resolved with Pi's tool output
			const toolResult = await toolPromise;
			assert.deepEqual(toolResult.content, [{ type: "text", text: "L17 perf 1500" }]);
			assert.equal(toolResult.isError, false);

			// Now model streams final response after receiving tool result
			onDeltaCb("Your ladder status is Level 17.", false);
			promptPromiseResolve({
				stopReason: "end_turn",
				usage: { inputTokens: 100, outputTokens: 20 },
			});

			await turn2Promise;

			// Verify stream 2 events
			const events2: any[] = [];
			for await (const ev of stream2) {
				events2.push(ev);
			}

			const textEv = events2.find((e) => e.type === "text_delta");
			assert.ok(textEv, "Stream 2 must receive text_delta");
			assert.equal(textEv.delta, "Your ladder status is Level 17.");

			const done2Ev = events2.find((e) => e.type === "done");
			assert.equal(done2Ev.reason, "stop");
		});

		it("rotates ACP session when systemPromptHash changes and preserves queued prompts + permission cancel", async () => {
			const sessionsCreated: Array<{ cwd: string; systemPrompt?: string; id: string }> = [];
			const closedSessions: string[] = [];
			const sentPrompts: Array<{ sessionId: string; text: string }> = [];
			let rejectNextPrompt!: (err: Error) => void;

			const mockConn: any = {
				alive: true,
				async newSession(cwd: string, systemPrompt?: string) {
					const id = `agy-rot-${sessionsCreated.length + 1}`;
					sessionsCreated.push({ cwd, systemPrompt, id });
					return { sessionId: id };
				},
				async setConfig() {},
				async closeSession(id: string) {
					closedSessions.push(id);
				},
				cancel() {},
				async prompt(sessionId: string, text: string) {
					sentPrompts.push({ sessionId, text });
					if (sentPrompts.length === 3) {
						return new Promise((_resolve, reject) => {
							rejectNextPrompt = reject;
						});
					}
					return { stopReason: "end_turn" };
				},
			};

			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agy-rot-"));
			const store = new SessionStore(path.join(tmpDir, "sessions.json"));
			const driver = new AcpDriver(mockConn, store);

			// 1. Initial turn without persona prompt + queued follow-up user message
			const stream1 = createAssistantMessageEventStream();
			await driver.runTurn(
				stream1,
				{ id: "gemini-3.8-flash", api: "agy" } as any,
				{
					messages: [
						{ role: "user", content: "hi" },
						{ role: "user", content: "what should we do?" },
					],
				},
				{ cwd: "/tmp", sessionId: "pi-s1" } as any,
			);
			assert.equal(sessionsCreated.length, 1);
			assert.equal(sessionsCreated[0]!.systemPrompt, undefined);
			assert.match(sentPrompts[0]!.text, /hi[\s\S]*what should we do\?/);

			// 2. Persona activates via systemPrompt + multiple system messages -> rotates session + injects handoff
			const stream2 = createAssistantMessageEventStream();
			await driver.runTurn(
				stream2,
				{ id: "gemini-3.8-flash", api: "agy" } as any,
				{
					systemPrompt: "Teacher identity anchor",
					messages: [
						{ role: "system", content: "Extra section" },
						{ role: "user", content: "hi" },
						{ role: "assistant", content: [{ type: "text", text: "Hello student" }] },
						{ role: "user", content: "/skill:teach" },
					],
				},
				{ cwd: "/tmp", sessionId: "pi-s1" } as any,
			);
			assert.equal(sessionsCreated.length, 2);
			assert.match(sessionsCreated[1]!.systemPrompt!, /Teacher identity anchor/);
			assert.match(sessionsCreated[1]!.systemPrompt!, /Extra section/);
			assert.deepEqual(closedSessions, ["agy-rot-1"]);
			assert.equal(sentPrompts[1]!.sessionId, "agy-rot-2");
			assert.match(sentPrompts[1]!.text, /Prior conversation summary/);
			assert.match(sentPrompts[1]!.text, /\/skill:teach/);

			// 3. Denied permission sets markPermissionCancelled -> converts rejection into clean stop
			const stream3 = createAssistantMessageEventStream();
			const turn3 = driver.runTurn(
				stream3,
				{ id: "gemini-3.8-flash", api: "agy" } as any,
				{
					systemPrompt: "Teacher identity anchor",
					messages: [
						{ role: "system", content: "Extra section" },
						{ role: "user", content: "hi" },
						{ role: "assistant", content: [{ type: "text", text: "Hello student" }] },
						{ role: "user", content: "/skill:teach" },
						{ role: "assistant", content: [{ type: "text", text: "Let's check" }] },
						{ role: "user", content: "try command" },
					],
				},
				{ cwd: "/tmp", sessionId: "pi-s1" } as any,
			);
			await new Promise((r) => setTimeout(r, 15));
			driver.markPermissionCancelled();
			rejectNextPrompt(new Error("Tool denied by user"));
			await turn3;

			const ev3: any[] = [];
			for await (const ev of stream3) ev3.push(ev);
			const done3 = ev3.find((e) => e.type === "done");
			assert.equal(done3?.reason, "stop");
			assert.equal(ev3.some((e) => e.type === "error"), false);

			fs.rmSync(tmpDir, { recursive: true, force: true });
		});
	});

	describe("Interactive timeout and separated permission prompt", () => {
		it("exempts quiz and ask_user_question from short 20s escalation", () => {
			assert.equal(getEscalateTimeoutMs("quiz"), INTERACTIVE_ESCALATE_MS);
			assert.equal(getEscalateTimeoutMs("ask_user_question"), 1_800_000);
			assert.equal(getEscalateTimeoutMs("ladder"), ESCALATE_AFTER_MS);
		});

		it("classifies rbac vs notebook guard blocks and exposes exact prompt options", async () => {
			const originalRbac = (globalThis as any).__piRbac;
			const originalTeacher = (globalThis as any).__piTeacher;
			const capturedBlocks: any[] = [];

			try {
				(globalThis as any).__piRbac = {
					checkPermission: (toolName: string, input: Record<string, unknown>) => {
						if (toolName === "bash" && String(input.command).includes("sudo")) {
							return { allowed: false, reason: "Teacher cannot run sudo" };
						}
						return { allowed: true };
					},
				};
				(globalThis as any).__piTeacher = {
					checkNotebookGuard: ({ input }: { input: Record<string, unknown> }) => {
						if (String(input.path).endsWith("course.md")) {
							return "Notebook budget exceeded";
						}
						return null;
					},
				};

				const handler = new RbacPermissionHandler();
				handler.setBlockedResolver(async (block) => {
					capturedBlocks.push(block);
					return block.source === "notebook" ? "allow" : "deny";
				});

				const rbacOutcome = await handler.handleAsync({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "run_command", rawInput: { CommandLine: "sudo ls" } },
				});
				assert.equal(rbacOutcome.outcome.optionId, "deny");
				assert.equal(capturedBlocks[0].source, "rbac");
				assert.equal(formatBlockSourceLabel("rbac"), "[RBAC Blocked]");

				const rbacOpts = buildBlockedPromptOptions("rbac");
				assert.deepEqual(
					rbacOpts.map((o) => ({ label: o.label, action: o.action })),
					[
						{ label: "Allow this once", action: "allow" },
						{ label: "Let me chip in", action: "chip_in" },
					],
				);

				const nbOutcome = await handler.handleAsync({
					options: [{ optionId: "allow", kind: "allow" }, { optionId: "deny", kind: "reject" }],
					toolCall: { name: "edit_file", args: { Path: "courses/dp/course.md", Target: "a", Replacement: "b" } },
				});
				assert.equal(nbOutcome.outcome.optionId, "allow");
				assert.equal(capturedBlocks[1].source, "notebook");
				assert.equal(formatBlockSourceLabel("notebook"), "[Notebook Guard Blocked]");

				const nbOpts = buildBlockedPromptOptions("notebook").map((o) => o.label);
				assert.deepEqual(nbOpts, ["Allow this once", "Let me chip in"]);
			} finally {
				(globalThis as any).__piRbac = originalRbac;
				(globalThis as any).__piTeacher = originalTeacher;
			}
		});

		it("resolves effective system prompt across Context.systemPrompt and system messages", () => {
			const combined = resolveEffectiveSystemPrompt({
				systemPrompt: "Primary prompt",
				messages: [
					{ role: "system" as any, content: "Section addendum" },
					{ role: "user", content: "hi" },
				],
			});
			assert.equal(combined, "Primary prompt\n\nSection addendum");
		});
	});
});
