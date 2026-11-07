import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	Key,
	Text,
	matchesKey,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// arena — Competitive Programming Arena bridge between pi and Neovim.
//
// Exposes two deterministic tools to the Teacher:
//   1. `arena_ledger` — query student standing/domain stats/solved history, or
//                       settle a pending `SUBMITTED` verdict after grading.
//   2. `arena_run`    — stage a problem or multi-problem set into Neovim
//                       (~/playground/contests/practice), track live progress,
//                       and return inline C++ code, unified attempt diffs,
//                       timing/overtime, hints used, and reflection notes while
//                       automatically deleting `.pi/arena/active/`.
// ────────────────────────────────────────────────────────────────────────────

const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => {
					release = r;
				});
				return prev.then(fn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}
const sharedUiLock = getSharedUiLock();

function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	return sharedUiLock.withLock(fn);
}

function findVaultRoot(startDir: string): string {
	let cur = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(cur, ".pi")) || fs.existsSync(path.join(cur, "courses"))) {
			return cur;
		}
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return path.resolve(startDir);
}

function getArenaDir(cwd: string): string {
	const vaultRoot = findVaultRoot(cwd);
	return path.join(vaultRoot, ".pi", "arena");
}

function writeArenaPointer(cwd: string): string {
	const arenaDir = getArenaDir(cwd);
	fs.mkdirSync(arenaDir, { recursive: true });
	try {
		const pointerFile = path.join(os.homedir(), ".pi-arena-root");
		fs.writeFileSync(pointerFile, arenaDir + "\n", "utf-8");
	} catch {
		// Ignore home pointer write errors in restricted environments
	}
	return arenaDir;
}

function readActiveCourseSlug(cwd: string): string | null {
	try {
		const vaultRoot = findVaultRoot(cwd);
		const p = path.join(vaultRoot, ".active-course");
		if (fs.existsSync(p)) {
			const s = fs.readFileSync(p, "utf-8").trim();
			return s || null;
		}
	} catch {
		// ignore
	}
	return null;
}

function runArenaPy(cwd: string, args: string[]): any {
	const arenaDir = writeArenaPointer(cwd);
	const scriptPath = path.join(arenaDir, "arena.py");
	if (!fs.existsSync(scriptPath)) {
		throw new Error(`Arena engine missing at ${scriptPath}`);
	}

	let lastErr: any = null;
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
				try {
					const parsed = JSON.parse(stderr);
					if (parsed?.error) throw new Error(parsed.error);
				} catch (parseErr) {
					if (parseErr instanceof Error && parseErr.message !== stderr) {
						// fall through
					}
				}
				throw new Error(stderr);
			}
			throw err;
		}
	}
	throw lastErr || new Error("Failed to invoke python3 for arena.py");
}

