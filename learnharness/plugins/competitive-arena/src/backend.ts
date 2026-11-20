import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { checkEnvironment, launchExternalEditor, syncArenaPointer } from "./external-contract.ts";
import { runHousekeeping } from "./housekeeping.ts";
import { ARENA_INSTRUCTIONS, TEACHER_INSTRUCTIONS } from "./instructions.ts";
import { runPythonJson } from "./python-runner.ts";
import { ensureSeeded } from "./seed.ts";
import { loadSettings, saveSettings } from "./settings-store.ts";
import { createArenaRunTool } from "./tools/arena-run-tool.ts";
import { createBridgeToTeachingTool } from "./tools/bridge-tool.ts";
import { createCatalogTool } from "./tools/catalog-tool.ts";
import { createLadderTool } from "./tools/ladder-tool.ts";
import { createLedgerTool } from "./tools/ledger-tool.ts";
import {
	type ArenaDashboardState,
	type ArenaPluginSettings,
	errorMessage,
} from "./types.ts";
import { ArenaWatcher, readActiveSnapshot } from "./watcher.ts";
import { registerLabWorker } from "./workers/lab.ts";
import { registerProblemGraderWorker } from "./workers/problem-grader.ts";
import { registerProblemRecommenderWorker } from "./workers/problem-recommender.ts";

function isDisposableDataDir(dataDir: string): boolean {
	const resolved = path.resolve(dataDir);
	const tmpResolved = path.resolve(os.tmpdir());
	return resolved === tmpResolved || resolved.startsWith(tmpResolved + path.sep);
}

