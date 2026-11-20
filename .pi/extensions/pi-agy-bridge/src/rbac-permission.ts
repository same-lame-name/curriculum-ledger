// RBAC permission evaluator for Antigravity ACP session/request_permission requests.

import type { AcpPermissionRequest, AcpPermissionOutcome } from "./types.ts";

export type CommandValidator = (command: string) => { allow: boolean; reason?: string };
export type PermissionValidator = (
	toolName: string,
	input: Record<string, unknown>,
) => { allowed: boolean; reason?: string };

export function mapAcpToolCallToPi(toolCall: {
	name?: string;
	args?: Record<string, unknown>;
	rawInput?: Record<string, unknown>;
	title?: string;
}): { toolName: string; input: Record<string, unknown> } | null {
	const name = toolCall.name ?? "";
	const a = (toolCall.rawInput ?? toolCall.args ?? {}) as Record<string, unknown>;
	const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

	// 1. Shell execution: AGY run_command -> Pi bash
	if (name === "run_command" || name === "bash") {
		const command = str(a.CommandLine || a.command || a.cmd || toolCall.title || "");
		return { toolName: "bash", input: { command } };
	}

	// 2. File creation / overwrite: AGY write_file / write_to_file / create_file -> Pi write
	if (name === "write_file" || name === "write_to_file" || name === "create_file" || name === "write") {
		const path = str(a.Path || a.TargetFile || a.path || a.FilePath || a.file_path || a.target_file || "");
		const content = str(a.Content || a.content || a.CodeContent || a.code_content || "");
		return { toolName: "write", input: { path, content } };
	}

	// 3. File modifications: AGY edit_file / replace_file_content / multi_replace_file_content -> Pi edit
	if (
		name === "edit_file" ||
		name === "replace_file_content" ||
		name === "multi_replace_file_content" ||
		name === "edit"
	) {
		const path = str(a.Path || a.TargetFile || a.path || a.FilePath || a.file_path || a.target_file || "");
		const edits = Array.isArray(a.ReplacementChunks)
			? a.ReplacementChunks.map((c: any) => ({
					oldText: str(c?.SearchText ?? c?.oldText ?? c?.Target ?? c?.target),
					newText: str(c?.ReplacementContent ?? c?.newText ?? c?.Replacement ?? c?.replacement),
				}))
			: Array.isArray(a.edits)
				? a.edits
				: [{
						oldText: str(a.Target ?? a.target ?? a.SearchText ?? a.oldText ?? ""),
						newText: str(a.Replacement ?? a.replacement ?? a.ReplacementContent ?? a.newText ?? ""),
					}];
		return { toolName: "edit", input: { path, edits } };
	}

	// 4. File reading: AGY read_file / view_file -> Pi read
	if (name === "read_file" || name === "view_file" || name === "read") {
		const path = str(a.Path || a.TargetFile || a.path || a.FilePath || a.file_path || a.target_file || "");
		return { toolName: "read", input: { path } };
	}

	// 5. Directory listing: AGY list_dir -> Pi ls
	if (name === "list_dir" || name === "ls") {
		const path = str(a.DirectoryPath || a.path || a.Path || a.directory || "");
		return { toolName: "ls", input: { path } };
	}

	// 6. Text grep: AGY grep_search -> Pi grep
	if (name === "grep_search" || name === "grep") {
		const path = str(a.SearchPath || a.path || a.Path || "");
		const pattern = str(a.Query || a.query || a.Pattern || a.pattern || "");
		return { toolName: "grep", input: { path, pattern } };
	}

	// 7. File finder: AGY find_by_name -> Pi find
	if (name === "find_by_name" || name === "find") {
		const path = str(a.SearchDirectory || a.path || a.Path || a.directory || "");
		const pattern = str(a.Pattern || a.pattern || a.name || a.glob || "");
		return { toolName: "find", input: { path, pattern } };
	}

	// 8. Domain tools (e.g. catalog, ladder, arena_ledger) pass through directly
	if (name) {
		return { toolName: name, input: a };
	}

	return null;
}

export type DenialHandler = (toolName: string, reason: string) => void;
export type BlockSource = "rbac" | "notebook" | "validator";

export interface PermissionBlockInfo {
	source: BlockSource;
	toolName: string;
	mappedTool: string;
	target: string;
	reason: string;
}

export type BlockedPermissionResolver = (
	block: PermissionBlockInfo,
) => Promise<"allow" | "deny"> | "allow" | "deny";

function summarizeTarget(
	mappedTool: string,
	input: Record<string, unknown>,
	fallbackTitle?: string,
): string {
	if (mappedTool === "bash" && typeof input.command === "string") {
		return input.command.trim().replace(/\s+/g, " ").slice(0, 140);
	}
	if (typeof input.path === "string" && input.path.trim()) {
		return input.path.trim();
	}
	if (typeof input.action === "string" && input.action.trim()) {
		return input.action.trim();
	}
	return (fallbackTitle || "").trim();
}