function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds || 0));
	const m = Math.floor(s / 60);
	const rem = s % 60;
	return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function sanitizeProblemId(rawId: string): string {
	const clean = (rawId || "problem")
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.replace(/^_+|_+$/g, "");
	return clean || "problem";
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const ArenaLedgerParams = Type.Object({
	action: Type.Union([Type.Literal("get_standing"), Type.Literal("record_verdict")], {
		description:
			'"get_standing" returns the student\'s current CF-equivalent rating, tier, per-domain stats, and solved/attempted problem IDs. "record_verdict" settles a pending SUBMITTED verdict in the ledger after you verify the student\'s code.',
	}),
	problemId: Type.Optional(
		Type.String({
			description: 'Required when action is "record_verdict". The problem ID (e.g. "dp_b", "cses_1634", "cf_455A").',
		}),
	),
	verdict: Type.Optional(
		Type.Union(
			[
				Type.Literal("AC"),
				Type.Literal("WA"),
				Type.Literal("TLE"),
				Type.Literal("MLE"),
				Type.Literal("RE"),
				Type.Literal("ABANDON"),
			],
			{
				description: 'Required when action is "record_verdict". Verified verdict to record in the ledger.',
			},
		),
	),
	sessionId: Type.Optional(
		Type.String({
			description: 'Optional session ID when action is "record_verdict".',
		}),
	),
});

const ArenaSampleSchema = Type.Object({
	input: Type.String({ description: "Exact sample input text." }),
	output: Type.String({ description: "Exact expected sample output text." }),
});

const ArenaProblemSchema = Type.Object({
	id: Type.String({
		description:
			'Clean C++ filename stem for ~/playground/contests/practice/{id}.cpp (e.g. "dp_b", "cses_1634", "cf_455A").',
	}),
	catalogId: Type.Optional(
		Type.String({
			description: "Catalog problem ID if different from `id`.",
		}),
	),
	title: Type.String({ description: "Problem title." }),
	url: Type.String({ description: "Verified online judge URL." }),
	platform: Type.Optional(Type.String({ description: "Judge platform (e.g. Codeforces, AtCoder, CSES)." })),
	difficulty: Type.Number({
		description: "Deterministic CF-scale difficulty (800..3200) from catalog.py.",
	}),
	domain: Type.Union(
		[
			Type.Literal("Dynamic Programming"),
			Type.Literal("Data Structures"),
			Type.Literal("Math"),
			Type.Literal("Graphs"),
			Type.Literal("Strings"),
			Type.Literal("Geometry"),
			Type.Literal("Implementation"),
			Type.Literal("Algorithmic Techniques (except DP)"),
		],
		{
			description:
				"Canonical Arena curriculum domain bucket chosen by the Teacher based on the problem and lesson context.",
		},
	),
	timeBudgetSeconds: Type.Optional(
		Type.Number({
			description:
				"Optional per-problem time budget in seconds. When omitted, calibrated automatically from difficulty vs. student rating.",
		}),
	),
	statementSummary: Type.String({
		description: "Self-contained plain-English problem statement, input/output format, and rules.",
	}),
	constraints: Type.Optional(
		Type.String({
			description: "Key constraint bounds and time/memory limits (e.g. 'N <= 2e5, W <= 1e9, 2.0s').",
		}),
	),
	samples: Type.Optional(
		Type.Array(ArenaSampleSchema, {
			description:
				"Sample input/output pairs. Sample 1 is automatically staged into ~/playground/contests/practice/input.txt and <leader>mt tests all samples in Neovim.",
		}),
	),
	hints: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Progressive Socratic hints (dispensed one rung at a time when the student presses <leader>mh in Neovim).",
		}),
	),
	targetConcept: Type.Optional(
		Type.String({
			description: "Backstage note on the target invariant or mechanism (masked in Neovim when blindMetadata is true).",
		}),
	),
});

const ArenaRunParams = Type.Object({
	title: Type.String({
		description: "Session title shown in the Arena header (e.g. 'Guided Implementation — Frog 2' or 'Chapter 2 Checkpoint').",
	}),
	purpose: Type.Union(
		[
			Type.Literal("guided"),
			Type.Literal("drill"),
			Type.Literal("checkpoint"),
			Type.Literal("upsolve"),
			Type.Literal("volume"),
		],
		{
			description:
				'"guided": unrated stopwatch implementation (auto-opens buffer when 1 problem). "drill" / "upsolve" / "volume": rated timed practice with hints available (K=16). "checkpoint": rated contest check with blind metadata and locked hints (K=24).',
		},
	),
	gradingPolicy: Type.Optional(
		Type.Union([Type.Literal("practice"), Type.Literal("study"), Type.Literal("contest")], {
			description:
				'Defaults from purpose ("practice" for guided, "study" for drill/upsolve/volume, "contest" for checkpoint).',
		}),
	),
	timerMode: Type.Optional(
		Type.Union([Type.Literal("stopwatch"), Type.Literal("per_problem"), Type.Literal("pooled")], {
			description:
				'Defaults from purpose ("stopwatch" for guided, "pooled" for checkpoint, "per_problem" for drill/upsolve/volume).',
		}),
	),
	totalTimeBudgetSeconds: Type.Optional(
		Type.Number({
			description: "Optional pooled session time budget in seconds (defaults to sum of per-problem budgets).",
		}),
	),
	blindMetadata: Type.Optional(
		Type.Boolean({
			description:
				"When true, hides difficulty ratings, domain names, and targetConcept tags in Neovim until the session closes. Defaults to true for checkpoint, false otherwise.",
		}),
	),
	coachNote: Type.Optional(
		Type.String({
			description: "Optional 1-2 line note displayed at the top of the Neovim Arena dashboard.",
		}),
	),
	problems: Type.Array(ArenaProblemSchema, {
		description: "The problem(s) to stage into the Neovim Arena.",
		minItems: 1,
	}),
});

// ── Live Event Reader ───────────────────────────────────────────────────────

interface LiveProblemStatus {
	state: string; // "staged" | "accepted" | "testing" | "submitted" | "verdict"
	verdict?: string;
	wrongAttempts: number;
	hintsUsed: number;
	samplesPassed?: number;
	samplesTotal?: number;
}

