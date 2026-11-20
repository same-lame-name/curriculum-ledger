import type { AgentTool } from "@earendil-works/pi-agent-core";
import path from "node:path";
import { Type, type Static } from "typebox";
import { runPythonJson } from "../python-runner.ts";
import { errorMessage } from "../types.ts";

export const CatalogParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("domains"),
			Type.Literal("buckets"),
			Type.Literal("bucket"),
			Type.Literal("find"),
			Type.Literal("problem"),
			Type.Literal("resources"),
			Type.Literal("pick"),
			Type.Literal("similar"),
			Type.Literal("round"),
			Type.Literal("statement"),
		],
		{
			description:
				'"domains": list curriculum domains. "buckets": list buckets (optional domain/bucketType). ' +
				'"bucket": problems & resources in a named bucket (query). "find": keyword search (query). ' +
				'"problem": inspect one problem (query). "resources": tutorials & code templates (query). ' +
				'"pick": mixed practice set across semicolon-separated buckets. ' +
				'"similar": problems sharing buckets with a given problem (query). ' +
				'"round": ThemeCP round for comma-separated difficulty slots. ' +
				'"statement": fetch statement, constraints, and sample test cases (query).',
		},
	),
	query: Type.Optional(
		Type.String({
			description: 'Positional target for "bucket", "find", "problem", "resources", "similar", or "statement".',
		}),
	),
	domain: Type.Optional(Type.String({ description: 'Domain filter for "buckets" (e.g. "Dynamic Programming").' })),
	bucketType: Type.Optional(
		Type.Union([Type.Literal("progvar_concept"), Type.Literal("standalone_utl"), Type.Literal("contest")], {
			description: 'Bucket type filter for "buckets".',
		}),
	),
	buckets: Type.Optional(
		Type.String({ description: 'Semicolon-separated bucket names/ids for "pick" (e.g. "DP on Subsets;DP on Trees").' }),
	),
	slots: Type.Optional(
		Type.String({ description: 'Comma-separated difficulty slots for "round" (e.g. "900,1000,1200,1400").' }),
	),
	theme: Type.Optional(
		Type.String({ description: 'Theme for "round": "random", "mixed", or "direct:<technique>".' }),
	),
	source: Type.Optional(
		Type.Union([Type.Literal("pv"), Type.Literal("utl"), Type.Literal("all")], {
			description: 'Catalog source filter for "bucket" or "find".',
		}),
	),
	starred: Type.Optional(Type.Boolean({ description: 'Only curator-starred items ("bucket", "find", "pick").' })),
	minDiff: Type.Optional(Type.Number({ description: "Minimum CF-scale difficulty." })),
	maxDiff: Type.Optional(Type.Number({ description: "Maximum CF-scale difficulty." })),
	limit: Type.Optional(Type.Number({ description: "Maximum results to return." })),
	count: Type.Optional(Type.Number({ description: 'Number of problems to pick for "pick" (default 3).' })),
	perSlot: Type.Optional(
		Type.Number({ description: 'Number of ranked candidates per slot for "round" vetting/fallback (1-10, default 1).' }),
	),
	seed: Type.Optional(Type.Number({ description: 'Random seed for reproducible "pick" or "round".' })),
	exclude: Type.Optional(Type.String({ description: "Comma-separated problem IDs, names, or URLs to exclude." })),
	excludeAttempted: Type.Optional(
		Type.Boolean({
			description: "Exclude problems reported as attempted by the Arena ledger (bucket, find, pick, similar, round).",
		}),
	),
});

export type CatalogInput = Static<typeof CatalogParams>;

function requireField(val: string | undefined, fieldName: string, action: string): string {
	if (typeof val !== "string" || !val.trim()) {
		throw new Error(`Parameter "${fieldName}" is required for catalog action "${action}".`);
	}
	return val.trim();
}

function appendCommonFlags(
	args: string[],
	params: CatalogInput,
	opts: {
		source?: boolean;
		starred?: boolean;
		diffBand?: boolean;
		limit?: boolean;
		exclude?: boolean;
		excludeAttempted?: boolean;
	},
): void {
	if (opts.source && params.source) args.push("--source", params.source);
	if (opts.starred && params.starred) args.push("--starred");
	if (opts.diffBand) {
		if (params.minDiff !== undefined) args.push("--min-diff", String(params.minDiff));
		if (params.maxDiff !== undefined) args.push("--max-diff", String(params.maxDiff));
	}
	if (opts.limit && params.limit !== undefined) args.push("--limit", String(params.limit));
	if (opts.exclude && params.exclude) args.push("--exclude", params.exclude);
	if (opts.excludeAttempted && params.excludeAttempted) args.push("--exclude-attempted");
}

export function buildCatalogArgs(params: CatalogInput): string[] {
	const args: string[] = [params.action];
	switch (params.action) {
		case "domains":
			break;
		case "buckets":
			if (params.domain) args.push(params.domain);
			if (params.bucketType) args.push("--type", params.bucketType);
			break;
		case "bucket":
			args.push(requireField(params.query, "query", "bucket"));
			appendCommonFlags(args, params, {
				source: true,
				starred: true,
				diffBand: true,
				limit: true,
				exclude: true,
				excludeAttempted: true,
			});
			break;
		case "find":
			args.push(requireField(params.query, "query", "find"));
			appendCommonFlags(args, params, {
				source: true,
				starred: true,
				diffBand: true,
				limit: true,
				exclude: true,
				excludeAttempted: true,
			});
			break;
		case "problem":
		case "statement":
			args.push(requireField(params.query, "query", params.action));
			break;
		case "resources":
			args.push(requireField(params.query, "query", "resources"));
			appendCommonFlags(args, params, { limit: true });
			break;
		case "pick":
			args.push("--buckets", requireField(params.buckets, "buckets", "pick"));
			if (params.count !== undefined) args.push("--count", String(params.count));
			if (params.seed !== undefined) args.push("--seed", String(params.seed));
			appendCommonFlags(args, params, { starred: true, diffBand: true, exclude: true, excludeAttempted: true });
			break;
		case "similar":
			args.push(requireField(params.query, "query", "similar"));
			appendCommonFlags(args, params, { diffBand: true, limit: true, exclude: true, excludeAttempted: true });
			break;
		case "round":
			args.push("--slots", requireField(params.slots, "slots", "round"));
			if (params.theme) args.push("--theme", params.theme);
			if (params.seed !== undefined) args.push("--seed", String(params.seed));
			if (params.perSlot !== undefined) args.push("--per-slot", String(params.perSlot));
			appendCommonFlags(args, params, { exclude: true, excludeAttempted: true });
			break;
		default:
			throw new Error(`Unknown catalog action: ${String((params as { action: unknown }).action)}`);
	}
	args.push("--json");
	return args;
}

export function createCatalogTool(dataDir: string): AgentTool<typeof CatalogParams> {
	return {
		name: "catalog",
		label: "Problem Catalog",
		description:
			"Query the curated offline problem & resource catalog (`domains`, `buckets`, `find`, `pick`, `similar`, `round`, `problem`, `statement`, `resources`). Pass `excludeAttempted: true` when selecting practice sets so already-attempted Arena problems are skipped.",
		parameters: CatalogParams,
		async execute(_toolCallId, params, signal) {
			try {
				const args = buildCatalogArgs(params);
				const scriptPath = path.join(dataDir, "catalog", "catalog.py");
				const result = await runPythonJson(scriptPath, args, { dataDir, signal });
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: params.action, result },
				};
			} catch (error) {
				const msg = errorMessage(error);
				return {
					content: [{ type: "text", text: `catalog error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},
	};
}
