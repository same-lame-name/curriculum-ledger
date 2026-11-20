import type { AgentTool } from "@earendil-works/pi-agent-core";
import { exec, execFile } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { resolveConfinedPath } from "../path-safety.ts";
import { errorMessage } from "../types.ts";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 20_000;

export function makeScratchDir(workerId: string, taskId: string): string {
	const safeTask = taskId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48) || "task";
	const safeWorker = workerId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 24) || "worker";
	const dir = path.join(os.tmpdir(), `lh-${safeWorker}-${safeTask}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function truncateText(text: string, maxBytes = MAX_OUTPUT_BYTES): string {
	const buf = Buffer.from(text, "utf-8");
	if (buf.length <= maxBytes) return text;
	return buf.subarray(0, maxBytes).toString("utf-8") + `\n[... truncated at ${maxBytes} bytes ...]`;
}

function execShellBounded(
	command: string,
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = exec(
			command,
			{
				cwd,
				timeout: timeoutMs,
				maxBuffer: 2 * 1024 * 1024,
				env: {
					...process.env,
					PYTHONDONTWRITEBYTECODE: "1",
					PYTHONIOENCODING: "utf-8",
				},
			},
			(error, stdout, stderr) => {
				const exitCode =
					error && typeof (error as { code?: unknown }).code === "number"
						? Number((error as { code?: number }).code)
						: error
							? 1
							: 0;
				resolve({
					exitCode,
					stdout: truncateText(stdout ?? ""),
					stderr: truncateText(stderr ?? ""),
				});
			},
		);
		if (signal) {
			if (signal.aborted) {
				child.kill("SIGTERM");
			} else {
				const onAbort = () => {
					try {
						child.kill("SIGTERM");
					} catch {
						// ignore
					}
				};
				signal.addEventListener("abort", onAbort, { once: true });
				child.once("exit", () => signal.removeEventListener("abort", onAbort));
			}
		}
	});
}

export function runBrowserFetch(
	dataDir: string,
	url: string,
	format: "markdown" | "text" | "html" = "markdown",
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
	const scriptPath = path.join(dataDir, "browser", "browser_fetch.py");
	const pyBin = process.platform === "win32" ? "python" : "python3";
	return new Promise((resolve, reject) => {
		const child = execFile(
			pyBin,
			[scriptPath, url, "--format", format, "--timeout", "15"],
			{
				cwd: dataDir,
				encoding: "utf-8",
				timeout: 20_000,
				maxBuffer: 4 * 1024 * 1024,
				env: {
					...process.env,
					PYTHONDONTWRITEBYTECODE: "1",
					PYTHONIOENCODING: "utf-8",
				},
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error((stderr || "").trim() || error.message));
					return;
				}
				resolve({ stdout: truncateText(stdout ?? ""), stderr: stderr ?? "" });
			},
		);
		if (signal) {
			if (signal.aborted) child.kill("SIGTERM");
			else {
				const onAbort = () => child.kill("SIGTERM");
				signal.addEventListener("abort", onAbort, { once: true });
				child.once("exit", () => signal.removeEventListener("abort", onAbort));
			}
		}
	});
}

export const WriteScratchSchema = Type.Object({
	path: Type.String({ description: "Relative file path inside this task's scratch folder." }),
	content: Type.String({ description: "Full UTF-8 text content to write." }),
});

export const ReadScratchSchema = Type.Object({
	path: Type.String({ description: "Relative file path inside this task's scratch folder." }),
	max_bytes: Type.Optional(Type.Number({ description: "Optional max bytes to read (default 65536)." })),
});

export const ListScratchSchema = Type.Object({});

export const ExecScratchSchema = Type.Object({
	command: Type.String({ description: "Shell command executed with cwd set to this task's scratch folder." }),
	timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 10000, max 20000)." })),
});

export const WebFetchSchema = Type.Object({
	url: Type.String({ description: "Public HTTP/HTTPS problem or editorial URL to fetch." }),
	format: Type.Optional(
		Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
			description: "Output format (default markdown).",
		}),
	),
});

export function createScratchTools(
	scratchDir: string,
	dataDir: string,
	options: { includeWebFetch?: boolean } = {},
): AgentTool<any>[] {
	const writeTool: AgentTool<typeof WriteScratchSchema> = {
		name: "write_scratch_file",
		label: "Write Scratch File",
		description: "Write a file (C++ source, generator, checker, test input) inside your isolated /tmp scratch directory.",
		parameters: WriteScratchSchema,
		async execute(_id, params) {
			const target = resolveConfinedPath(scratchDir, params.path, [], "scratch path");
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, params.content, "utf-8");
			return {
				content: [
					{
						type: "text",
						text: `Wrote ${Buffer.byteLength(params.content, "utf-8")} bytes to ${path.relative(scratchDir, target)}`,
					},
				],
				details: { path: path.relative(scratchDir, target) },
			};
		},
	};

	const readTool: AgentTool<typeof ReadScratchSchema> = {
		name: "read_scratch_file",
		label: "Read Scratch File",
		description: "Read a file from your isolated /tmp scratch directory.",
		parameters: ReadScratchSchema,
		async execute(_id, params) {
			const target = resolveConfinedPath(scratchDir, params.path, [], "scratch path");
			if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
				throw new Error(`Scratch file not found: ${params.path}`);
			}
			const max =
				typeof params.max_bytes === "number" && params.max_bytes > 0
					? Math.min(256 * 1024, Math.floor(params.max_bytes))
					: MAX_OUTPUT_BYTES;
			const content = fs.readFileSync(target, "utf-8");
			return {
				content: [{ type: "text", text: truncateText(content, max) }],
				details: { path: path.relative(scratchDir, target) },
			};
		},
	};

	const listTool: AgentTool<typeof ListScratchSchema> = {
		name: "list_scratch_files",
		label: "List Scratch Files",
		description: "List files currently in your isolated /tmp scratch directory.",
		parameters: ListScratchSchema,
		async execute() {
			const files: string[] = [];
			const walk = (dir: string) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					if (entry.isSymbolicLink()) continue;
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) walk(full);
					else if (entry.isFile()) files.push(path.relative(scratchDir, full));
				}
			};
			if (fs.existsSync(scratchDir)) walk(scratchDir);
			return {
				content: [{ type: "text", text: files.length ? files.sort().join("\n") : "(empty)" }],
				details: { files },
			};
		},
	};

	const execTool: AgentTool<typeof ExecScratchSchema> = {
		name: "exec_scratch",
		label: "Run Command in Scratch",
		description: "Compile C++ (`g++ -std=c++17 -O2 ...`) or run Python/generators/binaries inside your isolated /tmp scratch directory.",
		parameters: ExecScratchSchema,
		async execute(_id, params, signal) {
			const timeout =
				typeof params.timeout_ms === "number" && params.timeout_ms > 0
					? Math.min(MAX_TIMEOUT_MS, Math.floor(params.timeout_ms))
					: DEFAULT_TIMEOUT_MS;
			const res = await execShellBounded(params.command, scratchDir, timeout, signal);
			const text = [
				`exitCode: ${res.exitCode}`,
				res.stdout ? `stdout:\n${res.stdout}` : "",
				res.stderr ? `stderr:\n${res.stderr}` : "",
			]
				.filter(Boolean)
				.join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: res,
			};
		},
	};

	const tools: AgentTool<any>[] = [writeTool, readTool, listTool, execTool];

	if (options.includeWebFetch) {
		const webFetchTool: AgentTool<typeof WebFetchSchema> = {
			name: "web_fetch",
			label: "Fetch Web Page",
			description: "Fetch a public HTTP/HTTPS problem statement or judge page using SSRF-protected browser TLS impersonation.",
			parameters: WebFetchSchema,
			async execute(_id, params, signal) {
				try {
					const res = await runBrowserFetch(dataDir, params.url, params.format ?? "markdown", signal);
					return {
						content: [{ type: "text", text: res.stdout || "(empty response)" }],
						details: { url: params.url },
					};
				} catch (error) {
					return {
						content: [{ type: "text", text: `web_fetch error: ${errorMessage(error)}` }],
						details: { url: params.url, error: errorMessage(error) },
					};
				}
			},
		};
		tools.push(webFetchTool);
	}

	return tools;
}
