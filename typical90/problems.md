# Problem Ledger: Typical90
Solved: 4 · Committed: 90 · Supplementary: 0

## 010 Score Sum Queries: https://atcoder.jp/contests/typical90/tasks/typical90_j
- Idea: prefix sums per class; a query is `S[R] − S[L−1]`.
- Why it works: `+` is invertible, so two running totals recover the middle. `S[0] = 0` must be written, not inherited.
- Breaks when: the operation has no inverse (min/max/gcd), or the array mutates between queries.
- Transfers to: prefix XOR, prefix of `a²`; any static range query over a group operation.

## 004 Cross Sum: https://atcoder.jp/contests/typical90/tasks/typical90_d
- Idea: `row(i) + col(j) − A[i][j]`.
- Why it works: a row and a column intersect in exactly one cell; `Ω(HW)` output makes it optimal.
- Breaks when: the region isn't a union of whole rows/columns (a K×K block needs a 2-D summary).
- Transfers to: decompose the query region into independent 1-D pieces.

## 064 Uplift: https://atcoder.jp/contests/typical90/tasks/typical90_bl
- Idea: keep adjacent differences; a range add changes only the two straddling differences; update `Σ|B|` before/after.
- Why it works: the readout is already written in differences, so update and read are both O(1) regardless of frequency.
- Breaks when: the readout isn't native in differences (`Σ A`, `max A`, a point value).
- Transfers to: static array → prefix; readout native in differences → differences; frequent updates and range reads → a tree.
- Slip: none; guards on `B[-1]` / `B[N−1]` were correct by construction.

## 028 Area covered by exactly k: https://atcoder.jp/contests/typical90/tasks/typical90_ab
- Idea: 2-D imos: four corner writes at the given corners verbatim, prefix along x, then along y, then bucket counts.
- Why it works: a rectangle is an x-interval times a y-interval; each axis's prefix inverts its own difference.
- Breaks when: coordinates are sparse (≤ 10^9): sweep line plus a segment tree over compressed y.
- Transfers to: any batch of rectangle adds read once at the end.
- Slip: first sketch anchored the corners at `lx−1`/`ly−1` (shifted and one too wide); cartesian vs array orientation confusion.
