import type {
	ModelCatalogResponse,
	PluginFrontendContext,
	PluginSettingsRow,
} from "learnharness-plugin-api";
import { el, lifetime, mountActionButton, mountNativeBadge, widget } from "./frontend-utils.ts";
import { type ArenaDashboardState, type EnvironmentCheck, errorMessage } from "./types.ts";

export function createArenaSettingsMount(
	ctx: PluginFrontendContext,
	observe: (fn: (state: ArenaDashboardState | null, error?: string) => void, signal: AbortSignal) => void,
	publishState: (state: ArenaDashboardState) => void,
) {
	return function mountArenaSettings(container: HTMLElement, hostSignal: AbortSignal): () => void {
		const scope = lifetime(hostSignal, ctx.signal);
		const signal = scope.signal;

		const root = el("div", "ca-root ca-settings");
		const envSection = el("section", "ca-panel");
		const rowsSection = el("div");
		const launchTestRow = el("div", "ca-actions");
		const modelSection = el("div", "ca-model-settings");
		const errorEl = el("p", "ca-error");
		errorEl.setAttribute("role", "alert");

		root.append(envSection, rowsSection, launchTestRow, modelSection, errorEl);
		container.append(root);

		let initialized = false;
		let settingsHandle: ReturnType<typeof ctx.ui.mountSettingsRows> | null = null;
		let followHandle: ReturnType<typeof ctx.ui.mountSettingsRows> | null = null;
		let modelPicker: ReturnType<typeof ctx.ui.mountModelPicker> | null = null;
		let thinkingPicker: ReturnType<typeof ctx.ui.mountThinkingPicker> | null = null;
		let modelPickersWrap: HTMLDivElement | null = null;
		let catalog: ModelCatalogResponse | null = null;
		let overrideDraft = false;
		let modelBusy = false;
		let latestState: ArenaDashboardState | null = null;

		const showError = (cause: unknown) => {
			if (!signal.aborted) errorEl.textContent = errorMessage(cause);
		};

		const followingCheap = (s: ArenaDashboardState["settings"]) =>
			!overrideDraft && !s.workerModelOverride && s.workerThinkingOverride == null;

		const buildRows = (s: ArenaDashboardState["settings"]): PluginSettingsRow[] => {
			const onChange = (key: string, parse: (v: unknown) => unknown = (v) => v) => async (val: unknown) => {
				try {
					const next = await ctx.call<ArenaDashboardState>("save-settings", { [key]: parse(val) });
					if (!signal.aborted) {
						errorEl.textContent = "";
						publishState(next);
					}
				} catch (err) {
					showError(err);
					throw err;
				}
			};
			return [
				{
					key: "pointerEnabled",
					label: "Manage ~/.pi-arena-root pointer",
					description: "Automatically point external editors (e.g., Neovim Arena) to this plugin's arena directory.",
					type: "toggle",
					value: s.pointerEnabled,
					onChange: onChange("pointerEnabled", Boolean),
				},
				{
					key: "practiceDir",
					label: "Practice workspace directory",
					description: "Directory where external editors read/write <problem_id>.cpp solutions.",
					type: "text",
					value: s.practiceDir,
					onChange: onChange("practiceDir", String),
				},
				{
					key: "launchCommand",
					label: "External editor launch command (optional)",
					description: "Shell command template supporting {arenaDir}, {manifest}, {practiceDir}, and {file}. Leave empty to open Neovim manually.",
					type: "text",
					value: s.launchCommand,
					onChange: onChange("launchCommand", String),
				},
				{
					key: "autoLaunch",
					label: "Auto-launch external editor on arena_run",
					description: "Run the configured launch command automatically whenever arena_run stages a problem.",
					type: "toggle",
					value: s.autoLaunch,
					onChange: onChange("autoLaunch", Boolean),
				},
				{
					key: "artifactTtlDays",
					label: "Artifact retention (days)",
					description: "Staged catalog sets and inactive Lab hidden test suites older than this are swept at startup (1-365).",
					type: "number",
					min: 1,
					max: 365,
					step: 1,
					value: s.artifactTtlDays,
					onChange: onChange("artifactTtlDays", Number),
				},
			];
		};

		let envScope = lifetime(signal);
		function renderEnv(env: EnvironmentCheck) {
			envScope.abort();
			envScope = lifetime(signal);
			envSection.replaceChildren();

			const head = el("div", "ca-card-header");
			head.append(el("h2", "ca-panel-title", "Environment Readiness"));
			const btns = el("div", "ca-actions");
			mountActionButton(
				ctx,
				btns,
				"Re-check",
				async () => {
					const fresh = await ctx.call<EnvironmentCheck>("check-environment");
					if (!signal.aborted) renderEnv(fresh);
				},
				envScope.signal,
			);
			mountActionButton(
				ctx,
				btns,
				"Sync Pointer Now",
				async () => {
					const res = await ctx.call<{ state: ArenaDashboardState }>("sync-pointer");
					if (!signal.aborted && res?.state) publishState(res.state);
				},
				envScope.signal,
			);
			head.append(btns);
			envSection.append(head);

			const list = el("div", "ca-checklist");
			for (const item of env.items) {
				const row = el("div", "ca-check-item");
				mountNativeBadge(
					ctx,
					row,
					item.ok ? "OK" : item.required ? "Required" : "Optional",
					item.ok ? "var(--lh-success)" : item.required ? "var(--lh-error)" : "var(--lh-warning)",
					envScope.signal,
				);
				row.append(
					el("strong", undefined, item.label),
					el("span", "ca-muted ca-check-detail", item.detail),
				);
				list.append(row);
			}
			envSection.append(list);
		}

		const saveModelPatch = async (patch: Record<string, unknown>) => {
			if (modelBusy || signal.aborted) return;
			modelBusy = true;
			if (latestState) updateModelUi(latestState.settings);
			try {
				const next = await ctx.call<ArenaDashboardState>("save-settings", patch);
				if (!signal.aborted) {
					overrideDraft = false;
					errorEl.textContent = "";
					publishState(next);
				}
			} catch (err) {
				showError(err);
			} finally {
				modelBusy = false;
				if (!signal.aborted && latestState) updateModelUi(latestState.settings);
			}
		};

		const followRow = (s: ArenaDashboardState["settings"]): PluginSettingsRow => ({
			key: "followCheapSlot",
			label: "Background worker model (lab, problem_grader, problem_recommender)",
			description: "Follow Cheap slot (recommended)",
			type: "toggle",
			value: followingCheap(s),
			disabled: modelBusy,
			onChange: async (follow) => {
				if (modelBusy || signal.aborted) return;
				if (follow) {
					await saveModelPatch({ workerModelOverride: null, workerThinkingOverride: null });
				} else if (catalog?.slots?.cheap?.model) {
					await saveModelPatch({
						workerModelOverride: catalog.slots.cheap.model,
						workerThinkingOverride: catalog.slots.cheap.thinkingLevel ?? null,
					});
				} else {
					overrideDraft = true;
					updateModelUi(s);
				}
			},
		});

		const updateModelUi = (s: ArenaDashboardState["settings"]) => {
			const following = followingCheap(s);
			const model = s.workerModelOverride || catalog?.slots?.cheap?.model || undefined;
			followHandle?.update({ rows: [followRow(s)] });
			if (modelPickersWrap) modelPickersWrap.hidden = following;
			modelPicker?.update({ value: model, disabled: following || modelBusy });
			thinkingPicker?.update({
				model,
				value: s.workerThinkingOverride ?? (s.workerModelOverride ? undefined : catalog?.slots?.cheap?.thinkingLevel),
				disabled: following || modelBusy || !model,
			});
		};

		const launchFeedback = el("span", "ca-muted ca-inline-status");
		mountActionButton(
			ctx,
			launchTestRow,
			"Test Editor Launch Command",
			async () => {
				try {
					const res = await ctx.call<{ launched: boolean; message: string }>("launch-editor");
					if (!signal.aborted) launchFeedback.textContent = res.message;
				} catch (err) {
					showError(err);
				}
			},
			signal,
		);
		launchTestRow.append(launchFeedback);

		observe((state, loadError) => {
			if (signal.aborted) return;
			if (loadError) {
				showError(loadError);
				return;
			}
			if (!state) return;
			latestState = state;
			errorEl.textContent = "";
			renderEnv(state.environment);

			if (!initialized) {
				initialized = true;
				settingsHandle = widget(
					ctx.ui.mountSettingsRows(rowsSection, { rows: buildRows(state.settings) }, { signal }),
					signal,
				);

				const followSlot = el("div", "ca-follow-cheap");
				modelPickersWrap = el("div", "ca-model-pickers");
				const modelSlot = el("div", "ca-model-slot");
				const thinkingSlot = el("div", "ca-thinking-slot");
				modelPickersWrap.append(modelSlot, thinkingSlot);
				modelSection.append(followSlot, modelPickersWrap);

				followHandle = widget(
					ctx.ui.mountSettingsRows(followSlot, { rows: [followRow(state.settings)] }, { signal }),
					signal,
				);
				modelPicker = widget(
					ctx.ui.mountModelPicker(
						modelSlot,
						{
							value: state.settings.workerModelOverride || undefined,
							onChange: async (value) => {
								await saveModelPatch({ workerModelOverride: value, workerThinkingOverride: null });
							},
						},
						{ signal },
					),
					signal,
				);
				thinkingPicker = widget(
					ctx.ui.mountThinkingPicker(
						thinkingSlot,
						{
							model: state.settings.workerModelOverride || undefined,
							value: state.settings.workerThinkingOverride ?? undefined,
							onChange: async (value) => {
								await saveModelPatch({ workerThinkingOverride: value });
							},
						},
						{ signal },
					),
					signal,
				);
				updateModelUi(state.settings);
				void ctx
					.call<ModelCatalogResponse>("get-catalog")
					.then((c) => {
						if (!signal.aborted && latestState) {
							catalog = c;
							updateModelUi(latestState.settings);
						}
					})
					.catch(showError);
			} else {
				settingsHandle?.update({ rows: buildRows(state.settings) });
				updateModelUi(state.settings);
			}
		}, signal);

		return () => {
			scope.abort();
			root.remove();
		};
	};
}
