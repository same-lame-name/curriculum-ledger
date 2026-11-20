import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");

try {
	if (fs.lstatSync(output).isSymbolicLink()) throw new Error("Refusing to build into a linked directory.");
	try {
		fs.lstatSync(path.join(output, "data"));
		throw new Error("Refusing to build over plugin data. Move it to a safe location first.");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

function copySeedTree(srcDir, dstDir) {
	fs.mkdirSync(dstDir, { recursive: true });
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in seed tree: ${path.join(srcDir, entry.name)}`);
		if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
		const srcPath = path.join(srcDir, entry.name);
		const dstPath = path.join(dstDir, entry.name);
		if (entry.isDirectory()) {
			copySeedTree(srcPath, dstPath);
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, dstPath);
		}
	}
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const common = {
	bundle: true,
	target: "es2022",
	minify: true,
	legalComments: "eof",
	logLevel: "warning",
	absWorkingDir: root,
};

const frontend = await build({
	...common,
	entryPoints: { main: "src/main.ts" },
	outdir: output,
	format: "esm",
	platform: "browser",
	splitting: true,
	chunkNames: "assets/[name]-[hash]",
	metafile: true,
});

await build({
	...common,
	entryPoints: ["src/backend.ts"],
	outfile: path.join(output, "backend.cjs"),
	format: "cjs",
	platform: "node",
	target: "node22",
});

for (const [from, to] of [
	["manifest.json", "manifest.json"],
	["src/styles.css", "styles.css"],
	["README.md", "README.md"],
	["LICENSE", "LICENSE"],
]) {
	fs.copyFileSync(path.join(root, from), path.join(output, to));
}

const seedSource = path.join(root, "seed");
if (fs.existsSync(seedSource)) {
	copySeedTree(seedSource, path.join(output, "seed"));
}

const files = Object.entries(frontend.metafile.outputs);
console.log(`Built ${output}`);
console.log(
	`Browser entry: ${files.find(([name]) => name.endsWith("/main.js"))?.[1].bytes ?? 0} bytes; ${files.length} JS files; total ${files.reduce((sum, [, data]) => sum + data.bytes, 0)} bytes.`,
);
