# BrainHarness (LearnHarness + Competitive Arena) — Product Demo & Live Walkthrough

> **What this is:** A self-hosted, local-first Socratic tutor, living Knowledge Graph, and Competitive Programming training cockpit powered by LearnHarness, Antigravity (ACP), BYOK API providers (such as DeepSeek), and your native WSL Neovim Arena.

---

## 1. Booting the App in WSL

From your Ubuntu WSL terminal (Node `v24.14.0` on `PATH`), navigate to the integrated repository at `/home/dexter/playground/learn/learnharness`.

### Option A — Recommended Daily Launch (Fast Linux ext4 Data Directory)
Keeping `LH_DATA_DIR` on native Linux ext4 avoids Windows/OneDrive file-lock contention on session transcripts, Knowledge Graph ledgers, and Arena history:

```bash
export PATH="/home/dexter/.nvm/versions/node/v24.14.0/bin:$PATH"
export LH_DATA_DIR="$HOME/.local/share/learnharness"
cd /home/dexter/playground/learn/learnharness
npm run dev
```

Open **`http://localhost:3000`**.

### Option B — Production Build Launch (Instant Page & View Switching)
```bash
export PATH="/home/dexter/.nvm/versions/node/v24.14.0/bin:$PATH"
export LH_DATA_DIR="$HOME/.local/share/learnharness"
cd /home/dexter/playground/learn/learnharness
npm run build && npm start
```

### Option C — Clean-Room Fresh User Demo (`port 3005`)
Simulates a brand-new user with empty settings, zero data, and `.env` keys hidden (`LH_IGNORE_ENV_KEYS=1`):

```bash
npm run dev:fresh
# Preserves sessions between restarts under .fresh-data/:
bash scripts/dev-fresh.sh --keep
```

### Legacy `.pi/` Ledger Migration (Non-Destructive)
Because `/home/dexter/playground/learn/.pi` sits right beside `learnharness`, enabling **Competitive Arena** automatically imports any **missing** legacy ledgers (`arena/rating.json`, `arena/history.json`, `ladder/ladder.json`, `ladder/rounds.json`) into `<LH_DATA_DIR>/core-plugin-data/competitive-arena/` on first activation without ever overwriting newer LearnHarness records or modifying `.pi/`. You can also point explicitly via `export LH_LEGACY_PI_DIR=/home/dexter/playground/learn/.pi`.

---

## 2. First-Run Setup: Providers & Model Slots (`Ctrl+,` / `Cmd+,`)

When no model slots are configured yet, the home composer presents a **"Set up your models"** button and intercepts session creation with the guided **Setup Dialog** (without discarding your drafted prompt). You can also open **Settings** anytime via the sidebar **Settings** button or `Ctrl+,`.

### Step 2.1 — Connect Providers (**Settings → Providers**)
1. **Antigravity (ACP):**
   * Flip the **Antigravity (ACP)** toggle **ON** and click **Refresh models**.
   * Ensure the `agy` binary is installed and authenticated in your WSL shell.
   * Available Antigravity models and supported thinking levels are discovered dynamically over ACP (`agy acp`), with `$0` marginal API billing.
2. **API Key Providers (33 Supported Providers):**
   * Expand **DeepSeek** (recommended for your `Cheap` workhorse slot — background workers, graph extraction, flashcards, `lab`, `problem_grader`, `problem_recommender`).
   * Optionally expand **Deepgram** (`DEEPGRAM_API_KEY`) to unlock streaming voice dictation, or add search engine keys (Tavily / Brave) and custom endpoints.
   * *(Note: API keys defined in shell environment variables render read-only with their source status; stored keys stay masked server-side.)*

### Step 2.2 — Configure the Three Model Slots (**Settings → Agent → Models**)
* **Strong:** Main interactive session model (`+ Teaching`, `+ Practice`, `+ Arena`). Pick your preferred **Antigravity (ACP)** model and thinking level.
* **Cheap:** Background agent & extraction model (`Knowledge Extraction`, `Prober` support, `Flashcards`, `lab`, `problem_grader`, `problem_recommender`). Pick e.g. DeepSeek.
* **Vision:** Multimodal model used for Drawing Pad canvas captures and PDF reading.

