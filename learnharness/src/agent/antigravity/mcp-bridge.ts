import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { ImageContent, JsonObject, TextContent, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	LATEST_PROTOCOL_VERSION,
	ListToolsRequestSchema,
	McpError,
	SUPPORTED_PROTOCOL_VERSIONS,
	type CallToolResult,
	type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";

export const BRIDGE_SERVER_NAME = "learnharness";
export const BRIDGE_TOKEN_HEADER = "x-bridge-token";
const LOOPBACK_HOST = "127.0.0.1";
const TOKEN_BYTES = 32;

export interface PendingAcpToolCall {
	id: string;
	name: string;
	arguments: JsonObject;
}

export interface AcpToolBridgeCallbacks {
	onCall(): void;
	onError(error: Error): void;
	onCancel?(call: PendingAcpToolCall): void;
}

export interface AcpMcpServerDescriptor {
	name: string;
	type: "http";
	url: string;
	headers: Array<{ name: string; value: string }>;
}

export interface AcpToolBridge {
	readonly mcpServer: AcpMcpServerDescriptor;
	readonly toolNames: ReadonlySet<string>;
	resolveToolCall(call: PendingAcpToolCall, result: ToolResultMessage): void;
	getPendingToolCalls(): PendingAcpToolCall[];
	close(): Promise<void>;
}

function toMcpContent(block: TextContent | ImageContent): CallToolResult["content"][number] {
	return block.type === "text"
		? { type: "text", text: block.text }
		: { type: "image", data: block.data, mimeType: block.mimeType };
}

function toCallToolResult(result: ToolResultMessage): CallToolResult {
	return { content: result.content.map(toMcpContent), isError: result.isError };
}

function toMcpTool(tool: Tool): McpTool {
	return { name: tool.name, description: tool.description, inputSchema: tool.parameters as McpTool["inputSchema"] };
}

/**
 * Antigravity ACP can send a newer/custom `mcp-protocol-version` header than the
 * installed `@modelcontextprotocol/sdk` server negotiates cleanly in stateless mode.
 */
export function clampProtocolVersionHeader(req: http.IncomingMessage): void {
	const sent = req.headers["mcp-protocol-version"];
	if (typeof sent !== "string" || SUPPORTED_PROTOCOL_VERSIONS.includes(sent)) return;
	req.headers["mcp-protocol-version"] = LATEST_PROTOCOL_VERSION;
	const raw = req.rawHeaders;
	for (let i = 0; i < raw.length - 1; i += 2) {
		if (raw[i]?.toLowerCase() === "mcp-protocol-version") raw[i + 1] = LATEST_PROTOCOL_VERSION;
	}
}

class ToolCallQueue {
	readonly #results = new Map<PendingAcpToolCall, (result: CallToolResult) => void>();

	add(call: PendingAcpToolCall, signal: AbortSignal, onCancel?: (call: PendingAcpToolCall) => void): Promise<CallToolResult> {
		return new Promise<CallToolResult>((resolve) => {
			const cancel = () => {
				const settle = this.#results.get(call);
				if (!settle) return;
				settle({ content: [{ type: "text", text: "MCP request cancelled" }], isError: true });
				onCancel?.(call);
			};
			this.#results.set(call, (result) => {
				this.#results.delete(call);
				signal.removeEventListener("abort", cancel);
				resolve(result);
			});
			signal.addEventListener("abort", cancel, { once: true });
			if (signal.aborted) cancel();
		});
	}

	resolve(call: PendingAcpToolCall, result: ToolResultMessage): void {
		this.#results.get(call)?.(toCallToolResult(result));
	}

	list(): PendingAcpToolCall[] {
		return [...this.#results.keys()];
	}

	clear(): void {
		for (const settle of this.#results.values()) {
			settle({ content: [{ type: "text", text: "Antigravity MCP bridge closed" }], isError: true });
		}
		this.#results.clear();
	}
}

