/**
 * rbac — Strict Minimal Producer-Consumer Role-Based Access Control engine.
 *
 * Scope:
 * - Governs access control (Who + Canonical Verb + Target) for paths inside
 *   `vaultRoot` plus registered `domainTools` (catalog, curriculum, ladder, course, arena_run, arena_ledger).
 * - Out-of-vault OS scratch (such as `/tmp`) is intentionally out of RBAC scope.
 * - Non-RBAC concerns live in their own owning modules:
 *   - `teacher.ts`: Voice Anchoring + `course.md` content/budget guard.
 *   - `housekeeping.ts`: session artifact TTL sweep & session-reset cleanup.
 *   - `learn.ts`, `ladder.ts`, `md-log.ts`, `teacher.ts`: push principal state
 *     transitions (`user` <-> `teacher:teach` / `teacher:themecp`) via `__piRbac.setPrincipal`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export type CanonicalVerb = "read" | "write" | "create" | "delete" | "exec";
export type PrincipalKind = "user" | "teacher" | "subagent";
export type SessionPrincipalId = "user" | "teacher" | "teacher:teach" | "teacher:themecp";

export interface Principal {
	kind: PrincipalKind;
	id: string;
}

export interface CanonicalAction {
	verb: CanonicalVerb;
	viaBash?: boolean;
	command?: string;
}

export interface ConsumerRule {
	principal: string;
	actions: CanonicalVerb[];
	execPattern?: string;
}

export interface ResourceRule {
	id: string;
	path: string | string[];
	exclude?: string[];
	producer: string;
	consumers: ConsumerRule[];
	structuredWriteOnly?: boolean;
	denyMessage?: string;
}

export interface RbacPolicy {
	version: number;
	enabled: boolean;
	mode?: "shadow" | "enforce";
	defaults: Record<string, CanonicalVerb[]>;
	domainTools: Record<string, string[]>;
	resources: ResourceRule[];
}

export interface Decision {
	allowed: boolean;
	reason?: string;
	matchedResourceId?: string;
}

export interface BashCheck {
	relVaultPath: string | null;
	rawTarget: string;
	action: CanonicalAction;
}

const PRINCIPAL_ENTRY = "rbac-principal";
const POLICY_REL_PATH = path.join(".pi", "rbac", "policy.json");

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

export function isSubagentProcess(): boolean {
	return Boolean(
		process.env.PI_SUBAGENT_ID ||
			process.env.PI_SUBAGENT_NAME ||
			process.env.PI_SUBAGENT_AGENT ||
			process.env.PI_SUBAGENT_SESSION,
	);
}

export function parsePrincipal(principalId: string): Principal {
	const trimmed = principalId.trim();
	if (trimmed === "user") return { kind: "user", id: "user" };
	if (trimmed === "teacher" || trimmed === "teacher:teach" || trimmed === "teacher:themecp") {
		return { kind: "teacher", id: trimmed };
	}
	if (trimmed.startsWith("subagent:")) return { kind: "subagent", id: trimmed };
	throw new Error(`Invalid RBAC principal: "${principalId}". Expected "user", "teacher[:teach|:themecp]", or "subagent:<role>".`);
}

export function matchesPrincipal(caller: Principal, pattern: string): boolean {
	if (pattern === "*" || pattern === caller.id) return true;
	if (pattern === "subagent:*" && caller.kind === "subagent") return true;
	if ((pattern === "teacher" || pattern === "teacher:*") && caller.kind === "teacher") return true;
	return false;
}

export function loadPolicy(vaultRoot: string): RbacPolicy {
	const policyFile = path.join(vaultRoot, POLICY_REL_PATH);
	const raw = fs.readFileSync(policyFile, "utf-8");
	return JSON.parse(raw) as RbacPolicy;
}

/**
 * Resolves `rawTarget` relative to `cwd` and maps it to a vault-relative POSIX path.
 * Returns `null` when the resolved target falls outside `vaultRoot` (e.g., `/tmp/...`).
 */
