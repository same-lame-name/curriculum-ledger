import { isDeepStrictEqual } from "node:util";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type StreamFunction,
	type ThinkingLevel,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import type { AntigravityPermissionMode } from "../../core/contracts/antigravity.ts";
import { AcpConnection, type AcpSessionListener, type AgyUsage } from "./acp-connection.ts";
import { AntigravityError } from "./constants.ts";
import { createAntigravityToolBridge, type AcpMcpServerDescriptor, type AcpToolBridge, type PendingAcpToolCall } from "./mcp-bridge.ts";
import {
	cancelPendingAcpPermissionsForChat,
	isAcpToolAllowedForChat,
	requestAcpPermissionApproval,
} from "./permission-broker.ts";
import {
	configuredAntigravityPermissionMode,
	evaluateAcpPermission,
	formatAcpPermissionPreview,
	type AcpPermissionRequest,
	type AcpPermissionResponse,
} from "./permissions.ts";
import {
	configurationForReuse,
	conversationForReuse,
	toAntigravityInput,
	type AcpPromptBlock,
} from "./transcript.ts";

export const ANTIGRAVITY_IDLE_TIMEOUT_MS = 10 * 60_000;
export const MAX_WARM_ACP_SESSIONS = 6;
const BATCH_FLUSH_DELAY_MS = 20;

export interface AcpClient {
	newSession(opts: {
		cwd?: string;
		systemPrompt?: string;
		mcpServers?: AcpMcpServerDescriptor[];
		listener: AcpSessionListener;
	}): Promise<{ sessionId: string }>;
	updateListener(sessionId: string, patch: Partial<AcpSessionListener>): void;
	setConfig(sessionId: string, modelId?: string, thoughtLevel?: string): Promise<void>;
	prompt(sessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason: string; usage?: AgyUsage }>;
	cancel(sessionId: string): void;
	closeSession(sessionId: string): Promise<void>;
	getRecentStderr?(): string;
	stop?(): Promise<void>;
}

export interface AntigravityStreamDeps {
	getConnection?: () => AcpClient;
	createConnection?: () => AcpClient;
	createBridge?: typeof createAntigravityToolBridge;
	getPermissionMode?: () => AntigravityPermissionMode;
	idleTimeoutMs?: number;
}

export function toAcpThoughtLevel(model: Model<Api>, reasoning: ThinkingLevel | undefined): string | undefined {
	if (!model.reasoning || !reasoning) return undefined;
	if (reasoning === "minimal" || reasoning === "low") return "low";
	if (reasoning === "medium") return "medium";
	if (reasoning === "high") return "high";
	if (reasoning === "xhigh" || reasoning === "max") return "xhigh";
	return undefined;
}

function appendAcpToolOrientation(basePrompt: string, tools: Tool[]): string {
	if (tools.length === 0) return basePrompt;
	const names = tools.map((t) => t.name).join(", ");
	const note = `\n\n[LearnHarness Tools]\nLearnHarness exposes its session, workspace, UI, and arena tools via the bridged "learnharness" MCP server (${names}). Prefer those bridged MCP tools whenever interacting with LearnHarness features, quizzes, workspace navigation, catalog, lab, or arena.`;
	return basePrompt ? `${basePrompt}${note}` : note.trim();
}

function createOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

class AntigravityTurn {
	readonly #output: AssistantMessage;
	#textIdx: number | null = null;
	#thinkingIdx: number | null = null;
	#started = false;
	finished = false;

	constructor(
		private readonly stream: AssistantMessageEventStream,
		model: Model<Api>,
	) {
		this.#output = createOutput(model);
	}

