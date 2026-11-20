import {
	antigravityPermissionsGetResponse,
	antigravityPermissionsPostResponse,
} from "@/src/server";

export async function GET(request: Request) {
	return antigravityPermissionsGetResponse(request);
}

export async function POST(request: Request) {
	return antigravityPermissionsPostResponse(request);
}
