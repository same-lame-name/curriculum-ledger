/**
 * course — workspace scaffolding and session log linker for courses.
 *
 *   /course new <slug>    — scaffold courses/<slug>/course.md + sources/ + today's
 *                           session log, link md-log to it, and set the active course.
 *   /course resume [slug] — with no slug, list resumable courses; with a slug, link
 *                           today's log, record it under ## Session log in course.md,
 *                           and set the active course (run /skill:teach when ready).
 *   /course list          — list all courses and their states.
 *
 * Course layout:
 *   courses/<slug>/course.md           — the teacher's notebook (present state only;
 *                                        template defined in .pi/skills/teach/SKILL.md)
 *   courses/<slug>/curriculum.md       — the course guide (curriculum-architect)
 *   courses/<slug>/sessions/<date>.md  — md-log transcripts, one per day
 *   courses/<slug>/sources/            — source material, when the course has any
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const COURSES_DIR = "courses";

interface MdLogApi {
	link: (filepath: string) => { ok: boolean; message: string };
	unlink: () => { ok: boolean; message: string };
	current: () => string | null;
}

function mdLogApi(): MdLogApi | undefined {
	return (globalThis as any).__piMdLog as MdLogApi | undefined;
}

function today(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function isValidSlug(slug: string): boolean {
	return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

function titleFromSlug(slug: string): string {
	return slug
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

// Mirrors the course.md template in .pi/skills/teach/SKILL.md (and the section
// budgets enforced by teacher.ts). `state:` stays on line 2 for readState().
function courseTemplate(slug: string, options?: { goal?: string; source?: string; contextNote?: string }): string {
	const rawGoal = (options?.goal || "not set yet").replace(/[\r\n]+/g, " ").replace(/^##\s+/gm, "").trim().slice(0, 240);
	const rawSource = (options?.source || "none").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
	const cleanNote = (options?.contextNote || "").replace(/\r\n/g, "\n").replace(/^##\s+/gm, "### ").trim().slice(0, 400);
	const ownsLine = cleanNote ? `targeted focus — ${cleanNote.replace(/\n+/g, "; ")}` : "not known yet";
	const nextLine = options?.goal && options.goal !== "not set yet" ? `run intake probes targeting ${rawGoal}` : "run the intake";

	return `# ${titleFromSlug(slug)}
state: active
source: ${rawSource || "none"}
goal: ${rawGoal || "not set yet"}

## Where the student stands
- Owns: ${ownsLine}
- Building: not known yet
- Slips: none seen yet
- Not yet seen: everything — the intake comes first

## Plan
- [ ] The intake, then the route

## On the board
- Open: nothing
- Their approach so far: none
- Held back: none
- Next: ${nextLine}

## Practice
- Next: none until the plan exists
- Upsolve: none

## Agreements

## For learner.md

## Parked

## Session log
- ${today()} → sessions/${today()}.md
`;
}

function sanitizeSourceFilename(rawName: string, fallbackIndex: number): string {
	const base = path.basename(String(rawName || "").replace(/\\/g, "/")).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+/, "");
	if (!base || base === "." || base === "..") return `brief-${fallbackIndex + 1}.md`;
	return base.includes(".") ? base : `${base}.md`;
}

export function detachActiveSession(vaultRoot: string): void {
	try {
		fs.writeFileSync(path.join(vaultRoot, ".active-course"), "none\n", "utf-8");
		fs.writeFileSync(path.join(vaultRoot, ".active-session"), "", "utf-8");
	} catch {
		// ignore pointer write errors
	}
	mdLogApi()?.unlink();
	(globalThis as any).__piTeacher?.deactivate?.();
	(globalThis as any).__piRbac?.setPrincipal?.("user");
}

export interface CreateCourseInput {
	slug: string;
	goal?: string;
	contextNote?: string;
	sources?: Array<{ filename: string; content: string }>;
}

export function createTargetedCourse(cwd: string, params: CreateCourseInput) {
	const vaultRoot = findVaultRoot(cwd);
	const slug = String(params.slug || "").trim();
	if (!slug || !isValidSlug(slug) || slug.length > 48) {
		return {
			created: false,
			exists: false,
			slug,
			error: `Invalid course slug "${slug}". Use short lowercase kebab-case (e.g. "tree-rerooting").`,
		};
	}
	const courseDir = path.join(vaultRoot, COURSES_DIR, slug);
	const courseFile = path.join(courseDir, "course.md");
	if (fs.existsSync(courseFile)) {
		return { created: false, exists: true, slug, path: `courses/${slug}/` };
	}

	const sourcesDir = path.join(courseDir, "sources");
	fs.mkdirSync(path.join(courseDir, "sessions"), { recursive: true });
	fs.mkdirSync(sourcesDir, { recursive: true });

	const writtenSources: string[] = [];
	const seenNames = new Set<string>();
	if (Array.isArray(params.sources)) {
		for (let i = 0; i < params.sources.length; i++) {
			const item = params.sources[i];
			let safeName = sanitizeSourceFilename(item?.filename, i);
			while (seenNames.has(safeName)) safeName = `${path.parse(safeName).name}-${i + 1}${path.parse(safeName).ext}`;
			seenNames.add(safeName);
			fs.writeFileSync(path.join(sourcesDir, safeName), String(item?.content || "").trimEnd() + "\n", "utf-8");
			writtenSources.push(safeName);
		}
	}

	const sourceHeader = writtenSources.length ? writtenSources.map((s) => `sources/${s}`).join(", ") : "none";
	fs.writeFileSync(
		courseFile,
		courseTemplate(slug, { goal: params.goal, source: sourceHeader, contextNote: params.contextNote }),
		"utf-8",
	);

	return {
		created: true,
		exists: false,
		slug,
		path: `courses/${slug}/`,
		sources: writtenSources,
		nextCommand: `/course resume ${slug}`,
	};
}

function readState(courseFile: string): string {
	try {
		const text = fs.readFileSync(courseFile, "utf-8");
		const m = /^state:\s*(\S+)/m.exec(text);
		return m ? m[1] : "unknown";
	} catch {
		return "unknown";
	}
}

/** Idempotently record today's session link under `## Session log` in `course.md`. */
function ensureSessionLogged(courseFile: string, dateStr: string): void {
	if (!fs.existsSync(courseFile)) return;
	const relLink = `sessions/${dateStr}.md`;
	const entry = `- ${dateStr} → ${relLink}`;
	const src = fs.readFileSync(courseFile, "utf-8").replace(/\r\n/g, "\n");
	if (src.includes(relLink)) return;

	const lines = src.split("\n");
	const secIdx = lines.findIndex((l) => /^##\s+Session log\s*$/.test(l));
	if (secIdx >= 0) {
		let endIdx = lines.length;
		for (let i = secIdx + 1; i < lines.length; i++) {
			if (/^##\s+/.test(lines[i])) {
				endIdx = i;
				break;
			}
		}
		let insertAt = secIdx + 1;
		for (let k = endIdx - 1; k > secIdx; k--) {
			if (lines[k].trim() !== "") {
				insertAt = k + 1;
				break;
			}
		}
		lines.splice(insertAt, 0, entry);
		const out = lines.join("\n").replace(/\n*$/, "\n");
		fs.writeFileSync(courseFile, out, "utf-8");
	} else {
		const trimmed = src.replace(/\s+$/, "");
		fs.writeFileSync(courseFile, `${trimmed}\n\n## Session log\n${entry}\n`, "utf-8");
	}
}

export function findVaultRoot(startDir: string): string {
	let cur = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(cur, ".pi")) || fs.existsSync(path.join(cur, COURSES_DIR))) {
			return cur;
		}
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return startDir;
}

