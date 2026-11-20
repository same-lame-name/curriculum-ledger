import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfinedPath } from "../src/path-safety.ts";
import { ensureSeeded } from "../src/seed.ts";
import { defaultSettings } from "../src/settings-store.ts";
import { createArenaRunTool } from "../src/tools/arena-run-tool.ts";
import { createBridgeToTeachingTool } from "../src/tools/bridge-tool.ts";
import { createCatalogTool } from "../src/tools/catalog-tool.ts";
import { createLadderTool } from "../src/tools/ladder-tool.ts";
import { createLedgerTool } from "../src/tools/ledger-tool.ts";
import { ArenaWatcher } from "../src/watcher.ts";
import { publishTestSuiteFiles, publishTestSuiteFromScratchDir, registerLabWorker } from "../src/workers/lab.ts";
import { registerProblemGraderWorker } from "../src/workers/problem-grader.ts";
import { registerProblemRecommenderWorker } from "../src/workers/problem-recommender.ts";
import { sanitizeEditorText } from "../src/editor-format.ts";
import { writeStagedProblemSet } from "../src/workers/problem-recommender.ts";
import { createScratchTools } from "../src/workers/scratch-tools.ts";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
let tmpRoot = "";

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ca-tools-test-"));
});

afterEach(() => {
	if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function hasNullValue(value: unknown): boolean {
	if (value === null) return true;
	if (Array.isArray(value)) return value.some(hasNullValue);
	if (value && typeof value === "object") {
		return Object.values(value).some(hasNullValue);
	}
	return false;
}

describe("Python engine domain tools", () => {
	it("executes catalog, ladder, and arena_ledger against seeded dataDir", async () => {
		const dataDir = path.join(tmpRoot, "data");
		const practiceDir = path.join(tmpRoot, "practice");
		fs.mkdirSync(practiceDir, { recursive: true });
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const catalogTool = createCatalogTool(dataDir);
		const catRes = await catalogTool.execute("tc-1", { action: "domains" }, undefined);
		const catDetails = catRes.details as { error?: string; result?: unknown };
		assert.equal(catDetails.error, undefined);
		assert.ok(Array.isArray(catDetails.result) && catDetails.result.length > 0);

		const ladderTool = createLadderTool(dataDir);
		const ladRes = await ladderTool.execute("tc-2", { action: "status" }, undefined);
		const ladDetails = ladRes.details as { error?: string; result?: { level?: number } };
		assert.equal(ladDetails.error, undefined);
		assert.equal(typeof ladDetails.result?.level, "number");

		const ledgerTool = createLedgerTool({
			dataDir,
			getPracticeDir: () => practiceDir,
			abandonActiveSession: async () => {
				throw new Error("unexpected abandon");
			},
		});
		const standRes = await ledgerTool.execute("tc-3", { action: "get_standing" }, undefined);
		const standDetails = standRes.details as { error?: string; standing?: { global?: { rating?: number } } };
		assert.equal(standDetails.error, undefined);
		assert.equal(standDetails.standing?.global?.rating, 1200);
	});
});

describe("arena_run & worker confinement", () => {
	it("publishes hidden tests, stages manifest without null values (Lua safety), and rejects path traversal", async () => {
		const dataDir = path.join(tmpRoot, "data");
		const practiceDir = path.join(tmpRoot, "practice");
		const pointerFile = path.join(tmpRoot, ".pi-arena-root");
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const pub = publishTestSuiteFiles(dataDir, "cf_1800A", [
			{ name: "01.in", content: "3\n1 2 3\r\n" },
			{ name: "01.out", content: "6\r\n" },
		]);
		assert.equal(pub.tests_dir, "lab/tests/cf_1800A");
		assert.equal(pub.test_count, 1);
		assert.equal(
			fs.readFileSync(path.join(dataDir, "lab", "tests", "cf_1800A", "01.in"), "utf-8"),
			"3\n1 2 3\n",
		);

		const externalJobs: unknown[] = [];
		const watcher = new ArenaWatcher({
			dataDir,
			getPracticeDir: () => practiceDir,
			deliverExternalJobResult: async () => {},
			emitNotification: () => {},
		});

		const mockBackendCtx = {
			dataDirectory: dataDir,
			directory: PLUGIN_ROOT,
			createExternalJob(init: unknown) {
				externalJobs.push(init);
				return {
					jobId: "job-1",
					chatId: "chat-1",
					toolCallId: "tc-run",
					ackDetails: { jobId: "job-1", dispatched: true as const },
				};
			},
			events: { emit() {} },
		} as any;

		const settings = { ...defaultSettings(), practiceDir, pointerEnabled: true };
		const arenaRun = createArenaRunTool({
			ctx: mockBackendCtx,
			toolCtx: { chatId: "chat-1", agent: "arena" },
			getSettings: () => settings,
			watcher,
			pointerPath: pointerFile,
		});

		// Path traversal rejection on testsDir
		const badRes = await arenaRun.execute(
			"tc-bad",
			{
				title: "Escape Attempt",
				purpose: "guided",
				problems: [
					{
						id: "p1",
						title: "Test",
						url: "https://codeforces.com/problem/1/A",
						statementSummary: "Sum input.",
						testsDir: "../../etc",
					},
				],
			},
			undefined,
		);
		assert.equal((badRes.details as { status?: string }).status, "unavailable");

		// Valid staging (tolerates .pi/lab/tests/ prefix)
		const okRes = await arenaRun.execute(
			"tc-run",
			{
				title: "CF 1800A Drill",
				purpose: "drill",
				problems: [
					{
						id: "cf_1800A",
						title: "Is It a Cat?",
						url: "https://codeforces.com/contest/1800/problem/A",
						difficulty: 800,
						domain: "Implementation",
						statementSummary: "Check string pattern.",
						samples: [{ input: "1\n4\nmeow\n", output: "YES\n" }],
						testsDir: ".pi/lab/tests/cf_1800A",
					},
				],
			},
			undefined,
		);
		const okDetails = okRes.details as { status?: string; jobId?: string };
		assert.equal(okDetails.status, "staged");
		assert.equal(okDetails.jobId, "job-1");
		assert.equal(externalJobs.length, 1);

		const manifestRaw = JSON.parse(
			fs.readFileSync(path.join(dataDir, "arena", "active", "manifest.json"), "utf-8"),
		);
		assert.equal(hasNullValue(manifestRaw), false, "manifest.json must never contain JSON null (Lua vim.NIL)");
		assert.ok(fs.existsSync(path.join(dataDir, "arena", "active", "tests", "cf_1800A", "01.in")));
		assert.ok(fs.existsSync(path.join(dataDir, "arena", "active", "job-link.json")));
		assert.equal(fs.readFileSync(pointerFile, "utf-8").trim(), path.join(dataDir, "arena"));

		// Second simultaneous stage must fail cleanly while active session exists
		const secondRes = await arenaRun.execute(
			"tc-run-2",
			{
				title: "Second",
				purpose: "guided",
				problems: [{ id: "p2", title: "P2", url: "https://example.com", statementSummary: "hi" }],
			},
			undefined,
		);
		assert.equal((secondRes.details as { status?: string }).status, "unavailable");

		watcher.dispose();
	});

	it("stages problem sets via problem_recommender helper, bridges to teaching, and enforces scratch confinement", async () => {
		const dataDir = path.join(tmpRoot, "data");
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const staged = writeStagedProblemSet(dataDir, "round-1", [
			{
				id: "cf_1000A",
				title: "Sample",
				url: "https://codeforces.com/contest/1000/problem/A",
				statementSummary: "Solve it",
			},
		]);
		assert.equal(staged.problems_file, "catalog/sets/round-1.json");
		assert.ok(fs.existsSync(path.join(dataDir, staged.problems_file)));

		assert.throws(() => resolveConfinedPath(dataDir, "../outside.txt", [], "test"), /escapes/i);

		const scratch = path.join(tmpRoot, "scratch");
		fs.mkdirSync(scratch, { recursive: true });
		const tools = createScratchTools(scratch, dataDir, { includeWebFetch: false });
		const writeTool = tools.find((t) => t.name === "write_scratch_file")!;
		await assert.rejects(() => writeTool.execute("tw-1", { path: "../escape.cpp", content: "x" }, undefined), /escapes/i);
		await writeTool.execute("tw-2", { path: "gen.py", content: "print(42)\n" }, undefined);
		assert.equal(fs.readFileSync(path.join(scratch, "gen.py"), "utf-8"), "print(42)\n");

		let createdArgs: unknown = null;
		const bridgeTool = createBridgeToTeachingTool({
			createTeachingSession(init: unknown) {
				createdArgs = init;
				return { id: "teach-99", title: "Convex Hull Trick", path: "/chat/teach-99" };
			},
		} as any);
		const brRes = await bridgeTool.execute(
			"tb-1",
			{
				title: "Convex Hull Trick",
				topic_summary: "Dynamic hull maintenance with Li Chao tree",
				proposition_ids: ["prop-1"],
			},
			undefined,
		);
		assert.equal((brRes.details as { id?: string }).id, "teach-99");
		assert.ok(createdArgs && typeof createdArgs === "object");
	});

	it("publishes lab tests via scratch source_dir and sanitizes Neovim manifest prose while preserving samples", async () => {
		const dataDir = path.join(tmpRoot, "data-2");
		const practiceDir = path.join(tmpRoot, "practice-2");
		const scratch = path.join(tmpRoot, "lab-scratch");
		fs.mkdirSync(path.join(scratch, "tests"), { recursive: true });
		fs.writeFileSync(path.join(scratch, "tests", "gen.py"), "# ignored non-test helper\n", "utf-8");
		fs.writeFileSync(path.join(scratch, "tests", "01.in"), "2\r\n3 4\r\n", "utf-8");
		fs.writeFileSync(path.join(scratch, "tests", "01.out"), "7\r\n", "utf-8");
		fs.writeFileSync(path.join(scratch, "tests", "checker.cpp"), "int main() { return 0; }\r\n", "utf-8");

		const dirPub = publishTestSuiteFromScratchDir(dataDir, scratch, "dir_prob", "tests");
		assert.equal(dirPub.tests_dir, "lab/tests/dir_prob");
		assert.equal(dirPub.test_count, 1);
		assert.equal(dirPub.has_checker, true);
		assert.equal(fs.existsSync(path.join(dataDir, "lab", "tests", "dir_prob", "gen.py")), false);
		assert.equal(fs.readFileSync(path.join(dataDir, "lab", "tests", "dir_prob", "01.in"), "utf-8"), "2\n3 4\n");
		assert.throws(() => publishTestSuiteFromScratchDir(dataDir, scratch, "dir_prob", "../outside"), /escapes/i);

		const sanitized = sanitizeEditorText("Given $1 \\le n \\le 10^9$ and **array** `a_i` costs $100, compute \\frac{n}{2}.");
		assert.match(sanitized, /1 ≤ n ≤ 10⁹/);
		assert.ok(!sanitized.includes("$1 \\le"));
		assert.ok(!sanitized.includes("**"));
		assert.ok(sanitized.includes("$100"));
		assert.ok(sanitized.includes("(n)/(2)"));

		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });
		const watcher = new ArenaWatcher({
			dataDir,
			getPracticeDir: () => practiceDir,
			deliverExternalJobResult: async () => {},
			emitNotification: () => {},
		});
		const arenaRun = createArenaRunTool({
			ctx: {
				dataDirectory: dataDir,
				createExternalJob: () => ({ jobId: "job-san", chatId: "chat-san", toolCallId: "tc-san", ackDetails: { jobId: "job-san" } }),
				events: { emit: () => {} },
			} as any,
			toolCtx: { chatId: "chat-san" } as any,
			getSettings: () => ({ ...defaultSettings(), practiceDir, autoLaunch: false }),
			watcher,
			pointerPath: path.join(tmpRoot, ".pi-arena-san"),
		});
		await arenaRun.execute(
			"tc-san",
			{
				title: "**DP Drill** ($O(N)$)",
				purpose: "guided",
				coachNote: "Watch $a_i \\le 10^{18}$ bounds",
				problems: [
					{
						id: "san_a",
						title: "`Sample` $A_1$",
						url: "https://example.com/a",
						statementSummary: "Find **max** $\\sum a_i$ where $1 \\le n \\le 10^5$.",
						constraints: "$n \\le 10^5$, time $\\le 2$s",
						samples: [{ input: "1 2 $3\n", output: "**6**\n" }],
					},
				],
			},
			undefined,
		);
		const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "arena", "active", "manifest.json"), "utf-8"));
		assert.equal(manifest.title, "DP Drill (O(N))");
		assert.equal(manifest.coachNote, "Watch aᵢ ≤ 10¹⁸ bounds");
		assert.equal(manifest.problems[0].statementSummary, "Find max ∑ aᵢ where 1 ≤ n ≤ 10⁵.");
		assert.equal(manifest.problems[0].samples[0].input, "1 2 $3\n");
		assert.equal(manifest.problems[0].samples[0].output, "**6**\n");
		watcher.dispose();
	});

	it("omits arbitrary wall-clock timeoutMs on lab, problem_grader, and problem_recommender", async () => {
		const preparedSpecs: Array<{ name: string; prepared: Record<string, unknown> }> = [];
		const makeMockCtx = () => ({
			workers: { register: () => () => {} },
			inference: {
				catalog: async () => ({
					slots: { cheap: { model: { provider: "deepseek", id: "deepseek-chat" }, thinkingLevel: "high" } },
					providers: [{ id: "deepseek", keyPresent: true }],
				}),
			},
			registerTools: ({ create }: { create: (tc: unknown) => unknown[] }) => {
				create({} as any);
				return () => {};
			},
			createBackgroundTool: (_tc: unknown, def: { name: string; prepare: (input: any) => Promise<Record<string, unknown>> }) => {
				preparedSpecs.push({ name: def.name, prepared: def as unknown as Record<string, unknown> });
				return def;
			},
		});

		const settings = { ...defaultSettings(), practiceDir: path.join(tmpRoot, "practice-3") };
		registerLabWorker(makeMockCtx() as any, () => settings);
		registerProblemGraderWorker(makeMockCtx() as any, () => settings);
		registerProblemRecommenderWorker(makeMockCtx() as any, () => settings);

		const labSpec = preparedSpecs.find((s) => s.name === "lab")!.prepared as { prepare: (i: any) => Promise<Record<string, unknown>> };
		const graderSpec = preparedSpecs.find((s) => s.name === "problem_grader")!.prepared as { prepare: (i: any) => Promise<Record<string, unknown>> };
		const recSpec = preparedSpecs.find((s) => s.name === "problem_recommender")!.prepared as { prepare: (i: any) => Promise<Record<string, unknown>> };

		const pLab = await labSpec.prepare({ question: "q", context: "ctx" });
		const pGrader = await graderSpec.prepare({ problem: "p", submission: "s" });
		const pRec = await recSpec.prepare({ request: "dp" });

		assert.equal(pLab.timeoutMs, undefined);
		assert.equal(pGrader.timeoutMs, undefined);
		assert.equal(pRec.timeoutMs, undefined);
		assert.ok((pLab.maxTurns as number) >= 35);
	});
});
