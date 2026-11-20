import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// arena — the bridge between pi and the student's Neovim Arena.
//
//   arena_ledger — read the student's standing (rating, domains, solved and
//                  attempted IDs, upsolve queue, practice notes), settle a
//                  SUBMITTED verdict, or add a one-line practice note.
//   arena_run    — stage problem(s) into ~/playground/contests/practice and
//                  return at once. The student codes in Neovim while the
//                  conversation goes on; a watcher notices result.json, settles
//                  the ledger through arena.py, and delivers the report to the
//                  teacher as an "arena-result" message that starts a turn.
//   /arena       — status, or cancel (discard the staged session).
//
// The Arena owns .pi/arena/: arena.py (ledger engine and CLI), rating.json,
// history.json, and active/ (manifest.json, events.jsonl, result.json,
// scratch/, and tests/<id>/ copied read-only from arena_run's testsDir for the
// open session and removed when the session closes). Everyone else goes through
// the API — these tools and `arena.py` — never the files. The Arena in turn
// asks other features through theirs: the active course comes from the course
// workspace (__piCourse), never from its pointer files.
// ────────────────────────────────────────────────────────────────────────────

const RESULT_TYPE = "arena-result";

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

function getArenaDir(cwd: string): string {
	return path.join(findVaultRoot(cwd), ".pi", "arena");
}

function writeArenaPointer(cwd: string): string {
	const arenaDir = getArenaDir(cwd);
	fs.mkdirSync(arenaDir, { recursive: true });
	try {
		fs.writeFileSync(path.join(os.homedir(), ".pi-arena-root"), arenaDir + "\n", "utf-8");
	} catch {
		// restricted environment — Neovim falls back to walking up from its cwd
	}
	return arenaDir;
}

// The course workspace (learn.ts) answers which course is active.
function activeCourseSlug(): string | null {
	const course = (globalThis as any).__piCourse?.active?.();
	return typeof course?.slug === "string" && course.slug ? course.slug : null;
}

/** Copy NN.in / NN.out pairs (and optional custom checker) from `src` (read-only) into `dest` for the active Arena session; returns the pair count. */
function importTests(src: string, dest: string): number {
	if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`no such folder: ${src}`);
	const inputs = fs.readdirSync(src).filter((f) => f.endsWith(".in"));
	const pairs = inputs.filter((f) => fs.existsSync(path.join(src, f.replace(/\.in$/, ".out"))));
	if (pairs.length === 0) throw new Error(`no NN.in / NN.out pairs in ${src}`);
	fs.rmSync(dest, { recursive: true, force: true });
	fs.mkdirSync(dest, { recursive: true });
	for (const f of pairs) {
		fs.copyFileSync(path.join(src, f), path.join(dest, f));
		const out = f.replace(/\.in$/, ".out");
		fs.copyFileSync(path.join(src, out), path.join(dest, out));
	}
	// Also copy custom adaptive checker (checker.cpp / checker.py / checker.sh) if present
	for (const checkerFile of ["checker.cpp", "checker.py", "checker.sh"]) {
		const srcChecker = path.join(src, checkerFile);
		if (fs.existsSync(srcChecker)) {
			fs.copyFileSync(srcChecker, path.join(dest, checkerFile));
		}
	}
	return pairs.length;
}

function runArenaPy(cwd: string, args: string[]): any {
	const arenaDir = writeArenaPointer(cwd);
	const scriptPath = path.join(arenaDir, "arena.py");
	if (!fs.existsSync(scriptPath)) throw new Error(`Arena engine missing at ${scriptPath}`);
	let lastErr: unknown = null;
	for (const pyBin of ["python3", "python"]) {
		try {
			const stdout = execFileSync(pyBin, [scriptPath, ...args], {
				cwd: findVaultRoot(cwd),
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return JSON.parse(stdout);
		} catch (err: any) {
			lastErr = err;
			if (err?.code === "ENOENT") continue;
			const stderr = err?.stderr ? String(err.stderr).trim() : "";
			if (stderr) {
				let message = stderr;
				try {
					const parsed = JSON.parse(stderr);
					if (parsed?.error) message = String(parsed.error);
				} catch {
					// stderr wasn't JSON — use it as is
				}
				throw new Error(message);
			}
			throw err;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error("Failed to invoke python3 for arena.py");
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds || 0));
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatTimeBreakdown(p: any): string {
	const ts = p?.thinking_seconds;
	if (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0) return "";
	const dur = Math.max(0, Math.floor(Number(p?.duration_seconds || 0)));
	const think = Math.min(dur, Math.round(ts));
	const code = Math.max(0, dur - think);
	return ` (thinking ${formatDuration(think)} · coding ${formatDuration(code)})`;
}

function sanitizeProblemId(rawId: string): string {
	const clean = (rawId || "problem")
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.replace(/^_+|_+$/g, "");
	return clean || "problem";
}

function cfLabel(difficulty: unknown): string {
	return typeof difficulty === "number" ? `CF ${difficulty}` : "CF —";
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const DOMAINS = [
	"Dynamic Programming",
	"Data Structures",
	"Math",
	"Graphs",
	"Strings",
	"Geometry",
	"Implementation",
	"Algorithmic Techniques (except DP)",
] as const;

const ArenaLedgerParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("get_standing"),
			Type.Literal("inspect"),
			Type.Literal("record_verdict"),
			Type.Literal("annotate"),
			Type.Literal("abandon_active"),
		],
		{
			description:
				'"get_standing": global rating/domains/solved IDs plus upsolve queue and notes (optional courseSlug filter). "inspect": compact history lookup by problemIds/sessionId/courseSlug. "record_verdict": settle a SUBMITTED problem. "annotate": add a one-line practice note. "abandon_active": settle an open active session prematurely (only after explicit student confirmation).',
		},
	),
	problemId: Type.Optional(
		Type.String({ description: 'Problem ID for "record_verdict" and "annotate" (e.g. "dp_b", "typical90_085").' }),
	),
	problemIds: Type.Optional(
		Type.Array(Type.String(), { description: 'Optional list of problem IDs for "inspect".' }),
	),
	courseSlug: Type.Optional(
		Type.String({
			description: 'Optional course slug filter for "get_standing" or "inspect" ("none" matches ThemeCP/standalone runs).',
		}),
	),
	limit: Type.Optional(Type.Number({ description: 'Max entries to return for "inspect" (default 20).' })),
	verdict: Type.Optional(
		Type.Union(
			[Type.Literal("AC"), Type.Literal("WA"), Type.Literal("TLE"), Type.Literal("MLE"), Type.Literal("RE"), Type.Literal("ABANDON")],
			{ description: 'The checked verdict, for "record_verdict".' },
		),
	),
	sessionId: Type.Optional(Type.String({ description: 'Optional session ID for "record_verdict" or "inspect".' })),
	note: Type.Optional(
		Type.String({
			description:
				'For "annotate": one line — the approach the student chose, the one the problem needed, and whether the gap was recognition or implementation.',
		}),
	),
});

