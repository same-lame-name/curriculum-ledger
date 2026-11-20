import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { Type } from "typebox";
import { launchExternalEditor, syncArenaPointer } from "../external-contract.ts";
import { sanitizeEditorText } from "../editor-format.ts";
import { resolveConfinedPath, sanitizeProblemId, stripNullish } from "../path-safety.ts";
import { runPythonJson } from "../python-runner.ts";
import { type ArenaPluginSettings, errorMessage } from "../types.ts";
import { type ArenaWatcher, writeJobLink } from "../watcher.ts";

const DomainSchema = Type.Union(
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
	{ description: "Arena domain. Required for rated purposes; optional for guided." },
);

const ArenaSampleSchema = Type.Object({
	input: Type.String({ description: "Exact sample input." }),
	output: Type.String({ description: "Exact expected output." }),
});

const ArenaProblemSchema = Type.Object({
	id: Type.String({ description: 'C++-safe filename stem: <practiceDir>/{id}.cpp (e.g. "dp_b", "cf_1800A").' }),
	catalogId: Type.Optional(Type.String({ description: "Catalog problem ID when it differs from `id`." })),
	title: Type.String({ description: "Plain-text problem title (no LaTeX/Markdown)." }),
	url: Type.String({ description: "Judge URL." }),
	platform: Type.Optional(Type.String({ description: "Judge platform (AtCoder, Codeforces, CSES, USACO, ...)." })),
	difficulty: Type.Optional(
		Type.Number({ description: "CF-scale difficulty (800-3500). Required for rated purposes; optional for guided." }),
	),
	domain: Type.Optional(DomainSchema),
	timeBudgetSeconds: Type.Optional(
		Type.Number({ description: "Per-problem time budget. Calibrated from difficulty vs. rating when omitted." }),
	),
	timeLimitSeconds: Type.Optional(
		Type.Number({ description: "Run-time limit per test for the local judge (default 2)." }),
	),
	statementSummary: Type.String({
		description:
			"Self-contained plain-UTF-8 statement with input/output format for Neovim floating card. Use Unicode math (≤, ≥, 10⁹, O(N log N)); NO $...$ LaTeX or **bold** Markdown.",
	}),
	constraints: Type.Optional(
		Type.String({
			description: "Plain-UTF-8 constraint bounds (e.g. 1 ≤ n ≤ 2·10⁵) and limits; NO $...$ LaTeX.",
		}),
	),
	samples: Type.Optional(
		Type.Array(ArenaSampleSchema, { description: "Sample input/output pairs; sample 1 is staged into input.txt." }),
	),
	hints: Type.Optional(
		Type.Array(Type.String(), {
			description: "Plain-text progressive hints using Unicode math (no $...$ LaTeX/Markdown; dropped in checkpoints).",
		}),
	),
	targetConcept: Type.Optional(
		Type.String({ description: "Plain-text backstage note on the target idea (hidden during blind checkpoints)." }),
	),
	testsDir: Type.Optional(
		Type.String({
			description: "Path to a hidden test suite built by `lab` under `lab/tests/<id>` (optional `.pi/` prefix tolerated).",
		}),
	),
});

export const ArenaRunParams = Type.Object({
	title: Type.String({ description: "Plain-text session title shown in the Arena header (no LaTeX/Markdown)." }),
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
				'"guided": unrated stopwatch; "drill"/"upsolve"/"volume": rated, timed; "checkpoint": ThemeCP rated, pooled timer, blind metadata, locked hints.',
		},
	),
	gradingPolicy: Type.Optional(
		Type.Union([Type.Literal("practice"), Type.Literal("study"), Type.Literal("contest")], {
			description: 'Defaults from purpose: "practice" for guided, "contest" for checkpoint, "study" otherwise.',
		}),
	),
	timerMode: Type.Optional(
		Type.Union([Type.Literal("stopwatch"), Type.Literal("per_problem"), Type.Literal("pooled")], {
			description: 'Defaults from purpose: "stopwatch" for guided, "pooled" for checkpoint, "per_problem" otherwise.',
		}),
	),
	totalTimeBudgetSeconds: Type.Optional(
		Type.Number({ description: "Pooled budget; defaults to the sum of per-problem budgets." }),
	),
	blindMetadata: Type.Optional(
		Type.Boolean({ description: "Hide difficulty, domain, and target concept until session close." }),
	),
	approachNote: Type.Optional(
		Type.Union([Type.Literal("required"), Type.Literal("optional"), Type.Literal("off")], {
			description: 'Prompt for a one-line approach note before coding.',
		}),
	),
	coachNote: Type.Optional(
		Type.String({
			description: "Short plain-UTF-8 note shown at the top of the editor dashboard (use Unicode math, no $...$/Markdown).",
		}),
	),
	strictOrder: Type.Optional(Type.Boolean({ description: "Enforce solving problems strictly in staged order." })),
	courseSlug: Type.Optional(Type.String({ description: "Optional topic/course label." })),
	problems: Type.Optional(Type.Array(ArenaProblemSchema, { description: "Inline problem(s) to stage." })),
	problemsFile: Type.Optional(
		Type.String({
			description: "Relative path to a problem set staged by `problem_recommender` under `catalog/sets/<stage>.json`.",
		}),
	),
});

