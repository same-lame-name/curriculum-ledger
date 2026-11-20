import * as fs from "node:fs";
import path from "node:path";
import type { PluginExternalJobResult } from "learnharness-plugin-api";
import { buildResultMarkdown, readLiveEvents } from "./path-safety.ts";
import { runPythonJson } from "./python-runner.ts";
import {
	type ActiveArenaSnapshot,
	type ArenaResultPayload,
	errorMessage,
} from "./types.ts";

export interface JobLinkRecord {
	jobId: string;
	chatId: string;
	toolCallId: string;
	sessionId: string;
	title: string;
	stagedAt: string;
}

export interface ArenaWatcherDeps {
	dataDir: string;
	getPracticeDir: () => string;
	deliverExternalJobResult: (jobId: string, result: PluginExternalJobResult) => Promise<void>;
	emitNotification: (topic: string, data?: unknown) => void;
	onChanged?: () => void;
	pollIntervalMs?: number;
}

const JOB_LINK_FILENAME = "job-link.json";

export function readJobLink(activeDir: string): JobLinkRecord | null {
	const linkPath = path.join(activeDir, JOB_LINK_FILENAME);
	if (!fs.existsSync(linkPath)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(linkPath, "utf-8"));
		if (raw && typeof raw === "object" && typeof raw.jobId === "string" && raw.jobId.trim()) {
			return raw as JobLinkRecord;
		}
	} catch {
		// ignore unreadable job-link
	}
	return null;
}

