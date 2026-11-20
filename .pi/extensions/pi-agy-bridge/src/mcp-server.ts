// Lightweight Streamable HTTP MCP Server for Pi-Antigravity Tool Delegation.

import http from "node:http";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	LATEST_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { BridgeCallResult, BridgeToolInfo, PollView } from "./types.ts";

export const TOKEN_HEADER = "x-bridge-token";
export const POLL_TOOL_NAME = "bridge_poll_result";
export const ESCALATE_AFTER_MS = 20_000;
export const DELEGATION_ESCALATE_MS = 120_000;
export const INTERACTIVE_ESCALATE_MS = 1_800_000;

const DELEGATION_NAME_RE = /subagent|delegate|^agent(_|$)/i;
const INTERACTIVE_NAME_RE = /^(quiz|ask_user_question)$/i;

export function getEscalateTimeoutMs(name: string): number {
	if (INTERACTIVE_NAME_RE.test(name)) return INTERACTIVE_ESCALATE_MS;
	return DELEGATION_NAME_RE.test(name) ? DELEGATION_ESCALATE_MS : ESCALATE_AFTER_MS;
}

export class EscalationRegistry {
	#calls = new Map<string, PollView>();

	escalate(callId: string, name: string): void {
		this.#calls.set(callId, { name, state: "running" });
	}

	settleDone(callId: string, text: string, isError: boolean, images: Array<{ data: string; mimeType: string }> = []): void {
		const e = this.#calls.get(callId);
		if (!e) return;
		e.state = "done";
		e.text = text;
		e.isError = isError;
		if (images.length > 0) e.images = images;
	}

	settleFailed(callId: string, reason: string): void {
		const e = this.#calls.get(callId);
		if (!e) return;
		e.state = "failed";
		e.reason = reason;
	}

	poll(callId: string): PollView | undefined {
		return this.#calls.get(callId);
	}

	markDelivered(callId: string): void {
		const e = this.#calls.get(callId);
		if (e) e.delivered = true;
	}
}

export interface McpBridgeDeps {
	listTools: () => BridgeToolInfo[];
	onToolCall: (
		callId: string,
		name: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	) => Promise<BridgeCallResult>;
	log?: (event: string, data?: unknown) => void;
}

export interface McpServerHandle {
	port: number;
	token: string;
	escalations: EscalationRegistry;
	close: () => Promise<void>;
}

function clampProtocolVersionHeader(req: http.IncomingMessage): void {
	const sent = req.headers["mcp-protocol-version"];
	if (typeof sent !== "string" || SUPPORTED_PROTOCOL_VERSIONS.includes(sent)) return;
	req.headers["mcp-protocol-version"] = LATEST_PROTOCOL_VERSION;
	const raw = req.rawHeaders;
	for (let i = 0; i < raw.length - 1; i += 2) {
		if (raw[i].toLowerCase() === "mcp-protocol-version") raw[i + 1] = LATEST_PROTOCOL_VERSION;
	}
}

