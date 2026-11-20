# Curriculum Ledger / Brain Workbench

Personal learning and competitive programming workbench pairing an adaptive Next.js + Electron harness (`learnharness/`) with an external Neovim coding arena (`nvim/`). Built on top of upstream [LearnHarness](https://github.com/amosblomqvist/learnharness) (`AGPL-3.0`, see `learnharness/LICENSE`).

---

## Audit & UI/UX Agenda

Functionally, the backend, agent orchestration, SSE streaming, ThemeCP ladder, local hidden-test runner, and Neovim bridge work end-to-end. However, because this was evolved iteratively by a backend engineer, the interface still feels closer to a **developer console** than a calm, cohesive workspace built for multi-hour daily sessions.

**Primary goal of this audit:** Critique and elevate the product design, information hierarchy, visual warmth/craft, and interaction ergonomics without breaking the underlying agent/SSE/plugin contracts.

### Target UX Direction
- **One unified, maintainable design system — not three disconnected themes:** Keep a shared spatial grid, focus/keyboard grammar (`Esc` layer stack, global shortcuts), and the 12-token theme architecture (`Settings → Appearance`), while subtly shifting **mode atmosphere** between workflows:
  - **Teaching (`Prober → PlanTree → Teacher`)**: Calm, low-glare reading canvas with comfortable reading measure and typographic rhythm, clear separation between explanation and active input, gentle transitions on the morphing dock and phase breaks, and a more tactile canvas feel on the Drawing Pad.
  - **Practice**: Quiet, distraction-free card focus with crisp progression and clear reveal states.
  - **Competitive Arena**: Higher information density where it helps (`tabular-nums` clocks, rating progression, verdicts, domain mastery, and ThemeCP round tables), crisp status signals (`AC` / `WA` / `TLE` / `SUBMITTED`), and zero-distraction transitions during live rounds.
- **Tactile restraint & non-intrusive feedback:** Evaluate cognitive load, visual hierarchy, narrow-viewport responsiveness (e.g., sidebar auto-collapse `< 928px`), and optional subtle/mute-able feedback cues without adding heavy dependencies or fighting existing UI primitives.
- **Preserve core architectural contracts:** Keep backend SSE event contracts, plugin lifecycle boundaries, `learnharness/components/interaction-layers.tsx`, and `learnharness/components/dock-morph.ts` intact across any visual refactor.

---

## Repository Map

| Path | Status | What It Contains |
| --- | --- | --- |
| `learnharness/` | **Active (Primary App)** | Next.js 16 + React 19 workbench, core plugins (`coding-questions`, `competitive-arena`, `drawing-pad`, `flashcards`, `rich-code-blocks`), Antigravity ACP bridge, and tests. |
| `nvim/` | **Active (External Editor)** | Neovim configuration including the Competitive Arena Lua client (`nvim/lua/competitive/arena/`), problem card, sample/hidden runner, timer, and verdict submission. |
| `.pi/` | **Legacy Reference** | Previous CLI/extension harness (`arena`, `catalog`, `ladder`, `curriculum`, extensions) being superseded by `learnharness/`. Kept temporarily as reference. |
| `*.md` (repo root) | **Architecture Notes** | Design notes (`brain-marry-learnharness.md`, `brain-revamp.md`, `learnharness-working-and-brain-adoption.md`, `system-architecture-audit.md`) documenting how the workbench and Arena integration were designed. |

---

## Key UI/UX Audit Surfaces

- **Global tokens, typography & app shell**: `learnharness/app/globals.css`, `learnharness/components/sidebar.tsx`, `learnharness/components/stats-bar.tsx`, `learnharness/components/home.tsx`
- **Teaching, Practice, Graph & ACP permissions**: `learnharness/components/chat.tsx`, `learnharness/components/dock-morph.ts`, `learnharness/components/interaction-layers.tsx`, `learnharness/components/acp-permission-prompt.tsx`, `learnharness/components/graph-view.tsx`
- **Settings & Plugin Chrome**: `learnharness/components/settings/`
- **Competitive Arena Plugin**: `learnharness/plugins/competitive-arena/src/{dashboard-view.ts,rating-chart.ts,result-card.ts,settings-view.ts,styles.css}`
- **Interactive Learning Plugins**: `learnharness/plugins/drawing-pad/`, `learnharness/plugins/flashcards/`, `learnharness/plugins/coding-questions/`
- **External Neovim Arena UI**: `nvim/lua/competitive/arena/`

---

## Quick Start (`learnharness/`)

```bash
cd learnharness
npm ci
npm run plugins:setup
npm run dev        # http://localhost:3000
```

- **Local data & keys:** Runtime storage defaults to `learnharness/data` and `learnharness/auth.json` (both gitignored), or can be pointed elsewhere via `LH_DATA_DIR` and `LH_AUTH_FILE`.
- **Checks:** `npm run typecheck`, `npm run lint`, and `npm test`.
