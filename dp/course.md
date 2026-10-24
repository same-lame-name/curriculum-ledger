# Course: DP: svg treatise + 66 curated problems
state: active
skill: teach-source
sources: courses/dp/sources/ (index.md, article.md, problems/*.md)
scope: CF ≤ 2000; all 40 core problems (duplicates included); 9 edge opt-in after core; 17 stretch named only

## Baseline
- Solid: dependency/traversal order, loop direction as semantics, LCS match guard, digit tight flag
- Breaks at: expectation with self-loops (`E = 1 + Σ p·E(next)`), which is from-zero at the expectation node
- Watch for: bookkeeping slips on sentinel arithmetic; blind state derivation not yet proven (re-check at expectation and trees)

## Roadmap
[x] 1. State = the future's question (DPC-A, DPC-H)
[>] 2. Order is part of the answer (DPC-F)
[ ] 3. Impossible is a number too (sentinels; no primary problem)
[ ] 10. Expectation, from zero (DPC-I, DPC-J, TDPC-C, TDPC-D)
[ ] 4. Capacity axis / loop direction (DPC-D, TDPC-A, TDPC-H)
[ ] 5. Sum vs min / canonicalisation (DPC-Y)
[ ] 6. Last choice → rank (DPC-C, DPC-T)
[ ] 7. Window aggregate (DPC-B, DPC-M, DPC-Q, TDPC-F, TDPC-K, TDPC-L)
[ ] 8. Interval DP (DPC-N)
[ ] 9. Games: difference state (DPC-K, DPC-L, TDPC-B)
[ ] 11. Masks / canonical partitions (DPC-O, DPC-U)
[ ] 12. Trees / the parent's question (DPC-P, TDPC-P)
[ ] 13. Rerooting (DPC-V)
[ ] 14. The graph is the order (DPC-G, NDPC-B)
[ ] 15. Matrix power / accumulator (DPC-R, NDPC-E)
[ ] 16. Digit DP (DPC-S, TDPC-E, NDPC-D, NDPC-J)
[ ] 17. Profile DP (NDPC-A)
[ ] 18. Exchange argument (DPC-X)
[ ] 19. Index by the objective (DPC-E, NDPC-H)
[ ] 20+. Edge / stretch (opt-in, see map)

## Checkpoint
- Node: Order is part of the answer
- Problem: DPC-F LCS (with reconstruction), https://atcoder.jp/contests/dp/tasks/dp_f · stage: not opened
- On the board: nothing yet; open with the consent gate
- Open question: none until the statement is up
- Next: consent → LCS statement → student's attempt

## Live Misconceptions
- A base value written outside the legality check (`dp[0][0] = 1` above the wall test) can break "illegal ⇒ 0"
- Expectation: no separation of the certain step from the branches; one state given two names; dropped branches

## Parked
- none

## Session log
- 2026-10-20 → sessions/2026-10-20.md
- 2026-10-23 → sessions/2026-10-23.md
