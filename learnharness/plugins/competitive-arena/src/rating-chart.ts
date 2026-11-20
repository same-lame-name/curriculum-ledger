import type { RatingSeriesPoint } from "./types.ts";

export type RatingChartWindow = 25 | 50 | 100 | "all";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 760;
const VIEW_H = 216;
const PAD = { top: 14, right: 16, bottom: 26, left: 48 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;
const TIER_MARKS = [1200, 1400, 1600, 1900, 2100, 2400];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		node.setAttribute(k, String(v));
	}
	return node;
}

function div(className: string, text?: string): HTMLDivElement {
	const el = document.createElement("div");
	el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function span(className: string, text?: string): HTMLSpanElement {
	const el = document.createElement("span");
	el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function formatReadout(p: RatingSeriesPoint): string {
	const diff = p.difficulty !== null ? `CF ${p.difficulty}` : "Unrated diff";
	const sign = p.ratingDelta >= 0 ? "+" : "";
	return `#${p.idx} · ${p.title} (${diff}) · ${p.verdict} → CF ${p.ratingAfter} (${sign}${p.ratingDelta})`;
}

export interface RatingChartHandle {
	update(points: readonly RatingSeriesPoint[]): void;
	dispose(): void;
}

/**
 * Performant zero-dependency SVG rating progression chart matching LearnHarness's
 * native token system. Defaults to last 50 rated attempts with zoom out/in toggles.
 */
export function mountRatingChart(
	container: HTMLElement,
	initialPoints: readonly RatingSeriesPoint[],
	signal: AbortSignal,
): RatingChartHandle {
	let allPoints: readonly RatingSeriesPoint[] = initialPoints;
	let windowSize: RatingChartWindow = 50;

	const wrap = div("ca-chart-wrap");
	const header = div("ca-chart-head");
	const titleGroup = div("ca-chart-title-group");
	const titleEl = span("ca-panel-title", "Rating Progression");
	const readoutEl = span("ca-chart-readout ca-muted");
	titleGroup.append(titleEl, readoutEl);

	const zoomBar = div("ca-chart-zoom");
	zoomBar.setAttribute("role", "group");
	zoomBar.setAttribute("aria-label", "Rating chart window");

	const windows: Array<{ key: RatingChartWindow; label: string }> = [
		{ key: 25, label: "25" },
		{ key: 50, label: "50" },
		{ key: 100, label: "100" },
		{ key: "all", label: "All" },
	];
	const zoomButtons = new Map<RatingChartWindow, HTMLButtonElement>();
	for (const w of windows) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ca-chart-zoom-btn";
		btn.textContent = w.label;
		btn.setAttribute("aria-pressed", String(w.key === windowSize));
		btn.addEventListener(
			"click",
			() => {
				if (windowSize === w.key || signal.aborted) return;
				windowSize = w.key;
				for (const [k, b] of zoomButtons) {
					b.setAttribute("aria-pressed", String(k === windowSize));
					b.classList.toggle("is-active", k === windowSize);
				}
				render();
			},
			{ signal },
		);
		if (w.key === windowSize) btn.classList.add("is-active");
		zoomButtons.set(w.key, btn);
		zoomBar.append(btn);
	}

	header.append(titleGroup, zoomBar);

	const stage = div("ca-chart-stage");
	wrap.append(header, stage);
	container.replaceChildren(wrap);

	function render() {
		stage.replaceChildren();
		const slice = windowSize === "all" ? [...allPoints] : allPoints.slice(-windowSize);
		if (slice.length === 0) {
			readoutEl.textContent = "";
			stage.append(div("ca-chart-empty ca-muted", "No rated Arena solves recorded yet."));
			return;
		}

		readoutEl.textContent = formatReadout(slice[slice.length - 1]!);

		let rawMin = slice[0]!.ratingAfter;
		let rawMax = slice[0]!.ratingAfter;
		for (const p of slice) {
			if (p.ratingAfter < rawMin) rawMin = p.ratingAfter;
			if (p.ratingAfter > rawMax) rawMax = p.ratingAfter;
		}
		if (rawMax - rawMin < 80) {
			const mid = Math.round((rawMin + rawMax) / 2);
			rawMin = mid - 45;
			rawMax = mid + 45;
		}
		const yMin = Math.floor((rawMin - 25) / 50) * 50;
		const yMax = Math.ceil((rawMax + 25) / 50) * 50;
		const ySpan = Math.max(50, yMax - yMin);

		const xFor = (i: number): number =>
			slice.length === 1 ? PAD.left + PLOT_W / 2 : PAD.left + (i / (slice.length - 1)) * PLOT_W;
		const yFor = (val: number): number => PAD.top + (1 - (val - yMin) / ySpan) * PLOT_H;

		const svg = svgEl("svg", {
			viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
			class: "ca-chart-svg",
			role: "img",
			"aria-label": "Arena rating progression chart",
		});

		// Horizontal tier / bound gridlines
		const ticks = new Set<number>([yMin, yMax]);
		for (const tier of TIER_MARKS) {
			if (tier > yMin + 15 && tier < yMax - 15) ticks.add(tier);
		}
		const sortedTicks = [...ticks].sort((a, b) => a - b);
		for (const tick of sortedTicks) {
			const y = yFor(tick);
			svg.append(
				svgEl("line", {
					x1: PAD.left,
					y1: y,
					x2: VIEW_W - PAD.right,
					y2: y,
					class: tick === yMin || tick === yMax ? "ca-chart-axis" : "ca-chart-grid",
				}),
			);
			const lbl = svgEl("text", {
				x: PAD.left - 8,
				y: y + 3.5,
				"text-anchor": "end",
				class: "ca-chart-label",
			});
			lbl.textContent = String(tick);
			svg.append(lbl);
		}

		// X-axis start/end labels
		const firstLbl = svgEl("text", {
			x: PAD.left,
			y: VIEW_H - 6,
			"text-anchor": "start",
			class: "ca-chart-label",
		});
		firstLbl.textContent = `#${slice[0]!.idx}`;
		svg.append(firstLbl);

		if (slice.length > 1) {
			const midIdx = Math.floor((slice.length - 1) / 2);
			const midLbl = svgEl("text", {
				x: xFor(midIdx),
				y: VIEW_H - 6,
				"text-anchor": "middle",
				class: "ca-chart-label",
			});
			midLbl.textContent = `#${slice[midIdx]!.idx}`;
			svg.append(midLbl);

			const lastLbl = svgEl("text", {
				x: VIEW_W - PAD.right,
				y: VIEW_H - 6,
				"text-anchor": "end",
				class: "ca-chart-label",
			});
			lastLbl.textContent = `#${slice[slice.length - 1]!.idx}`;
			svg.append(lastLbl);
		}

		// Area and line paths
		const coords = slice.map((p, i) => ({ x: xFor(i), y: yFor(p.ratingAfter), p }));
		const lineCmds = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`);
		if (coords.length >= 2) {
			const areaD = `${lineCmds.join(" ")} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} Z`;
			svg.append(svgEl("path", { d: areaD, class: "ca-chart-area" }));
			svg.append(svgEl("path", { d: lineCmds.join(" "), class: "ca-chart-line" }));
		} else {
			const only = coords[0]!;
			svg.append(
				svgEl("line", {
					x1: PAD.left,
					y1: only.y,
					x2: VIEW_W - PAD.right,
					y2: only.y,
					class: "ca-chart-grid",
				}),
			);
		}

		// Render point markers only when slice <= 60 to avoid SVG DOM bloat when zoomed out
		if (coords.length <= 60) {
			for (const c of coords) {
				svg.append(
					svgEl("circle", {
						cx: c.x.toFixed(1),
						cy: c.y.toFixed(1),
						r: 2.5,
						class: "ca-chart-dot",
					}),
				);
			}
		}

		// Single shared crosshair + focus dot (O(1) hover updates)
		const crosshair = svgEl("line", {
			x1: 0,
			y1: PAD.top,
			x2: 0,
			y2: PAD.top + PLOT_H,
			class: "ca-chart-crosshair",
			visibility: "hidden",
		});
		const focusDot = svgEl("circle", {
			cx: 0,
			cy: 0,
			r: 4.5,
			class: "ca-chart-focus-dot",
			visibility: "hidden",
		});
		svg.append(crosshair, focusDot);

		const updateHover = (idx: number | null) => {
			if (idx === null || !coords[idx]) {
				crosshair.setAttribute("visibility", "hidden");
				focusDot.setAttribute("visibility", "hidden");
				readoutEl.textContent = formatReadout(slice[slice.length - 1]!);
				return;
			}
			const c = coords[idx]!;
			crosshair.setAttribute("x1", c.x.toFixed(1));
			crosshair.setAttribute("x2", c.x.toFixed(1));
			crosshair.setAttribute("visibility", "visible");
			focusDot.setAttribute("cx", c.x.toFixed(1));
			focusDot.setAttribute("cy", c.y.toFixed(1));
			focusDot.setAttribute("visibility", "visible");
			readoutEl.textContent = formatReadout(c.p);
		};

		svg.addEventListener(
			"pointermove",
			(ev) => {
				const rect = svg.getBoundingClientRect();
				if (rect.width <= 0) return;
				const svgX = ((ev.clientX - rect.left) / rect.width) * VIEW_W;
				if (coords.length === 1) {
					updateHover(0);
					return;
				}
				const clamped = Math.max(0, Math.min(1, (svgX - PAD.left) / PLOT_W));
				const idx = Math.round(clamped * (coords.length - 1));
				updateHover(idx);
			},
			{ signal },
		);
		svg.addEventListener("pointerleave", () => updateHover(null), { signal });

		stage.append(svg);
	}

	render();

	return {
		update(nextPoints: readonly RatingSeriesPoint[]) {
			if (signal.aborted) return;
			allPoints = nextPoints;
			render();
		},
		dispose() {
			wrap.remove();
		},
	};
}
