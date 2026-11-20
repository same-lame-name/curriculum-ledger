import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	type ArenaPluginSettings,
	type ArenaPluginSettingsPatch,
	DEFAULT_TTL_DAYS,
} from "./types.ts";

export const DEFAULT_PRACTICE_DIR = path.join(os.homedir(), "playground", "contests", "practice");

const SETTINGS_FILENAME = "settings.json";
const VALID_THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export function defaultSettings(): ArenaPluginSettings {
	return {
		pointerEnabled: true,
		practiceDir: DEFAULT_PRACTICE_DIR,
		launchCommand: "",
		autoLaunch: false,
		artifactTtlDays: DEFAULT_TTL_DAYS,
		workerModelOverride: null,
		workerThinkingOverride: null,
	};
}

export function expandTilde(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (trimmed === "~") return os.homedir();
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	return path.resolve(trimmed);
}

function normalizeModelRef(raw: unknown): { provider: string; id: string } | null {
	if (raw === null) return null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("workerModelOverride must be { provider, id } or null");
	}
	const rec = raw as Record<string, unknown>;
	const provider = typeof rec.provider === "string" ? rec.provider.trim() : "";
	const id = typeof rec.id === "string" ? rec.id.trim() : "";
	if (!provider || !id) {
		throw new Error("workerModelOverride requires non-empty provider and id");
	}
	return { provider, id };
}

function normalizeThinking(raw: unknown): ThinkingLevel | null {
	if (raw === null) return null;
	if (typeof raw !== "string" || !VALID_THINKING_LEVELS.has(raw)) {
		throw new Error(`Invalid thinking level: ${String(raw)}`);
	}
	return raw as ThinkingLevel;
}

export function sanitizeSettingsPatch(
	current: ArenaPluginSettings,
	patch: unknown,
): ArenaPluginSettings {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		throw new Error("Settings update must be an object");
	}
	const input = patch as ArenaPluginSettingsPatch;
	const next: ArenaPluginSettings = { ...current };

	if ("pointerEnabled" in input) {
		if (typeof input.pointerEnabled !== "boolean") {
			throw new Error("pointerEnabled must be a boolean");
		}
		next.pointerEnabled = input.pointerEnabled;
	}
	if ("practiceDir" in input) {
		if (typeof input.practiceDir !== "string" || !input.practiceDir.trim()) {
			throw new Error("practiceDir must be a non-empty path");
		}
		next.practiceDir = expandTilde(input.practiceDir);
	}
	if ("launchCommand" in input) {
		if (typeof input.launchCommand !== "string") {
			throw new Error("launchCommand must be a string");
		}
		next.launchCommand = input.launchCommand.trim();
	}
	if ("autoLaunch" in input) {
		if (typeof input.autoLaunch !== "boolean") {
			throw new Error("autoLaunch must be a boolean");
		}
		next.autoLaunch = input.autoLaunch;
	}
	if ("artifactTtlDays" in input) {
		const n = Number(input.artifactTtlDays);
		if (!Number.isSafeInteger(n) || n < 1 || n > 365) {
			throw new Error("artifactTtlDays must be a whole number between 1 and 365");
		}
		next.artifactTtlDays = n;
	}
	if ("workerModelOverride" in input) {
		next.workerModelOverride =
			input.workerModelOverride === undefined
				? current.workerModelOverride
				: normalizeModelRef(input.workerModelOverride);
		if (next.workerModelOverride === null) {
			next.workerThinkingOverride = null;
		}
	}
	if ("workerThinkingOverride" in input) {
		next.workerThinkingOverride =
			input.workerThinkingOverride === undefined
				? current.workerThinkingOverride
				: normalizeThinking(input.workerThinkingOverride);
	}

	return next;
}

export function loadSettings(dataDir: string): ArenaPluginSettings {
	const filePath = path.join(dataDir, SETTINGS_FILENAME);
	const defaults = defaultSettings();
	if (!fs.existsSync(filePath)) return defaults;
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return sanitizeSettingsPatch(defaults, raw);
	} catch {
		return defaults;
	}
}

export function saveSettings(
	dataDir: string,
	patch: unknown,
): ArenaPluginSettings {
	const current = loadSettings(dataDir);
	const next = sanitizeSettingsPatch(current, patch);
	const filePath = path.join(dataDir, SETTINGS_FILENAME);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	try {
		fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
		fs.renameSync(tmpPath, filePath);
	} catch (error) {
		try {
			fs.rmSync(tmpPath, { force: true });
		} catch {
			// ignore temp cleanup failure
		}
		throw error;
	}
	return next;
}