> **QoL Touch:** Every chat session stamps its own model & thinking choice at birth from **Strong**, and lets you hot-swap that specific session in-place with **`Ctrl+K`** (Model selector) or **`Shift+Tab`** (Cycle thinking level) without altering global defaults.

---

## 3. Appearance, Themes & System Prompts

### Appearance & Live Theme Studio (**Settings → Appearance**)
Theme switches apply **live behind the Settings dialog** across both CSS tokens and the Knowledge Graph Canvas 2D renderer:
* **11 Built-In Palettes:**
  * *Dark:* `Default`, `Catppuccin Frappé`, `Catppuccin Macchiato`, `Catppuccin Mocha`, `Rosé Pine`, `Gruvbox Dark`, `NvChad Onedark`
  * *Light:* `Catppuccin Latte`, `Rosé Pine Dawn`, `Ivory`, `Pastel`
* **Custom Themes & Token Overrides:** Import or export complete themes as JSON, override any of the 12 color tokens (`Background`, `Accent`, `Surface`, `Bold`, `Border`, `Italic`, `Text`, `Inline code`, `Muted text`, `Error`, `Success`, `Warning`), and choose installed reading fonts or custom font sizes.

### Agent Tools, File Access & System Prompts (**Settings → Agent**)
* **Tools:** Independently toggle `research`, `demo`, `visual`, `pdf`, and configure file-access folder restrictions.
* **System Prompts Inspector:** View every prompt module grouped strictly by **Teacher → Prober → Practice → Arena → Shared**, see where shared fragments apply, and toggle file-backed user overrides under `<LH_DATA_DIR>/prompts/` (with no core prompt edits needed).

---

## 4. Core Plugins & Competitive Arena Setup

Open **Settings → Core plugins** (`Ctrl+,`) to manage the 5 official bundled plugins:

| Plugin | Purpose |
| --- | --- |
| **Competitive Arena** | ThemeCP ladder, offline + live-fetch CP catalog, isolated `lab` hidden tests, `problem_grader`, `problem_recommender`, Neovim Arena bridge, and `bridge_to_teaching` |
| **Coding Questions** | Inline code editor and local sample runner (`g++`, `python3`, `node`, etc.) for Teaching & Practice checks |
| **Drawing Pad** | Freehand canvas (with graph/question reference underlay) available across Teaching, Practice, and Arena |
| **Flashcards** | Native FSRS-6 spaced repetition generated from Knowledge Graph propositions or uploaded files |
| **Rich Code Blocks** | Enhanced syntax highlighting and TeX rendering |

### Configuring **Settings → Competitive Arena**
Once **Competitive Arena** is enabled, click its gear icon (or select **Competitive Arena** in Settings):
* **Environment Readiness Checklist:** Live checks for:
  * **Python 3** *(required)*
  * **`curl_cffi` (Browser Fetch)** *(recommended for Codeforces / AtCoder / CSES fetching)*
  * **`g++` compiler** *(for C++ local testing & Lab stress-testing)*
  * **Neovim (`nvim`)** *(for the external Neovim Arena editor)*
  * **Arena Pointer (`~/.pi-arena-root`)** *(syncs your Neovim Arena config to LearnHarness automatically; click **Sync Pointer Now** anytime)*
  * **Practice Workspace** *(defaults to `~/playground/contests/practice`, matching `nvim` & `arena.py`)*
* **External Editor Contract:**
  * **Manage `~/.pi-arena-root` pointer:** Keep `ON` to link unmodified Neovim automatically.
  * **Practice workspace directory:** Customize where `<problem_id>.cpp` files live.
  * **External editor launch command (optional):** Leave blank to attach Neovim manually, or provide a launch template supporting `{arenaDir}`, `{manifest}`, `{practiceDir}`, and `{file}` tokens + toggle **Auto-launch**.
  * **Test Editor Launch Command:** Verifies template expansion and launching immediately.
