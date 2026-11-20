import crypto from "node:crypto";
import { emit } from "../../core/events.ts";
import type {
	AntigravityPermissionDecisionAction,
	AntigravityPermissionPrompt,
} from "../../core/contracts/antigravity.ts";

interface PendingEntry {
	prompt: AntigravityPermissionPrompt;
	resolve: (decision: AntigravityPermissionDecisionAction) => void;
	cleanup?: () => void;
}

interface AcpPermissionBrokerState {
	pending: Map<string, PendingEntry>;
	sessionAllowed: Map<string, Set<string>>;
}

interface LhBrokerGlobal {
	__lhAcpPermissionBroker?: AcpPermissionBrokerState;
}

function broker(): AcpPermissionBrokerState {
	const g = globalThis as typeof globalThis & LhBrokerGlobal;
	return (g.__lhAcpPermissionBroker ??= {
		pending: new Map(),
		sessionAllowed: new Map(),
	});
}

/** Suspends an ACP native tool permission request until the user responds in chat or the turn aborts. */
export function requestAcpPermissionApproval(opts: {
	chatId: string;
	toolName: string;
	rawToolName: string;
	title?: string;
	argsPreview?: string;
	signal?: AbortSignal;
}): Promise<AntigravityPermissionDecisionAction> {
	if (opts.signal?.aborted) {
		return Promise.resolve("deny");
	}
	const state = broker();
	const id = crypto.randomUUID();
	const prompt: AntigravityPermissionPrompt = {
		id,
		chatId: opts.chatId,
		toolName: opts.toolName,
		rawToolName: opts.rawToolName,
		...(opts.title ? { title: opts.title } : {}),
		...(opts.argsPreview ? { argsPreview: opts.argsPreview } : {}),
		createdAt: Date.now(),
	};

	return new Promise<AntigravityPermissionDecisionAction>((resolve) => {
		let settled = false;
		const finish = (decision: AntigravityPermissionDecisionAction, cleanupSignal = true) => {
			if (settled) return;
			settled = true;
			state.pending.delete(id);
			if (cleanupSignal) entry.cleanup?.();
			emit("acp-permission-changed", { chatId: opts.chatId });
			resolve(decision);
		};

		const onAbort = () => finish("deny", false);
		const entry: PendingEntry = {
			prompt,
			resolve: (decision) => finish(decision),
			cleanup: () => opts.signal?.removeEventListener("abort", onAbort),
		};

		state.pending.set(id, entry);
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		emit("acp-permission-changed", { chatId: opts.chatId });
	});
}

/** Pending interactive ACP permission prompts for one chat, oldest first. */
export function listPendingAcpPermissions(chatId: string): AntigravityPermissionPrompt[] {
	if (!chatId) return [];
	const items: AntigravityPermissionPrompt[] = [];
	for (const entry of broker().pending.values()) {
		if (entry.prompt.chatId === chatId) items.push(entry.prompt);
	}
	items.sort((a, b) => a.createdAt - b.createdAt);
	return items;
}

/** Resolves a pending ACP permission prompt from the UI and optionally records session-wide approval. */
export function resolveAcpPermission(id: string, decision: AntigravityPermissionDecisionAction): boolean {
	const state = broker();
	const entry = state.pending.get(id);
	if (!entry) return false;
	if (decision === "allow_session" && entry.prompt.chatId) {
		let allowed = state.sessionAllowed.get(entry.prompt.chatId);
		if (!allowed) {
			allowed = new Set();
			state.sessionAllowed.set(entry.prompt.chatId, allowed);
		}
		if (entry.prompt.toolName) allowed.add(entry.prompt.toolName);
		if (entry.prompt.rawToolName) allowed.add(entry.prompt.rawToolName);
	}
	entry.resolve(decision);
	return true;
}

/** Whether the user previously approved this native tool for the current chat session. */
export function isAcpToolAllowedForChat(chatId: string | undefined, ...names: string[]): boolean {
	if (!chatId) return false;
	const allowed = broker().sessionAllowed.get(chatId);
	if (!allowed || allowed.size === 0) return false;
	return names.some((n) => Boolean(n) && allowed.has(n));
}

/** Denies and removes any queued interactive permission prompts belonging to a closed/aborted chat turn. */
export function cancelPendingAcpPermissionsForChat(chatId: string | undefined): void {
	if (!chatId) return;
	const entries = [...broker().pending.values()].filter((e) => e.prompt.chatId === chatId);
	for (const entry of entries) {
		entry.resolve("deny");
	}
}

/** Clears test or ended session permission grants. */
export function resetAcpPermissionBrokerForTests(): void {
	const state = broker();
	for (const entry of [...state.pending.values()]) {
		entry.resolve("deny");
	}
	state.pending.clear();
	state.sessionAllowed.clear();
}
