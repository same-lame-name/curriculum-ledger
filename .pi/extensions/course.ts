/**
 * course — Narrow cross-boundary LLM tool for teacher:themecp (delegates to learn.ts).
 *
 * Exposes strictly `create` (brand-new targeted course + starter sources/, never
 * overwriting or touching active pointers) and `detach` (clean exit from ThemeCP).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { createTargetedCourse, detachActiveSession, findVaultRoot } from "./learn.ts";

const CourseSourceSchema = Type.Object({
	filename: Type.String({ description: 'Filename under courses/<slug>/sources/ (e.g. "gap-brief.md").' }),
	content: Type.String({ description: "Markdown content for the starter source brief (statements/constraints/gap context, never solutions)." }),
});

const CourseToolParams = Type.Object({
	action: Type.Union([Type.Literal("create"), Type.Literal("detach")], {
		description:
			'"create": scaffold a targeted courses/<slug>/ directory with goal and starter sources/ without touching active session pointers. "detach": cleanly exit the current ThemeCP sitting back to user mode.',
	}),
	slug: Type.Optional(
		Type.String({
			description: 'Short, human-typeable kebab-case intent slug for "create" (2-3 words, e.g. "tree-rerooting", "monotonic-deque").',
		}),
	),
	goal: Type.Optional(Type.String({ description: 'Confirmed learning goal for "create".' })),
	contextNote: Type.Optional(Type.String({ description: 'Concise diagnostic/gap context seeded for intake probes in "create".' })),
	sources: Type.Optional(Type.Array(CourseSourceSchema, { description: 'Starter files to write natively into courses/<slug>/sources/.' })),
});

export default function courseToolExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "course",
		label: "course",
		description:
			"Manage course lifecycle transitions (`create` or `detach`):\n" +
			"- create: Scaffold a targeted course (`courses/<slug>/{course.md,sessions/,sources/}`) when transitioning from diagnosis or gap discovery into a focused course, only after confirming the target slug and goal with the student. Never alters active pointers or overwrites existing courses.\n" +
			"- detach: Cleanly exit a ThemeCP sitting (unlinking the session pointer and restoring the user principal) when switching to a course or closing practice; confirm explicitly via `ask_user_question` before abandoning any unsettled active Arena session.",
		parameters: CourseToolParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const vaultRoot = findVaultRoot(ctx.cwd);
			if (params.action === "detach") {
				detachActiveSession(vaultRoot);
				return {
					content: [{ type: "text", text: "Session detached cleanly. Principal restored to user." }],
					details: { action: "detach", ok: true },
				};
			}

			if (params.action === "create") {
				const res = createTargetedCourse(ctx.cwd, {
					slug: String(params.slug || ""),
					goal: params.goal,
					contextNote: params.contextNote,
					sources: params.sources,
				});
				return {
					content: [{ type: "text", text: res.error || JSON.stringify(res, null, 2) }],
					details: { action: "create", ...res },
				};
			}

			return {
				content: [{ type: "text", text: `Unknown course action: ${(params as any).action}` }],
				details: { action: (params as any).action, error: "unknown_action" },
			};
		},

		renderCall(args, theme) {
			const tail = args.action === "create" ? `create ${args.slug || ""}` : String(args.action || "");
			return new Text(theme.fg("toolTitle", theme.bold("course ")) + theme.fg("muted", tail), 0, 0);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `course: ${d.error}`), 0, 0);
			if (d?.action === "create") {
				if (d.exists) return new Text(theme.fg("warning", `course "${d.slug}" already exists`), 0, 0);
				if (d.created) return new Text(theme.fg("success", `✓ course created: courses/${d.slug}/`), 0, 0);
			}
			if (d?.action === "detach") return new Text(theme.fg("muted", "✓ sitting detached (user mode restored)"), 0, 0);
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});
}
