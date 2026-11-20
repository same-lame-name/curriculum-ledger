import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { PATHS } from "../../../config.ts";
import { getAgyBinary } from "./binary.ts";
import { ANTIGRAVITY_API, ANTIGRAVITY_PROVIDER } from "./constants.ts";
import { JsonRpcSession } from "./jsonrpc.ts";

type ThinkingEffort = "low" | "medium" | "high" | "xhigh";
const EFFORT_LEVELS: readonly ThinkingEffort[] = ["low", "medium", "high", "xhigh"];
const SUFFIX_RE = /^(.+?)-(low|medium|high|xhigh)$/;

function cacheFilePath(): string {
	return path.join(PATHS.data, "antigravity-models.json");
}

function inferModelCapabilities(id: string): Pick<Model<Api>, "input" | "contextWindow" | "maxTokens"> {
	if (id.startsWith("claude-")) {
		return { input: ["text", "image"], contextWindow: 200_000, maxTokens: 65_536 };
	}
	if (id.startsWith("gpt-oss-")) {
		return { input: ["text"], contextWindow: 131_072, maxTokens: 32_768 };
	}
	return { input: ["text", "image"], contextWindow: 1_048_576, maxTokens: 65_536 };
}

function buildModelEntry(id: string, name: string, efforts: ReadonlySet<ThinkingEffort>): Model<Api> {
	const caps = inferModelCapabilities(id);
	const base = {
		id,
		name,
		api: ANTIGRAVITY_API,
		provider: ANTIGRAVITY_PROVIDER,
		baseUrl: "",
		input: caps.input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: caps.contextWindow,
		maxTokens: caps.maxTokens,
	};
	if (efforts.size === 0) {
		return { ...base, reasoning: false };
	}
	return {
		...base,
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: efforts.has("low") ? "low" : null,
			medium: efforts.has("medium") ? "medium" : null,
			high: efforts.has("high") ? "high" : null,
			xhigh: efforts.has("xhigh") ? "xhigh" : null,
			max: null,
		},
	};
}

function buildDefaultFallbackModels(): readonly Model<Api>[] {
	const standard = new Set<ThinkingEffort>(["low", "medium", "high"]);
	const extended = new Set<ThinkingEffort>(["low", "medium", "high", "xhigh"]);
	const none = new Set<ThinkingEffort>();
	return [
		buildModelEntry("gemini-4-neon", "Gemini 4 Neon", extended),
		buildModelEntry("gemini-4-argon", "Gemini 4 Argon", standard),
		buildModelEntry("gemini-4-hydrogen", "Gemini 4 Hydrogen", extended),
		buildModelEntry("gemini-pro-orchestrator-neon", "Orchestrator (Neon)", none),
		buildModelEntry("gemini-pro-orchestrator-g1-pro", "Orchestrator (Argon)", none),
		buildModelEntry("gemini-3.8-flash", "Gemini 3.8 Flash", standard),
		buildModelEntry("claude-opus-5-5", "Claude Opus 5.5", standard),
		buildModelEntry("claude-sonnet-5-5", "Claude Sonnet 5.5", standard),
		buildModelEntry("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", none),
	];
}

export const FALLBACK_ANTIGRAVITY_MODELS: readonly Model<Api>[] = buildDefaultFallbackModels();

interface RawConfigOption {
	id?: string;
	options?: Array<{ value?: unknown; name?: unknown }>;
}

interface RawAvailableModel {
	modelId?: unknown;
	name?: unknown;
}

/**
 * Normalizes `agy acp` `session/new` model metadata into pi-ai `Model<Api>[]`.
 * Combines base `configOptions` (`id === "model"`) with `models.availableModels`
 * so each base model exposes only the thinking levels actually supported by `agy`.
 */
