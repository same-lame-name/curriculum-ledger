import * as fs from "node:fs";
import path from "node:path";
import type { ArenaResultPayload, LiveProblemStatus } from "./types.ts";

export function sanitizeProblemId(rawId: string): string {
	const clean = (rawId || "problem")
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.replace(/^_+|_+$/g, "");
	return clean || "problem";
}

/** Recursively omit undefined and null object properties so Lua never sees truthy vim.NIL. */
export function stripNullish<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => stripNullish(item)) as unknown as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (v === undefined || v === null) continue;
			out[k] = stripNullish(v);
		}
		return out as T;
	}
	return value;
}

/** Resolve `rawInput` strictly inside `allowedRoot`, optionally stripping known prefixes like `.pi/`. */
export function resolveConfinedPath(
	allowedRoot: string,
	rawInput: string,
	stripPrefixes: readonly string[] = [],
	label = "path",
): string {
	const trimmed = rawInput.trim();
	if (!trimmed) {
		throw new Error(`${label} cannot be empty`);
	}
	const rootAbs = path.resolve(allowedRoot);

	let candidateRel = trimmed.replaceAll("\\", "/");
	// If an absolute path inside allowedRoot was passed, accept only if it stays inside rootAbs.
	if (path.isAbsolute(trimmed)) {
		const abs = path.resolve(trimmed);
		const rel = path.relative(rootAbs, abs);
		if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
			throw new Error(`${label} escapes allowed directory: ${rawInput}`);
		}
		return verifyNoSymlinkEscape(rootAbs, abs, label);
	}

	candidateRel = candidateRel.replace(/^\.\//, "");
	if (candidateRel.startsWith(".pi/")) {
		candidateRel = candidateRel.slice(4);
	}
	for (const prefix of stripPrefixes) {
		const normPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
		if (candidateRel.startsWith(normPrefix)) {
			candidateRel = candidateRel.slice(normPrefix.length);
			break;
		}
	}

	if (!candidateRel || candidateRel.includes("\0")) {
		throw new Error(`${label} is invalid: ${rawInput}`);
	}

	const resolved = path.resolve(rootAbs, candidateRel);
	const rel = path.relative(rootAbs, resolved);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`${label} escapes allowed directory: ${rawInput}`);
	}
	return verifyNoSymlinkEscape(rootAbs, resolved, label);
}

/** Verify existing ancestors/targets don't traverse via symlink outside rootAbs. */
export function verifyNoSymlinkEscape(rootAbs: string, targetAbs: string, label = "path"): string {
	const realRoot = fs.existsSync(rootAbs) ? fs.realpathSync(rootAbs) : rootAbs;
	const parts = path.relative(rootAbs, targetAbs).split(path.sep).filter(Boolean);
	let cur = rootAbs;
	for (const part of parts) {
		cur = path.join(cur, part);
		if (fs.existsSync(cur)) {
			const realCur = fs.realpathSync(cur);
			const relFromRealRoot = path.relative(realRoot, realCur);
			if (relFromRealRoot.startsWith("..") || path.isAbsolute(relFromRealRoot)) {
				throw new Error(`${label} resolves outside allowed directory via symlink: ${targetAbs}`);
			}
		}
	}
	return targetAbs;
}

export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds || 0));
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatTimeBreakdown(p: { thinking_seconds?: number | null; duration_seconds?: number }): string {
	const ts = p?.thinking_seconds;
	if (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0) return "";
	const dur = Math.max(0, Math.floor(Number(p?.duration_seconds || 0)));
	const think = Math.min(dur, Math.round(ts));
	const code = Math.max(0, dur - think);
	return ` (thinking ${formatDuration(think)} · coding ${formatDuration(code)})`;
}

export function cfLabel(difficulty: unknown): string {
	return typeof difficulty === "number" ? `CF ${difficulty}` : "CF —";
}

