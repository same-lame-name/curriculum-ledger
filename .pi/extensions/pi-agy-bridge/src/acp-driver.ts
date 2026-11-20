// High-level turn driver coordinating Pi streamSimple and Antigravity ACP.
// Implements the G9 no-patch toolUse round-trip architecture with re-entry.

import { createHash } from "node:crypto";
import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	Usage,
} from "@earendil-works/pi-ai";
import { AcpConnection } from "./acp-connection.ts";
import { SessionStore } from "./sessions.ts";
import type { BridgeCallResult, PromptResponse } from "./types.ts";

export interface ToolParkEntry {
	callId: string;
	name: string;
	args: Record<string, unknown>;
	resolve: (res: BridgeCallResult) => void;
	reject: (err: Error) => void;
}

export type DriverActivity =
	| { type: "text"; delta: string }
	| { type: "thought"; delta: string }
	| { type: "bridge_call"; callId: string; name: string; args: Record<string, unknown> }
	| { type: "done"; usage?: PromptResponse["usage"] }
	| { type: "error"; error: string };

interface ActiveTurn {
	id: string;
	sessionId: string;
	buffer: DriverActivity[];
	wake: (() => void)[];
	closed: boolean;
	aborted: boolean;
	permissionCancelled?: boolean;
	cancelTimer?: ReturnType<typeof setTimeout>;
	outcome: Promise<PromptResponse>;
	resolveOutcome: (res: PromptResponse) => void;
	rejectOutcome: (err: unknown) => void;
}

interface BlockState {
	partial: AssistantMessage;
	textIdx: number | null;
	thinkingIdx: number | null;
	started: boolean;
}

export function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function ensureStarted(stream: AssistantMessageEventStream, b: BlockState): void {
	if (b.started) return;
	b.started = true;
	stream.push({ type: "start", partial: b.partial });
}

function ensureTextOpen(stream: AssistantMessageEventStream, b: BlockState): void {
	if (b.textIdx !== null) return;
	closeThinking(stream, b);
	ensureStarted(stream, b);
	b.partial.content.push({ type: "text", text: "" });
	b.textIdx = b.partial.content.length - 1;
	stream.push({ type: "text_start", contentIndex: b.textIdx, partial: b.partial });
}

function closeText(stream: AssistantMessageEventStream, b: BlockState): void {
	if (b.textIdx === null) return;
	const idx = b.textIdx;
	b.textIdx = null;
	const text = (b.partial.content[idx] as { type: "text"; text: string }).text;
	stream.push({ type: "text_end", contentIndex: idx, content: text, partial: b.partial });
}

function appendText(stream: AssistantMessageEventStream, b: BlockState, delta: string): void {
	ensureTextOpen(stream, b);
	(b.partial.content[b.textIdx!] as { type: "text"; text: string }).text += delta;
	stream.push({ type: "text_delta", contentIndex: b.textIdx!, delta, partial: b.partial });
}

function ensureThinkingOpen(stream: AssistantMessageEventStream, b: BlockState): void {
	if (b.thinkingIdx !== null) return;
	closeText(stream, b);
	ensureStarted(stream, b);
	b.partial.content.push({ type: "thinking", thinking: "" });
	b.thinkingIdx = b.partial.content.length - 1;
	stream.push({ type: "thinking_start", contentIndex: b.thinkingIdx, partial: b.partial });
}

function closeThinking(stream: AssistantMessageEventStream, b: BlockState): void {
	if (b.thinkingIdx === null) return;
	const idx = b.thinkingIdx;
	b.thinkingIdx = null;
	const thinking = (b.partial.content[idx] as { type: "thinking"; thinking: string }).thinking;
	stream.push({ type: "thinking_end", contentIndex: idx, content: thinking, partial: b.partial });
}

function appendThinking(stream: AssistantMessageEventStream, b: BlockState, delta: string): void {
	ensureThinkingOpen(stream, b);
	(b.partial.content[b.thinkingIdx!] as { type: "thinking"; thinking: string }).thinking += delta;
	stream.push({ type: "thinking_delta", contentIndex: b.thinkingIdx!, delta, partial: b.partial });
}