const ArenaSampleSchema = Type.Object({
	input: Type.String({ description: "Exact sample input." }),
	output: Type.String({ description: "Exact expected output." }),
});

const ArenaProblemSchema = Type.Object({
	id: Type.String({ description: 'C++-safe filename stem: ~/playground/contests/practice/{id}.cpp (e.g. "dp_b", "typical90_085").' }),
	catalogId: Type.Optional(Type.String({ description: "Catalog problem ID when it differs from `id`." })),
	title: Type.String({ description: "Problem title." }),
	url: Type.String({ description: "Judge URL." }),
	platform: Type.Optional(Type.String({ description: "Judge platform (AtCoder, Codeforces, CSES, …)." })),
	difficulty: Type.Optional(
		Type.Number({ description: "CF-scale difficulty (800–3500). Required for rated purposes; optional for guided." }),
	),
	domain: Type.Optional(
		Type.Union(
			DOMAINS.map((d) => Type.Literal(d)),
			{ description: "Arena domain. Required for rated purposes; optional for guided." },
		),
	),
	timeBudgetSeconds: Type.Optional(
		Type.Number({ description: "Per-problem time budget. When omitted, calibrated from difficulty vs. the student's rating." }),
	),
	timeLimitSeconds: Type.Optional(Type.Number({ description: "Run-time limit per test for the local judge (default 2)." })),
	statementSummary: Type.String({ description: "Self-contained plain-English statement with input/output format." }),
	constraints: Type.Optional(Type.String({ description: "Constraint bounds and time/memory limits." })),
	samples: Type.Optional(
		Type.Array(ArenaSampleSchema, { description: "Sample input/output pairs; sample 1 is staged into input.txt." }),
	),
	hints: Type.Optional(Type.Array(Type.String(), { description: "Progressive hints, one rung per <leader>mh (dropped in checkpoints)." })),
	targetConcept: Type.Optional(Type.String({ description: "Backstage note on the target idea (hidden in blind sessions)." })),
	testsDir: Type.Optional(
		Type.String({
			description:
				"A folder of hidden tests (NN.in / NN.out), e.g. the one lab reported. The Arena copies it read-only into active/tests/<id>/ for this session and cleans its copy when the session closes.",
		}),
	),
});

const ArenaRunParams = Type.Object({
	title: Type.String({ description: "Session title shown in the Arena header." }),
	purpose: Type.Union(
		[Type.Literal("guided"), Type.Literal("drill"), Type.Literal("checkpoint"), Type.Literal("upsolve"), Type.Literal("volume")],
		{
			description:
				'"guided": unrated stopwatch, after the idea was worked out together. "drill" / "upsolve" / "volume": rated, timed, hints available. "checkpoint": rated, pooled timer, metadata hidden, hints locked.',
		},
	),
	gradingPolicy: Type.Optional(
		Type.Union([Type.Literal("practice"), Type.Literal("study"), Type.Literal("contest")], {
			description: 'Defaults from purpose: "practice" for guided, "contest" for checkpoint, "study" otherwise.',
		}),
	),
	timerMode: Type.Optional(
		Type.Union([Type.Literal("stopwatch"), Type.Literal("per_problem"), Type.Literal("pooled")], {
			description: 'Defaults from purpose: "stopwatch" for guided, "pooled" for checkpoint, "per_problem" otherwise.',
		}),
	),
	totalTimeBudgetSeconds: Type.Optional(Type.Number({ description: "Pooled budget; defaults to the sum of per-problem budgets." })),
	blindMetadata: Type.Optional(
		Type.Boolean({ description: "Hide difficulty, domain, and target concept in Neovim until the session closes. Defaults to true for checkpoint." }),
	),
	approachNote: Type.Optional(
		Type.Union([Type.Literal("required"), Type.Literal("optional"), Type.Literal("off")], {
			description:
				'Ask for the approach in one line before coding. Defaults to "optional" for rated purposes and "off" for guided.',
		}),
	),
	coachNote: Type.Optional(Type.String({ description: "One or two lines shown at the top of the Neovim dashboard." })),
	strictOrder: Type.Optional(
		Type.Boolean({ description: "Enforce solving problems in strictly staged order (e.g. for ThemeCP rounds)." }),
	),
	problems: Type.Optional(Type.Array(ArenaProblemSchema, { description: "The problem(s) to stage." })),
	problemsFile: Type.Optional(
		Type.String({
			description:
				"Path (relative to the vault root) to a staged set written by problem-recommender under .pi/catalog/sets/<stage>.json (other paths are rejected — pass single/course problems inline via `problems`). Arena reads it into manifest.json; sets are swept on next startup.",
		}),
	),
});

// ── Live events from Neovim ─────────────────────────────────────────────────

interface LiveProblemStatus {
	state: string; // "staged" | "accepted" | "verdict"
	verdict?: string;
	wrongAttempts: number;
	hintsUsed: number;
	samplesPassed?: number;
	samplesTotal?: number;
	judge?: string;
	approach?: string;
}

