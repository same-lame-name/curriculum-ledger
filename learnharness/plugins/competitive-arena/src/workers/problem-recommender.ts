import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { Type } from "typebox";
import type { ArenaPluginSettings } from "../types.ts";
import { createCatalogTool } from "../tools/catalog-tool.ts";
import { createLadderTool } from "../tools/ladder-tool.ts";
import { resolveWorkerModel } from "./model-resolver.ts";
import { createScratchTools, makeScratchDir } from "./scratch-tools.ts";

export const PROBLEM_RECOMMENDER_WORKER_ID = "problem-recommender";

const RecommenderDomainSchema = Type.Union([
	Type.Literal("Dynamic Programming"),
	Type.Literal("Data Structures"),
	Type.Literal("Math"),
	Type.Literal("Graphs"),
	Type.Literal("Strings"),
	Type.Literal("Geometry"),
	Type.Literal("Implementation"),
	Type.Literal("Algorithmic Techniques (except DP)"),
]);

const StageProblemSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	catalogId: Type.Optional(Type.String()),
	title: Type.String({ minLength: 1 }),
	url: Type.String({ minLength: 1 }),
	platform: Type.Optional(Type.String()),
	difficulty: Type.Optional(Type.Number()),
	domain: Type.Optional(RecommenderDomainSchema),
	statementSummary: Type.String({ minLength: 1 }),
	constraints: Type.Optional(Type.String()),
	samples: Type.Optional(
		Type.Array(
			Type.Object({
				input: Type.String(),
				output: Type.String(),
			}),
		),
	),
	hints: Type.Optional(Type.Array(Type.String())),
	targetConcept: Type.Optional(Type.String()),
});

const StageSetSchema = Type.Object({
	stage_name: Type.String({
		description: "Safe short stage filename (without .json), e.g. round-2026-11-19 or dp-chk-1.",
	}),
	problems: Type.Array(StageProblemSchema, { minItems: 1 }),
});

export function writeStagedProblemSet(
	dataDir: string,
	rawStageName: string,
	problems: readonly unknown[],
): { problems_file: string; count: number } {
	const safeName = rawStageName
		.trim()
		.replace(/\.json$/i, "")
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!safeName) {
		throw new Error(`Invalid stage_name: ${rawStageName}`);
	}
	const setsDir = path.join(dataDir, "catalog", "sets");
	fs.mkdirSync(setsDir, { recursive: true });
	const outPath = path.join(setsDir, `${safeName}.json`);
	const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
	try {
		fs.writeFileSync(tmpPath, JSON.stringify(problems, null, 2) + "\n", "utf-8");
		fs.renameSync(tmpPath, outPath);
	} catch (error) {
		try {
			fs.rmSync(tmpPath, { force: true });
		} catch {
			// ignore
		}
		throw error;
	}
	return {
		problems_file: `catalog/sets/${safeName}.json`,
		count: problems.length,
	};
}

const RECOMMENDER_INSTRUCTIONS = `You curate and vet practice problem sets from the offline Catalog and live judge pages.

Method:
1. Always pass \`excludeAttempted: true\` to \`catalog\` when picking candidate problems so previously attempted Arena problems are excluded.
2. Inspect candidate statements using \`catalog(action="statement")\`; if missing or incomplete, fetch directly with \`web_fetch\` so every problem card ships exact constraints, I/O specs, and samples.
3. Keep student-facing cards free of topic spoilers on \`mixed\` or \`checkpoint\` / ThemeCP rounds.
4. When a \`STAGE\` name is provided, write the vetted problem array with \`stage_problem_set\` (writes \`catalog/sets/<stage>.json\`) so \`arena_run\` can load \`problemsFile\` directly.
5. Call \`submit_result\` with:
   - \`problems_file\`: \`catalog/sets/<stage>.json\` when staged
   - \`report_markdown\`: formatted Problem Card(s) + Coach Notes per problem.`;

