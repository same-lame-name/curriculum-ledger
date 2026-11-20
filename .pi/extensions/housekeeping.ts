/**
 * housekeeping — Session artifact lifecycle management (outside RBAC).
 *
 * Cleans transient problem sets (.pi/catalog/sets/) and generated test
 * suites (.pi/lab/tests/):
 * - Startup age sweep (ttlDays: 7) at root interactive session_start.
 * - Deterministic purgeSessionArtifacts() invoked by /course new|resume and /themecp.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export const SESSION_ARTIFACT_DIRS = [
	path.join(".pi", "catalog", "sets"),
	path.join(".pi", "lab", "tests"),
];
export const ARTIFACT_TTL_DAYS = 7;

export function findVaultRoot(startDir: string): string {
	let cur = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(cur, ".pi")) || fs.existsSync(path.join(cur, "courses"))) return cur;
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return path.resolve(startDir);
}

function isSubagentProcess(): boolean {
	return Boolean(
		process.env.PI_SUBAGENT_ID ||
			process.env.PI_SUBAGENT_NAME ||
			process.env.PI_SUBAGENT_AGENT ||
			process.env.PI_SUBAGENT_SESSION,
	);
}

export function purgeSessionArtifacts(vaultRoot: string): number {
	let removed = 0;
	for (const relDir of SESSION_ARTIFACT_DIRS) {
		const full = path.join(vaultRoot, relDir);
		if (fs.existsSync(full)) {
			fs.rmSync(full, { recursive: true, force: true });
			removed++;
		}
	}
	return removed;
}

export function sweepStaleArtifacts(vaultRoot: string, nowMs = Date.now(), ttlDays = ARTIFACT_TTL_DAYS): number {
	if (ttlDays <= 0) return 0;
	const cutoff = nowMs - ttlDays * 24 * 60 * 60 * 1000;
	let removed = 0;
	for (const relDir of SESSION_ARTIFACT_DIRS) {
		const fullDir = path.join(vaultRoot, relDir);
		if (!fs.existsSync(fullDir)) continue;
		for (const entry of fs.readdirSync(fullDir)) {
			const entryPath = path.join(fullDir, entry);
			try {
				if (fs.statSync(entryPath).mtimeMs < cutoff) {
					fs.rmSync(entryPath, { recursive: true, force: true });
					removed++;
				}
			} catch {
				// best-effort sweep
			}
		}
	}
	return removed;
}

export default function housekeepingExtension(pi: ExtensionAPI) {
	(globalThis as any).__piHousekeeping = {
		purgeSessionArtifacts: (cwd: string) => purgeSessionArtifacts(findVaultRoot(cwd)),
	};

	pi.on("session_start", async (_event, ctx) => {
		if (isSubagentProcess()) return;
		try {
			sweepStaleArtifacts(findVaultRoot(ctx.cwd));
		} catch {
			// Best-effort startup TTL sweep; never block startup.
		}
	});
}
