import type { PluginFrontendContext } from "learnharness-plugin-api";
import { createArenaDashboardMount } from "./dashboard-view.ts";
import { registerArenaToolRenderers } from "./result-card.ts";
import { createArenaSettingsMount } from "./settings-view.ts";
import { type ActiveArenaSnapshot, type ArenaDashboardState, errorMessage } from "./types.ts";

const ARENA_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M9.5 17.5L21 6V3h-3L6.5 14.5"/><path d="M11 19l-6-6"/><path d="M8 16l-4 4"/><path d="M5 21l-2-2"/></svg>';

export function activate(ctx: PluginFrontendContext): () => void {
	let snapshot: ArenaDashboardState | null = null;
	let refreshing: Promise<void> | null = null;
	let refreshAgain = false;
	const observers = new Set<(state: ArenaDashboardState | null, error?: string) => void>();
	const registrations: (() => void)[] = [];

	const publish = (value: ArenaDashboardState | null) => {
		if (!value || ctx.signal.aborted) return;
		if (snapshot && value.revision < snapshot.revision) return;
		snapshot = value;
		for (const observer of observers) observer(value);
	};

	const reportError = (error: unknown) => {
		const msg = errorMessage(error);
		for (const observer of observers) observer(null, msg);
	};

	const refresh = (): Promise<void> => {
		if (!observers.size || ctx.signal.aborted) return Promise.resolve();
		if (refreshing) {
			refreshAgain = true;
			return refreshing;
		}
		refreshing = (async () => {
			do {
				refreshAgain = false;
				try {
					const state = await ctx.call<ArenaDashboardState>("get-state");
					if (observers.size) publish(state);
				} catch (error) {
					if (observers.size) reportError(error);
				}
			} while (refreshAgain && observers.size && !ctx.signal.aborted);
		})().finally(() => {
			refreshing = null;
		});
		return refreshing;
	};

	const observe = (
		fn: (state: ArenaDashboardState | null, error?: string) => void,
		signal: AbortSignal,
	) => {
		observers.add(fn);
		signal.addEventListener("abort", () => observers.delete(fn), { once: true });
		if (snapshot) fn(snapshot);
		void refresh();
	};

	registrations.push(
		ctx.registerView({
			id: "arena-dashboard",
			name: "Arena",
			mount: createArenaDashboardMount(ctx, observe, publish, () => {
				void refresh();
			}),
		}),
	);

	registrations.push(
		ctx.registerAction({
			id: "open-arena",
			name: "Arena",
			icon: ARENA_ICON,
			run: () => ctx.app.openView("arena-dashboard"),
		}),
	);

	registrations.push(
		ctx.placeAction({
			id: "open-arena-sidebar",
			actionId: "open-arena",
			location: "sidebar",
		}),
	);

	registrations.push(ctx.registerSettings(createArenaSettingsMount(ctx, observe, publish)));
	registrations.push(registerArenaToolRenderers(ctx));

	registrations.push(
		ctx.onNotification((event) => {
			if (event.pluginId && event.pluginId !== ctx.manifest.id) return;
			if (event.topic === "arena-changed") {
				void refresh();
			} else if (event.topic === "arena-status" && snapshot) {
				const nextActive = (event.data ?? null) as ActiveArenaSnapshot | null;
				snapshot = { ...snapshot, active: nextActive };
				for (const observer of observers) observer(snapshot);
			}
		}),
	);

	registrations.push(
		ctx.onResync(() => {
			void refresh();
		}),
	);

	const dispose = () => {
		for (const unregister of registrations.splice(0).reverse()) {
			unregister();
		}
		observers.clear();
	};
	ctx.cleanup(dispose);
	return dispose;
}
