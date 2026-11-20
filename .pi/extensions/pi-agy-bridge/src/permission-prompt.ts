// Interactive TUI prompt for blocked native Antigravity ACP tool calls.

import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { BlockSource, PermissionBlockInfo } from "./rbac-permission.ts";

export type BlockedToolChoice =
	| { action: "allow" }
	| { action: "chip_in" };

interface PromptOption {
	label: string;
	description: string;
	action: "allow" | "chip_in";
}

interface SharedUiLock {
	withLock<T>(fn: () => Promise<T>): Promise<T>;
}

function getSharedUiLock(): SharedUiLock {
	const g = globalThis as { __piSharedUiLock?: SharedUiLock };
	if (!g.__piSharedUiLock) {
		let tail = Promise.resolve();
		g.__piSharedUiLock = {
			withLock<T>(fn: () => Promise<T>): Promise<T> {
				const prev = tail;
				let release!: () => void;
				tail = new Promise<void>((resolve) => {
					release = resolve;
				});
				return prev.then(
					async () => {
						try {
							return await fn();
						} finally {
							release();
						}
					},
					async () => {
						try {
							return await fn();
						} finally {
							release();
						}
					},
				);
			},
		};
	}
	return g.__piSharedUiLock;
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const innerWidth = Math.max(10, width - indent.length);
	for (const wrapped of wrapTextWithAnsi(text, innerWidth)) {
		lines.push(truncateToWidth(`${indent}${wrapped}`, width));
	}
}

export function formatBlockSourceLabel(source: BlockSource): string {
	if (source === "rbac") return "[RBAC Blocked]";
	if (source === "notebook") return "[Notebook Guard Blocked]";
	return "[Permission Blocked]";
}

export function buildBlockedPromptOptions(_source?: BlockSource): PromptOption[] {
	return [
		{
			label: "Allow this once",
			description: "Permit just this native ACP tool call to proceed.",
			action: "allow",
		},
		{
			label: "Let me chip in",
			description: "Deny cleanly and return to the input bar without writing to Obsidian.",
			action: "chip_in",
		},
	];
}

/**
 * Pause and ask the user how to resolve a blocked native ACP tool call.
 * Uses Pi's shared UI lock so concurrent modal extensions cannot collide.
 */
export async function promptForBlockedTool(
	ctx: any,
	block: PermissionBlockInfo,
): Promise<BlockedToolChoice> {
	if (!ctx?.hasUI || typeof ctx?.ui?.custom !== "function") {
		return { action: "chip_in" };
	}

	const options = buildBlockedPromptOptions(block.source);
	const sourceLabel = formatBlockSourceLabel(block.source);

	return getSharedUiLock().withLock(async () => {
		const choice = await ctx.ui.custom<BlockedToolChoice>((
			tui: any,
			theme: any,
			_kb: any,
			done: (result: BlockedToolChoice) => void,
		) => {
			let selectedIndex = 0;
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;

			const refresh = () => {
				cachedLines = undefined;
				tui.requestRender();
			};

			const handleInput = (data: string) => {
				if (matchesKey(data, Key.up)) {
					selectedIndex = (selectedIndex - 1 + options.length) % options.length;
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					selectedIndex = (selectedIndex + 1) % options.length;
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
					done({ action: options[selectedIndex]!.action });
					return;
				}
				if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
					done({ action: "chip_in" });
					return;
				}

				// Number hotkeys 1..options.length for fast selection
				if (/^[1-9]$/.test(data)) {
					const idx = Number.parseInt(data, 10) - 1;
					if (idx >= 0 && idx < options.length) {
						selectedIndex = idx;
						done({ action: options[idx]!.action });
					}
				}
			};

			const render = (width: number): string[] => {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));

				add(theme.fg("warning", "─".repeat(width)));
				const toolMeta =
					block.toolName !== block.mappedTool
						? `${block.toolName} (${block.mappedTool})`
						: block.toolName;
				addWrapped(lines, `${theme.fg("warning", sourceLabel)} ${theme.fg("accent", toolMeta)}`, width, " ");
				if (block.target) {
					addWrapped(lines, theme.fg("muted", `Target: ${block.target}`), width, " ");
				}
				addWrapped(lines, theme.fg("text", `Reason: ${block.reason}`), width, " ");
				lines.push("");

				for (let i = 0; i < options.length; i++) {
					const opt = options[i]!;
					const isSelected = i === selectedIndex;
					const prefix = isSelected ? theme.fg("accent", "> ") : "  ";
					const title = `${i + 1}. ${opt.label}`;
					add(`${prefix}${isSelected ? theme.fg("accent", title) : theme.fg("text", title)}`);
					addWrapped(lines, theme.fg("dim", opt.description), width, "     ");
				}

				lines.push("");
				add(theme.fg("dim", " ↑↓ navigate • 1-" + options.length + "/Enter choose • Esc chip in"));

				add(theme.fg("warning", "─".repeat(width)));
				cachedLines = lines;
				cachedWidth = width;
				return lines;
			};

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
				},
				handleInput,
			};
		});

		return choice ?? { action: "chip_in" };
	});
}
