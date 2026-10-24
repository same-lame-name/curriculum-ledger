# Course: Typical90, 90 problems by idea
state: active
skill: teach-source
sources: courses/typical90/sources/ (INDEX.md, 001.md … 090.md)
scope: all 90 problems; CF ≤ 2000 is done; the stretch node (077, 040, 005, 053, 035, 065, 090) is opt-in

## Baseline
- Solid: cost arithmetic, DP state semantics, directional sentinels, inclusion–exclusion
- Breaks at: bookkeeping, not modelling: a correct model with one term misread or dropped
- Watch for: wants decision procedures, not proofs; ask for one concrete sign/coefficient trace before a problem passes

## Roadmap
[>] 1. One pass, many questions (010, 004, 064, 028, 081)
[ ] 2. Integers are exact; reals are not (022, 067, 020, 069, 038, 082)
[ ] 3. What to store so a lookup is cheap (027, 061, 078, 007, 044)
[ ] 4. Order first (014, 079, 070, 048, 033)
[ ] 5. Search spaces (002, 032, 055, 016, 063, 072, 051, 025, 088)
[ ] 6. Monotone predicates (001, 076, 034, 006)
[ ] 7. Divisors, primes, residues (046, 052, 075, 030, 085)
[ ] 8. DP: the state is what the future still needs (050, 008, 042, 056, 060, 011)
[ ] 9. Graphs I (012, 068, 026, 003, 039, 073, 062, 054)
[ ] 10. Graphs II (043, 013, 087, 071, 021, 049)
[ ] 11. Counting without enumerating (084, 080, 066, 086, 015, 047)
[ ] 12. DP over structure (019, 045, 023)
[ ] 13. Range aggregates (029, 037, 017, 089, 059, 083)
[ ] 14. Games, invariants, GF(2) (024, 058, 074, 031, 057)
[ ] 15. Geometry and transforms (018, 036, 009, 041)
[ ] 16. Stretch (077, 040, 005, 053, 035, 065, 090)

## Checkpoint
- Node: One pass, many questions (last problem)
- Problem: 081, https://atcoder.jp/contests/typical90/tasks/typical90_cc · stage: not opened
- On the board: nothing yet; open with the consent gate
- Open question: none until the statement is up
- Next: consent → 081 → node close

## Live Misconceptions
- A number in front of them left unreconciled against a rule they already hold; demand one concrete trace
- INF-too-large wrap-around: shown to them, never produced independently (re-test at 037, 089)

## Parked
- Sparse 2-D imos (028 with coords ≤ 10^9): sweep line + segment tree over compressed y; natural home is range aggregates

## Session log
- 2026-10-19 → sessions/2026-10-19.md
- 2026-10-24 → sessions/2026-10-24.md
