# Problem Ledger: DP
Solved: 2 · Committed: 40 core · Supplementary: 0

## DPC-A Frog 1: https://atcoder.jp/contests/dp/tasks/dp_a
- Idea: `dp[i]` = min cost to stand on stone `i`; read the two predecessors.
- Why it works: the future from stone `i` depends only on `i`, so the cheapest arrival dominates every other arrival.
- Breaks when: the statement constrains *which* earlier stones were used ("must land on stone 3"). Then the state needs that fact as an extra coordinate (`dp[i][visited3]`).
- Transfers to: any clause naming which earlier things were used is the missing state coordinate.
- Slip: `dp[1] = 0` dead store; the real base `dp[0] = 0` came from zero-initialisation, not from the code.

## DPC-H Grid 1: https://atcoder.jp/contests/dp/tasks/dp_h
- Idea: `dp[r][c]` = number of paths to `(r,c)`; sum top and left; a wall is the value `0`.
- Why it works: counting merges arrivals that face the same future; out-of-grid reads are the additive identity, so only `(0,0)` is seeded.
- Breaks when: a rule spans consecutive moves ("no two rights in a row"). Then split by what the next move is allowed to do (`last_right` / `last_not_right`).
- Transfers to: name a state slot by what it forbids. The empty path satisfies the permissive slot, which places the seed. Counting merges by equivalence; min/max discards by dominance.
- Slip: `dp[0][0] = 1` set outside the wall check (harmless only because the start is guaranteed open).
