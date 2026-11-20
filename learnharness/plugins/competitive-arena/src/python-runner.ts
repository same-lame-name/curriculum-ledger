import { execFile } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";

export interface PythonRunOptions {
	dataDir: string;
	practiceDir?: string;
	cwd?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];

function extractJsonError(stdout: string, stderr: string): string | null {
	for (const raw of [stderr, stdout]) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object" && typeof parsed.error === "string" && parsed.error.trim()) {
				const cands =
					Array.isArray(parsed.candidates) && parsed.candidates.length > 0
						? ` (candidates: ${parsed.candidates.join(", ")})`
						: "";
				return `${parsed.error}${cands}`;
			}
		} catch {
			// fall back to raw message
		}
	}
	return null;
}

function execFileOnce(
	bin: string,
	scriptPath: string,
	args: string[],
	options: PythonRunOptions,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const arenaCli = path.join(options.dataDir, "arena", "arena.py");
		const arenaDir = path.join(options.dataDir, "arena");
		const browserFetchPy = path.join(options.dataDir, "browser", "browser_fetch.py");
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONIOENCODING: "utf-8",
			PI_ARENA_CLI: arenaCli,
			PI_ARENA_DIR: arenaDir,
			LH_BROWSER_FETCH_PY: browserFetchPy,
			...(options.practiceDir ? { PI_PRACTICE_DIR: options.practiceDir } : {}),
		};

		const child = execFile(
			bin,
			[scriptPath, ...args],
			{
				cwd: options.cwd ?? options.dataDir,
				encoding: "utf-8",
				timeout: options.timeoutMs ?? 30_000,
				maxBuffer: 8 * 1024 * 1024,
				env,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
					return;
				}
				const errWithCode = error as NodeJS.ErrnoException;
				if (errWithCode.code === "ENOENT") {
					reject(error);
					return;
				}
				const jsonMsg = extractJsonError(stdout ?? "", stderr ?? "");
				if (jsonMsg) {
					reject(new Error(jsonMsg));
					return;
				}
				const rawErr = (stderr ?? "").trim() || (stdout ?? "").trim() || error.message;
				reject(new Error(rawErr));
			},
		);

		if (options.signal) {
			if (options.signal.aborted) {
				child.kill("SIGTERM");
			} else {
				const onAbort = () => {
					try {
						child.kill("SIGTERM");
					} catch {
						// ignore
					}
				};
				options.signal.addEventListener("abort", onAbort, { once: true });
				child.once("exit", () => options.signal?.removeEventListener("abort", onAbort));
			}
		}
	});
}

export async function runPythonJson<T = unknown>(
	scriptPath: string,
	args: string[],
	options: PythonRunOptions,
): Promise<T> {
	if (!fs.existsSync(scriptPath)) {
		throw new Error(`Python engine script missing at ${scriptPath}`);
	}

	let lastError: unknown = null;
	for (const bin of PYTHON_CANDIDATES) {
		try {
			const { stdout } = await execFileOnce(bin, scriptPath, args, options);
			const trimmed = stdout.trim();
			if (!trimmed) {
				throw new Error(`Empty JSON output from ${path.basename(scriptPath)}`);
			}
			return JSON.parse(trimmed) as T;
		} catch (error) {
			lastError = error;
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
			throw error;
		}
	}

	throw lastError instanceof Error ? lastError : new Error("Neither python3 nor python was found on PATH");
}
