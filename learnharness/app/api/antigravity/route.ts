import { antigravityInstallationResponse } from "@/src/server";

/** Installation, ACP handshake, and live discovered catalog summary. */
export async function GET(request: Request) {
	return antigravityInstallationResponse(request);
}