* **Housekeeping Retention (`1–365` days):** Controls TTL cleanup of expired staged catalog sets and inactive Lab test suites (active session tests are always protected).
* **Background Worker Model:** Toggle **Follow Cheap slot** (`ON` recommended) or pin a dedicated model + thinking level for `lab`, `problem_grader`, and `problem_recommender`.

---

## 5. The Knowledge Graph, Nodes & Reasoning Chains (`Ctrl+G`)

The Home screen (`/`) is a full-bleed interactive **Knowledge Graph** (`d3-force` layout + custom Canvas 2D engine):
* **Zero Idle GPU Drain:** Renders at 60fps during pan/zoom/hover, draws nothing when idle, reveals cluster hulls on zoom-out, and fades individual proposition labels in smoothly as you zoom in.
* **Search & Tuning:** Press **`Ctrl+F`** to filter nodes live, or click the canvas gear icon to tune node size, edge width, arrowhead length, label size, zoom threshold, and cluster labels.
* **Minimal Home Option:** Toggle **Graph rendering OFF** in **Settings → Graph** for a quiet typographic summary (`propositions`, `chains`, session counts) while keeping the full composer and Chain Table.
* **Reasoning Chains Overlay:** Click the **Chains** button from Home to explore the 3-level hierarchy (**Birth Cluster → Reasoning Chain with real KaTeX $A \land B \implies C$ → Proposition Statements**), sort by Name/Props/Created, select propositions to **seed a Teaching or Practice session**, or cleanly delete outdated nodes.
* **Notes Import:** Import local Markdown/text notes or folders directly into structured graph nodes & chains.

---

## 6. Walking Through All Three Study Modes

### Mode 1: `+ Teaching` (`Prober → PlanTree → Teacher`)
Start from the Home composer (**Teach** pill) or Sidebar **+ Teaching** (`Ctrl+N`):
1. **Prober Phase:** Before lecturing, Prober tests your actual mental model using fast keyboard-first cards (`Tab` between thinking & choices, `↑`/`↓` + `Space` to pick, `Enter` to submit). If you get stuck mid-question, press **`Ctrl+J`** to ask for a Socratic nudge in a quick side thread.
2. **PlanTree & Guided Execution:** Once Prober signals `probe_done`, the Teacher initializes an adaptive multi-step curriculum plan and walks through derivations step by step using **Quiz / Explain / Recall**, interactive **Drawing Pad** sketches, inline **Coding Questions**, and visual HTML demos.
3. **Arena Inside Teaching:** When learning a competitive algorithm (like Segment Trees, Convex Hull Trick, or Bitmask DP) and you want full C++ IDE verification, Teacher can invoke `lab` + `arena_run` directly inside your Teaching thread and resume coaching seamlessly once your Neovim run concludes.
4. **Automatic Knowledge Extraction:** Settled Teaching turns asynchronously distill confirmed insights back into propositions and reasoning chains on your Knowledge Graph (watch the **Background agents** sidebar section!).

### Mode 2: `+ Practice` (Zero-Elo Concept & Inline Code Drills)
Start via the Home **Practice** pill or Sidebar **+ Practice**:
* Optionally select Knowledge Graph propositions first so Practice tests exact reasoning chains from your map.
* Ideal for proofs, intuition checks, **Drawing Pad** diagram submissions, and inline `coding_problem` iterations where the host tracks submission attempts (`problem` / `conclude`) without touching your Competitive Arena Elo rating or ThemeCP ladder.

