import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { Type } from "typebox";
import { resolveConfinedPath } from "../path-safety.ts";
import type { ArenaPluginSettings } from "../types.ts";
import { resolveWorkerModel } from "./model-resolver.ts";
import { createScratchTools, makeScratchDir } from "./scratch-tools.ts";

export const PROBLEM_GRADER_WORKER_ID = "problem-grader";

const ReadPracticeFileSchema = Type.Object({
	relative_path: Type.String({
		description: "Relative path inside the configured Arena practice workspace (e.g. dp_b.cpp).",
	}),
});

const GRADER_INSTRUCTIONS = `You independently grade competitive programming submissions or proposed reductions against problem constraints using an oracle and stress testing.

Method:
1. Inspect the submission (use \`read_practice_file\` if given a practice filename, otherwise read inline submission; fetch missing judge pages with \`web_fetch\`).
2. Inside your isolated /tmp scratch directory, compile C++ with \`g++ -std=c++17 -O2\` and with \`-fsanitize=address,undefined\`.
3. Verify official samples, then stress-test against an independent oracle (brute-force or alternate algorithm) on random + boundary cases within constraints. Time worst-case max constraints under \`-O2\`.
4. If it fails, shrink to the smallest counterexample.
5. Call \`submit_result\` with:
   - \`verdict\`: "PASS" | "WA" | "TLE" | "MLE" | "RE" | "UNSOUND"
   - \`complexity\`: time & space complexity summary (for PASS)
   - \`fragile\`: optional edge-case risk note (for PASS)
   - \`counterexample\`: smallest failing input + expected vs got (for failures)
   - \`summary\`: concise diagnostic summary.`;

const GraderResultSchema = Type.Object({
	verdict: Type.Union([
		Type.Literal("PASS"),
		Type.Literal("WA"),
		Type.Literal("TLE"),
		Type.Literal("MLE"),
		Type.Literal("RE"),
		Type.Literal("UNSOUND"),
	]),
	complexity: Type.Optional(Type.String()),
	fragile: Type.Optional(Type.String()),
	counterexample: Type.Optional(Type.String()),
	summary: Type.String({ minLength: 1 }),
});

const GraderToolParams = Type.Object({
	problem: Type.String({
		description: "Problem title, URL, constraints, and statement/oracle details.",
	}),
	submission: Type.String({
		description: "C++ code inline, a practice filename (e.g. dp_b.cpp), or a textual reduction/proof to stress-check.",
	}),
	question: Type.Optional(
		Type.String({ description: "Specific claim, edge case, or SUBMITTED Arena verdict to verify." }),
	),
});

export function registerProblemGraderWorker(
	ctx: PluginBackendContext,
	getSettings: () => ArenaPluginSettings,
): () => void {
	const unregisterWorker = ctx.workers.register({
		id: PROBLEM_GRADER_WORKER_ID,
		instructions: GRADER_INSTRUCTIONS,
		resultSchema: GraderResultSchema,
		tools(workerCtx) {
			const scratchDir = makeScratchDir(PROBLEM_GRADER_WORKER_ID, workerCtx.taskId);
			const readPracticeTool: AgentTool<typeof ReadPracticeFileSchema> = {
				name: "read_practice_file",
				label: "Read Practice Workspace File",
				description: "Read a learner's solution file inside the configured practice workspace.",
				parameters: ReadPracticeFileSchema,
				async execute(_id, params) {
					const practiceDir = getSettings().practiceDir;
					const target = resolveConfinedPath(practiceDir, params.relative_path, [], "practice file");
					if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
						throw new Error(`Practice file not found: ${params.relative_path}`);
					}
					const content = fs.readFileSync(target, "utf-8");
					return {
						content: [{ type: "text", text: content }],
						details: { path: path.relative(practiceDir, target) },
					};
				},
			};
			return [...createScratchTools(scratchDir, ctx.dataDirectory, { includeWebFetch: true }), readPracticeTool];
		},
		validateResult(result) {
			const rec = result as { verdict?: string; summary?: string };
			if (!rec?.summary?.trim()) {
				throw new Error("summary must be non-empty.");
			}
		},
	});

	const unregisterTool = ctx.registerTools({
		agents: ["arena", "teacher"],
		create(toolCtx: PluginToolContext) {
			return [
				ctx.createBackgroundTool(toolCtx, {
					name: "problem_grader",
					label: "Oracle Problem Grader",
					description:
						"Launch the autonomous `problem_grader` background worker to compile, ASan/UBSan-check, stress-test against a brute-force oracle, and produce PASS or minimal counterexample.",
					parameters: GraderToolParams,
					workerId: PROBLEM_GRADER_WORKER_ID,
					async prepare(input) {
						const model = await resolveWorkerModel(ctx, getSettings());
						const prompt = [
							`PROBLEM:\n${input.problem.trim()}`,
							`SUBMISSION:\n${input.submission.trim()}`,
							input.question ? `QUESTION: ${input.question.trim()}` : "",
						]
							.filter(Boolean)
							.join("\n\n");
						return {
							input,
							prompt,
							model,
							maxTurns: 30,
						};
					},
					format(outcome) {
						if (outcome.status !== "succeeded") {
							return {
								text: `problem_grader did not complete (${outcome.status}): ${outcome.error.message}`,
								data: { status: outcome.status, error: outcome.error },
							};
						}
						const r = outcome.result as {
							verdict: string;
							complexity?: string;
							fragile?: string;
							counterexample?: string;
							summary: string;
						};
						const lines = [`VERDICT: ${r.verdict}`];
						if (r.complexity) lines.push(`Complexity: ${r.complexity}`);
						if (r.fragile) lines.push(`Fragile: ${r.fragile}`);
						if (r.counterexample) lines.push(`Counterexample:\n${r.counterexample}`);
						lines.push(`Summary: ${r.summary}`);
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
