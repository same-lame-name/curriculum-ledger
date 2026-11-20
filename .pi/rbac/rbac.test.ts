/**
 * Automated RBAC Interaction-Policy Verification Suite
 *
 * Tests all 14 Protected Resources × 10 Principals × 5 Access Verbs (700 matrix verdicts)
 * plus Conditional Predicate / Boundary / Domain-Tool cases, cross-persona teach vs themecp isolation,
 * course tool create/detach invariants, and isolated lifecycle cleanup tests.
 *
 * Run locally via:
 *   node --experimental-strip-types --test .pi/rbac/rbac.test.ts
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import rbacExtension, {
	evaluateAccess,
	evaluateBashCommand,
	evaluateDomainTool,
	loadPolicy,
	parsePrincipal,
	toRelVaultPath,
	type CanonicalVerb,
	type RbacPolicy,
} from "../extensions/rbac.ts";
import housekeepingExtension, {
	purgeSessionArtifacts,
	sweepStaleArtifacts,
} from "../extensions/housekeeping.ts";
import learnExtension, { createTargetedCourse, detachActiveSession } from "../extensions/learn.ts";
import mdLogExtension from "../extensions/md-log.ts";
import teacherExtension from "../extensions/teacher.ts";

const VAULT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const rawPolicy = loadPolicy(VAULT_ROOT);
// Policy assertions always test enforcement semantics.
const POLICY: RbacPolicy = { ...rawPolicy, enabled: true, mode: "enforce" };

const PRINCIPALS = [
	"user",
	"teacher:teach",
	"teacher:themecp",
	"subagent:curriculum-architect",
	"subagent:auditor",
	"subagent:problem-recommender",
	"subagent:resource-recommender",
	"subagent:lab",
	"subagent:problem-grader",
	"subagent:researcher",
] as const;

const VERBS: CanonicalVerb[] = ["read", "write", "create", "delete", "exec"];

interface MatrixRowSpec {
	resourceId: string;
	samplePath: string;
	validExecCmd?: string;
	expected: Record<(typeof PRINCIPALS)[number], string>;
}

// Exact Truth Table aligned with scoped teacher:teach vs teacher:themecp isolation
const EXPECTATION_MATRIX: MatrixRowSpec[] = [
	{
		resourceId: "catalog_sets",
		samplePath: ".pi/catalog/sets/round-1.json",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "R - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "R W C D -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "lab_tests",
		samplePath: ".pi/lab/tests/dp_frog2/01.in",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "R - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "R W C D -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "catalog_static",
		samplePath: ".pi/catalog/catalog.py",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "arena_state",
		samplePath: ".pi/arena/arena.py",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "ladder_state",
		samplePath: ".pi/ladder/ladder.json",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "curriculum_state",
		samplePath: ".pi/curriculum/curriculum.py",
		validExecCmd: "python3 .pi/curriculum/curriculum.py validate courses/dp/curriculum.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "- - - - X*",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "pi_system",
		samplePath: ".pi/browser/browser_fetch.py",
		validExecCmd: "python3 .pi/browser/browser_fetch.py https://example.com",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "R - - - -",
			"subagent:curriculum-architect": "- - - - X*",
			"subagent:auditor": "- - - - X*",
			"subagent:problem-recommender": "- - - - X*",
			"subagent:resource-recommender": "- - - - X*",
			"subagent:lab": "- - - - X*",
			"subagent:problem-grader": "- - - - X*",
			"subagent:researcher": "- - - - X*",
		},
	},
	{
		resourceId: "course_guide",
		samplePath: "courses/dp/curriculum.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "R W C D -",
			"subagent:auditor": "R - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "course_notebook",
		samplePath: "courses/dp/course.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R W* C* - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "R - - - -",
			"subagent:auditor": "R - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "course_sources",
		samplePath: "courses/dp/sources/editorial.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "R - - - -",
			"subagent:auditor": "R - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "R - - - -",
			"subagent:problem-grader": "R - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "course_sessions",
		samplePath: "courses/dp/sessions/2026-11-10.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "- - - - -",
			"subagent:curriculum-architect": "R - - - -",
			"subagent:auditor": "R - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "themecp_docs",
		samplePath: "practice/themecp/diagnoses/2026-11-11.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "R W C D -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "R - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "themecp_sessions",
		samplePath: "practice/themecp/sessions/2026-11-10.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "- - - - -",
			"teacher:themecp": "R - - - -",
			"subagent:curriculum-architect": "- - - - -",
			"subagent:auditor": "- - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
	{
		resourceId: "learner_notes",
		samplePath: "learner.md",
		expected: {
			"user": "R W C D X",
			"teacher:teach": "R - - - -",
			"teacher:themecp": "R - - - -",
			"subagent:curriculum-architect": "R - - - -",
			"subagent:auditor": "R - - - -",
			"subagent:problem-recommender": "- - - - -",
			"subagent:resource-recommender": "- - - - -",
			"subagent:lab": "- - - - -",
			"subagent:problem-grader": "- - - - -",
			"subagent:researcher": "- - - - -",
		},
	},
];

let allowedCount = 0;
let blockedCount = 0;

describe("RBAC Expectation Matrix (14 Resources × 10 Principals × 5 Access Verbs = 700 Verdicts)", () => {
	for (const row of EXPECTATION_MATRIX) {
		describe(`Resource: ${row.resourceId} (${row.samplePath})`, () => {
			for (const principalId of PRINCIPALS) {
				const caller = parsePrincipal(principalId);
				const tokens = row.expected[principalId].split(/\s+/);
				assert.equal(tokens.length, 5, `Malformed verdict spec for ${row.resourceId} / ${principalId}`);

				for (let i = 0; i < 5; i++) {
					const verb = VERBS[i];
					const badge = tokens[i];
					const expectedAllowed = badge !== "-";
					const expectedVerdict = expectedAllowed ? "ALLOWED" : "BLOCKED";

					test(`${principalId} :: ${verb} => ${expectedVerdict}`, () => {
						const command =
							verb === "exec"
								? badge === "X*" && row.validExecCmd
									? row.validExecCmd
									: `python3 ${row.samplePath}`
								: undefined;

						const decision = evaluateAccess(
							row.samplePath,
							{ verb, viaBash: verb === "exec" || verb === "delete", command },
							caller,
							POLICY,
						);

						const actualVerdict = decision.allowed ? "ALLOWED" : "BLOCKED";
						assert.equal(
							actualVerdict,
							expectedVerdict,
							`[${row.resourceId}] ${principalId} ${verb} "${row.samplePath}" -> expected ${expectedVerdict}, got ${actualVerdict} (${decision.reason ?? "allowed"})`,
						);

						if (expectedAllowed) allowedCount++;
						else blockedCount++;
					});
				}
			}
		});
	}
});

describe("RBAC Conditional Predicates, Shell Boundaries & Domain-Tool Checks (C1-C25)", () => {
	const cases: Array<{
		id: string;
		principal: string;
		expected: "ALLOWED" | "BLOCKED";
		run: () => boolean;
	}> = [
		{
			id: "C1: problem-recommender invokes catalog domainTool",
			principal: "subagent:problem-recommender",
			expected: "ALLOWED",
			run: () => evaluateDomainTool("catalog", parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
		},
		{
			id: "C2: resource-recommender invokes catalog domainTool",
			principal: "subagent:resource-recommender",
			expected: "ALLOWED",
			run: () => evaluateDomainTool("catalog", parsePrincipal("subagent:resource-recommender"), POLICY).allowed,
		},
		{
			id: "C3: problem-recommender bash scratch strictly in OS /tmp",
			principal: "subagent:problem-recommender",
			expected: "ALLOWED",
			run: () => evaluateBashCommand("python3 /tmp/pi-recommender-1/filter.py > /tmp/pi-recommender-1/out.json", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
		},
		{
			id: "C4: python -c static catalog mutation smuggle",
			principal: "subagent:problem-recommender",
			expected: "BLOCKED",
			run: () => evaluateBashCommand(`python3 -c "open('.pi/catalog/catalog.json', 'w').write('x')"`, VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
		},
		{
			id: "C5: problem-recommender direct bash bypass python3 .pi/catalog/catalog.py",
			principal: "subagent:problem-recommender",
			expected: "BLOCKED",
			run: () => evaluateBashCommand("python3 .pi/catalog/catalog.py round --slots 900,1000", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
		},
		{
			id: "C6: problem-recommender direct bash bypass python3 .pi/arena/arena.py attempted",
			principal: "subagent:problem-recommender",
			expected: "BLOCKED",
			run: () => evaluateBashCommand("python3 .pi/arena/arena.py attempted", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
		},
		{
			id: "C7: unauthorized callers (teacher:teach / teacher:themecp / lab) invoking catalog domainTool",
			principal: "teacher:teach",
			expected: "BLOCKED",
			run: () =>
				evaluateDomainTool("catalog", parsePrincipal("teacher:teach"), POLICY).allowed ||
				evaluateDomainTool("catalog", parsePrincipal("teacher:themecp"), POLICY).allowed ||
				evaluateDomainTool("catalog", parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C8: researcher invokes browser_fetch.py",
			principal: "subagent:researcher",
			expected: "ALLOWED",
			run: () => evaluateBashCommand("python3 .pi/browser/browser_fetch.py https://codeforces.com/problemset/problem/1/A", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:researcher"), POLICY).allowed,
		},
		{
			id: "C9: researcher cat .pi/rbac/policy.json",
			principal: "subagent:researcher",
			expected: "BLOCKED",
			run: () => evaluateBashCommand("cat .pi/rbac/policy.json", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:researcher"), POLICY).allowed,
		},
		{
			id: "C10: teacher:teach write/edit tool on course.md (structuredWriteOnly)",
			principal: "teacher:teach",
			expected: "ALLOWED",
			run: () => {
				const d = evaluateAccess("courses/dp/course.md", { verb: "write", viaBash: false }, parsePrincipal("teacher:teach"), POLICY);
				return d.allowed && d.matchedResourceId === "course_notebook";
			},
		},
		{
			id: "C11: teacher:teach bash python -c mutation on course.md",
			principal: "teacher:teach",
			expected: "BLOCKED",
			run: () => evaluateBashCommand(`python3 -c "open('courses/dp/course.md','w').write('hack')"`, VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher:teach"), POLICY).allowed,
		},
		{
			id: "C12: teacher:teach sed -i mutation on course.md",
			principal: "teacher:teach",
			expected: "BLOCKED",
			run: () => evaluateBashCommand(`sed -i 's/a/b/' courses/dp/course.md`, VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher:teach"), POLICY).allowed,
		},
		{
			id: "C13: teacher:teach bash read (head -n 20) on course.md",
			principal: "teacher:teach",
			expected: "ALLOWED",
			run: () => evaluateBashCommand("head -n 20 courses/dp/course.md", VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher:teach"), POLICY).allowed,
		},
		{
			id: "C14: lab read unregistered viz/*.png",
			principal: "subagent:lab",
			expected: "ALLOWED",
			run: () => evaluateAccess("viz/dp_tree.png", { verb: "read" }, parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C15: lab write unregistered REPORT.md at vault root",
			principal: "subagent:lab",
			expected: "BLOCKED",
			run: () => evaluateAccess("REPORT.md", { verb: "create" }, parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C16: lab compile & run inside OS /tmp (outside vault)",
			principal: "subagent:lab",
			expected: "ALLOWED",
			run: () => evaluateBashCommand("g++ /tmp/pi-lab-1/ref.cpp -o /tmp/pi-lab-1/ref && /tmp/pi-lab-1/ref", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C17: lab cp from /tmp into courses/dp/sources/ (vault escape)",
			principal: "subagent:lab",
			expected: "BLOCKED",
			run: () => evaluateBashCommand("cp /tmp/pi-lab-1/ref.cpp courses/dp/sources/ref.cpp", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C18: teacher:teach & teacher:themecp raw read on .pi/arena/ledger.jsonl and .pi/ladder/ladder.json",
			principal: "teacher:themecp",
			expected: "BLOCKED",
			run: () => {
				const a = evaluateAccess(".pi/arena/ledger.jsonl", { verb: "read" }, parsePrincipal("teacher:teach"), POLICY);
				const b = evaluateAccess(".pi/ladder/ladder.json", { verb: "read" }, parsePrincipal("teacher:themecp"), POLICY);
				return a.allowed || b.allowed;
			},
		},
		{
			id: "C19: user developer override on protected files",
			principal: "user",
			expected: "ALLOWED",
			run: () => {
				const a = evaluateBashCommand("python3 .pi/ladder/ladder.py open_round", VAULT_ROOT, VAULT_ROOT, parsePrincipal("user"), POLICY);
				const b = evaluateAccess(".pi/rbac/policy.json", { verb: "write" }, parsePrincipal("user"), POLICY);
				return a.allowed && b.allowed;
			},
		},
		{
			id: "C20: teacher:themecp invokes ladder, course, arena_run, arena_ledger",
			principal: "teacher:themecp",
			expected: "ALLOWED",
			run: () =>
				evaluateDomainTool("ladder", parsePrincipal("teacher:themecp"), POLICY).allowed &&
				evaluateDomainTool("course", parsePrincipal("teacher:themecp"), POLICY).allowed &&
				evaluateDomainTool("arena_run", parsePrincipal("teacher:themecp"), POLICY).allowed &&
				evaluateDomainTool("arena_ledger", parsePrincipal("teacher:themecp"), POLICY).allowed,
		},
		{
			id: "C20b: teacher:teach invokes curriculum, arena_run & arena_ledger while blocked from ladder & course",
			principal: "teacher:teach",
			expected: "ALLOWED",
			run: () =>
				evaluateDomainTool("curriculum", parsePrincipal("teacher:teach"), POLICY).allowed &&
				evaluateDomainTool("arena_run", parsePrincipal("teacher:teach"), POLICY).allowed &&
				evaluateDomainTool("arena_ledger", parsePrincipal("teacher:teach"), POLICY).allowed &&
				!evaluateDomainTool("ladder", parsePrincipal("teacher:teach"), POLICY).allowed &&
				!evaluateDomainTool("course", parsePrincipal("teacher:teach"), POLICY).allowed,
		},
		{
			id: "C21: teacher:themecp direct bash bypass python3 .pi/ladder/ladder.py",
			principal: "teacher:themecp",
			expected: "BLOCKED",
			run: () => evaluateBashCommand("python3 .pi/ladder/ladder.py open_round --theme mixed", VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher:themecp"), POLICY).allowed,
		},
		{
			id: "C22: subagent invoking domainTools (ladder / course / curriculum / arena_run)",
			principal: "subagent:lab",
			expected: "BLOCKED",
			run: () =>
				evaluateDomainTool("ladder", parsePrincipal("subagent:lab"), POLICY).allowed ||
				evaluateDomainTool("course", parsePrincipal("subagent:lab"), POLICY).allowed ||
				evaluateDomainTool("curriculum", parsePrincipal("subagent:lab"), POLICY).allowed ||
				evaluateDomainTool("arena_run", parsePrincipal("subagent:lab"), POLICY).allowed,
		},
		{
			id: "C23: teacher:themecp blocked from curriculum domainTool & teacher:teach blocked reading curriculum.md via bash",
			principal: "teacher:teach",
			expected: "BLOCKED",
			run: () =>
				evaluateDomainTool("curriculum", parsePrincipal("teacher:themecp"), POLICY).allowed ||
				evaluateBashCommand("head -n 40 courses/dp/curriculum.md", VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher:teach"), POLICY).allowed,
		},
		{
			id: "C24: curriculum-architect runs curriculum.py validate cleanly",
			principal: "subagent:curriculum-architect",
			expected: "ALLOWED",
			run: () =>
				evaluateBashCommand("python3 .pi/curriculum/curriculum.py validate courses/dp/curriculum.md", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:curriculum-architect"), POLICY).allowed,
		},
		{
			id: "C25: curriculum-architect blocked from curriculum.py overview & editing curriculum.py",
			principal: "subagent:curriculum-architect",
			expected: "BLOCKED",
			run: () =>
				evaluateBashCommand("python3 .pi/curriculum/curriculum.py overview --course dp", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:curriculum-architect"), POLICY).allowed ||
				evaluateAccess(".pi/curriculum/curriculum.py", { verb: "write" }, parsePrincipal("subagent:curriculum-architect"), POLICY).allowed,
		},
	];

	for (const tc of cases) {
		test(`${tc.id} (${tc.principal}) => ${tc.expected}`, () => {
			const actualAllowed = tc.run();
			const actual = actualAllowed ? "ALLOWED" : "BLOCKED";
			assert.equal(actual, tc.expected);
			if (tc.expected === "ALLOWED") allowedCount++;
			else blockedCount++;
		});
	}
});

describe("RBAC Auxiliary Checks (cd tracking & ephemeral lifecycle)", () => {
	test("cd traversal into protected .pi/arena/ gets resolved & blocked", () => {
		const res = evaluateBashCommand("cd .pi/arena && cat history.json", VAULT_ROOT, VAULT_ROOT, parsePrincipal("teacher"), POLICY);
		assert.equal(res.allowed, false);
	});

	test("sed -i in OS /tmp does not confuse sed expression for vault path", () => {
		const res = evaluateBashCommand("sed -i 's/foo/bar/' /tmp/pi-lab-9/test.in", VAULT_ROOT, VAULT_ROOT, parsePrincipal("subagent:lab"), POLICY);
		assert.equal(res.allowed, true);
	});

	test("literal /tmp/pi-{role}-* scratch and existing-dir read globs pass while protected globs remain blocked", () => {
		const lab = parsePrincipal("subagent:lab");
		const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-lab-glob-"));
		try {
			const cfDir = path.join(tmpVault, ".pi", "lab", "tests", "cf_630c");
			const dpDir = path.join(tmpVault, "courses", "dp");
			fs.mkdirSync(cfDir, { recursive: true });
			fs.mkdirSync(dpDir, { recursive: true });
			fs.writeFileSync(path.join(cfDir, "01.in"), "1\n");
			fs.writeFileSync(path.join(cfDir, "01.out"), "2\n");
			fs.writeFileSync(path.join(dpDir, "curriculum.md"), "# Secret\n");

			const vaultPosix = tmpVault.replace(/\\/g, "/");
			const labCmd = [
				"mkdir -p /tmp/pi-lab-1731747123-a4f9",
				"cd /tmp/pi-lab-1731747123-a4f9",
				"cat > ref.cpp <<'EOF'",
				"#include <iostream>",
				"int main() { return 0; }",
				"EOF",
				"g++ -std=c++17 -O2 -o ref ref.cpp",
				`for in_file in ${vaultPosix}/.pi/lab/tests/cf_630c/*.in; do`,
				"    ./ref < /dev/null > my.out",
				"done",
				`file ${vaultPosix}/.pi/lab/tests/cf_630c/*`,
			].join("\n");
			assert.equal(evaluateBashCommand(labCmd, tmpVault, tmpVault, lab, POLICY).allowed, true);
			assert.equal(
				evaluateBashCommand(`cat ${vaultPosix}/courses/dp/*`, tmpVault, tmpVault, parsePrincipal("subagent:problem-recommender"), POLICY).allowed,
				false,
			);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("boolean flags (-n, -c, -o) in grep/sed/cat do not swallow pattern and bypass protected reads", () => {
		const rec = parsePrincipal("subagent:problem-recommender");
		assert.equal(evaluateBashCommand("grep -n '^#' courses/dp/curriculum.md | head -80", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, false);
		assert.equal(evaluateBashCommand("sed -n '112,210p' courses/dp/curriculum.md", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, false);
		assert.equal(evaluateBashCommand("cat -n courses/dp/curriculum.md", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, false);
		assert.equal(evaluateBashCommand("grep -o 'secret' courses/dp/curriculum.md", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, false);
		assert.equal(evaluateBashCommand("sed -f courses/dp/curriculum.md /tmp/out.txt", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, false);

		// Authorized roles (auditor, curriculum-architect) and /tmp reads remain permitted
		const auditor = parsePrincipal("subagent:auditor");
		assert.equal(evaluateBashCommand("grep -n '^#' courses/dp/curriculum.md | head -80", VAULT_ROOT, VAULT_ROOT, auditor, POLICY).allowed, true);
		assert.equal(evaluateBashCommand("sed -n '1,10p' /tmp/pi-recommender-scratch.txt", VAULT_ROOT, VAULT_ROOT, rec, POLICY).allowed, true);
	});

	test("purgeSessionArtifacts & sweepStaleArtifacts clean temp mock vault accurately", () => {
		const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-lifecycle-"));
		try {
			const setsDir = path.join(tmpVault, ".pi", "catalog", "sets");
			const testsDir = path.join(tmpVault, ".pi", "lab", "tests");
			const freshProblem = path.join(testsDir, "cf_fresh");
			const staleProblem = path.join(testsDir, "cf_stale");
			fs.mkdirSync(setsDir, { recursive: true });
			fs.mkdirSync(freshProblem, { recursive: true });
			fs.mkdirSync(staleProblem, { recursive: true });
			fs.writeFileSync(path.join(setsDir, "r1.json"), "[]");

			const tenDaysAgo = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
			fs.utimesSync(staleProblem, tenDaysAgo, tenDaysAgo);

			// 1. TTL sweep only deletes >7d stale entry
			sweepStaleArtifacts(tmpVault);
			assert.equal(fs.existsSync(staleProblem), false);
			assert.equal(fs.existsSync(freshProblem), true);

			// 2. Deterministic reset removes sets/ & tests/ completely
			purgeSessionArtifacts(tmpVault);
			assert.equal(fs.existsSync(setsDir), false);
			assert.equal(fs.existsSync(testsDir), false);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});
});

function createMockPi(
	entries: any[] = [],
	cwd: string = VAULT_ROOT,
	extensions: Array<(pi: any) => void> = [rbacExtension],
) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<any> | any>>();
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const notifications: Array<{ msg: string; level: string }> = [];
	const persisted = [...entries];

	const api: any = {
		on: (ev: string, fn: any) => {
			if (!handlers.has(ev)) handlers.set(ev, []);
			handlers.get(ev)!.push(fn);
		},
		registerCommand: (name: string, spec: any) => {
			commands.set(name, spec);
		},
		registerTool: (spec: any) => {
			tools.set(spec.name, spec);
		},
		appendEntry: (customType: string, data: any) => {
			persisted.push({ type: "custom", customType, data });
		},
	};

	const ctx: any = {
		cwd,
		sessionManager: { getEntries: () => persisted },
		ui: {
			notify: (msg: string, level: string) => notifications.push({ msg, level }),
		},
	};

	for (const ext of extensions) ext(api);

	return {
		emit: async (ev: string, payload: any) => {
			for (const fn of handlers.get(ev) || []) {
				const out = await fn(payload, ctx);
				if (out !== undefined) return out;
			}
			return undefined;
		},
		runCmd: async (name: string, args: string) => commands.get(name)?.handler(args, ctx),
		runTool: async (name: string, params: any) => tools.get(name)?.execute("call-1", params, undefined, undefined, ctx),
		persisted,
		notifications,
		ctx,
	};
}

function createTmpVault(): string {
	const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-harness-"));
	fs.mkdirSync(path.join(tmpVault, ".pi", "rbac"), { recursive: true });
	fs.copyFileSync(
		path.join(VAULT_ROOT, ".pi", "rbac", "policy.json"),
		path.join(tmpVault, ".pi", "rbac", "policy.json"),
	);
	return tmpVault;
}

describe("RBAC Phase 2 Integration Harness (Active Enforcement & Principal Lifecycle)", () => {

	test("policy.json is actively set to enforce mode", () => {
		assert.equal(rawPolicy.enabled, true);
		assert.equal(rawPolicy.mode, "enforce");
	});

	test("root session lifecycle switches user -> teacher -> user via owning extensions and blocks actively", async () => {
		const tmpVault = createTmpVault();
		try {
			const mock = createMockPi([], tmpVault, [
				rbacExtension,
				teacherExtension,
				learnExtension,
				housekeepingExtension,
			]);
			await mock.emit("session_start", {});

			// 1. Default principal is 'user' (Developer Mode) -> edit policy.json ALLOWED
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");
			const devWrite = await mock.emit("tool_call", {
				toolName: "edit",
				input: { path: ".pi/rbac/policy.json" },
			});
			assert.equal(devWrite, undefined);

			// 2. Non-sitting input like /themecp status must NOT escalate principal to teacher
			await mock.emit("input", { text: "/themecp status" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");

			// 3. /skill:teach switches principal to teacher:teach -> active BLOCK on .pi/arena/, ladder, course, practice/themecp/
			await mock.emit("input", { text: "/skill:teach" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:teach");

			const arenaReadBlocked = await mock.emit("tool_call", {
				toolName: "read",
				input: { path: ".pi/arena/history.json" },
			});
			assert.equal(arenaReadBlocked?.block, true);

			const bashCourseBlocked = await mock.emit("tool_call", {
				toolName: "bash",
				input: { command: `python3 -c "open('courses/dp/course.md','w').write('x')"` },
			});
			assert.equal(bashCourseBlocked?.block, true);

			const ladderBlocked = await mock.emit("tool_call", {
				toolName: "ladder",
				input: { action: "status" },
			});
			assert.equal(ladderBlocked?.block, true);

			const courseBlocked = await mock.emit("tool_call", {
				toolName: "course",
				input: { action: "create", slug: "test" },
			});
			assert.equal(courseBlocked?.block, true);

			assert.equal(await mock.emit("tool_call", { toolName: "curriculum", input: { action: "overview" } }), undefined);
			const guideReadBlocked = await mock.emit("tool_call", {
				toolName: "read",
				input: { path: "courses/dp/curriculum.md" },
			});
			assert.equal(guideReadBlocked?.block, true);

			// 4. Explicit deactivate restores developer mode, then /skill:themecp switches to teacher:themecp
			(globalThis as any).__piTeacher.deactivate();
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");

			await mock.emit("input", { text: "/skill:themecp" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:themecp");
			assert.equal(await mock.emit("tool_call", { toolName: "ladder", input: { action: "status" } }), undefined);
			assert.equal(await mock.emit("tool_call", { toolName: "course", input: { action: "create", slug: "rerooting" } }), undefined);
			assert.equal((await mock.emit("tool_call", { toolName: "curriculum", input: { action: "overview" } }))?.block, true);
			assert.equal((await mock.emit("tool_call", { toolName: "read", input: { path: "courses/dp/course.md" } }))?.block, true);
			(globalThis as any).__piTeacher.deactivate();
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");

			// 5. /course new (learn.ts) sets teacher:teach + triggers housekeeping purge; /course pause restores 'user'
			const prevMdLog = (globalThis as any).__piMdLog;
			(globalThis as any).__piMdLog = { link: () => ({ ok: true }), unlink: () => ({ ok: true }) };
			try {
				const staleSetDir = path.join(tmpVault, ".pi", "catalog", "sets");
				fs.mkdirSync(staleSetDir, { recursive: true });
				fs.writeFileSync(path.join(staleSetDir, "old.json"), "[]");
				await mock.runCmd("course", "new dp");
				assert.equal(fs.existsSync(staleSetDir), false);
				assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:teach");

				await mock.runCmd("course", "pause");
				assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");
			} finally {
				(globalThis as any).__piMdLog = prevMdLog;
			}
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("course tool scaffolds targeted course cleanly and detaches ThemeCP without polluting active pointers", async () => {
		const tmpVault = createTmpVault();
		try {
			fs.mkdirSync(path.join(tmpVault, ".pi", "skills", "themecp"), { recursive: true });
			fs.writeFileSync(path.join(tmpVault, ".pi", "skills", "themecp", "SKILL.md"), "<!-- voice:start -->Proctor<!-- voice:end -->\n");
			fs.writeFileSync(path.join(tmpVault, ".active-course"), "none\n");
			fs.writeFileSync(path.join(tmpVault, ".active-session"), "practice/themecp/sessions/2026-11-11.md\n");

			const prevMdLog = (globalThis as any).__piMdLog;
			let unlinked = 0;
			(globalThis as any).__piMdLog = { link: () => ({ ok: true }), unlink: () => { unlinked++; return { ok: true }; } };
			try {
				const mock = createMockPi([], tmpVault, [rbacExtension, teacherExtension, learnExtension]);
				await mock.emit("session_start", {});
				await mock.emit("input", { text: "/skill:themecp" });
				assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:themecp");

				const createdRes = createTargetedCourse(tmpVault, {
					slug: "tree-rerooting",
					goal: "Master all-roots tree DP transitions",
					contextNote: "Stuck switching parent->child DP state in cf_1914e2",
					sources: [{ filename: "../escape/brief", content: "# Rerooting DP Gap\nConstraints & statement." }],
				});
				assert.equal(createdRes.created, true);
				assert.equal(createdRes.slug, "tree-rerooting");
				assert.equal(fs.existsSync(path.join(tmpVault, "courses", "tree-rerooting", "course.md")), true);
				assert.equal(fs.existsSync(path.join(tmpVault, "courses", "tree-rerooting", "sources", "brief.md")), true);
				// Active pointers MUST remain unchanged after create
				assert.equal(fs.readFileSync(path.join(tmpVault, ".active-course"), "utf-8"), "none\n");

				// Repeating create never overwrites existing course
				const dupRes = createTargetedCourse(tmpVault, { slug: "tree-rerooting", goal: "Overwrite attempt" });
				assert.equal(dupRes.created, false);
				assert.equal(dupRes.exists, true);

				// detach exits sitting cleanly back to user
				detachActiveSession(tmpVault);
				assert.equal(unlinked, 1);
				assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");
				assert.equal(fs.readFileSync(path.join(tmpVault, ".active-session"), "utf-8"), "");
			} finally {
				(globalThis as any).__piMdLog = prevMdLog;
			}
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("subagent detection via marker blocks stray vault write and allows /tmp + own tests", async () => {
		const mock = createMockPi();
		await mock.emit("session_start", {});
		await mock.emit("before_agent_start", { systemPrompt: "System prompt\n<!-- agent:lab -->" });

		assert.equal((globalThis as any).__piRbac.getPrincipal().id, "subagent:lab");

		const strayWrite = await mock.emit("tool_call", {
			toolName: "write",
			input: { path: "REPORT.md" },
		});
		assert.equal(strayWrite?.block, true);

		const scratchBash = await mock.emit("tool_call", {
			toolName: "bash",
			input: { command: "g++ /tmp/pi-lab-x/ref.cpp -o /tmp/pi-lab-x/ref && /tmp/pi-lab-x/ref" },
		});
		assert.equal(scratchBash, undefined);

		const validLabWrite = await mock.emit("tool_call", {
			toolName: "write",
			input: { path: ".pi/lab/tests/cf_1/01.in" },
		});
		assert.equal(validLabWrite, undefined);

		// Multi-line heredoc containing C++ code (#include <iostream>) and comparison operators (=, <) in /tmp
		const heredocBash = await mock.emit("tool_call", {
			toolName: "bash",
			input: {
				command: `cat << 'EOF' > /tmp/pi-grader-1/check.cpp
#include <iostream>
int main() {
    int a = 1, b = 2;
    if (a < b) std::cout << "OK\\n";
    return 0;
}
EOF
g++ -O2 /tmp/pi-grader-1/check.cpp -o /tmp/pi-grader-1/check
if [ "$?" = "0" ]; then /tmp/pi-grader-1/check; fi`,
			},
		});
		assert.equal(heredocBash, undefined, "Multi-line heredoc with C++ headers & operators in /tmp must pass cleanly");

		// Subagents cannot run /rbac commands
		await mock.runCmd("rbac", "off");
		assert.match(mock.notifications.at(-1)?.msg || "", /Subagents cannot run \/rbac/);
	});

	test("persisted session reload honors last deactivated principal entry", async () => {
		const mock = createMockPi([
			{ type: "custom", customType: "rbac-principal", data: { principal: "teacher" } },
			{ type: "custom", customType: "rbac-principal", data: { principal: "user" } },
		]);
		await mock.emit("session_start", {});
		assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");
	});
});

describe("RBAC Strict Separation & Owning Extension Boundaries", () => {
	test("strict boundary hygiene across extensions (rbac unburdened, legacy deleted)", () => {
		const extDir = path.join(VAULT_ROOT, ".pi", "extensions");
		assert.equal(fs.existsSync(path.join(extDir, "lab.ts")), false);
		assert.equal(fs.existsSync(path.join(extDir, "subagents.ts")), false);
		assert.equal(fs.existsSync(path.join(extDir, "housekeeping.ts")), true);
		assert.equal(fs.existsSync(path.join(extDir, "catalog.ts")), true);

		const rbacSrc = fs.readFileSync(path.join(extDir, "rbac.ts"), "utf-8");
		for (const unwanted of [
			"tool_result",
			"snapshotVaultState",
			"MAX_SNAPSHOT_BYTES",
			"registerValidator",
			"purgeSessionArtifacts",
			"sweepStaleArtifacts",
			"validateNotebookBudget",
			"__piTeacher",
			'pi.on("input"',
		]) {
			assert.equal(rbacSrc.includes(unwanted), false, `rbac.ts must stay pure (found "${unwanted}")`);
		}

		for (const file of ["arena.ts", "catalog.ts", "course.ts", "curriculum.ts", "ladder.ts", "learn.ts"]) {
			const src = fs.readFileSync(path.join(extDir, file), "utf-8");
			assert.equal(/pi\.on\("tool_call"/.test(src), false, `${file} must not register tool_call`);
			assert.equal(/pi\.on\("tool_result"/.test(src), false, `${file} must not register tool_result`);
			assert.equal(/function purgeSessionArtifacts/.test(src), false, `${file} must delegate purgeSessionArtifacts`);
		}
		assert.match(fs.readFileSync(path.join(extDir, "learn.ts"), "utf-8"), /__piHousekeeping\?\.purgeSessionArtifacts/);
		assert.match(fs.readFileSync(path.join(extDir, "ladder.ts"), "utf-8"), /__piHousekeeping\?\.purgeSessionArtifacts/);
	});

	test("tightened lab_tests rule allows .in/.out and blocks stray files under .pi/lab/", () => {
		const lab = parsePrincipal("subagent:lab");
		assert.equal(evaluateAccess(".pi/lab/tests/p1/01.in", { verb: "create" }, lab, POLICY).allowed, true);
		assert.equal(evaluateAccess(".pi/lab/tests/p1/01.out", { verb: "write" }, lab, POLICY).allowed, true);
		assert.equal(evaluateAccess(".pi/lab/tests/p1/checker.cpp", { verb: "create" }, lab, POLICY).allowed, true);
		assert.equal(evaluateAccess(".pi/lab/tests/p1/checker.py", { verb: "write" }, lab, POLICY).allowed, true);
		assert.equal(evaluateAccess(".pi/lab/tests/p1/spoiler.md", { verb: "create" }, lab, POLICY).allowed, false);
		assert.equal(evaluateAccess(".pi/lab/stray.txt", { verb: "create" }, lab, POLICY).allowed, false);
	});

	test("catalog domain tool replaces static catalog bash calls while preserving sets & /tmp bash", async () => {
		const tmpVault = createTmpVault();
		try {
			const mock = createMockPi([], tmpVault, [rbacExtension]);
			await mock.emit("session_start", {});
			await mock.emit("before_agent_start", { systemPrompt: "Rec\n<!-- agent:problem-recommender -->" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "subagent:problem-recommender");

			// catalog tool + sets write + /tmp bash ALLOWED
			assert.equal(await mock.emit("tool_call", { toolName: "catalog", input: { action: "round", slots: "900,1000,1200,1400", theme: "mixed" } }), undefined);
			assert.equal(await mock.emit("tool_call", { toolName: "write", input: { path: ".pi/catalog/sets/round-2026-11-10.json" } }), undefined);
			assert.equal(await mock.emit("tool_call", { toolName: "bash", input: { command: "python3 /tmp/pi-recommender-1/work.py" } }), undefined);

			// Direct read / bash on static catalog or arena ledger BLOCKED
			assert.equal((await mock.emit("tool_call", { toolName: "read", input: { path: ".pi/catalog/catalog.json" } }))?.block, true);
			assert.equal((await mock.emit("tool_call", { toolName: "bash", input: { command: "python3 .pi/catalog/catalog.py domains" } }))?.block, true);
			assert.equal((await mock.emit("tool_call", { toolName: "bash", input: { command: "python3 .pi/arena/arena.py attempted" } }))?.block, true);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("teacher.ts enforces notebookBudget independently of RBAC while rbac.ts blocks bash mutation", async () => {
		const tmpVault = createTmpVault();
		try {
			const courseDir = path.join(tmpVault, "courses", "dp");
			fs.mkdirSync(courseDir, { recursive: true });
			const validNote = "# DP\n\n## Where the student stands\n\nSolid base.\n\n## Plan\n\nNext.\n";
			fs.writeFileSync(path.join(courseDir, "course.md"), validNote, "utf-8");

			const mock = createMockPi([], tmpVault, [rbacExtension, teacherExtension]);
			await mock.emit("session_start", {});
			await mock.emit("input", { text: "/skill:teach" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:teach");

			// Valid edit passes
			const okWrite = await mock.emit("tool_call", {
				toolName: "write",
				input: { path: "courses/dp/course.md", content: validNote },
			});
			assert.equal(okWrite, undefined);

			// Unknown heading blocked directly by teacher.ts content guard
			const badHeading = await mock.emit("tool_call", {
				toolName: "write",
				input: { path: "courses/dp/course.md", content: `${validNote}\n## Spoilers\nOops\n` },
			});
			assert.equal(badHeading?.block, true);
			assert.match(badHeading?.reason || "", /not one of the notebook's sections/);

			// Edit pushing section over budget blocked
			const hugeText = "x".repeat(2700);
			const overBudget = await mock.emit("tool_call", {
				toolName: "edit",
				input: {
					path: "courses/dp/course.md",
					edits: [{ oldText: "Solid base.", newText: hugeText }],
				},
			});
			assert.equal(overBudget?.block, true);
			assert.match(overBudget?.reason || "", /budget 2600/);

			// /rbac off disables RBAC access control, NOT teacher.ts notebook content validation
			await mock.runCmd("rbac", "off");
			const bashAllowedWhenRbacOff = await mock.emit("tool_call", {
				toolName: "bash",
				input: { command: "rm courses/dp/course.md" },
			});
			assert.equal(bashAllowedWhenRbacOff, undefined);
			const budgetStillEnforced = await mock.emit("tool_call", {
				toolName: "write",
				input: { path: "courses/dp/course.md", content: `${validNote}\n## Freeform\n` },
			});
			assert.equal(budgetStillEnforced?.block, true);
			await mock.runCmd("rbac", "on");

			// Bash mutation on course.md blocked by RBAC structuredWriteOnly
			const bashBlocked = await mock.emit("tool_call", {
				toolName: "bash",
				input: { command: `sed -i 's/a/b/' courses/dp/course.md` },
			});
			assert.equal(bashBlocked?.block, true);

			// Deactivate sitting -> human developer mode allows manual edits
			(globalThis as any).__piTeacher.deactivate();
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "user");
			const devOverride = await mock.emit("tool_call", {
				toolName: "write",
				input: { path: "courses/dp/course.md", content: `${validNote}\n## Custom Note\n${hugeText}\n` },
			});
			assert.equal(devOverride, undefined);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("housekeeping.ts sweeps >7d artifacts on root session_start outside RBAC", async () => {
		const tmpVault = createTmpVault();
		try {
			const testsDir = path.join(tmpVault, ".pi", "lab", "tests");
			const freshProblem = path.join(testsDir, "cf_fresh");
			const staleProblem = path.join(testsDir, "cf_stale");
			fs.mkdirSync(freshProblem, { recursive: true });
			fs.mkdirSync(staleProblem, { recursive: true });
			const tenDaysAgo = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
			fs.utimesSync(staleProblem, tenDaysAgo, tenDaysAgo);

			const mock = createMockPi([], tmpVault, [housekeepingExtension]);
			await mock.emit("session_start", {});

			assert.equal(fs.existsSync(staleProblem), false);
			assert.equal(fs.existsSync(freshProblem), true);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("teacher.ts preserves voice anchoring on /skill:teach and clears on deactivate", async () => {
		const tmpVault = createTmpVault();
		try {
			fs.mkdirSync(path.join(tmpVault, ".pi", "skills", "teach"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpVault, ".pi", "skills", "teach", "SKILL.md"),
				"<!-- voice:start -->Warm Socratic mentor<!-- voice:end -->\n",
				"utf-8",
			);

			const mock = createMockPi([], tmpVault, [teacherExtension]);
			await mock.emit("session_start", {});
			assert.equal(await mock.emit("before_agent_start", { systemPrompt: "Base" }), undefined);

			await mock.emit("input", { text: "/skill:teach" });
			const withVoice = await mock.emit("before_agent_start", { systemPrompt: "Base" });
			assert.match(withVoice?.systemPrompt || "", /Base/);
			assert.match(withVoice?.systemPrompt || "", /Warm Socratic mentor/);

			mock.ctx.model = { provider: "antigravity", api: "agy-bridge", id: "gemini-3.8-flash" };
			const agyVoiceOnly = await mock.emit("before_agent_start", { systemPrompt: "Base" });
			assert.equal(agyVoiceOnly?.systemPrompt, "# Your voice in this sitting\n\nWarm Socratic mentor\n");
			assert.doesNotMatch(agyVoiceOnly?.systemPrompt || "", /Base/);
			delete mock.ctx.model;

			(globalThis as any).__piTeacher.deactivate();
			assert.equal(await mock.emit("before_agent_start", { systemPrompt: "Base" }), undefined);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});
});

describe("First-Class Tools, Subagents & Persona Contracts", () => {
	test("extension tools self-contain rules in description without promptSnippet/promptGuidelines and strip TypeScript cleanly", () => {
		const extDir = path.join(VAULT_ROOT, ".pi", "extensions");
		for (const file of fs.readdirSync(extDir).filter((f) => f.endsWith(".ts"))) {
			const src = fs.readFileSync(path.join(extDir, file), "utf-8");
			assert.doesNotThrow(() => stripTypeScriptTypes(src), `Failed to strip TS in ${file}`);
		}

		const requiredManualFiles = [
			"arena.ts",
			"ladder.ts",
			"catalog.ts",
			"curriculum.ts",
			"course.ts",
			"browser-fetch.ts",
			"quiz.ts",
			"ask-user-question.ts",
		];
		for (const file of requiredManualFiles) {
			const src = fs.readFileSync(path.join(extDir, file), "utf-8");
			assert.doesNotMatch(src, /promptSnippet:/, `${file} must fold summary into description without promptSnippet`);
			assert.doesNotMatch(src, /promptGuidelines:\s*\[/, `${file} must fold guidelines into description without promptGuidelines`);
			assert.match(src, /description:/, `${file} must define description`);
		}

		const arenaSrc = fs.readFileSync(path.join(extDir, "arena.ts"), "utf-8");
		assert.match(arenaSrc, /get_standing:/);
		assert.match(arenaSrc, /approachNote=\\?"required\\?"/);
		assert.match(arenaSrc, /strictOrder=true/);
		assert.match(arenaSrc, /On `ABANDON`, verify at your discretion/);

		const catalogSrc = fs.readFileSync(path.join(extDir, "catalog.ts"), "utf-8");
		assert.match(catalogSrc, /Pass `excludeAttempted: true`/);
		assert.doesNotMatch(catalogSrc, /automatically cross-references global Arena history to exclude/);

		const curriculumSrc = fs.readFileSync(path.join(extDir, "curriculum.ts"), "utf-8");
		assert.match(curriculumSrc, /Always call `overview` once at the start of every course sitting/);
		assert.doesNotMatch(curriculumSrc, /open those directly with `read`/);

		const browserFetchSrc = fs.readFileSync(path.join(extDir, "browser-fetch.ts"), "utf-8");
		assert.doesNotMatch(browserFetchSrc, /\bCodeforces\b|\bAtCoder\b|\bCSES\b|\bjudges\b/i, "browser-fetch.ts must remain domain-agnostic");
	});

	test("teach and themecp skills satisfy persona purity, feature parity, state clarity, independence, and Obsidian schema budgets", async () => {
		const teachPath = path.join(VAULT_ROOT, ".pi", "skills", "teach", "SKILL.md");
		const themecpPath = path.join(VAULT_ROOT, ".pi", "skills", "themecp", "SKILL.md");
		const teachRaw = fs.readFileSync(teachPath, "utf-8");
		const themecpRaw = fs.readFileSync(themecpPath, "utf-8");

		for (const [label, content] of [["teach", teachRaw], ["themecp", themecpRaw]] as const) {
			const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
			assert.ok(fmMatch, `${label} must contain YAML frontmatter`);
			for (const line of fmMatch![1].split(/\r?\n/)) {
				if (!line.includes(":")) continue;
				const val = line.slice(line.indexOf(":") + 1).trim();
				if (val.includes(": ") && !(val.startsWith('"') && val.endsWith('"'))) {
					assert.fail(`${label}/SKILL.md YAML frontmatter has unquoted ': ' value: ${line}`);
				}
			}
			assert.match(content, /<!--\s*voice:start\s*-->[\s\S]+<!--\s*voice:end\s*-->/, `${label} must wrap voice anchor`);
			assert.match(content, /standard LaTeX/, `${label} must instruct Obsidian LaTeX formatting inside voice block`);
			assert.match(content, /\[RBAC\]/, `${label} must introduce [RBAC]`);
			assert.match(content, /\barena_ledger\b/, `${label} must clarify Arena ledger state`);
			for (const forbidden of [
				/\bhold_back\b/,
				/\btestsDir\b/,
				/\bcourseSlug\b/,
				/\bblindMetadata\b/,
				/\bSTAGE\b/,
				/\bTESTS_DIR\b/,
				/\bsolution_path\b/,
				/\bapproachNote\b/,
				/stage:\s*[012]\b/,
				/<leader>/,
				/\.pi\/agents\/catalog/,
				/\.pi\/lab\/tests/,
				/g\+\+ -std=/,
				/01\.in/,
				/\bNeovim\b/,
				/\bcourses\/\*\b/,
				/\bNever\s+/,
				/\bCodeforces\b/i,
				/\bAtCoder\b/i,
				/\bfor example\b/i,
				/\bfor instance\b/i,
			]) {
				assert.doesNotMatch(content, forbidden, `${label}/SKILL.md leaked forbidden detail: ${forbidden}`);
			}
		}

		// themecp skill stands independently without persona cross-references, preserving all core features
		assert.doesNotMatch(themecpRaw, /Same person as in|Same rules as `teach`|Feynman mode|\bteach skill\b/i);
		assert.match(themecpRaw, /\bladder\b/);
		assert.match(themecpRaw, /Nature cannot be fooled/);
		assert.match(themecpRaw, /\*\*Inception\*\*/);
		assert.match(themecpRaw, /\*\*Intuition\*\*/);
		assert.match(themecpRaw, /\*\*Implementation\*\*/);
		for (const lbl of ["clean", "slow-recognition", "wrong-idea", "buggy-implementation", "not-reached"]) {
			assert.ok(themecpRaw.includes(`\`${lbl}\``), `themecp must include ladder label ${lbl}`);
		}
		assert.match(themecpRaw, /## Where it broke/);
		assert.match(themecpRaw, /## Recent rounds/);
		assert.match(themecpRaw, /up_to_round_id/);
		assert.match(themecpRaw, /rounds_analyzed/);
		assert.match(themecpRaw, /practice\/themecp\/rounds\//);
		assert.match(themecpRaw, /practice\/themecp\/ladder\.md/);
		assert.match(themecpRaw, /practice\/themecp\/diagnoses\//);
		assert.match(themecpRaw, /\*\*Build hidden tests:\*\*/);
		assert.match(themecpRaw, /On `ABANDON` \(`not-reached`\), decide yourself/);

		// teach skill preserves pedagogy sections, intake, learner.md, and ad-hoc clarification
		assert.match(teachRaw, /## The board/);
		assert.match(teachRaw, /## Whose decisions/);
		assert.match(teachRaw, /## How you teach/);
		assert.match(teachRaw, /## The intake/);
		assert.match(teachRaw, /inspect the course overview via `curriculum` once at sitting start/);
		assert.match(teachRaw, /ask_user_question/);
		assert.match(teachRaw, /Ad-hoc/i);
		assert.match(teachRaw, /For learner\.md/);
		assert.match(teachRaw, /\*\*Hidden tests executed:\*\*/);
		assert.match(teachRaw, /\*\*`ABANDON`:\*\* Your call/);

		// Real teach voice & course.md template load cleanly through teacher.ts hooks
		const templateMatch = teachRaw.match(/### course\.md schema[\s\S]*?```markdown\r?\n([\s\S]*?)\r?\n```/);
		assert.ok(templateMatch, "teach/SKILL.md must define the fenced course.md schema template");

		const tmpVault = createTmpVault();
		try {
			fs.mkdirSync(path.join(tmpVault, ".pi", "skills", "teach"), { recursive: true });
			fs.mkdirSync(path.join(tmpVault, ".pi", "skills", "themecp"), { recursive: true });
			fs.mkdirSync(path.join(tmpVault, "courses", "dp"), { recursive: true });
			fs.copyFileSync(teachPath, path.join(tmpVault, ".pi", "skills", "teach", "SKILL.md"));
			fs.copyFileSync(themecpPath, path.join(tmpVault, ".pi", "skills", "themecp", "SKILL.md"));

			const mock = createMockPi([], tmpVault, [teacherExtension]);
			await mock.emit("session_start", {});

			await mock.emit("input", { text: "/skill:teach" });
			const teachPrompt = await mock.emit("before_agent_start", { systemPrompt: "Base" });
			assert.match(teachPrompt?.systemPrompt || "", /Your voice in this sitting/);
			assert.match(teachPrompt?.systemPrompt || "", /Who you are/);

			const writeTemplate = await mock.emit("tool_call", {
				toolName: "write",
				input: { path: "courses/dp/course.md", content: templateMatch![1] },
			});
			assert.equal(writeTemplate, undefined, "teach/SKILL.md course.md template must pass teacher.ts budget validation");

			(globalThis as any).__piTeacher.deactivate();
			await mock.emit("input", { text: "/skill:themecp" });
			const themecpPrompt = await mock.emit("before_agent_start", { systemPrompt: "Base" });
			assert.match(themecpPrompt?.systemPrompt || "", /sparring partner for timed contest practice, in Richard Feynman's spirit/);
			assert.match(themecpPrompt?.systemPrompt || "", /Nature cannot be fooled/);

			(globalThis as any).__piTeacher.deactivate();
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("separates Teacher Notebook Guard from RBAC and exposes __piRbac.setEnabled", async () => {
		const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nb-sep-"));
		try {
			fs.mkdirSync(path.join(tmpVault, "courses", "dp"), { recursive: true });
			fs.writeFileSync(path.join(tmpVault, ".active-course"), "dp\n");
			fs.writeFileSync(path.join(tmpVault, "courses", "dp", "course.md"), "## Where we are\nok\n");

			const mock = createMockPi([], tmpVault, [teacherExtension]);
			await mock.emit("session_start", {});
			await mock.emit("input", { text: "/skill:teach" });
			assert.equal((globalThis as any).__piRbac.getPrincipal().id, "teacher:teach");

			const hugeCourseMd = `---\nstate: active\n---\n\n## Where we are\n${"x".repeat(3000)}\n`;

			// RBAC alone checks actor/path/tool permissions (allows active course write)
			const rbacCheck = (globalThis as any).__piRbac.checkPermission("write", {
				path: "courses/dp/course.md",
				content: hugeCourseMd,
			});
			assert.equal(rbacCheck.allowed, true, "RBAC must not enforce notebook section char budgets");

			// Teacher guard enforces notebook section budgets directly
			const nbReason = (globalThis as any).__piTeacher.checkNotebookGuard({
				toolName: "write",
				input: { path: "courses/dp/course.md", content: hugeCourseMd },
				cwd: tmpVault,
			});
			assert.ok(nbReason && nbReason.length > 0, "Teacher checkNotebookGuard must flag oversized course.md");

			// Teacher runtime RBAC toggle via setEnabled(false)
			const deniedBefore = (globalThis as any).__piRbac.checkPermission("write", {
				path: ".pi/catalog/problems.json",
				content: "{}",
			});
			assert.equal(deniedBefore.allowed, false);

			(globalThis as any).__piRbac.setEnabled(false);
			const allowedAfterOff = (globalThis as any).__piRbac.checkPermission("write", {
				path: ".pi/catalog/problems.json",
				content: "{}",
			});
			assert.equal(allowedAfterOff.allowed, true);
		} finally {
			(globalThis as any).__piRbac?.setEnabled?.(true);
			(globalThis as any).__piTeacher?.deactivate?.();
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});

	test("md-log rolls over stale dated session paths on session_start for courses and themecp", async () => {
		const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mdlog-roll-"));
		try {
			const now = new Date();
			const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

			// 1. Course session rollover
			const courseDir = path.join(tmpVault, "courses", "dp");
			fs.mkdirSync(path.join(courseDir, "sessions"), { recursive: true });
			fs.writeFileSync(path.join(courseDir, "course.md"), "---\nstate: active\n---\n\n## Session log\n- 2000-01-01 → sessions/2000-01-01.md\n");
			const staleCourseLog = path.join(courseDir, "sessions", "2000-01-01.md");
			fs.writeFileSync(staleCourseLog, "old log\n");

			const mockCourse = createMockPi(
				[{ type: "custom", customType: "md-log", data: { file: staleCourseLog } }],
				tmpVault,
				[mdLogExtension],
			);
			await mockCourse.emit("session_start", {});

			const todayCourseLog = path.join(courseDir, "sessions", `${today}.md`);
			assert.equal(fs.existsSync(todayCourseLog), true, "Today course session file must be created on rollover");
			assert.equal(
				fs.readFileSync(path.join(tmpVault, ".active-session"), "utf-8").trim(),
				`courses/dp/sessions/${today}.md`,
			);
			assert.match(fs.readFileSync(path.join(courseDir, "course.md"), "utf-8"), new RegExp(`- ${today} → sessions/${today}\\.md`));

			// 2. ThemeCP session rollover
			const themecpSessions = path.join(tmpVault, "practice", "themecp", "sessions");
			fs.mkdirSync(themecpSessions, { recursive: true });
			const staleThemeLog = path.join(themecpSessions, "2000-01-01.md");
			fs.writeFileSync(staleThemeLog, "# ThemeCP Session — 2000-01-01\n");

			const mockTheme = createMockPi(
				[{ type: "custom", customType: "md-log", data: { file: staleThemeLog } }],
				tmpVault,
				[mdLogExtension],
			);
			await mockTheme.emit("session_start", {});

			const todayThemeLog = path.join(themecpSessions, `${today}.md`);
			assert.equal(fs.existsSync(todayThemeLog), true);
			assert.match(fs.readFileSync(todayThemeLog, "utf-8"), new RegExp(`# ThemeCP Session — ${today}`));
			assert.equal(
				fs.readFileSync(path.join(tmpVault, ".active-session"), "utf-8").trim(),
				`practice/themecp/sessions/${today}.md`,
			);
		} finally {
			fs.rmSync(tmpVault, { recursive: true, force: true });
		}
	});
});
