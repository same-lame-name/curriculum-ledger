# Course: Dynamic Programming (article + 66 curated problems)
state: active
source: courses/dp/sources/ (article.md = TopCoder DP treatise Parts 1–3; problems/ = 66 cards; solutions/ = 57 verified C++)
scope: AtCoder DPC A–Z, TDPC A–T, NDPC A–T. Done = cold-solve CF ≤ 2000 DP problems. Above ~2200 = stretch vault, opened only on appetite.

## Where the student stands
- **Solid on:** deriving the state from the future's question, and *inventing* boundary states rather than special-casing them (virtual day 0 = `A^0 = I` = a grid's border row). Order as a **release schedule**, not a sort — which released vertex goes next is free. Domination and natural death as separate ideas. Invariants that replace branches. "Prove the domain, not the code." Never materialising a range — endpoints and a difference array instead. Pull ↔ push as a free rewrite. On knapsack they deleted the chosen-set axis with a scan order and put the take-branch on layer `i-1` unprompted.
- **Growing edge:** **recognition, not derivation** — their own words, *"reasoning through an already visited forest."* The cure is breaking the problem slightly and asking which sentence of the writeup moves; more explanation does nothing. Also: "what must I keep alive" lags "what must I prove" — proved row `i` reads only row `i-1` twice, then allocated the full table both times. Expectation DP is at zero footing (Ch. 7, board-built).
- **Watch out for:** objective drift on a fast read (Frog 1 read as "count ways"). Sentinel arithmetic — `+1e15` is unattainable yet wins a `max` read-out, and any `+` beside a sentinel is an escape: `-INF + 60` sat in a real cell. Template `INF` is now `1e12+7`, so width is dead; the ordering hazard is not.

## Plan
- [x] 1. A state is a promise about the future (1D scans) — A ✓ B ✓ C ✓
- [x] 2. Overlapping work on grids and DAGs — H ✓ G ✓ NDPC B ✓ NDPC H ✓
- [>] 3. Carrying a budget: knapsack and its rotations — D ✓, E, TDPC A
- [ ] 4. Two sequences at once — F, NDPC C
- [ ] 5. Killing an inner loop: prefix sums, windows, ranks — M, T, TDPC F, TDPC L
- [ ] 6. Intervals: the last split is the decision — N, L, TDPC B, TDPC I
- [ ] 7. Adversaries and dice: games, probabilities, expectations — K, I, TDPC C, D, J
- [ ] 8. Subsets as states — O, U, TDPC J
- [ ] 9. Trees: the answer depends on one boundary — P, V
- [ ] 10. Layers, vectors, huge K — R, NDPC E, TDPC M
- [ ] 11. Sort first: exchange arguments and sweeps — Q, X, Y, TDPC K
- [ ] 12. Digits and carries — S, TDPC E, NDPC D
- [ ] 13. Profiles: one layer at a time — NDPC A
- [ ] Vault (appetite only, not a path): DPC Z, W; TDPC P/N/O/G/H/Q/R/S/T; NDPC F/G/I/J/K/L/M/O/P/Q/R/S/T — 24 problems, all ≥2100. Also where interleaved reps may be drawn from.
- [ ] Interleaved reps — next checkpoint **after Ch 4**, 2 reps, mechanism never named. 0 / ~70 done. Protocol: `curriculum.md` § Practice Tracks.

## On the board right now
- Working on: nothing — paused between problems. Next is **Knapsack 2 (DPC E)**, https://atcoder.jp/contests/dp/tasks/dp_e, `sources/problems/dpc-e-knapsack-2.md`. Not opened.
- Where we left off: D (Knapsack 1) closed **AC** and grader-accepted. The exactly-`w` fork was worked through in discussion only; no code was written for it.
- Sketch on the board: D closed in the Arena with the at-most 2D push-form knapsack. Code lives in their Neovim practice workspace via `arena_run` — never archive solutions in the course directory, never recreate `courses/dp/solutions/`.
- Next move: put E up cold. Ch. 3's real work is exactly-`j` vs at-most-`j` written both ways, then the rotated table actually running, then TDPC A's bitset (distinct sums, including 0).

## Habits & tangents to remember
- **Working preferences:** they solve first, we discuss after. Statement, constraints and samples only when a problem goes up — no framing, no hints, no unrequested nudging, and never pre-empt the next one.
- **Teacher rules:** every number on the board is scripted before it is shown, including mine. State an invariant's *strength* only after checking whether it could ever be false. Every AC gets verified against an independent oracle or brute force before it is ticked. "I don't know" means shrink the step, never re-ask the stem louder.
- **Watch out for:** conflating "an order is required" with "a *particular* order is required" — a heap was proposed for Kahn's. Re-test when ordering returns in Ch. 5 and Ch. 8.
- **Parked for later:** expectation DP from scratch (Ch. 7); "where greedy fails vs DP" as a running aside.

## Session log
- 2026-10-24 → sessions/2026-10-24.md
- 2026-10-25 → sessions/2026-10-25.md
- 2026-10-31 → sessions/2026-10-31.md
- 2026-11-02 → sessions/2026-11-02.md
