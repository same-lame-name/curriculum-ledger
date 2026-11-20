import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { Type } from "typebox";
import { resolveConfinedPath, sanitizeProblemId } from "../path-safety.ts";
import type { ArenaPluginSettings } from "../types.ts";
import { resolveWorkerModel } from "./model-resolver.ts";
import { createScratchTools, makeScratchDir } from "./scratch-tools.ts";

export const LAB_WORKER_ID = "lab";

const PublishTestSuiteSchema = Type.Object({
	problem_id: Type.String({
		description: "Safe stem identifier for the problem (e.g. dp_b, cf_1800A).",
	}),
	source_dir: Type.Optional(
		Type.String({
			description:
				"Scratch-relative folder (e.g. 'tests' or '.') containing NN.in / NN.out files (and optional checker.cpp/py/sh). Preferred over inline `files`.",
		}),
	),
	files: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({
					description: "Test filename: strictly NN.in, NN.out, or checker.cpp / checker.py / checker.sh.",
				}),
				content: Type.String({
					description: "Exact UTF-8 LF content of the file.",
				}),
			}),
			{ minItems: 2 },
		),
	),
});

const VALID_TEST_FILE_RE = /^(?:\d{2,3}\.(?:in|out)|checker\.(?:cpp|py|sh))$/;

export function collectTestFilesFromScratch(
	scratchDir: string,
	rawSourceDir: string,
): Array<{ name: string; content: string }> {
	const trimmed = rawSourceDir.trim();
	const absDir = trimmed === "." || trimmed === "./"
		? path.resolve(scratchDir)
		: resolveConfinedPath(scratchDir, trimmed, [], "source_dir");

	if (!fs.existsSync(absDir) || fs.lstatSync(absDir).isSymbolicLink() || !fs.statSync(absDir).isDirectory()) {
		throw new Error(`Scratch source_dir does not exist or is not a real directory: ${rawSourceDir}`);
	}

	const collected: Array<{ name: string; content: string }> = [];
	for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
		if (entry.isSymbolicLink() || !entry.isFile()) continue;
		if (!VALID_TEST_FILE_RE.test(entry.name)) continue;
		const fullPath = path.join(absDir, entry.name);
		collected.push({
			name: entry.name,
			content: fs.readFileSync(fullPath, "utf-8"),
		});
	}
	collected.sort((a, b) => a.name.localeCompare(b.name));
	if (collected.length === 0) {
		throw new Error(`No valid NN.in / NN.out test files found in scratch folder: ${rawSourceDir}`);
	}
	return collected;
}

export function publishTestSuiteFromScratchDir(
	dataDir: string,
	scratchDir: string,
	rawProblemId: string,
	sourceDir: string,
): { tests_dir: string; test_count: number; has_checker: boolean } {
	const files = collectTestFilesFromScratch(scratchDir, sourceDir);
	return publishTestSuiteFiles(dataDir, rawProblemId, files);
}