	private ensureStarted(): void {
		if (this.#started) return;
		this.#started = true;
		this.stream.push({ type: "start", partial: this.#output });
	}

	private closeText(): void {
		if (this.#textIdx === null) return;
		const contentIndex = this.#textIdx;
		this.#textIdx = null;
		const block = this.#output.content[contentIndex] as { type: "text"; text: string };
		this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.#output });
	}

	private closeThinking(): void {
		if (this.#thinkingIdx === null) return;
		const contentIndex = this.#thinkingIdx;
		this.#thinkingIdx = null;
		const block = this.#output.content[contentIndex] as { type: "thinking"; thinking: string };
		this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.#output });
	}

	pushDelta(delta: string, isThought: boolean): void {
		if (this.finished || !delta) return;
		this.ensureStarted();
		if (isThought) {
			this.closeText();
			if (this.#thinkingIdx === null) {
				this.#output.content.push({ type: "thinking", thinking: "" });
				this.#thinkingIdx = this.#output.content.length - 1;
				this.stream.push({ type: "thinking_start", contentIndex: this.#thinkingIdx, partial: this.#output });
			}
			const block = this.#output.content[this.#thinkingIdx] as { type: "thinking"; thinking: string };
			block.thinking += delta;
			this.stream.push({ type: "thinking_delta", contentIndex: this.#thinkingIdx, delta, partial: this.#output });
		} else {
			this.closeThinking();
			if (this.#textIdx === null) {
				this.#output.content.push({ type: "text", text: "" });
				this.#textIdx = this.#output.content.length - 1;
				this.stream.push({ type: "text_start", contentIndex: this.#textIdx, partial: this.#output });
			}
			const block = this.#output.content[this.#textIdx] as { type: "text"; text: string };
			block.text += delta;
			this.stream.push({ type: "text_delta", contentIndex: this.#textIdx, delta, partial: this.#output });
		}
	}

	admit(calls: PendingAcpToolCall[]): void {
		if (this.finished || calls.length === 0) return;
		this.ensureStarted();
		this.closeText();
		this.closeThinking();
		for (const call of calls) {
			const toolCall: ToolCall = {
				type: "toolCall",
				id: call.id,
				name: call.name,
				arguments: call.arguments,
			};
			const contentIndex = this.#output.content.length;
			this.#output.content.push(toolCall);
			this.stream.push({ type: "toolcall_start", contentIndex, partial: this.#output });
			this.stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: this.#output });
		}
		this.#output.stopReason = "toolUse";
		this.finished = true;
		this.stream.push({ type: "done", reason: "toolUse", message: this.#output });
		this.stream.end();
	}

	applyUsage(usage?: AgyUsage): void {
		if (!usage) return;
		this.#output.usage.input = usage.inputTokens;
		this.#output.usage.output = usage.outputTokens + usage.thoughtTokens;
		this.#output.usage.cacheRead = usage.cachedReadTokens;
		this.#output.usage.cacheWrite = usage.cachedWriteTokens;
		this.#output.usage.totalTokens = usage.totalTokens || (
			this.#output.usage.input +
			this.#output.usage.output +
			this.#output.usage.cacheRead +
			this.#output.usage.cacheWrite
		);
	}

	hasVisibleContent(): boolean {
		return this.#output.content.some(
			(block) => (block.type === "text" && block.text.trim().length > 0) || block.type === "toolCall",
		);
	}

	finish(stopReason: string): void {
		if (this.finished) return;
		this.ensureStarted();
		this.closeText();
		this.closeThinking();
		const mapped: Extract<StopReason, "stop" | "length"> = stopReason === "max_tokens" ? "length" : "stop";
		this.#output.stopReason = mapped;
		this.finished = true;
		this.stream.push({ type: "done", reason: mapped, message: this.#output });
		this.stream.end();
	}

	fail(message: string, reason: "aborted" | "error"): void {
		if (this.finished) return;
		this.ensureStarted();
		this.closeText();
		this.closeThinking();
		this.#output.stopReason = reason;
		this.#output.errorMessage = message;
		this.finished = true;
		this.stream.push({ type: "error", reason, error: this.#output });
		this.stream.end();
	}

	getMessage(): AssistantMessage {
		return this.#output;
	}
}

class LiveAcpSession {
	acpSessionId: string | undefined;
	promptInFlight = false;
	toolCallIds: string[] = [];
	readonly allowedNativeTools = new Set<string>();
	#admitted: PendingAcpToolCall[] = [];
	#admittedIds = new Set<string>();
	#flushTimer: NodeJS.Timeout | undefined;
	#idleTimer: NodeJS.Timeout | undefined;
	#signal: AbortSignal | undefined;
	#pendingError: string | undefined;
	#lastDeniedTool: string | undefined;
	closed = false;

	constructor(
		private readonly client: AcpClient,
		private readonly ownsClient: boolean,
		private readonly bridge: AcpToolBridge,
		public turn: AntigravityTurn,
		public readonly owner: symbol,
		public readonly chatSessionId: string | undefined,
		public readonly configuration: unknown,
		public conversation: unknown[],
		private readonly registry: Set<LiveAcpSession>,
		private readonly idleTimeoutMs: number,
		private readonly getPermissionMode: () => AntigravityPermissionMode,
	) {}

	private clearIdleTimer(): void {
		clearTimeout(this.#idleTimer);
		this.#idleTimer = undefined;
	}

	private armIdleTimer(): void {
		this.clearIdleTimer();
		const timer = setTimeout(() => {
			void this.kill();
		}, this.idleTimeoutMs);
		timer.unref?.();
		this.#idleTimer = timer;
	}

	private parkInRegistry(): void {
		this.registry.delete(this);
		for (const existing of [...this.registry]) {
			if (this.registry.size < MAX_WARM_ACP_SESSIONS) break;
			if (!existing.promptInFlight && existing !== this) {
				void existing.kill();
			}
		}
		this.registry.add(this);
	}

	async handlePermissionRequest(req: AcpPermissionRequest): Promise<AcpPermissionResponse> {
		const mode = this.getPermissionMode();
		const decision = evaluateAcpPermission(req, this.bridge.toolNames, {
			mode,
			sessionAllowed: this.allowedNativeTools,
		});
		if (decision.action === "allow") {
			return decision.response;
		}
		if (
			this.chatSessionId
			&& isAcpToolAllowedForChat(this.chatSessionId, decision.rawToolName, decision.toolName)
		) {
			return { outcome: { outcome: "selected", optionId: decision.allowOptionId } };
		}
		if (!this.chatSessionId) {
			this.#lastDeniedTool = decision.toolName;
			return { outcome: { outcome: "selected", optionId: decision.denyOptionId } };
		}
		const choice = await requestAcpPermissionApproval({
			chatId: this.chatSessionId,
			toolName: decision.toolName,
			rawToolName: decision.rawToolName,
			title: typeof req.toolCall?.title === "string" ? req.toolCall.title : undefined,
			argsPreview: formatAcpPermissionPreview(req),
			signal: this.#signal,
		});
		if (choice === "allow_session") {
			if (decision.toolName) this.allowedNativeTools.add(decision.toolName);
			if (decision.rawToolName) this.allowedNativeTools.add(decision.rawToolName);
			return { outcome: { outcome: "selected", optionId: decision.allowOptionId } };
		}
		if (choice === "allow_once") {
			return { outcome: { outcome: "selected", optionId: decision.allowOptionId } };
		}
		this.#lastDeniedTool = decision.toolName;
		return { outcome: { outcome: "selected", optionId: decision.denyOptionId } };
	}

	buildListener(): AcpSessionListener {
		return {
			bridgedToolNames: this.bridge.toolNames,
			onDelta: (delta, isThought) => this.turn.pushDelta(delta, isThought),
			onPermissionRequest: (req) => this.handlePermissionRequest(req),
			onExit: (reason) => {
				if (!this.closed) {
					this.turn.fail(reason, "error");
					void this.kill();
				}
			},
		};
	}

	readonly onAbort = (): void => {
		cancelPendingAcpPermissionsForChat(this.chatSessionId);
		this.turn.fail(AntigravityError.Aborted, "aborted");
		if (this.acpSessionId && this.promptInFlight) {
			this.client.cancel(this.acpSessionId);
		}
		void this.kill();
	};

	setSignal(signal: AbortSignal | undefined): void {
		this.#signal?.removeEventListener("abort", this.onAbort);
		this.#signal = signal;
		signal?.addEventListener("abort", this.onAbort, { once: true });
		if (signal?.aborted) this.onAbort();
	}

	scheduleFlush(): void {
		if (this.closed || this.turn.finished) return;
		clearTimeout(this.#flushTimer);
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = undefined;
			this.flushAdmissions();
		}, BATCH_FLUSH_DELAY_MS);
		this.#flushTimer.unref?.();
	}

	flushAdmissions(): void {
		if (this.closed || this.turn.finished) return;
		const nextCalls = this.bridge.getPendingToolCalls().filter((call) => !this.#admittedIds.has(call.id));
		if (nextCalls.length === 0) return;

		for (const call of nextCalls) this.#admittedIds.add(call.id);
		this.#admitted = nextCalls;
		this.toolCallIds = nextCalls.map((call) => call.id);
		this.turn.admit(nextCalls);
		this.conversation.push(...structuredClone(conversationForReuse([this.turn.getMessage()])));
		if (this.chatSessionId) {
			this.parkInRegistry();
			this.armIdleTimer();
		} else {
			void this.kill();
		}
	}

	runPrompt(blocks: AcpPromptBlock[]): void {
		const sessionId = this.acpSessionId;
		if (!sessionId || this.closed) return;
		this.clearIdleTimer();
		this.#lastDeniedTool = undefined;
		this.promptInFlight = true;

		this.client.prompt(sessionId, blocks).then(
			(res) => {
				this.promptInFlight = false;
				if (this.closed) return;
				clearTimeout(this.#flushTimer);
				this.#flushTimer = undefined;
				this.flushAdmissions();
				if (!this.turn.finished) {
					this.turn.applyUsage(res.usage);
					if (!this.turn.hasVisibleContent()) {
						const stderrTail = this.client.getRecentStderr?.();
						const denied = this.#lastDeniedTool;
						const reason = denied
							? `Native ACP tool "${denied}" was denied, causing Antigravity to stop without output. Allow it when prompted or instruct the model to use LearnHarness tools.`
							: `Antigravity ACP ended the turn without output (${res.stopReason})${stderrTail ? `: ${stderrTail}` : ""}.`;
						this.turn.fail(reason, "error");
						void this.kill();
						return;
					}
					this.turn.finish(res.stopReason);
					this.conversation.push(...structuredClone(conversationForReuse([this.turn.getMessage()])));
					if (this.chatSessionId) {
						this.parkInRegistry();
						this.armIdleTimer();
					} else {
						void this.kill();
					}
				} else {
					// Prompt finished without using unresolved parked tool calls; retire cleanly.
					void this.kill();
				}
			},
			(err: unknown) => {
				this.promptInFlight = false;
				if (this.closed) return;
				clearTimeout(this.#flushTimer);
				this.#flushTimer = undefined;
				const msg = err instanceof Error ? err.message : String(err);
				if (this.turn.finished && this.chatSessionId && this.toolCallIds.length > 0) {
					this.#pendingError = msg;
					this.parkInRegistry();
					this.armIdleTimer();
					return;
				}
				const stderrTail = this.client.getRecentStderr?.();
				const fullMsg = stderrTail && !msg.includes(stderrTail) ? `${msg} (${stderrTail})` : msg;
				this.turn.fail(this.#signal?.aborted ? AntigravityError.Aborted : fullMsg, this.#signal?.aborted ? "aborted" : "error");
				void this.kill();
			},
		);
	}

	consumeFailure(owner: symbol, turn: AntigravityTurn): boolean {
		if (owner !== this.owner || !this.#pendingError) return false;
		const message = this.#pendingError;
		this.#pendingError = undefined;
		turn.fail(message, "error");
		void this.kill();
		return true;
	}

	canContinueToolResults(
		owner: symbol,
		sessionId: string | undefined,
		configuration: unknown,
		conversation: unknown[],
		results: ToolResultMessage[],
	): boolean {
		return !this.closed
			&& this.promptInFlight
			&& owner === this.owner
			&& !!sessionId
			&& sessionId === this.chatSessionId
			&& this.#admitted.length > 0
			&& isDeepStrictEqual(configuration, this.configuration)
			&& isDeepStrictEqual(conversation.slice(0, this.conversation.length), this.conversation)
			&& conversation.length === this.conversation.length + this.#admitted.length
			&& results.length === this.#admitted.length
			&& new Set(results.map((r) => r.toolCallId)).size === results.length
			&& this.#admitted.every((call) => results.some((r) => r.toolCallId === call.id && r.toolName === call.name));
	}

	continueToolResults(turn: AntigravityTurn, messages: Message[], results: ToolResultMessage[], signal: AbortSignal | undefined): void {
		this.clearIdleTimer();
		const admitted = this.#admitted;
		this.#admitted = [];
		this.toolCallIds = [];
		this.conversation = structuredClone(conversationForReuse(messages));
		this.turn = turn;
		if (this.acpSessionId) {
			this.client.updateListener(this.acpSessionId, this.buildListener());
		}
		this.setSignal(signal);
		if (this.closed) return;
		for (const call of admitted) {
			const result = results.find((r) => r.toolCallId === call.id)!;
			this.bridge.resolveToolCall(call, result);
		}
		this.scheduleFlush();
	}

	canContinueUserTurn(
		owner: symbol,
		sessionId: string | undefined,
		configuration: unknown,
		conversation: unknown[],
		messages: Message[],
	): Message[] | null {
		if (
			this.closed
			|| this.promptInFlight
			|| !this.acpSessionId
			|| owner !== this.owner
			|| !sessionId
			|| sessionId !== this.chatSessionId
			|| this.#admitted.length > 0
		) {
			return null;
		}
		if (!isDeepStrictEqual(configuration, this.configuration)) return null;
		if (conversation.length <= this.conversation.length) return null;
		if (!isDeepStrictEqual(conversation.slice(0, this.conversation.length), this.conversation)) return null;

		const nonSystem = messages.filter((m) => m.role !== "system");
		const delta = nonSystem.slice(this.conversation.length);
		if (delta.length === 0 || !delta.every((m) => m.role === "user")) return null;
		return delta;
	}

	continueUserTurn(turn: AntigravityTurn, messages: Message[], deltaUsers: Message[], signal: AbortSignal | undefined): void {
		this.clearIdleTimer();
		this.turn = turn;
		this.conversation = structuredClone(conversationForReuse(messages));
		if (this.acpSessionId) {
			this.client.updateListener(this.acpSessionId, this.buildListener());
		}
		this.setSignal(signal);
		if (this.closed) return;
		const deltaBlocks: AcpPromptBlock[] = [];
		for (const msg of deltaUsers) {
			if (typeof msg.content === "string") {
				if (msg.content) deltaBlocks.push({ type: "text", text: msg.content });
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text" && block.text) deltaBlocks.push({ type: "text", text: block.text });
					else if (block.type === "image") deltaBlocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
				}
			}
		}
		this.runPrompt(deltaBlocks.length > 0 ? deltaBlocks : [{ type: "text", text: "Continue." }]);
	}

	async kill(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.registry.delete(this);
		this.clearIdleTimer();
		clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		this.#signal?.removeEventListener("abort", this.onAbort);
		cancelPendingAcpPermissionsForChat(this.chatSessionId);
		const sid = this.acpSessionId;
		this.acpSessionId = undefined;
		await Promise.allSettled([
			this.bridge.close(),
			...(sid ? [this.client.closeSession(sid)] : []),
			...(this.ownsClient && this.client.stop ? [this.client.stop()] : []),
		]);
	}
}

function tryWarmContinuation(
	registry: Set<LiveAcpSession>,
	turn: AntigravityTurn,
	owner: symbol,
	sessionId: string | undefined,
	configuration: unknown,
	messages: Message[],
	signal: AbortSignal | undefined,
): boolean {
	if (!sessionId) return false;
	const conversation = conversationForReuse(messages);

	// 1. Check warm tool-result continuation first
	const assistantIndex = messages.findLastIndex((m) => m.role === "assistant");
	const assistant = assistantIndex >= 0 ? messages[assistantIndex] : undefined;
	if (assistant?.role === "assistant") {
		const trailing = messages.slice(assistantIndex + 1);
		const results = trailing.filter((m): m is ToolResultMessage => m.role === "toolResult");
		if (trailing.length === results.length && results.length > 0) {
			const callIds = assistant.content.flatMap((b) => (b.type === "toolCall" ? [b.id] : []));
			for (const session of registry) {
				if (session.owner !== owner || session.chatSessionId !== sessionId) continue;
				if (session.toolCallIds.length === callIds.length && callIds.every((id) => session.toolCallIds.includes(id))) {
					if (session.consumeFailure(owner, turn)) return true;
					if (session.canContinueToolResults(owner, sessionId, configuration, conversation, results)) {
						session.continueToolResults(turn, messages, results, signal);
						return true;
					}
					void session.kill();
					return false;
				}
			}
		}
	}

	// 2. Check warm user-turn continuation after end_turn
	for (const session of registry) {
		if (session.owner !== owner || session.chatSessionId !== sessionId) continue;
		const deltaUsers = session.canContinueUserTurn(owner, sessionId, configuration, conversation, messages);
		if (deltaUsers) {
			session.continueUserTurn(turn, messages, deltaUsers, signal);
			return true;
		}
	}

	return false;
}

function retireOtherSessionsForChat(registry: Set<LiveAcpSession>, owner: symbol, chatSessionId: string | undefined): void {
	if (!chatSessionId) return;
	for (const session of [...registry]) {
		if (session.owner === owner && session.chatSessionId === chatSessionId) {
			void session.kill();
		}
	}
}

async function startFreshAcpTurn(
	client: AcpClient,
	ownsClient: boolean,
	createBridge: typeof createAntigravityToolBridge,
	getPermissionMode: () => AntigravityPermissionMode,
	registry: Set<LiveAcpSession>,
	idleTimeoutMs: number,
	turn: AntigravityTurn,
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	owner: symbol,
	configuration: unknown,
): Promise<void> {
	if (options?.signal?.aborted) {
		if (ownsClient) await client.stop?.();
		turn.fail(AntigravityError.Aborted, "aborted");
		return;
	}

	retireOtherSessionsForChat(registry, owner, options?.sessionId);

	const input = toAntigravityInput(context.messages);
	let session: LiveAcpSession | undefined;
	const bridge = await createBridge(input.tools, {
		onCall: () => session?.scheduleFlush(),
		onError: (err) => {
			if (session && !session.turn.finished) {
				session.turn.fail(err.message, "error");
				void session.kill();
			}
		},
	});

	if (options?.signal?.aborted) {
		await bridge.close();
		if (ownsClient) await client.stop?.();
		turn.fail(AntigravityError.Aborted, "aborted");
		return;
	}

	session = new LiveAcpSession(
		client,
		ownsClient,
		bridge,
		turn,
		owner,
		options?.sessionId,
		configuration,
		structuredClone(conversationForReuse(context.messages)),
		registry,
		idleTimeoutMs,
		getPermissionMode,
	);
	session.setSignal(options?.signal);

	try {
		const { sessionId } = await client.newSession({
			systemPrompt: appendAcpToolOrientation(input.systemPrompt, input.tools),
			mcpServers: [bridge.mcpServer],
			listener: session.buildListener(),
		});

		if (options?.signal?.aborted || session.closed) {
			await bridge.close();
			await client.closeSession(sessionId).catch(() => {});
			if (ownsClient) await client.stop?.();
			if (!turn.finished) turn.fail(AntigravityError.Aborted, "aborted");
			return;
		}

		session.acpSessionId = sessionId;
		const thoughtLevel = toAcpThoughtLevel(model, options?.reasoning);
		await client.setConfig(sessionId, model.id, thoughtLevel);

		if (options?.signal?.aborted || session.closed) {
			await session.kill();
			if (!turn.finished) turn.fail(AntigravityError.Aborted, "aborted");
			return;
		}

		session.runPrompt(input.promptBlocks);
	} catch (error) {
		await session.kill();
		const stderrTail = client.getRecentStderr?.();
		const baseMsg = error instanceof Error ? error.message : String(error);
		const msg = stderrTail && !baseMsg.includes(stderrTail) ? `${baseMsg} (${stderrTail})` : baseMsg;
		turn.fail(options?.signal?.aborted ? AntigravityError.Aborted : msg, options?.signal?.aborted ? "aborted" : "error");
	}
}

let sharedConnection: AcpConnection | undefined;

export function getSharedAntigravityConnection(): AcpConnection {
	if (!sharedConnection) {
		sharedConnection = new AcpConnection();
	}
	return sharedConnection;
}

export function createAntigravityStreamFunction(deps: AntigravityStreamDeps = {}): StreamFunction<Api, SimpleStreamOptions> {
	const owner = Symbol("antigravity acp stream owner");
	const registry = new Set<LiveAcpSession>();
	const ownsClient = !deps.getConnection;
	const createClient = deps.getConnection ?? deps.createConnection ?? (() => new AcpConnection());
	const createBridge = deps.createBridge ?? createAntigravityToolBridge;
	const getPermissionMode = deps.getPermissionMode ?? configuredAntigravityPermissionMode;
	const idleTimeoutMs = deps.idleTimeoutMs ?? ANTIGRAVITY_IDLE_TIMEOUT_MS;

	return (model, context, options) => {
		const stream = createAssistantMessageEventStream();
		const turn = new AntigravityTurn(stream, model);
		const thoughtLevel = toAcpThoughtLevel(model, options?.reasoning);
		const configuration = configurationForReuse(model, context, thoughtLevel);

		if (tryWarmContinuation(registry, turn, owner, options?.sessionId, configuration, context.messages, options?.signal)) {
			return stream;
		}

		const client = createClient();
		void startFreshAcpTurn(
			client,
			ownsClient,
			createBridge,
			getPermissionMode,
			registry,
			idleTimeoutMs,
			turn,
			model,
			context,
			options,
			owner,
			configuration,
		).catch((error: unknown) => {
			const msg = error instanceof Error ? error.message : String(error);
			turn.fail(options?.signal?.aborted ? AntigravityError.Aborted : msg, options?.signal?.aborted ? "aborted" : "error");
		});

		return stream;
	};
}

export const streamAntigravity = createAntigravityStreamFunction();
