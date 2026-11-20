import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type BinaryLookup = {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	homeDir: string;
	cwd?: string;
	isExecutable: (path: string) => boolean;
};

type SearchSpec = {
	paths: path.PlatformPath;
	names: string[];
	knownDirs: string[];
};

function getWindowsSearchSpec(env: BinaryLookup["env"], homeDir: string): SearchSpec {
	const paths = path.win32;
	const appData = env.APPDATA ?? paths.join(homeDir, "AppData", "Roaming");

	return {
		paths,
		names: ["agy.exe"],
		knownDirs: [
			paths.join(homeDir, ".local", "bin"),
			env.npm_config_prefix ?? paths.join(appData, "npm"),
		],
	};
}

function getPosixSearchSpec(env: BinaryLookup["env"], homeDir: string): SearchSpec {
	const paths = path.posix;
	const npmBin = env.npm_config_prefix
		? paths.join(env.npm_config_prefix, "bin")
		: paths.join(homeDir, ".npm-global", "bin");

	return {
		paths,
		names: ["agy"],
		knownDirs: [
			paths.join(homeDir, ".local", "bin"),
			npmBin,
			"/opt/homebrew/bin",
			"/usr/local/bin",
			...(env.USER ? [paths.join("/etc/profiles/per-user", env.USER, "bin")] : []),
			paths.join(homeDir, ".nix-profile", "bin"),
			"/run/current-system/sw/bin",
		],
	};
}

export function resolveAgyBinary({ env, platform, homeDir, cwd = process.cwd(), isExecutable }: BinaryLookup): string | null {
	const explicit = env.AGY_BIN?.trim();
	if (explicit) {
		const paths = platform === "win32" ? path.win32 : path.posix;
		const resolved = paths.resolve(cwd, explicit);
		if (isExecutable(resolved)) return resolved;
	}

	const { paths, names, knownDirs } = platform === "win32"
		? getWindowsSearchSpec(env, homeDir)
		: getPosixSearchSpec(env, homeDir);

	const pathDirs = (env.PATH ?? "").split(paths.delimiter).filter(Boolean);

	for (const name of names) {
		for (const dir of [...pathDirs, ...knownDirs]) {
			const candidate = paths.resolve(cwd, dir, name);
			if (isExecutable(candidate)) return candidate;
		}
	}

	return null;
}

function isExecutableFile(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export function getAgyBinary(): string | null {
	return resolveAgyBinary({
		env: process.env,
		platform: process.platform,
		homeDir: os.homedir(),
		isExecutable: isExecutableFile,
	});
}
