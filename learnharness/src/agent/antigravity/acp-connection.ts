import { spawn, type ChildProcess } from "node:child_process";
import type { Model, Api } from "@earendil-works/pi-ai";
import { PATHS } from "../../../config.ts";
import { externalCliEnv } from "../../core/auth-env.ts";
import { getAgyBinary } from "./binary.ts";
import { AntigravityError } from "./constants.ts";
import { JsonRpcSession } from "./jsonrpc.ts";
import { type AcpMcpServerDescriptor } from "./mcp-bridge.ts";
import { normalizeAcpModels, setDiscoveredAntigravityModels } from "./models-catalog.ts";
import {
	configuredAntigravityPermissionMode,
	evaluateAcpPermission,
	type AcpPermissionRequest,
	type AcpPermissionResponse,
} from "./permissions.ts";
import type { AcpPromptBlock } from "./transcript.ts";

export interface AgyUsage {
	inputTokens: number;
	outputTokens: number;
	cachedReadTokens: number;
	cachedWriteTokens: number;
	thoughtTokens: number;
	totalTokens: number;
}

export interface AcpSessionListener {
	bridgedToolNames: ReadonlySet<string>;
	onDelta?: (delta: string, isThought: boolean) => void;
	onToolCall?: (update: unknown) => void;
	onPermissionRequest?: (req: AcpPermissionRequest) => Promise<AcpPermissionResponse> | AcpPermissionResponse;
	onPermissionDeny?: (toolName: string, reason: string) => void;
	onExit?: (reason: string) => void;
}

export interface AcpConnectionDeps {
	findBinary?: () => string | null;
	spawnProcess?: typeof spawn;
}

export interface NewAcpSessionOptions {
	cwd?: string;
	systemPrompt?: string;
	mcpServers?: AcpMcpServerDescriptor[];
	listener: AcpSessionListener;
}

const STDERR_BUFFER_MAX_LINES = 40;

/**
 * Manages a live `agy acp` stdio JSON-RPC server process.
 * Routes all `session/update` notifications and `session/request_permission`
 * requests strictly by `params.sessionId` so concurrent streams remain isolated.
 */
export class AcpConnection {
	readonly #findBinary: () => string | null;
	readonly #spawnProcess: typeof spawn;
	readonly #listeners = new Map<string, AcpSessionListener>();
	readonly #stderrLines: string[] = [];
	#child?: ChildProcess;
	#rpc?: JsonRpcSession;
	#starting?: Promise<void>;
	#alive = false;
	agentInfo?: { name?: string; version?: string };

	constructor(deps: AcpConnectionDeps = {}) {
		this.#findBinary = deps.findBinary ?? getAgyBinary;
		this.#spawnProcess = deps.spawnProcess ?? spawn;
	}

	get alive(): boolean {
		return this.#alive;
	}

	/** Rolling stderr tail captured from `agy acp` without interfering with stdout RPC. */
	getRecentStderr(): string {
		return this.#stderrLines.join("\n").trim();
	}

	async ensureStarted(): Promise<void> {
		if (this.#alive && this.#rpc) return;
		if (this.#starting) return this.#starting;
		this.#starting = this.#start().finally(() => {
			this.#starting = undefined;
		});
		return this.#starting;
	}

	async #start(): Promise<void> {
		const bin = this.#findBinary();
		if (!bin) throw new Error(AntigravityError.CliNotFound);

