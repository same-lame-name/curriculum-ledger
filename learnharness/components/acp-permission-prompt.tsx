"use client";

import { useCallback, useEffect, useState } from "react";
import type {
	AntigravityPermissionDecisionAction,
	AntigravityPermissionPrompt,
} from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { Button } from "@/components/ui/button";

export function AcpPermissionPromptCard({ chatId }: { chatId?: string }) {
	const [prompts, setPrompts] = useState<AntigravityPermissionPrompt[]>([]);
	const [submittingId, setSubmittingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!chatId) {
			setPrompts([]);
			return;
		}
		try {
			const res = await fetch(`/api/antigravity/permissions?chatId=${encodeURIComponent(chatId)}`, {
				cache: "no-store",
			});
			if (!res.ok) return;
			const data = (await res.json()) as { pending?: AntigravityPermissionPrompt[] };
			if (Array.isArray(data.pending)) {
				setPrompts(data.pending);
			}
		} catch {
			// Best-effort refresh; server resync or next event heals.
		}
	}, [chatId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useServerEvent("acp-permission-changed", (payload) => {
		if (chatId && payload.chatId === chatId) {
			void refresh();
		}
	});

	useServerResync(() => {
		void refresh();
	});

	const decide = async (id: string, decision: AntigravityPermissionDecisionAction) => {
		setSubmittingId(id);
		setError(null);
		try {
			const res = await fetch("/api/antigravity/permissions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, decision }),
			});
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error || "Failed to send decision");
			}
			setPrompts((prev) => prev.filter((item) => item.id !== id));
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not submit decision");
		} finally {
			setSubmittingId((cur) => (cur === id ? null : cur));
		}
	};

	const active = prompts[0];
	if (!chatId || !active) return null;

	const busy = submittingId === active.id;

	return (
		<div
			data-testid="acp-permission-prompt"
			className="mb-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="font-ui text-xs uppercase tracking-wider text-muted-foreground">
						Antigravity permission
					</span>
					<code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
						{active.toolName}
					</code>
					{prompts.length > 1 && (
						<span className="font-ui text-xs text-muted-foreground">
							+{prompts.length - 1} waiting
						</span>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						type="button"
						size="xs"
						variant="default"
						disabled={busy}
						data-testid="acp-permission-allow-once"
						onClick={() => void decide(active.id, "allow_once")}
					>
						Allow once
					</Button>
					<Button
						type="button"
						size="xs"
						variant="outline"
						disabled={busy}
						data-testid="acp-permission-allow-session"
						onClick={() => void decide(active.id, "allow_session")}
					>
						Allow for session
					</Button>
					<Button
						type="button"
						size="xs"
						variant="ghost"
						disabled={busy}
						data-testid="acp-permission-deny"
						onClick={() => void decide(active.id, "deny")}
					>
						Deny
					</Button>
				</div>
			</div>
			{(active.title || active.argsPreview) && (
				<div className="mt-2 min-w-0 space-y-1 text-xs text-muted-foreground">
					{active.title && <p className="truncate font-ui">{active.title}</p>}
					{active.argsPreview && (
						<pre className="max-h-24 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] text-foreground/90">
							{active.argsPreview}
						</pre>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="mt-1.5 text-xs text-error">
					{error}
				</p>
			)}
		</div>
	);
}
