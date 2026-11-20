// Entrypoint for Pi coding agent extension: registers the lean Antigravity ACP provider.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { AcpConnection } from "./src/acp-connection.ts";
import { AcpDriver } from "./src/acp-driver.ts";
import { startMcpServer, type McpServerHandle } from "./src/mcp-server.ts";
import { bridgedPiTools } from "./src/bridge-catalog.ts";
import { RbacPermissionHandler, type PermissionBlockInfo } from "./src/rbac-permission.ts";
import { formatBlockSourceLabel, promptForBlockedTool } from "./src/permission-prompt.ts";
import { SessionStore } from "./src/sessions.ts";

const DEFAULT_MODELS = [
	{
		id: "gemini-3.8-flash",
		name: "Gemini 3.8 Flash",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	{
		id: "gemini-4-argon",
		name: "Gemini 4 Argon",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	{
		id: "gemini-4-hydrogen",
		name: "Gemini 4 Hydrogen",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: null,
		},
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	{
		id: "claude-sonnet-5-5",
		name: "Claude Sonnet 5.5",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 65_536,
	},
	{
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 65_536,
	},
	{
		id: "gpt-oss-120b",
		name: "GPT-OSS 120B",
		provider: "antigravity",
		api: "agy-bridge",
		reasoning: false,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	},
];

export default async function activate(pi: ExtensionAPI): Promise<void> {
	const permHandler = new RbacPermissionHandler();
	const sessionStore = new SessionStore();

	let mcpHandle: McpServerHandle | undefined;
	let driver: AcpDriver | undefined;
	let connection: AcpConnection | undefined;
	let lastCtx: ExtensionContext | undefined;
	const suppressedNotifyCalls = new Set<string>();

	const makeBlockKey = (toolName: string, reason: string) => `${toolName}\0${reason}`;

	if (typeof (pi as any).on === "function") {
		pi.on("session_start", (_ev, ctx) => {
			lastCtx = ctx;
		});
		pi.on("before_agent_start", (_ev, ctx) => {
			lastCtx = ctx;
		});
		pi.on("turn_start", (_ev, ctx) => {
			lastCtx = ctx;
		});
	}

	try {
		mcpHandle = await startMcpServer({
			listTools: () => {
				const active = pi.getActiveTools ? pi.getActiveTools() : [];
				const all = (pi as any).getAllTools ? (pi as any).getAllTools() : [];
				return bridgedPiTools(all, active);
			},
			onToolCall: async (callId, name, args) => {
				if (!driver) throw new Error("ACP driver not initialized");
				return driver.parkToolCall(callId, name, args);
			},
		});

		connection = new AcpConnection({
			cwd: process.cwd(),
			mcpServer: {
				port: mcpHandle.port,
				token: mcpHandle.token,
			},
			permissionHandler: permHandler,
		});

		driver = new AcpDriver(connection, sessionStore);

		permHandler.setOnDeny((toolName, reason) => {
			const key = makeBlockKey(toolName, reason);
			if (suppressedNotifyCalls.delete(key)) return;
			lastCtx?.ui?.notify?.(`Blocked ${toolName}: ${reason}`, "warning");
		});

		permHandler.setBlockedResolver(async (block: PermissionBlockInfo) => {
			if (!lastCtx?.hasUI) {
				driver?.markPermissionCancelled();
				return "deny";
			}

			const choice = await promptForBlockedTool(lastCtx, block);
			if (choice.action === "allow") {
				return "allow";
			}

			suppressedNotifyCalls.add(makeBlockKey(block.toolName, block.reason));
			driver?.markPermissionCancelled();

			lastCtx.ui?.notify?.(
				`${formatBlockSourceLabel(block.source)} ${block.toolName}: ${block.reason} — turn stopped so you can chip in.`,
				"warning",
			);
			return "deny";
		});

		// Register the antigravity provider in Pi
		pi.registerProvider("antigravity", {
			name: "Antigravity (ACP)",
			baseUrl: "agy-bridge://antigravity",
			apiKey: "subscription",
			api: "agy-bridge",
			models: DEFAULT_MODELS as any,
			streamSimple: (model: Model<any>, context: any, options: any) => {
				const stream = createAssistantMessageEventStream();
				void driver?.runTurn(stream, model, context, options);
				return stream;
			},
		});

		// Register quick diagnostic command
		pi.registerCommand("agy", {
			description: "Antigravity ACP bridge status, diagnostics, and warmup",
			handler: async (args: string, ctx: any) => {
				const port = mcpHandle?.port ?? "N/A";
				const arg = (args || "").trim().toLowerCase();

				if (arg === "connect" || arg === "start") {
					if (!connection?.alive) {
						ctx.ui?.notify("Starting Antigravity ACP process...", "info");
						await connection?.start();
					}
				}

				if (connection?.alive) {
					const agent = connection.agentInfo
						? `${connection.agentInfo.name} v${connection.agentInfo.version}`
						: "Antigravity ACP";
					const pidStr = connection.pid ? ` | PID: ${connection.pid}` : "";
					ctx.ui?.notify(`[agy-bridge] Status: CONNECTED | Agent: ${agent}${pidStr} | MCP Port: ${port}`, "info");
				} else {
					ctx.ui?.notify(
						`[agy-bridge] Status: STANDBY (spawns on first Antigravity prompt) | MCP Port: ${port} | Models: 6 ready. Type '/agy connect' to spawn ahead of time.`,
						"info",
					);
				}
			},
		});
	} catch (err) {
		console.error("[pi-agy-bridge] Initialization error:", err);
	}

	// Clean up child process and server on session shutdown
	if ((pi as any).onSessionShutdown) {
		(pi as any).onSessionShutdown(async () => {
			await connection?.stop();
			await mcpHandle?.close();
		});
	}
}
