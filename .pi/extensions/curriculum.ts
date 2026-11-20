/**
 * curriculum — Structured Pi tool interface to `.pi/curriculum/curriculum.py`.
 *
 * Replaces raw full-file reads of `courses/<slug>/curriculum.md` with focused
 * enquiries (overview, intake, chapter, practice, lookup) governed cleanly by
 * RBAC `domainTools.curriculum`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

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

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const CurriculumParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("overview"),
			Type.Literal("intake"),
			Type.Literal("chapter"),
			Type.Literal("practice"),
			Type.Literal("lookup"),
		],
		{
			description:
				'"overview": course metadata, section directory, dependency map, intake baseline summary, and numbered chapter index. ' +
				'"intake": Stage 1 diagnostic strands/probes or Stage 2 verified baseline. ' +
				'"chapter": focused bundle for one chapter (problems, source_file paths, rationale, student_delta, focus, owned_when, hold_back, source_flags, practice triggers). ' +
				'"practice": checkpoint schedule, difficulty bands, mix rules, and baseline cautions. ' +
				'"lookup": retrieve any named section/subsection or search across the guide.',
		},
	),
	courseSlug: Type.Optional(
		Type.String({ description: "Course slug (defaults to active course from .active-course)." }),
	),
	chapter: Type.Optional(Type.Number({ description: 'Chapter number (1..K) for "chapter" action.' })),
	afterChapter: Type.Optional(
		Type.Number({ description: 'Optional checkpoint chapter number for "practice" action.' }),
	),
	strand: Type.Optional(Type.String({ description: 'Optional strand filter for "intake" action.' })),
	section: Type.Optional(Type.String({ description: 'Section heading for "lookup" (e.g. "Article map", "Map").' })),
	subsection: Type.Optional(Type.String({ description: 'Optional ### subsection inside section for "lookup".' })),
	query: Type.Optional(
		Type.String({ description: 'Problem ID or keyword for "chapter" (fallback match) or "lookup" search.' }),
	),
});

type CurriculumInput = Static<typeof CurriculumParams>;

function runCurriculumPy(cwd: string, args: string[]): any {
	const root = findVaultRoot(cwd);
	const scriptPath = path.join(root, ".pi", "curriculum", "curriculum.py");
	if (!fs.existsSync(scriptPath)) throw new Error(`Curriculum engine missing at ${scriptPath}`);
	let lastErr: unknown = null;
	for (const pyBin of ["python3", "python"]) {
		try {
			const stdout = execFileSync(pyBin, [scriptPath, ...args], {
				cwd: root,
				encoding: "utf-8",
				timeout: 15_000,
				env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			});
			return JSON.parse(stdout.trim());
		} catch (err: any) {
			lastErr = err;
			if (err?.code === "ENOENT") continue;
			const stderr = err?.stderr ? String(err.stderr).trim() : "";
			if (stderr) {
				try {
					const parsed = JSON.parse(stderr);
					if (parsed?.error) throw new Error(parsed.error);
				} catch {
					throw new Error(stderr);
				}
			}
			throw err;
		}
	}
	throw lastErr || new Error("Neither python3 nor python was found on PATH");
}

function resolveCourseArg(cwd: string, explicit?: string): string {
	if (explicit && explicit.trim()) return explicit.trim();
	const active = (globalThis as any).__piCourse?.active?.();
	if (active?.slug) return String(active.slug);
	const root = findVaultRoot(cwd);
	const pointer = path.join(root, ".active-course");
	if (fs.existsSync(pointer)) {
		const raw = fs.readFileSync(pointer, "utf-8").trim();
		if (raw && raw.toLowerCase() !== "none" && raw.toLowerCase() !== "off") return raw;
	}
	throw new Error("No active course found; resume a course or pass courseSlug.");
}

function buildCurriculumArgs(cwd: string, params: CurriculumInput): string[] {
	const root = findVaultRoot(cwd);
	const slug = resolveCourseArg(cwd, params.courseSlug);
	const args = [params.action, "--course", slug, "--vault-root", root];

	if (params.action === "intake" && params.strand) {
		args.push("--strand", params.strand.trim());
	} else if (params.action === "chapter") {
		if (params.chapter !== undefined) args.push("--chapter", String(params.chapter));
		else if (params.query) args.push("--query", params.query.trim());
		else throw new Error('curriculum "chapter" requires either "chapter" number or "query"');
	} else if (params.action === "practice" && params.afterChapter !== undefined) {
		args.push("--after-chapter", String(params.afterChapter));
	} else if (params.action === "lookup") {
		if (params.section) args.push("--section", params.section.trim());
		if (params.subsection) args.push("--subsection", params.subsection.trim());
		if (params.query) args.push("--query", params.query.trim());
	}
	return args;
}

export default function curriculumExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "curriculum",
		label: "curriculum",
		description:
			"Query a course's guide (`courses/<slug>/curriculum.md`) cleanly without reading raw whole guides.\n\n" +
			"Actions:\n" +
			"- overview: Always call `overview` once at the start of every course sitting (including when resuming a known chapter) before or alongside `chapter`; it supplies global `goal`, dependency `map`, `intake_summary` (`Owns`/`Edge`/`Habits`), and `sections[]` (call `lookup` for framing sections like `Article map` when relevant). Mid-sitting chapter transitions only need `chapter`.\n" +
			"- intake: Pull calibrated Stage 1/2 diagnostic conceptual probes and baseline problems.\n" +
			"- chapter: Load the active lesson's scoped problems, `source_file` paths (open those files directly for full statements/proofs), pedagogical rationale, private `hold_back` cues, and `source_flags` errata. Treat `hold_back` and `source_flags` strictly as backstage preparation cues — hold un-earned punchlines back until the student discovers the reduction, and quietly catch any source card typos before posting.\n" +
			"- practice: Pull band checkpoints and stretch sets.\n" +
			"- lookup: Search specific terms or fetch a named section.",
		parameters: CurriculumParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const args = buildCurriculumArgs(ctx.cwd, params);
				const result = runCurriculumPy(ctx.cwd, args);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: params.action, result },
				};
			} catch (err) {
				const msg = errorMessage(err);
				return {
					content: [{ type: "text", text: `curriculum error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},

		renderCall(args, theme) {
			const tail =
				args.action === "chapter"
					? `chapter ${args.chapter ?? args.query ?? ""}`
					: args.action === "lookup"
						? `lookup ${args.section || args.query || ""}`
						: String(args.action || "overview");
			return new Text(theme.fg("toolTitle", theme.bold("curriculum ")) + theme.fg("muted", tail), 0, 0);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `curriculum: ${d.error}`), 0, 0);
			if (d?.result?.exists === false) {
				return new Text(theme.fg("dim", `${d.result.course_slug}: no curriculum.md yet (stage 0)`), 0, 0);
			}
			if (d?.action === "overview" && d.result) {
				const chs = Array.isArray(d.result.chapters) ? d.result.chapters.length : 0;
				return new Text(theme.fg("accent", `${d.result.course_slug} `) + theme.fg("muted", `stage ${d.result.stage} · ${chs} chapters`), 0, 0);
			}
			if (d?.action === "chapter" && d.result) {
				return new Text(theme.fg("accent", `Ch ${d.result.number}: `) + theme.fg("muted", d.result.title || ""), 0, 0);
			}
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});
}
