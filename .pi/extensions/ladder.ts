import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// ladder — ThemeCP ladder: level tracking, round lifecycle, upsolve gate,
// and per-round statistics for the self-balancing practice methodology.
//
// The ladder owns .pi/ladder/: ladder.py (engine and CLI), state files.
// Everyone else goes through the API — this tool and `ladder.py` — never
// the files directly.
// ────────────────────────────────────────────────────────────────────────────

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

function runLadderPy(cwd: string, args: string[]): any {
	const root = findVaultRoot(cwd);
	const scriptPath = path.join(root, ".pi", "ladder", "ladder.py");
	if (!fs.existsSync(scriptPath)) throw new Error(`Ladder engine missing at ${scriptPath}`);
	let lastErr: unknown = null;
	for (const pyBin of ["python3", "python"]) {
		try {
			const stdout = execFileSync(pyBin, [scriptPath, ...args], {
				cwd: root,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return JSON.parse(stdout.trim());
		} catch (err: any) {
			lastErr = err;
			if (err?.code === "ENOENT") continue;
			const stderr = err?.stderr ? String(err.stderr).trim() : "";
			if (stderr) {
				let message = stderr;
				try {
					const parsed = JSON.parse(stderr);
					if (parsed?.error) message = parsed.error;
				} catch {
					// keep raw text
				}
				throw new Error(message);
			}
			throw err;
		}
	}
	throw lastErr || new Error("Neither python3 nor python was found on PATH");
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

// ── Schema ──────────────────────────────────────────────────────────────────

const LadderParams = Type.Object({
	action: Type.Union([
		Type.Literal("status"),
		Type.Literal("slots"),
		Type.Literal("open_round"),
		Type.Literal("close_round"),
		Type.Literal("clear_upsolve"),
		Type.Literal("waive"),
		Type.Literal("stats"),
		Type.Literal("rounds"),
		Type.Literal("label"),
	], {
		description: '"status": current level, slots, pending upsolve, AK rate. "slots": compute slots for a given level. "open_round": start a new round (blocked if upsolve pending). "close_round": settle a round. "clear_upsolve": mark the upsolve as done. "waive": skip the pending upsolve. "stats": overall, per-slot, and per-theme factual rollups. "rounds": paginated/filtered round records. "label": tag a problem in a round.'
	}),
	level: Type.Optional(Type.Number({ description: 'Level number for "slots" action.' })),
	theme: Type.Optional(Type.String({ description: 'Theme for "open_round" or filter for "rounds": "mixed", "random", or "direct:<technique>".' })),
	problems: Type.Optional(Type.String({ description: 'Comma-separated problem IDs for "open_round".' })),
	titles: Type.Optional(Type.String({ description: 'Comma-separated titles for "open_round" (same order as problems).' })),
	urls: Type.Optional(Type.String({ description: 'Comma-separated URLs for "open_round" (same order as problems).' })),
	domains: Type.Optional(Type.String({ description: 'Comma-separated canonical domains for "open_round" (same order as problems).' })),
	limitMinutes: Type.Optional(Type.Number({ description: 'Round time limit in minutes for "open_round".' })),
	roundId: Type.Optional(Type.String({ description: 'Round ID for "close_round", "label", or single-round "rounds".' })),
	sinceRoundId: Type.Optional(Type.String({ description: 'Cursor round_id for "rounds" (returns rounds chronologically after this ID).' })),
	limit: Type.Optional(Type.Number({ description: 'Max rounds to return for "rounds" (default 20).' })),
	solved: Type.Optional(Type.String({ description: 'Comma-separated problem IDs solved in time for "close_round". Empty string for 0 solved.' })),
	problemId: Type.Optional(Type.String({ description: 'Problem ID for "clear_upsolve", "label".' })),
	reason: Type.Optional(Type.String({ description: 'Reason for "waive".' })),
	labelValue: Type.Optional(Type.String({ description: 'Label for "label": clean, slow-recognition, wrong-idea, buggy-implementation, not-reached.' })),
});

// ── Extension ───────────────────────────────────────────────────────────────

export default function ladderExtension(pi: ExtensionAPI) {
	// Startup self-check and cleanup are handled centrally by .pi/extensions/rbac.ts.

	// ── Tool: ladder ────────────────────────────────────────────────────────
	pi.registerTool({
		name: "ladder",
		label: "ladder",
		description:
			"ThemeCP-only ladder state (keep distinct from global Arena rating tracked in `arena_ledger`): level tracking, P1–P4 slot calibration, AK/drop progression, upsolve gate, round history, and Three-I's telemetry.\n\n" +
			"Workflow & actions:\n" +
			"- Start a ThemeCP sitting with `status` (check level, active round, and any blocking upsolve gate) and `slots` (get the 4 target difficulties/domains for the round).\n" +
			"- Lifecycle order: settle any blocking upsolve via `clear_upsolve` (after verified AC) or `waive` (explicit skip), record the 4-problem round via `open_round`, finalize via `close_round`, and record diagnostic labels per problem via `label` (`clean`, `slow-recognition`, `wrong-idea`, `buggy-implementation`, `not-reached`).\n" +
			"- Use `rounds` and `stats` (`slot_stats` and `theme_stats`) to inspect historical solve rates, solve times, and theme bottlenecks when suggesting focus or writing periodic diagnoses.",
		parameters: LadderParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				let args: string[];
				switch (params.action) {
					case "status":
						args = ["status"];
						break;
					case "slots":
						args = ["slots", "--level", String(params.level)];
						break;
					case "open_round": {
						args = ["open_round", "--theme", params.theme!, "--problems", params.problems!, "--limit-minutes", String(params.limitMinutes)];
						if (params.titles) args.push("--titles", params.titles);
						if (params.urls) args.push("--urls", params.urls);
						if (params.domains) args.push("--domains", params.domains);
						break;
					}
					case "close_round":
						args = ["close_round", "--round-id", params.roundId!, "--solved", params.solved || ""];
						break;
					case "clear_upsolve":
						args = ["clear_upsolve", "--problem-id", params.problemId!];
						break;
					case "waive":
						args = ["waive", "--reason", params.reason || ""];
						break;
					case "stats":
						args = ["stats"];
						break;
					case "rounds": {
						args = ["rounds"];
						if (typeof params.limit === "number") args.push("--limit", String(params.limit));
						if (params.sinceRoundId) args.push("--since-round-id", params.sinceRoundId);
						if (params.theme) args.push("--theme", params.theme);
						if (params.roundId) args.push("--round-id", params.roundId);
						break;
					}
					case "label":
						args = ["label", "--round-id", params.roundId!, "--problem-id", params.problemId!, "--label", params.labelValue!];
						break;
					default:
						throw new Error(`Unknown ladder action: ${(params as any).action}`);
				}
				const result = runLadderPy(ctx.cwd, args);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: params.action, result },
				};
			} catch (err) {
				const msg = errorMessage(err);
				return {
					content: [{ type: "text", text: "ladder error: " + msg }],
					details: { action: params.action, error: msg },
				};
			}
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("ladder ")) + theme.fg("muted", String(args.action || "")),
				0, 0,
			);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `ladder: ${d.error}`), 0, 0);
			if (d?.action === "status" && d.result) {
				const r = d.result;
				const upsolve = r.pending_upsolve ? ` · upsolve: ${r.pending_upsolve.problem_id}` : "";
				return new Text(
					theme.fg("accent", `L${r.level} `) +
					theme.fg("muted", `perf ${r.performance} · [${r.slots?.join(", ")}] · AK ${Math.round((r.ak_rate || 0) * 100)}%${upsolve}`),
					0, 0,
				);
			}
			if (d?.action === "close_round" && d.result) {
				const r = d.result;
				const arrow = r.ak ? "↑" : "↓";
				return new Text(
					theme.fg(r.ak ? "success" : "warning", `${r.solved_count}/${r.total} ${arrow} L${r.level_after} `) +
					theme.fg("muted", r.upsolve_problem_id ? `upsolve: ${r.upsolve_problem_id}` : "AK!"),
					0, 0,
				);
			}
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});

	// ── Command: /themecp ────────────────────────────────────────────────────
	pi.registerCommand("themecp", {
		description: "ThemeCP workspace manager: /themecp [start | close | status | waive <reason>]",
		handler: async (args, ctx: any) => {
			const parts = (args || "").trim().split(/\s+/).filter(Boolean);
			const sub = parts[0]?.toLowerCase() || "start";
			const vaultRoot = findVaultRoot(ctx.cwd);

			if (sub === "close") {
				const courseApi = (globalThis as any).__piCourse;
				if (courseApi?.detach) {
					courseApi.detach(vaultRoot);
				} else {
					try {
						fs.writeFileSync(path.join(vaultRoot, ".active-course"), "none\n", "utf-8");
						fs.writeFileSync(path.join(vaultRoot, ".active-session"), "", "utf-8");
					} catch {
						// ignore pointer write errors
					}
					(globalThis as any).__piMdLog?.unlink?.();
					(globalThis as any).__piTeacher?.deactivate?.();
					(globalThis as any).__piRbac?.setPrincipal?.("user");
				}
				ctx.ui.notify("[ThemeCP] Closed · session unlinked · developer mode restored (principal: user)", "info");
				return;
			}

			if (sub === "status") {
				try {
					const s = runLadderPy(ctx.cwd, ["status"]);
					const upsolve = s.pending_upsolve ? ` · upsolve: ${s.pending_upsolve.problem_id}` : "";
					ctx.ui.notify(
						`[ThemeCP] Level ${s.level} (perf ${s.performance}) · [${s.slots.join(", ")}] · AK ${Math.round((s.ak_rate || 0) * 100)}%${upsolve}`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(`[ThemeCP] ${errorMessage(err)}`, "error");
				}
				return;
			}

			if (sub === "waive") {
				const reason = parts.slice(1).join(" ").trim() || "waived by student";
				try {
					const res = runLadderPy(ctx.cwd, ["waive", "--reason", reason]);
					ctx.ui.notify(`[ThemeCP] Waived upsolve for ${res.problem_id}.`, "info");
				} catch (err) {
					ctx.ui.notify(`[ThemeCP] ${errorMessage(err)}`, "error");
				}
				return;
			}

			// Default: "start" / setup today's sitting — clean previous session artifacts
			(globalThis as any).__piHousekeeping?.purgeSessionArtifacts?.(vaultRoot);
			const practiceDir = path.join(vaultRoot, "practice", "themecp");
			const sessionsDir = path.join(practiceDir, "sessions");
			const roundsDir = path.join(practiceDir, "rounds");
			const diagnosesDir = path.join(practiceDir, "diagnoses");
			fs.mkdirSync(sessionsDir, { recursive: true });
			fs.mkdirSync(roundsDir, { recursive: true });
			fs.mkdirSync(diagnosesDir, { recursive: true });

			const ladderMdPath = path.join(practiceDir, "ladder.md");
			if (!fs.existsSync(ladderMdPath)) {
				const initialLadderMd = `# ThemeCP Ladder\n\n**Current Level:** 11 · **Performance:** 1300\n**Slots:** [800, 1000, 1200, 1200]\n\n## Rounds History\n*(No rounds completed yet)*\n`;
				fs.writeFileSync(ladderMdPath, initialLadderMd, "utf-8");
			}

			const d = new Date();
			const yyyy = d.getFullYear();
			const mm = String(d.getMonth() + 1).padStart(2, "0");
			const dd = String(d.getDate()).padStart(2, "0");
			const dateStr = `${yyyy}-${mm}-${dd}`;
			const sessionFile = path.join(sessionsDir, `${dateStr}.md`);
			if (!fs.existsSync(sessionFile)) {
				fs.writeFileSync(sessionFile, `# ThemeCP Session — ${dateStr}\n\n`, "utf-8");
			}

			// Safe pointer files: write "none\n" to .active-course and set .active-session
			try {
				fs.writeFileSync(path.join(vaultRoot, ".active-course"), "none\n", "utf-8");
				const relSession = path.relative(vaultRoot, sessionFile).replace(/\\/g, "/");
				fs.writeFileSync(path.join(vaultRoot, ".active-session"), relSession + "\n", "utf-8");
			} catch {
				// ignore pointer write errors
			}

			// Link md-log
			const api = (globalThis as any).__piMdLog;
			if (api?.link) {
				api.link(sessionFile);
			} else {
				ctx.ui.notify(`md-log extension not loaded — run /md-log ${sessionFile}`, "warning");
			}

			// Activate teacher voice anchor & RBAC principal for themecp
			(globalThis as any).__piTeacher?.activate?.("themecp");
			(globalThis as any).__piRbac?.setPrincipal?.("teacher:themecp");

			let s: any = null;
			try {
				s = runLadderPy(ctx.cwd, ["status"]);
			} catch {
				// keep null
			}

			const upsolve = s?.pending_upsolve ? ` · upsolve pending: ${s.pending_upsolve.problem_id}` : "";
			const lvlStr = s ? `Level ${s.level} (CF ${s.performance}) · [${s.slots?.join(", ")}]` : "Ladder ready";
			ctx.ui.notify(
				`[ThemeCP] ${lvlStr}${upsolve} · Log: practice/themecp/sessions/${dateStr}.md · Run /skill:themecp when ready!`,
				"info",
			);
		},
	});
}