function importTestsReadOnly(srcDir: string, destDir: string): number {
	if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
		throw new Error(`No such test folder: ${srcDir}`);
	}
	const inputs = fs.readdirSync(srcDir).filter((f) => f.endsWith(".in"));
	const pairs = inputs.filter((f) => fs.existsSync(path.join(srcDir, f.replace(/\.in$/, ".out"))));
	if (pairs.length === 0) {
		throw new Error(`No NN.in / NN.out pairs found in ${srcDir}`);
	}
	fs.rmSync(destDir, { recursive: true, force: true });
	fs.mkdirSync(destDir, { recursive: true });
	for (const inFile of pairs) {
		fs.copyFileSync(path.join(srcDir, inFile), path.join(destDir, inFile));
		const outFile = inFile.replace(/\.in$/, ".out");
		fs.copyFileSync(path.join(srcDir, outFile), path.join(destDir, outFile));
	}
	for (const checkerFile of ["checker.cpp", "checker.py", "checker.sh"]) {
		const srcChecker = path.join(srcDir, checkerFile);
		if (fs.existsSync(srcChecker)) {
			fs.copyFileSync(srcChecker, path.join(destDir, checkerFile));
		}
	}
	return pairs.length;
}

export interface ArenaRunToolDeps {
	ctx: PluginBackendContext;
	toolCtx: PluginToolContext;
	getSettings: () => ArenaPluginSettings;
	watcher: ArenaWatcher;
	pointerPath?: string;
	onChanged?: () => void;
}

