import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runHousekeeping } from "../src/housekeeping.ts";
import { ensureSeeded } from "../src/seed.ts";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
let tmpRoot = "";

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ca-seed-test-"));
});

afterEach(() => {
	if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ensureSeeded", () => {
	it("populates seed scripts idempotently without modifying codeDir", () => {
		const dataDir = path.join(tmpRoot, "data");
		const first = ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });
		assert.equal(first.copiedSeedFiles.length, 5);
		assert.equal(first.importedLegacyLedgers.length, 0);

		for (const rel of [
			"arena/arena.py",
			"ladder/ladder.py",
			"catalog/catalog.py",
			"catalog/catalog.json",
			"browser/browser_fetch.py",
		]) {
			assert.ok(fs.existsSync(path.join(dataDir, rel)), `missing ${rel}`);
		}

		const second = ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });
		assert.deepEqual(second.copiedSeedFiles, []);
	});

	it("imports missing legacy .pi ledgers without ever overwriting existing ledgers", () => {
		const dataDir = path.join(tmpRoot, "data");
		const legacyPi = path.join(tmpRoot, "legacy-pi");
		fs.mkdirSync(path.join(legacyPi, "arena"), { recursive: true });
		fs.mkdirSync(path.join(legacyPi, "ladder"), { recursive: true });

		fs.writeFileSync(path.join(legacyPi, "arena", "rating.json"), '{"global":{"rating":1550}}');
		fs.writeFileSync(path.join(legacyPi, "arena", "history.json"), '[{"problem_id":"cf_1A"}]');
		fs.writeFileSync(path.join(legacyPi, "ladder", "ladder.json"), '{"level":7}');

		// Pre-populate rating.json in dataDir so legacy import must NOT overwrite it.
		fs.mkdirSync(path.join(dataDir, "arena"), { recursive: true });
		fs.writeFileSync(path.join(dataDir, "arena", "rating.json"), '{"global":{"rating":1900}}');

		const res = ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: legacyPi });
		assert.deepEqual(res.importedLegacyLedgers.sort(), ["arena/history.json", "ladder/ladder.json"]);

		assert.equal(
			fs.readFileSync(path.join(dataDir, "arena", "rating.json"), "utf-8"),
			'{"global":{"rating":1900}}',
		);
		assert.equal(
			fs.readFileSync(path.join(dataDir, "arena", "history.json"), "utf-8"),
			'[{"problem_id":"cf_1A"}]',
		);
		assert.equal(
			fs.readFileSync(path.join(dataDir, "ladder", "ladder.json"), "utf-8"),
			'{"level":7}',
		);
	});
});

describe("runHousekeeping", () => {
	it("sweeps expired sets and test dirs while preserving suites referenced by active manifest", () => {
		const dataDir = path.join(tmpRoot, "data");
		ensureSeeded(PLUGIN_ROOT, dataDir, { legacyPiDir: null });

		const setsDir = path.join(dataDir, "catalog", "sets");
		const oldSet = path.join(setsDir, "old.json");
		const freshSet = path.join(setsDir, "fresh.json");
		fs.writeFileSync(oldSet, "[]");
		fs.writeFileSync(freshSet, "[]");

		const activeTests = path.join(dataDir, "lab", "tests", "active_prob");
		const staleTests = path.join(dataDir, "lab", "tests", "stale_prob");
		fs.mkdirSync(activeTests, { recursive: true });
		fs.mkdirSync(staleTests, { recursive: true });
		fs.writeFileSync(path.join(activeTests, "01.in"), "1\n");
		fs.writeFileSync(path.join(staleTests, "01.in"), "2\n");

		fs.writeFileSync(
			path.join(dataDir, "arena", "active", "manifest.json"),
			JSON.stringify({ problems: [{ id: "active_prob", testsDir: activeTests }] }),
		);

		const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldSet, oldTime, oldTime);
		fs.utimesSync(activeTests, oldTime, oldTime);
		fs.utimesSync(staleTests, oldTime, oldTime);

		const res = runHousekeeping(dataDir, 7);
		assert.equal(res.removedFiles, 1);
		assert.equal(res.removedDirs, 1);
		assert.equal(fs.existsSync(oldSet), false);
		assert.equal(fs.existsSync(freshSet), true);
		assert.equal(fs.existsSync(staleTests), false);
		assert.equal(fs.existsSync(activeTests), true);
	});
});
