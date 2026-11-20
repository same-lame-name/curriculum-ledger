// Live end-to-end integration test against agy acp stdio server.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AcpConnection, resolveAgyBinary } from "../src/acp-connection.ts";
import { startMcpServer } from "../src/mcp-server.ts";
import { RbacPermissionHandler } from "../src/rbac-permission.ts";
import type { BridgeToolInfo } from "../src/types.ts";

describe("Live ACP + MCP Bridge Integration Test", () => {
	it("executes live ACP session with MCP tool round-trip and exact usage", async (t) => {
		const bin = resolveAgyBinary();
		if (!bin || !fs.existsSync(bin)) {
			t.skip("agy binary not found on system; skipping live test");
			return;
		}

		let toolCalled = false;
		const customTools: BridgeToolInfo[] = [
			{
				name: "echo_secret",
				description: "Echoes the secret token to verify Pi MCP tool delegation.",
				parameters: {
					type: "object",
					properties: {
						token: { type: "string" },
					},
					required: ["token"],
				},
			},
		];

		// 1. Start our MCP server
		const mcpHandle = await startMcpServer({
			listTools: () => customTools,
			onToolCall: async (_callId, name, args) => {
				if (name === "echo_secret") {
					toolCalled = true;
					return {
						content: [{ type: "text", text: `SECRET_CONFIRMED: ${args.token}` }],
						isError: false,
					};
				}
				return { content: [{ type: "text", text: "unknown tool" }], isError: true };
			},
		});

		const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bridge-e2e-"));
		const permHandler = new RbacPermissionHandler();

		let streamedText = "";

		// 2. Start ACP connection
		const conn = new AcpConnection({
			bin,
			cwd: wsDir,
			mcpServer: {
				port: mcpHandle.port,
				token: mcpHandle.token,
			},
			permissionHandler: permHandler,
			onDelta: (delta: string, isThought: boolean) => {
				if (!isThought) streamedText += delta;
			},
		});

		try {
			await conn.start();
			assert.ok(conn.alive, "Connection should be alive");
			assert.ok(conn.agentInfo?.name, "Should receive agentInfo");

			// 3. New Session with system prompt append
			const sess = await conn.newSession(wsDir, "Always follow tool instructions precisely.");
			assert.ok(sess.sessionId, "Should receive valid sessionId");

			await conn.setConfig(sess.sessionId, "gemini-3.8-flash", "low");

			// 4. Prompt requiring the MCP tool
			const promptRes = await conn.prompt(
				sess.sessionId,
				"Call the echo_secret tool with token 'TEST_PASS_99'. After that, state the secret confirmed message.",
			);

			assert.ok(toolCalled, "The model must have called the bridged MCP tool echo_secret");
			assert.ok(streamedText.includes("TEST_PASS_99") || streamedText.includes("SECRET_CONFIRMED"),
				`Expected output to include secret confirmation, got: ${streamedText}`);

			// 5. Verify exact usage returned
			assert.ok(promptRes.usage, "Usage must be returned");
			assert.ok(promptRes.usage.totalTokens > 0, "totalTokens must be > 0");
			assert.ok(promptRes.usage.inputTokens > 0, "inputTokens must be > 0");

			await conn.closeSession(sess.sessionId);
		} finally {
			await conn.stop();
			await mcpHandle.close();
			try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch {}
		}
	});
});