function readLiveEvents(eventsPath: string, problemIds: string[]): {
	attached: boolean;
	activeProblemId: string | null;
	lastEventText: string;
	perProblem: Map<string, LiveProblemStatus>;
} {
	const perProblem = new Map<string, LiveProblemStatus>();
	for (const pid of problemIds) {
		perProblem.set(pid, { state: "staged", wrongAttempts: 0, hintsUsed: 0 });
	}
	let attached = false;
	let activeProblemId: string | null = null;
	let lastEventText = "Waiting for <leader>ma (:Arena) in Neovim...";

	if (!fs.existsSync(eventsPath)) {
		return { attached, activeProblemId, lastEventText, perProblem };
	}

	try {
		const raw = fs.readFileSync(eventsPath, "utf-8");
		const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
		for (const line of lines) {
			try {
				const ev = JSON.parse(line);
				const type = ev.event || ev.type;
				const pid = ev.problemId || ev.problem_id;
				if (type === "session_opened" || type === "attached") {
					attached = true;
					lastEventText = "Neovim attached to Arena session";
				} else if (type === "problem_accepted" && pid) {
					attached = true;
					activeProblemId = pid;
					const st = perProblem.get(pid) || { state: "accepted", wrongAttempts: 0, hintsUsed: 0 };
					st.state = "accepted";
					perProblem.set(pid, st);
					lastEventText = `Coding ${pid}.cpp in Neovim`;
				} else if (type === "samples_tested" && pid) {
					attached = true;
					const st = perProblem.get(pid) || { state: "accepted", wrongAttempts: 0, hintsUsed: 0 };
					st.samplesPassed = ev.passed;
					st.samplesTotal = ev.total;
					perProblem.set(pid, st);
					lastEventText = `Tested samples on ${pid}: ${ev.passed}/${ev.total} passed`;
				} else if (type === "hint_used" && pid) {
					attached = true;
					const st = perProblem.get(pid) || { state: "accepted", wrongAttempts: 0, hintsUsed: 0 };
					st.hintsUsed = Number(ev.hintsUsed || ev.rung || st.hintsUsed + 1);
					perProblem.set(pid, st);
					lastEventText = `Viewed Hint ${st.hintsUsed} on ${pid}`;
				} else if (type === "attempt_logged" && pid) {
					attached = true;
					const st = perProblem.get(pid) || { state: "accepted", wrongAttempts: 0, hintsUsed: 0 };
					st.wrongAttempts = Number(ev.wrongAttempts || st.wrongAttempts + 1);
					st.verdict = ev.verdict;
					perProblem.set(pid, st);
					lastEventText = `Attempt #${st.wrongAttempts} on ${pid}: ${ev.verdict} (still solving)`;
				} else if (type === "problem_verdict" && pid) {
					attached = true;
					const st = perProblem.get(pid) || { state: "verdict", wrongAttempts: 0, hintsUsed: 0 };
					st.state = "verdict";
					st.verdict = ev.verdict;
					perProblem.set(pid, st);
					lastEventText = `Recorded ${ev.verdict} on ${pid}`;
				} else if (type === "session_closed") {
					lastEventText = "Session closed in Neovim — collecting results...";
				}
			} catch {
				// Ignore malformed partial line
			}
		}
	} catch {
		// Ignore read race
	}

	return { attached, activeProblemId, lastEventText, perProblem };
}

