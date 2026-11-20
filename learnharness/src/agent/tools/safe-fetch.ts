import { execFile } from "node:child_process";
import { BlockList, isIP } from "node:net";
import * as path from "node:path";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { PATHS } from "../../../config.ts";

/**
 * Fetch for model-chosen URLs (research web_fetch / web_fetch_pdf): only
 * public internet addresses. A fetched page can steer the researcher, so
 * without this it could read loopback services, the LAN, or cloud metadata
 * (169.254.169.254) and hand the response back to the model.
 *
 * The check runs on the address each connection actually reaches, after DNS
 * and before any request bytes are sent, so redirects, IP-literal URLs and
 * DNS rebinding all go through it.
 */

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8], // "this network"
	["10.0.0.0", 8], // private
	["100.64.0.0", 10], // carrier-grade NAT
	["127.0.0.0", 8], // loopback
	["169.254.0.0", 16], // link-local, cloud metadata
	["172.16.0.0", 12], // private
	["192.0.0.0", 24], // IETF protocol assignments
	["192.0.2.0", 24], // documentation
	["192.88.99.0", 24], // 6to4 relay anycast
	["192.168.0.0", 16], // private
	["198.18.0.0", 15], // benchmarking
	["198.51.100.0", 24], // documentation
	["203.0.113.0", 24], // documentation
	["224.0.0.0", 4], // multicast
	["240.0.0.0", 4], // reserved, broadcast
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	["::", 128], // unspecified
	["::1", 128], // loopback
	["64:ff9b::", 96], // NAT64
	["64:ff9b:1::", 48], // local-use NAT64
	["100::", 64], // discard-only
	["2001:db8::", 32], // documentation
	["2002::", 16], // 6to4
	["fc00::", 7], // unique local
	["fe80::", 10], // link-local
	["ff00::", 8], // multicast
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv6");

/** True when an IP address is on the public internet. IPv4-mapped IPv6
 *  (::ffff:a.b.c.d) is judged as the IPv4 address it carries. */
export function isPublicAddress(address: string): boolean {
	const unbracketed = address.replace(/^\[|\]$/g, "");
	const mapped = unbracketed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
	const ip = mapped ?? unbracketed;
	const family = isIP(ip);
	if (family === 4) return !NON_PUBLIC.check(ip, "ipv4");
	if (family === 6) return !NON_PUBLIC.check(ip, "ipv6");
	return false;
}

export class BlockedAddressError extends Error {}

/** An undici Agent whose connections may only reach addresses `allowed`
 *  accepts (exported with the check injectable, for tests). */
export function createAddressCheckedAgent(
	allowed: (address: string) => boolean = isPublicAddress,
	connectorOptions: Parameters<typeof buildConnector>[0] = {},
): Agent {
	// Optional connector settings let offline tests supply deterministic DNS and
	// a synthetic TLS CA. Production uses the standard connector unchanged.
	const connect = buildConnector(connectorOptions);
	return new Agent({
		connect: (options, callback) => {
			connect(options, (error, socket) => {
				if (error || !socket) {
					callback(error ?? new Error("connection failed"), null);
					return;
				}
				const peer = socket.remoteAddress ?? "";
				if (!peer || !allowed(peer)) {
					socket.destroy();
					callback(new BlockedAddressError(`refusing to connect to a private or local address (${options.hostname})`), null);
					return;
				}
				callback(null, socket);
			});
		},
	});
}

const publicOnly = createAddressCheckedAgent();

/** Test seam — undefined in production. Tests that drive the research tools
 *  offline set a canned responder here (stubbing globalThis.fetch no longer
 *  reaches these tools, which use undici's own fetch). */
export const safeFetchOverride: { current?: (url: string, init: RequestInit) => Promise<Response> } = {};

export type BrowserFetchFallback = (url: string, options: { signal?: AbortSignal; timeoutMs?: number }) => Promise<Response | null>;

/** Test seam for deterministic 403/429 TLS-impersonation fallback unit tests. */
export const browserFetchFallbackOverride: { current?: BrowserFetchFallback } = {};

function execBrowserFetch(
	script: string,
	args: string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(
			"python3",
			[script, ...args],
			{ maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, signal, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
					return;
				}
				const err = error as NodeJS.ErrnoException & { status?: number };
				const code = typeof err.code === "number" ? err.code : typeof err.status === "number" ? err.status : 1;
				resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? error.message ?? "") });
			},
		);
	});
}

/** Universal curl_cffi fallback invoked when a public GET returns HTTP 403 or 429. */
export async function runBrowserFetchFallback(
	url: string,
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response | null> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	const timeoutMs = options.timeoutMs ?? 20_000;
	const script = path.join(PATHS.root, "scripts", "browser_fetch.py");
	const timeoutSecs = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
	const { code, stdout, stderr } = await execBrowserFetch(
		script,
		[url, "--format", "html", "--max-chars", "0", "--json", "--timeout", timeoutSecs],
		timeoutMs,
		options.signal,
	);
	if (code === 2 || stderr.includes("refusing to connect to a private or local address")) {
		throw new BlockedAddressError(stderr.trim() || `refusing to connect to a private or local address (${parsed.hostname})`);
	}
	if (code !== 0 || !stdout.trim()) return null;
	try {
		const payload = JSON.parse(stdout) as { status?: unknown; url?: unknown; contentType?: unknown; body?: unknown };
		if (typeof payload.status !== "number" || payload.status < 200 || payload.status >= 300 || typeof payload.body !== "string") {
			return null;
		}
		const contentType = typeof payload.contentType === "string" && payload.contentType ? payload.contentType : "text/html; charset=utf-8";
		const res = new Response(payload.body, {
			status: payload.status,
			headers: { "content-type": contentType },
		});
		Object.defineProperty(res, "url", {
			value: typeof payload.url === "string" && payload.url ? payload.url : url,
			enumerable: true,
		});
		return res;
	} catch {
		return null;
	}
}

/** fetch() limited to public addresses. A refusal surfaces as its own
 *  message instead of undici's generic "fetch failed". */
export async function safeFetch(url: string, init: RequestInit = {}, dispatcher: Agent = publicOnly): Promise<Response> {
	if (safeFetchOverride.current) return safeFetchOverride.current(url, init);
	let resp: Response;
	try {
		resp = (await undiciFetch(url, { ...(init as object), dispatcher })) as unknown as Response;
	} catch (err) {
		const cause = (err as { cause?: unknown }).cause;
		if (cause instanceof BlockedAddressError) throw new Error(cause.message);
		throw err;
	}
	const method = (init.method ?? "GET").toUpperCase();
	const canFallback =
		(resp.status === 403 || resp.status === 429) &&
		method === "GET" &&
		(dispatcher === publicOnly || browserFetchFallbackOverride.current !== undefined) &&
		!init.signal?.aborted;
	if (!canFallback) return resp;

	try {
		const fallback = browserFetchFallbackOverride.current ?? runBrowserFetchFallback;
		const upgraded = await fallback(url, { signal: init.signal ?? undefined, timeoutMs: 20_000 });
		if (upgraded && upgraded.ok) {
			void resp.body?.cancel().catch(() => undefined);
			return upgraded;
		}
	} catch (err) {
		if (err instanceof BlockedAddressError) {
			void resp.body?.cancel().catch(() => undefined);
			throw new Error(err.message);
		}
	}
	return resp;
}
