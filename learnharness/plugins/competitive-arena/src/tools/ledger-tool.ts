import type { AgentTool } from "@earendil-works/pi-agent-core";
import path from "node:path";
import { Type, type Static } from "typebox";
import { buildResultMarkdown, cfLabel, formatDuration, formatTimeBreakdown } from "../path-safety.ts";
import { runPythonJson } from "../python-runner.ts";
import { type ArenaResultPayload, errorMessage } from "../types.ts";

export const ArenaLedgerParams = Type.Object({
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
				'"get_standing": global rating/domains/solved IDs, upsolve queue, notes. "inspect": history lookup by problemIds/sessionId/courseSlug. "record_verdict": settle a SUBMITTED problem. "annotate": save a one-line practice note. "abandon_active": prematurely close an open active session after explicit learner confirmation.',
		},
	),
	problemId: Type.Optional(Type.String({ description: 'Problem ID for "record_verdict" and "annotate".' })),
	problemIds: Type.Optional(Type.Array(Type.String(), { description: 'Problem IDs filter for "inspect".' })),
	courseSlug: Type.Optional(Type.String({ description: 'Course slug filter ("none" matches ThemeCP/standalone).' })),
	limit: Type.Optional(Type.Number({ description: 'Max entries to return for "inspect" (default 20).' })),
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
			{ description: 'Checked verdict for "record_verdict".' },
		),
	),
	sessionId: Type.Optional(Type.String({ description: 'Session ID for "record_verdict" or "inspect".' })),
	note: Type.Optional(Type.String({ description: 'One-line diagnostic takeaway for "annotate".' })),
});

export type ArenaLedgerInput = Static<typeof ArenaLedgerParams>;

function originTag(entry: Record<string, unknown>): string {
	if (typeof entry?.course_slug === "string" && entry.course_slug) return `course:${entry.course_slug}`;
	return entry?.purpose === "checkpoint" ? "ThemeCP/checkpoint" : String(entry?.purpose || "standalone");
}

export function formatStandingSummary(s: any): string {
	const g = s?.global || {};
	const domains = Object.entries(s?.domains || {})
		.filter(([, st]: [string, any]) => (st?.attempted || 0) > 0)
		.map(([dom, st]: [string, any]) => {
			const misses =
				Array.isArray(st.recent_failures) && st.recent_failures.length
					? ` (recent misses: ${st.recent_failures.join(", ")})`
					: "";
			return `  - ${dom}: ${st.solved}/${st.attempted} solved, avg difficulty ${st.avg_solved_difficulty || "—"}${misses}`;
		});
	const scopeLabel = s?.course_slug_filter ? ` (filtered by course=${s.course_slug_filter})` : "";
	const lines = [
		`Rating: CF ${g.rating ?? 1200} [${g.tier ?? ""}] (max ${g.max_rating ?? 1200}; rated solved ${g.rated_solved ?? 0}/${g.rated_attempted ?? 0}; unrated solved ${g.unrated_solved || 0}; streak ${g.streak ?? 0})`,
		domains.length ? "Domains:" : "Domains: none attempted yet",
		...domains,
		`Solved (${(s?.solved_problem_ids || []).length}): ${(s?.solved_problem_ids || []).join(", ") || "none"}`,
		`Upsolve queue${scopeLabel}: ${(s?.upsolve_queue || []).map((u: any) => `${u.problem_id} (${u.verdict}, ${originTag(u)})`).join(", ") || "empty"}`,
	];
	if (Array.isArray(s?.pending_submissions) && s.pending_submissions.length) {
		lines.push(
			`Pending checks${scopeLabel}: ${s.pending_submissions.map((p: any) => `${p.problem_id} [${originTag(p)}]`).join(", ")}`,
		);
	}
	if (Array.isArray(s?.recent_notes) && s.recent_notes.length) {
		lines.push(`Recent practice notes${scopeLabel}:`);
		for (const n of s.recent_notes) lines.push(`  - ${n.problem_id} [${originTag(n)}]: ${n.note}`);
	}
	return lines.join("\n");
}

