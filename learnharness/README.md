# LearnHarness (Personal Workspace Build)

An agentic learning harness combining adaptive **Teaching** (Prober -> PlanTree -> Teacher), **Practice**, a persistent **Knowledge Graph**, **Antigravity ACP (`agy acp`)** provider integration, and the **Competitive Arena** plugin with an external Neovim workflow.

Built on top of upstream [LearnHarness](https://github.com/amosblomqvist/learnharness), trimmed for personal local/web use without upstream tutorials, sample extensions, or installer packaging clutter.

## Core Features
- **Adaptive Teaching & Practice**: Probing, dependency-planned lessons, inline checks, voice dictation, and web/notes ingestion.
- **Persistent Knowledge Graph**: Stores propositions, reasoning chains, and imported note sources.
- **Competitive Arena (`plugins/competitive-arena`)**: ThemeCP ladder engine, curated problem catalog, isolated `lab` hidden test builder, oracle grader, rating progression chart, and file-contract bridge for Neovim.
- **Antigravity ACP (`src/agent/antigravity/`)**: Per-session `agy acp` process isolation, dynamic model catalog discovery, and 3-tier tool permissions (`safe_prompt`, `prompt_native`, `turbo`).

## Quick Start

```bash
npm ci
npm run plugins:setup
npm run dev        # http://localhost:3000
```

Useful scripts:
- `npm run build` — build core plugins and the Next.js production bundle
- `npm run typecheck` — run TypeScript type checking
- `npm run lint` — enforce core/agent/server/shell import boundaries
- `npm test` — run unit tests with fixtures and fake providers

## Runtime Storage & Keys
- `LH_DATA_DIR`: Overrides the mutable learning data directory (defaults to `<repo>/data` when unset, e.g. `~/.local/share/learnharness`).
- `LH_AUTH_FILE`: Overrides the API key store location (defaults to `<repo>/auth.json`, gitignored).

## License
Licensed under [AGPL-3.0](LICENSE) per upstream LearnHarness terms.
