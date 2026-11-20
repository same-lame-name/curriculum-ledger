export const ANTIGRAVITY_PROVIDER = "antigravity";
export const ANTIGRAVITY_API = "antigravity-acp";

/** Permission handling policy for Antigravity ACP native tool requests. */
export const ANTIGRAVITY_PERMISSION_MODES = ["safe_prompt", "prompt_native", "turbo"] as const;
export type AntigravityPermissionMode = (typeof ANTIGRAVITY_PERMISSION_MODES)[number];
export const DEFAULT_ANTIGRAVITY_PERMISSION_MODE: AntigravityPermissionMode = "safe_prompt";

export type AntigravityPermissionDecisionAction = "allow_once" | "allow_session" | "deny";

export interface AntigravityPermissionPrompt {
	id: string;
	chatId: string;
	toolName: string;
	rawToolName: string;
	title?: string;
	argsPreview?: string;
	createdAt: number;
}

/** Installation, server handshake, and live discovered catalog summary. */
export interface AntigravityStatus {
	state: "not-found" | "ready" | "error";
	version: string | null;
	binaryPath: string | null;
	tier: string | null;
	modelCount: number;
	error?: string;
}