export function publishTestSuiteFiles(
	dataDir: string,
	rawProblemId: string,
	files: readonly { name: string; content: string }[],
): { tests_dir: string; test_count: number; has_checker: boolean } {
	const problemId = sanitizeProblemId(rawProblemId);
	if (!/^[a-zA-Z0-9._-]+$/.test(problemId)) {
		throw new Error(`Invalid problem_id for test suite: ${rawProblemId}`);
	}

	const names = new Set<string>();
	for (const f of files) {
		const fname = f.name.trim();
		if (!VALID_TEST_FILE_RE.test(fname)) {
			throw new Error(
				`Invalid test filename "${f.name}". Allowed: NN.in, NN.out, checker.cpp, checker.py, checker.sh.`,
			);
		}
		if (names.has(fname)) {
			throw new Error(`Duplicate filename in test suite: ${fname}`);
		}
		names.add(fname);
	}

	const inputs = [...names].filter((n) => n.endsWith(".in")).sort();
	const pairs = inputs.filter((inName) => names.has(inName.replace(/\.in$/, ".out")));
	if (pairs.length === 0) {
		throw new Error("Test suite must include at least one matching NN.in and NN.out pair.");
	}

	const testsRoot = path.join(dataDir, "lab", "tests");
	fs.mkdirSync(testsRoot, { recursive: true });
	const finalDir = path.join(testsRoot, problemId);
	const stageDir = path.join(testsRoot, `.tmp-${problemId}-${process.pid}-${Date.now()}`);
	fs.mkdirSync(stageDir, { recursive: true });

	try {
		for (const f of files) {
			const normalized = f.content.replace(/\r\n/g, "\n");
			fs.writeFileSync(path.join(stageDir, f.name.trim()), normalized, "utf-8");
		}
		fs.rmSync(finalDir, { recursive: true, force: true });
		fs.renameSync(stageDir, finalDir);
	} catch (error) {
		try {
			fs.rmSync(stageDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
		throw error;
	}

	return {
		tests_dir: `lab/tests/${problemId}`,
		test_count: pairs.length,
		has_checker: names.has("checker.cpp") || names.has("checker.py") || names.has("checker.sh"),
	};
}

const LAB_INSTRUCTIONS = `You run computational experiments and build verified hidden test suites for Competitive Arena.

Workflow & Safety Rules:
1. Work ONLY inside your isolated /tmp scratch directory via \`write_scratch_file\`, \`read_scratch_file\`, \`list_scratch_files\`, and \`exec_scratch\`. Use \`web_fetch\` when fetching problem statements or constraints from live judge URLs.
2. Prefer running code over hand-waving: compile with \`g++ -std=c++17 -O2\`, cross-check your fast reference solution against a brute-force oracle on small random and adversarial inputs inside constraints, and include official samples verbatim plus boundary/anti-greedy/max-constraint cases.
3. For problems with non-unique valid outputs (multiple valid paths, constructions, floating-point tolerances), write \`checker.cpp\` (taking \`$1=in, $2=out, $3=ans\`; exit 0 on AC, non-zero on WA with one-line reason to stdout) alongside numbered \`01.in\`/\`01.out\`, \`02.in\`/\`02.out\`, ... (typically 15-40 cases).
4. Write all generated test files (\`01.in\`, \`01.out\`, ..., optional \`checker.cpp\`) into a subfolder such as \`tests/\` inside your scratch directory, verify the reference solution passes 100% of them via \`exec_scratch\`, and then call \`publish_test_suite\` with \`{ problem_id, source_dir: "tests" }\` (preferred over huge inline \`files\` payloads).
5. Finally call \`submit_result\` with:
   - \`answer\`: 1-3 concise sentences summarizing what was established or published
   - \`tests_dir\`: the \`lab/tests/<problem_id>\` path returned by \`publish_test_suite\` (when tests were built)
   - \`evidence\`: smallest factual proof (verification counts, sample check, stress runtime/counterexamples).`;

const LabResultSchema = Type.Object({
	answer: Type.String({ minLength: 1 }),
	tests_dir: Type.Optional(Type.String()),
	evidence: Type.String({ minLength: 1 }),
});

const LabToolParams = Type.Object({
	question: Type.String({
		description: "Precise experiment or hidden test suite request.",
	}),
	problem_id: Type.Optional(
		Type.String({
			description: "C++-safe stem (e.g. cf_1800A, dp_f) when building a hidden test suite.",
		}),
	),
	context: Type.String({
		description: "Problem statement, constraints, URL, samples, or claim to verify.",
	}),
});

export function registerLabWorker(
	ctx: PluginBackendContext,
	getSettings: () => ArenaPluginSettings,
): () => void {
	const unregisterWorker = ctx.workers.register({
		id: LAB_WORKER_ID,
		instructions: LAB_INSTRUCTIONS,
		resultSchema: LabResultSchema,
		tools(workerCtx) {
			const scratchDir = makeScratchDir(LAB_WORKER_ID, workerCtx.taskId);
			const publishTool: AgentTool<typeof PublishTestSuiteSchema> = {
				name: "publish_test_suite",
				label: "Publish Hidden Test Suite",
				description:
					"Atomically publish verified NN.in / NN.out pairs (and optional checker) from a scratch `source_dir` (preferred) or inline `files` into lab/tests/<problem_id>/.",
				parameters: PublishTestSuiteSchema,
				async execute(_id, params) {
					const res = params.source_dir
						? publishTestSuiteFromScratchDir(ctx.dataDirectory, scratchDir, params.problem_id, params.source_dir)
						: params.files && params.files.length > 0
							? publishTestSuiteFiles(ctx.dataDirectory, params.problem_id, params.files)
							: (() => {
									throw new Error("Provide `source_dir` (recommended) or non-empty `files`.");
								})();
					return {
						content: [
							{
								type: "text",
								text: `Published ${res.test_count} test pair(s) to ${res.tests_dir}${res.has_checker ? " (with custom checker)" : ""}.`,
							},
						],
						details: res,
					};
				},
			};
			return [...createScratchTools(scratchDir, ctx.dataDirectory, { includeWebFetch: true }), publishTool];
		},
		validateResult(result) {
			const rec = result as { tests_dir?: string; answer?: string; evidence?: string };
			if (!rec?.answer?.trim() || !rec?.evidence?.trim()) {
				throw new Error("Both answer and evidence must be non-empty.");
			}
			if (rec.tests_dir) {
				const clean = rec.tests_dir.trim();
				if (!/^lab\/tests\/[a-zA-Z0-9._-]+$/.test(clean)) {
					throw new Error("tests_dir must have form lab/tests/<problem_id>");
				}
				const abs = path.join(ctx.dataDirectory, clean);
				if (!fs.existsSync(abs)) {
					throw new Error(`Published directory does not exist at ${clean}; call publish_test_suite first.`);
				}
			}
		},
	});

	const unregisterTool = ctx.registerTools({
		agents: ["arena", "teacher"],
		create(toolCtx: PluginToolContext) {
			return [
				ctx.createBackgroundTool(toolCtx, {
					name: "lab",
					label: "CP Lab & Hidden Tests",
					description:
						"Launch the autonomous `lab` background worker to build & stress-test hidden test suites (`lab/tests/<id>/`) or run empirical C++/Python complexity/counterexample experiments.",
					parameters: LabToolParams,
					workerId: LAB_WORKER_ID,
					async prepare(input) {
						const model = await resolveWorkerModel(ctx, getSettings());
						const prompt = [
							`QUESTION: ${input.question.trim()}`,
							input.problem_id ? `PROBLEM_ID: ${input.problem_id.trim()}` : "",
							`CONTEXT:\n${input.context.trim()}`,
						]
							.filter(Boolean)
							.join("\n\n");
						return {
							input,
							prompt,
							model,
							maxTurns: 40,
						};
					},
					format(outcome) {
						if (outcome.status !== "succeeded") {
							return {
								text: `Lab worker did not complete (${outcome.status}): ${outcome.error.message}`,
								data: { status: outcome.status, error: outcome.error },
							};
						}
						const r = outcome.result as { answer: string; tests_dir?: string; evidence: string };
						const lines = [`ANSWER: ${r.answer}`];
						if (r.tests_dir) lines.push(`TESTS_DIR: ${r.tests_dir}`);
						lines.push(`EVIDENCE: ${r.evidence}`);
						return {
							text: lines.join("\n"),
							data: r,
						};
					},
				}),
			];
		},
	});

	return () => {
		unregisterTool();
		unregisterWorker();
	};
}
