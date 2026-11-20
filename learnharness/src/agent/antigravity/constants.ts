export { ANTIGRAVITY_API, ANTIGRAVITY_PROVIDER } from "../../core/contracts/antigravity.ts";

export enum AntigravityError {
	CliNotFound = "agy CLI not found",
	NotInitialized = "Antigravity ACP server did not initialize",
	Aborted = "Request was aborted",
}