export class RbacPermissionHandler {
	#permissionValidator?: PermissionValidator;
	#commandValidator?: CommandValidator;
	#onDeny?: DenialHandler;
	#blockedResolver?: BlockedPermissionResolver;

	constructor(validator?: PermissionValidator | CommandValidator, onDeny?: DenialHandler) {
		if (typeof validator === "function") {
			this.setValidator(validator);
		}
		this.#onDeny = onDeny;
	}

	setOnDeny(onDeny?: DenialHandler): void {
		this.#onDeny = onDeny;
	}

	setBlockedResolver(resolver?: BlockedPermissionResolver): void {
		this.#blockedResolver = resolver;
	}

	setValidator(validator: PermissionValidator | CommandValidator): void {
		if (validator.length === 1) {
			this.#commandValidator = validator as CommandValidator;
		} else {
			this.#permissionValidator = validator as PermissionValidator;
		}
	}

	#evaluateBlock(req: AcpPermissionRequest, cwd?: string): PermissionBlockInfo | null {
		const toolCall = req.toolCall;
		if (!toolCall) return null;

		const mapped = mapAcpToolCallToPi(toolCall);
		if (!mapped) return null;

		const toolIdentifier = toolCall.name || mapped.toolName;
		const target = summarizeTarget(mapped.toolName, mapped.input, toolCall.title);

		// 1. Custom command validator backward compatibility
		if (mapped.toolName === "bash" && this.#commandValidator) {
			const cmd = typeof mapped.input.command === "string" ? mapped.input.command : "";
			const check = this.#commandValidator(cmd);
			if (!check.allow) {
				return {
					source: "validator",
					toolName: toolIdentifier,
					mappedTool: mapped.toolName,
					target,
					reason: check.reason ?? "Command denied by security validator",
				};
			}
		}

		// 2. Custom permission validator
		if (this.#permissionValidator) {
			const check = this.#permissionValidator(mapped.toolName, mapped.input);
			if (!check.allowed) {
				return {
					source: "validator",
					toolName: toolIdentifier,
					mappedTool: mapped.toolName,
					target,
					reason: check.reason ?? "Permission denied",
				};
			}
		}

		// 3. Authoritative Pi RBAC check (strictly actor/path/tool permissions)
		const rbacApi = (globalThis as any).__piRbac;
		if (typeof rbacApi?.checkPermission === "function") {
			const decision = rbacApi.checkPermission(mapped.toolName, mapped.input, cwd);
			if (!decision.allowed) {
				return {
					source: "rbac",
					toolName: toolIdentifier,
					mappedTool: mapped.toolName,
					target,
					reason: decision.reason ?? "Access denied by RBAC policy",
				};
			}
		}

		// 4. Separate Teacher Notebook Budget guard (owned by teacher.ts, not RBAC)
		if (mapped.toolName === "write" || mapped.toolName === "edit") {
			const teacherApi = (globalThis as any).__piTeacher;
			const guardReason =
				typeof teacherApi?.checkNotebookGuard === "function"
					? teacherApi.checkNotebookGuard({
							toolName: mapped.toolName,
							input: mapped.input,
							cwd: cwd || process.cwd(),
						})
					: null;
			if (guardReason) {
				return {
					source: "notebook",
					toolName: toolIdentifier,
					mappedTool: mapped.toolName,
					target,
					reason: guardReason,
				};
			}
		}

		return null;
	}

	#optionIds(req: AcpPermissionRequest): { allowId: string; denyId: string } {
		const options = req.options || [];
		const allowOpt = options.find((o) => String(o.kind || "").startsWith("allow") || o.optionId === "allow");
		const denyOpt = options.find((o) => String(o.kind || "").startsWith("reject") || o.optionId === "deny");
		return {
			allowId: allowOpt?.optionId ?? options[0]?.optionId ?? "allow",
			denyId: denyOpt?.optionId ?? "deny",
		};
	}

	handle(req: AcpPermissionRequest, cwd?: string): AcpPermissionOutcome {
		const { allowId, denyId } = this.#optionIds(req);
		const block = this.#evaluateBlock(req, cwd);
		if (block) {
			this.#onDeny?.(block.toolName, block.reason);
			return { outcome: { outcome: "selected", optionId: denyId } };
		}
		return { outcome: { outcome: "selected", optionId: allowId } };
	}

	async handleAsync(req: AcpPermissionRequest, cwd?: string): Promise<AcpPermissionOutcome> {
		const { allowId, denyId } = this.#optionIds(req);
		const block = this.#evaluateBlock(req, cwd);
		if (!block) {
			return { outcome: { outcome: "selected", optionId: allowId } };
		}
		if (this.#blockedResolver) {
			const decision = await this.#blockedResolver(block);
			if (decision === "allow") {
				return { outcome: { outcome: "selected", optionId: allowId } };
			}
		}
		this.#onDeny?.(block.toolName, block.reason);
		return { outcome: { outcome: "selected", optionId: denyId } };
	}
}
