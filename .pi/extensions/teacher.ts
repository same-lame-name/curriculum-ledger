/**
 * teacher — keeps the teacher's voice steady and validates course.md content.
 *
 * 1. Voice anchor. Once a teaching sitting has started — the teach skill was
 *    invoked, or /course linked a course log — every turn's system prompt gets
 *    the skill's voice block: the text between `<!-- voice:start -->` and
 *    `<!-- voice:end -->` in .pi/skills/teach/SKILL.md (or themecp/SKILL.md).
 *    A skill arrives as a message, which compaction can summarise away in a long
 *    sitting; the system prompt is rebuilt on every request, so the voice
 *    survives. Subagents never start a sitting, so their prompts are untouched.
 *    The skill file stays the single source: the block is read on each turn.
 *
 * 2. Notebook content & budget guard (`notebookBudget`). Enforces template
 *    headings, flat structure, and section character limits on `write` / `edit`
 *    calls targeting `courses/<slug>/course.md` during a sitting (independently
 *    of RBAC).
 *
 * Note: Territory access control (including blocking bash mutations to
 * `course.md`) is handled centrally in `.pi/extensions/rbac.ts`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const SKILL_FILE = path.join(".pi", "skills", "teach", "SKILL.md");
const THEMECP_SKILL_FILE = path.join(".pi", "skills", "themecp", "SKILL.md");
const VOICE_RE = /<!--\s*voice:start\s*-->([\s\S]*?)<!--\s*voice:end\s*-->/;
const SITTING_ENTRY = "teacher-sitting";

// course.md section budgets, in characters (heading line excluded). The set of
// names is the template in SKILL.md; anything else is refused.
const SECTION_BUDGETS: Record<string, number> = {
	"Where the student stands": 2600,
	Plan: 6000,
	"On the board": 1400,
	Practice: 600,
	Agreements: 700,
	"For learner.md": 500,
	Parked: 700,
	"Session log": 3000,
};
const HEADER_BUDGET = 600; // title, state, source, goal

function findVaultRoot(startDir: string): string {
	let cur = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(cur, ".pi")) || fs.existsSync(path.join(cur, "courses"))) return cur;
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return path.resolve(startDir);
}

function readVoice(cwd: string, skill: "teach" | "themecp" = "teach"): string | null {
	try {
		const targetFile = skill === "themecp" ? THEMECP_SKILL_FILE : SKILL_FILE;
		const text = fs.readFileSync(path.join(findVaultRoot(cwd), targetFile), "utf-8");
		const m = VOICE_RE.exec(text);
		return m ? m[1].trim() : null;
	} catch {
		return null;
	}
}

function isSubagentProcess(): boolean {
	return Boolean(
		process.env.PI_SUBAGENT_ID ||
		process.env.PI_SUBAGENT_NAME ||
		process.env.PI_SUBAGENT_AGENT ||
		process.env.PI_SUBAGENT_SESSION,
	);
}

/**
 * Apply edit-tool edits the way the tool does: every `oldText` is matched
 * against the original file, and edits are disjoint. Returns undefined when an
 * edit can't be placed, so the tool itself reports the problem.
 */
function applyEdits(original: string, edits: unknown): string | undefined {
	if (!Array.isArray(edits)) return undefined;
	const src = original.replace(/\r\n/g, "\n");
	const spans: Array<{ start: number; end: number; text: string }> = [];
	for (const e of edits as Array<{ oldText?: unknown; newText?: unknown }>) {
		if (typeof e?.oldText !== "string" || typeof e?.newText !== "string") return undefined;
		const oldText = e.oldText.replace(/\r\n/g, "\n");
		const at = src.indexOf(oldText);
		if (at < 0 || src.indexOf(oldText, at + 1) >= 0) return undefined;
		spans.push({ start: at, end: at + oldText.length, text: e.newText.replace(/\r\n/g, "\n") });
	}
	spans.sort((a, b) => a.start - b.start);
	for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) return undefined;
	let out = "";
	let pos = 0;
	for (const s of spans) {
		out += src.slice(pos, s.start) + s.text;
		pos = s.end;
	}
	return out + src.slice(pos);
}

/** Problems with a course.md text, as short phrases; empty when it fits the template. */
export function notebookProblems(text: string): string[] {
	const problems: string[] = [];
	const sizes = new Map<string, number>();
	const seen = new Set<string>();
	let current: string | null = null;
	let header = 0;
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		const h2 = /^##\s+(.+?)\s*$/.exec(line);
		if (h2 && !line.startsWith("###")) {
			const name = h2[1];
			if (!(name in SECTION_BUDGETS)) {
				problems.push(`"## ${name}" is not one of the notebook's sections`);
			} else if (seen.has(name)) {
				problems.push(`"## ${name}" appears twice`);
			}
			seen.add(name);
			current = name;
			continue;
		}
		if (/^#{3,}\s/.test(line)) {
			problems.push(`"${line.trim()}" — sections stay flat, without sub-headings`);
			continue;
		}
		if (current === null) header += line.length + 1;
		else if (current in SECTION_BUDGETS) sizes.set(current, (sizes.get(current) ?? 0) + line.length + 1);
	}
	if (header > HEADER_BUDGET) problems.push(`the header lines run to ${header} characters (budget ${HEADER_BUDGET})`);
	for (const [name, size] of sizes) {
		const budget = SECTION_BUDGETS[name];
		if (size > budget) problems.push(`"${name}" runs to ${size} characters (budget ${budget})`);
	}
	return problems;
}

