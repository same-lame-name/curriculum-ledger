import {
	DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
	type AntigravityPermissionMode,
} from "../../core/contracts/antigravity.ts";
import { resolveSourcePath } from "../tools/fs-shared.ts";

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
		locations?: Array<{ path?: string }>;
	};
	options?: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
	outcome: {
		outcome: "selected" | "cancelled";
		optionId?: string;
	};
}

export type AcpPermissionAction = "allow" | "prompt" | "deny";

export interface EvaluateAcpPermissionOptions {
	mode?: AntigravityPermissionMode;
	sessionAllowed?: ReadonlySet<string>;
}

export interface AcpPermissionDecision {
	action: AcpPermissionAction;
	response: AcpPermissionResponse;
	allowed: boolean;
	toolName: string;
	rawToolName: string;
	allowOptionId: string;
	denyOptionId: string;
	reason?: string;
}

const MCP_LEARNHARNESS_RE = /^mcp__?learnharness(?:_[0-9a-f]{6,16})?__?(.+)$/i;
const MCP_PREFIX_RE = /^mcp__?[^_]+__?(.+)$/;

/** Read-only native IDE tools safe to auto-approve in `safe_prompt` mode once path checks pass. */
export const SAFE_READ_NATIVE_TOOLS = new Set([
	"read_file",
	"view_file",
	"view_file_outline",
	"view_code_item",
	"list_dir",
	"find_by_name",
	"grep_search",
]);

const NATIVE_PATH_KEYS = [
	"AbsolutePath",
	"absolutePath",
	"DirectoryPath",
	"directoryPath",
	"SearchPath",
	"searchPath",
	"SearchDirectory",
	"searchDirectory",
	"TargetFile",
	"targetFile",
	"File",
	"file",
	"path",
	"file_path",
	"dir_path",
	"directory",
] as const;

let currentPermissionMode: () => AntigravityPermissionMode = () => DEFAULT_ANTIGRAVITY_PERMISSION_MODE;

export function setAntigravityPermissionModeProvider(provider: () => AntigravityPermissionMode): void {
	currentPermissionMode = provider;
}

export function configuredAntigravityPermissionMode(): AntigravityPermissionMode {
	try {
		return currentPermissionMode();
	} catch {
		return DEFAULT_ANTIGRAVITY_PERMISSION_MODE;
	}
}

export function normalizeAcpToolName(name: string): string {
	const lhMatch = MCP_LEARNHARNESS_RE.exec(name);
	if (lhMatch?.[1]) return lhMatch[1];
	const match = MCP_PREFIX_RE.exec(name);
	return match?.[1] ?? name;
}

export function isLearnharnessMcpToolName(name: string): boolean {
	return MCP_LEARNHARNESS_RE.test(name);
}

export function selectPermissionOptionIds(options: readonly AcpPermissionOption[] = []): { allowId: string; denyId: string } {
	const allowOpt = options.find((o) => String(o.kind || "").startsWith("allow") || o.optionId === "allow");
	const denyOpt = options.find((o) => String(o.kind || "").startsWith("reject") || o.optionId === "deny");
	return {
		allowId: allowOpt?.optionId ?? options[0]?.optionId ?? "allow",
		denyId: denyOpt?.optionId ?? "deny",
	};
}

function nativeToolArgsRecord(req: AcpPermissionRequest): Record<string, unknown> | undefined {
	const raw = req.toolCall?.rawInput ?? req.toolCall?.args;
	return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : undefined;
}

export function extractNativeCandidatePaths(req: AcpPermissionRequest): string[] {
	const found = new Set<string>();
	const args = nativeToolArgsRecord(req);
	if (args) {
		for (const key of NATIVE_PATH_KEYS) {
			const val = args[key];
			if (typeof val === "string" && val.trim()) {
				found.add(val.trim());
			}
		}
	}
	if (Array.isArray(req.toolCall?.locations)) {
		for (const loc of req.toolCall.locations) {
			if (typeof loc?.path === "string" && loc.path.trim()) {
				found.add(loc.path.trim());
			}
		}
	}
	return [...found];
}

export function isSafeReadNativeToolCall(toolName: string, req: AcpPermissionRequest): boolean {
	if (!SAFE_READ_NATIVE_TOOLS.has(toolName)) return false;
	const paths = extractNativeCandidatePaths(req);
	if (paths.length === 0) return false;
	try {
		for (const p of paths) {
			resolveSourcePath(p);
		}
		return true;
	} catch {
		return false;
	}
}