		const child = this.#spawnProcess(bin, ["acp"], {
			cwd: PATHS.root,
			env: externalCliEnv(),
			stdio: ["pipe", "pipe", "pipe"],
		});

		child.unref?.();

		this.#child = child;
		this.#alive = true;

		const rpc = new JsonRpcSession({
			send: (frame) => {
				if (!child.stdin?.destroyed) child.stdin?.write(`${frame}\n`);
			},
			onRequest: async (method, params) => {
				if (method === "session/request_permission") {
					const req = (params ?? {}) as AcpPermissionRequest;
					const sid = typeof req.sessionId === "string" ? req.sessionId : "";
					const listener = this.#listeners.get(sid);
					if (listener?.onPermissionRequest) {
						return await listener.onPermissionRequest(req);
					}
					const allowed = listener?.bridgedToolNames ?? new Set<string>();
					const decision = evaluateAcpPermission(req, allowed, {
						mode: configuredAntigravityPermissionMode(),
					});
					if (!decision.allowed && decision.reason) {
						listener?.onPermissionDeny?.(decision.toolName, decision.reason);
					}
					return decision.response;
				}
				throw new Error(`Unsupported ACP server request: ${method}`);
			},
			onNotification: (method, params: unknown) => {
				if (method !== "session/update" || !params || typeof params !== "object") return;
				const p = params as Record<string, unknown>;
				const sid = typeof p.sessionId === "string" ? p.sessionId : "";
				const listener = this.#listeners.get(sid);
				if (!listener) return;
				const update = p.update as Record<string, unknown> | undefined;
				if (!update) return;
				const kind = update.sessionUpdate;
				if (kind === "agent_message_chunk") {
					const text = typeof (update.content as { text?: unknown } | undefined)?.text === "string"
						? (update.content as { text: string }).text
						: "";
					if (text) listener.onDelta?.(text, false);
				} else if (kind === "agent_thought_chunk") {
					const text = typeof (update.content as { text?: unknown } | undefined)?.text === "string"
						? (update.content as { text: string }).text
						: "";
					if (text) listener.onDelta?.(text, true);
				} else if (kind === "tool_call" || kind === "tool_call_update") {
					listener.onToolCall?.(update);
				}
			},
		});

		this.#rpc = rpc;
		this.#stderrLines.length = 0;
		child.stdout?.on("data", (chunk: Buffer | string) => rpc.feed(chunk.toString()));
		child.stderr?.on("data", (chunk: Buffer | string) => {
			for (const rawLine of chunk.toString().split(/\r?\n/)) {
				const line = rawLine.trim();
				if (!line) continue;
				this.#stderrLines.push(line);
				if (this.#stderrLines.length > STDERR_BUFFER_MAX_LINES) {
					this.#stderrLines.shift();
				}
			}
		});

		const handleExit = (reason: string) => {
			if (!this.#alive && this.#child !== child) return;
			this.#alive = false;
			if (this.#child === child) this.#child = undefined;
			if (this.#rpc === rpc) this.#rpc = undefined;
			rpc.abortAll(reason);
			const listeners = [...this.#listeners.values()];
			this.#listeners.clear();
			for (const listener of listeners) listener.onExit?.(reason);
		};

		child.once("exit", (code, signal) => {
			const stderrTail = this.getRecentStderr();
			const base = `Antigravity ACP server exited (${code ?? signal ?? "unknown"})`;
			handleExit(stderrTail ? `${base}: ${stderrTail}` : base);
		});
		child.once("error", (err) => {
			handleExit(`Antigravity ACP process error: ${err.message}`);
		});

		const initResult = (await rpc.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
			},
		}, 20_000)) as { agentInfo?: { name?: string; version?: string } } | undefined;

		this.agentInfo = initResult?.agentInfo;
		if (!this.agentInfo && !this.#alive) {
			throw new Error(AntigravityError.NotInitialized);
		}
	}

	async newSession(opts: NewAcpSessionOptions): Promise<{ sessionId: string; models: Model<Api>[] }> {
		await this.ensureStarted();
		if (!this.#rpc) throw new Error(AntigravityError.NotInitialized);

		const params: Record<string, unknown> = {
			cwd: opts.cwd ?? PATHS.root,
			mcpServers: opts.mcpServers ?? [],
		};
		if (opts.systemPrompt && opts.systemPrompt.trim()) {
			params._meta = {
				antigravity: {
					systemPrompt: { append: opts.systemPrompt },
				},
			};
		}

		const res = (await this.#rpc.request("session/new", params, 20_000)) as Record<string, unknown> | undefined;
		const sessionId = typeof res?.sessionId === "string" ? res.sessionId : "";
		if (!sessionId) throw new Error("session/new returned no sessionId");

		this.#listeners.set(sessionId, opts.listener);

		const models = normalizeAcpModels(res);
		if (models.length > 0) {
			const meta = res?._meta as { antigravity?: { tier?: { name?: string } } } | undefined;
			const tier = typeof meta?.antigravity?.tier?.name === "string" ? meta.antigravity.tier.name : null;
			setDiscoveredAntigravityModels(models, {
				version: typeof this.agentInfo?.version === "string" ? this.agentInfo.version : null,
				tier,
			});
		}

		return { sessionId, models };
	}

	updateListener(sessionId: string, patch: Partial<AcpSessionListener>): void {
		const existing = this.#listeners.get(sessionId);
		if (existing) Object.assign(existing, patch);
	}

	async setConfig(sessionId: string, modelId?: string, thoughtLevel?: string): Promise<void> {
		if (!this.#rpc || !this.#alive) return;
		if (modelId) {
			await this.#rpc.request("session/set_config_option", {
				sessionId,
				configId: "model",
				value: modelId,
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

	async prompt(sessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason: string; usage?: AgyUsage }> {
		if (!this.#rpc || !this.#alive) throw new Error(AntigravityError.NotInitialized);
		const res = (await this.#rpc.request("session/prompt", {
			sessionId,
			prompt: blocks,
		})) as { stopReason?: string; usage?: Record<string, unknown> } | undefined;

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
		return { stopReason: res?.stopReason || "end_turn", usage };
	}

	cancel(sessionId: string): void {
		if (this.#rpc && this.#alive) {
			this.#rpc.notify("session/cancel", { sessionId });
		}
	}

	async closeSession(sessionId: string): Promise<void> {
		this.#listeners.delete(sessionId);
		if (this.#rpc && this.#alive) {
			await this.#rpc.request("session/close", { sessionId }, 5_000).catch(() => {});
		}
	}

	async stop(): Promise<void> {
		this.#alive = false;
		const child = this.#child;
		this.#child = undefined;
		const rpc = this.#rpc;
		this.#rpc = undefined;
		this.#listeners.clear();
		rpc?.abortAll("Antigravity ACP connection stopped");
		if (child && !child.killed) {
			child.kill("SIGTERM");
			const timer = setTimeout(() => {
				try {
					if (!child.killed) child.kill("SIGKILL");
				} catch {
					// ignore
				}
			}, 1_000);
			timer.unref?.();
		}
	}
}