function finalize(
	stream: AssistantMessageEventStream,
	b: BlockState,
	reason: "stop" | "error" | "aborted",
	message?: string,
): void {
	closeText(stream, b);
	closeThinking(stream, b);
	ensureStarted(stream, b);
	b.partial.stopReason = reason;
	if (reason === "stop") {
		stream.push({ type: "done", reason: "stop", message: b.partial });
	} else {
		if (message) b.partial.errorMessage = message;
		stream.push({ type: "error", reason, error: b.partial });
	}
	stream.end();
}

export function extractTextFromContent(content: unknown, sections?: unknown): string {
	const parts: string[] = [];
	if (typeof content === "string") {
		if (content) parts.push(content);
	} else if (Array.isArray(content)) {
		const joined = content
			.map((c: any) => (typeof c?.text === "string" ? c.text : ""))
			.join("\n");
		if (joined) parts.push(joined);
	}
	if (Array.isArray(sections) && parts.length === 0) {
		const joined = sections
			.map((s: any) => (typeof s?.content === "string" ? s.content : typeof s?.text === "string" ? s.text : ""))
			.filter(Boolean)
			.join("\n\n");
		if (joined) parts.push(joined);
	}
	return parts.join("\n").trim();
}

export function resolveEffectiveSystemPrompt(context: Context): string | undefined {
	const chunks: string[] = [];
	const pushUnique = (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		if (!chunks.includes(trimmed)) chunks.push(trimmed);
	};

	if (typeof context.systemPrompt === "string") {
		pushUnique(context.systemPrompt);
	}
	for (const msg of context.messages ?? []) {
		if ((msg as any).role === "system") {
			pushUnique(extractTextFromContent(msg.content, (msg as any).sections));
		}
	}
	return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

function hashSystemPrompt(prompt: string | undefined): string {
	return createHash("sha256").update(prompt ?? "").digest("hex");
}

function buildCompactHandoff(messages: Context["messages"]): string {
	if (!messages || messages.length === 0) return "";
	const entries: string[] = [];
	for (const msg of messages) {
		const role = (msg as any).role;
		if (role !== "user" && role !== "assistant") continue;
		const text = extractTextFromContent(msg.content);
		const compact = text.replace(/\s+/g, " ").trim();
		if (!compact) continue;
		const clipped = compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
		entries.push(`${role === "user" ? "User" : "Assistant"}: ${clipped}`);
	}
	if (entries.length === 0) return "";
	const tail = entries.slice(-10);
	return `[Prior conversation summary after mode/prompt change]\n${tail.join("\n")}\n[End prior summary]\n\n`;
}

export class AcpDriver {
	#connection: AcpConnection;
	#store: SessionStore;
	#pendingTools = new Map<string, ToolParkEntry>();
	#sentCountBySession = new Map<string, number>();
	#activeTurn: ActiveTurn | null = null;
	#turnCounter = 0;

	constructor(connection: AcpConnection, store: SessionStore) {
		this.#connection = connection;
		this.#store = store;
	}

	markPermissionCancelled(): void {
		const turn = this.#activeTurn;
		if (!turn || turn.closed) return;
		turn.permissionCancelled = true;
		if (!turn.cancelTimer) {
			turn.cancelTimer = setTimeout(() => {
				if (!turn.closed && !turn.aborted) {
					this.#connection.cancel(turn.sessionId);
				}
			}, 250);
			turn.cancelTimer.unref?.();
		}
	}

	pushExternal(activity: DriverActivity): void {
		const turn = this.#activeTurn;
		if (!turn || turn.closed) return;
		this.#emit(turn, activity);
	}

	parkToolCall(
		callId: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<BridgeCallResult> {
		return new Promise<BridgeCallResult>((resolve, reject) => {
			this.#pendingTools.set(callId, { callId, name, args, resolve, reject });
			this.pushExternal({ type: "bridge_call", callId, name, args });
		});
	}

	getPendingTool(callId: string): ToolParkEntry | undefined {
		return this.#pendingTools.get(callId);
	}

	hasPendingTools(): boolean {
		return this.#pendingTools.size > 0;
	}

	#createTurn(sessionId: string): ActiveTurn {
		let resolveOutcome!: (res: PromptResponse) => void;
		let rejectOutcome!: (err: unknown) => void;
		const outcome = new Promise<PromptResponse>((resolve, reject) => {
			resolveOutcome = resolve;
			rejectOutcome = reject;
		});

		return {
			id: `turn-${++this.#turnCounter}`,
			sessionId,
			buffer: [],
			wake: [],
			closed: false,
			aborted: false,
			outcome,
			resolveOutcome,
			rejectOutcome,
		};
	}

	#emit(turn: ActiveTurn, activity: DriverActivity): void {
		if (turn.closed) return;
		turn.buffer.push(activity);
		const wake = turn.wake.shift();
		if (wake) wake();
	}

	async #nextActivity(turn: ActiveTurn): Promise<DriverActivity | null> {
		for (;;) {
			if (turn.buffer.length > 0) return turn.buffer.shift()!;
			if (turn.closed) return null;
			await new Promise<void>((r) => turn.wake.push(r));
		}
	}

	#abortTurn(
		turn: ActiveTurn,
		sessionId: string,
		stream: AssistantMessageEventStream,
		b: BlockState,
	): void {
		turn.closed = true;
		turn.aborted = true;
		if (turn.cancelTimer) {
			clearTimeout(turn.cancelTimer);
			turn.cancelTimer = undefined;
		}
		this.#activeTurn = null;
		this.#connection.cancel(sessionId);

		for (const [, park] of this.#pendingTools) {
			park.reject(new Error("Turn aborted"));
		}
		this.#pendingTools.clear();

		for (const r of turn.wake) r();
		turn.wake = [];

		finalize(stream, b, "aborted");
	}

	async runTurn(
		stream: AssistantMessageEventStream,
		model: Model<any>,
		context: Context,
		options?: SimpleStreamOptions,
	): Promise<void> {
		const partial: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: (model as any).provider ?? "antigravity",
			model: model.id,
			usage: zeroUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const b: BlockState = {
			partial,
			textIdx: null,
			thinkingIdx: null,
			started: false,
		};

		// 1. Check for continuation: resolve pending tool calls from incoming toolResult messages
		const toolResults: Array<{ toolCallId: string; text: string; isError: boolean }> = [];
		if (this.#pendingTools.size > 0 && context.messages) {
			for (const msg of context.messages) {
				if (msg.role === "toolResult" && (msg as any).toolCallId && this.#pendingTools.has((msg as any).toolCallId)) {
					const text = typeof msg.content === "string"
						? msg.content
						: Array.isArray(msg.content)
							? msg.content.map((c: any) => c.text || "").join("\n")
							: "";
					toolResults.push({
						toolCallId: (msg as any).toolCallId,
						text,
						isError: Boolean(msg.isError),
					});
				}
			}
		}

		const isContinuation = toolResults.length > 0 && this.#activeTurn !== null && !this.#activeTurn.closed;

		let turn: ActiveTurn;
		let sessionId: string;

		if (isContinuation) {
			// Resolve the parked tool calls with the real Pi results
			for (const tr of toolResults) {
				const park = this.#pendingTools.get(tr.toolCallId);
				if (park) {
					this.#pendingTools.delete(tr.toolCallId);
					park.resolve({
						content: [{ type: "text", text: tr.text }],
						isError: tr.isError,
					});
				}
			}

			// Re-enter the still-active turn
			turn = this.#activeTurn!;
			sessionId = turn.sessionId;
		} else {
			// Fresh turn: clean up any stale turn
			if (this.#activeTurn && !this.#activeTurn.closed) {
				this.#activeTurn.closed = true;
				for (const r of this.#activeTurn.wake) r();
				this.#activeTurn.wake = [];
			}

			// Ensure ACP connection is running
			if (!this.#connection.alive) {
				await this.#connection.start();
			}

			const cwd = (options as any)?.cwd ?? process.cwd();
			const sid = (options as any)?.sessionId;
			const sKey = sid ? `sid:${sid}` : `cwd:${cwd}`;
			const systemPrompt = resolveEffectiveSystemPrompt(context);
			const sysPromptHash = hashSystemPrompt(systemPrompt);
			const existingRecord = this.#store.getRecord(sKey);
			let storedSessionId = existingRecord?.sessionId;
			let rotatedFromOldSent = 0;
			let rotated = false;

			const hashMismatch = existingRecord
				? existingRecord.systemPromptHash !== undefined
					? existingRecord.systemPromptHash !== sysPromptHash
					: Boolean(systemPrompt)
				: false;

			if (!storedSessionId || hashMismatch) {
				if (storedSessionId && hashMismatch) {
					rotated = true;
					rotatedFromOldSent = this.#sentCountBySession.get(storedSessionId) ?? 0;
					this.#sentCountBySession.delete(storedSessionId);
					void this.#connection.closeSession?.(storedSessionId);
				}
				const created = await this.#connection.newSession(cwd, systemPrompt);
				storedSessionId = created.sessionId;
				this.#store.set(sKey, storedSessionId, sysPromptHash);
			} else if (existingRecord && existingRecord.systemPromptHash === undefined) {
				this.#store.set(sKey, storedSessionId, sysPromptHash);
			}

			sessionId = storedSessionId;

			// Configure model and thought level
			const targetModel = model.id.replace(/^antigravity\//, "");
			let thoughtLevel: "low" | "medium" | "high" | "xhigh" = "medium";
			if (model.reasoning) {
				const r = String((options as any)?.reasoning ?? "medium").toLowerCase();
				if (r === "low" || r === "minimal") thoughtLevel = "low";
				else if (r === "xhigh" || r === "max") thoughtLevel = "xhigh";
				else if (r === "high") thoughtLevel = "high";
				else thoughtLevel = "medium";
			}
			await this.#connection.setConfig(sessionId, targetModel, thoughtLevel);

			// Collect all unsent user messages (handles queued/steered messages cleanly)
			const messages = context.messages ?? [];
			let startIdx = this.#sentCountBySession.get(sessionId) ?? 0;
			if (rotated) {
				let lastNonUserIdx = -1;
				for (let i = messages.length - 1; i >= 0; i--) {
					const role = (messages[i] as any)?.role;
					if (role === "assistant" || role === "toolResult") {
						lastNonUserIdx = i;
						break;
					}
				}
				if (lastNonUserIdx >= 0) {
					startIdx = lastNonUserIdx + 1;
				} else if (rotatedFromOldSent > 0 && rotatedFromOldSent < messages.length) {
					startIdx = rotatedFromOldSent;
				} else {
					startIdx = 0;
				}
			} else if (startIdx > messages.length) {
				startIdx = 0;
			}

			let userMsgs = messages.slice(startIdx).filter((m) => m.role === "user");
			if (userMsgs.length === 0) {
				for (let i = messages.length - 1; i >= 0; i--) {
					if (messages[i]?.role === "user") {
						userMsgs = [messages[i]!];
						break;
					}
				}
			}

			const promptParts: string[] = [];
			const images: Array<{ data: string; mimeType: string }> = [];
			for (const uMsg of userMsgs) {
				if (typeof uMsg.content === "string") {
					if (uMsg.content.trim()) promptParts.push(uMsg.content);
				} else if (Array.isArray(uMsg.content)) {
					const msgText: string[] = [];
					for (const block of uMsg.content as any[]) {
						if (block.type === "text" && block.text) msgText.push(block.text);
						else if (block.type === "image" && block.data && block.mimeType) {
							images.push({ data: block.data, mimeType: block.mimeType });
						}
					}
					if (msgText.length > 0) promptParts.push(msgText.join("\n"));
				}
			}

			let promptText = promptParts.join("\n\n");
			if (rotated && startIdx > 0) {
				const handoff = buildCompactHandoff(messages.slice(0, startIdx));
				if (handoff) {
					promptText = `${handoff}${promptText}`;
				}
			}
			if (!promptText.trim()) {
				promptText = "Continue with the prior conversation.";
			}
			this.#sentCountBySession.set(sessionId, messages.length);

			turn = this.#createTurn(sessionId);
			this.#activeTurn = turn;

			// Launch the ACP prompt asynchronously in background
			const onDelta = (delta: string, isThought: boolean) => {
				this.#emit(turn, { type: isThought ? "thought" : "text", delta });
			};

			this.#connection
				.prompt(sessionId, promptText, images, onDelta)
				.then((res) => {
					if (turn.cancelTimer) {
						clearTimeout(turn.cancelTimer);
						turn.cancelTimer = undefined;
					}
					this.#emit(turn, { type: "done", usage: res.usage });
					turn.resolveOutcome(res);
				})
				.catch((err) => {
					if (turn.cancelTimer) {
						clearTimeout(turn.cancelTimer);
						turn.cancelTimer = undefined;
					}
					if (turn.permissionCancelled) {
						this.#emit(turn, { type: "done" });
						turn.resolveOutcome({ stopReason: "cancelled" });
						return;
					}
					const msg = err instanceof Error ? err.message : String(err);
					this.#emit(turn, { type: "error", error: msg });
					turn.rejectOutcome(err);
				});
		}

		// Setup abort listener
		if (options?.signal) {
			if (options.signal.aborted) {
				this.#abortTurn(turn, sessionId, stream, b);
				return;
			}
			options.signal.addEventListener(
				"abort",
				() => {
					this.#abortTurn(turn, sessionId, stream, b);
				},
				{ once: true },
			);
		}

		ensureStarted(stream, b);

		// 2. Drain activities from the active turn
		while (true) {
			const act = await this.#nextActivity(turn);
			if (!act) break;

			if (act.type === "bridge_call") {
				// Antigravity model called a bridged Pi tool!
				// Close open text/thinking, push toolCall, and end stream with "toolUse".
				closeThinking(stream, b);
				closeText(stream, b);

				const toolCall = {
					type: "toolCall" as const,
					id: act.callId,
					name: act.name,
					arguments: act.args,
				};
				b.partial.content.push(toolCall);
				const contentIndex = b.partial.content.length - 1;
				stream.push({ type: "toolcall_start", contentIndex, partial: b.partial });
				stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: b.partial });

				b.partial.stopReason = "toolUse";
				stream.push({ type: "done", reason: "toolUse", message: b.partial });
				stream.end();
				// PARK: Pi will execute the tool in its local loop, and return the result
				// on the next streamSimple continuation turn!
				return;
			} else if (act.type === "text") {
				appendText(stream, b, act.delta);
			} else if (act.type === "thought") {
				appendThinking(stream, b, act.delta);
			} else if (act.type === "done") {
				closeThinking(stream, b);
				closeText(stream, b);
				if (act.usage) {
					b.partial.usage = {
						input: act.usage.inputTokens || 0,
						output: act.usage.outputTokens || 0,
						cacheRead: act.usage.cachedReadTokens || 0,
						cacheWrite: act.usage.cachedWriteTokens || 0,
						totalTokens:
							act.usage.totalTokens ||
							(act.usage.inputTokens || 0) + (act.usage.outputTokens || 0),
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
				}
				b.partial.stopReason = "stop";
				stream.push({ type: "done", reason: "stop", message: b.partial });
				stream.end();
				turn.closed = true;
				if (this.#activeTurn === turn) {
					this.#activeTurn = null;
				}
				return;
			} else if (act.type === "error") {
				finalize(stream, b, "error", act.error);
				turn.closed = true;
				if (this.#activeTurn === turn) {
					this.#activeTurn = null;
				}
				return;
			}
		}
	}
}
