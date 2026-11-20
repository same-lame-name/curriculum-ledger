import * as fs from "node:fs";
import path from "node:path";
import { DEFAULT_TTL_DAYS } from "./types.ts";

export interface HousekeepingResult {
	removedFiles: number;
	removedDirs: number;
}

function collectActiveTestsDirs(dataDir: string): Set<string> {
	const protectedDirs = new Set<string>();
	const manifestPath = path.join(dataDir, "arena", "active", "manifest.json");
	if (!fs.existsSync(manifestPath)) return protectedDirs;
	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		if (manifest && typeof manifest === "object") {
			if (typeof manifest.testsDir === "string" && manifest.testsDir.trim()) {
				protectedDirs.add(path.resolve(manifest.testsDir.trim()));
			}
			if (Array.isArray(manifest.problems)) {
				for (const prob of manifest.problems) {
					if (prob && typeof prob.testsDir === "string" && prob.testsDir.trim()) {
						protectedDirs.add(path.resolve(prob.testsDir.trim()));
					}
					if (typeof prob?.id === "string" && prob.id.trim()) {
						protectedDirs.add(path.resolve(path.join(dataDir, "lab", "tests", prob.id.trim())));
					}
				}
			}
		}
	} catch {
		// ignore unreadable manifest
	}
	return protectedDirs;
}

export function runHousekeeping(
	dataDir: string,
	ttlDays = DEFAULT_TTL_DAYS,
	nowMs = Date.now(),
): HousekeepingResult {
	const maxAgeMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
	const cutoffMs = nowMs - maxAgeMs;
	const protectedDirs = collectActiveTestsDirs(dataDir);

	let removedFiles = 0;
	let removedDirs = 0;

	const setsDir = path.join(dataDir, "catalog", "sets");
	if (fs.existsSync(setsDir)) {
		for (const entry of fs.readdirSync(setsDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			const fullPath = path.join(setsDir, entry.name);
			try {
				const st = fs.statSync(fullPath);
				if (st.mtimeMs < cutoffMs) {
					fs.rmSync(fullPath, { force: true });
					removedFiles += 1;
				}
			} catch {
				// ignore per-file race
			}
		}
	}

	const testsRoot = path.join(dataDir, "lab", "tests");
	if (fs.existsSync(testsRoot)) {
		for (const entry of fs.readdirSync(testsRoot, { withFileTypes: true })) {
			const fullPath = path.resolve(path.join(testsRoot, entry.name));
			if (protectedDirs.has(fullPath)) continue;
			try {
				const st = fs.statSync(fullPath);
				if (st.mtimeMs < cutoffMs) {
					if (entry.isDirectory()) {
						fs.rmSync(fullPath, { recursive: true, force: true });
						removedDirs += 1;
					} else if (entry.isFile()) {
						fs.rmSync(fullPath, { force: true });
						removedFiles += 1;
					}
				}
			} catch {
				// ignore per-entry race
			}
		}
	}

	return { removedFiles, removedDirs };
}
