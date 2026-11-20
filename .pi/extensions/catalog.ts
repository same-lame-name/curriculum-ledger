/**
 * catalog — Structured Pi tool interface to `.pi/catalog/catalog.py`.
 *
 * Replaces raw bash execution against `.pi/catalog/catalog.py` (and its
 * internal `.pi/arena/arena.py attempted` lookup) with an encapsulated domain
 * tool governed cleanly by RBAC `domainTools.catalog`.
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

const CatalogParams = Type.Object({
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
	perSlot: Type.Optional(Type.Number({ description: 'Number of ranked candidates per slot for "round" vetting/fallback (1-10, default 1).' })),
	seed: Type.Optional(Type.Number({ description: 'Random seed for reproducible "pick" or "round".' })),
	exclude: Type.Optional(Type.String({ description: "Comma-separated problem IDs, names, or URLs to exclude." })),
	excludeAttempted: Type.Optional(
		Type.Boolean({
			description: "Exclude problems reported as attempted by the Arena ledger (bucket, find, pick, similar, round).",
		}),
	),
});

type CatalogInput = Static<typeof CatalogParams>;

function requireField(val: string | undefined, fieldName: string, action: string): string {
	if (typeof val !== "string" || !val.trim()) {
		throw new Error(`Parameter "${fieldName}" is required for catalog action "${action}".`);
	}
	return val.trim();
}

function appendCommonFlags(args: string[], params: CatalogInput, opts: {
	source?: boolean;
	starred?: boolean;
	diffBand?: boolean;
	limit?: boolean;
	exclude?: boolean;
	excludeAttempted?: boolean;
}): void {
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

function buildCatalogArgs(params: CatalogInput): string[] {
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
			appendCommonFlags(args, params, { source: true, starred: true, diffBand: true, limit: true, exclude: true, excludeAttempted: true });
			break;
		case "find":
			args.push(requireField(params.query, "query", "find"));
			appendCommonFlags(args, params, { source: true, starred: true, diffBand: true, limit: true, exclude: true, excludeAttempted: true });
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
			throw new Error(`Unknown catalog action: ${(params as any).action}`);
	}
	args.push("--json");
	return args;
}

function runCatalogPy(cwd: string, args: string[]): any {
	const root = findVaultRoot(cwd);
	const scriptPath = path.join(root, ".pi", "catalog", "catalog.py");
	if (!fs.existsSync(scriptPath)) throw new Error(`Catalog engine missing at ${scriptPath}`);
	let lastErr: unknown = null;
	for (const py of ["python3", "python"]) {
		try {
			const stdout = execFileSync(py, [scriptPath, ...args], {
				cwd: root,
				encoding: "utf-8",
				timeout: 30_000,
				env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			});
			return JSON.parse(stdout.trim());
		} catch (err: any) {
			lastErr = err;
			if (err?.code === "ENOENT") continue;
			const stdout = err?.stdout ? String(err.stdout).trim() : "";
			if (stdout) {
				try {
					const parsed = JSON.parse(stdout);
					if (parsed?.error) {
						const cands = Array.isArray(parsed.candidates) && parsed.candidates.length > 0
							? ` (candidates: ${parsed.candidates.join(", ")})`
							: "";
						throw new Error(`${parsed.error}${cands}`);
					}
				} catch (innerErr) {
					if (innerErr instanceof Error && innerErr.message !== stdout) throw innerErr;
				}
			}
			const stderr = err?.stderr ? String(err.stderr).trim() : "";
			if (stderr) throw new Error(stderr);
			throw err;
		}
	}
	throw lastErr || new Error("Neither python3 nor python was found on PATH");
}

export default function catalogExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "catalog",
		label: "catalog",
		description:
			"Query the curated offline problem & resource catalog (`domains`, `buckets`, `find`, `pick`, `similar`, `round`, `problem`, `statement`, `resources`).\n\n" +
			"Usage rules:\n" +
			"- Call `domains` and `buckets` first to inspect exact available topic slugs and rating bands before filtering with `find` or `pick`.\n" +
			"- Use `round` (with target ratings/theme) for balanced 4-problem ThemeCP sets, `pick` for scoped course/topic sets, `similar` for targeted remediation/follow-ups, `problem` (metadata, tags, notes) / `statement` (bundled offline markdown statement), and `resources` for articles/editorials/videos.\n" +
			"- Pass `excludeAttempted: true` on `bucket`, `find`, `pick`, `similar`, and `round` so `catalog` cross-references global Arena history and excludes problems the student has already solved or attempted.",
		parameters: CatalogParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const args = buildCatalogArgs(params);
				const result = runCatalogPy(ctx.cwd, args);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: params.action, result },
				};
			} catch (err) {
				const msg = errorMessage(err);
				return {
					content: [{ type: "text", text: `catalog error: ${msg}` }],
					details: { action: params.action, error: msg },
				};
			}
		},

		renderCall(args, theme) {
			const summary = args.query || args.slots || args.buckets || args.domain || "";
			return new Text(
				theme.fg("toolTitle", theme.bold("catalog ")) +
					theme.fg("muted", summary ? `${args.action}: ${summary}` : String(args.action || "")),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `catalog: ${d.error}`), 0, 0);
			if (d?.action === "round" && d.result) {
				const count = Array.isArray(d.result.problems) ? d.result.problems.length : 0;
				return new Text(theme.fg("accent", `round seed=${d.result.seed} `) + theme.fg("muted", `${count} problems`), 0, 0);
			}
			const first = result.content?.[0];
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});
}