export function normalizeAcpModels(sessionNewResult: unknown): Model<Api>[] {
	const res = (sessionNewResult && typeof sessionNewResult === "object" ? sessionNewResult : {}) as Record<string, unknown>;
	const modelsObj = (res.models && typeof res.models === "object" ? res.models : {}) as Record<string, unknown>;
	const available = Array.isArray(modelsObj.availableModels) ? (modelsObj.availableModels as RawAvailableModel[]) : [];
	const availableIds = new Set(
		available
			.map((m) => (typeof m?.modelId === "string" ? m.modelId.trim() : ""))
			.filter(Boolean),
	);

	const configOptions = Array.isArray(res.configOptions) ? (res.configOptions as RawConfigOption[]) : [];
	const modelConfig = configOptions.find((c) => c?.id === "model");
	const baseOptions = Array.isArray(modelConfig?.options) ? modelConfig.options : [];

	if (baseOptions.length > 0) {
		const out: Model<Api>[] = [];
		const seen = new Set<string>();
		for (const opt of baseOptions) {
			const id = typeof opt?.value === "string" ? opt.value.trim() : "";
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const name = typeof opt.name === "string" && opt.name.trim() ? opt.name.trim() : id;
			const efforts = new Set<ThinkingEffort>();
			for (const level of EFFORT_LEVELS) {
				if (availableIds.has(`${id}-${level}`)) efforts.add(level);
			}
			out.push(buildModelEntry(id, name, efforts));
		}
		if (out.length > 0) return out;
	}

	if (available.length === 0) return [];

	// Fallback grouping if `configOptions` is absent: fold `${base}-${effort}` only when
	// stripping the suffix wouldn't collapse a single standalone suffixed id unexpectedly.
	const grouped = new Map<string, { name: string; efforts: Set<ThinkingEffort>; count: number }>();
	for (const entry of available) {
		const rawId = typeof entry?.modelId === "string" ? entry.modelId.trim() : "";
		if (!rawId) continue;
		const rawName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : rawId;
		const match = SUFFIX_RE.exec(rawId);
		const baseId = match ? match[1]! : rawId;
		const effort = match ? (match[2] as ThinkingEffort) : undefined;
		const existing = grouped.get(baseId);
		if (!existing) {
			const cleanName = effort ? rawName.replace(new RegExp(`\\s*\\(${effort}\\)\\s*$`, "i"), "").trim() || baseId : rawName;
			grouped.set(baseId, {
				name: cleanName,
				efforts: effort ? new Set([effort]) : new Set(),
				count: 1,
			});
		} else {
			if (effort) existing.efforts.add(effort);
			existing.count += 1;
		}
	}

	return [...grouped.entries()].map(([id, info]) => buildModelEntry(id, info.name, info.efforts));
}

interface CachedCatalogRecord {
	version: string | null;
	tier: string | null;
	updatedAt: string;
	models: Model<Api>[];
}

let inMemoryCatalog: { version: string | null; tier: string | null; models: readonly Model<Api>[] } | null = null;
let loadedFromDisk = false;
let activeProbe: Promise<ProbeResult> | null = null;