export function toRelVaultPath(vaultRoot: string, cwd: string, rawTarget: string): string | null {
	const normInput = rawTarget.replace(/\\/g, "/").trim();
	if (!normInput) return null;

	const absRoot = path.resolve(vaultRoot);
	const resolved = path.resolve(cwd, normInput);
	const rel = path.relative(absRoot, resolved).replace(/\\/g, "/");

	if (rel === "..") return null;
	if (rel.startsWith("../")) return null;
	if (path.isAbsolute(rel)) return null;

	return rel.replace(/\/+$/, "");
}

function globToRegex(pattern: string): RegExp {
	const norm = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
	let regex = "^";
	let i = 0;
	while (i < norm.length) {
		if (norm.startsWith("/**", i)) {
			regex += "(?:/.*)?";
			i += 3;
		} else if (norm.startsWith("**/", i)) {
			regex += "(?:.*/)?";
			i += 3;
		} else if (norm.startsWith("**", i)) {
			regex += ".*";
			i += 2;
		} else if (norm[i] === "*") {
			regex += "[^/]*";
			i += 1;
		} else {
			regex += norm[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			i += 1;
		}
	}
	return new RegExp(regex + "$");
}

function patternSpecificity(pattern: string): number {
	const wildcardIdx = pattern.indexOf("*");
	const literalPrefix = wildcardIdx >= 0 ? pattern.slice(0, wildcardIdx) : pattern;
	return literalPrefix.length + (wildcardIdx < 0 ? 1000 : 0);
}

export function matchesGlob(relPath: string, pattern: string): boolean {
	return globToRegex(pattern).test(relPath);
}

export function matchResource(relPath: string, resources: ResourceRule[]): ResourceRule | null {
	let bestRule: ResourceRule | null = null;
	let bestScore = -1;

	for (const rule of resources) {
		const patterns = Array.isArray(rule.path) ? rule.path : [rule.path];
		const matchedPattern = patterns.find((p) => matchesGlob(relPath, p));
		if (!matchedPattern) continue;

		if (rule.exclude && rule.exclude.some((ex) => matchesGlob(relPath, ex))) {
			continue;
		}

		const score = patternSpecificity(matchedPattern);
		if (score > bestScore) {
			bestScore = score;
			bestRule = rule;
		}
	}

	return bestRule;
}

export function evaluateDomainTool(toolName: string, caller: Principal, policy: RbacPolicy): Decision {
	if (!policy.enabled || !(toolName in policy.domainTools)) {
		return { allowed: true };
	}
	const allowedCallers = policy.domainTools[toolName];
	if (allowedCallers.some((p) => matchesPrincipal(caller, p))) {
		return { allowed: true };
	}
	return {
		allowed: false,
		reason: `[RBAC] Domain tool "${toolName}" is not permitted for ${caller.id}.`,
	};
}

export function evaluateAccess(
	relVaultPath: string | null,
	action: CanonicalAction,
	caller: Principal,
	policy: RbacPolicy,
): Decision {
	if (!policy.enabled || caller.kind === "user" || relVaultPath === null) {
		return { allowed: true };
	}

	const resource = matchResource(relVaultPath, policy.resources);
	if (!resource) {
		const fallback = policy.defaults[caller.kind] ?? [];
		return fallback.includes(action.verb)
			? { allowed: true }
			: {
					allowed: false,
					reason: `[RBAC] Access denied: ${caller.id} cannot ${action.verb} unregistered path "${relVaultPath}".`,
				};
	}

	// 1. Producer privilege: implicit R/W/C/D (exec excluded; structuredWriteOnly resources disallow delete & bash mutations)
	if (caller.id === resource.producer) {
		if (action.verb === "exec" || (resource.structuredWriteOnly && (action.verb === "delete" || (action.viaBash && action.verb !== "read")))) {
			return {
				allowed: false,
				reason: resource.denyMessage || `[RBAC] ${caller.id} cannot execute mutating shell actions on "${relVaultPath}".`,
				matchedResourceId: resource.id,
			};
		}
		return {
			allowed: true,
			matchedResourceId: resource.id,
		};
	}

	// 2. Consumer privilege: explicitly granted actions + optional execPattern
	const consumer = resource.consumers.find((c) => matchesPrincipal(caller, c.principal));
	if (consumer && consumer.actions.includes(action.verb)) {
		if (action.verb === "exec" && consumer.execPattern) {
			const cmd = (action.command || "").trim();
			const re = new RegExp(consumer.execPattern);
			return re.test(cmd)
				? { allowed: true, matchedResourceId: resource.id }
				: {
						allowed: false,
						reason: resource.denyMessage || `[RBAC] Command does not match execPattern for "${resource.id}".`,
						matchedResourceId: resource.id,
					};
		}
		return { allowed: true, matchedResourceId: resource.id };
	}

	// 3. Denied
	return {
		allowed: false,
		reason: resource.denyMessage || `[RBAC] Access denied: ${caller.id} cannot ${action.verb} "${relVaultPath}".`,
		matchedResourceId: resource.id,
	};
}

// ── Quote-aware shell parser & canonical verb mapper ────────────────────────

export function splitPipelineSegments(command: string): string[] {
	const segments: string[] = [];
	let cur = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		const next = command[i + 1];

		if (escaped) {
			cur += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			cur += ch;
			escaped = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			if (quote === ch) quote = null;
			else if (quote === null) quote = ch;
			cur += ch;
			continue;
		}
		if (quote === null) {
			if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
				if (cur.trim()) segments.push(cur.trim());
				cur = "";
				i++;
				continue;
			}
			if (ch === ";" || ch === "|" || ch === "\n") {
				if (cur.trim()) segments.push(cur.trim());
				cur = "";
				continue;
			}
		}
		cur += ch;
	}
	if (cur.trim()) segments.push(cur.trim());
	return segments;
}