export function formatAcpPermissionPreview(req: AcpPermissionRequest): string | undefined {
	const args = nativeToolArgsRecord(req);
	if (args) {
		const primaryKeys = [
			"CommandLine",
			"command",
			"AbsolutePath",
			"TargetFile",
			"DirectoryPath",
			"SearchPath",
			"SearchDirectory",
			"path",
			"file_path",
		];
		for (const k of primaryKeys) {
			const val = args[k];
			if (typeof val === "string" && val.trim()) {
				const trimmed = val.trim();
				return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
			}
		}
		try {
			const compact = JSON.stringify(args);
			if (compact && compact !== "{}") {
				return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
			}
		} catch {
			// ignore unserializable args
		}
	}
	const loc = req.toolCall?.locations?.[0]?.path;
	if (typeof loc === "string" && loc.trim()) return loc.trim();
	return undefined;
}

/**
 * 3-tier Antigravity ACP permission policy:
 * 1) LearnHarness bridged MCP tools (including `mcp_learnharness_<hex>_<tool>`) -> always allow.
 * 2) Explicitly session-approved native tools OR `turbo` mode -> allow; `safe_prompt` mode -> allow validated read-only native tools.
 * 3) Shell, write, sensitive-path, or unverified native tools -> interactive UI prompt (fallback deny if headless).
 */
export function evaluateAcpPermission(
	req: AcpPermissionRequest,
	bridgedToolNames: ReadonlySet<string>,
	options: EvaluateAcpPermissionOptions = {},
): AcpPermissionDecision {
	const { allowId, denyId } = selectPermissionOptionIds(req.options);
	const rawName = (req.toolCall?.name ?? "").trim();
	const normalized = normalizeAcpToolName(rawName);
	const displayTool = normalized || rawName || "unknown";
	const allowResponse: AcpPermissionResponse = { outcome: { outcome: "selected", optionId: allowId } };
	const denyResponse: AcpPermissionResponse = { outcome: { outcome: "selected", optionId: denyId } };

	// Tier 1: LearnHarness bridged MCP tools (including disambiguated server hashes).
	const isBridged = Boolean(rawName) && (
		bridgedToolNames.has(rawName)
		|| (normalized !== "" && bridgedToolNames.has(normalized) && isLearnharnessMcpToolName(rawName))
	);
	if (isBridged) {
		return {
			action: "allow",
			response: allowResponse,
			allowed: true,
			toolName: displayTool,
			rawToolName: rawName,
			allowOptionId: allowId,
			denyOptionId: denyId,
		};
	}

	// Tier 2a: Session-wide explicit user grant.
	if (
		options.sessionAllowed
		&& ((rawName && options.sessionAllowed.has(rawName)) || (normalized && options.sessionAllowed.has(normalized)))
	) {
		return {
			action: "allow",
			response: allowResponse,
			allowed: true,
			toolName: displayTool,
			rawToolName: rawName,
			allowOptionId: allowId,
			denyOptionId: denyId,
		};
	}

	const mode = options.mode ?? DEFAULT_ANTIGRAVITY_PERMISSION_MODE;

	// Tier 2b: Turbo mode skips prompts.
	if (mode === "turbo") {
		return {
			action: "allow",
			response: allowResponse,
			allowed: true,
			toolName: displayTool,
			rawToolName: rawName,
			allowOptionId: allowId,
			denyOptionId: denyId,
		};
	}

	// Tier 2c: Safe + Prompt auto-allows safe read-only native tools verified through resolveSourcePath.
	if (mode === "safe_prompt" && isSafeReadNativeToolCall(displayTool, req)) {
		return {
			action: "allow",
			response: allowResponse,
			allowed: true,
			toolName: displayTool,
			rawToolName: rawName,
			allowOptionId: allowId,
			denyOptionId: denyId,
		};
	}

	// Tier 3: Interactive prompt (with safe non-cancelled deny fallback if caller is synchronous).
	return {
		action: "prompt",
		response: denyResponse,
		allowed: false,
		toolName: displayTool,
		rawToolName: rawName,
		allowOptionId: allowId,
		denyOptionId: denyId,
		reason: "Native ACP shell/write/sensitive tools require approval in Safe/Prompt mode or use LearnHarness bridged tools.",
	};
}
