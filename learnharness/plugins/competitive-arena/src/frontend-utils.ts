import type { PluginFrontendContext, PluginButtonProps } from "learnharness-plugin-api";

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function lifetime(...parents: AbortSignal[]): AbortController {
	const controller = new AbortController();
	const abort = () => controller.abort();
	for (const parent of parents) {
		if (parent.aborted) {
			abort();
			break;
		}
		parent.addEventListener("abort", abort, { once: true });
	}
	controller.signal.addEventListener(
		"abort",
		() => {
			for (const parent of parents) {
				parent.removeEventListener("abort", abort);
			}
		},
		{ once: true },
	);
	return controller;
}

export function widget<T extends { dispose(): void }>(handle: T, signal: AbortSignal): T {
	if (signal.aborted) handle.dispose();
	else signal.addEventListener("abort", () => handle.dispose(), { once: true });
	return handle;
}

export function mountActionButton(
	ctx: PluginFrontendContext,
	parent: HTMLElement,
	label: string,
	action: () => void | Promise<void>,
	signal: AbortSignal,
	options: Partial<Omit<PluginButtonProps, "label" | "onClick">> = {},
) {
	const slot = el("span", "ca-btn-slot");
	parent.append(slot);
	let pending = false;
	let disabled = Boolean(options.disabled);
	const handle = widget(
		ctx.ui.mountButton(
			slot,
			{
				label,
				size: "sm",
				variant: "outline",
				...options,
				disabled: pending || disabled,
				onClick: async () => {
					if (pending || signal.aborted || disabled) return;
					pending = true;
					handle.update({ disabled: true });
					try {
						await action();
					} finally {
						pending = false;
						if (!signal.aborted) handle.update({ disabled });
					}
				},
			},
			{ signal },
		),
		signal,
	);
	return {
		update(next: Partial<PluginButtonProps>) {
			if ("disabled" in next) disabled = Boolean(next.disabled);
			handle.update({ ...next, disabled: pending || disabled });
		},
		dispose: () => handle.dispose(),
	};
}

export function formatClock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds || 0));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const rem = s % 60;
	if (h > 0) {
		return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
	}
	return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export function verdictBadgeClass(verdict: string): string {
	const v = (verdict || "").toUpperCase();
	if (v === "AC" || v === "PASS") return "ca-badge ca-badge-ac";
	if (v === "SUBMITTED" || v === "PENDING") return "ca-badge ca-badge-submit";
	if (v === "SKIPPED") return "ca-badge ca-badge-muted";
	return "ca-badge ca-badge-fail";
}

export function verdictBadgeColor(verdict: string): string | undefined {
	const v = (verdict || "").toUpperCase();
	if (v === "AC" || v === "PASS") return "var(--lh-success)";
	if (v === "SUBMITTED" || v === "PENDING") return "var(--lh-warning)";
	if (v === "SKIPPED") return undefined;
	return "var(--lh-error)";
}

function supportsBadgeColor(color: string | undefined): string | undefined {
	if (!color) return undefined;
	if (
		typeof globalThis.CSS?.supports === "function"
		&& globalThis.CSS.supports("color", color)
		&& globalThis.CSS.supports("background-color", `color-mix(in oklab, ${color} 15%, transparent)`)
	) {
		return color;
	}
	return undefined;
}

export function mountNativeBadge(
	ctx: PluginFrontendContext,
	parent: HTMLElement,
	text: string,
	color: string | undefined,
	signal: AbortSignal,
) {
	const slot = el("span", "ca-badge-slot");
	parent.append(slot);
	const resolved = supportsBadgeColor(color);
	return widget(
		ctx.ui.mountBadge(slot, resolved ? { text, color: resolved } : { text }, { signal }),
		signal,
	);
}

export function stashSessionOpeningPrompt(chatId: string, text: string): boolean {
	if (!text.trim()) return true;
	try {
		const payload = JSON.stringify({ text, attempted: false });
		globalThis.sessionStorage.setItem(`lh.openingPrompt.${chatId}`, payload);
		return true;
	} catch {
		return false;
	}
}

export async function openNewArenaSession(
	ctx: PluginFrontendContext,
	options: { title: string; openingPrompt?: string },
): Promise<string> {
	const response = await fetch("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: options.title.trim() || "Arena Session",
			kind: "arena",
		}),
	});
	const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
	if (!response.ok || typeof data.id !== "string" || !data.id) {
		throw new Error(data.error || `Failed to create Arena session (HTTP ${response.status})`);
	}
	if (options.openingPrompt?.trim()) {
		stashSessionOpeningPrompt(data.id, options.openingPrompt.trim());
	}
	ctx.app.openSession(data.id);
	return data.id;
}