function listCourses(cwd: string): Array<{ slug: string; state: string }> {
	const vaultRoot = findVaultRoot(cwd);
	const dir = path.join(vaultRoot, COURSES_DIR);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => ({ slug: e.name, state: readState(path.join(dir, e.name, "course.md")) }))
		.filter((c) => fs.existsSync(path.join(dir, c.slug, "course.md")));
}

/** The active course, from the workspace's own pointer files (.active-course, .active-session). */
function readActive(cwd: string): { slug: string; sessionFile: string | null } | null {
	const root = findVaultRoot(cwd);
	try {
		const slug = fs.readFileSync(path.join(root, ".active-course"), "utf-8").trim();
		if (!slug || slug.toLowerCase() === "none" || slug.toLowerCase() === "off") return null;
		let sessionFile: string | null = null;
		try {
			const rel = fs.readFileSync(path.join(root, ".active-session"), "utf-8").trim();
			sessionFile = rel ? path.join(root, rel) : null;
		} catch {
			// no session pointer yet
		}
		return { slug, sessionFile };
	} catch {
		return null;
	}
}

/** Create today's session file if needed, record it in course.md, set active pointers, and link md-log. */
function linkSession(courseDir: string, slug: string, ctx: any): boolean {
	const vaultRoot = findVaultRoot(ctx.cwd);
	const sessionsDir = path.join(courseDir, "sessions");
	fs.mkdirSync(sessionsDir, { recursive: true });
	const dateStr = today();
	const sessionFile = path.join(sessionsDir, `${dateStr}.md`);
	if (!fs.existsSync(sessionFile)) {
		fs.writeFileSync(sessionFile, "", "utf-8");
	}
	ensureSessionLogged(path.join(courseDir, "course.md"), dateStr);

	// .active-course and .active-session pointers at the vault root (read by the
	// teacher, the auditor, and curriculum-architect).
	try {
		fs.writeFileSync(path.join(vaultRoot, ".active-course"), slug.trim() + "\n", "utf-8");
		const relSession = path.relative(vaultRoot, sessionFile).replace(/\\/g, "/");
		fs.writeFileSync(path.join(vaultRoot, ".active-session"), relSession + "\n", "utf-8");
	} catch {
		// ignore write failures
	}

	const api = mdLogApi();
	if (!api) {
		ctx.ui.notify(`md-log extension not loaded — run: /md-log ${sessionFile}`, "warning");
		return false;
	}
	const result = api.link(sessionFile);
	if (!result.ok) {
		ctx.ui.notify(result.message, "error");
		return false;
	}

	(globalThis as any).__piTeacher?.activate?.("teach");
	(globalThis as any).__piRbac?.setPrincipal?.("teacher:teach");
	return true;
}