export async function startMcpServer(deps: McpBridgeDeps): Promise<McpServerHandle> {
	const log = deps.log ?? (() => {});
	const escalations = new EscalationRegistry();
	const token = crypto.randomUUID();

	const pollToolDef: BridgeToolInfo = {
		name: POLL_TOOL_NAME,
		description: "Fetch the result of a long-running Pi tool that answered with STILL RUNNING.",
		parameters: {
			type: "object",
			properties: {
				callId: { type: "string", description: "The callId returned by the still-running tool." },
			},
			required: ["callId"],
		},
	};

	const listHandler = async () => {
		const tools = [...deps.listTools(), pollToolDef];
		log("list-tools", { count: tools.length });
		return {
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description || "",
				inputSchema: (t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} }) as any,
			})),
		};
	};

	const callHandler = async (request: { params: { name: string; arguments?: unknown } }, signal: AbortSignal) => {
		const { name, arguments: rawArgs } = request.params;
		const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;

		// 1. Handle polling queries
		if (name === POLL_TOOL_NAME) {
			const callId = String(args.callId || "");
			const view = escalations.poll(callId);
			if (!view) {
				return {
					content: [{ type: "text", text: `Unknown or expired callId: "${callId}".` }],
					isError: true,
				};
			}
			if (view.state === "running") {
				return {
					content: [{ type: "text", text: `Tool "${view.name}" is STILL RUNNING. Continue doing other work and poll again later.` }],
					isError: false,
				};
			}
			if (view.state === "failed") {
				escalations.markDelivered(callId);
				return {
					content: [{ type: "text", text: `Tool "${view.name}" failed: ${view.reason}` }],
					isError: true,
				};
			}
			escalations.markDelivered(callId);
			const blocks: any[] = [{ type: "text", text: view.text ?? "" }];
			if (view.images) {
				for (const img of view.images) {
					blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
				}
			}
			return { content: blocks, isError: view.isError ?? false };
		}

		// 2. Standard bridged Pi tool call
		const callId = crypto.randomUUID();
		const timeoutMs = getEscalateTimeoutMs(name);
		log("call-tool", { name, callId, timeoutMs });

		const execPromise = deps.onToolCall(callId, name, args, signal);

		return new Promise((resolve) => {
			let settled = false;

			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				escalations.escalate(callId, name);
				log("call-tool-escalated", { name, callId });
				resolve({
					content: [{
						type: "text",
						text: `STILL RUNNING: "${name}" takes extra time. Continue reasoning or doing other work, and poll "${POLL_TOOL_NAME}" with callId "${callId}" when ready.`,
					}],
					isError: false,
				});
			}, timeoutMs);

			execPromise.then(
				(res) => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						log("call-tool-ok", { name, callId });
						resolve({
							content: res.content.length > 0 ? res.content : [{ type: "text", text: "" }],
							isError: res.isError,
						});
					} else {
						// Settled after escalation timeout: store in registry for polling
						const text = res.content.map((c) => c.text || "").join("\n");
						const images = res.content
							.filter((c) => c.data && c.mimeType)
							.map((c) => ({ data: c.data!, mimeType: c.mimeType! }));
						escalations.settleDone(callId, text, res.isError, images);
						log("call-tool-late-done", { name, callId });
					}
				},
				(err: unknown) => {
					const reason = err instanceof Error ? err.message : String(err);
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						log("call-tool-fail", { name, callId, reason });
						resolve({
							content: [{ type: "text", text: `Error executing "${name}": ${reason}` }],
							isError: true,
						});
					} else {
						escalations.settleFailed(callId, reason);
						log("call-tool-late-fail", { name, callId, reason });
					}
				},
			);
		});
	};

	const makeServer = (signal: AbortSignal) => {
		const s = new Server(
			{ name: "pi-agy-bridge", version: "1.0.0" },
			{ capabilities: { tools: {} } },
		);
		s.setRequestHandler(ListToolsRequestSchema, listHandler);
		s.setRequestHandler(CallToolRequestSchema, (request) => callHandler(request as any, signal));
		return s;
	};

	const tokenOk = (req: http.IncomingMessage): boolean => {
		const received = req.headers[TOKEN_HEADER];
		return (
			typeof received === "string" &&
			received.length === token.length &&
			crypto.timingSafeEqual(Buffer.from(received), Buffer.from(token))
		);
	};

	const httpServer = http.createServer(async (req, res) => {
		req.on("error", () => {
			try { if (!res.headersSent) res.writeHead(400).end(); else res.end(); } catch {}
		});

		try {
			if (req.method !== "POST") {
				res.writeHead(405).end();
				return;
			}
			if (!tokenOk(req)) {
				res.writeHead(403, { "content-type": "application/json" }).end('{"error":"forbidden"}');
				return;
			}

			let body = "";
			for await (const chunk of req) body += chunk;

			let parsed: any;
			try {
				parsed = JSON.parse(body);
			} catch {
				res.writeHead(400).end("invalid json");
				return;
			}

			clampProtocolVersionHeader(req);

			const ac = new AbortController();
			req.on("aborted", () => ac.abort());
			res.on("close", () => {
				if (!res.writableEnded) ac.abort();
			});

			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			const server = makeServer(ac.signal);
			await server.connect(transport);
			await transport.handleRequest(req, res, parsed);
		} catch (e) {
			log("http-handler-error", e instanceof Error ? e.message : String(e));
			try { if (!res.headersSent) res.writeHead(500).end(); } catch {}
		}
	});

	return new Promise((resolve, reject) => {
		httpServer.listen(0, "127.0.0.1", () => {
			httpServer.unref();
			const addr = httpServer.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			if (!port) {
				reject(new Error("Failed to bind MCP HTTP server"));
				return;
			}
			log("mcp-server-listening", { port });
			resolve({
				port,
				token,
				escalations,
				close: async () => {
					await new Promise<void>((r) => httpServer.close(() => r()));
					log("mcp-server-closed", { port });
				},
			});
		});
		httpServer.on("error", reject);
	});
}
