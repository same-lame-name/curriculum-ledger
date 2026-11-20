import type { PluginFrontendContext, PluginToolRenderProps } from "learnharness-plugin-api";
import {
	el,
	formatClock,
	mountActionButton,
	mountNativeBadge,
	stashSessionOpeningPrompt,
	verdictBadgeColor,
} from "./frontend-utils.ts";
import { type ArenaResultPayload, type ArenaResultProblem, errorMessage } from "./types.ts";

function isArenaResultPayload(value: unknown): value is ArenaResultPayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const rec = value as Record<string, unknown>;
	return typeof rec.title === "string" && Array.isArray(rec.problems) && typeof rec.rating_before === "number";
}

function renderStagedCard(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	props: PluginToolRenderProps,
): void {
	const signal = props.signal;
	const details = (props.result?.details || props.output) as
		| {
				status?: string;
				error?: string;
				title?: string;
				purpose?: string;
				gradingPolicy?: string;
				timerMode?: string;
				totalTimeBudgetSeconds?: number;
				practiceDir?: string;
				autoLaunched?: boolean;
				launchNote?: string;
				problems?: { id: string; title: string; difficulty?: number; domain?: string; hasTests?: boolean }[];
		  }
		| undefined;

	const card = el("div", "ca-card ca-staged-card");
	container.append(card);

	if (details?.status === "unavailable" || details?.error) {
		card.append(el("div", "ca-card-title", "Arena staging failed"));
		card.append(el("p", "ca-error", details.error || props.errorText || "Unavailable"));
		return;
	}

	const inputRec = (props.input && typeof props.input === "object" ? props.input : {}) as {
		title?: string;
		purpose?: string;
		problems?: { id?: string; title?: string }[];
	};

	const title = details?.title || inputRec.title || "Arena Session";
	const header = el("div", "ca-card-header");
	const titleGroup = el("div", "ca-card-title-group");
	titleGroup.append(el("span", "ca-card-title", title));
	header.append(titleGroup);

	const pills = el("div", "ca-pills");
	if (details?.purpose || inputRec.purpose) {
		mountNativeBadge(ctx, pills, String(details?.purpose || inputRec.purpose), "var(--lh-accent)", signal);
	}
	if (details?.timerMode && details.timerMode !== "stopwatch" && details.totalTimeBudgetSeconds) {
		mountNativeBadge(ctx, pills, `Budget ${formatClock(details.totalTimeBudgetSeconds)}`, undefined, signal);
	} else {
		mountNativeBadge(ctx, pills, "Waiting for editor", undefined, signal);
	}
	header.append(pills);
	card.append(header);

	const probList = details?.problems || inputRec.problems || [];
	if (probList.length > 0) {
		const listEl = el("ul", "ca-problem-list");
		for (const p of probList) {
			const li = el("li", "ca-problem-item");
			li.append(el("strong", "ca-problem-name", p.title || p.id || "Problem"));
			if (p.id) li.append(el("code", "ca-code-inline", `${p.id}.cpp`));
			if (typeof (p as { difficulty?: number }).difficulty === "number") {
				mountNativeBadge(ctx, li, `CF ${(p as { difficulty?: number }).difficulty}`, undefined, signal);
			}
			if ((p as { hasTests?: boolean }).hasTests) {
				mountNativeBadge(ctx, li, "Hidden tests", "var(--lh-success)", signal);
			}
			listEl.append(li);
		}
		card.append(listEl);
	}

	const keyHint = el(
		"div",
		"ca-key-strip",
		"Neovim keys: <leader>ma dashboard · <leader>mc card · <leader>mt samples · <leader>mj hidden judge · <leader>mh hint · <leader>mv submit/verdict",
	);
	card.append(keyHint);

	const actions = el("div", "ca-card-actions");
	const statusMsg = el("span", "ca-muted ca-inline-status", details?.launchNote || "");
	mountActionButton(
		ctx,
		actions,
		"Launch Editor",
		async () => {
			statusMsg.textContent = "Launching…";
			try {
				const res = await ctx.call<{ launched: boolean; message: string }>("launch-editor");
				if (!signal.aborted) statusMsg.textContent = res.message;
			} catch (err) {
				if (!signal.aborted) statusMsg.textContent = errorMessage(err);
			}
		},
		signal,
	);
	mountActionButton(
		ctx,
		actions,
		"Open Arena Dashboard",
		() => {
			ctx.app.openView("arena-dashboard");
		},
		signal,
		{ variant: "ghost" },
	);
	actions.append(statusMsg);
	card.append(actions);
}