export function formatInspectSummary(entries: any[]): string {
	if (!entries.length) return "No matching entries in Arena history.";
	const lines: string[] = [];
	for (const e of entries) {
		const dur =
			e.budget_seconds > 0
				? `${formatDuration(e.duration_seconds)}/${formatDuration(e.budget_seconds)}`
				: formatDuration(e.duration_seconds);
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

export interface LedgerToolDeps {
	dataDir: string;
	getPracticeDir: () => string;
	abandonActiveSession: () => Promise<ArenaResultPayload>;
	onMutate?: (action: string) => void;
}

export function createLedgerTool(deps: LedgerToolDeps): AgentTool<typeof ArenaLedgerParams> {
	const scriptPath = path.join(deps.dataDir, "arena", "arena.py");

	return {
		name: "arena_ledger",
		label: "Arena Ledger",
		description:
			"Read and update the learner's lifelong competitive programming ledger (`get_standing`, `inspect`, `record_verdict`, `annotate`, `abandon_active`).",
		parameters: ArenaLedgerParams,
		async execute(_toolCallId, params, signal) {
			try {
				const runOpts = {
					dataDir: deps.dataDir,
					practiceDir: deps.getPracticeDir(),
					signal,
				};

				if (params.action === "get_standing") {
					const args = ["standing"];
					if (params.courseSlug) args.push("--course-slug", params.courseSlug.trim());
					const standing = await runPythonJson(scriptPath, args, runOpts);
					return {
						content: [{ type: "text", text: formatStandingSummary(standing) }],
						details: { action: "get_standing", standing },
					};
				}

				if (params.action === "inspect") {
					const args = ["inspect"];
					if (Array.isArray(params.problemIds) && params.problemIds.length) {
						args.push("--problem-ids", params.problemIds.map((p) => p.trim()).filter(Boolean).join(","));
					}
					if (params.sessionId) args.push("--session-id", params.sessionId.trim());
					if (params.courseSlug) args.push("--course-slug", params.courseSlug.trim());
					if (typeof params.limit === "number") args.push("--limit", String(params.limit));
					const entries = await runPythonJson<any[]>(scriptPath, args, runOpts);
					return {
						content: [{ type: "text", text: formatInspectSummary(entries) }],
						details: { action: "inspect", entries },
					};
				}

				if (params.action === "abandon_active") {
					const sessionResult = await deps.abandonActiveSession();
					deps.onMutate?.("abandon_active");
					return {
						content: [{ type: "text", text: buildResultMarkdown(sessionResult) }],
						details: { action: "abandon_active", session: sessionResult },
					};
				}

				if (params.action === "record_verdict") {
					if (!params.problemId?.trim() || !params.verdict) {
						throw new Error('record_verdict requires "problemId" and "verdict"');
					}
					const args = [
						"record_verdict",
						"--problem-id",
						params.problemId.trim(),
						"--verdict",
						params.verdict.trim(),
					];
					if (params.sessionId) args.push("--session-id", params.sessionId.trim());
					const res = await runPythonJson<any>(scriptPath, args, runOpts);
					deps.onMutate?.("record_verdict");
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
					if (!params.problemId?.trim() || !params.note?.trim()) {
						throw new Error('annotate requires "problemId" and "note"');
					}
					const res = await runPythonJson<any>(
						scriptPath,
						["annotate", "--problem-id", params.problemId.trim(), "--note", params.note.trim()],
						runOpts,
					);
					deps.onMutate?.("annotate");
					return {
						content: [{ type: "text", text: `Noted on ${res.problem_id}: ${res.note}` }],
						details: { action: "annotate", result: res },
					};
				}

				throw new Error(`Unknown arena_ledger action: ${String((params as { action: unknown }).action)}`);
			} catch (error) {
				const msg = errorMessage(error);
				return {
					content: [{ type: "text", text: `arena_ledger error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},
	};
}
