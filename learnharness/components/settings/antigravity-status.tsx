"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ANTIGRAVITY_PERMISSION_MODES,
	DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
	type AntigravityPermissionMode,
	type AntigravityStatus,
	type UserSettings,
} from "@/src/core";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { ThinSelect, Toggle } from "./controls";

const PERMISSION_MODE_LABELS: Record<AntigravityPermissionMode, string> = {
	safe_prompt: "Safe + Prompt (default)",
	prompt_native: "Prompt on Native",
	turbo: "Turbo (Skip Permissions)",
};

const PERMISSION_MODE_HINTS: Record<AntigravityPermissionMode, string> = {
	safe_prompt: "Auto-allows LearnHarness MCP tools and safe read-only file/dir checks; asks before shell commands or writes.",
	prompt_native: "Auto-allows LearnHarness MCP tools only; asks before every native file, search, or shell tool.",
	turbo: "Auto-allows all ACP native tools without confirmation prompts.",
};

export function antigravityStatusLabel(status: AntigravityStatus | null): string {
	switch (status?.state) {
		case "not-found": return "agy binary not found";
		case "ready": {
			const parts = [
				status.version ? `Version ${status.version}` : "Connected",
				...(status.tier ? [status.tier] : []),
				`${status.modelCount} model${status.modelCount === 1 ? "" : "s"} discovered`,
			];
			return parts.join(" · ");
		}
		case "error": return status.error ? `Error: ${status.error}` : "ACP handshake failed";
		default: return "Status unavailable";
	}
}

export function AntigravityInstallationStatus() {
	const [enabled, setEnabled] = useState(false);
	const [permissionMode, setPermissionMode] = useState<AntigravityPermissionMode>(DEFAULT_ANTIGRAVITY_PERMISSION_MODE);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<AntigravityStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const settingsRead = useRef<AbortController | null>(null);
	const settingsWrite = useRef<AbortController | null>(null);

	const read = useCallback(async () => {
		settingsRead.current?.abort();
		const controller = new AbortController();
		settingsRead.current = controller;
		setLoaded(false);
		try {
			const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("settings unavailable");
			const body = await response.json() as { settings: UserSettings | null };
			if (!controller.signal.aborted) {
				setEnabled(body.settings?.antigravity?.enabled === true);
				const rawMode = body.settings?.antigravity?.permissionMode;
				setPermissionMode(
					rawMode && (ANTIGRAVITY_PERMISSION_MODES as readonly string[]).includes(rawMode)
						? rawMode
						: DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
				);
				setLoaded(true);
				setError(null);
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not load Antigravity settings.");
		}
	}, []);

	useEffect(() => {
		void read();
		return () => { settingsRead.current?.abort(); settingsWrite.current?.abort(); };
	}, [read]);

	useSettingsSaved((section) => {
		if (section === "antigravity") void read();
	});

	const save = async (nextEnabled: boolean, nextMode: AntigravityPermissionMode = permissionMode) => {
		const controller = new AbortController();
		settingsWrite.current = controller;
		settingsRead.current?.abort();
		setSaving(true);
		setError(null);
		try {
			const response = await fetch("/api/settings/antigravity", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled, permissionMode: nextMode }),
				signal: controller.signal,
			});
			if (!response.ok) throw new Error("settings write failed");
			const body = await response.json() as { settings: UserSettings };
			if (typeof body.settings?.antigravity?.enabled !== "boolean") throw new Error("invalid settings response");
			if (!controller.signal.aborted) {
				setEnabled(body.settings.antigravity.enabled);
				const savedMode = body.settings.antigravity.permissionMode;
				setPermissionMode(
					savedMode && (ANTIGRAVITY_PERMISSION_MODES as readonly string[]).includes(savedMode)
						? savedMode
						: DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
				);
				notifySettingsSaved("antigravity");
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not save Antigravity settings.");
		} finally {
			if (!controller.signal.aborted) setSaving(false);
		}
	};

	const refresh = useCallback(async (forceRefresh = true) => {
		if (!enabled) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		try {
			const response = await fetch(`/api/antigravity?refresh=${forceRefresh ? "1" : "0"}`, {
				cache: "no-store",
				signal: controller.signal,
				headers: { "x-learnharness-antigravity": "1" },
			});
			if (!response.ok) throw new Error("status unavailable");
			const value = await response.json() as AntigravityStatus;
			if (!["not-found", "ready", "error"].includes(value.state)) throw new Error("invalid status");
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, [enabled]);

	useEffect(() => {
		if (enabled) void refresh(false);
		else { request.current?.abort(); setStatus(null); setBusy(false); }
		return () => request.current?.abort();
	}, [enabled, refresh]);

	return <div className="space-y-2.5" data-testid="antigravity-installation">
		<div className="flex items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">Antigravity (ACP)</span>
			<Toggle label="Antigravity (ACP)" checked={enabled} disabled={!loaded || saving} onChange={(next) => void save(next, permissionMode)} />
		</div>
		{error && <p role="alert" className="text-xs text-error">{error}</p>}
		{enabled && <>
			<div className="flex flex-wrap items-center gap-3">
				<span role="status" className="text-xs text-muted-foreground">{busy ? "Checking & discovering models…" : antigravityStatusLabel(status)}</span>
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} onClick={() => void refresh(true)} data-testid="antigravity-check-again">Refresh models</Button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
				<div className="min-w-0 flex-1">
					<div className="font-ui text-xs text-foreground">Native tool permissions</div>
					<p className="text-[11px] leading-snug text-muted-foreground">{PERMISSION_MODE_HINTS[permissionMode]}</p>
				</div>
				<ThinSelect
					value={permissionMode}
					ariaLabel="Antigravity native tool permission mode"
					testid="antigravity-permission-mode"
					disabled={!loaded || saving}
					onChange={(next) => void save(enabled, next as AntigravityPermissionMode)}
				>
					{ANTIGRAVITY_PERMISSION_MODES.map((mode) => (
						<option key={mode} value={mode}>{PERMISSION_MODE_LABELS[mode]}</option>
					))}
				</ThinSelect>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground"><strong className="font-medium">Authenticate the agy CLI in your shell, then pick any discovered Antigravity model.</strong> Models and thinking levels are discovered dynamically from your local <code className="font-mono">agy acp</code> binary.</p>
		</>}
	</div>;
}