const RecommenderResultSchema = Type.Object({
	problems_file: Type.Optional(Type.String()),
	report_markdown: Type.String({ minLength: 1 }),
});

const RecommenderToolParams = Type.Object({
	request: Type.String({
		description:
			"Full problem-picking brief: mode (concept | mix | similar | round), target difficulty band/slots, count, exclusions, and optional STAGE name.",
	}),
	stage_name: Type.Optional(
		Type.String({ description: "Optional stage file name for stage_problem_set (catalog/sets/<stage_name>.json)." }),
	),
});

export function registerProblemRecommenderWorker(
	ctx: PluginBackendContext,
	getSettings: () => ArenaPluginSettings,
): () => void {
	const unregisterWorker = ctx.workers.register({
		id: PROBLEM_RECOMMENDER_WORKER_ID,
		instructions: RECOMMENDER_INSTRUCTIONS,
		resultSchema: RecommenderResultSchema,
		tools(workerCtx) {
			const scratchDir = makeScratchDir(PROBLEM_RECOMMENDER_WORKER_ID, workerCtx.taskId);
			const stageTool: AgentTool<typeof StageSetSchema> = {
				name: "stage_problem_set",
				label: "Stage Problem Set JSON",
				description: "Write an Arena-ready problem array atomically to catalog/sets/<stage_name>.json.",
				parameters: StageSetSchema,
				async execute(_id, params) {
					const res = writeStagedProblemSet(ctx.dataDirectory, params.stage_name, params.problems);
					return {
						content: [
							{
								type: "text",
								text: `Staged ${res.count} problem(s) at ${res.problems_file}.`,
							},
						],
						details: res,
					};
				},
			};
			return [
				createCatalogTool(ctx.dataDirectory),
				createLadderTool(ctx.dataDirectory),
				...createScratchTools(scratchDir, ctx.dataDirectory, { includeWebFetch: true }),
				stageTool,
			];
		},
		validateResult(result) {
			const rec = result as { problems_file?: string; report_markdown?: string };
			if (!rec?.report_markdown?.trim()) {
				throw new Error("report_markdown must be non-empty.");
			}
			if (rec.problems_file) {
				const clean = rec.problems_file.trim();
				if (!/^catalog\/sets\/[a-zA-Z0-9._-]+\.json$/.test(clean)) {
					throw new Error("problems_file must have form catalog/sets/<stage>.json");
				}
				if (!fs.existsSync(path.join(ctx.dataDirectory, clean))) {
					throw new Error(`Staged set does not exist at ${clean}; call stage_problem_set first.`);
				}
			}
		},
	});

	const unregisterTool = ctx.registerTools({
		agents: ["arena", "teacher"],
		create(toolCtx: PluginToolContext) {
			return [
				ctx.createBackgroundTool(toolCtx, {
					name: "problem_recommender",
					label: "Curated Problem Recommender",
					description:
						"Launch the autonomous `problem_recommender` background worker to search the curated catalog, fetch & vet live statements/samples, and stage an Arena-ready set (`catalog/sets/<stage>.json`).",
					parameters: RecommenderToolParams,
					workerId: PROBLEM_RECOMMENDER_WORKER_ID,
					async prepare(input) {
						const model = await resolveWorkerModel(ctx, getSettings());
						const prompt = [
							`BRIEF:\n${input.request.trim()}`,
							input.stage_name ? `STAGE: ${input.stage_name.trim()}` : "",
						]
							.filter(Boolean)
							.join("\n\n");
						return {
							input,
							prompt,
							model,
							maxTurns: 25,
						};
					},
					format(outcome) {
						if (outcome.status !== "succeeded") {
							return {
								text: `problem_recommender did not complete (${outcome.status}): ${outcome.error.message}`,
								data: { status: outcome.status, error: outcome.error },
							};
						}
						const r = outcome.result as { problems_file?: string; report_markdown: string };
						const prefix = r.problems_file ? `STAGE_FILE: ${r.problems_file}\n\n` : "";
						return {
							text: `${prefix}${r.report_markdown}`,
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