function buildResultMarkdownForTeacher(sessionResult: any): string {
	const lines: string[] = [];
	lines.push(
		`Arena Session Completed: "${sessionResult.title}" [purpose=${sessionResult.purpose}, policy=${sessionResult.grading_policy}, timer=${sessionResult.timer_mode}]`,
	);
	lines.push(
		`Student CF Rating: ${sessionResult.rating_before} -> ${sessionResult.rating_after} (${sessionResult.rating_delta >= 0 ? "+" : ""}${sessionResult.rating_delta}) [${sessionResult.tier}]`,
	);
	lines.push("");

	for (const p of sessionResult.problems || []) {
		const durStr = formatDuration(p.duration_seconds || 0);
		const budStr = formatDuration(p.budget_seconds || 0);
		const otStr = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} OVERTIME)` : "";
		const pendingNote = p.pending_verdict
			? " [PENDING TEACHER VERIFICATION — settle via arena_ledger(action='record_verdict') after grading]"
			: "";
		const deltaNote = p.rated
			? ` | Elo: ${p.rating_before} -> ${p.rating_after} (${p.rating_delta >= 0 ? "+" : ""}${p.rating_delta})`
			: " | Unrated";

		lines.push(`### Problem: ${p.title} (\`${p.id}\`, CF ${p.difficulty}, ${p.domain})`);
		lines.push(`- **URL:** ${p.url}`);
		lines.push(`- **Verdict:** \`${p.verdict}\`${pendingNote}${deltaNote}`);
		lines.push(
			`- **Time:** ${durStr} / budget ${budStr}${otStr} | **Wrong Attempts:** ${p.wrong_attempts} | **Hints Used:** ${p.hints_used}`,
		);
		if (p.reflection) {
			lines.push(`- **Student Reflection Note:** "${p.reflection}"`);
		}
		if (Array.isArray(p.attempts) && p.attempts.length > 0) {
			const timeline = p.attempts
				.map((a: any) => `#${a.attempt} ${a.verdict} @ ${formatDuration(a.elapsedSeconds || a.elapsed_seconds || 0)}`)
				.join(" -> ");
			lines.push(`- **Attempt Timeline:** ${timeline}`);
		}
		if (Array.isArray(p.attempt_diffs) && p.attempt_diffs.length > 0) {
			lines.push("");
			lines.push("#### Evolution Across Attempts (Unified Diffs)");
			for (const d of p.attempt_diffs) {
				lines.push(`\`\`\`diff\n${d.diff}\n\`\`\``);
			}
		}
		lines.push("");
		lines.push(`#### Final C++ Code (\`~/playground/contests/practice/${p.id}.cpp\`)`);
		if (p.final_code && String(p.final_code).trim().length > 0) {
			lines.push(`\`\`\`cpp\n${String(p.final_code).trim()}\n\`\`\``);
		} else {
			lines.push("*(No C++ code written)*");
		}
		lines.push("");
	}

	return lines.join("\n");
}

function buildMdLogStartCalloutLines(manifest: any): string[] {
	const lines: string[] = [];
	const budgetStr = formatDuration(manifest.totalTimeBudgetSeconds || 0);
	lines.push(
		`**Mode:** \`${manifest.purpose}\` (\`${manifest.gradingPolicy}\`, \`${manifest.timerMode}\`) · **Budget:** \`${budgetStr}\` · **Standing:** \`CF ${manifest.studentRating}\` (${manifest.studentTier})`,
	);
	if (manifest.coachNote) {
		lines.push(`**Note:** ${manifest.coachNote}`);
	}
	lines.push("");
	for (const p of manifest.problems || []) {
		const pBud = formatDuration(p.timeBudgetSeconds || 0);
		const meta = manifest.blindMetadata
			? `\`${p.id}.cpp\` · CF ???? · Blind Checkpoint · Budget \`${pBud}\``
			: `\`${p.id}.cpp\` · CF ${p.difficulty} · ${p.domain} · Budget \`${pBud}\``;
		lines.push(`- **[${p.title}](${p.url})** (${meta})`);
	}
	return lines;
}

function buildMdLogCalloutLines(sessionResult: any): string[] {
	const lines: string[] = [];
	const deltaSign = sessionResult.rating_delta >= 0 ? "+" : "";
	lines.push(
		`**Mode:** \`${sessionResult.purpose}\` (\`${sessionResult.grading_policy}\`, \`${sessionResult.timer_mode}\`) · **CF Standing:** \`${sessionResult.rating_before} -> ${sessionResult.rating_after} (${deltaSign}${sessionResult.rating_delta})\` (${sessionResult.tier})`,
	);
	lines.push("");
	for (const p of sessionResult.problems || []) {
		const dur = formatDuration(p.duration_seconds || 0);
		const bud = formatDuration(p.budget_seconds || 0);
		const ot = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} overtime)` : "";
		const pending = p.pending_verdict ? " *(pending teacher verification)*" : "";
		lines.push(
			`- **[${p.title}](${p.url})** (\`${p.id}.cpp\`, CF ${p.difficulty}) — **\`${p.verdict}\`**${pending} · Time: \`${dur}/${bud}\`${ot} · Wrong attempts: \`${p.wrong_attempts}\` · Hints: \`${p.hints_used}\``,
		);
		if (p.reflection) {
			lines.push(`  - *Reflection:* ${p.reflection}`);
		}
	}
	return lines;
}

