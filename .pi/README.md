# learn

A personal, terminal-based learning setup built on pi: a one-on-one competitive programming teacher in Richard Feynman's manner, an Obsidian notebook that mirrors every sitting, and a Neovim Arena where code gets written, timed, and judged.

## A sitting

1. `/course new <slug>` scaffolds `courses/<slug>/` (notebook, `sources/`, today's log) and links the log. Drop source material into `sources/`, then `/skill:teach`.
2. A new course starts with the intake: probing finds where you actually are, an auditor checks the probing found both floor and edge, and the curriculum architect tailors the guide.
3. `/course resume <slug>` links today's log, records it under `## Session log` in `course.md`, and sets the active course; run `/skill:teach` when ready to start the sitting.
4. Code happens in the Arena (`<leader>ma` in Neovim, inside a competitive session started with `<leader>cs`). The conversation keeps going while you code; the result reaches the teacher by itself.

## What's in it

- `skills/teach/` — the teacher: voice, how it teaches, sittings, deliberate practice, the intake, the files, the helpers. One skill for course, source, and ad-hoc teaching.
- `skills/themecp/` — ThemeCP: self-balancing 4-problem practice ladder, time-constrained holistic training, post-analysis (inception/intuition/implementation), surgical upsolve.
- `agents/` — helpers that report to the teacher in plain terms:
  - `curriculum-architect` writes each course's guide (`curriculum.md`), stage 1 before probing, stage 2 after, and `revise` when the course changes shape
  - `auditor` checks that the intake located both floor and edge
  - `problem-grader` checks a submission or a reduction against an independent oracle
  - `lab` runs experiments: claims, counterexamples, traces, toolchain reproductions, hidden tests
  - `problem-recommender` picks catalog problems, mixed or targeted, leaving out what the ledger shows as attempted
  - `resource-recommender`, `researcher`, `svg-maker`, `mermaid-maker`
- `catalog/` — the offline problem and resource catalog (`catalog.py`: domains, buckets, find, problem, pick, similar, resources).
- `extensions/`
  - `learn.ts` — `/course new | resume | list` (deterministic workspace scaffolding, pointer files, and `## Session log` upkeep)
  - `md-log.ts` — mirrors each sitting into `courses/<slug>/sessions/<date>.md` for Obsidian
  - `teacher.ts` — keeps the voice in the system prompt for the whole sitting, enforces ownership boundaries, and keeps `course.md` inside its template and budgets
  - `curriculum.ts` — `curriculum` (`overview`, `intake`, `chapter`, `practice`, `lookup`): structured read/query bridge over `courses/*/curriculum.md`
  - `arena.ts` — `arena_run`, `arena_ledger`, `/arena`: the bridge to the Neovim Arena and the practice ledger
  - `ladder.ts` — `ladder`: the bridge to the ThemeCP ladder state machine, round lifecycle, and upsolve gating
  - `housekeeping.ts` — startup cleanup for transient `.pi/catalog/sets/` and `.pi/lab/tests/` artifacts
  - `quiz.ts`, `ask-user-question.ts` — graded questions and open questions in a popup
  - `visual-tools/` — authoring tools for the diagram helpers (`viz/*.png` is permanent; `/tmp/pi-visual-tools/` previews are cleaned on exit and startup)
- `arena/arena.py` — the ledger engine and the Arena's CLI: rating, history, upsolve queue, practice notes, attempted problems.
- `curriculum/curriculum.py` — the curriculum guide query & structural validation engine (`overview`, `intake`, `chapter`, `practice`, `lookup`, `validate`).
- `ladder/ladder.py` — the ThemeCP ladder engine and CLI: levels, slots, round state machine, upsolve gate, stats.
- `learner.md` (vault root) — your own note on how you like to learn. The teacher reads it and never writes it.

## Ownership

Each feature keeps its own state and answers through its API, so any of them can change inside without breaking the others. Static expertise is private to its owner; generated handoff artifacts and documents are readable by the teacher and Arena while writes stay with their owner.

| Feature | Owner (Write) | Scope & Lifecycle | How others reach it |
|---|---|---|---|
| Arena | `arena.ts`, Neovim's arena, `arena.py` | `.pi/arena/` (permanent ledger + `active/` session state, including read-only copies of `active/tests/<id>/`) | `arena_run`, `arena_ledger`; `arena.py standing \| attempted` for authorized helpers |
| Ladder | `ladder.ts`, `ladder.py` | `.pi/ladder/` (permanent ladder state + round records) | `ladder` tool; `ladder.py status \| slots \| stats` for authorized helpers |
| Static catalog | `problem-recommender`, `resource-recommender` | `.pi/catalog/{catalog.json,*.csv,catalog.py,sources/}` (private static data) | brief the recommender (`catalog` tool) |
| Generated catalog sets | `problem-recommender` (`housekeeping.ts`) | `.pi/catalog/sets/<STAGE>.json` (wiped on reset / TTL sweep) | readable by teacher; pulled into `manifest.json` by `arena_run` (`problemsFile`) |
| Lab hidden tests | `lab` (`housekeeping.ts`) | `.pi/lab/tests/<id>/` (wiped on reset / TTL sweep; scratch stays in `/tmp/pi-lab-*`) | readable by teacher; copied into `active/tests/<id>/` by `arena_run` (`testsDir`) |
| Visual diagrams | `svg-maker`, `mermaid-maker` (`visual-tools`) | `viz/viz-<slug>-<ts>.png` (permanent; `/tmp/pi-visual-tools/` previews cleaned on exit/startup) | teacher inspects with `read` and embeds in Obsidian |
| Course guide | `curriculum-architect` | `courses/<slug>/curriculum.md` (permanent validated schema) | `teacher:teach` queries via `curriculum` tool (`curriculum.py`); `auditor` reads raw; changes via `MODE: revise` |
| Notebook | the teacher | `courses/<slug>/course.md` (permanent, guarded by static section budgets in `teacher.ts`) | the teacher's own (`## Session log` updated by `learn.ts`) |
| Course workspace | `learn.ts` | `.active-course`, `.active-session` (published pointers: anyone reads, only `learn.ts` writes) | `/course`; `__piCourse.active()` in-process |
| Transcripts | `md-log.ts` | `courses/<slug>/sessions/*.md` (permanent documents) | read them; `__piMdLog` in-process |
| Learner notes | you | `learner.md` (permanent document) | the teacher reads it |

During a sitting, `rbac.ts`, `teacher.ts`, and `housekeeping.ts` hold each agent to its territory: teachers stay out of `.pi/arena/`, `.pi/ladder/`, and the static catalog (while allowing read-only sanity checks on `.pi/catalog/sets/` and `.pi/lab/tests/`), curriculum changes go to `curriculum-architect`, and helpers keep all scratch work in `/tmp/pi-<role>-*`.

## Design

- One voice: only the teacher speaks to the student; helpers report facts, files are information.
- Everything the teacher writes is on the student's board, so preparation stays off it.
- The student decides what and when; the teacher decides how.
- Each fact has one home: teaching in the skill, helper contracts in agent files, tool behaviour in tool descriptions, course state in `course.md`, history in the transcript.