### Mode 3: `+ Arena` & The Arena Dashboard (ThemeCP, Ad-Hoc Solving, Neovim Loop)
Enabling **Competitive Arena** adds two coordinated entry points:
* **`+ Arena` Chats** (`/chat/new?mode=arena` or Home **Arena** pill): Dedicated `kind: "arena"` sessions with ThemeCP + Competitive Programming coach instructions, ZERO Knowledge Graph pollution (arena attempts never trigger graph extraction), and clean session-type filtering in the sidebar (`Teaching | Practice | Arena | All`).
* **Sidebar `Arena` Dashboard:** Your live CP command center showing:
  * **Live Active Session Banner** (ticking elapsed/budget timer, real-time editor event status from `events.jsonl`, per-problem status pills, plus **Launch Editor**, **Discard**, and **Abandon & Settle** actions).
  * **Quick Launchers:** One-click **Start ThemeCP Round**, inline **Solve Problem URL** bar, **New Arena Chat**, **Refresh**, and **Settings**.
  * **ThemeCP Ladder Panel:** Current Level (`L*`), Performance rating, `P1–P4` CF difficulty slots, AK rate, Round count, and a prominent **Upsolve Gate** banner whenever an upsolve is owed (with **Start Upsolve** and **Waive Upsolve** buttons).
  * **Global Standing & Domain Mastery:** CF rating, Tier badge, Peak rating, Solved/Attempted ratio, Streak, and progress bars across all 8 canonical CP domains.
  * **Recent ThemeCP Rounds & Recent Arena Attempts** tables + **Environment Health Strip**.

#### Observing a Full Arena Round End-to-End
1. Click **Start ThemeCP Round** (or paste any Codeforces / AtCoder / CSES / USACO URL into **Solve Problem URL**):
   * On blocked judges (`403`/`429`), the system automatically falls back to hardened TLS-impersonating `browser_fetch.py` (with full hop-by-hop SSRF & DNS-pinning validation).
2. Watch the **Background agents** dock at the bottom-left of the sidebar:
   * **`problem_recommender`** queries `catalog` (excluding previously attempted Arena problems via `arena.py attempted`), fetches & verifies live judge statements/constraints/samples, and stages `catalog/sets/<stage>.json`.
   * **`lab`** writes a reference C++ solution + brute-force oracle + test generator inside `/tmp/lh-lab-*`, stress-tests them with `g++ -std=c++17 -O2`, and atomically publishes verified `NN.in`/`NN.out` pairs (plus custom checkers when outputs are non-unique) into `lab/tests/<problem_id>/`.
3. `arena_run` stages `arena/active/manifest.json`, registers a host **External Job**, syncs `~/.pi-arena-root`, and renders a **Staged Arena Card** in chat — **ending the turn cleanly** so you can code freely without blocking the UI.
4. In your WSL terminal, open Neovim in a competitive session (`<leader>cs`) and drive the solve with your existing `<leader>m*` keymaps:
   * **`<leader>ma`** — Toggle the Arena Dashboard (auto-discovers `~/.pi-arena-root` → loads problems & hidden tests)
   * **`<leader>mc`** — View Problem Card, constraints, and samples
   * **`<leader>mp`** — Record your one-line **Approach** before coding (captures accurate Thinking vs. Coding time)
   * **`<leader>mt`** — Compile (`g++ -std=c++17 -O2`, no `-D LOCAL`) & test official samples
   * **`<leader>mj`** — Run **`lab`'s hidden stress tests** locally (reports smallest failing case first)
   * **`<leader>mh`** — Reveal progressive Socratic hint (locked in contest/ThemeCP checkpoints)
   * **`<leader>mo`** — Open problem URL in browser
   * **`<leader>mv`** — Submit verdict (`AC` / `WA` / `TLE` / `MLE` / `RE` / `ABANDON`) or hand off as `SUBMITTED` for oracle verification
   * **`<leader>mx`** — End session early
