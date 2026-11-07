/**
 * course — workspace scaffolding and session log linker for courses.
 *
 *   /course new <slug>    — scaffold courses/<slug>/course.md + sessions/<today>.md,
 *                           then link md-log to the session file.
 *   /course resume [slug] — with no slug, list resumable courses; with a slug,
 *                           link md-log to today's session file for that course.
 *   /course list          — list all existing courses and their states.
 *
 * Scaffolding and auditing only: these commands never interact with the LLM or
 * start teaching. Once linked, any conversation in the session is mirrored to
 * the course's markdown log.
 *
 * Course layout:
 *   courses/<slug>/course.md            — goal, edge map, plan+DAG, node
 *                                         progress, parked topics, session log
 *   courses/<slug>/sessions/<date>.md   — md-log transcripts, one per day
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

function courseTemplate(slug: string): string {
	const title = slug
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
	return `# Course: ${title}
state: active
source: none
scope: open

## Where the student stands
- Solid on: none yet
- Growing edge: none yet
- Watch out for: none yet

## Plan
none yet

## On the board right now
- Working on: Finding our starting point
- Where we left off: Course just created
- Sketch on the board: none yet
- Next move: Map out the plan and check where the student's footing is solid

## Habits & tangents to remember
- Watch out for: none yet
- Parked for later: none

## Session log
- ${today()} → sessions/${today()}.md
`;
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

function findVaultRoot(startDir: string): string {
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

/** Create today's session file if needed, register it in course.md, link it, and set .active-course. */
function linkSession(courseDir: string, slug: string, ctx: any): boolean {
	const vaultRoot = findVaultRoot(ctx.cwd);
	const sessionsDir = path.join(courseDir, "sessions");
	fs.mkdirSync(sessionsDir, { recursive: true });
	const sessionFile = path.join(sessionsDir, `${today()}.md`);
	if (!fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, "", "utf-8");

	// Register the session in course.md's Session log (idempotent per day).
	const courseFile = path.join(courseDir, "course.md");
	const entry = `- ${today()} → sessions/${today()}.md`;
	try {
		const text = fs.readFileSync(courseFile, "utf-8");
		if (!text.includes(entry)) {
			fs.writeFileSync(courseFile, text.trimEnd() + "\n" + entry + "\n", "utf-8");
		}
	} catch {
		// course.md missing/corrupt — ignored here.
	}

	// Update .active-course and .active-session pointer files at vault root
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

	return true;
}

export default function courseExtension(pi: ExtensionAPI) {
	pi.registerCommand("course", {
		description: "Course workspace manager: /course new <slug> | /course resume [slug] | /course list",
		handler: async (args, ctx: any) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = parts[0]?.toLowerCase();
			const slug = parts[1]?.trim();

			if (!subcommand || subcommand === "help") {
				ctx.ui.notify("Usage: /course new <slug> | /course resume [slug] | /course list", "info");
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
				fs.mkdirSync(path.join(courseDir, "sessions"), { recursive: true });
				fs.mkdirSync(path.join(courseDir, "sources"), { recursive: true });
				fs.writeFileSync(courseFile, courseTemplate(slug), "utf-8");
				if (linkSession(courseDir, slug, ctx)) {
					ctx.ui.notify(`[Course: ${slug}] Initialized · Active course set to "${slug}" · Log attached: courses/${slug}/sessions/${today()}.md`, "info");
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
				if (linkSession(courseDir, slug, ctx)) {
					ctx.ui.notify(`[Course: ${slug}] Resumed · Active course set to "${slug}" · Log attached: courses/${slug}/sessions/${today()}.md`, "info");
				}
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

			ctx.ui.notify(`Unknown subcommand "${subcommand}". Usage: /course new <slug> | /course resume [slug] | /course list`, "warning");
		},
	});
}
