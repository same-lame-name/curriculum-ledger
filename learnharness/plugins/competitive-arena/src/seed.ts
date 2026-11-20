import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

const SEED_FILES = [
	"arena/arena.py",
	"ladder/ladder.py",
	"catalog/catalog.py",
	"catalog/catalog.json",
	"browser/browser_fetch.py",
] as const;

const LEGACY_LEDGER_FILES = [
	"arena/rating.json",
	"arena/history.json",
	"ladder/ladder.json",
	"ladder/rounds.json",
] as const;

export interface EnsureSeededOptions {
	/** Explicitly override legacy .pi directory, or null to disable. */
	legacyPiDir?: string | null;
}

export interface EnsureSeededResult {
	copiedSeedFiles: string[];
	importedLegacyLedgers: string[];
}

function atomicCopyFile(srcPath: string, dstPath: string): void {
	fs.mkdirSync(path.dirname(dstPath), { recursive: true });
	const tmpPath = `${dstPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	try {
		fs.copyFileSync(srcPath, tmpPath);
		fs.renameSync(tmpPath, dstPath);
	} catch (error) {
		try {
			fs.rmSync(tmpPath, { force: true });
		} catch {
			// ignore temp cleanup failure
		}
		throw error;
	}
}

function atomicWriteJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	try {
		fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
		fs.renameSync(tmpPath, filePath);
	} catch (error) {
		try {
			fs.rmSync(tmpPath, { force: true });
		} catch {
			// ignore temp cleanup failure
		}
		throw error;
	}
}

function sha256File(filePath: string): string {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveLegacyPiDir(explicit: string | null | undefined): string | null {
	if (explicit === null) return null;
	if (typeof explicit === "string") {
		const trimmed = explicit.trim();
		return trimmed && fs.existsSync(trimmed) ? trimmed : null;
	}
	if (process.env.NODE_ENV === "test" || process.env.LH_DISABLE_LEGACY_IMPORT === "1") {
		return null;
	}
	if (typeof process.env.LH_LEGACY_PI_DIR === "string" && process.env.LH_LEGACY_PI_DIR.trim()) {
		const envDir = path.resolve(process.env.LH_LEGACY_PI_DIR.trim());
		return fs.existsSync(envDir) ? envDir : null;
	}
	const siblingPi = path.resolve(process.cwd(), "..", ".pi");
	return fs.existsSync(siblingPi) ? siblingPi : null;
}

export function ensureSeeded(
	codeDir: string,
	dataDir: string,
	options: EnsureSeededOptions = {},
): EnsureSeededResult {
	for (const relDir of [
		"arena",
		"arena/active",
		"arena/failed",
		"ladder",
		"catalog",
		"catalog/sets",
		"lab",
		"lab/tests",
		"browser",
	]) {
		fs.mkdirSync(path.join(dataDir, relDir), { recursive: true });
	}

	// Self-heal any legacy arena/tests directory outside active/ if present.
	const staleArenaTests = path.join(dataDir, "arena", "tests");
	if (fs.existsSync(staleArenaTests)) {
		fs.rmSync(staleArenaTests, { recursive: true, force: true });
	}

	const manifestPath = path.join(dataDir, ".seed-manifest.json");
	let manifest: Record<string, { sha256: string; size: number }> = {};
	try {
		if (fs.existsSync(manifestPath)) {
			const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				manifest = parsed;
			}
		}
	} catch {
		manifest = {};
	}

	const copiedSeedFiles: string[] = [];
	const seedRoot = path.join(codeDir, "seed");
	let manifestDirty = false;

	for (const relPath of SEED_FILES) {
		const srcPath = path.join(seedRoot, relPath);
		if (!fs.existsSync(srcPath)) {
			throw new Error(`Missing plugin seed asset: ${srcPath}`);
		}
		const dstPath = path.join(dataDir, relPath);
		const srcStat = fs.statSync(srcPath);
		const prev = manifest[relPath];
		const dstExists = fs.existsSync(dstPath);

		if (dstExists && prev && prev.size === srcStat.size) {
			const dstStat = fs.statSync(dstPath);
			if (dstStat.size === prev.size) {
				const srcHash = sha256File(srcPath);
				if (srcHash === prev.sha256) continue;
			}
		}

		const srcHash = sha256File(srcPath);
		const needsCopy =
			!dstExists ||
			!prev ||
			prev.sha256 !== srcHash ||
			sha256File(dstPath) !== srcHash;

		if (needsCopy) {
			atomicCopyFile(srcPath, dstPath);
			copiedSeedFiles.push(relPath);
		}
		manifest[relPath] = { sha256: srcHash, size: srcStat.size };
		manifestDirty = true;
	}

	if (manifestDirty) {
		atomicWriteJson(manifestPath, manifest);
	}

	const importedLegacyLedgers: string[] = [];
	const legacyPiDir = resolveLegacyPiDir(options.legacyPiDir);
	if (legacyPiDir) {
		for (const relLedger of LEGACY_LEDGER_FILES) {
			const dstPath = path.join(dataDir, relLedger);
			if (fs.existsSync(dstPath)) continue; // Never overwrite an existing mutable ledger.
			const srcPath = path.join(legacyPiDir, relLedger);
			if (fs.existsSync(srcPath) && fs.statSync(srcPath).isFile()) {
				atomicCopyFile(srcPath, dstPath);
				importedLegacyLedgers.push(relLedger);
			}
		}
	}

	return { copiedSeedFiles, importedLegacyLedgers };
}