export function readLiveEvents(
	eventsPath: string,
	problemIds: string[],
): {
	attached: boolean;
	activeProblemId: string | null;
	lastEventText: string;
	perProblem: Map<string, LiveProblemStatus>;
} {
	const perProblem = new Map<string, LiveProblemStatus>();
	for (const pid of problemIds) {
		perProblem.set(pid, { id: pid, state: "staged", wrongAttempts: 0, hintsUsed: 0 });
	}
	let attached = false;
	let activeProblemId: string | null = null;
	let lastEventText = "waiting for <leader>ma in editor";

	if (!fs.existsSync(eventsPath)) {
		return { attached, activeProblemId, lastEventText, perProblem };
	}

	try {
		const raw = fs.readFileSync(eventsPath, "utf-8");
		for (const line of raw.split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const ev = JSON.parse(line);
				const type = ev.event || ev.type;
				const pid = ev.problemId || ev.problem_id;
				const st: LiveProblemStatus | undefined = pid
					? perProblem.get(pid) ?? { id: String(pid), state: "accepted", wrongAttempts: 0, hintsUsed: 0 }
					: undefined;
				if (type === "session_opened" || type === "attached") {
					attached = true;
					lastEventText = "Editor attached";
				} else if (type === "problem_accepted" && st && pid) {
					attached = true;
					activeProblemId = String(pid);
					st.state = "accepted";
					lastEventText = `coding ${pid}`;
				} else if (type === "approach_noted" && st && pid) {
					st.approach = String(ev.approach || "");
					lastEventText = `approach noted on ${pid}`;
				} else if (type === "samples_tested" && st && pid) {
					st.samplesPassed = Number(ev.passed);
					st.samplesTotal = Number(ev.total);
					lastEventText = `samples ${ev.passed}/${ev.total} on ${pid}`;
				} else if (type === "judged" && st && pid) {
					st.judge = `${ev.verdict} ${ev.passed}/${ev.total}`;
					lastEventText = `hidden tests on ${pid}: ${st.judge}`;
				} else if (type === "hint_used" && st && pid) {
					st.hintsUsed = Number(ev.hintsUsed || st.hintsUsed + 1);
					lastEventText = `hint ${st.hintsUsed} on ${pid}`;
				} else if (type === "attempt_logged" && st && pid) {
					st.wrongAttempts = Number(ev.wrongAttempts || st.wrongAttempts + 1);
					st.verdict = String(ev.verdict || "");
					lastEventText = `attempt ${st.wrongAttempts} on ${pid}: ${st.verdict}`;
				} else if (type === "problem_verdict" && st && pid) {
					st.state = "verdict";
					st.verdict = String(ev.verdict || "");
					lastEventText = `${st.verdict} on ${pid}`;
				} else if (type === "session_closed") {
					lastEventText = "session closed — settling ledger";
				}
				if (pid && st) perProblem.set(String(pid), st);
			} catch {
				// partial JSONL line while editor writes
			}
		}
	} catch {
		// transient read error
	}

	return { attached, activeProblemId, lastEventText, perProblem };
}

export function buildResultMarkdown(r: ArenaResultPayload): string {
	const lines: string[] = [];
	const sign = (r.rating_delta || 0) >= 0 ? "+" : "";
	lines.push(
		`Arena session finished: **${r.title}** [purpose=${r.purpose}, policy=${r.grading_policy}, timer=${r.timer_mode}]`,
	);
	lines.push(`Rating: ${r.rating_before} -> ${r.rating_after} (${sign}${r.rating_delta}) [${r.tier}]`);
	lines.push("");

	for (const p of r.problems || []) {
		const ot = p.overtime_seconds > 0 ? ` (+${formatDuration(p.overtime_seconds)} over budget)` : "";
		const budget = p.budget_seconds > 0 ? ` / budget ${formatDuration(p.budget_seconds)}` : "";
		const pending = p.pending_verdict
			? " [pending — inspect submission, then settle with arena_ledger record_verdict]"
			: "";
		const pSign = (p.rating_delta || 0) >= 0 ? "+" : "";
		const elo = p.rated
			? ` | rating ${p.rating_before} -> ${p.rating_after} (${pSign}${p.rating_delta})`
			: " | unrated";
		lines.push(`### ${p.title} (\`${p.id}\`, ${cfLabel(p.difficulty)}, ${p.domain || "no domain"})`);
		if (p.url) lines.push(`- URL: ${p.url}`);
		lines.push(`- Verdict: \`${p.verdict}\`${pending}${elo}`);
		const split = formatTimeBreakdown(p);
		const solvedAt = p.solved_at_seconds > 0 ? ` | solved at round clock ${formatDuration(p.solved_at_seconds)}` : "";
		lines.push(
			`- Total time: ${formatDuration(p.duration_seconds)}${budget}${ot}${split}${solvedAt} | wrong attempts: ${p.wrong_attempts} | hints: ${p.hints_used}`,
		);
		if (p.approach) lines.push(`- Approach (before coding): "${p.approach}"`);
		if (p.local_judge) {
			const lj = p.local_judge;
			lines.push(
				`- Hidden tests: ${lj.verdict ?? "—"} ${lj.passed ?? 0}/${lj.total ?? 0}${lj.failedCase ? ` (first failure: ${lj.failedCase})` : ""}`,
			);
		}
		if (p.reflection) lines.push(`- Reflection: "${p.reflection}"`);
		if (Array.isArray(p.attempts) && p.attempts.length > 0) {
			lines.push(
				`- Attempts: ${p.attempts
					.map((a) => `#${a.attempt ?? "?"} ${a.verdict ?? ""} @ ${formatDuration(a.elapsedSeconds || a.elapsed_seconds || 0)}`)
					.join(" -> ")}`,
			);
		}
		if (Array.isArray(p.attempt_diffs) && p.attempt_diffs.length > 0) {
			lines.push("", "#### Changes between attempts");
			for (const d of p.attempt_diffs) {
				lines.push("```diff\n" + d.diff + "\n```");
			}
		}
		lines.push("", `#### Final code (\`${p.id}.cpp\`)`);
		lines.push(p.final_code && p.final_code.trim() ? "```cpp\n" + p.final_code.trim() + "\n```" : "(no code written)");
		lines.push("");
	}

	return lines.join("\n");
}