function readLiveEvents(eventsPath: string, problemIds: string[]) {
	const perProblem = new Map<string, LiveProblemStatus>();
	for (const pid of problemIds) perProblem.set(pid, { state: "staged", wrongAttempts: 0, hintsUsed: 0 });
	let attached = false;
	let activeProblemId: string | null = null;
	let lastEventText = "waiting for <leader>ma in Neovim";

	if (!fs.existsSync(eventsPath)) return { attached, activeProblemId, lastEventText, perProblem };
	try {
		for (const line of fs.readFileSync(eventsPath, "utf-8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const ev = JSON.parse(line);
				const type = ev.event || ev.type;
				const pid = ev.problemId || ev.problem_id;
				const st = pid ? perProblem.get(pid) || { state: "accepted", wrongAttempts: 0, hintsUsed: 0 } : undefined;
				if (type === "session_opened" || type === "attached") {
					attached = true;
					lastEventText = "Neovim attached";
				} else if (type === "problem_accepted" && st) {
					attached = true;
					activeProblemId = pid;
					st.state = "accepted";
					lastEventText = `coding ${pid}`;
				} else if (type === "approach_noted" && st) {
					st.approach = String(ev.approach || "");
					lastEventText = `approach noted on ${pid}`;
				} else if (type === "samples_tested" && st) {
					st.samplesPassed = ev.passed;
					st.samplesTotal = ev.total;
					lastEventText = `samples ${ev.passed}/${ev.total} on ${pid}`;
				} else if (type === "judged" && st) {
					st.judge = `${ev.verdict} ${ev.passed}/${ev.total}`;
					lastEventText = `hidden tests on ${pid}: ${st.judge}`;
				} else if (type === "hint_used" && st) {
					st.hintsUsed = Number(ev.hintsUsed || st.hintsUsed + 1);
					lastEventText = `hint ${st.hintsUsed} on ${pid}`;
				} else if (type === "attempt_logged" && st) {
					st.wrongAttempts = Number(ev.wrongAttempts || st.wrongAttempts + 1);
					st.verdict = ev.verdict;
					lastEventText = `attempt ${st.wrongAttempts} on ${pid}: ${ev.verdict}`;
				} else if (type === "problem_verdict" && st) {
					st.state = "verdict";
					st.verdict = ev.verdict;
					lastEventText = `${ev.verdict} on ${pid}`;
				} else if (type === "session_closed") {
					lastEventText = "session closed — collecting the result";
				}
				if (pid && st) perProblem.set(pid, st);
			} catch {
				// partial line while Neovim is writing
			}
		}
	} catch {
		// read race
	}
	return { attached, activeProblemId, lastEventText, perProblem };
}

// ── Reports ─────────────────────────────────────────────────────────────────

function buildResultMarkdownForTeacher(r: any): string {
	const lines: string[] = [];
	lines.push(`Arena session finished: "${r.title}" [purpose=${r.purpose}, policy=${r.grading_policy}, timer=${r.timer_mode}]`);
	lines.push(
		`Rating: ${r.rating_before} -> ${r.rating_after} (${r.rating_delta >= 0 ? "+" : ""}${r.rating_delta}) [${r.tier}]`,
	);
	lines.push("");
	for (const p of r.problems || []) {
		const ot = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} over budget)` : "";
		const budget = p.budget_seconds > 0 ? ` / budget ${formatDuration(p.budget_seconds)}` : "";
		const pending = p.pending_verdict
			? " [pending — check it, then settle with arena_ledger record_verdict]"
			: "";
		const elo = p.rated ? ` | rating ${p.rating_before} -> ${p.rating_after} (${p.rating_delta >= 0 ? "+" : ""}${p.rating_delta})` : " | unrated";
		lines.push(`### ${p.title} (\`${p.id}\`, ${cfLabel(p.difficulty)}, ${p.domain || "no domain"})`);
		lines.push(`- URL: ${p.url}`);
		lines.push(`- Verdict: \`${p.verdict}\`${pending}${elo}`);
		const split = formatTimeBreakdown(p);
		const solvedAt = p.solved_at_seconds > 0 ? ` | solved at round clock ${formatDuration(p.solved_at_seconds)}` : "";
		lines.push(`- Total time: ${formatDuration(p.duration_seconds)}${budget}${ot}${split}${solvedAt} | wrong attempts: ${p.wrong_attempts} | hints: ${p.hints_used}`);
		if (p.approach) lines.push(`- Approach (written before coding): "${p.approach}"`);
		if (p.local_judge) {
			const lj = p.local_judge;
			lines.push(`- Hidden tests: ${lj.verdict} ${lj.passed}/${lj.total}${lj.failedCase ? ` (first failure: ${lj.failedCase})` : ""}`);
		}
		if (p.reflection) lines.push(`- Reflection: "${p.reflection}"`);
		if (Array.isArray(p.attempts) && p.attempts.length > 0) {
			lines.push(
				`- Attempts: ${p.attempts
					.map((a: any) => `#${a.attempt} ${a.verdict} @ ${formatDuration(a.elapsedSeconds || a.elapsed_seconds || 0)}`)
					.join(" -> ")}`,
			);
		}
		if (Array.isArray(p.attempt_diffs) && p.attempt_diffs.length > 0) {
			lines.push("");
			lines.push("#### Changes between attempts");
			for (const d of p.attempt_diffs) lines.push("```diff\n" + d.diff + "\n```");
		}
		lines.push("");
		lines.push(`#### Final code (\`~/playground/contests/practice/${p.id}.cpp\`)`);
		lines.push(p.final_code && String(p.final_code).trim() ? "```cpp\n" + String(p.final_code).trim() + "\n```" : "(no code written)");
		lines.push("");
	}
	return lines.join("\n");
}

function buildMdLogStartCalloutLines(m: any): string[] {
	const clock = m.timerMode === "stopwatch" ? "stopwatch" : `budget \`${formatDuration(m.totalTimeBudgetSeconds || 0)}\``;
	const lines = [
		`**Mode:** \`${m.purpose}\` (\`${m.gradingPolicy}\`, \`${m.timerMode}\`) · ${clock} · **Standing:** \`CF ${m.studentRating}\` (${m.studentTier})`,
	];
	if (m.coachNote) lines.push(`**Note:** ${m.coachNote}`);
	lines.push("");
	for (const p of m.problems || []) {
		const pClock = m.timerMode === "stopwatch" ? "" : ` · budget \`${formatDuration(p.timeBudgetSeconds || 0)}\``;
		const meta = m.blindMetadata ? `\`${p.id}.cpp\` · blind${pClock}` : `\`${p.id}.cpp\` · ${cfLabel(p.difficulty)} · ${p.domain || "no domain"}${pClock}`;
		lines.push(`- **[${p.title}](${p.url})** (${meta})`);
	}
	return lines;
}