function tokenizeSegment(segment: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	let hasToken = false;

	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (escaped) {
			cur += ch;
			escaped = false;
			hasToken = true;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			escaped = true;
			hasToken = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			if (quote === ch) quote = null;
			else if (quote === null) quote = ch;
			hasToken = true;
			continue;
		}
		if (quote === null && /\s/.test(ch)) {
			if (hasToken) {
				tokens.push(cur);
				cur = "";
				hasToken = false;
			}
			continue;
		}
		cur += ch;
		hasToken = true;
	}
	if (hasToken) tokens.push(cur);
	return tokens;
}

const MUTATION_RE = /\b(rm|rmdir|unlink|mv|cp|touch|mkdir|tee|truncate|chmod|chown|ln)\b|\b(?:sed|perl)\s+-[A-Za-z]*i/i;
const INLINE_WRITE_CUE_RE = /['"][wa]\+?['"]|\.(?:write|write_text|write_bytes|unlink|rmdir|mkdir|rename|replace)\s*\(|\b(?:writeFile|writeFileSync|unlinkSync|rmSync|shutil\.|os\.(?:remove|unlink|rmdir|rename|makedirs))\b/;

const READ_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more", "ls", "dir", "stat", "file", "wc",
	"diff", "cmp", "sort", "uniq", "jq", "awk", "sed", "grep", "rg", "find", "realpath", "readlink",
]);
const PATTERN_FIRST_READ_CMDS = new Set(["grep", "rg", "awk", "sed"]);
const CMD_VALUE_FLAGS: Record<string, Set<string>> = {
	head: new Set(["-n", "-c", "--lines", "--bytes"]),
	tail: new Set(["-n", "-c", "--lines", "--bytes"]),
	grep: new Set(["-m", "-A", "-B", "-C", "-D", "-d", "--include", "--exclude", "--exclude-dir", "--max-count"]),
	rg: new Set(["-m", "-A", "-B", "-C", "-g", "--glob", "-t", "--type", "-T", "--type-not", "-M", "--max-count"]),
	awk: new Set(["-F", "-v", "--field-separator", "--assign"]),
	sort: new Set(["-t", "-k", "-o", "-T", "-S", "--field-separator", "--key", "--output"]),
	find: new Set(["-maxdepth", "-mindepth", "-name", "-iname", "-path", "-ipath", "-regex", "-type", "-size", "-mtime"]),
};
const INTERPRETER_FLAGS = new Set(["-u", "-B", "-E", "-s", "-O", "-S", "-q", "-v"]);

const SHELL_OPERATORS = new Set([
	"=", "==", "!=", "<", ">", "<=", ">=", "<<", ">>", "<<<",
	"(", ")", "[", "]", "{", "}", "!", "&&", "||", ";", ";;", "&",
	"+=", "-=", "*=", "/=", "%=",
]);