/** Structural validation for `courses/<slug>/course.md` invoked by `rbac.ts`. */
export function validateNotebookBudget(ctx: {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
}): string | null {
	let next: string | undefined;
	if (ctx.toolName === "edit") {
		const targetPath = ctx.input.path;
		if (typeof targetPath !== "string") return null;
		let original = "";
		try {
			original = fs.readFileSync(path.resolve(ctx.cwd, targetPath), "utf-8");
		} catch {
			return null; // missing file: the edit tool reports it
		}
		next = applyEdits(original, ctx.input.edits);
	} else {
		next = typeof ctx.input.content === "string" ? ctx.input.content : undefined;
	}
	if (next === undefined) return null;

	const problems = notebookProblems(next);
	if (problems.length === 0) return null;
	return (
		`course.md holds the present, in the template's sections and within their budgets. This change was not applied: ${problems.join("; ")}. ` +
		"Rewrite the section in place, keeping what will shape the next sitting; the transcript keeps the rest."
	);
}

export default function teacherExtension(pi: ExtensionAPI) {
	let sitting = false;
	let activeSkill: "teach" | "themecp" = "teach";

	function activate(skill?: "teach" | "themecp"): void {
		if (skill) activeSkill = skill;
		(globalThis as any).__piRbac?.setPrincipal?.(activeSkill === "themecp" ? "teacher:themecp" : "teacher:teach");
		if (sitting) return;
		sitting = true;
		try {
			pi.appendEntry(SITTING_ENTRY, { active: true, skill: activeSkill });
		} catch {
			// not fatal: the flag still holds for this process
		}
	}

	function deactivate(): void {
		(globalThis as any).__piRbac?.setPrincipal?.("user");
		if (!sitting) return;
		sitting = false;
		try {
			pi.appendEntry(SITTING_ENTRY, { active: false, skill: activeSkill });
		} catch {
			// not fatal: the flag still holds for this process
		}
	}

	function guardCourseNotebookWrite(
		toolName: string,
		input: Record<string, unknown>,
		cwd: string,
	): { block: true; reason: string } | undefined {
		if (!sitting || isSubagentProcess()) return undefined;
		if (toolName !== "write" && toolName !== "edit") return undefined;
		if (typeof input?.path !== "string") return undefined;
		const rel = path.relative(findVaultRoot(cwd), path.resolve(cwd, input.path)).replace(/\\/g, "/");
		if (!/^courses\/[^/]+\/course\.md$/.test(rel)) return undefined;
		const reason = validateNotebookBudget({ toolName, input, cwd });
		return reason ? { block: true, reason } : undefined;
	}

	// learn.ts, ladder.ts, md-log.ts, and pi-agy-bridge call these directly.
	(globalThis as any).__piTeacher = {
		activate: (skill?: "teach" | "themecp") => activate(skill || "teach"),
		deactivate: () => deactivate(),
		isActive: () => Boolean(sitting),
		validateNotebookBudget: (ctx: { toolName: string; input: Record<string, unknown>; cwd: string }) =>
			validateNotebookBudget(ctx),
		checkNotebookGuard: (ctx: { toolName: string; input: Record<string, unknown>; cwd: string }) =>
			guardCourseNotebookWrite(ctx.toolName, ctx.input, ctx.cwd)?.reason ?? null,
	};

	pi.on("session_start", async (_event, ctx) => {
		sitting = false;
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry?.type === "custom" && entry.customType === SITTING_ENTRY) {
				sitting = entry.data?.active !== false;
				if (entry.data?.skill) activeSkill = entry.data.skill;
			}
		}
	});

	pi.on("input", async (event) => {
		if (/^\/skill:themecp\b/.test(event.text.trim())) activate("themecp");
		else if (/^\/skill:teach\b/.test(event.text.trim())) activate("teach");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (isSubagentProcess() || (typeof event?.systemPrompt === "string" && /<!--\s*agent:[\w-]+\s*-->/.test(event.systemPrompt))) {
			return;
		}
		if (!sitting) {
			const log = (globalThis as any).__piMdLog?.current?.();
			if (typeof log === "string" && /[\\/]courses[\\/][^\\/]+[\\/]sessions[\\/]/.test(log)) activate("teach");
			else if (typeof log === "string" && /[\\/]practice[\\/]themecp[\\/]sessions[\\/]/.test(log)) activate("themecp");
			else return;
		}
		const voice = readVoice(ctx.cwd, activeSkill);
		if (!voice) return;
		const voiceBlock = `# Your voice in this sitting\n\n${voice}\n`;
		// AGY ACP already provides host identity, workspace info, and MCP tool schemas;
		// forwarding Pi's full default prompt leaks harness metadata and triggers 429s.
		if ((ctx as any).model?.api === "agy-bridge") {
			return { systemPrompt: voiceBlock };
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${voiceBlock}` };
	});

	// Notebook content/budget check strictly on structured write/edit tools during a sitting.
	pi.on("tool_call", async (event, ctx) => {
		return guardCourseNotebookWrite(event.toolName, event.input as Record<string, unknown>, ctx.cwd);
	});
}
