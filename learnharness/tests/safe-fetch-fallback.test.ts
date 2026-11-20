/**
 * Phase 1 Seam 1 tests: hardened `scripts/browser_fetch.py` SSRF checks and
 * universal GET 403/429 TLS-impersonation fallback wiring in `safeFetch`.
 * No real external network requests are performed.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { describe, it } from "node:test";
import { ROOT } from "../config.ts";
import {
	BlockedAddressError,
	browserFetchFallbackOverride,
	createAddressCheckedAgent,
	safeFetch,
} from "../src/agent/tools/safe-fetch.ts";

const BROWSER_FETCH_SCRIPT = path.join(ROOT, "scripts", "browser_fetch.py");

function runPython(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile("python3", args, { encoding: "utf8", timeout: 10_000 }, (error, stdout, stderr) => {
			if (!error) {
				resolve({ status: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
				return;
			}
			const err = error as NodeJS.ErrnoException & { status?: number };
			const status = typeof err.code === "number" ? err.code : typeof err.status === "number" ? err.status : 1;
			resolve({ status, stdout: String(stdout ?? ""), stderr: String(stderr ?? error.message ?? "") });
		});
	});
}

function startServer(host: string, handler: http.RequestListener) {
	const state = { hits: 0, port: 0, close: () => new Promise<void>((resolve) => srv.close(() => resolve())) };
	const srv = http.createServer((req, res) => {
		state.hits++;
		handler(req, res);
	});
	return new Promise<typeof state>((resolve) => {
		srv.listen(0, host, () => {
			state.port = (srv.address() as AddressInfo).port;
			resolve(state);
		});
	});
}

describe("scripts/browser_fetch.py SSRF hardening", () => {
	it("refuses loopback HTTP URLs with exit code 2 without touching the server", async () => {
		const secret = await startServer("127.0.0.1", (_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("internal secret");
		});
		try {
			const res = await runPython([BROWSER_FETCH_SCRIPT, `http://127.0.0.1:${secret.port}/secret`, "--json"]);
			assert.equal(res.status, 2, `expected exit code 2, got ${res.status}: ${res.stderr}`);
			assert.match(res.stderr, /refusing to connect to a private or local address/);
			assert.equal(secret.hits, 0);
		} finally {
			await secret.close();
		}
	});

	it("refuses non-http(s) URLs such as file:///etc/passwd", async () => {
		const res = await runPython([BROWSER_FETCH_SCRIPT, "file:///etc/passwd", "--json"]);
		assert.notEqual(res.status, 0);
		assert.match(res.stderr, /Only http and https URLs are allowed/);
	});

	it("checks every redirect hop and refuses redirect-to-loopback before hitting target", async () => {
		const secret = await startServer("127.0.0.1", (_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("secret target");
		});
		const bounce = await startServer("::1", (_req, res) => {
			res.writeHead(302, { location: `http://127.0.0.1:${secret.port}/secret` });
			res.end();
		});
		try {
			const py = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("browser_fetch", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    mod.fetch_raw(sys.argv[2], ip_allowed=lambda ip: ip == "::1")
except PermissionError as exc:
    print("BLOCKED:" + str(exc))
    sys.exit(2)
sys.exit(1)
`;
			const res = await runPython(["-c", py, BROWSER_FETCH_SCRIPT, `http://[::1]:${bounce.port}/start`]);
			assert.equal(res.status, 2, `expected PermissionError exit 2, got ${res.status}: ${res.stdout} ${res.stderr}`);
			assert.match(res.stdout, /BLOCKED:refusing to connect to a private or local address/);
			assert.equal(bounce.hits, 1);
			assert.equal(secret.hits, 0);
		} finally {
			await bounce.close();
			await secret.close();
		}
	});
});

describe("safeFetch universal GET 403/429 browser-fetch fallback", () => {
	it("upgrades GET 403 and GET 429 responses via fallback preserving final url, content-type, and body", async () => {
		for (const status of [403, 429] as const) {
			const srv = await startServer("127.0.0.1", (_req, res) => {
				res.writeHead(status, { "content-type": "text/plain" });
				res.end(`blocked-${status}`);
			});
			const agent = createAddressCheckedAgent(() => true);
			let fallbackCalls = 0;
			browserFetchFallbackOverride.current = async (url) => {
				fallbackCalls++;
				assert.match(url, new RegExp(`127\\.0\\.0\\.1:${srv.port}/problem`));
				const upgraded = new Response(`<html>upgraded-${status}</html>`, {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
				Object.defineProperty(upgraded, "url", { value: "https://upgraded.example/final", enumerable: true });
				return upgraded;
			};
			try {
				const res = await safeFetch(`http://127.0.0.1:${srv.port}/problem`, {}, agent);
				assert.equal(fallbackCalls, 1);
				assert.equal(res.status, 200);
				assert.equal(res.url, "https://upgraded.example/final");
				assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
				assert.equal(await res.text(), `<html>upgraded-${status}</html>`);
			} finally {
				browserFetchFallbackOverride.current = undefined;
				await agent.close();
				await srv.close();
			}
		}
	});

	it("skips fallback for GET 200, 404, 500 and for POST 403", async () => {
		for (const [method, status] of [
			["GET", 200],
			["GET", 404],
			["GET", 500],
			["POST", 403],
		] as const) {
			const srv = await startServer("127.0.0.1", (_req, res) => {
				res.writeHead(status, { "content-type": "text/plain" });
				res.end(`raw-${method}-${status}`);
			});
			const agent = createAddressCheckedAgent(() => true);
			let fallbackCalls = 0;
			browserFetchFallbackOverride.current = async () => {
				fallbackCalls++;
				return new Response("should-not-run", { status: 200 });
			};
			try {
				const res = await safeFetch(`http://127.0.0.1:${srv.port}/item`, { method }, agent);
				assert.equal(fallbackCalls, 0);
				assert.equal(res.status, status);
				assert.equal(await res.text(), `raw-${method}-${status}`);
			} finally {
				browserFetchFallbackOverride.current = undefined;
				await agent.close();
				await srv.close();
			}
		}
	});

	it("returns original 403/429 response when fallback returns null", async () => {
		const srv = await startServer("127.0.0.1", (_req, res) => {
			res.writeHead(403, { "content-type": "text/plain" });
			res.end("still-forbidden");
		});
		const agent = createAddressCheckedAgent(() => true);
		let fallbackCalls = 0;
		browserFetchFallbackOverride.current = async () => {
			fallbackCalls++;
			return null;
		};
		try {
			const res = await safeFetch(`http://127.0.0.1:${srv.port}/item`, {}, agent);
			assert.equal(fallbackCalls, 1);
			assert.equal(res.status, 403);
			assert.equal(await res.text(), "still-forbidden");
		} finally {
			browserFetchFallbackOverride.current = undefined;
			await agent.close();
			await srv.close();
		}
	});

	it("propagates BlockedAddressError from fallback", async () => {
		const srv = await startServer("127.0.0.1", (_req, res) => {
			res.writeHead(403, { "content-type": "text/plain" });
			res.end("edge-403");
		});
		const agent = createAddressCheckedAgent(() => true);
		browserFetchFallbackOverride.current = async () => {
			throw new BlockedAddressError("refusing to connect to a private or local address (127.0.0.1)");
		};
		try {
			await assert.rejects(
				safeFetch(`http://127.0.0.1:${srv.port}/item`, {}, agent),
				/refusing to connect to a private or local address/,
			);
		} finally {
			browserFetchFallbackOverride.current = undefined;
			await agent.close();
			await srv.close();
		}
	});
});
