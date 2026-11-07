# learn

My AI learning system : How I Use AI to Learn Things

This is a personal system I built for myself, shared as-is. Built as a pi configuration: the teaching philosophy encoded in skills, a few small extensions, and agent definitions.

## The user journey

1. `/course new <slug>` — scaffolds `courses/<slug>/` (a living `course.md` state file + today's session log) and links the log. Then just say what you want to learn, or attach a source.
2. The tutor probes your level (always fresh, always thorough), presents a plan + dependency map, then teaches node by node: exposition → open dialogue → adaptive quiz.
3. Pause anytime — state lives in `course.md`, not in the chat. Days later: `/course resume <slug>`, say "continue", and the tutor re-orients, spot-checks stale foundations, and picks up mid-node.

## What's in it

- `skills/teach/` — the philosophy and the process (topic-mode intake)
- `skills/teach-source/` — sister skill for teaching from external source material (blog posts, textbook excerpts) via guided discovery
- `skills/practice/` — standalone deliberate practice gym for curated competitive programming problems, Socratic hint ladders, and adversarial grading
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture (teacher verifies every PNG before embedding)
- `extensions/learn.ts` — `/course new <slug>`, `/course resume [slug]`, `/course list`: course workspace scaffolding and session log linking
- `extensions/arena.ts` — `arena_run`, `arena_ledger`, and `/arena`: Competitive Programming Arena bridge to Neovim (`~/playground/contests/practice`), CF-equivalent rating & domain ledger, sample runner, progressive hints, and inline attempt diffing
- `extensions/ask-user-question.ts` — the agent asks you questions through a UI popup
- `extensions/quiz.ts` — graded questions with instant feedback (✓/✗, correct answer, explanation)
- `extensions/md-log.ts` — mirrors the session into the course's Obsidian session log; unescapes tool text and recovers JSON control-character collisions
- `extensions/visual-tools/` — tools for visualization subagents
- `agents/` — `curriculum-architect`, `auditor`, `problem-recommender`, `resource-recommender`, `problem-grader`, `researcher`, `svg-maker`, `mermaid-maker`: the specialized subagents the system delegates to

## Notes

You can run the system without subagents. The main session does the teaching. You just lose the researcher (truth verification), the curriculum-architect (curriculum and source material decomposition), the auditor (diagnostic gatekeeping), and the generated visuals.

The teaching skill is written for one learner (me). Edit the skill to fit how you learn best.

Design rationale and journey walkthroughs: see `tutor-design.md` (vault root).