function renderTimeBar(p: ArenaResultProblem): HTMLElement | null {
	const total = Math.max(0, Number(p.duration_seconds || 0));
	if (total <= 0 || typeof p.thinking_seconds !== "number" || !Number.isFinite(p.thinking_seconds)) {
		return null;
	}
	const think = Math.max(0, Math.min(total, Math.round(p.thinking_seconds)));
	const code = Math.max(0, total - think);
	const thinkPct = Math.round((think / total) * 100);

	const wrap = el("div", "ca-time-bar-wrap");
	const labelRow = el("div", "ca-time-bar-labels ca-tabular");
	labelRow.append(el("span", undefined, `Thinking ${formatClock(think)} (${thinkPct}%)`));
	labelRow.append(el("span", undefined, `Coding & Debug ${formatClock(code)} (${100 - thinkPct}%)`));
	wrap.append(labelRow);

	const track = el("div", "ca-time-bar-track");
	const fill = el("div", "ca-time-bar-think");
	fill.style.width = `${thinkPct}%`;
	track.append(fill);
	wrap.append(track);
	return wrap;
}

function renderCompletedResultCard(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	props: PluginToolRenderProps,
): void {
	const signal = props.signal;
	const data = props.output;

	// Host PluginWorkerResultSurface already draws rounded-xl border bg-card p-4 around card results.
	if (!isArenaResultPayload(data)) {
		const fallbackFlat = el("div", "ca-result-flat");
		container.append(fallbackFlat);
		if (props.errorText) {
			fallbackFlat.append(el("p", "ca-error", props.errorText));
			return;
		}
		const mdSlot = el("div");
		fallbackFlat.append(mdSlot);
		const text = typeof data === "string" ? data : JSON.stringify(data ?? {}, null, 2);
		ctx.ui.mountMarkdown(mdSlot, { text }, { signal });
		return;
	}

	const root = el("div", "ca-result-flat ca-result-card");
	container.append(root);

	const header = el("div", "ca-card-header");
	const titleWrap = el("div", "ca-card-title-group");
	titleWrap.append(el("span", "ca-card-title", data.title));
	header.append(titleWrap);

	const deltaSign = data.rating_delta >= 0 ? "+" : "";
	const deltaColor = data.rating_delta > 0 ? "var(--lh-success)" : data.rating_delta < 0 ? "var(--lh-error)" : undefined;
	const metaRow = el("div", "ca-pills");
	mountNativeBadge(ctx, metaRow, `${data.purpose} · ${data.grading_policy}`, "var(--lh-accent)", signal);
	mountNativeBadge(
		ctx,
		metaRow,
		`CF ${data.rating_before} → ${data.rating_after} (${deltaSign}${data.rating_delta})`,
		deltaColor,
		signal,
	);
	header.append(metaRow);
	root.append(header);

	for (const p of data.problems) {
		const pCard = el("section", "ca-result-problem");
		const pHead = el("div", "ca-result-problem-head");
		const pLeft = el("div", "ca-problem-title-row");
		if (p.url) {
			const link = el("a", "ca-link", p.title);
			link.href = p.url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			pLeft.append(link);
		} else {
			pLeft.append(el("strong", "ca-problem-name", p.title));
		}
		pLeft.append(el("code", "ca-code-inline", p.id));
		if (p.difficulty) mountNativeBadge(ctx, pLeft, `CF ${p.difficulty}`, undefined, signal);
		if (p.domain) mountNativeBadge(ctx, pLeft, p.domain, undefined, signal);

		const pRight = el("div", "ca-pills");
		mountNativeBadge(ctx, pRight, p.verdict, verdictBadgeColor(p.verdict), signal);
		if (p.local_judge) {
			const lj = p.local_judge;
			const ok = (lj.verdict || "").toUpperCase() === "AC";
			mountNativeBadge(
				ctx,
				pRight,
				`Hidden ${lj.passed ?? 0}/${lj.total ?? 0}`,
				ok ? "var(--lh-success)" : "var(--lh-error)",
				signal,
			);
		}
		pHead.append(pLeft, pRight);
		pCard.append(pHead);

		const stats = el("div", "ca-stats-line ca-tabular");
		const budgetStr = p.budget_seconds > 0 ? ` / ${formatClock(p.budget_seconds)}` : "";
		const otStr = p.overtime_seconds > 0 ? ` (+${formatClock(p.overtime_seconds)} OT)` : "";
		stats.textContent = `Time: ${formatClock(p.duration_seconds)}${budgetStr}${otStr} · Wrong attempts: ${p.wrong_attempts} · Hints: ${p.hints_used}`;
		pCard.append(stats);

		const bar = renderTimeBar(p);
		if (bar) pCard.append(bar);

		if (p.approach) {
			const box = el("div", "ca-note-box");
			box.append(el("span", "ca-note-label", "Approach: "), el("span", undefined, p.approach));
			pCard.append(box);
		}
		if (p.reflection) {
			const box = el("div", "ca-note-box");
			box.append(el("span", "ca-note-label", "Reflection: "), el("span", undefined, p.reflection));
			pCard.append(box);
		}

		if (p.final_code && p.final_code.trim()) {
			const details = el("details", "ca-code-details");
			details.append(el("summary", undefined, `Final code (${p.id}.cpp)`));
			const pre = el("pre", "ca-code-block");
			pre.textContent = p.final_code.trim();
			details.append(pre);
			pCard.append(details);
		}

		if (Array.isArray(p.attempt_diffs) && p.attempt_diffs.length > 0) {
			const diffDetails = el("details", "ca-code-details");
			diffDetails.append(el("summary", undefined, `Attempt diffs (${p.attempt_diffs.length})`));
			for (const d of p.attempt_diffs) {
				const sub = el("div", "ca-diff-item");
				sub.append(el("div", "ca-muted", `${d.from} → ${d.to}`));
				const pre = el("pre", "ca-code-block");
				pre.textContent = d.diff;
				sub.append(pre);
				diffDetails.append(sub);
			}
			pCard.append(diffDetails);
		}

		root.append(pCard);
	}
}

