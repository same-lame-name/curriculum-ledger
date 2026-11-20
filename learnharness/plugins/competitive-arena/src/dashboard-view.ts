import type { PluginFrontendContext } from "learnharness-plugin-api";
import {
	el,
	formatClock,
	lifetime,
	mountActionButton,
	mountNativeBadge,
	openNewArenaSession,
	verdictBadgeColor,
	widget,
} from "./frontend-utils.ts";
import { mountRatingChart, type RatingChartHandle } from "./rating-chart.ts";
import { type ArenaDashboardState, CANONICAL_DOMAINS, errorMessage } from "./types.ts";

export function createArenaDashboardMount(
	ctx: PluginFrontendContext,
	observe: (fn: (state: ArenaDashboardState | null, error?: string) => void, signal: AbortSignal) => void,
	publishState: (state: ArenaDashboardState) => void,
	triggerRefresh: () => void,
) {
	return function mountArenaDashboard(container: HTMLElement, hostSignal: AbortSignal): () => void {
		const scope = lifetime(hostSignal, ctx.signal);
		const signal = scope.signal;

		const root = el("div", "ca-root ca-dashboard");
		const topBar = el("header", "ca-dash-header");
		const titleBlock = el("div", "ca-dash-title-wrap");
		titleBlock.append(el("h1", "ca-dash-title", "Competitive Arena"));
		titleBlock.append(
			el(
				"p",
				"ca-muted",
				"ThemeCP ladder, curated catalog, isolated Lab stress tests, and external Neovim training.",
			),
		);

		const topActions = el("div", "ca-actions");
		const primaryCtaSlot = el("div", "ca-primary-cta-slot");
		topActions.append(primaryCtaSlot);
		mountActionButton(
			ctx,
			topActions,
			"New Arena Chat",
			async () => {
				await openNewArenaSession(ctx, { title: "Arena Practice" });
			},
			signal,
			{ variant: "outline" },
		);
		mountActionButton(ctx, topActions, "Refresh", () => triggerRefresh(), signal, { variant: "ghost" });
		mountActionButton(ctx, topActions, "Settings", () => ctx.app.openSettings(), signal, { variant: "ghost" });
		topBar.append(titleBlock, topActions);

		// Native LearnHarness quick-start composer
		const composerSlot = el("div", "ca-composer-wrap");
		let composerDraft = "";
		let composerBusy = false;
		const syncComposer = () => {
			composerHandle.update({
				value: composerDraft,
				busy: composerBusy,
				canSend: composerDraft.trim().length > 0 && !composerBusy,
			});
		};
		const composerHandle = widget(
			ctx.ui.mountComposer(
				composerSlot,
				{
					value: composerDraft,
					canSend: false,
					busy: false,
					placeholder: "Paste a Codeforces / AtCoder / CSES / USACO problem URL or describe what to practice…",
					onChange: (next) => {
						composerDraft = next;
						syncComposer();
					},
					onSend: async () => {
						const raw = composerDraft.trim();
						if (!raw || composerBusy || signal.aborted) return;
						composerBusy = true;
						errorEl.textContent = "";
						syncComposer();
						try {
							const isUrl = /^https?:\/\//i.test(raw);
							await openNewArenaSession(ctx, {
								title: isUrl ? "Arena Problem" : "Arena Practice",
								openingPrompt: isUrl ? `Let's solve this problem in the Arena: ${raw}` : raw,
							});
							if (!signal.aborted) {
								composerDraft = "";
							}
						} catch (err) {
							if (!signal.aborted) errorEl.textContent = errorMessage(err);
						} finally {
							composerBusy = false;
							if (!signal.aborted) syncComposer();
						}
					},
				},
				{ signal },
			),
			signal,
		);

		const errorEl = el("p", "ca-error");
		errorEl.setAttribute("role", "alert");

		const activeSlot = el("div");
		const kpiStrip = el("section", "ca-panel ca-kpi-strip");
		const chartPanel = el("section", "ca-panel ca-chart-panel");
		const chartHandle: RatingChartHandle = mountRatingChart(chartPanel, [], signal);

		const mainGrid = el("div", "ca-dash-grid");
		const ladderCard = el("section", "ca-panel");
		const domainsCard = el("section", "ca-panel");
		mainGrid.append(ladderCard, domainsCard);

		const historyGrid = el("div", "ca-dash-grid");
		const roundsCard = el("section", "ca-panel");
		const attemptsCard = el("section", "ca-panel");
		historyGrid.append(roundsCard, attemptsCard);

		const envWarnSlot = el("div");

		root.append(topBar, composerSlot, errorEl, envWarnSlot, activeSlot, kpiStrip, chartPanel, mainGrid, historyGrid);
		container.append(root);

		let clockTimer: ReturnType<typeof setInterval> | null = null;
		const stopClock = () => {
			if (clockTimer !== null) {
				clearInterval(clockTimer);
				clockTimer = null;
			}
		};
		signal.addEventListener("abort", stopClock, { once: true });

		let ctaScope = lifetime(signal);
		let activeScope = lifetime(signal);
		let kpiScope = lifetime(signal);
		let ladderScope = lifetime(signal);
		let domainsScope = lifetime(signal);
		let historyScope = lifetime(signal);
		let envScope = lifetime(signal);

		function renderPrimaryCta(state: ArenaDashboardState) {
			ctaScope.abort();
			ctaScope = lifetime(signal);
			primaryCtaSlot.replaceChildren();
			const up = state.ladder?.pending_upsolve;
			if (up) {
				mountActionButton(
					ctx,
					primaryCtaSlot,
					"Start Upsolve",
					async () => {
						await openNewArenaSession(ctx, {
							title: `Upsolve ${up.problem_id}`,
							openingPrompt: `Help me solve and clear my pending ThemeCP upsolve: ${up.problem_id}${up.url ? ` (${up.url})` : ""}.`,
						});
					},
					ctaScope.signal,
					{ variant: "default" },
				);
			} else {
				mountActionButton(
					ctx,
					primaryCtaSlot,
					"Start ThemeCP Round",
					async () => {
						await openNewArenaSession(ctx, {
							title: "ThemeCP Round",
							openingPrompt: "Check my ThemeCP ladder status and upsolve gate, then start my next ThemeCP round.",
						});
					},
					ctaScope.signal,
					{ variant: "default" },
				);
			}
		}

		function renderActiveBanner(state: ArenaDashboardState) {
			activeScope.abort();
			activeScope = lifetime(signal);
			stopClock();
			activeSlot.replaceChildren();
			const active = state.active;
			if (!active) return;

			const banner = el("section", "ca-panel ca-active-banner");
			const head = el("div", "ca-card-header");
			const left = el("div", "ca-card-title-group");
			mountNativeBadge(ctx, left, "Live session", "var(--lh-success)", activeScope.signal);
			left.append(el("strong", undefined, active.title));
			mountNativeBadge(ctx, left, `${active.purpose} · ${active.timerMode}`, "var(--lh-accent)", activeScope.signal);

			const clockSpan = el("span", "ca-clock", "");
			const updateClock = () => {
				const elapsedSec = Math.max(0, Math.floor((Date.now() - active.startedAtMs) / 1000));
				clockSpan.textContent = active.totalTimeBudgetSeconds > 0
					? `${formatClock(elapsedSec)} / ${formatClock(active.totalTimeBudgetSeconds)}`
					: formatClock(elapsedSec);
			};
			updateClock();
			clockTimer = setInterval(updateClock, 1000);
			left.append(clockSpan);

			const right = el("div", "ca-actions");
			mountActionButton(
				ctx,
				right,
				"Launch Editor",
				async () => {
					const res = await ctx.call<{ launched: boolean; message: string }>("launch-editor");
					if (!signal.aborted && !res.launched) errorEl.textContent = res.message;
				},
				activeScope.signal,
			);
			mountActionButton(
				ctx,
				right,
				"Discard",
				async () => {
					const next = await ctx.call<ArenaDashboardState>("cancel-active");
					if (!signal.aborted) publishState(next);
				},
				activeScope.signal,
				{ variant: "ghost" },
			);
			mountActionButton(
				ctx,
				right,
				"Abandon & Settle",
				async () => {
					const next = await ctx.call<ArenaDashboardState>("abandon-active");
					if (!signal.aborted) publishState(next);
				},
				activeScope.signal,
				{ variant: "destructive" },
			);

			head.append(left, right);
			banner.append(head);

			banner.append(el("div", "ca-muted ca-status-line", `Editor event: ${active.lastEventText}`));

			if (active.problems.length > 0) {
				const chips = el("div", "ca-pills ca-active-probs");
				for (const p of active.problems) {
					const label = p.live.verdict
						? `${p.title}: ${p.live.verdict}`
						: p.live.judge
							? `${p.title}: ${p.live.judge}`
							: `${p.title} (${p.live.state})`;
					mountNativeBadge(
						ctx,
						chips,
						label,
						p.live.verdict ? verdictBadgeColor(p.live.verdict) : undefined,
						activeScope.signal,
					);
				}
				banner.append(chips);
			}

			activeSlot.append(banner);
		}

		function renderKpiStrip(state: ArenaDashboardState) {
			kpiScope.abort();
			kpiScope = lifetime(signal);
			kpiStrip.replaceChildren();

			const g = state.standing?.global;
			const l = state.ladder;
			const grid = el("div", "ca-kpi-strip-grid");
			const makeStat = (label: string, val: string, sub?: string) => {
				const cell = el("div", "ca-kpi-cell");
				cell.append(el("span", "ca-kpi-lbl", label), el("span", "ca-kpi-val", val));
				if (sub) cell.append(el("span", "ca-kpi-sub", sub));
				return cell;
			};

			grid.append(
				makeStat("Rating", g ? `CF ${g.rating ?? 1200}` : "—", g?.tier || undefined),
				makeStat("Peak", g ? `CF ${g.max_rating ?? 1200}` : "—"),
				makeStat("Rated Solved", g ? `${g.rated_solved ?? 0}/${g.rated_attempted ?? 0}` : "—"),
				makeStat("Streak", g ? `${g.streak ?? 0}` : "—"),
				makeStat("ThemeCP Level", l ? `L${l.level ?? 1}` : "—", l?.performance ? `Perf ${l.performance}` : undefined),
				makeStat("AK Rate", l ? `${Math.round(Number(l.ak_rate || 0) * 100)}%` : "—", l ? `${l.total_rounds ?? 0} rounds` : undefined),
			);
			kpiStrip.append(grid);
		}

		function renderLadder(state: ArenaDashboardState) {
			ladderScope.abort();
			ladderScope = lifetime(signal);
			ladderCard.replaceChildren();
			ladderCard.append(el("h2", "ca-panel-title", "ThemeCP Ladder"));

			if (state.ladderError || !state.ladder) {
				ladderCard.append(el("p", "ca-error", state.ladderError || "Ladder unavailable"));
				return;
			}

			const l = state.ladder;
			if (Array.isArray(l.slots) && l.slots.length > 0) {
				const slotRow = el("div", "ca-slots-row");
				slotRow.append(el("span", "ca-muted", "Target slots:"));
				l.slots.forEach((rating: number, idx: number) => {
					mountNativeBadge(ctx, slotRow, `P${idx + 1}: CF ${rating}`, undefined, ladderScope.signal);
				});
				ladderCard.append(slotRow);
			}

			if (l.pending_upsolve) {
				const up = l.pending_upsolve;
				const gate = el("div", "ca-upsolve-banner");
				gate.append(
					el(
						"div",
						"ca-upsolve-title",
						`Upsolve Gate Active: ${up.title || up.problem_id} (${up.round_id || "recent round"})`,
					),
				);
				const gateActions = el("div", "ca-actions");
				mountActionButton(
					ctx,
					gateActions,
					"Start Upsolve",
					async () => {
						await openNewArenaSession(ctx, {
							title: `Upsolve ${up.problem_id}`,
							openingPrompt: `Help me solve and clear my pending ThemeCP upsolve: ${up.problem_id}${up.url ? ` (${up.url})` : ""}.`,
						});
					},
					ladderScope.signal,
					{ variant: "default" },
				);
				mountActionButton(
					ctx,
					gateActions,
					"Waive Upsolve",
					async () => {
						const next = await ctx.call<ArenaDashboardState>("waive-upsolve", {
							reason: "Waived from Arena Dashboard",
						});
						if (!signal.aborted) publishState(next);
					},
					ladderScope.signal,
					{ variant: "outline" },
				);
				gate.append(gateActions);
				ladderCard.append(gate);
			} else {
				ladderCard.append(
					el("p", "ca-muted", "Upsolve gate clear — ready for your next rated ThemeCP round."),
				);
			}
		}

		function renderDomains(state: ArenaDashboardState) {
			domainsScope.abort();
			domainsScope = lifetime(signal);
			domainsCard.replaceChildren();
			domainsCard.append(el("h2", "ca-panel-title", "Domain Mastery"));

			if (state.standingError || !state.standing?.global) {
				domainsCard.append(el("p", "ca-error", state.standingError || "Ledger unavailable"));
				return;
			}

			const domList = el("div", "ca-domain-list");
			const domains = state.standing.domains || {};
			let anyDomain = false;
			for (const dom of CANONICAL_DOMAINS) {
				const st = domains[dom];
				if (!st || !st.attempted) continue;
				anyDomain = true;
				const row = el("div", "ca-domain-row");
				const pct = Math.round((Number(st.solved || 0) / Math.max(1, Number(st.attempted || 1))) * 100);
				const header = el("div", "ca-domain-head");
				const top = el("div", "ca-domain-top");
				top.append(
					el("span", "ca-domain-name", dom),
					el("span", "ca-muted ca-tabular", `${st.solved}/${st.attempted} (${pct}%) · avg CF ${st.avg_solved_difficulty || "—"}`),
				);
				const bar = el("div", "ca-domain-track");
				const fill = el("div", "ca-domain-fill");
				fill.style.width = `${pct}%`;
				bar.append(fill);
				const leftCol = el("div", "ca-domain-info");
				leftCol.append(top, bar);

				const drillWrap = el("div", "ca-domain-action");
				mountActionButton(
					ctx,
					drillWrap,
					"Drill",
					async () => {
						await openNewArenaSession(ctx, {
							title: `Drill: ${dom}`,
							openingPrompt: `Stage a rated ${dom} drill calibrated to my current Arena standing and recent performance.`,
						});
					},
					domainsScope.signal,
					{ variant: "ghost", size: "xs" },
				);

				header.append(leftCol, drillWrap);
				row.append(header);
				domList.append(row);
			}
			if (!anyDomain) {
				domList.append(el("p", "ca-muted", "No rated domain attempts recorded yet."));
			}
			domainsCard.append(domList);
		}

		function renderHistory(state: ArenaDashboardState) {
			historyScope.abort();
			historyScope = lifetime(signal);

			roundsCard.replaceChildren();
			roundsCard.append(el("h2", "ca-panel-title", "Recent ThemeCP Rounds"));
			const rounds = state.ladderRounds || [];
			if (!rounds.length) {
				roundsCard.append(el("p", "ca-muted", "No ThemeCP rounds recorded yet."));
			} else {
				const tblWrap = el("div", "ca-table-wrap");
				const tbl = el("table", "ca-table");
				const thead = el("thead");
				const hr = el("tr");
				for (const h of ["Round", "Level", "Theme", "Solved", "Status"]) hr.append(el("th", undefined, h));
				thead.append(hr);
				tbl.append(thead);
				const tbody = el("tbody");
				for (const r of rounds.slice(0, 8)) {
					const tr = el("tr");
					const solvedCount = Array.isArray(r.problems)
						? r.problems.filter((p: { solved?: unknown }) => Boolean(p?.solved)).length
						: Array.isArray(r.solved_in_time)
							? r.solved_in_time.length
							: 0;
					const totalCount = Array.isArray(r.problems) ? r.problems.length : 4;
					const statusCell = el("td");
					if (r.ak) {
						mountNativeBadge(ctx, statusCell, "AK ↑", "var(--lh-success)", historyScope.signal);
					} else if (r.closed_at) {
						mountNativeBadge(ctx, statusCell, "Drop ↓", undefined, historyScope.signal);
					} else {
						mountNativeBadge(ctx, statusCell, "Open", "var(--lh-accent)", historyScope.signal);
					}
					tr.append(
						el("td", "ca-tabular", String(r.round_id || "—")),
						el("td", "ca-tabular", `L${r.level ?? "?"}`),
						el("td", undefined, String(r.theme || "mixed")),
						el("td", "ca-tabular", `${solvedCount}/${totalCount}`),
						statusCell,
					);
					tbody.append(tr);
				}
				tbl.append(tbody);
				tblWrap.append(tbl);
				roundsCard.append(tblWrap);
			}

			attemptsCard.replaceChildren();
			attemptsCard.append(el("h2", "ca-panel-title", "Recent Arena Attempts"));
			const recent = Array.isArray(state.standing?.recent_history)
				? [...state.standing.recent_history].reverse()
				: [];
			if (!recent.length) {
				attemptsCard.append(el("p", "ca-muted", "No Arena submissions recorded yet."));
			} else {
				const tblWrap = el("div", "ca-table-wrap");
				const tbl = el("table", "ca-table");
				const thead = el("thead");
				const hr = el("tr");
				for (const h of ["Problem", "Diff", "Verdict", "Time", "Δ"]) hr.append(el("th", undefined, h));
				thead.append(hr);
				tbl.append(thead);
				const tbody = el("tbody");
				for (const e of recent.slice(0, 8)) {
					const tr = el("tr");
					const vCell = el("td");
					const verdict = String(e.verdict || "—");
					mountNativeBadge(ctx, vCell, verdict, verdictBadgeColor(verdict), historyScope.signal);
					const sign = Number(e.rating_delta || 0) >= 0 ? "+" : "";
					tr.append(
						el("td", "ca-cell-wrap", String(e.title || e.problem_id || "—")),
						el("td", "ca-tabular", typeof e.difficulty === "number" ? `CF ${e.difficulty}` : "—"),
						vCell,
						el("td", "ca-tabular", formatClock(Number(e.duration_seconds || 0))),
						el("td", "ca-tabular", e.rated ? `${sign}${e.rating_delta || 0}` : "unrated"),
					);
					tbody.append(tr);
				}
				tbl.append(tbody);
				tblWrap.append(tbl);
				attemptsCard.append(tblWrap);
			}
		}

		function renderEnvWarning(state: ArenaDashboardState) {
			envScope.abort();
			envScope = lifetime(signal);
			envWarnSlot.replaceChildren();

			const failing = (state.environment?.items || []).filter((item) => !item.ok);
			if (failing.length === 0) return;

			const banner = el("section", "ca-panel ca-env-warning");
			const row = el("div", "ca-env-row");
			const textCol = el("div", "ca-env-warning-text");
			textCol.append(el("strong", undefined, "Environment attention needed: "));
			textCol.append(
				el("span", "ca-muted", failing.map((f) => `${f.label} (${f.detail})`).join(" · ")),
			);
			row.append(textCol);

			const actions = el("div", "ca-actions");
			const needsPointerSync = failing.some((f) => f.id === "pointer") && state.settings.pointerEnabled;
			if (needsPointerSync) {
				mountActionButton(
					ctx,
					actions,
					"Sync ~/.pi-arena-root",
					async () => {
						const res = await ctx.call<{ state: ArenaDashboardState }>("sync-pointer");
						if (!signal.aborted && res?.state) publishState(res.state);
					},
					envScope.signal,
					{ variant: "outline", size: "xs" },
				);
			}
			mountActionButton(
				ctx,
				actions,
				"Check Settings",
				() => ctx.app.openSettings(),
				envScope.signal,
				{ variant: "ghost", size: "xs" },
			);
			row.append(actions);
			banner.append(row);
			envWarnSlot.append(banner);
		}

		observe((state, loadError) => {
			if (signal.aborted) return;
			if (loadError) {
				errorEl.textContent = loadError;
				return;
			}
			if (!state) return;
			errorEl.textContent = "";
			renderPrimaryCta(state);
			renderActiveBanner(state);
			renderKpiStrip(state);
			chartHandle.update(state.ratingSeries || []);
			renderLadder(state);
			renderDomains(state);
			renderHistory(state);
			renderEnvWarning(state);
		}, signal);

		return () => {
			stopClock();
			scope.abort();
			root.remove();
		};
	};
}