function createStatelessMcpServer(
	tools: Tool[],
	allowedNames: ReadonlySet<string>,
	queue: ToolCallQueue,
	requestSignal: AbortSignal,
	callbacks?: AcpToolBridgeCallbacks,
): Server {
	const server = new Server({ name: BRIDGE_SERVER_NAME, version: "1.0.0" }, { capabilities: { tools: {} } });

	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.map(toMcpTool) }));

	server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
		const name = request.params.name;
		if (!allowedNames.has(name)) {
			const error = new McpError(ErrorCode.InvalidParams, `Antigravity requested undeclared LearnHarness tool "${name}"`);
			callbacks?.onError(error);
			throw error;
		}
		const call: PendingAcpToolCall = {
			id: randomUUID(),
			name,
			arguments: (request.params.arguments ?? {}) as JsonObject,
		};
		const signal = extra.signal ? AbortSignal.any([extra.signal, requestSignal]) : requestSignal;
		const result = queue.add(call, signal, callbacks?.onCancel);
		callbacks?.onCall();
		return result;
	});

	return server;
}

function tokenMatches(header: string | string[] | undefined, expected: Buffer): boolean {
	if (typeof header !== "string") return false;
	const actual = Buffer.from(header);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
	let body = "";
	for await (const chunk of req) body += String(chunk);
	return JSON.parse(body) as unknown;
}

function listen(server: http.Server): Promise<AddressInfo> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, LOOPBACK_HOST, () => {
			server.unref?.();
			resolve(server.address() as AddressInfo);
		});
	});
}

function closeHttpServer(server: http.Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

export async function createAntigravityToolBridge(
	tools: Tool[],
	callbacks?: AcpToolBridgeCallbacks,
): Promise<AcpToolBridge> {
	const token = randomBytes(TOKEN_BYTES).toString("hex");
	const expectedToken = Buffer.from(token);
	const allowedNames = new Set(tools.map((t) => t.name));
	const queue = new ToolCallQueue();
	const routePath = `/mcp/${randomUUID()}`;

	const httpServer = http.createServer(async (req, res) => {
		req.on("error", () => {
			try {
				if (!res.headersSent) res.writeHead(400).end();
				else res.end();
			} catch {
				// ignore
			}
		});

		const urlPath = (req.url ?? "/").split("?")[0];
		if (urlPath !== routePath) {
			res.writeHead(404).end();
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405).end();
			return;
		}
		if (!tokenMatches(req.headers[BRIDGE_TOKEN_HEADER], expectedToken)) {
			res.writeHead(403, { "content-type": "application/json" }).end('{"error":"forbidden"}');
			return;
		}

		let parsedBody: unknown;
		try {
			parsedBody = await readJsonBody(req);
		} catch {
			res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid json"}');
			return;
		}

		clampProtocolVersionHeader(req);

		const abortController = new AbortController();
		req.on("aborted", () => abortController.abort());
		res.on("close", () => {
			if (!res.writableEnded) abortController.abort();
		});

		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		const mcpServer = createStatelessMcpServer(tools, allowedNames, queue, abortController.signal, callbacks);
		res.on("close", () => {
			void transport.close().catch(() => {});
			void mcpServer.close().catch(() => {});
		});

		try {
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, parsedBody);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			callbacks?.onError(err);
			if (!res.headersSent) res.writeHead(500).end();
			else res.end();
		}
	});

	const { port } = await listen(httpServer);

	return {
		mcpServer: {
			name: BRIDGE_SERVER_NAME,
			type: "http",
			url: `http://${LOOPBACK_HOST}:${port}${routePath}`,
			headers: [{ name: BRIDGE_TOKEN_HEADER, value: token }],
		},
		toolNames: allowedNames,
		resolveToolCall: (call, result) => queue.resolve(call, result),
		getPendingToolCalls: () => queue.list(),
		close: async () => {
			queue.clear();
			await closeHttpServer(httpServer);
		},
	};
}
