import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type ArenaPluginSettings,
	type EnvironmentCheck,
	type EnvironmentItem,
	POINTER_FILENAME,
} from "./types.ts";

export function defaultPointerPath(): string {
	return path.join(os.homedir(), POINTER_FILENAME);
}

export interface PointerSyncResult {
	ok: boolean;
	pointerPath: string;
	detail: string;
}

export function syncArenaPointer(
	arenaDir: string,
	enabled: boolean,
	pointerPath = defaultPointerPath(),
): PointerSyncResult {
	if (!enabled) {
		return {
			ok: true,
			pointerPath,
			detail: "Disabled in settings; external editors must set PI_ARENA_DIR manually.",
		};
	}

	const desired = `${arenaDir}\n`;
	try {
		if (fs.existsSync(pointerPath)) {
			const existing = fs.readFileSync(pointerPath, "utf-8");
			if (existing === desired) {
				return { ok: true, pointerPath, detail: `Points to ${arenaDir}` };
			}
		}
		fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
		const tmp = `${pointerPath}.tmp-${process.pid}-${Date.now()}`;
		try {
			fs.writeFileSync(tmp, desired, "utf-8");
			fs.renameSync(tmp, pointerPath);
		} catch (innerError) {
			try {
				fs.rmSync(tmp, { force: true });
			} catch {
				// ignore
			}
			throw innerError;
		}
		return { ok: true, pointerPath, detail: `Updated to ${arenaDir}` };
	} catch (error) {
		return {
			ok: false,
			pointerPath,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

function probeCommand(bin: string, args: string[], timeoutMs = 4000): Promise<{ ok: boolean; text: string }> {
	return new Promise((resolve) => {
		execFile(bin, args, { encoding: "utf-8", timeout: timeoutMs }, (error, stdout, stderr) => {
			if (error) {
				resolve({
					ok: false,
					text: (stderr || "").trim() || error.message,
				});
				return;
			}
			const firstLine = ((stdout || stderr || "").trim().split(/\r?\n/)[0] ?? "").trim();
			resolve({ ok: true, text: firstLine || "available" });
		});
	});
}

export async function checkEnvironment(
	dataDir: string,
	settings: ArenaPluginSettings,
	pointerPath = defaultPointerPath(),
): Promise<EnvironmentCheck> {
	const arenaDir = path.join(dataDir, "arena");
	const [py, curlCffi, gpp, nvim] = await Promise.all([
		probeCommand(process.platform === "win32" ? "python" : "python3", ["--version"]),
		probeCommand(process.platform === "win32" ? "python" : "python3", [
			"-c",
			"import curl_cffi; print(curl_cffi.__version__)",
		]),
		probeCommand("g++", ["--version"]),
		probeCommand("nvim", ["--version"]),
	]);

	let pointerOk = false;
	let pointerDetail = "";
	if (!settings.pointerEnabled) {
		pointerOk = true;
		pointerDetail = "Pointer management disabled in Settings (using PI_ARENA_DIR)";
	} else {
		try {
			if (!fs.existsSync(pointerPath)) {
				pointerDetail = `Missing ${pointerPath} (expected ${arenaDir})`;
			} else {
				const content = fs.readFileSync(pointerPath, "utf-8").trim();
				pointerOk = content === arenaDir;
				pointerDetail = pointerOk
					? `${pointerPath} → ${content}`
					: `Points to ${content || "(empty)"} instead of ${arenaDir}`;
			}
		} catch (error) {
			pointerDetail = error instanceof Error ? error.message : String(error);
		}
	}

	let practiceOk = false;
	let practiceDetail = "";
	try {
		if (!fs.existsSync(settings.practiceDir)) {
			fs.mkdirSync(settings.practiceDir, { recursive: true });
		}
		fs.accessSync(settings.practiceDir, fs.constants.R_OK | fs.constants.W_OK);
		practiceOk = true;
		practiceDetail = settings.practiceDir;
	} catch (error) {
		practiceDetail = `${settings.practiceDir}: ${error instanceof Error ? error.message : String(error)}`;
	}

	const items: EnvironmentItem[] = [
		{
			id: "python3",
			label: "Python 3",
			ok: py.ok,
			required: true,
			detail: py.ok ? py.text : `python3 unavailable (${py.text})`,
		},
		{
			id: "curl_cffi",
			label: "curl_cffi (Browser Fetch)",
			ok: curlCffi.ok,
			required: false,
			detail: curlCffi.ok ? `curl_cffi ${curlCffi.text}` : "Optional for CF/AtCoder statement fetching (pip install curl_cffi)",
		},
		{
			id: "gpp",
			label: "g++ compiler",
			ok: gpp.ok,
			required: false,
			detail: gpp.ok ? gpp.text : "Needed to compile local C++ solutions and Lab stress tests",
		},
		{
			id: "nvim",
			label: "Neovim",
			ok: nvim.ok,
			required: false,
			detail: nvim.ok ? nvim.text : "Optional unless using the external Neovim Arena editor",
		},
		{
			id: "pointer",
			label: "Arena Pointer (~/.pi-arena-root)",
			ok: pointerOk,
			required: false,
			detail: pointerDetail,
		},
		{
			id: "practiceDir",
			label: "Practice Workspace",
			ok: practiceOk,
			required: true,
			detail: practiceDetail,
		},
	];

	return {
		ready: items.filter((item) => item.required).every((item) => item.ok),
		checkedAt: new Date().toISOString(),
		arenaDir,
		pointerPath,
		items,
	};
}

function shellQuotePosix(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function formatLaunchCommand(
	template: string,
	context: { arenaDir: string; manifestPath: string; practiceDir: string; firstFile: string },
): string {
	return template
		.replaceAll("{arenaDir}", shellQuotePosix(context.arenaDir))
		.replaceAll("{manifest}", shellQuotePosix(context.manifestPath))
		.replaceAll("{practiceDir}", shellQuotePosix(context.practiceDir))
		.replaceAll("{file}", shellQuotePosix(context.firstFile));
}

export function launchExternalEditor(
	settings: ArenaPluginSettings,
	context: { arenaDir: string; manifestPath: string; firstFile?: string },
): { launched: boolean; command?: string; message: string } {
	const template = settings.launchCommand.trim();
	if (!template) {
		return {
			launched: false,
			message: "No launchCommand configured in Settings → Competitive Arena. Open Neovim in your workspace and press <leader>ma.",
		};
	}
	const firstFile = context.firstFile || path.join(settings.practiceDir, "solution.cpp");
	const expanded = formatLaunchCommand(template, {
		arenaDir: context.arenaDir,
		manifestPath: context.manifestPath,
		practiceDir: settings.practiceDir,
		firstFile,
	});
	const shell = process.platform === "win32" ? "cmd.exe" : "sh";
	const shellArgs = process.platform === "win32" ? ["/c", expanded] : ["-lc", expanded];
	const child = spawn(shell, shellArgs, {
		cwd: settings.practiceDir,
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			PI_ARENA_DIR: context.arenaDir,
			PI_PRACTICE_DIR: settings.practiceDir,
		},
	});
	child.unref();
	return {
		launched: true,
		command: expanded,
		message: `Launched external editor command: ${expanded}`,
	};
}
