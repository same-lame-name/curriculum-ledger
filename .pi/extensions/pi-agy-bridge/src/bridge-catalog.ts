// Filters which Pi tools are exposed to Antigravity ACP over the MCP bridge.

import type { BridgeToolInfo } from "./types.ts";

const EXCLUDED_TOOLS = new Set([
	"antigravity",
	"AskAntigravity",
	"bridge_poll_result",
	"activate_skill",
]);

export function bridgedPiTools(
	all: BridgeToolInfo[],
	active: readonly string[],
	hidden: ReadonlySet<string> = new Set(),
): BridgeToolInfo[] {
	const enabled = new Set(active);
	return all.filter((tool) =>
		enabled.has(tool.name) &&
		!hidden.has(tool.name) &&
		!EXCLUDED_TOOLS.has(tool.name) &&
		// Exclude Pi builtins so agy uses its native file/shell tools directly
		tool.sourceInfo?.source !== "builtin",
	);
}