function buildMdLogCalloutLines(r: any): string[] {
	const sign = r.rating_delta >= 0 ? "+" : "";
	const lines = [
		`**Mode:** \`${r.purpose}\` (\`${r.grading_policy}\`, \`${r.timer_mode}\`) · **Rating:** \`${r.rating_before} -> ${r.rating_after} (${sign}${r.rating_delta})\` (${r.tier})`,
		"",
	];
	for (const p of r.problems || []) {
		const time = p.budget_seconds > 0 ? `${formatDuration(p.duration_seconds)}/${formatDuration(p.budget_seconds)}` : formatDuration(p.duration_seconds);
		const ot = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} over)` : "";
		const split = formatTimeBreakdown(p);
		const solvedAt = p.solved_at_seconds > 0 ? ` · Solved at round clock: \`${formatDuration(p.solved_at_seconds)}\`` : "";
		const pending = p.pending_verdict ? " *(pending teacher check)*" : "";
		const judge = p.local_judge ? ` · Hidden tests: \`${p.local_judge.verdict} ${p.local_judge.passed}/${p.local_judge.total}\`` : "";
		lines.push(
			`- **[${p.title}](${p.url})** (\`${p.id}.cpp\`, ${cfLabel(p.difficulty)}) — **\`${p.verdict}\`**${pending} · Total time: \`${time}\`${ot}${split}${solvedAt} · Wrong attempts: \`${p.wrong_attempts}\` · Hints: \`${p.hints_used}\`${judge}`,
		);
		if (p.approach) lines.push(`  - *Approach:* ${p.approach}`);
		if (p.reflection) lines.push(`  - *Reflection:* ${p.reflection}`);
	}
	return lines;
}

function originTag(entry: any): string {
	if (entry?.course_slug) return `course:${entry.course_slug}`;
	return entry?.purpose === "checkpoint" ? "ThemeCP/checkpoint" : entry?.purpose || "standalone";
}

function standingSummary(s: any): string {
	const g = s.global || {};
	const domains = Object.entries(s.domains || {})
		.filter(([, st]: [string, any]) => (st?.attempted || 0) > 0)
		.map(([dom, st]: [string, any]) => {
			const misses = Array.isArray(st.recent_failures) && st.recent_failures.length ? ` (recent misses: ${st.recent_failures.join(", ")})` : "";
			return `  - ${dom}: ${st.solved}/${st.attempted} solved, avg difficulty ${st.avg_solved_difficulty || "—"}${misses}`;
		});
	const scopeLabel = s.course_slug_filter ? ` (filtered by course=${s.course_slug_filter})` : "";
	const lines = [
		`Rating: CF ${g.rating} [${g.tier}] (max ${g.max_rating}; rated solved ${g.rated_solved}/${g.rated_attempted}; unrated solved ${g.unrated_solved || 0}; streak ${g.streak})`,
		domains.length ? "Domains:" : "Domains: none attempted yet",
		...domains,
		`Solved (${(s.solved_problem_ids || []).length}): ${(s.solved_problem_ids || []).join(", ") || "none"}`,
		`Upsolve queue${scopeLabel}: ${(s.upsolve_queue || []).map((u: any) => `${u.problem_id} (${u.verdict}, ${originTag(u)})`).join(", ") || "empty"}`,
	];
	if ((s.pending_submissions || []).length) {
		lines.push(`Pending checks${scopeLabel}: ${s.pending_submissions.map((p: any) => `${p.problem_id} [${originTag(p)}]`).join(", ")}`);
	}
	if ((s.recent_notes || []).length) {
		lines.push(`Recent practice notes${scopeLabel}:`);
		for (const n of s.recent_notes) lines.push(`  - ${n.problem_id} [${originTag(n)}]: ${n.note}`);
	}
	return lines.join("\n");
}