export default function courseExtension(pi: ExtensionAPI) {
	// The course workspace's in-process API. Other extensions (the Arena, the
	// teacher, ThemeCP, course tool) ask here rather than duplicating state logic.
	let lastCwd = process.cwd();
	(globalThis as any).__piCourse = {
		active: () => readActive(lastCwd),
		create: (params: CreateCourseInput, cwd?: string) => createTargetedCourse(cwd || lastCwd, params),
		detach: (cwd?: string) => detachActiveSession(findVaultRoot(cwd || lastCwd)),
	};
	pi.on("session_start", async (_event, ctx) => {
		lastCwd = ctx.cwd;
	});

	pi.registerCommand("course", {
		description: "Course workspace manager: /course new <slug> | /course resume [slug] | /course pause | /course list",
		handler: async (args, ctx: any) => {
			lastCwd = ctx.cwd;
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = parts[0]?.toLowerCase();
			const slug = parts[1]?.trim();

			if (!subcommand || subcommand === "help") {
				ctx.ui.notify("Usage: /course new <slug> | /course resume [slug] | /course pause | /course list", "info");
				return;
			}

			if (subcommand === "new") {
				if (!slug || !isValidSlug(slug)) {
					ctx.ui.notify("Usage: /course new <slug>  (kebab-case, e.g. dynamic-programming)", "warning");
					return;
				}
				const vaultRoot = findVaultRoot(ctx.cwd);
				const courseDir = path.join(vaultRoot, COURSES_DIR, slug);
				const courseFile = path.join(courseDir, "course.md");
				if (fs.existsSync(courseFile)) {
					ctx.ui.notify(`Course "${slug}" already exists — use: /course resume ${slug}`, "warning");
					return;
				}
				(globalThis as any).__piHousekeeping?.purgeSessionArtifacts?.(vaultRoot);
				fs.mkdirSync(path.join(courseDir, "sessions"), { recursive: true });
				fs.mkdirSync(path.join(courseDir, "sources"), { recursive: true });
				fs.writeFileSync(courseFile, courseTemplate(slug), "utf-8");
				if (linkSession(courseDir, slug, ctx)) {
					ctx.ui.notify(
						`[Course: ${slug}] Created · active course set · log: courses/${slug}/sessions/${today()}.md · add sources, then /skill:teach`,
						"info",
					);
				}
				return;
			}

			if (subcommand === "resume") {
				const courses = listCourses(ctx.cwd);
				const resumable = courses.filter((c) => c.state !== "completed");

				if (!slug) {
					if (resumable.length === 0) {
						ctx.ui.notify("No resumable courses found.", "info");
						return;
					}
					const lines = resumable.map((c) => `${c.slug} (${c.state})`).join(", ");
					ctx.ui.notify(`Resumable courses: ${lines} — run: /course resume <slug>`, "info");
					return;
				}

				const vaultRoot = findVaultRoot(ctx.cwd);
				const courseDir = path.join(vaultRoot, COURSES_DIR, slug);
				if (!fs.existsSync(path.join(courseDir, "course.md"))) {
					ctx.ui.notify(`No course "${slug}". Run /course list to see available courses.`, "error");
					return;
				}
				(globalThis as any).__piHousekeeping?.purgeSessionArtifacts?.(vaultRoot);
				if (linkSession(courseDir, slug, ctx)) {
					ctx.ui.notify(
						`[Course: ${slug}] Resumed · active course set · log: courses/${slug}/sessions/${today()}.md · run /skill:teach when ready`,
						"info",
					);
				}
				return;
			}

			if (subcommand === "pause") {
				const vaultRoot = findVaultRoot(ctx.cwd);
				detachActiveSession(vaultRoot);
				ctx.ui.notify("[Course] Paused · session unlinked · developer mode restored (principal: user)", "info");
				return;
			}

			if (subcommand === "list") {
				const courses = listCourses(ctx.cwd);
				if (courses.length === 0) {
					ctx.ui.notify("No courses found.", "info");
					return;
				}
				const lines = courses.map((c) => `${c.slug} (${c.state})`).join(", ");
				ctx.ui.notify(`Courses: ${lines}`, "info");
				return;
			}

			ctx.ui.notify(`Unknown subcommand "${subcommand}". Usage: /course new <slug> | /course resume [slug] | /course pause | /course list`, "warning");
		},
	});
}