export function writeJobLink(activeDir: string, link: JobLinkRecord): void {
	fs.mkdirSync(activeDir, { recursive: true });
	const linkPath = path.join(activeDir, JOB_LINK_FILENAME);
	const tmp = `${linkPath}.tmp-${process.pid}-${Date.now()}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(link, null, 2) + "\n", "utf-8");
		fs.renameSync(tmp, linkPath);
	} catch (error) {
		try {
			fs.rmSync(tmp, { force: true });
		} catch {
			// ignore
		}
		throw error;
	}
}

function readManifestSafe(manifestPath: string): any | null {
	if (!fs.existsSync(manifestPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	} catch {
		return null;
	}
}

export function readActiveSnapshot(dataDir: string): ActiveArenaSnapshot | null {
	const activeDir = path.join(dataDir, "arena", "active");
	const manifestPath = path.join(activeDir, "manifest.json");
	const manifest = readManifestSafe(manifestPath);
	if (!manifest) return null;

	const rawProblems: any[] = Array.isArray(manifest.problems) ? manifest.problems : [];
	const problemIds = rawProblems.map((p) => String(p?.id || "")).filter(Boolean);
	const eventsPath = path.join(activeDir, "events.jsonl");
	const live = readLiveEvents(eventsPath, problemIds);
	const startedAtMs = Date.parse(String(manifest.createdAt || "")) || Date.now();

	return {
		sessionId: String(manifest.sessionId || ""),
		title: String(manifest.title || "Arena Session"),
		purpose: String(manifest.purpose || "guided"),
		gradingPolicy: String(manifest.gradingPolicy || "practice"),
		timerMode: String(manifest.timerMode || "stopwatch"),
		totalTimeBudgetSeconds: Number(manifest.totalTimeBudgetSeconds || 0),
		createdAt: String(manifest.createdAt || new Date(startedAtMs).toISOString()),
		startedAtMs,
		attached: live.attached,
		activeProblemId: live.activeProblemId,
		lastEventText: live.lastEventText,
		problems: rawProblems.map((p) => {
			const pid = String(p?.id || "");
			return {
				id: pid,
				title: String(p?.title || pid),
				url: String(p?.url || ""),
				...(typeof p?.difficulty === "number" ? { difficulty: p.difficulty } : {}),
				...(typeof p?.domain === "string" && p.domain ? { domain: p.domain } : {}),
				hasTests: Boolean(p?.testsDir),
				live: live.perProblem.get(pid) ?? { id: pid, state: "staged", wrongAttempts: 0, hintsUsed: 0 },
			};
		}),
	};
}

function backupFailedActive(activeDir: string, arenaDir: string): string {
	const failedDir = path.join(arenaDir, "failed", `session-${Date.now()}`);
	fs.mkdirSync(failedDir, { recursive: true });
	for (const file of ["manifest.json", "result.json", "events.jsonl", JOB_LINK_FILENAME]) {
		const src = path.join(activeDir, file);
		if (fs.existsSync(src)) {
			try {
				fs.copyFileSync(src, path.join(failedDir, file));
			} catch {
				// best-effort forensic archive
			}
		}
	}
	return failedDir;
}

export class ArenaWatcher {
	private readonly deps: ArenaWatcherDeps;
	private readonly activeDir: string;
	private readonly arenaDir: string;
	private readonly arenaPyPath: string;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private fsWatcher: fs.FSWatcher | null = null;
	private finalizing = false;
	private disposed = false;
	private lastEventsSignature = "";

	constructor(deps: ArenaWatcherDeps) {
		this.deps = deps;
		this.arenaDir = path.join(deps.dataDir, "arena");
		this.activeDir = path.join(this.arenaDir, "active");
		this.arenaPyPath = path.join(this.arenaDir, "arena.py");
	}

	isWatching(): boolean {
		return this.pollTimer !== null || this.fsWatcher !== null;
	}

	stopWatching(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.fsWatcher !== null) {
			try {
				this.fsWatcher.close();
			} catch {
				// ignore watcher close error
			}
			this.fsWatcher = null;
		}
		this.lastEventsSignature = "";
	}

	dispose(): void {
		this.disposed = true;
		this.stopWatching();
	}

	private emitLiveStatusIfChanged(): void {
		const snap = readActiveSnapshot(this.deps.dataDir);
		if (!snap) {
			this.stopWatching();
			this.deps.emitNotification("arena-status", null);
			return;
		}
		const eventsPath = path.join(this.activeDir, "events.jsonl");
		let sig = snap.lastEventText;
		try {
			if (fs.existsSync(eventsPath)) {
				const st = fs.statSync(eventsPath);
				sig = `${st.size}:${Math.floor(st.mtimeMs)}:${snap.lastEventText}`;
			}
		} catch {
			// ignore stat race
		}
		if (sig !== this.lastEventsSignature) {
			this.lastEventsSignature = sig;
			this.deps.emitNotification("arena-status", snap);
		}
	}

	private async deliverSafe(
		link: JobLinkRecord | null,
		payload: PluginExternalJobResult,
	): Promise<void> {
		if (!link || this.disposed) return;
		try {
			await this.deps.deliverExternalJobResult(link.jobId, payload);
		} catch (error) {
			const msg = errorMessage(error);
			// Ignore if plugin deactivated or target job/chat was deleted by user.
			if (!msg.includes("External job not found") && !msg.includes("no longer active")) {
				throw error;
			}
		}
	}

	async tick(): Promise<void> {
		if (this.disposed || this.finalizing) return;
		const manifestPath = path.join(this.activeDir, "manifest.json");
		const resultPath = path.join(this.activeDir, "result.json");
		if (!fs.existsSync(manifestPath)) {
			this.stopWatching();
			this.deps.emitNotification("arena-status", null);
			return;
		}
		if (fs.existsSync(resultPath)) {
			await this.finalize();
			return;
		}
		this.emitLiveStatusIfChanged();
	}

	startWatching(): void {
		if (this.disposed) return;
		if (!fs.existsSync(path.join(this.activeDir, "manifest.json"))) {
			this.stopWatching();
			return;
		}
		if (this.pollTimer !== null) {
			this.emitLiveStatusIfChanged();
			return;
		}

		try {
			fs.mkdirSync(this.activeDir, { recursive: true });
			this.fsWatcher = fs.watch(this.activeDir, () => {
				void this.tick();
			});
			this.fsWatcher.on("error", () => {
				// Rely on pollTimer fallback cleanly (important on WSL/DrvFs).
			});
			this.fsWatcher.unref?.();
		} catch {
			this.fsWatcher = null;
		}

		const intervalMs = this.deps.pollIntervalMs ?? 750;
		this.pollTimer = setInterval(() => {
			void this.tick();
		}, intervalMs);
		this.pollTimer.unref?.();

		this.emitLiveStatusIfChanged();
	}

	async resumeIfActive(): Promise<void> {
		if (this.disposed) return;
		const manifestPath = path.join(this.activeDir, "manifest.json");
		if (!fs.existsSync(manifestPath)) return;
		const resultPath = path.join(this.activeDir, "result.json");
		if (fs.existsSync(resultPath)) {
			await this.finalize();
		} else {
			this.startWatching();
		}
	}

	async finalize(): Promise<boolean> {
		if (this.finalizing || this.disposed) return false;
		const resultPath = path.join(this.activeDir, "result.json");
		if (!fs.existsSync(resultPath)) return false;

		let parsedResult: unknown;
		try {
			parsedResult = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
			if (!parsedResult || typeof parsedResult !== "object") return false;
		} catch {
			return false; // Half-written by editor — next tick retries cleanly.
		}

		this.finalizing = true;
		this.stopWatching();
		const link = readJobLink(this.activeDir);

		try {
			let sessionResult: ArenaResultPayload;
			try {
				sessionResult = await runPythonJson<ArenaResultPayload>(
					this.arenaPyPath,
					["close_session", "--active-dir", this.activeDir],
					{
						dataDir: this.deps.dataDir,
						practiceDir: this.deps.getPracticeDir(),
					},
				);
			} catch (err) {
				const failedDir = backupFailedActive(this.activeDir, this.arenaDir);
				fs.rmSync(this.activeDir, { recursive: true, force: true });
				fs.mkdirSync(this.activeDir, { recursive: true });
				const message = `Arena session finished, but settling the ledger failed: ${errorMessage(err)}. Raw session artifacts were preserved in ${failedDir}.`;
				await this.deliverSafe(link, {
					status: "failed",
					text: message,
					activity: "failed",
				});
				this.deps.onChanged?.();
				this.deps.emitNotification("arena-changed", { source: "watcher", action: "failed" });
				this.deps.emitNotification("arena-status", null);
				return true;
			}

			fs.rmSync(this.activeDir, { recursive: true, force: true });
			fs.mkdirSync(this.activeDir, { recursive: true });

			const text = buildResultMarkdown(sessionResult);
			await this.deliverSafe(link, {
				status: "succeeded",
				text,
				data: sessionResult,
				activity: "finished",
			});
			this.deps.onChanged?.();
			this.deps.emitNotification("arena-changed", { source: "watcher", action: "completed" });
			this.deps.emitNotification("arena-status", null);
			return true;
		} finally {
			this.finalizing = false;
		}
	}

	async discardActive(reason: "cancelled" | "abandoned"): Promise<{
		cleared: boolean;
		sessionResult?: ArenaResultPayload;
	}> {
		this.stopWatching();
		const manifestPath = path.join(this.activeDir, "manifest.json");
		const link = readJobLink(this.activeDir);

		if (!fs.existsSync(manifestPath)) {
			fs.rmSync(this.activeDir, { recursive: true, force: true });
			fs.mkdirSync(this.activeDir, { recursive: true });
			this.deps.emitNotification("arena-status", null);
			return { cleared: false };
		}

		let sessionResult: ArenaResultPayload | undefined;
		if (reason === "abandoned") {
			sessionResult = await runPythonJson<ArenaResultPayload>(
				this.arenaPyPath,
				["abandon_active", "--active-dir", this.activeDir],
				{
					dataDir: this.deps.dataDir,
					practiceDir: this.deps.getPracticeDir(),
				},
			);
		}

		fs.rmSync(this.activeDir, { recursive: true, force: true });
		fs.mkdirSync(this.activeDir, { recursive: true });

		if (reason === "abandoned" && sessionResult) {
			await this.deliverSafe(link, {
				status: "succeeded",
				text: buildResultMarkdown(sessionResult),
				data: sessionResult,
				activity: "abandoned",
			});
		} else {
			await this.deliverSafe(link, {
				status: "failed",
				text: `Arena session "${link?.title || "Active session"}" was cancelled before submission.`,
				activity: "cancelled",
			});
		}

		this.deps.onChanged?.();
		this.deps.emitNotification("arena-changed", { source: "watcher", action: reason });
		this.deps.emitNotification("arena-status", null);
		return { cleared: true, ...(sessionResult ? { sessionResult } : {}) };
	}
}
