import {
	ANTIGRAVITY_PERMISSION_MODES,
	type AntigravityPermissionDecisionAction,
} from "../core/contracts/antigravity.ts";
import {
	listPendingAcpPermissions,
	resolveAcpPermission,
} from "../agent/antigravity/permission-broker.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const VALID_DECISIONS = new Set<AntigravityPermissionDecisionAction>(["allow_once", "allow_session", "deny"]);

function isCrossSite(request: Request): boolean {
	if (request.headers.get("sec-fetch-site") === "cross-site") return true;
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	return supplied !== null && origin !== null && supplied !== origin;
}

/** Lists pending interactive ACP permission requests for one chat session. */
export async function antigravityPermissionsGetResponse(request: Request): Promise<Response> {
	if (isCrossSite(request)) {
		return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403, headers: HEADERS });
	}
	const url = new URL(request.url);
	const chatId = url.searchParams.get("chatId")?.trim() ?? "";
	if (!chatId) {
		return Response.json({ error: "chatId query parameter is required." }, { status: 400, headers: HEADERS });
	}
	return Response.json({
		pending: listPendingAcpPermissions(chatId),
		modes: ANTIGRAVITY_PERMISSION_MODES,
	}, { headers: HEADERS });
}

/** Resolves a pending interactive ACP permission request (`allow_once`, `allow_session`, or `deny`). */
export async function antigravityPermissionsPostResponse(request: Request): Promise<Response> {
	if (isCrossSite(request)) {
		return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403, headers: HEADERS });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: HEADERS });
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return Response.json({ error: "Request body must be a JSON object." }, { status: 400, headers: HEADERS });
	}
	const raw = body as Record<string, unknown>;
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	const decision = typeof raw.decision === "string" ? raw.decision : "";
	if (!id) {
		return Response.json({ error: "id is required." }, { status: 400, headers: HEADERS });
	}
	if (!VALID_DECISIONS.has(decision as AntigravityPermissionDecisionAction)) {
		return Response.json({ error: "decision must be allow_once, allow_session, or deny." }, { status: 400, headers: HEADERS });
	}
	const resolved = resolveAcpPermission(id, decision as AntigravityPermissionDecisionAction);
	if (!resolved) {
		return Response.json({ error: "Permission prompt is no longer pending." }, { status: 404, headers: HEADERS });
	}
	return Response.json({ ok: true, id, decision }, { headers: HEADERS });
}
