# Competitive Arena

Official core LearnHarness plugin for structured competitive programming practice:

- **ThemeCP Ladder Engine** (`ladder`): self-balancing 4-problem P1–P4 rounds, AK/drop progression, upsolve gate, and Three-I's telemetry.
- **Curated Problem & Resource Catalog** (`catalog`): unified offline database (`catalog.json`) spanning progvar.fun, YouKn0wWho's UTL, Codeforces, AtCoder, CSES, and USACO, with SSRF-protected live statement fetching.
- **Global Arena Ledger & External Editor Bridge** (`arena_ledger`, `arena_run`): lifelong CF-scale rating trajectory, domain mastery tracking, live Neovim session staging (`manifest.json`, `~/.pi-arena-root`), crash-safe watcher recovery, and rich `ArenaResultCard` delivery.
- **Background Workers** (`lab`, `problem_grader`, `problem_recommender`): autonomous hidden-test suite authoring & stress-testing, independent oracle grading, and vetted set staging running in isolated `/tmp/lh-*` scratch workspaces.
- **Bridge to Teaching** (`bridge_to_teaching`): one-click escalation from an Arena roadblock into a graph-grounded native Teaching session.
