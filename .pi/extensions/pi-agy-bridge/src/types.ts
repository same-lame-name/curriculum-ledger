// Types for the lean Pi Antigravity ACP bridge.

export interface AgyUsage {
	inputTokens: number;
	outputTokens: number;
	cachedReadTokens: number;
	cachedWriteTokens: number;
	thoughtTokens: number;
	totalTokens: number;
}

export interface AcpPermissionOption {
	optionId?: string;
	kind?: string;
	name?: string;
}

export interface AcpPermissionRequest {
	sessionId?: string;
	toolCall?: {
		toolCallId?: string;
		name?: string;
		kind?: string;
		title?: string;
		rawInput?: Record<string, unknown>;
		args?: Record<string, unknown>;
	};
	options: AcpPermissionOption[];
}

export interface AcpPermissionOutcome {
	outcome: {
		outcome: "selected" | "cancelled";
		optionId?: string;
	};
}

export interface BridgeContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface BridgeCallResult {
	content: BridgeContentBlock[];
	isError: boolean;
}

export interface PollView {
	state: "running" | "done" | "failed";
	name: string;
	text?: string;
	isError?: boolean;
	reason?: string;
	images?: Array<{ data: string; mimeType: string }>;
	delivered?: boolean;
	conversationId?: string;
}

export interface BridgeToolInfo {
	name: string;
	description?: string;
	parameters?: object;
	sourceInfo?: { source?: string };
}

export interface AgyModelDefinition {
	id: string;
	name: string;
	description?: string;
	effort?: "low" | "medium" | "high";
}
