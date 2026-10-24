/**
 * visual-tools
 *
 * A self-contained pi extension that registers custom subagent tools:
 *
 *   • write_mermaid / edit_mermaid / render_mermaid
 *       (tools/mermaid_tools.ts) — the mermaid-maker's authoring loop: write a
 *       Mermaid source, exact-match edit it, render whatever is currently in
 *       the managed file to a PNG (via the bundled @mermaid-js/mermaid-cli and
 *       an installed Chrome), return the PNG inline for inspection, and — when
 *       given `save_as` — publish it into <cwd>/viz with a unique name.
 *   • write_svg / edit_svg / render_svg
 *       (tools/svg_tools.ts) — the svg-maker's authoring loop: same shape, but
 *       renders hand-written SVG to a PNG via rsvg-convert (fallback: magick).
 *
 * ── How registration reaches subagent runners ───────────────────────────────
 * 1. Standard Pi Runtime (for pi-herdr-subagents and direct session usage):
 *    Directly invokes tool factory functions on the active `pi` ExtensionAPI
 *    instance so tools exist in the global tool catalog.
 *
 * 2. Legacy `interactive-subagents` hook:
 *    Registers tool name → file path mappings on `globalThis.__pi_interactive_subagents`
 *    during `session_start` for child subagent runners that isolate tools via `-e <path>`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import registerMermaidTools from "./tools/mermaid_tools.js"
import registerSvgTools from "./tools/svg_tools.js"

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url))
const MERMAID_TOOLS = path.join(EXT_DIR, "tools", "mermaid_tools.ts")
const SVG_TOOLS = path.join(EXT_DIR, "tools", "svg_tools.ts")

interface InteractiveSubagentsApi {
  registerToolExtension: (name: string, extensionPath: string) => void
}

function registerToolExtensions(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (globalThis as any).__pi_interactive_subagents as InteractiveSubagentsApi | undefined
  if (!api?.registerToolExtension) return // interactive-subagents not loaded — no-op

  for (const [name, toolPath] of [
    ["write_mermaid", MERMAID_TOOLS],
    ["edit_mermaid", MERMAID_TOOLS],
    ["render_mermaid", MERMAID_TOOLS],
    ["write_svg", SVG_TOOLS],
    ["edit_svg", SVG_TOOLS],
    ["render_svg", SVG_TOOLS],
  ] as const) {
    if (!fs.existsSync(toolPath)) continue
    try {
      api.registerToolExtension(name, toolPath)
    } catch {
      // Already registered under a different path, or re-registered — ignore.
    }
  }
}

export default function (pi: ExtensionAPI) {
  // 1. Direct tool registration into active Pi runtime (pi-herdr-subagents)
  if (typeof registerMermaidTools === "function") {
    registerMermaidTools(pi)
  }
  if (typeof registerSvgTools === "function") {
    registerSvgTools(pi)
  }

  // 2. Legacy subagent path registration (interactive-subagents)
  pi.on("session_start", async () => {
    registerToolExtensions()
  })
}