function isLikelyPathToken(tok: string): boolean {
	if (!tok || tok === "-" || tok.startsWith("-") || tok === "&1" || tok === "&2" || tok === "/dev/null") return false;
	if (SHELL_OPERATORS.has(tok)) return false;
	if (/^[0-9]+$/.test(tok)) return false;
	if (/^https?:\/\//i.test(tok)) return false;
	return true;
}

function stripHeredocs(command: string): string {
	const lines = command.split(/\r?\n/);
	const result: string[] = [];
	let inHeredoc = false;
	let delimiter = "";

	const heredocStartRe = /<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/;

	for (const line of lines) {
		if (!inHeredoc) {
			const m = line.match(heredocStartRe);
			if (m) {
				inHeredoc = true;
				delimiter = m[1];
				result.push(line.replace(/<<-?\s*['"]?[A-Za-z0-9_]+['"]?/, " "));
				continue;
			}
			result.push(line);
		} else {
			if (line.trim() === delimiter) {
				inHeredoc = false;
				delimiter = "";
				result.push("");
			} else {
				result.push("");
			}
		}
	}
	return result.join("\n");
}

function scanInlinePaths(code: string): string[] {
	const found = new Set<string>();
	const protectedRe = /(?:^|[\s'"`(])((?:\.\/)?(?:\.pi\/[^\s'"`),;]+|courses\/[^\s'"`),;]+|practice\/[^\s'"`),;]+|learner\.md))/g;
	for (const m of code.matchAll(protectedRe)) {
		if (m[1]) found.add(m[1]);
	}
	return [...found];
}

function classifyWriteOrCreate(vaultRoot: string, cwd: string, rawTarget: string): CanonicalVerb {
	try {
		return fs.existsSync(path.resolve(cwd, rawTarget)) ? "write" : "create";
	} catch {
		return "write";
	}
}

function expandReadGlobTargets(cwd: string, rawTarget: string): string[] {
	const norm = rawTarget.replace(/\\/g, "/");
	const lastSlash = norm.lastIndexOf("/");
	const dirPart = lastSlash >= 0 ? norm.slice(0, lastSlash) || "/" : ".";
	const basePat = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;
	if (!basePat.includes("*") || dirPart.includes("*")) {
		return [rawTarget];
	}
	try {
		const absDir = path.resolve(cwd, dirPart);
		if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [rawTarget];
		const patRe = globToRegex(basePat);
		const entries = fs.readdirSync(absDir).filter((name) => (basePat.startsWith(".") || !name.startsWith(".")) && patRe.test(name));
		return entries.length > 0 ? entries.map((name) => path.join(absDir, name)) : [rawTarget];
	} catch {
		return [rawTarget];
	}
}

export function extractBashChecks(command: string, vaultRoot: string, startCwd: string): BashCheck[] {
	const checks: BashCheck[] = [];
	const stripped = stripHeredocs(command.replace(/\r\n/g, "\n"));
	const segments = splitPipelineSegments(stripped);
	let simCwd = path.resolve(startCwd);

	for (const rawSeg of segments) {
		const seg = rawSeg.replace(/\s*\d*>&\d+\s*/g, " ").trim();
		if (!seg) continue;

		// Strip output/input redirections cleanly before parsing tokens
		let cmdPart = seg;
		const redirMatches = [...seg.matchAll(/(?:^|\s)(?:\d?>>?|(?<!<)<(?![<(]))\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
		for (const rm of redirMatches) {
			const full = rm[0];
			const target = rm[1].replace(/^['"]|['"]$/g, "");
			cmdPart = cmdPart.replace(full, " ");
			if (!isLikelyPathToken(target)) continue;
			const isWriteRedir = full.includes(">");
			const verb: CanonicalVerb = isWriteRedir ? classifyWriteOrCreate(vaultRoot, simCwd, target) : "read";
			checks.push({
				relVaultPath: toRelVaultPath(vaultRoot, simCwd, target),
				rawTarget: target,
				action: { verb, viaBash: true, command: seg },
			});
		}

		const cleanCmd = cmdPart.trim();
		const tokens = tokenizeSegment(cleanCmd);
		if (tokens.length === 0) continue;

		// Skip leading `env` and `KEY=VALUE` assignments to inspect executable
		let idx = 0;
		if (tokens[idx] === "env") idx++;
		while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) idx++;
		if (idx >= tokens.length) continue;

		const binToken = tokens[idx];
		const binName = path.basename(binToken).toLowerCase();

		// Track `cd` across chained segments
		if (binName === "cd" && tokens[idx + 1] && !tokens[idx + 1].startsWith("-")) {
			simCwd = path.resolve(simCwd, tokens[idx + 1]);
			continue;
		}

		// Interpreter execution: python, python3, node, bash, sh, perl, ruby
		if (["python", "python3", "node", "bash", "sh", "ruby", "perl"].includes(binName)) {
			let scriptArg: string | null = null;
			let inlineCode: string | null = null;
			for (let j = idx + 1; j < tokens.length; j++) {
				const t = tokens[j];
				if ((t === "-c" || t === "-e") && (binName.startsWith("python") || binName === "node" || binName === "bash" || binName === "sh" || binName === "perl")) {
					inlineCode = tokens[j + 1] ?? "";
					break;
				}
				if (t === "-m") {
					j++;
					continue;
				}
				if (t.startsWith("-") && INTERPRETER_FLAGS.has(t)) continue;
				if (t.startsWith("-")) continue;
				scriptArg = t;
				break;
			}

			if (inlineCode !== null) {
				const touchedPaths = scanInlinePaths(inlineCode);
				const hasWriteCue = INLINE_WRITE_CUE_RE.test(inlineCode);
				for (const target of touchedPaths) {
					const verb: CanonicalVerb = hasWriteCue ? classifyWriteOrCreate(vaultRoot, simCwd, target) : "read";
					checks.push({
						relVaultPath: toRelVaultPath(vaultRoot, simCwd, target),
						rawTarget: target,
						action: { verb, viaBash: true, command: cleanCmd },
					});
				}
			} else if (scriptArg && isLikelyPathToken(scriptArg)) {
				checks.push({
					relVaultPath: toRelVaultPath(vaultRoot, simCwd, scriptArg),
					rawTarget: scriptArg,
					action: { verb: "exec", viaBash: true, command: cleanCmd },
				});
			}
			continue;
		}

		// Direct executable invocation like `./script.py` or `.pi/catalog/catalog.py`
		if ((binToken.includes("/") || binToken.includes("\\")) && isLikelyPathToken(binToken)) {
			checks.push({
				relVaultPath: toRelVaultPath(vaultRoot, simCwd, binToken),
				rawTarget: binToken,
				action: { verb: "exec", viaBash: true, command: cleanCmd },
			});
			continue;
		}

		// Explicit file delete commands
		if (["rm", "rmdir", "unlink"].includes(binName)) {
			for (let j = idx + 1; j < tokens.length; j++) {
				if (!isLikelyPathToken(tokens[j])) continue;
				checks.push({
					relVaultPath: toRelVaultPath(vaultRoot, simCwd, tokens[j]),
					rawTarget: tokens[j],
					action: { verb: "delete", viaBash: true, command: cleanCmd },
				});
			}
			continue;
		}

		// Explicit file/dir create commands
		if (["mkdir", "touch"].includes(binName)) {
			for (let j = idx + 1; j < tokens.length; j++) {
				if (tokens[j] === "-m" && tokens[j + 1]) {
					j++;
					continue;
				}
				if (!isLikelyPathToken(tokens[j])) continue;
				checks.push({
					relVaultPath: toRelVaultPath(vaultRoot, simCwd, tokens[j]),
					rawTarget: tokens[j],
					action: { verb: "create", viaBash: true, command: cleanCmd },
				});
			}
			continue;
		}

		// Copy / Move commands
		if (binName === "cp" || binName === "mv") {
			const paths: string[] = [];
			for (let j = idx + 1; j < tokens.length; j++) {
				if (tokens[j] === "-t" && tokens[j + 1]) {
					paths.push(tokens[++j]);
					continue;
				}
				if (isLikelyPathToken(tokens[j])) paths.push(tokens[j]);
			}
			if (paths.length >= 2) {
				const dest = paths[paths.length - 1];
				const sources = paths.slice(0, -1);
				for (const src of sources) {
					checks.push({
						relVaultPath: toRelVaultPath(vaultRoot, simCwd, src),
						rawTarget: src,
						action: { verb: binName === "mv" ? "delete" : "read", viaBash: true, command: cleanCmd },
					});
				}
				checks.push({
					relVaultPath: toRelVaultPath(vaultRoot, simCwd, dest),
					rawTarget: dest,
					action: { verb: classifyWriteOrCreate(vaultRoot, simCwd, dest), viaBash: true, command: cleanCmd },
				});
			}
			continue;
		}

		// In-place mutators (tee, truncate, sed -i, perl -i)
		if (binName === "tee" || binName === "truncate" || (MUTATION_RE.test(cleanCmd) && (binName === "sed" || binName === "perl"))) {
			const needsPattern = binName === "sed" || binName === "perl";
			let skippedPattern = !needsPattern;
			let explicitExprFlag = false;
			for (let j = idx + 1; j < tokens.length; j++) {
				const t = tokens[j];
				if (t === "-e" || t === "-f") {
					explicitExprFlag = true;
					j++;
					continue;
				}
				if (t === "-s") {
					j++;
					continue;
				}
				if (!isLikelyPathToken(t)) continue;
				if (!skippedPattern && !explicitExprFlag) {
					skippedPattern = true;
					continue;
				}
				checks.push({
					relVaultPath: toRelVaultPath(vaultRoot, simCwd, t),
					rawTarget: t,
					action: { verb: classifyWriteOrCreate(vaultRoot, simCwd, t), viaBash: true, command: cleanCmd },
				});
			}
			continue;
		}

		// Standard read / search commands
		if (READ_COMMANDS.has(binName)) {
			const valueFlags = CMD_VALUE_FLAGS[binName];
			let skippedPattern = !PATTERN_FIRST_READ_CMDS.has(binName);
			let explicitPatternFlag = false;
			for (let j = idx + 1; j < tokens.length; j++) {
				const t = tokens[j];
				if (t === "-e" || t === "-f") {
					explicitPatternFlag = true;
					const nextTok = tokens[j + 1];
					if (t === "-f" && nextTok && isLikelyPathToken(nextTok)) {
						checks.push({
							relVaultPath: toRelVaultPath(vaultRoot, simCwd, nextTok),
							rawTarget: nextTok,
							action: { verb: "read", viaBash: true, command: cleanCmd },
						});
					}
					j++;
					continue;
				}
				if (valueFlags?.has(t)) {
					j++;
					continue;
				}
				if (t.startsWith("-")) continue;
				if (!skippedPattern && !explicitPatternFlag) {
					skippedPattern = true;
					continue;
				}
				if (!isLikelyPathToken(t)) continue;
				for (const resolvedTarget of expandReadGlobTargets(simCwd, t)) {
					checks.push({
						relVaultPath: toRelVaultPath(vaultRoot, simCwd, resolvedTarget),
						rawTarget: resolvedTarget,
						action: { verb: "read", viaBash: true, command: cleanCmd },
					});
				}
			}
			continue;
		}

		// Unknown command referencing explicit vault paths
		for (const protectedPath of scanInlinePaths(cleanCmd)) {
			checks.push({
				relVaultPath: toRelVaultPath(vaultRoot, simCwd, protectedPath),
				rawTarget: protectedPath,
				action: { verb: "write", viaBash: true, command: cleanCmd },
			});
		}
	}

	return checks;
}

export function evaluateBashCommand(
	command: string,
	vaultRoot: string,
	cwd: string,
	caller: Principal,
	policy: RbacPolicy,
): Decision {
	if (!policy.enabled || caller.kind === "user") {
		return { allowed: true };
	}

	const checks = extractBashChecks(command, vaultRoot, cwd);
	for (const chk of checks) {
		const decision = evaluateAccess(chk.relVaultPath, chk.action, caller, policy);
		if (!decision.allowed) return decision;
	}
	return { allowed: true };
}

export function formatMatrix(policy: RbacPolicy): string {
	const lines: string[] = [
		`RBAC Policy v${policy.version} · Enabled: ${policy.enabled} · Mode: ${policy.mode ?? "enforce"}`,
		"",
		"| Resource ID | Producer | Consumers | Constraints |",
		"| :--- | :--- | :--- | :--- |",
	];
	for (const r of policy.resources) {
		const cons = r.consumers.map((c) => `${c.principal}(${c.actions.join(",")})`).join(", ") || "(none — API only)";
		const constraints = r.structuredWriteOnly ? "structured-only" : "-";
		lines.push(`| ${r.id} | ${r.producer} | ${cons} | ${constraints} |`);
	}
	lines.push("", "Domain Tools:");
	for (const [tool, callers] of Object.entries(policy.domainTools)) {
		lines.push(`- ${tool}: ${callers.join(", ")}`);
	}
	return lines.join("\n");
}

// ── Extension Registration ──────────────────────────────────────────────────

export default function rbacExtension(pi: ExtensionAPI) {
	let subagentRole: string | null = null;
	let sessionPrincipal: SessionPrincipalId = "user";
	let runtimeEnabledOverride: boolean | null = null;
	let runtimeModeOverride: "shadow" | "enforce" | null = null;
	let shadowHits = 0;

	function currentPrincipal(): Principal {
		const envRole = process.env.PI_SUBAGENT_NAME || process.env.PI_SUBAGENT_AGENT;
		const role = subagentRole || envRole || null;
		if (role) return { kind: "subagent", id: `subagent:${role}` };
		return parsePrincipal(sessionPrincipal);
	}

	function setSessionPrincipal(next: SessionPrincipalId): void {
		if (isSubagentProcess() || subagentRole) return;
		if (sessionPrincipal === next) return;
		sessionPrincipal = next;
		try {
			pi.appendEntry(PRINCIPAL_ENTRY, { principal: next });
		} catch {
			// in-memory transition still holds
		}
	}

	function readEffectivePolicy(vaultRoot: string): RbacPolicy {
		const pol = loadPolicy(vaultRoot);
		if (runtimeEnabledOverride !== null) pol.enabled = runtimeEnabledOverride;
		if (runtimeModeOverride !== null) pol.mode = runtimeModeOverride;
		return pol;
	}

	function checkPermission(
		toolName: string,
		input: Record<string, unknown>,
		cwd: string = process.cwd(),
	): { allowed: boolean; reason?: string } {
		const vaultRoot = findVaultRoot(cwd);
		let policy: RbacPolicy;
		try {
			policy = readEffectivePolicy(vaultRoot);
		} catch {
			return { allowed: true };
		}

		if (!policy.enabled) return { allowed: true };
		const caller = currentPrincipal();
		if (caller.kind === "user") return { allowed: true };

		let decision: Decision = { allowed: true };

		if (toolName in policy.domainTools) {
			decision = evaluateDomainTool(toolName, caller, policy);
		} else if (toolName === "bash" && typeof input?.command === "string") {
			decision = evaluateBashCommand(input.command, vaultRoot, cwd, caller, policy);
		} else if (["read", "grep", "find", "ls"].includes(toolName) && typeof input?.path === "string") {
			decision = evaluateAccess(toRelVaultPath(vaultRoot, cwd, input.path), { verb: "read" }, caller, policy);
		} else if (["write", "edit"].includes(toolName) && typeof input?.path === "string") {
			const rel = toRelVaultPath(vaultRoot, cwd, input.path);
			const verb: CanonicalVerb = toolName === "write" ? classifyWriteOrCreate(vaultRoot, cwd, input.path) : "write";
			decision = evaluateAccess(rel, { verb, viaBash: false }, caller, policy);
		}

		if (!decision.allowed) {
			if ((policy.mode ?? "enforce") === "shadow") {
				shadowHits++;
				return { allowed: true };
			}
			return { allowed: false, reason: decision.reason ?? "Access denied by RBAC policy" };
		}

		return { allowed: true };
	}

	// Owning workflow extensions (learn.ts, ladder.ts, md-log.ts, teacher.ts) push transitions here.
	(globalThis as any).__piRbac = {
		setPrincipal: (next: SessionPrincipalId) => setSessionPrincipal(next),
		getPrincipal: () => currentPrincipal(),
		setEnabled: (enabled: boolean) => {
			runtimeEnabledOverride = enabled;
		},
		checkPermission: (toolName: string, input: Record<string, unknown>, cwd?: string) =>
			checkPermission(toolName, input, cwd),
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionPrincipal = "user";
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry?.type === "custom" && entry.customType === PRINCIPAL_ENTRY) {
				const p = entry.data?.principal;
				if (p === "user" || p === "teacher" || p === "teacher:teach" || p === "teacher:themecp") sessionPrincipal = p;
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (subagentRole) return;
		const prompt = typeof event?.systemPrompt === "string" ? event.systemPrompt : "";
		const m = /<!--\s*agent:([\w-]+)\s*-->/.exec(prompt);
		if (m) {
			subagentRole = m[1];
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const res = checkPermission(event.toolName, event.input as Record<string, unknown>, ctx.cwd);
		if (!res.allowed) {
			return { block: true, reason: res.reason };
		}
	});

	pi.registerCommand("rbac", {
		description: "Inspect or control RBAC policy (/rbac status|on|off|shadow|enforce|principal|matrix|test)",
		handler: async (args, ctx) => {
			if (isSubagentProcess() || subagentRole) {
				ctx.ui.notify("Subagents cannot run /rbac commands.", "warning");
				return;
			}
			const vaultRoot = findVaultRoot(ctx.cwd);
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0] || "status";
			const policy = readEffectivePolicy(vaultRoot);

			if (sub === "on" || sub === "enforce") {
				runtimeEnabledOverride = true;
				runtimeModeOverride = "enforce";
				ctx.ui.notify("[RBAC] Enforcement ENABLED.", "info");
				return;
			}
			if (sub === "off") {
				runtimeEnabledOverride = false;
				ctx.ui.notify("[RBAC] Enforcement DISABLED.", "warning");
				return;
			}
			if (sub === "shadow") {
				runtimeEnabledOverride = true;
				runtimeModeOverride = "shadow";
				ctx.ui.notify("[RBAC] Running in SHADOW mode (monitoring without blocking).", "info");
				return;
			}
			if (sub === "principal") {
				const target = parts[1];
				if (target === "user" || target === "teacher" || target === "teacher:teach" || target === "teacher:themecp") {
					setSessionPrincipal(target);
					ctx.ui.notify(`[RBAC] Active root principal switched to "${target}".`, "info");
				} else {
					ctx.ui.notify(`[RBAC] Active principal: ${currentPrincipal().id}`, "info");
				}
				return;
			}
			if (sub === "matrix") {
				ctx.ui.notify(formatMatrix(policy), "info");
				return;
			}
			if (sub === "test") {
				if (parts.length < 4) {
					ctx.ui.notify("Usage: /rbac test <principal> <read|write|create|delete|exec> <path-or-cmd>", "warning");
					return;
				}
				try {
					const caller = parsePrincipal(parts[1]);
					const verb = parts[2] as CanonicalVerb;
					const target = parts.slice(3).join(" ");
					const testPolicy: RbacPolicy = { ...policy, enabled: true };
					const res =
						verb === "exec"
							? evaluateBashCommand(target, vaultRoot, vaultRoot, caller, testPolicy)
							: evaluateAccess(toRelVaultPath(vaultRoot, vaultRoot, target), { verb }, caller, testPolicy);
					const label = res.allowed ? "ALLOWED" : `BLOCKED — ${res.reason}`;
					ctx.ui.notify(`[RBAC test] ${caller.id} ${verb} "${target}" => ${label}`, res.allowed ? "info" : "warning");
				} catch (err) {
					ctx.ui.notify(`[RBAC test] ${err instanceof Error ? err.message : String(err)}`, "error");
				}
				return;
			}

			// Default: status
			const effMode = !policy.enabled ? "DISABLED" : `${(policy.mode ?? "enforce").toUpperCase()}`;
			ctx.ui.notify(
				`[RBAC] Mode: ${effMode} · Principal: ${currentPrincipal().id} · Resources: ${policy.resources.length} · Shadow hits: ${shadowHits}`,
				"info",
			);
		},
	});
}