function readDiskCache(): CachedCatalogRecord | null {
	try {
		const raw = fs.readFileSync(cacheFilePath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<CachedCatalogRecord>;
		if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null;
		const validModels = parsed.models.filter((m): m is Model<Api> =>
			Boolean(m && typeof m.id === "string" && m.id.trim() && typeof m.name === "string" && m.provider === ANTIGRAVITY_PROVIDER),
		);
		if (validModels.length === 0) return null;
		return {
			version: typeof parsed.version === "string" ? parsed.version : null,
			tier: typeof parsed.tier === "string" ? parsed.tier : null,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
			models: validModels,
		};
	} catch {
		return null;
	}
}

function writeDiskCache(record: CachedCatalogRecord): void {
	try {
		const file = cacheFilePath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
	} catch {
		// Cache persistence is best-effort; never break streaming if data dir is transient.
	}
}

export function getCachedAntigravityInfo(): { version: string | null; tier: string | null; models: readonly Model<Api>[] } {
	if (!loadedFromDisk) {
		loadedFromDisk = true;
		const disk = readDiskCache();
		if (disk) {
			inMemoryCatalog = { version: disk.version, tier: disk.tier, models: disk.models };
		}
	}
	return inMemoryCatalog ?? { version: null, tier: null, models: FALLBACK_ANTIGRAVITY_MODELS };
}

export function getAntigravityModels(): readonly Model<Api>[] {
	return getCachedAntigravityInfo().models;
}

export function setDiscoveredAntigravityModels(
	models: readonly Model<Api>[],
	meta?: { version?: string | null; tier?: string | null },
): void {
	if (models.length === 0) return;
	const prev = inMemoryCatalog ?? { version: null, tier: null, models: FALLBACK_ANTIGRAVITY_MODELS };
	const version = meta?.version !== undefined ? meta.version : prev.version;
	const tier = meta?.tier !== undefined ? meta.tier : prev.tier;
	inMemoryCatalog = { version, tier, models: [...models] };
	loadedFromDisk = true;
	writeDiskCache({ version, tier, updatedAt: new Date().toISOString(), models: [...models] });
}

export function resetAntigravityModelCacheForTests(): void {
	inMemoryCatalog = null;
	loadedFromDisk = false;
	activeProbe = null;
}

export interface ProbeResult {
	ok: boolean;
	version: string | null;
	tier: string | null;
	models: readonly Model<Api>[];
	error?: string;
}

export async function probeAntigravityCatalog({
	findBinary = getAgyBinary,
	spawnProcess = spawn,
	timeoutMs = 12_000,
}: {
	findBinary?: () => string | null;
	spawnProcess?: typeof spawn;
	timeoutMs?: number;
} = {}): Promise<ProbeResult> {
	if (activeProbe && findBinary === getAgyBinary && spawnProcess === spawn) {
		return activeProbe;
	}

	const run = async (): Promise<ProbeResult> => {
		const binary = findBinary();
		if (!binary) {
			return { ok: false, version: null, tier: null, models: getAntigravityModels(), error: "agy binary not found" };
		}

		const child = spawnProcess(binary, ["acp"], { stdio: ["pipe", "pipe", "pipe"] });
		let exited = false;
		const cleanup = () => {
			if (exited) return;
			exited = true;
			try {
				if (!child.killed) child.kill("SIGTERM");
			} catch {
				// ignore
			}
		};

		const rpc = new JsonRpcSession({
			send: (frame) => {
				if (!child.stdin?.destroyed) child.stdin?.write(`${frame}\n`);
			},
			defaultTimeoutMs: timeoutMs,
		});

		child.stdout?.on("data", (chunk: Buffer | string) => rpc.feed(chunk.toString()));
		child.on("exit", (code) => {
			exited = true;
			rpc.abortAll(`agy acp exited with code ${code ?? "null"}`);
		});

		try {
			const init = (await rpc.request("initialize", {
				protocolVersion: 1,
				clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
			}, timeoutMs)) as Record<string, unknown> | undefined;

			const agentInfo = (init?.agentInfo && typeof init.agentInfo === "object" ? init.agentInfo : undefined) as Record<string, unknown> | undefined;
			const version = typeof agentInfo?.version === "string" ? agentInfo.version : null;

			const sessionNew = (await rpc.request("session/new", {
				cwd: PATHS.root,
				mcpServers: [],
			}, timeoutMs)) as Record<string, unknown> | undefined;

			const sessionId = typeof sessionNew?.sessionId === "string" ? sessionNew.sessionId : undefined;
			const meta = (sessionNew?._meta && typeof sessionNew._meta === "object" ? sessionNew._meta : undefined) as Record<string, unknown> | undefined;
			const agyMeta = (meta?.antigravity && typeof meta.antigravity === "object" ? meta.antigravity : undefined) as Record<string, unknown> | undefined;
			const tierObj = (agyMeta?.tier && typeof agyMeta.tier === "object" ? agyMeta.tier : undefined) as Record<string, unknown> | undefined;
			const tier = typeof tierObj?.name === "string" ? tierObj.name : null;

			const models = normalizeAcpModels(sessionNew);
			if (models.length > 0) {
				setDiscoveredAntigravityModels(models, { version, tier });
			}

			if (sessionId) {
				await rpc.request("session/close", { sessionId }, 3_000).catch(() => {});
			}

			return { ok: true, version, tier, models: models.length > 0 ? models : getAntigravityModels() };
		} catch (err) {
			return {
				ok: false,
				version: null,
				tier: null,
				models: getAntigravityModels(),
				error: err instanceof Error ? err.message : String(err),
			};
		} finally {
			rpc.abortAll("probe completed");
			cleanup();
		}
	};

	const promise = run().finally(() => {
		if (activeProbe === promise) activeProbe = null;
	});
	if (findBinary === getAgyBinary && spawnProcess === spawn) {
		activeProbe = promise;
	}
	return promise;
}