5. Watch the LearnHarness **Arena** dashboard update live as Neovim streams events (`Editor attached` → `approach noted` → `samples 2/2` → `hidden tests: AC`).
6. When Neovim writes `result.json` and closes, `ArenaWatcher` settles `arena.py close_session`, updates your CF rating & history ledgers, and wakes the chat with an expandable **`ArenaResultCard`**:
   * CF rating delta pill (`before → after (Δ)`)
   * **Thinking vs. Coding visual split bar** (Three I's telemetry)
   * Hidden-test pass count (`passed / total`)
   * Saved approach & post-solve reflection notes
   * Collapsible attempt-to-attempt unified C++ diffs & final submitted code
   * If a verdict is `SUBMITTED` (no live OJ judge), ask the coach to run **`problem_grader`**, which stress-checks your exact `.cpp` file from `practiceDir` under `-fsanitize=address,undefined` against an oracle and settles `arena_ledger(record_verdict)`.
7. **Stuck on a Deeper Concept?** Ask to pause and learn the theorem properly — **`bridge_to_teaching`** spins up a fresh `+ Teaching` session pre-seeded with your exact problem breakdown and renders a one-click **"Open Teaching Session →"** card.

---

## 7. Keyboard Shortcuts Cheat Sheet (`?`)

Press **`?`** anywhere in the app to open the live cheat sheet (note: **`Mod`** = `Ctrl` on Linux/Windows WSL browsers, `Cmd` on macOS). You can also customize bindings under **Settings → Keyboard**.

| Scope | Binding | Action |
| --- | --- | --- |
| Global | `Mod+,` | Open Settings dialog |
| Global | `Mod+K` | Model selector |
| Global | `Shift+Tab` | Cycle thinking level |
| Global | `Mod+B` | Toggle sessions sidebar |
| Global | `Mod+Shift+F` | Search sessions (`↑`/`↓` walk results, `Enter` opens) |
| Global | `Mod+N` | New Teaching session |
| Global | `Mod+G` | Jump to Knowledge Graph view (`/`) |
| Global | `Mod+F` | Find (graph node filter on Home, in-session text find in Chat) |
| Global | `Mod+D` | Toggle voice dictation |
| Global | `?` | Open shortcut cheat sheet |
| Chat | `F2` | Rename current session |
| Chat | `Mod+T` | Toggle all your thinking blocks |
| Chat | `Mod+J` | Question side thread (ask for a nudge) |
| Chat | `Tab` / `↑` / `↓` / `Space` / `Enter` | Navigate active interactive question card |
| Global | `Esc` | Layered dismiss: topmost menu/dialog → stop dictation → abort active turn |

---

## 8. Quality-of-Life Engineering Details to Notice

* **SideThread (`Mod+J` or Highlight Text → `Ask`):** Highlight any confusing equation, recurrence, or paragraph and click **Ask** to open a draggable, pin-able, resizable mini-conversation anchored right beside that passage — get clarity without derailing your main turn.
* **Finish-First Dictation (`Mod+D`):** Captures linear16 16 kHz PCM audio via Web Audio AudioWorklet directly to Deepgram with live dB level feedback. Hitting `Enter` while still speaking flushes remaining buffered speech first so the end of your sentence is never clipped.
* **Background Agents Observability Dock:** Pinned cleanly at the bottom of the left sidebar whenever workers (`lab`, `problem_grader`, `problem_recommender`, flashcards, graph extraction) are running — displays elapsed clock, active step, last-step context window fill, dollar estimate, and a one-click **Stop** control.
* **Context Transparency Bar:** Under every chat composer, click the token/cost readout to inspect exact per-turn input/output/cache tokens, context utilization, and pricing (showing native ACP / CLI sessions transparently without fabricated numbers).
* **Crash Recovery & Clean Unplugging:**
  * Restarting the server or refreshing mid-problem preserves `arena/active/manifest.json` + `job-link.json`; `ArenaWatcher` re-attaches automatically on boot and settles any finished `result.json` cleanly.
  * Toggling **Competitive Arena** `OFF` in **Settings → Core plugins** hides `+ Arena` and the Arena sidebar cleanly without touching `+ Teaching`, `+ Practice`, or your Knowledge Graph, and all historical `ArenaResultCard` Markdown transcripts stay readable.
