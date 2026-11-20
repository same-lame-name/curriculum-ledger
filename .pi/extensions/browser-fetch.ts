import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// browser_fetch — generic browser-impersonating web fetcher.
//
// Bypasses anti-bot TLS fingerprinting (JA3/JA4), Cloudflare Turnstile, and
// User-Agent blocks across the public web.
//
// Returns clean, high-density Markdown (default), plain text, or raw HTML.
// ────────────────────────────────────────────────────────────────────────────

function findVaultRoot(startDir: string): string {
	let cur = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(cur, ".pi")) || fs.existsSync(path.join(cur, "courses"))) return cur;
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return path.resolve(startDir);
}

function runBrowserFetchPy(vaultRoot: string, args: string[]): string {
	const scriptPath = path.join(vaultRoot, ".pi", "browser", "browser_fetch.py");
	if (!fs.existsSync(scriptPath)) throw new Error(`browser_fetch engine missing at ${scriptPath}`);
	let lastErr: unknown = null;
	for (const pyBin of ["python3", "python"]) {
		try {
			const stdout = execFileSync(pyBin, [scriptPath, ...args], {
				cwd: vaultRoot,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				maxBuffer: 10 * 1024 * 1024,
			});
			return stdout;
		} catch (err: any) {
			lastErr = err;
			if (err?.code === "ENOENT") continue;
			const stderr = err?.stderr ? String(err.stderr).trim() : "";
			if (stderr) {
				throw new Error(stderr);
			}
			throw err;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error("Failed to invoke python3 or python for browser_fetch.py");
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const BrowserFetchParams = Type.Object({
	url: Type.String({
		description: "HTTP or HTTPS URL to fetch.",
	}),
	format: Type.Optional(
		Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
			description: "Output format: 'markdown' (default), 'text', or 'html'.",
		}),
	),
	maxChars: Type.Optional(
		Type.Number({
			description: "Maximum characters to return (default: 30000).",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Fetch timeout in seconds (default: 15).",
		}),
	),
});

export default function browserFetchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "browser_fetch",
		label: "browser_fetch",
		description:
			"Fetches live web content using browser TLS impersonation to bypass 403 Forbidden, anti-bot checks, captcha, and Cloudflare Turnstile across the public web. Returns clean, readable Markdown (`format: \"markdown\"`, default), plain text (`\"text\"`), or raw HTML (`\"html\"`), truncated at `maxChars` (default 30,000).",
		parameters: BrowserFetchParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const url = params.url.trim();
			if (!/^https?:\/\//i.test(url)) {
				return {
					content: [{ type: "text", text: `browser_fetch error: Invalid URL "${url}". Must start with http:// or https://.` }],
					details: { url, error: "Invalid URL scheme" },
				};
			}

			const args: string[] = [url];
			if (params.format) {
				args.push("--format", params.format);
			}
			if (params.maxChars && params.maxChars > 0) {
				args.push("--max-chars", String(params.maxChars));
			}
			if (params.timeout && params.timeout > 0) {
				args.push("--timeout", String(params.timeout));
			}

			try {
				const vaultRoot = findVaultRoot(ctx.cwd);
				const content = runBrowserFetchPy(vaultRoot, args);
				return {
					content: [{ type: "text", text: content }],
					details: { url, format: params.format || "markdown", chars: content.length },
				};
			} catch (err) {
				const msg = errorMessage(err);
				return {
					content: [{ type: "text", text: `browser_fetch error: ${msg}` }],
					details: { url, error: msg },
				};
			}
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("browser_fetch ")) + theme.fg("muted", String(args.url || "")),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const d = result.details as any;
			if (d?.error) return new Text(theme.fg("warning", `browser_fetch error: ${d.error}`), 0, 0);
			const chars = d?.chars ?? 0;
			return new Text(theme.fg("success", `✓ fetched ${chars} chars`), 0, 0);
		},
	});
}
