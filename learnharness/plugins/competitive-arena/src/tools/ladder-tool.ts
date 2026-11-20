import type { AgentTool } from "@earendil-works/pi-agent-core";
import path from "node:path";
import { Type, type Static } from "typebox";
import { runPythonJson } from "../python-runner.ts";
import { errorMessage } from "../types.ts";

export const LadderParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("status"),
			Type.Literal("slots"),
			Type.Literal("open_round"),
			Type.Literal("close_round"),
			Type.Literal("clear_upsolve"),
			Type.Literal("waive"),
			Type.Literal("stats"),
			Type.Literal("rounds"),
			Type.Literal("label"),
		],
		{
			description:
				'"status": current level, slots, pending upsolve, AK rate. "slots": compute slots for a given level. "open_round": start a new round (blocked if upsolve pending). "close_round": settle a round. "clear_upsolve": mark upsolve AC. "waive": skip pending upsolve. "stats": factual rollups. "rounds": round records. "label": tag a problem diagnostic label.',
		},
	),
	level: Type.Optional(Type.Number({ description: 'Level number for "slots" action.' })),
	theme: Type.Optional(
		Type.String({ description: 'Theme for "open_round" or filter for "rounds": "mixed", "random", or "direct:<technique>".' }),
	),
	problems: Type.Optional(Type.String({ description: 'Comma-separated problem IDs for "open_round".' })),
	titles: Type.Optional(Type.String({ description: 'Comma-separated titles for "open_round".' })),
	urls: Type.Optional(Type.String({ description: 'Comma-separated URLs for "open_round".' })),
	domains: Type.Optional(Type.String({ description: 'Comma-separated canonical domains for "open_round".' })),
	limitMinutes: Type.Optional(Type.Number({ description: 'Round time limit in minutes for "open_round".' })),
	roundId: Type.Optional(Type.String({ description: 'Round ID for "close_round", "label", or single-round "rounds".' })),
	sinceRoundId: Type.Optional(Type.String({ description: 'Cursor round_id for "rounds".' })),
	limit: Type.Optional(Type.Number({ description: 'Max rounds to return for "rounds" (default 20).' })),
	solved: Type.Optional(Type.String({ description: 'Comma-separated problem IDs solved in time for "close_round".' })),
	problemId: Type.Optional(Type.String({ description: 'Problem ID for "clear_upsolve" and "label".' })),
	reason: Type.Optional(Type.String({ description: 'Reason for "waive".' })),
	labelValue: Type.Optional(
		Type.String({ description: 'Label for "label": clean, slow-recognition, wrong-idea, buggy-implementation, not-reached.' }),
	),
});

export type LadderInput = Static<typeof LadderParams>;

const MUTATING_ACTIONS = new Set(["open_round", "close_round", "clear_upsolve", "waive", "label"]);

function requireStr(val: string | undefined, name: string, action: string): string {
	if (typeof val !== "string" || !val.trim()) {
		throw new Error(`Parameter "${name}" is required for ladder action "${action}".`);
	}
	return val.trim();
}

export function buildLadderArgs(params: LadderInput): string[] {
	switch (params.action) {
		case "status":
			return ["status"];
		case "slots": {
			if (typeof params.level !== "number" || !Number.isFinite(params.level)) {
				throw new Error('Parameter "level" is required for ladder action "slots".');
			}
			return ["slots", "--level", String(params.level)];
		}
		case "open_round": {
			const limitMinutes =
				typeof params.limitMinutes === "number" && Number.isFinite(params.limitMinutes)
					? params.limitMinutes
					: 90;
			const args = [
				"open_round",
				"--theme",
				requireStr(params.theme, "theme", "open_round"),
				"--problems",
				requireStr(params.problems, "problems", "open_round"),
				"--limit-minutes",
				String(limitMinutes),
			];
			if (params.titles) args.push("--titles", params.titles);
			if (params.urls) args.push("--urls", params.urls);
			if (params.domains) args.push("--domains", params.domains);
			return args;
		}
		case "close_round":
			return [
				"close_round",
				"--round-id",
				requireStr(params.roundId, "roundId", "close_round"),
				"--solved",
				params.solved ?? "",
			];
		case "clear_upsolve":
			return ["clear_upsolve", "--problem-id", requireStr(params.problemId, "problemId", "clear_upsolve")];
		case "waive":
			return ["waive", "--reason", params.reason ?? ""];
		case "stats":
			return ["stats"];
		case "rounds": {
			const args = ["rounds"];
			if (typeof params.limit === "number") args.push("--limit", String(params.limit));
			if (params.sinceRoundId) args.push("--since-round-id", params.sinceRoundId);
			if (params.theme) args.push("--theme", params.theme);
			if (params.roundId) args.push("--round-id", params.roundId);
			return args;
		}
		case "label":
			return [
				"label",
				"--round-id",
				requireStr(params.roundId, "roundId", "label"),
				"--problem-id",
				requireStr(params.problemId, "problemId", "label"),
				"--label",
				requireStr(params.labelValue, "labelValue", "label"),
			];
		default:
			throw new Error(`Unknown ladder action: ${String((params as { action: unknown }).action)}`);
	}
}

export function createLadderTool(
	dataDir: string,
	onMutate?: (action: string) => void,
): AgentTool<typeof LadderParams> {
	return {
		name: "ladder",
		label: "ThemeCP Ladder",
		description:
			"ThemeCP ladder state: current level, P1–P4 slot calibration, AK/drop progression, upsolve gate, round history, and Three-I's labels. Check `status` (including `pending_upsolve`) before starting a ThemeCP round.",
		parameters: LadderParams,
		async execute(_toolCallId, params, signal) {
			try {
				const args = buildLadderArgs(params);
				const scriptPath = path.join(dataDir, "ladder", "ladder.py");
				const result = await runPythonJson(scriptPath, args, { dataDir, signal });
				if (MUTATING_ACTIONS.has(params.action)) {
					onMutate?.(params.action);
				}
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: params.action, result },
				};
			} catch (error) {
				const msg = errorMessage(error);
				return {
					content: [{ type: "text", text: `ladder error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},
	};
}
