/**
 * md-log — mirror the session to a markdown file for comfortable reading.
 *
 * Designed for long teaching/learning sessions where Obsidian serves as the
 * live whiteboard and the terminal serves as the interactive controller.
 *
 * Visual Hierarchy on the Obsidian Canvas:
 *   - Assistant prose (lesson explanations, $$ display math, 3-5 line code
 *     boards, ASCII traces, and ![[viz-...]] embeds) is written as native
 *     top-level Markdown so the session reads like a clean book/whiteboard
 *     with zero blockquote-math parser quirks.
 *   - Interactive events (user prompts, live Quiz/Question prompts, and
 *     graded answers) are rendered inside distinct Obsidian callouts.
 *   - Other tools (bash, read, write, edit, subagent, ...) are omitted.
 *
 * Quiz & Question Lifecycle:
 *   - quiz and ask_user_question call `__piMdLog.logQuizQuestion` and
 *     `__piMdLog.logAskQuestion` inside the shared UI lock immediately before
 *     awaiting user input (after passing the per-assistant-message batch guard
 *     and after quiz shuffles its options).
 *   - The answer + feedback block is appended on `tool_result` (skipping any
 *     rejected `unavailable` calls so blocked duplicates never pollute the
 *     student's Obsidian whiteboard).
 *
 * Commands:
 *   /md-log <filepath>  — Link a markdown file and backfill the session.
 *   /md-unlog           — Stop logging.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const QA_TOOLS = new Set(["quiz", "ask_user_question"]);

// ── Tool-text unescaping & control-character recovery ──────────────────────
// Strings arriving via JSON tool-call args or tool-result details can experience:
// 1. Control-character collisions when a single-backslash LaTeX command is parsed
//    by JSON (`\f` in `\frac`, `\b` in `\binom`, `\t` in `\text`/`\to`, `\r` in
//    `\rightarrow`). Restore those exact stems before general unescaping.
// 2. One extra level of JSON escaping (`\\cdot`, `\"`). Undo one level (`\\` → `\`,
//    `\"` → `"`). Assistant/user prose does not pass through this layer.
function unescapeToolText(s: string): string {
	return s
		.replace(/\x08(?=(?:inom|eta|mathbb|mathcal|ar|ig|ots|ullet)\b)/g, "\\b")
		.replace(/\x0c(?=(?:rac|orall)\b)/g, "\\f")
		.replace(/\t(?=(?:ext|imes|o|heta|au|ilde|op|riangle)\b)/g, "\\t")
		.replace(/\r(?=(?:ight|ightarrow|ho|ceil|floor)\b)/g, "\\r")
		.replace(/\\\\/g, "\\")
		.replace(/\\"/g, '"');
}

export default function mdLog(pi: ExtensionAPI) {
	let logFile: string | null = null;
	let lastCtx: any = null;

	// --- State restoration on session restart ---

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		let lastLinkData: { file: string | null } | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "md-log") {
				lastLinkData = entry.data as { file: string | null } | undefined;
			}
		}
		if (lastLinkData?.file) {
			logFile = lastLinkData.file;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"md-log",
				theme.fg("accent", "🗒 ") + theme.fg("dim", path.basename(logFile)),
			);
		}
	});

	// --- Serialization: events can fire close together; keep appends ordered ---

	let writeLock: Promise<void> = Promise.resolve();
	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = writeLock;
		let release: () => void;
		writeLock = new Promise<void>((r) => {
			release = r;
		});
		return prev.then(fn).finally(() => release!());
	}

	function appendToFile(text: string): void {
		if (!logFile) return;
		try {
			const nonEmpty = fs.existsSync(logFile) && fs.statSync(logFile).size > 0;
			fs.appendFileSync(logFile, (nonEmpty ? "\n" : "") + text + "\n", "utf-8");
		} catch {
			// File may have been deleted externally; ignore.
		}
	}

	// --- Formatting ---

	function callout(type: string, title: string, bodyLines: string[]): string {
		const lines = [`> [!${type}] ${title}`];
		for (const line of bodyLines) {
			lines.push(line.length === 0 ? ">" : `> ${line}`);
		}
		return lines.join("\n");
	}

	function userBlock(text: string): string {
		return callout("quote", "YOU", text.split("\n"));
	}

	// Skill declarations (`<skill name="..." ...> ...whole SKILL.md... </skill>`)
	// are system-injected context, not user prose. Replace each with a compact
	// callout noting the skill was loaded, so the log keeps the signal without
	// the noise. Runs on already-trimmed text.
	function stripSkillBlocks(text: string): string {
		return text.replace(
			/<skill\b([^>]*)>[\s\S]*?<\/skill>/g,
			(_match, attrs: string) => {
				const name = /name="([^"]+)"/.exec(attrs)?.[1];
				return `> [!note] SKILL loaded: ${name ?? "(unknown)"}`;
			},
		);
	}

	// Assistant prose is the native Obsidian whiteboard canvas — no callout
	// wrapper so $...$, $$...$$, code blocks, tables, and ![[viz-...]] embeds
	// render natively at full width.
	function assistantBlock(text: string): string {
		return text;
	}

	function optionsList(options: Array<{ label: string }>): string[] {
		return options.map((o, i) => `${i + 1}. ${o.label}`);
	}

	function questionCallout(label: string, question: string, context: string | undefined, options: Array<{ label: string }>): string {
		const body: string[] = [];
		for (const line of question.split("\n")) body.push(line);
		if (context) {
			body.push("");
			for (const line of context.split("\n")) body.push(line);
		}
		if (options.length > 0) {
			body.push("");
			body.push(...optionsList(options));
		}
		return callout("question", label, body);
	}

	function answerCalloutQuiz(details: any): string {
		const status = details?.status;
		if (status === "cancelled") {
			return callout("warning", "Quiz — cancelled", ["(user skipped)"]);
		}
		if (status === "unavailable") {
			return callout("warning", "Quiz — unavailable", [details?.message || ""]);
		}
		// "I don't know" is neither correct nor incorrect — it's a distinct signal,
		// so it never renders as a red ✗.
		const dontKnow = details?.dontKnow === true;
		const correct = details?.correct === true;
		const type = dontKnow ? "question" : correct ? "success" : "failure";
		const title = dontKnow
			? "Quiz — I don't know"
			: correct
				? "Quiz — correct ✓"
				: "Quiz — incorrect ✗";
		const body: string[] = [];

		if (dontKnow) {
			body.push("Your answer: I don't know");
		} else {
			const answers: any[] = details?.answers || [];
			const sel = answers.map((a) => `${a.index}. ${a.label}`).join(", ") || "(none)";
			body.push(`Your answer: ${sel}`);
		}

		const correctIndices: number[] = details?.correctIndices || [];
		const correctStr = correctIndices.map((i) => `${i}`).join(", ");
		body.push(`Correct answer: ${correctStr}`);

		// Optional free-text note the user typed in the always-present note field.
		// Only present (in details) when non-empty, so no guard for empty strings.
		if (details?.note) {
			body.push("");
			const noteLines = String(details.note).split("\n");
			body.push(`Note: ${noteLines[0]}`);
			for (let i = 1; i < noteLines.length; i++) body.push(noteLines[i]);
		}

		if (details?.explanation) {
			body.push("");
			for (const line of String(details.explanation).split("\n")) body.push(line);
		}
		return callout(type, title, body);
	}

	function answerCalloutAsk(details: any): string {
		const status = details?.status;
		if (status === "cancelled") {
			return callout("warning", "Question — cancelled", ["(user skipped)"]);
		}
		if (status === "unavailable") {
			return callout("warning", "Question — unavailable", [details?.message || ""]);
		}
		const answers: any[] = details?.answers || [];
		const body: string[] = answers.map((a) => {
			if (a.type === "other") return `Other: ${a.label}`;
			if (a.type === "text") return a.label;
			return `${a.index}. ${a.label}`;
		});
		if (body.length === 0) body.push("(no answer)");
		return callout("example", "Answer", body);
	}

	// --- Event handlers ---

	pi.on("message_end", async (event, ctx) => {
		lastCtx = ctx;
		if (!logFile) return;
		const msg = event.message;
		if (!msg || !("role" in msg)) return;

		if (msg.role === "user") {
			const text = typeof msg.content === "string"
				? msg.content
				: Array.isArray(msg.content)
					? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
					: "";
			const trimmed = stripSkillBlocks(text.trim());
			if (!trimmed) return;
			await withLock(() => appendToFile(userBlock(trimmed)));
			return;
		}

		if (msg.role === "assistant") {
			const textParts = (msg.content || [])
				.filter((c: any) => c.type === "text")
				.map((c: any) => (c.text as string).trim())
				.filter((t: string) => t.length > 0);
			if (textParts.length === 0) return;
			const joined = textParts.join("\n\n");
			await withLock(() => appendToFile(assistantBlock(joined)));
			return;
		}
		// toolResult messages are handled by the tool_result event (for QA tools).
	});

	// Both `quiz` and `ask_user_question` log their question callouts directly
	// inside the shared UI lock via `__piMdLog.logQuizQuestion` and
	// `__piMdLog.logAskQuestion` (after passing the per-assistant-message batch
	// guard). On `tool_result`, we append the graded/recorded answer block and
	// silently ignore any `unavailable` results so rejected duplicate tool calls
	// never appear on the student's Obsidian whiteboard.
	pi.on("tool_result", async (event, ctx) => {
		lastCtx = ctx;
		if (!logFile) return;
		const toolName = (event as any).toolName;
		if (!QA_TOOLS.has(toolName)) return;
		const details = (event as any).details;
		if (details?.status === "unavailable") return;
		if (details) {
			if (typeof details.explanation === "string") details.explanation = unescapeToolText(details.explanation);
			if (typeof details.note === "string") details.note = unescapeToolText(details.note);
			if (typeof details.question === "string") details.question = unescapeToolText(details.question);
			if (typeof details.context === "string") details.context = unescapeToolText(details.context);
			if (Array.isArray(details.answers)) {
				for (const a of details.answers) if (a && typeof a.label === "string") a.label = unescapeToolText(a.label);
			}
		}
		const block = toolName === "quiz"
			? answerCalloutQuiz(details)
			: answerCalloutAsk(details);
		await withLock(() => appendToFile(block));
	});

	// --- Commands ---

	function link(filepath: string, ctx: any): { ok: boolean; message: string } {
		if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
			return { ok: false, message: "Wait for the agent to finish before linking." };
		}
		const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(ctx.cwd, filepath);

		// The file must already exist — linking never creates files. This avoids
		// silently scattering new files around the vault from a typo'd path.
		if (!fs.existsSync(resolved)) {
			return { ok: false, message: `File does not exist: ${resolved}` };
		}
		if (!fs.statSync(resolved).isFile()) {
			return { ok: false, message: `Not a file: ${resolved}` };
		}

		logFile = resolved;
		lastCtx = ctx;
		pi.appendEntry("md-log", { file: resolved });

		// Backfill the active branch.
		const written = backfill(ctx);

		const theme = ctx.ui.theme;
		ctx.ui.setStatus(
			"md-log",
			theme.fg("accent", "🗒 ") + theme.fg("dim", path.basename(resolved)),
		);
		return { ok: true, message: `Linked: ${resolved} (${written} entries backfilled)` };
	}

	function unlink(ctx: any): { ok: boolean; message: string } {
		if (!logFile) return { ok: false, message: "No file linked" };
		const name = path.basename(logFile);
		logFile = null;
		pi.appendEntry("md-log", { file: null });
		ctx.ui.setStatus("md-log", undefined);
		return { ok: true, message: `Unlinked: ${name}` };
	}

	// Cross-extension API:
	//   - /course (learn.ts) links session logs programmatically.
	//   - quiz (quiz.ts) and ask_user_question (ask-user-question.ts) log their
	//     question callouts inside the shared UI lock immediately before blocking
	//     on the TUI so live Obsidian and disk transcripts always reflect the true
	//     display order and never log rejected duplicate calls.
	(globalThis as any).__piMdLog = {
		link: (filepath: string) => {
			if (!lastCtx) return { ok: false, message: "md-log: no session context yet" };
			return link(filepath, lastCtx);
		},
		unlink: () => {
			if (!lastCtx) return { ok: false, message: "md-log: no session context yet" };
			return unlink(lastCtx);
		},
		current: () => logFile,
		logQuizQuestion: (question: string, context: string | undefined, options: Array<{ label: string }>) => {
			if (!logFile) return Promise.resolve();
			const q = unescapeToolText(question || "");
			const c = context ? unescapeToolText(context) : undefined;
			const opts = Array.isArray(options)
				? options.map((o) => ({ label: unescapeToolText(o.label ?? "") }))
				: [];
			const block = questionCallout("Quiz", q, c, opts);
			return withLock(() => appendToFile(block));
		},
		logAskQuestion: (question: string, context: string | undefined, options: Array<{ label: string }>) => {
			if (!logFile) return Promise.resolve();
			const q = unescapeToolText(question || "");
			const c = context ? unescapeToolText(context) : undefined;
			const opts = Array.isArray(options)
				? options.map((o) => ({ label: unescapeToolText(o.label ?? "") }))
				: [];
			const block = questionCallout("Question", q, c, opts);
			return withLock(() => appendToFile(block));
		},
		logArenaStart: (title: string, bodyLines: string[]) => {
			if (!logFile) return Promise.resolve();
			const block = callout("info", unescapeToolText(title || "Arena Opened"), bodyLines);
			return withLock(() => appendToFile(block));
		},
		logArenaSession: (title: string, bodyLines: string[]) => {
			if (!logFile) return Promise.resolve();
			const block = callout("example", unescapeToolText(title || "Arena Session"), bodyLines);
			return withLock(() => appendToFile(block));
		},
	};

	pi.registerCommand("md-log", {
		description: "Mirror the session to a markdown file (backfills history)",
		handler: async (args, ctx: any) => {
			const filepath = args.trim();
			if (!filepath) {
				ctx.ui.notify("Usage: /md-log <filepath>", "warning");
				return;
			}
			const result = link(filepath, ctx);
			ctx.ui.notify(result.message, result.ok ? "success" : "error");
		},
	});

	pi.registerCommand("md-unlog", {
		description: "Stop mirroring the session to a markdown file",
		handler: async (_args, ctx) => {
			const result = unlink(ctx);
			ctx.ui.notify(result.message, result.ok ? "info" : "warning");
		},
	});

	// --- Backfill ---

	function backfill(ctx: any): number {
		if (!logFile) return 0;
		const entries: any[] = ctx.sessionManager.getEntries();
		if (entries.length === 0) return 0;

		const byId = new Map<string, any>();
		for (const e of entries) if (e.id) byId.set(e.id, e);

		// Active leaf = last entry that has an id (skip the session header).
		let leaf: any = null;
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].id) {
				leaf = entries[i];
				break;
			}
		}
		if (!leaf) return 0;

		// Walk parent chain to root.
		const chain: any[] = [];
		let cur: any = leaf;
		const seen = new Set<string>();
		while (cur && cur.id && !seen.has(cur.id)) {
			seen.add(cur.id);
			chain.push(cur);
			cur = cur.parentId ? byId.get(cur.parentId) : null;
		}
		chain.reverse();

		// Track tool-call args from assistant messages so we can pair with results.
		const toolCallArgs = new Map<string, { name: string; args: any }>();

		const blocks: string[] = [];
		let count = 0;
		for (const entry of chain) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (!msg || !("role" in msg)) continue;
			count++;

			if (msg.role === "user") {
				const text = typeof msg.content === "string"
					? msg.content
					: Array.isArray(msg.content)
						? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
						: "";
				const trimmed = stripSkillBlocks(text.trim());
				if (trimmed) blocks.push(userBlock(trimmed));
				continue;
			}

			if (msg.role === "assistant") {
				// Index tool calls for later pairing.
				for (const c of msg.content || []) {
					if (c.type === "toolCall" && QA_TOOLS.has(c.name)) {
						toolCallArgs.set(c.id, { name: c.name, args: c.arguments });
					}
				}
				const textParts = (msg.content || [])
					.filter((c: any) => c.type === "text")
					.map((c: any) => (c.text as string).trim())
					.filter((t: string) => t.length > 0);
				if (textParts.length > 0) blocks.push(assistantBlock(textParts.join("\n\n")));
				continue;
			}

			if (msg.role === "toolResult") {
				if (msg.toolName === "arena_run") {
					const d = msg.details;
					if (!d || d.status === "unavailable") continue;
					if (Array.isArray(d.startCalloutLines) && d.startCalloutLines.length > 0) {
						blocks.push(callout("info", unescapeToolText(d.startCalloutTitle || `Arena Opened — ${d.title || "Session"}`), d.startCalloutLines));
					}
					if (Array.isArray(d.endCalloutLines) && d.endCalloutLines.length > 0) {
						blocks.push(callout("example", unescapeToolText(d.endCalloutTitle || `Arena — ${d.title || "Session"}`), d.endCalloutLines));
					}
					continue;
				}
				if (!QA_TOOLS.has(msg.toolName)) continue;
				if (msg.details?.status === "unavailable") continue;
				const tc = toolCallArgs.get(msg.toolCallId);
				// Same one-level unescape as the live path: persisted args/details
				// carry the extra JSON escaping.
				if (tc?.args) {
					if (typeof tc.args.question === "string") tc.args.question = unescapeToolText(tc.args.question);
					if (typeof tc.args.details === "string") tc.args.details = unescapeToolText(tc.args.details);
					if (Array.isArray(tc.args.options)) {
						for (const o of tc.args.options) if (o && typeof o.label === "string") o.label = unescapeToolText(o.label);
					}
				}
				if (msg.details) {
					if (typeof msg.details.explanation === "string") msg.details.explanation = unescapeToolText(msg.details.explanation);
					if (typeof msg.details.note === "string") msg.details.note = unescapeToolText(msg.details.note);
					if (Array.isArray(msg.details.answers)) {
						for (const a of msg.details.answers) if (a && typeof a.label === "string") a.label = unescapeToolText(a.label);
					}
					if (Array.isArray(msg.details.options)) {
						for (const o of msg.details.options) if (o && typeof o.label === "string") o.label = unescapeToolText(o.label);
					}
				}
				// Question block. For quiz, use the persisted result's `details.options`
				// — the TRUE post-shuffle display order the user actually saw — rather
				// than the original tool-call args, which are the pre-shuffle author
				// order and can mismatch what's on screen. ask_user_question never
				// shuffles, so its tool-call args are already the true order.
				if (tc) {
					const a = tc.args || {};
					const label = tc.name === "quiz" ? "Quiz" : "Question";
					const shuffled = msg.toolName === "quiz"
						? (msg.details?.options as Array<{ index: number; label: string }> | undefined)
						: undefined;
					const options = shuffled && shuffled.length > 0
						? shuffled.map((o) => ({ label: o.label }))
						: (Array.isArray(a.options) ? a.options : []);
					blocks.push(questionCallout(label, a.question || "", a.details?.trim() || undefined, options));
				}
				if (msg.toolName === "quiz") {
					blocks.push(answerCalloutQuiz(msg.details));
				} else {
					blocks.push(answerCalloutAsk(msg.details));
				}
				continue;
			}
		}

		if (blocks.length > 0) {
			void withLock(() => appendToFile(blocks.join("\n\n")));
		}
		return count;
	}
}