export function registerArenaToolRenderers(ctx: PluginFrontendContext): () => void {
	const offArena = ctx.registerToolRenderer({
		toolName: "arena_run",
		backgroundPresentation: "card",
		mount(container, props) {
			container.replaceChildren();
			if (props.background) {
				renderCompletedResultCard(ctx, container, props);
			} else {
				renderStagedCard(ctx, container, props);
			}
			return () => {
				container.replaceChildren();
			};
		},
	});

	const offBridge = ctx.registerToolRenderer({
		toolName: "bridge_to_teaching",
		mount(container, props) {
			container.replaceChildren();
			const payload = (props.result?.details || props.output) as
				| {
						id?: string;
						title?: string;
						openingPrompt?: string;
						propositionIds?: string[];
						error?: string;
				  }
				| undefined;

			const card = el("div", "ca-card ca-bridge-card");
			container.append(card);

			if (payload?.error || !payload?.id) {
				card.append(el("div", "ca-card-title", "Teaching Bridge"));
				card.append(el("p", "ca-error", payload?.error || props.errorText || "Session link unavailable."));
				return () => container.replaceChildren();
			}

			const header = el("div", "ca-card-header");
			header.append(el("span", "ca-card-title", `Teaching Session Ready: ${payload.title || "Concept Review"}`));
			if (Array.isArray(payload.propositionIds) && payload.propositionIds.length > 0) {
				mountNativeBadge(ctx, header, `${payload.propositionIds.length} linked nodes`, "var(--lh-accent)", props.signal);
			}
			card.append(header);

			const actions = el("div", "ca-card-actions");
			mountActionButton(
				ctx,
				actions,
				"Open Teaching Session →",
				() => {
					if (payload.openingPrompt) {
						stashSessionOpeningPrompt(payload.id!, payload.openingPrompt);
					}
					ctx.app.openSession(payload.id!);
				},
				props.signal,
				{ variant: "default" },
			);
			card.append(actions);
			return () => container.replaceChildren();
		},
	});

	return () => {
		offBridge();
		offArena();
	};
}
