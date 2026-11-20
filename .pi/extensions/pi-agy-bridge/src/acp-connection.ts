// Connection manager for the Antigravity ACP stdio server.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonRpcSession } from "./jsonrpc.ts";
import { RbacPermissionHandler } from "./rbac-permission.ts";
import type { AcpPermissionRequest, AgyUsage } from "./types.ts";

export interface AcpConnectionOptions {
	bin?: string;
	cwd: string;
	mcpServer?: { port: number; token: string };
	permissionHandler?: RbacPermissionHandler;
	onDelta?: (text: string, isThought: boolean) => void;
	onToolCall?: (toolCall: any) => void;
	log?: (event: string, data?: unknown) => void;
}

export function resolveAgyBinary(override?: string): string {
	if (override && fs.existsSync(override)) return override;
	if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) return process.env.AGY_BIN;
	const localBin = path.join(os.homedir(), ".local", "bin", "agy");
	if (fs.existsSync(localBin)) return localBin;
	return "agy";
}

export class AcpConnection {
	#opts: AcpConnectionOptions;
	#child?: ChildProcess;
	#rpc?: JsonRpcSession;
	#permHandler: RbacPermissionHandler;
	#activeDeltaHandler?: (delta: string, isThought: boolean) => void;
	agentInfo?: { name?: string; version?: string };
	#alive = false;

	constructor(opts: AcpConnectionOptions) {
		this.#opts = opts;
		this.#permHandler = opts.permissionHandler ?? new RbacPermissionHandler();
	}

	get alive(): boolean {
		return this.#alive;
	}

	get pid(): number | undefined {
		return this.#child?.pid;
	}

	setDeltaHandler(handler?: (delta: string, isThought: boolean) => void): void {
		this.#activeDeltaHandler = handler;
	}

	async start(): Promise<void> {
		if (this.#child) return;
		const bin = resolveAgyBinary(this.#opts.bin);
		const args = ["acp"];

		const child = spawn(bin, args, {
			cwd: this.#opts.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Detach background process from keeping Node event loop artificially alive on completion
		child.stdin?.unref();
		child.stdout?.unref();
		child.stderr?.unref();
		child.unref();

		const cleanup = () => {
			try {
				if (this.#child && !this.#child.killed) {
					this.#child.kill("SIGTERM");
				}
			} catch {}
		};
		process.once("exit", cleanup);

		this.#child = child;
		this.#alive = true;

		const rpc = new JsonRpcSession({
			send: (frame) => {
				if (!child.stdin?.destroyed) {
					child.stdin?.write(frame + "\n");
				}
			},
			onRequest: async (method, params) => {
				if (method === "session/request_permission") {
					return this.#permHandler.handleAsync(params as AcpPermissionRequest, this.#opts.cwd);
				}
				throw new Error(`Unsupported server request: ${method}`);
			},
			onNotification: (method, params: any) => {
				if (method === "session/update") {
					const u = params?.update;
					if (u?.sessionUpdate === "agent_message_chunk") {
						const text = u.content?.text || "";
						this.#activeDeltaHandler?.(text, false);
						this.#opts.onDelta?.(text, false);
					} else if (u?.sessionUpdate === "agent_thought_chunk") {
						const text = u.content?.text || "";
						this.#activeDeltaHandler?.(text, true);
						this.#opts.onDelta?.(text, true);
					} else if (u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update") {
						this.#opts.onToolCall?.(u);
					}
				}
			},
			onParseError: (line) => this.#opts.log?.("jsonrpc-parse-error", { line }),
		});

		this.#rpc = rpc;

		child.stdout?.on("data", (chunk) => rpc.feed(chunk.toString()));
		child.stderr?.on("data", (chunk) => this.#opts.log?.("stderr", chunk.toString()));

		child.on("exit", (code, signal) => {
			this.#alive = false;
			this.#opts.log?.("process-exit", { code, signal });
			rpc.abortAll(`ACP server exited with code ${code ?? signal}`);
		});

		const initResult = (await rpc.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
			},
		}, 30_000)) as any;

		this.agentInfo = initResult?.agentInfo;
		this.#opts.log?.("initialized", { agentInfo: this.agentInfo });
	}

	async newSession(cwd: string, systemPrompt?: string): Promise<{ sessionId: string; models: any[] }> {
		if (!this.#rpc) throw new Error("Connection not started");

		const mcpServers: any[] = [];
		if (this.#opts.mcpServer) {
			mcpServers.push({
				name: "pi-bridge",
				type: "http",
				url: `http://127.0.0.1:${this.#opts.mcpServer.port}/mcp`,
				headers: [{ name: "x-bridge-token", value: this.#opts.mcpServer.token }],
			});
		}

		const params: any = {
			cwd,
			mcpServers,
		};

		if (systemPrompt && systemPrompt.trim()) {
			params._meta = {
				antigravity: {
					systemPrompt: {
						append: systemPrompt,
					},
				},
			};
		}

		const res = (await this.#rpc.request("session/new", params, 20_000)) as any;
		const sessionId = res.sessionId;
		if (!sessionId) throw new Error("session/new returned no sessionId");

		return {
			sessionId,
			models: res.models?.availableModels ?? [],
		};
	}

	async setConfig(sessionId: string, model?: string, thoughtLevel?: "low" | "medium" | "high" | "xhigh"): Promise<void> {
		if (!this.#rpc) return;
		if (model) {
			await this.#rpc.request("session/set_config_option", {
				sessionId,
				configId: "model",
				value: model,
			}, 10_000);
		}
		if (thoughtLevel) {
			await this.#rpc.request("session/set_config_option", {
				sessionId,
				configId: "thought_level",
				value: thoughtLevel,
			}, 10_000);
		}
	}

	async prompt(
		sessionId: string,
		text: string,
		images: Array<{ data: string; mimeType: string }> = [],
		onDelta?: (delta: string, isThought: boolean) => void,
	): Promise<{ stopReason: string; usage?: AgyUsage }> {
		if (!this.#rpc) throw new Error("Connection not started");
		if (onDelta) this.#activeDeltaHandler = onDelta;

		const blocks: any[] = [];
		for (const img of images) {
			blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
		}
		blocks.push({ type: "text", text });

		try {
			const res = (await this.#rpc.request("session/prompt", {
				sessionId,
				prompt: blocks,
			})) as any;

			let usage: AgyUsage | undefined;
			if (res?.usage) {
				usage = {
					inputTokens: Number(res.usage.inputTokens || 0),
					outputTokens: Number(res.usage.outputTokens || 0),
					cachedReadTokens: Number(res.usage.cachedReadTokens || 0),
					cachedWriteTokens: Number(res.usage.cachedWriteTokens || 0),
					thoughtTokens: Number(res.usage.thoughtTokens || 0),
					totalTokens: Number(res.usage.totalTokens || 0),
				};
			}

			return {
				stopReason: res?.stopReason || "end_turn",
				usage,
			};
		} finally {
			if (onDelta) this.#activeDeltaHandler = undefined;
		}
	}

	cancel(sessionId: string): void {
		if (this.#rpc && this.#alive) {
			this.#rpc.notify("session/cancel", { sessionId });
		}
	}

	async closeSession(sessionId: string): Promise<void> {
		if (this.#rpc && this.#alive) {
			try {
				await this.#rpc.request("session/close", { sessionId }, 5_000);
			} catch {}
		}
	}

	async stop(): Promise<void> {
		this.#alive = false;
		if (this.#child) {
			this.#child.kill("SIGTERM");
			setTimeout(() => {
				try { this.#child?.kill("SIGKILL"); } catch {}
			}, 1000);
		}
	}
}