export function createArenaRunTool(deps: ArenaRunToolDeps): AgentTool<typeof ArenaRunParams> {
	const dataDir = deps.ctx.dataDirectory;
	const arenaDir = path.join(dataDir, "arena");
	const activeDir = path.join(arenaDir, "active");
	const arenaPy = path.join(arenaDir, "arena.py");
	const setsRoot = path.join(dataDir, "catalog", "sets");
	const labTestsRoot = path.join(dataDir, "lab", "tests");

	return {
		name: "arena_run",
		label: "Arena Run",
		description:
			"Stage problem(s) into the External Editor Arena contract (`manifest.json`, samples, optional `lab` hidden tests, timer). Returns immediately while the learner solves in their external editor; completion wakes this chat automatically via an external async job.",
		parameters: ArenaRunParams,
		async execute(toolCallId, params, signal) {
			const settings = deps.getSettings();
			const fail = (message: string) => ({
				content: [{ type: "text" as const, text: message }],
				details: { status: "unavailable", error: message },
			});

			const manifestPath = path.join(activeDir, "manifest.json");
			if (fs.existsSync(manifestPath)) {
				let openTitle = "An Arena session";
				try {
					openTitle = `"${JSON.parse(fs.readFileSync(manifestPath, "utf-8")).title}"`;
				} catch {
					// keep default
				}
				return fail(
					`${openTitle} is still active in the Arena. Wait for the learner to finish in their editor, or cancel/abandon it in the Arena panel.`,
				);
			}

			// Collect problems from inline list and/or confined problemsFile
			const raw: any[] = Array.isArray(params.problems) ? [...params.problems] : [];
			if (params.problemsFile) {
				try {
					const confinedFile = resolveConfinedPath(
						setsRoot,
						params.problemsFile,
						["catalog/sets", "sets"],
						"problemsFile",
					);
					const parsed = JSON.parse(fs.readFileSync(confinedFile, "utf-8"));
					const list = Array.isArray(parsed)
						? parsed
						: Array.isArray(parsed?.problems)
							? parsed.problems
							: null;
					if (!list) throw new Error("expected a JSON array of problems");
					raw.push(...list);
				} catch (error) {
					return fail(`problemsFile ${params.problemsFile}: ${errorMessage(error)}`);
				}
			}

			if (raw.length === 0) {
				return fail("arena_run requires at least one problem in `problems` or `problemsFile`.");
			}

			const purpose = params.purpose;
			const gradingPolicy =
				params.gradingPolicy ||
				(purpose === "guided" ? "practice" : purpose === "checkpoint" ? "contest" : "study");
			const timerMode =
				params.timerMode ||
				(purpose === "guided" ? "stopwatch" : purpose === "checkpoint" ? "pooled" : "per_problem");
			const blindMetadata =
				params.blindMetadata !== undefined ? Boolean(params.blindMetadata) : purpose === "checkpoint";
			const rated = gradingPolicy !== "practice";
			const approachNote = params.approachNote || (rated ? "optional" : "off");

			const missing: string[] = [];
			raw.forEach((p, idx) => {
				for (const key of ["id", "title", "url", "statementSummary"]) {
					if (typeof p?.[key] !== "string" || !p[key].trim()) {
						missing.push(`problem ${idx + 1}: ${key}`);
					}
				}
				if (rated && typeof p?.difficulty !== "number") {
					missing.push(`problem ${idx + 1}: difficulty (rated run)`);
				}
				if (rated && (typeof p?.domain !== "string" || !p.domain.trim())) {
					missing.push(`problem ${idx + 1}: domain (rated run)`);
				}
			});
			if (missing.length > 0) {
				return fail(`arena_run is missing ${missing.join("; ")}.`);
			}

			let standing: any;
			try {
				standing = await runPythonJson(arenaPy, ["standing"], {
					dataDir,
					practiceDir: settings.practiceDir,
					signal,
				});
			} catch (error) {
				return fail(`Arena ledger unavailable: ${errorMessage(error)}`);
			}
			const currentRating = Number(standing?.global?.rating || 1200);
			const currentTier = String(standing?.global?.tier || "Pupil (CF 1200-1399)");

			// Prepare clean active directory and import hidden tests read-only.
			fs.rmSync(activeDir, { recursive: true, force: true });
			fs.mkdirSync(path.join(activeDir, "scratch"), { recursive: true });
			fs.mkdirSync(settings.practiceDir, { recursive: true });

			const importErrors: string[] = [];
			const importedDirs = new Map<string, string>();
			for (const p of raw) {
				if (typeof p?.testsDir !== "string" || !p.testsDir.trim()) continue;
				const pid = sanitizeProblemId(String(p.id));
				try {
					const confinedTests = resolveConfinedPath(
						labTestsRoot,
						p.testsDir,
						["lab/tests", "tests"],
						"testsDir",
					);
					const destDir = path.join(activeDir, "tests", pid);
					importTestsReadOnly(confinedTests, destDir);
					importedDirs.set(pid, destDir);
				} catch (error) {
					importErrors.push(`${p.id}: ${errorMessage(error)}`);
				}
			}
			if (importErrors.length > 0) {
				fs.rmSync(activeDir, { recursive: true, force: true });
				fs.mkdirSync(activeDir, { recursive: true });
				return fail(`Hidden tests could not be imported — ${importErrors.join("; ")}.`);
			}

			const problems = [];
			for (const p of raw) {
				const id = sanitizeProblemId(String(p.id));
				const difficulty =
					typeof p.difficulty === "number"
						? Math.max(800, Math.min(3500, Math.round(p.difficulty)))
						: undefined;
				let budget =
					typeof p.timeBudgetSeconds === "number" && p.timeBudgetSeconds > 0
						? Math.round(p.timeBudgetSeconds)
						: 0;
				if (!budget && timerMode !== "stopwatch" && difficulty !== undefined) {
					try {
						const res = await runPythonJson<{ budget_seconds?: number }>(
							arenaPy,
							["budget", "--difficulty", String(difficulty), "--rating", String(currentRating)],
							{ dataDir, practiceDir: settings.practiceDir, signal },
						);
						budget = Number(res?.budget_seconds) || 1500;
					} catch {
						budget = 1500;
					}
				}
				const testsDir = importedDirs.get(id);
				problems.push(
					stripNullish({
						id,
						catalogId: typeof p.catalogId === "string" && p.catalogId.trim() ? p.catalogId.trim() : id,
						title: sanitizeEditorText(String(p.title)),
						url: String(p.url).trim(),
						platform: typeof p.platform === "string" && p.platform.trim() ? p.platform.trim() : "Judge",
						difficulty,
						domain: typeof p.domain === "string" && p.domain.trim() ? p.domain.trim() : undefined,
						timeBudgetSeconds: budget,
						timeLimitSeconds:
							typeof p.timeLimitSeconds === "number" && p.timeLimitSeconds > 0 ? p.timeLimitSeconds : 2,
						statementSummary: sanitizeEditorText(String(p.statementSummary)),
						constraints: typeof p.constraints === "string" ? sanitizeEditorText(p.constraints) : "",
						samples: Array.isArray(p.samples) ? p.samples : [],
						hints:
							gradingPolicy === "contest"
								? []
								: Array.isArray(p.hints)
									? p.hints.map((h: unknown) => sanitizeEditorText(String(h))).filter(Boolean)
									: [],
						targetConcept: typeof p.targetConcept === "string" ? sanitizeEditorText(p.targetConcept) : "",
						testsDir,
					}),
				);
			}

			const totalBudget =
				typeof params.totalTimeBudgetSeconds === "number" && params.totalTimeBudgetSeconds > 0
					? Math.round(params.totalTimeBudgetSeconds)
					: problems.reduce((acc, p) => acc + (p.timeBudgetSeconds || 0), 0);

			const sessionId = `arena_${Date.now()}`;
			const manifest = stripNullish({
				sessionId,
				courseSlug: typeof params.courseSlug === "string" && params.courseSlug.trim() ? params.courseSlug.trim() : undefined,
				title: sanitizeEditorText(params.title),
				purpose,
				gradingPolicy,
				timerMode,
				totalTimeBudgetSeconds: totalBudget,
				blindMetadata,
				hintsLocked: gradingPolicy === "contest",
				approachNote,
				strictOrder: Boolean(params.strictOrder),
				coachNote: sanitizeEditorText(params.coachNote || ""),
				studentRating: currentRating,
				studentTier: currentTier,
				createdAt: new Date().toISOString(),
				problems,
			});

			syncArenaPointer(arenaDir, settings.pointerEnabled, deps.pointerPath);
			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
			fs.writeFileSync(path.join(activeDir, "events.jsonl"), "", "utf-8");

			// Register host-owned external job BEFORE launching watcher.
			const jobHandle = deps.ctx.createExternalJob({
				chatId: deps.toolCtx.chatId,
				toolCallId,
				toolName: "arena_run",
				label: `Arena: ${manifest.title}`,
				input: { title: manifest.title, purpose, problems: problems.map((p) => p.id) },
				activity: "waiting_for_editor",
			});

			writeJobLink(activeDir, {
				jobId: jobHandle.jobId,
				chatId: jobHandle.chatId,
				toolCallId: jobHandle.toolCallId,
				sessionId,
				title: manifest.title,
				stagedAt: manifest.createdAt,
			});

			let launchResult: { launched: boolean; message: string } | undefined;
			if (settings.autoLaunch && settings.launchCommand.trim()) {
				const firstId = problems[0]?.id || "solution";
				launchResult = launchExternalEditor(settings, {
					arenaDir,
					manifestPath,
					firstFile: path.join(settings.practiceDir, `${firstId}.cpp`),
				});
			}

			deps.watcher.startWatching();
			deps.onChanged?.();
			deps.ctx.events.emit("arena-changed", { source: "arena_run", action: "staged", sessionId });

			const summaryList = problems
				.map((p) => `${p.title} (${p.id}.cpp${p.testsDir ? ", hidden tests" : ""})`)
				.join("; ");

			return {
				content: [
					{
						type: "text",
						text:
							`Staged in the Arena: ${summaryList}. The learner opens it in their external editor (Neovim: <leader>ma; samples: <leader>mt; hidden judge: <leader>mj; submit/verdict: <leader>mv). ` +
							`The final report and code diffs will wake this conversation automatically once submitted. Do not send a second prompt until the result arrives.`,
					},
				],
				details: {
					...jobHandle.ackDetails,
					status: "staged",
					sessionId,
					title: manifest.title,
					purpose,
					gradingPolicy,
					timerMode,
					totalTimeBudgetSeconds: totalBudget,
					practiceDir: settings.practiceDir,
					arenaDir,
					manifestPath,
					pointerEnabled: settings.pointerEnabled,
					autoLaunched: launchResult?.launched ?? false,
					launchNote: launchResult?.message,
					problems: problems.map((p) => ({
						id: p.id,
						title: p.title,
						url: p.url,
						difficulty: p.difficulty,
						domain: p.domain,
						hasTests: Boolean(p.testsDir),
					})),
				},
			};
		},
	};
}
