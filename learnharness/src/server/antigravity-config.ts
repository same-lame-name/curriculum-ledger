import {
	ANTIGRAVITY_PERMISSION_MODES,
	DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
	type AntigravityPermissionMode,
} from "../core/contracts/antigravity.ts";
import { getAgyBinary } from "../agent/antigravity/binary.ts";
import { settingsStore } from "../store/settings.ts";

/** Fresh admission state, not a process-wide cache. Existing runs retain
 * their engines; only new chat/job/extraction/compaction admissions consult it. */
export function antigravityEnabled(): boolean {
	return settingsStore.readSettings()?.antigravity?.enabled === true;
}

/** Permission policy for native tool requests inside Antigravity ACP turns. */
export function antigravityPermissionMode(): AntigravityPermissionMode {
	const raw = settingsStore.readSettings()?.antigravity?.permissionMode;
	if (typeof raw === "string" && (ANTIGRAVITY_PERMISSION_MODES as readonly string[]).includes(raw)) {
		return raw as AntigravityPermissionMode;
	}
	return DEFAULT_ANTIGRAVITY_PERMISSION_MODE;
}

/** Installation/opt-in availability only, never remote auth/quota readiness. */
export function antigravityAvailable(): boolean {
	return antigravityEnabled() && getAgyBinary() !== null;
}