export default function arenaExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		writeArenaPointer(ctx.cwd);
	});

	// ── Tool 1: arena_ledger ────────────────────────────────────────────────
	pi.registerTool({
		name: "arena_ledger",
		label: "arena_ledger",
		description:
			"Query or update the student's Competitive Programming Arena ledger. Use action='get_standing' to retrieve the student's current CF-equivalent rating, tier, per-domain solve/attempt statistics, recent history, and solved_problem_ids (to pass to problem-recommender, curriculum-architect, or auditor). Use action='record_verdict' after verifying a SUBMITTED problem (e.g. via problem-grader) to settle its final verdict (AC, WA, TLE, MLE, RE) and rating impact in the ledger.",
		promptSnippet:
			"Use arena_ledger(action='get_standing') to check the student's CF-equivalent rating, domain stats, and solved problem IDs, or arena_ledger(action='record_verdict', problemId=..., verdict=...) to settle a SUBMITTED problem's verdict after grading.",
		parameters: ArenaLedgerParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				if (params.action === "get_standing") {
					const standing = runArenaPy(ctx.cwd, ["standing"]);
					const g = standing.global || {};
					const domLines = Object.entries(standing.domains || {})
						.map(([dom, st]: [string, any]) => {
							const failStr =
								Array.isArray(st.recent_failures) && st.recent_failures.length > 0
									? ` (recent misses: ${st.recent_failures.join(", ")})`
									: "";
							return `  - ${dom}: ${st.solved}/${st.attempted} solved (avg diff: ${st.avg_solved_difficulty || "-"})${failStr}`;
						})
						.join("\n");

					const summary = [
						`Student Arena Standing: CF ${g.rating} [${g.tier}] (max: ${g.max_rating}, rated solved: ${g.rated_solved}/${g.rated_attempted}, unrated solved: ${g.unrated_solved || 0}, streak: ${g.streak})`,
						"Domains:",
						domLines,
						`Solved Problem IDs (${(standing.solved_problem_ids || []).length}): ${(standing.solved_problem_ids || []).join(", ") || "none yet"}`,
						"",
						JSON.stringify(standing, null, 2),
					].join("\n");

					return {
						content: [{ type: "text", text: summary }],
						details: { action: "get_standing", standing },
					};
				}

				if (params.action === "record_verdict") {
					if (!params.problemId || !params.verdict) {
						throw new Error('record_verdict requires both "problemId" and "verdict"');
					}
					const args = [
						"record_verdict",
						"--problem-id",
						params.problemId.trim(),
						"--verdict",
						params.verdict.trim(),
					];
					if (params.sessionId) {
						args.push("--session-id", params.sessionId.trim());
					}
					const res = runArenaPy(ctx.cwd, args);
					const sign = (res.rating_delta || 0) >= 0 ? "+" : "";
					const text = `Ledger updated for ${res.problem_id} (${res.title}): verdict=${res.verdict}, rating=${res.rating_before} -> ${res.rating_after} (${sign}${res.rating_delta}) [${res.tier}]`;
					return {
						content: [{ type: "text", text }],
						details: { action: "record_verdict", result: res },
					};
				}

				throw new Error(`Unknown arena_ledger action: ${(params as any).action}`);
			} catch (err: any) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `arena_ledger error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},

		renderCall(args, theme) {
			if (args.action === "record_verdict") {
				return new Text(
					theme.fg("toolTitle", theme.bold("arena_ledger ")) +
						theme.fg("muted", `record_verdict ${args.problemId ?? ""} → ${args.verdict ?? ""}`),
					0,
					0,
				);
			}
			return new Text(
				theme.fg("toolTitle", theme.bold("arena_ledger ")) + theme.fg("muted", "get_standing"),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			if (details?.error) {
				return new Text(theme.fg("warning", `arena_ledger: ${details.error}`), 0, 0);
			}
			if (details?.action === "record_verdict" && details?.result) {
				const r = details.result;
				const sign = (r.rating_delta || 0) >= 0 ? "+" : "";
				return new Text(
					theme.fg("success", `✓ Ledger settled: ${r.problem_id} → ${r.verdict} `) +
						theme.fg("dim", `(CF ${r.rating_before} → ${r.rating_after}, ${sign}${r.rating_delta})`),
					0,
					0,
				);
			}
			if (details?.action === "get_standing" && details?.standing?.global) {
				const g = details.standing.global;
				return new Text(
					theme.fg("accent", `CF ${g.rating} `) +
						theme.fg("muted", `${g.tier} · Solved: ${g.rated_solved} rated, ${g.unrated_solved || 0} guided · Streak: ${g.streak}`),
					0,
					0,
				);
			}
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});

	// ── Tool 2: arena_run ───────────────────────────────────────────────────
	pi.registerTool({
		name: "arena_run",
		label: "arena_run",
		description:
			"Launch an interactive Competitive Programming Arena session in the student's Neovim workspace (~/playground/contests/practice). Stages the problem card(s), sample cases (auto-populating Sample 1 into input.txt and enabling <leader>mt multi-sample testing), progressive Socratic hints (<leader>mh), and a timer (stopwatch, per_problem, or pooled). Blocks with a live TUI status card in pi until the student finishes in Neovim, then returns their final C++ code, unified diffs across attempts, elapsed/overtime seconds, hints viewed, reflection note, and rating update inline.",
		promptSnippet:
			"Use arena_run to open problem(s) in the student's Neovim competitive workspace and receive their final C++ code, attempt diffs, timing, hints used, and verdict when they finish.",
		promptGuidelines: [
			"Always supply clean C++-safe filename stems for each problem's `id` (e.g. `dp_b`, `cses_1634`, `cf_455A`) and deterministic CF-scale `difficulty` (800..3200) from catalog.py.",
			"Include at least 1-2 sample input/output pairs in `samples` whenever available so Neovim can auto-populate `input.txt` and run `<leader>mt` instant sample tests.",
			"Include a progressive `hints` array (from problem-recommender's Progressive Hint Ladder) so the student can request Socratic nudges via `<leader>mh` in Neovim when hints are unlocked.",
			"When `arena_run` returns a problem with verdict `SUBMITTED`, the student handed unverified C++ code directly to you; its ledger state stays pending until you verify it (e.g. with `problem-grader`) and settle it via `arena_ledger(action='record_verdict', ...)`.",
		],
		parameters: ArenaRunParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const arenaDir = writeArenaPointer(ctx.cwd);
			const activeDir = path.join(arenaDir, "active");
			const scratchDir = path.join(activeDir, "scratch");

			// Clean any stale active directory before staging new session
			fs.rmSync(activeDir, { recursive: true, force: true });
			fs.mkdirSync(scratchDir, { recursive: true });

			const standing = runArenaPy(ctx.cwd, ["standing"]);
			const currentRating = Number(standing?.global?.rating || 1200);
			const currentTier = String(standing?.global?.tier || "Pupil (CF 1200-1399)");

			const purpose = params.purpose;
			const gradingPolicy =
				params.gradingPolicy ||
				(purpose === "guided" ? "practice" : purpose === "checkpoint" ? "contest" : "study");
			const timerMode =
				params.timerMode ||
				(purpose === "guided" ? "stopwatch" : purpose === "checkpoint" ? "pooled" : "per_problem");
			const blindMetadata =
				params.blindMetadata !== undefined ? Boolean(params.blindMetadata) : purpose === "checkpoint";

			const sessionId = `arena_${Date.now()}`;
			const courseSlug = readActiveCourseSlug(ctx.cwd);

			const normalizedProblems = params.problems.map((p) => {
				const cleanId = sanitizeProblemId(p.id);
				const diff = Math.max(800, Math.min(3500, Math.round(Number(p.difficulty || 1200))));
				let budgetSec = p.timeBudgetSeconds ? Math.round(Number(p.timeBudgetSeconds)) : 0;
				if (!budgetSec || budgetSec <= 0) {
					const bRes = runArenaPy(ctx.cwd, ["budget", "--difficulty", String(diff), "--rating", String(currentRating)]);
					budgetSec = Number(bRes?.budget_seconds || 1500);
				}
				return {
					id: cleanId,
					catalogId: p.catalogId || cleanId,
					title: p.title.trim(),
					url: p.url.trim(),
					platform: (p.platform || "Judge").trim(),
					difficulty: diff,
					domain: (p.domain || "Algorithmic Techniques (except DP)").trim(),
					timeBudgetSeconds: budgetSec,
					statementSummary: p.statementSummary.trim(),
					constraints: (p.constraints || "").trim(),
					samples: Array.isArray(p.samples) ? p.samples : [],
					hints: Array.isArray(p.hints) ? p.hints : [],
					targetConcept: (p.targetConcept || "").trim(),
				};
			});

			const totalBudgetSeconds =
				params.totalTimeBudgetSeconds && params.totalTimeBudgetSeconds > 0
					? Math.round(params.totalTimeBudgetSeconds)
					: normalizedProblems.reduce((acc, p) => acc + p.timeBudgetSeconds, 0);

			const manifest = {
				sessionId,
				courseSlug,
				title: params.title.trim(),
				purpose,
				gradingPolicy,
				timerMode,
				totalTimeBudgetSeconds: totalBudgetSeconds,
				blindMetadata,
				coachNote: (params.coachNote || "").trim(),
				studentRating: currentRating,
				studentTier: currentTier,
				createdAt: new Date().toISOString(),
				problems: normalizedProblems,
			};

			const manifestPath = path.join(activeDir, "manifest.json");
			const eventsPath = path.join(activeDir, "events.jsonl");
			const resultPath = path.join(activeDir, "result.json");

			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
			fs.writeFileSync(eventsPath, "", "utf-8");

			if (!ctx.hasUI) {
				fs.rmSync(activeDir, { recursive: true, force: true });
				return {
					content: [{ type: "text", text: "arena_run requires interactive TUI mode." }],
					details: { status: "unavailable", message: "arena_run requires interactive TUI mode." },
				};
			}

			return await withUILock(async () => {
				const problemIds = normalizedProblems.map((p) => p.id);
				const startWallMs = Date.now();
				const mdLog = (globalThis as any).__piMdLog as
					| {
							logArenaStart?: (title: string, lines: string[]) => Promise<void>;
							logArenaSession?: (title: string, lines: string[]) => Promise<void>;
					  }
					| undefined;

				const startCalloutTitle = `Arena Opened — ${manifest.title}`;
				const startCalloutLines = buildMdLogStartCalloutLines(manifest);
				await mdLog?.logArenaStart?.(startCalloutTitle, startCalloutLines);

				const outcome = await ctx.ui.custom<"completed" | "cancelled">(
					(tui: any, theme: any, _kb: any, done: (res: "completed" | "cancelled") => void) => {
						let finished = false;

						const finish = (state: "completed" | "cancelled") => {
							if (finished) return;
							finished = true;
							clearInterval(poller);
							done(state);
						};

						const poller = setInterval(() => {
							if (signal?.aborted) {
								finish("cancelled");
								return;
							}
							if (fs.existsSync(resultPath)) {
								finish("completed");
								return;
							}
							tui.requestRender();
						}, 400);

						function handleInput(data: string) {
							if (matchesKey(data, Key.escape)) {
								finish("cancelled");
								return;
							}
							if (matchesKey(data, Key.enter)) {
								if (fs.existsSync(resultPath)) {
									finish("completed");
									return;
								}
							}
						}

						function render(width: number): string[] {
							const lines: string[] = [];
							const add = (text: string) => lines.push(truncateToWidth(text, width));
							const live = readLiveEvents(eventsPath, problemIds);
							const elapsedSec = Math.floor((Date.now() - startWallMs) / 1000);

							add(theme.fg("accent", "─".repeat(width)));
							add(
								theme.fg("accent", theme.bold(` ⚔  ${manifest.title} `)) +
									theme.fg(
										"dim",
										`[${purpose} · ${gradingPolicy} · ${formatDuration(elapsedSec)}/${formatDuration(totalBudgetSeconds)}]`,
									),
							);
							if (manifest.coachNote) {
								add(theme.fg("muted", `    ${manifest.coachNote}`));
							}

							for (let i = 0; i < normalizedProblems.length; i++) {
								const p = normalizedProblems[i];
								const st = live.perProblem.get(p.id) || {
									state: "staged",
									wrongAttempts: 0,
									hintsUsed: 0,
								};
								const isCur = live.activeProblemId === p.id;
								const pointer = isCur ? theme.fg("accent", " ▶ ") : "   ";

								let badge = theme.fg("dim", "[STAGED]");
								if (st.state === "verdict" && st.verdict) {
									const vColor =
										st.verdict === "AC"
											? "success"
											: st.verdict === "SUBMITTED"
												? "accent"
												: "error";
									badge = theme.fg(vColor, `[${st.verdict}]`);
								} else if (st.state === "accepted") {
									badge = theme.fg("warning", "[CODING]");
								}

								const metaTag = blindMetadata
									? theme.fg("dim", "(blind)")
									: theme.fg("muted", `(CF ${p.difficulty})`);

								const extras: string[] = [];
								if (st.samplesTotal !== undefined) {
									extras.push(`samples ${st.samplesPassed}/${st.samplesTotal}`);
								}
								if (st.wrongAttempts > 0) {
									extras.push(`WA×${st.wrongAttempts}`);
								}
								if (st.hintsUsed > 0) {
									extras.push(`hints ${st.hintsUsed}/${p.hints.length}`);
								}
								const extraStr = extras.length > 0 ? theme.fg("dim", ` · ${extras.join(" · ")}`) : "";

								add(
									`${pointer}${i + 1}. ${badge} ${theme.bold(p.title)} ${theme.fg("dim", `(${p.id}.cpp)`)} ${metaTag}${extraStr}`,
								);
							}

							const connBadge = live.attached
								? theme.fg("success", " ● ")
								: theme.fg("warning", " ○ ");
							add(connBadge + theme.fg("text", live.lastEventText));
							add(
								theme.fg(
									"dim",
									" [Esc] cancel • Press <leader>ma (:Arena) in Neovim",
								),
							);
							add(theme.fg("accent", "─".repeat(width)));
							return lines;
						}

						return {
							render,
							invalidate: () => {},
							handleInput,
						};
					},
				);

				if (outcome === "cancelled" && !fs.existsSync(resultPath)) {
					fs.rmSync(activeDir, { recursive: true, force: true });
					return {
						content: [{ type: "text", text: "Arena session was cancelled before completion." }],
						details: {
							status: "cancelled",
							title: manifest.title,
							purpose,
							startCalloutTitle,
							startCalloutLines,
						},
					};
				}

				// Finalize session via arena.py (reads scratch/*.cpp, computes unified diffs, updates rating & history)
				let sessionResult: any;
				try {
					sessionResult = runArenaPy(ctx.cwd, ["close_session", "--active-dir", activeDir]);
				} finally {
					// Always delete ephemeral .pi/arena/active/ once inline code & diffs are collected
					fs.rmSync(activeDir, { recursive: true, force: true });
				}

				const endCalloutTitle = `Arena — ${sessionResult.title}`;
				const endCalloutLines = buildMdLogCalloutLines(sessionResult);
				await mdLog?.logArenaSession?.(endCalloutTitle, endCalloutLines);

				const teacherReport = buildResultMarkdownForTeacher(sessionResult);
				return {
					content: [{ type: "text", text: teacherReport }],
					details: {
						status: "completed",
						title: sessionResult.title,
						session: sessionResult,
						startCalloutTitle,
						startCalloutLines,
						endCalloutTitle,
						endCalloutLines,
					},
				};
			});
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.problems) ? args.problems.length : 0;
			const noun = count === 1 ? "problem" : "problems";
			return new Text(
				theme.fg("toolTitle", theme.bold("arena_run ")) +
					theme.fg("accent", `${args.title || "Session"} `) +
					theme.fg("dim", `[${args.purpose || "guided"} · ${count} ${noun}]`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			if (!details) {
				const first = result.content?.[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", `Arena session cancelled (${details.title || ""})`), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "Arena unavailable"), 0, 0);
			}
			const s = details.session;
			if (!s) {
				return new Text(theme.fg("success", "Arena session completed"), 0, 0);
			}

			const lines: string[] = [];
			const sign = (s.rating_delta || 0) >= 0 ? "+" : "";
			lines.push(
				theme.fg("accent", theme.bold(`⚔ ${s.title} `)) +
					theme.fg("dim", `[${s.purpose} · CF ${s.rating_before} → ${s.rating_after} (${sign}${s.rating_delta})]`),
			);

			for (const p of s.problems || []) {
				const v = p.verdict || "SKIPPED";
				const color = v === "AC" ? "success" : v === "SUBMITTED" ? "accent" : v === "SKIPPED" ? "dim" : "error";
				const dur = formatDuration(p.duration_seconds || 0);
				const ot = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} OT)` : "";
				const pending = p.pending_verdict ? " [pending teacher grade]" : "";
				lines.push(
					`  ${theme.fg(color, `• ${v}`)} ${p.title} ${theme.fg("dim", `(${p.id}.cpp · CF ${p.difficulty} · ${dur}${ot} · WA×${p.wrong_attempts || 0} · hints ${p.hints_used || 0})${pending}`)}`,
				);
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	// ── Command: /arena ─────────────────────────────────────────────────────
	pi.registerCommand("arena", {
		description: "Arena status & management: /arena [status | cancel]",
		handler: async (args, ctx: any) => {
			const sub = (args || "").trim().toLowerCase() || "status";
			const arenaDir = writeArenaPointer(ctx.cwd);
			const activeDir = path.join(arenaDir, "active");

			if (sub === "cancel" || sub === "clear") {
				if (fs.existsSync(activeDir)) {
					fs.rmSync(activeDir, { recursive: true, force: true });
					ctx.ui.notify("[Arena] Cleared active staged session.", "info");
				} else {
					ctx.ui.notify("[Arena] No active staged session to cancel.", "info");
				}
				return;
			}

			try {
				const standing = runArenaPy(ctx.cwd, ["standing"]);
				const g = standing.global || {};
				const hasActive = fs.existsSync(path.join(activeDir, "manifest.json"));
				ctx.ui.notify(
					`[Arena] CF ${g.rating} (${g.tier}) · Rated Solved: ${g.rated_solved}/${g.rated_attempted} · Guided Solved: ${g.unrated_solved || 0} · Streak: ${g.streak}${hasActive ? " · [Active session staged for <leader>ma]" : ""}`,
					"info",
				);
			} catch (err: any) {
				ctx.ui.notify(`[Arena] ${err?.message || err}`, "error");
			}
		},
	});
}