function inspectSummary(entries: any[]): string {
	if (!entries.length) return "No matching entries in Arena history.";
	const lines: string[] = [];
	for (const e of entries) {
		const dur = e.budget_seconds > 0 ? `${formatDuration(e.duration_seconds)}/${formatDuration(e.budget_seconds)}` : formatDuration(e.duration_seconds);
		const ot = e.overtime_seconds > 0 ? ` (+${formatDuration(e.overtime_seconds)} OT)` : "";
		const split = formatTimeBreakdown(e);
		const solvedAt = e.solved_at_seconds > 0 ? `, clock=${formatDuration(e.solved_at_seconds)}` : "";
		const sign = (e.rating_delta || 0) >= 0 ? "+" : "";
		const sol = e.solution_path ? ` | code: ${e.solution_path}` : "";
		lines.push(
			`- ${e.problem_id} [${originTag(e)}, ${e.domain || "no domain"}, ${cfLabel(e.difficulty)}] → ${e.verdict} (time ${dur}${ot}${split}${solvedAt}, WA=${e.wrong_attempts}, hints=${e.hints_used}, Δ=${sign}${e.rating_delta})${sol}`,
		);
		if (e.approach) lines.push(`  approach: "${e.approach}"`);
		if (e.reflection) lines.push(`  reflection: "${e.reflection}"`);
		if (Array.isArray(e.notes) && e.notes.length) {
			lines.push(`  notes: ${e.notes.map((n: any) => n.note).join(" | ")}`);
		}
	}
	return lines.join("\n");
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function arenaExtension(pi: ExtensionAPI) {
	let lastCtx: any = null;
	let watcher: { timer: ReturnType<typeof setInterval>; activeDir: string; vaultRoot: string; manifest: any; startedAt: number } | null =
		null;
	let finalizing = false;

	function setStatus(text: string | undefined): void {
		try {
			lastCtx?.ui?.setStatus?.("arena", text);
		} catch {
			// context gone (session replaced) — the next event refreshes it
		}
	}

	function stopWatcher(): void {
		if (watcher) clearInterval(watcher.timer);
		watcher = null;
	}

	function statusText(manifest: any, live: ReturnType<typeof readLiveEvents>, startedAt: number): string {
		const elapsed = formatDuration((Date.now() - startedAt) / 1000);
		return `⚔ ${manifest.title} · ${elapsed} · ${live.lastEventText}`;
	}

	function mdLog(): any {
		return (globalThis as any).__piMdLog;
	}

	async function finalize(activeDir: string, vaultRoot: string, triggerTurn: boolean): Promise<void> {
		if (finalizing) return;
		const resultPath = path.join(activeDir, "result.json");
		try {
			JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		} catch {
			return; // missing or half-written — the next tick tries again
		}
		finalizing = true;
		stopWatcher();
		const delivery = triggerTurn ? { triggerTurn: true, deliverAs: "followUp" as const } : { deliverAs: "nextTurn" as const };
		try {
			let sessionResult: any;
			try {
				sessionResult = runArenaPy(vaultRoot, ["close_session", "--active-dir", activeDir]);
			} catch (err) {
				// Keep the raw result for manual recovery, then clear the slot.
				const failedDir = path.join(path.dirname(activeDir), "failed");
				fs.mkdirSync(failedDir, { recursive: true });
				fs.copyFileSync(resultPath, path.join(failedDir, `result-${Date.now()}.json`));
				throw err;
			} finally {
				fs.rmSync(activeDir, { recursive: true, force: true });
			}
			const endCalloutTitle = `Arena — ${sessionResult.title}`;
			const endCalloutLines = buildMdLogCalloutLines(sessionResult);
			await mdLog()?.logArenaSession?.(endCalloutTitle, endCalloutLines);
			pi.sendMessage(
				{
					customType: RESULT_TYPE,
					content: buildResultMarkdownForTeacher(sessionResult),
					display: true,
					details: { status: "completed", session: sessionResult, endCalloutTitle, endCalloutLines },
				},
				delivery,
			);
		} catch (err) {
			pi.sendMessage(
				{
					customType: RESULT_TYPE,
					content: `The Arena session ended, but its result could not be settled: ${errorMessage(err)}. The raw result was kept in .pi/arena/failed/.`,
					display: true,
					details: { status: "failed" },
				},
				delivery,
			);
		} finally {
			setStatus(undefined);
			finalizing = false;
		}
	}

	function startWatcher(activeDir: string, vaultRoot: string, manifest: any, startedAt = Date.now()): void {
		stopWatcher();
		const eventsPath = path.join(activeDir, "events.jsonl");
		const problemIds = (manifest.problems || []).map((p: any) => p.id);
		const timer = setInterval(() => {
			if (!fs.existsSync(path.join(activeDir, "manifest.json"))) {
				stopWatcher();
				setStatus(undefined);
				return;
			}
			if (fs.existsSync(path.join(activeDir, "result.json"))) {
				void finalize(activeDir, vaultRoot, true);
				return;
			}
			setStatus(statusText(manifest, readLiveEvents(eventsPath, problemIds), startedAt));
		}, 1000);
		watcher = { timer, activeDir, vaultRoot, manifest, startedAt };
	}

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		const arenaDir = writeArenaPointer(ctx.cwd);
		// Self-heal any legacy .pi/arena/tests/ folder left from older versions.
		const legacyTestsDir = path.join(arenaDir, "tests");
		if (fs.existsSync(legacyTestsDir)) {
			fs.rmSync(legacyTestsDir, { recursive: true, force: true });
		}
		const activeDir = path.join(arenaDir, "active");
		const manifestPath = path.join(activeDir, "manifest.json");
		if (!fs.existsSync(manifestPath)) return;
		let manifest: any;
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		} catch {
			return;
		}
		const vaultRoot = findVaultRoot(ctx.cwd);
		if (fs.existsSync(path.join(activeDir, "result.json"))) {
			// Finished while pi was away: settle it once the other extensions (md-log) have restored.
			setTimeout(() => void finalize(activeDir, vaultRoot, false), 1500);
		} else {
			const started = Date.parse(manifest.createdAt || "") || Date.now();
			startWatcher(activeDir, vaultRoot, manifest, started);
		}
	});

	pi.on("session_shutdown", async () => {
		stopWatcher(); // the staged session stays on disk; the next session picks it up
	});

	// Territory access control for .pi/arena/ is enforced centrally by .pi/extensions/rbac.ts.

	// ── Tool: arena_ledger ──────────────────────────────────────────────────
	pi.registerTool({
		name: "arena_ledger",
		label: "arena_ledger",
		description:
			"The student's global lifelong practice ledger across courses, ad-hoc practice, and ThemeCP rounds.\n\n" +
			"Actions:\n" +
			"- get_standing: Call before assigning problems or diagnosing gaps — returns global rating, per-domain profile, all solved/attempted problem IDs (to avoid repeats), active session status, `upsolve_queue`, and practice notes. Pass `courseSlug` for a course view, `\"none\"` for unaffiliated/ThemeCP queues, or omit for global standing.\n" +
			"- inspect: Query detailed history by `problemIds`, `sessionId`, or `courseSlug`; its `solution_path` and reflection/attempt telemetry pinpoint where reasoning broke in reviews or post-mortems.\n" +
			"- record_verdict: Settle a `SUBMITTED` problem (handed back without a live OJ verdict) after inspecting the solution. Real judge outcomes (`AC`, `WA`, `TLE`, `MLE`, `RE`, `ABANDON`) are already recorded.\n" +
			"- annotate: Save a brief one-line diagnostic takeaway attached to a problem or session.\n" +
			"- abandon_active: Prematurely close a conflicting live Arena session only after explicit student confirmation via `ask_user_question`.",
		parameters: ArenaLedgerParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			lastCtx = ctx;
			try {
				if (params.action === "get_standing") {
					const args = ["standing"];
					if (params.courseSlug) args.push("--course-slug", params.courseSlug.trim());
					const standing = runArenaPy(ctx.cwd, args);
					return { content: [{ type: "text", text: standingSummary(standing) }], details: { action: "get_standing", standing } };
				}
				if (params.action === "inspect") {
					const args = ["inspect"];
					if (Array.isArray(params.problemIds) && params.problemIds.length) {
						args.push("--problem-ids", params.problemIds.map((p) => p.trim()).filter(Boolean).join(","));
					}
					if (params.sessionId) args.push("--session-id", params.sessionId.trim());
					if (params.courseSlug) args.push("--course-slug", params.courseSlug.trim());
					if (typeof params.limit === "number") args.push("--limit", String(params.limit));
					const entries = runArenaPy(ctx.cwd, args);
					return { content: [{ type: "text", text: inspectSummary(entries) }], details: { action: "inspect", entries } };
				}
				if (params.action === "abandon_active") {
					const activeDir = path.join(writeArenaPointer(ctx.cwd), "active");
					stopWatcher();
					setStatus(undefined);
					const sessionResult = runArenaPy(ctx.cwd, ["abandon_active", "--active-dir", activeDir]);
					fs.rmSync(activeDir, { recursive: true, force: true });
					const endCalloutTitle = `Arena (Abandoned) — ${sessionResult.title}`;
					const endCalloutLines = buildMdLogCalloutLines(sessionResult);
					await mdLog()?.logArenaSession?.(endCalloutTitle, endCalloutLines);
					return {
						content: [{ type: "text", text: buildResultMarkdownForTeacher(sessionResult) }],
						details: { action: "abandon_active", session: sessionResult, endCalloutTitle, endCalloutLines },
					};
				}
				if (params.action === "record_verdict") {
					if (!params.problemId || !params.verdict) throw new Error('record_verdict needs "problemId" and "verdict"');
					const args = ["record_verdict", "--problem-id", params.problemId.trim(), "--verdict", params.verdict.trim()];
					if (params.sessionId) args.push("--session-id", params.sessionId.trim());
					const res = runArenaPy(ctx.cwd, args);
					const sign = (res.rating_delta || 0) >= 0 ? "+" : "";
					return {
						content: [
							{
								type: "text",
								text: `Ledger settled: ${res.problem_id} (${res.title}) → ${res.verdict}; rating ${res.rating_before} -> ${res.rating_after} (${sign}${res.rating_delta}) [${res.tier}]`,
							},
						],
						details: { action: "record_verdict", result: res },
					};
				}
				if (params.action === "annotate") {
					if (!params.problemId || !params.note) throw new Error('annotate needs "problemId" and "note"');
					const res = runArenaPy(ctx.cwd, ["annotate", "--problem-id", params.problemId.trim(), "--note", params.note.trim()]);
					return {
						content: [{ type: "text", text: `Noted on ${res.problem_id}: ${res.note}` }],
						details: { action: "annotate", result: res },
					};
				}
				throw new Error(`Unknown arena_ledger action: ${(params as any).action}`);
			} catch (err) {
				const msg = errorMessage(err);
				return { content: [{ type: "text", text: `arena_ledger error: ${msg}` }], details: { action: params.action, error: msg } };
			}
		},

		renderCall(args, theme) {
			const tail =
				args.action === "record_verdict"
					? `record_verdict ${args.problemId ?? ""} → ${args.verdict ?? ""}`
					: args.action === "annotate"
						? `annotate ${args.problemId ?? ""}`
						: args.action === "inspect"
							? `inspect ${Array.isArray(args.problemIds) ? args.problemIds.join(",") : args.courseSlug || args.sessionId || "recent"}`
							: args.action === "abandon_active"
								? "abandon_active"
								: "get_standing";
			return new Text(theme.fg("toolTitle", theme.bold("arena_ledger ")) + theme.fg("muted", tail), 0, 0);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `arena_ledger: ${d.error}`), 0, 0);
			if (d?.action === "record_verdict" && d.result) {
				const r = d.result;
				const sign = (r.rating_delta || 0) >= 0 ? "+" : "";
				return new Text(
					theme.fg("success", `✓ ${r.problem_id} → ${r.verdict} `) + theme.fg("dim", `(CF ${r.rating_before} → ${r.rating_after}, ${sign}${r.rating_delta})`),
					0,
					0,
				);
			}
			if (d?.action === "annotate" && d.result) return new Text(theme.fg("dim", `noted on ${d.result.problem_id}`), 0, 0);
			if (d?.action === "inspect" && Array.isArray(d.entries)) {
				return new Text(theme.fg("accent", `inspected ${d.entries.length} ledger row(s)`), 0, 0);
			}
			if (d?.action === "abandon_active" && d.session) {
				const r = d.session;
				const sign = (r.rating_delta || 0) >= 0 ? "+" : "";
				return new Text(
					theme.fg("warning", `⚑ abandoned: ${r.title} `) + theme.fg("dim", `(CF ${r.rating_before} → ${r.rating_after}, ${sign}${r.rating_delta})`),
					0,
					0,
				);
			}
			if (d?.action === "get_standing" && d.standing?.global) {
				const g = d.standing.global;
				const queue = (d.standing.upsolve_queue || []).length;
				return new Text(
					theme.fg("accent", `CF ${g.rating} `) +
						theme.fg("muted", `${g.tier} · ${g.rated_solved} rated, ${g.unrated_solved || 0} guided solved · upsolve queue ${queue}`),
					0,
					0,
				);
			}
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});

	// ── Tool: arena_run ─────────────────────────────────────────────────────
	pi.registerTool({
		name: "arena_run",
		label: "arena_run",
		description:
			"Stage problem(s) in the student's Neovim Arena (~/playground/contests/practice): problem card, samples (sample 1 in input.txt; <leader>mt runs all), hints (<leader>mh, unless locked), hidden tests when present (<leader>mj), and timer. Returns at once while the student codes; the outcome (verdicts, final code, attempt diffs, timing, hints, approach line, hidden-test result, reflection, rating change) arrives later as an arena-result message. One Arena session is open at a time; conversation continues normally while it runs.\n\n" +
			"Usage rules:\n" +
			"- For ad-hoc or ambiguous requests, confirm intent first via `ask_user_question` (unrated `guided` vs. rated `drill`; local hidden tests vs. live judge only; affiliated `courseSlug` vs. standalone) so you do not silently rate a problem or skip requested local judging.\n" +
			"- Purposes: `guided` (+ `practice` gradingPolicy) runs an unrated stopwatch (`difficulty` and `domain` optional); `drill`, `upsolve`, `volume`, and `checkpoint` are timed, update the global Arena rating, and require CF `difficulty` and `domain` on every problem.\n" +
			"- ThemeCP checkpoint bindings: pass `purpose=\"checkpoint\"`, `approachNote=\"required\"`, `strictOrder=true`, `totalTimeBudgetSeconds=<ladder limitMinutes * 60>`, and omit `courseSlug` (`checkpoint` auto-applies `gradingPolicy=\"contest\"`, `timerMode=\"pooled\"`, `blindMetadata=true`).\n" +
			"- Staging: pass `courseSlug` within a course, or omit for ThemeCP and standalone practice. Each `id` is a C++-safe filename stem (`dp_b`, `cses_1634`, `typical90_085`); include `samples` whenever they exist. Only pass `.pi/catalog/sets/...` files created by `problem-recommender` as `problemsFile`; pass single or course problems inline in `problems`.\n" +
			"- Hidden tests & post-run check: build `testsDir` via `lab` before every course run and ThemeCP round, and on ad-hoc runs when the student chooses local testing via `ask_user_question`. Afterward, if hidden tests did not execute on a submitted attempt (not `ABANDON`), run `problem-grader` (in ThemeCP, when neither OJ nor hidden tests ran). On `ABANDON`, verify at your discretion.\n" +
			"- Verdicts & approachNote: `AC`, `WA`, `TLE`, `MLE`, `RE`, `ABANDON` come from the online judge and are already reflected in the ledger; `SUBMITTED` means no judge verdict was recorded — inspect the code, then settle with `arena_ledger` `record_verdict`. In rated purposes `approachNote` (`\"optional\"` by default, `\"required\"` in ThemeCP) captures a one-line pre-code approach beside code diffs.",
		parameters: ArenaRunParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			lastCtx = ctx;
			const unavailable = (message: string) => ({
				content: [{ type: "text" as const, text: message }],
				details: { status: "unavailable", message },
			});
			if (!ctx.hasUI) {
				return unavailable("arena_run requires an interactive UI session (Neovim); it cannot run headlessly.");
			}

			const vaultRoot = findVaultRoot(ctx.cwd);
			const arenaDir = writeArenaPointer(ctx.cwd);
			const activeDir = path.join(arenaDir, "active");
			const manifestPath = path.join(activeDir, "manifest.json");
			if (fs.existsSync(manifestPath)) {
				let openTitle = "An Arena session";
				try {
					openTitle = `"${JSON.parse(fs.readFileSync(manifestPath, "utf-8")).title}"`;
				} catch {
					// unreadable manifest — keep the generic name
				}
				return unavailable(`${openTitle} is still open in the Arena. It closes when the student finishes in Neovim, or /arena cancel discards it.`);
			}

			// Gather problems from the call and/or a staged set (.pi/catalog/sets/<stage>.json).
			const raw: any[] = Array.isArray(params.problems) ? [...params.problems] : [];
			if (params.problemsFile) {
				const file = path.resolve(path.isAbsolute(params.problemsFile) ? params.problemsFile : path.join(vaultRoot, params.problemsFile));
				const relFile = path.relative(vaultRoot, file).replace(/\\/g, "/");
				if (!relFile.startsWith(".pi/catalog/sets/")) {
					return unavailable(
						`problemsFile ${params.problemsFile}: must point to a generated set under .pi/catalog/sets/ (pass single or course problems inline via \`problems\`).`,
					);
				}
				try {
					const data = JSON.parse(fs.readFileSync(file, "utf-8"));
					const list = Array.isArray(data) ? data : Array.isArray(data?.problems) ? data.problems : null;
					if (!list) throw new Error("expected a JSON array of problems");
					raw.push(...list);
				} catch (err) {
					return unavailable(`problemsFile ${params.problemsFile}: ${errorMessage(err)}`);
				}
			}
			if (raw.length === 0) return unavailable("arena_run needs at least one problem, in `problems` or `problemsFile`.");

			const purpose = params.purpose;
			const gradingPolicy = params.gradingPolicy || (purpose === "guided" ? "practice" : purpose === "checkpoint" ? "contest" : "study");
			const timerMode = params.timerMode || (purpose === "guided" ? "stopwatch" : purpose === "checkpoint" ? "pooled" : "per_problem");
			const blindMetadata = params.blindMetadata !== undefined ? Boolean(params.blindMetadata) : purpose === "checkpoint";
			const rated = gradingPolicy !== "practice";
			const approachNote = params.approachNote || (rated ? "optional" : "off");

			const missing: string[] = [];
			raw.forEach((p, i) => {
				for (const key of ["id", "title", "url", "statementSummary"]) {
					if (typeof p?.[key] !== "string" || !p[key].trim()) missing.push(`problem ${i + 1}: ${key}`);
				}
				if (rated && typeof p?.difficulty !== "number") missing.push(`problem ${i + 1}: difficulty (rated run)`);
				if (rated && !p?.domain) missing.push(`problem ${i + 1}: domain (rated run)`);
			});
			if (missing.length) return unavailable(`arena_run is missing ${missing.join("; ")}.`);

			let standing: any;
			try {
				standing = runArenaPy(ctx.cwd, ["standing"]);
			} catch (err) {
				return unavailable(`Arena ledger unavailable: ${errorMessage(err)}`);
			}
			const currentRating = Number(standing?.global?.rating || 1200);
			const currentTier = String(standing?.global?.tier || "Pupil (CF 1200-1399)");

			// Prepare a clean active session directory, then copy any hidden tests read-only into active/tests/<id>/.
			fs.rmSync(activeDir, { recursive: true, force: true });
			fs.mkdirSync(path.join(activeDir, "scratch"), { recursive: true });

			const importErrors: string[] = [];
			for (const p of raw) {
				if (typeof p?.testsDir !== "string" || !p.testsDir.trim()) continue;
				const src = path.resolve(path.isAbsolute(p.testsDir) ? p.testsDir : path.join(vaultRoot, p.testsDir.trim()));
				const relSrc = path.relative(vaultRoot, src).replace(/\\/g, "/");
				try {
					if (relSrc === ".pi/arena" || relSrc.startsWith(".pi/arena/")) {
						throw new Error("testsDir must point to the producer's folder outside .pi/arena/ (Arena manages .pi/arena/active/tests/ itself)");
					}
					if (relSrc === "courses" || relSrc.startsWith("courses/")) {
						throw new Error("testsDir cannot point inside courses/ (student-visible Obsidian vault)");
					}
					importTests(src, path.join(activeDir, "tests", sanitizeProblemId(String(p.id))));
				} catch (err) {
					importErrors.push(`${p.id}: ${errorMessage(err)}`);
				}
			}
			if (importErrors.length) {
				fs.rmSync(activeDir, { recursive: true, force: true });
				return unavailable(`Hidden tests could not be imported — ${importErrors.join("; ")}.`);
			}

			const problems = raw.map((p: any) => {
				const id = sanitizeProblemId(String(p.id));
				const difficulty = typeof p.difficulty === "number" ? Math.max(800, Math.min(3500, Math.round(p.difficulty))) : undefined;
				let budget = typeof p.timeBudgetSeconds === "number" && p.timeBudgetSeconds > 0 ? Math.round(p.timeBudgetSeconds) : 0;
				if (!budget && timerMode !== "stopwatch" && difficulty !== undefined) {
					try {
						budget = Number(runArenaPy(ctx.cwd, ["budget", "--difficulty", String(difficulty), "--rating", String(currentRating)])?.budget_seconds) || 1500;
					} catch {
						budget = 1500;
					}
				}
				const storeDir = path.join(activeDir, "tests", id);
				const hasTests = fs.existsSync(storeDir) && fs.readdirSync(storeDir).some((f) => f.endsWith(".in"));
				// Unknown values are left out (undefined), never null: JSON null reaches Lua as a truthy vim.NIL.
				return {
					id,
					catalogId: typeof p.catalogId === "string" && p.catalogId ? p.catalogId : id,
					title: String(p.title).trim(),
					url: String(p.url).trim(),
					platform: typeof p.platform === "string" && p.platform ? p.platform.trim() : "Judge",
					difficulty,
					domain: typeof p.domain === "string" && p.domain ? p.domain.trim() : undefined,
					timeBudgetSeconds: budget,
					timeLimitSeconds: typeof p.timeLimitSeconds === "number" && p.timeLimitSeconds > 0 ? p.timeLimitSeconds : 2,
					statementSummary: String(p.statementSummary).trim(),
					constraints: typeof p.constraints === "string" ? p.constraints.trim() : "",
					samples: Array.isArray(p.samples) ? p.samples : [],
					hints: gradingPolicy === "contest" ? [] : Array.isArray(p.hints) ? p.hints : [],
					targetConcept: typeof p.targetConcept === "string" ? p.targetConcept.trim() : "",
					testsDir: hasTests ? storeDir : undefined,
				};
			});

			const totalBudget =
				typeof params.totalTimeBudgetSeconds === "number" && params.totalTimeBudgetSeconds > 0
					? Math.round(params.totalTimeBudgetSeconds)
					: problems.reduce((acc, p) => acc + p.timeBudgetSeconds, 0);

			const manifest = {
				sessionId: `arena_${Date.now()}`,
				courseSlug: activeCourseSlug(),
				title: params.title.trim(),
				purpose,
				gradingPolicy,
				timerMode,
				totalTimeBudgetSeconds: totalBudget,
				blindMetadata,
				hintsLocked: gradingPolicy === "contest",
				approachNote,
				strictOrder: Boolean(params.strictOrder),
				coachNote: (params.coachNote || "").trim(),
				studentRating: currentRating,
				studentTier: currentTier,
				createdAt: new Date().toISOString(),
				problems,
			};

			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
			fs.writeFileSync(path.join(activeDir, "events.jsonl"), "", "utf-8");

			const startCalloutTitle = `Arena Opened — ${manifest.title}`;
			const startCalloutLines = buildMdLogStartCalloutLines(manifest);
			await mdLog()?.logArenaStart?.(startCalloutTitle, startCalloutLines);
			startWatcher(activeDir, vaultRoot, manifest);

			const names = problems.map((p) => `${p.title} (${p.id}.cpp${p.testsDir ? ", hidden tests" : ""})`).join("; ");
			return {
				content: [
					{
						type: "text",
						text: `Staged in the Arena: ${names}. The student opens it with <leader>ma in Neovim; the outcome arrives as an arena-result message when they finish. If you already introduced the problem in this turn, end your turn now with no further text.`,
					},
				],
				details: { status: "staged", title: manifest.title, purpose, startCalloutTitle, startCalloutLines },
			};
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.problems) ? args.problems.length : 0;
			const what = args.problemsFile ? `set ${args.problemsFile}` : `${count} ${count === 1 ? "problem" : "problems"}`;
			return new Text(
				theme.fg("toolTitle", theme.bold("arena_run ")) + theme.fg("accent", `${args.title || "Session"} `) + theme.fg("dim", `[${args.purpose || "guided"} · ${what}]`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.status === "unavailable") return new Text(theme.fg("warning", d.message || "Arena unavailable"), 0, 0);
			if (d?.status === "staged") return new Text(theme.fg("success", `⚔ staged: ${d.title}`) + theme.fg("dim", " — waiting for the student in Neovim"), 0, 0);
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});

	// ── Command: /arena ─────────────────────────────────────────────────────
	pi.registerCommand("arena", {
		description: "Arena status & management: /arena [status | cancel]",
		handler: async (args, ctx: any) => {
			lastCtx = ctx;
			const sub = (args || "").trim().toLowerCase() || "status";
			const activeDir = path.join(writeArenaPointer(ctx.cwd), "active");

			if (sub === "cancel" || sub === "clear") {
				stopWatcher();
				setStatus(undefined);
				if (fs.existsSync(activeDir)) {
					fs.rmSync(activeDir, { recursive: true, force: true });
					ctx.ui.notify("[Arena] Discarded the staged session.", "info");
				} else {
					ctx.ui.notify("[Arena] No staged session to discard.", "info");
				}
				return;
			}

			try {
				const s = runArenaPy(ctx.cwd, ["standing"]);
				const g = s.global || {};
				let open = "";
				try {
					open = ` · open: "${JSON.parse(fs.readFileSync(path.join(activeDir, "manifest.json"), "utf-8")).title}"`;
				} catch {
					// nothing staged
				}
				ctx.ui.notify(
					`[Arena] CF ${g.rating} (${g.tier}) · rated ${g.rated_solved}/${g.rated_attempted} · guided ${g.unrated_solved || 0} · upsolve queue ${(s.upsolve_queue || []).length}${open}`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(`[Arena] ${errorMessage(err)}`, "error");
			}
		},
	});
}
