import { refreshAntigravityProvider } from "../agent/models.ts";
import { getAgyBinary } from "../agent/antigravity/binary.ts";
import { getCachedAntigravityInfo, probeAntigravityCatalog } from "../agent/antigravity/models-catalog.ts";
import type { AntigravityStatus } from "../core/contracts/antigravity.ts";
import { antigravityEnabled } from "./antigravity-config.ts";
import { initAuthEnv } from "./keys.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

let catalogLoadedInProcess = false;

/** Refresh cached ACP models once per process when enabled and installed. */
export async function ensureAntigravityCatalogLoaded(force = false): Promise<void> {
	if (!antigravityEnabled()) return;
	if (!getAgyBinary()) return;
	if (catalogLoadedInProcess && !force) return;
	initAuthEnv();
	const probe = await probeAntigravityCatalog();
	if (probe.ok) {
		catalogLoadedInProcess = true;
		refreshAntigravityProvider();
	}
}

export async function antigravityInstallationStatus(forceRefresh = true): Promise<AntigravityStatus> {
	initAuthEnv();
	const binaryPath = getAgyBinary();
	if (!binaryPath) {
		return { state: "not-found", version: null, binaryPath: null, tier: null, modelCount: 0 };
	}
	if (!forceRefresh && catalogLoadedInProcess) {
		const cached = getCachedAntigravityInfo();
		return {
			state: "ready",
			version: cached.version,
			binaryPath,
			tier: cached.tier,
			modelCount: cached.models.length,
		};
	}
	const probe = await probeAntigravityCatalog();
	if (probe.ok) {
		catalogLoadedInProcess = true;
		refreshAntigravityProvider();
		return {
			state: "ready",
			version: probe.version,
			binaryPath,
			tier: probe.tier,
			modelCount: probe.models.length,
		};
	}
	return {
		state: "error",
		version: probe.version,
		binaryPath,
		tier: probe.tier,
		modelCount: probe.models.length,
		error: probe.error ?? "Failed to initialize Antigravity ACP server.",
	};
}

/** Same-origin browser intent check, mirroring claudeCodeInstallationResponse. */
export async function antigravityInstallationResponse(
	request: Request,
	inspect = antigravityInstallationStatus,
	enabled = antigravityEnabled,
): Promise<Response> {
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET" || !origin
		|| request.headers.get("x-learnharness-antigravity") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| (supplied !== null && supplied !== origin)) {
		return Response.json({ error: "Antigravity ACP checks require a same-origin LearnHarness request." }, { status: 403, headers });
	}
	if (!enabled()) return Response.json({ error: "Antigravity (ACP) is disabled." }, { status: 403, headers });
	const url = new URL(request.url);
	const force = url.searchParams.get("refresh") !== "0";
	return Response.json(await inspect(force), { headers });
}