export function activate(ctx: PluginBackendContext): () => void {
	const dataDir = ctx.dataDirectory;
	const arenaDir = path.join(dataDir, "arena");
	const arenaPy = path.join(arenaDir, "arena.py");
	const ladderPy = path.join(dataDir, "ladder", "ladder.py");

	ensureSeeded(ctx.directory, dataDir);

	let currentSettings: ArenaPluginSettings = loadSettings(dataDir);
	let revision = 1;
	const bumpRevision = () => {
		revision += 1;
	};

	const shouldSyncPointerOnActivate =
		currentSettings.pointerEnabled &&
		process.env.NODE_ENV !== "test" &&
		process.env.LH_PLUGIN_SMOKE !== "1" &&
		!isDisposableDataDir(dataDir);

	if (shouldSyncPointerOnActivate) {
		syncArenaPointer(arenaDir, true);
	}

	try {
		runHousekeeping(dataDir, currentSettings.artifactTtlDays);
	} catch {
		// Non-fatal on startup; user settings can adjust TTL.
	}

	const watcher = new ArenaWatcher({
		dataDir,
		getPracticeDir: () => currentSettings.practiceDir,
		deliverExternalJobResult: (jobId, result) => ctx.deliverExternalJobResult(jobId, result),
		emitNotification: (topic, data) => ctx.events.emit(topic, data),
		onChanged: bumpRevision,
	});

	void watcher.resumeIfActive().catch(() => {
		// Non-fatal if an orphaned active file cannot settle immediately.
	});

	const cleanups: (() => void)[] = [];
	cleanups.push(() => watcher.dispose());

	cleanups.push(registerLabWorker(ctx, () => currentSettings));
	cleanups.push(registerProblemGraderWorker(ctx, () => currentSettings));
	cleanups.push(registerProblemRecommenderWorker(ctx, () => currentSettings));

	cleanups.push(
		ctx.registerTools({
			agents: ["arena", "teacher"],
			create(toolCtx: PluginToolContext) {
				return [
					createCatalogTool(dataDir),
					createLedgerTool({
						dataDir,
						getPracticeDir: () => currentSettings.practiceDir,
						abandonActiveSession: async () => {
							const res = await watcher.discardActive("abandoned");
							if (!res.sessionResult) {
								throw new Error("No active Arena session is open to abandon.");
							}
							return res.sessionResult;
						},
						onMutate: (action) => {
							bumpRevision();
							ctx.events.emit("arena-changed", { source: "ledger", action });
						},
					}),
					createArenaRunTool({
						ctx,
						toolCtx,
						getSettings: () => currentSettings,
						watcher,
						onChanged: bumpRevision,
					}),
				];
			},
		}),
	);

	cleanups.push(
		ctx.registerTools({
			agents: ["arena"],
			create() {
				return [
					createLadderTool(dataDir, (action) => {
						bumpRevision();
						ctx.events.emit("arena-changed", { source: "ladder", action });
					}),
					createBridgeToTeachingTool(ctx),
				];
			},
		}),
	);

	cleanups.push(ctx.registerInstructions({ agents: ["arena"], text: ARENA_INSTRUCTIONS }));
	cleanups.push(ctx.registerInstructions({ agents: ["teacher"], text: TEACHER_INSTRUCTIONS }));

	async function readRatingSeries(): Promise<import("./types.ts").RatingSeriesPoint[]> {
		const historyPath = path.join(arenaDir, "history.json");
		try {
			if (!fs.existsSync(historyPath)) return [];
			const raw = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
			if (!Array.isArray(raw)) return [];
			const out: import("./types.ts").RatingSeriesPoint[] = [];
			for (const entry of raw) {
				if (!entry || typeof entry !== "object") continue;
				const rec = entry as Record<string, unknown>;
				if (rec.rated !== true || typeof rec.rating_after !== "number" || !Number.isFinite(rec.rating_after)) {
					continue;
				}
				const ratingAfter = Math.round(rec.rating_after);
				const ratingBefore =
					typeof rec.rating_before === "number" && Number.isFinite(rec.rating_before)
						? Math.round(rec.rating_before)
						: ratingAfter;
				const ratingDelta =
					typeof rec.rating_delta === "number" && Number.isFinite(rec.rating_delta)
						? Math.round(rec.rating_delta)
						: ratingAfter - ratingBefore;
				out.push({
					idx: out.length + 1,
					problemId: typeof rec.problem_id === "string" ? rec.problem_id : String(rec.id || `#${out.length + 1}`),
					title: typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : String(rec.problem_id || "Problem"),
					difficulty: typeof rec.difficulty === "number" && Number.isFinite(rec.difficulty) ? Math.round(rec.difficulty) : null,
					verdict: typeof rec.verdict === "string" ? rec.verdict : "—",
					rated: true,
					ratingBefore,
					ratingAfter,
					ratingDelta,
					timestamp: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
				});
			}
			return out;
		} catch {
			return [];
		}
	}

	async function buildDashboardState(): Promise<ArenaDashboardState> {
		const environment = await checkEnvironment(dataDir, currentSettings);
		const ratingSeries = await readRatingSeries();
		let standing: any | null = null;
		let standingError: string | null = null;
		let ladder: any | null = null;
		let ladderRounds: any[] = [];
		let ladderStats: any | null = null;
		let ladderError: string | null = null;

		const runOpts = { dataDir, practiceDir: currentSettings.practiceDir, signal: ctx.signal };

		const [standingRes, ladderStatusRes, roundsRes, statsRes] = await Promise.allSettled([
			runPythonJson(arenaPy, ["standing"], runOpts),
			runPythonJson(ladderPy, ["status"], runOpts),
			runPythonJson<any[]>(ladderPy, ["rounds", "--limit", "10"], runOpts),
			runPythonJson(ladderPy, ["stats"], runOpts),
		]);

		if (standingRes.status === "fulfilled") {
			standing = standingRes.value;
		} else {
			standingError = errorMessage(standingRes.reason);
		}

		if (ladderStatusRes.status === "fulfilled") {
			ladder = ladderStatusRes.value;
		} else {
			ladderError = errorMessage(ladderStatusRes.reason);
		}
		if (roundsRes.status === "fulfilled" && Array.isArray(roundsRes.value)) {
			ladderRounds = roundsRes.value;
		}
		if (statsRes.status === "fulfilled") {
			ladderStats = statsRes.value;
		}

		return {
			revision,
			dataDirectory: dataDir,
			arenaDir,
			settings: currentSettings,
			environment,
			standing,
			standingError,
			ratingSeries,
			ladder,
			ladderRounds,
			ladderStats,
			ladderError,
			active: readActiveSnapshot(dataDir),
		};
	}

	cleanups.push(ctx.handle("get-state", async () => buildDashboardState()));
	cleanups.push(ctx.handle("get-catalog", async () => ctx.inference.catalog()));

	cleanups.push(
		ctx.handle("save-settings", async (input) => {
			currentSettings = saveSettings(dataDir, input);
			syncArenaPointer(arenaDir, currentSettings.pointerEnabled);
			bumpRevision();
			ctx.events.emit("arena-changed", { source: "settings", action: "saved" });
			return buildDashboardState();
		}),
	);

	cleanups.push(
		ctx.handle("sync-pointer", async () => {
			const res = syncArenaPointer(arenaDir, true);
			bumpRevision();
			ctx.events.emit("arena-changed", { source: "pointer", action: "synced" });
			return { ...res, state: await buildDashboardState() };
		}),
	);

	cleanups.push(
		ctx.handle("check-environment", async () => checkEnvironment(dataDir, currentSettings)),
	);

	cleanups.push(
		ctx.handle("launch-editor", async () => {
			const manifestPath = path.join(arenaDir, "active", "manifest.json");
			let firstFile: string | undefined;
			if (fs.existsSync(manifestPath)) {
				try {
					const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
					const firstId = m?.problems?.[0]?.id;
					if (typeof firstId === "string" && firstId.trim()) {
						firstFile = path.join(currentSettings.practiceDir, `${firstId.trim()}.cpp`);
					}
				} catch {
					// ignore unreadable manifest
				}
			}
			return launchExternalEditor(currentSettings, {
				arenaDir,
				manifestPath,
				...(firstFile ? { firstFile } : {}),
			});
		}),
	);

	cleanups.push(
		ctx.handle("cancel-active", async () => {
			await watcher.discardActive("cancelled");
			return buildDashboardState();
		}),
	);

	cleanups.push(
		ctx.handle("abandon-active", async () => {
			await watcher.discardActive("abandoned");
			return buildDashboardState();
		}),
	);

	cleanups.push(
		ctx.handle("waive-upsolve", async (input) => {
			const rec = input && typeof input === "object" ? (input as { reason?: unknown }) : {};
			const reason =
				typeof rec.reason === "string" && rec.reason.trim()
					? rec.reason.trim()
					: "Waived from Arena Dashboard";
			await runPythonJson(ladderPy, ["waive", "--reason", reason], {
				dataDir,
				practiceDir: currentSettings.practiceDir,
				signal: ctx.signal,
			});
			bumpRevision();
			ctx.events.emit("arena-changed", { source: "ladder", action: "waive" });
			return buildDashboardState();
		}),
	);

	const dispose = () => {
		for (const fn of cleanups.splice(0).reverse()) {
			try {
				fn();
			} catch {
				// isolate cleanup failures
			}
		}
	};
	ctx.cleanup(dispose);
	return dispose;
}
