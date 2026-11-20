import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { Type } from "typebox";
import { errorMessage } from "../types.ts";

export const BridgeToTeachingParams = Type.Object({
	title: Type.String({
		description: "Concise title for the new Teaching session (e.g. 'Convex Hull Trick & Li Chao Tree').",
	}),
	topic_summary: Type.String({
		description: "What concept or theorem needs formal probing and guided teaching.",
	}),
	proposition_ids: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional knowledge-graph proposition IDs to attach as context for the new session.",
		}),
	),
	problem_context: Type.Optional(
		Type.String({
			description: "Brief context on the problem being solved and where the breakdown happened.",
		}),
	),
	stuck_point: Type.Optional(
		Type.String({
			description: "The exact misconception, invariant gap, or complexity hurdle to address first.",
		}),
	),
});

export function buildTeachingOpeningPrompt(params: {
	topic_summary: string;
	problem_context?: string;
	stuck_point?: string;
}): string {
	const lines = [
		`I want to deeply understand and solidify: ${params.topic_summary.trim()}.`,
	];
	if (params.problem_context?.trim()) {
		lines.push(`Arena problem context: ${params.problem_context.trim()}`);
	}
	if (params.stuck_point?.trim()) {
		lines.push(`Where I got stuck: ${params.stuck_point.trim()}`);
	}
	lines.push("Please probe my current intuition first, locate any gaps, and build up the core mechanism together.");
	return lines.join("\n\n");
}

export function createBridgeToTeachingTool(
	ctx: PluginBackendContext,
): AgentTool<typeof BridgeToTeachingParams> {
	return {
		name: "bridge_to_teaching",
		label: "Bridge to Teaching",
		description:
			"Escalate a conceptual roadblock discovered in the Arena into a dedicated native Teaching session (`Prober → PlanTree → Teacher`). Returns the new session ID and one-click navigation path.",
		parameters: BridgeToTeachingParams,
		async execute(_toolCallId, params) {
			try {
				const openingPrompt = buildTeachingOpeningPrompt(params);
				const propIds = Array.isArray(params.proposition_ids)
					? params.proposition_ids.filter((id) => typeof id === "string" && id.trim().length > 0)
					: [];
				const handle = ctx.createTeachingSession({
					title: params.title.trim(),
					...(propIds.length > 0 ? { propositionIds: propIds } : {}),
					openingPrompt,
				});
				return {
					content: [
						{
							type: "text",
							text: `Created Teaching session "${handle.title}" (${handle.id}). The learner can click "Open Teaching Session" in the card or navigate to ${handle.path}.`,
						},
					],
					details: {
						id: handle.id,
						title: handle.title,
						path: handle.path,
						openingPrompt,
						propositionIds: propIds,
					},
				};
			} catch (error) {
				const msg = errorMessage(error);
				return {
					content: [{ type: "text", text: `bridge_to_teaching error: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	};
}
