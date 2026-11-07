# Course: Typical90 — Ninety Problems, One Idea at a Time
state: active
source: courses/typical90/sources/
scope: All 90 cards, guided discovery, ceiling Codeforces ≤ 2000 (`stretch` cards droppable)

## Where the student stands
- **Solid — do not re-derive:** cost arithmetic; prefix sums; recursion call-counting; 64-bit widening;
  bitmasks; signed `%`; graph-as-data; the two-pointer safety proof; log base 2; convexity-as-a-count;
  exchange arguments — both halves, unprompted (048). Reached the intended insight unaided on all 8
  Chapter-1 cards, on 004 010 084 064 028 076, and on **048 on the first read** (the 2N-move reframing
  and the constraint's job, before I said anything).
- **Growing edge:** names a sufficient condition and calls it necessary (076: justified the window with
  `A[i] ≥ 1` when the sharp bound is `≥ 0`); inspects small cases instead of partitioning the space.
  Partly closed on 048 — he concluded about the **sum** rather than a specific **set**, which is exactly
  what made that proof tie-proof without his noticing.
- **New (048): a stale number, borrowed from the last card.** Read `N` as `10^5` twice on a card that
  says `2 × 10^5` — Chapter 3's first three cards really are `10^5`, so it arrived from memory, not text.
- **Unmeasured:** writing under a clock; debugging his own WA; facing a problem with no known technique.
  Overflow discipline demonstrated twice (070, 048), still untested under load (029/044).
- **Teaching levers:**
  - Ask size/headroom questions **on their own line** — stapled to "write it", he answers the code and
    drops the arithmetic.
  - Hand him a generalised tool **cold**; the transfer happens by itself (064 → 028 same sitting).
  - **Ask what he will literally write before arguing against it.** He has beaten my assertion five times
    (004, 028, 076 ×3); on 048 his *paired* bound was tighter than the one I offered, though his `N` was
    stale. Stop supplying his implementation for him.

## Plan
- [x] 1. Treat N as a cost; find the sentence that makes the problem finite — **COMPLETE 8/8 AC** (024 022 027 033 055 067 038 020)
- [x] 2. A contiguous range is the difference of two stored numbers — **COMPLETE 7/7 AC** (004 010 084 064 028 081 076)
- [x] 3. Sort first, then the local choice stops depending on the rest — **COMPLETE 4/4 AC** (014 007 070 048)
- [>] 4. Read the small constraint, then delete a dimension from the brute force (002 032 016 085 023 025)
- [ ] 5. The odd constraint is the door; bits and subsets are independent (063 086 080 045)
- [ ] 6. When the shape is too weird for loops, that is a reason to recurse (072 088)
- [ ] 7. Give the state a name — what the future can still tell apart (050 008 042 046 069)
- [ ] 8. Choose or skip, then walk the table backwards to print the plan (056 011 051)
- [ ] 9. An interval DP asks what happens last, and fills by length (019)
- [ ] 10. Never list the objects; sum over structure (052 082 066 015)
- [ ] 11. See that it is a graph before asking which algorithm (078 012 068 021 058 054 071)
- [ ] 12. The vertex is not always the state (013 043)
- [ ] 13. In a tree the path is unique, so every question is about subtrees (003 026 039 073)
- [ ] 14. Turn the answer into a yes/no question and find the threshold (001 006 060 087)
- [ ] 15. The left end never needs to move backwards (034 089)
- [ ] 16. Remember only what actually changes (061 044 029 037)
- [ ] 17. Find the quantity the operations cannot change (079 074 062 049 057)
- [ ] 18. Independent games add by XOR (031)
- [ ] 19. Factor structure is sparse, and sparsity is the bound (030 075 065)
- [ ] 20. Change coordinates until the awkward quantity is simple (018 036 041)
- [ ] 21. Above the ceiling: meet the tools, park the expensive ones (009 017 059 047 053 035 083 077 040 005 090)

## On the board right now
- Working on: **Chapter 3 CLOSED (4/4). Chapter 4 next.** Nothing mid-attempt, no code in flight;
  048 closed AC in the Arena and 002 opens the next Arena session.
- Next move: open **`002` Encyclopedia of Parentheses**
  (https://atcoder.jp/contests/typical90/tasks/typical90_b) via Pure Cold Launch — statement, constraints,
  samples only. `N ≤ 20` ⇒ the chapter is "read the small number as a budget".
  **Hold back:** that one integer `i ∈ [0, 2^N)` replaces N nested loops, the `'('`-for-bit-0 ordering,
  and the odd-N boundary. Chapter 4's frontier note says the bitmask-budget half is already verified, so
  the chapter's real weight is *deleting a dimension* (016, 085) — 002 should move fast.
  Sitting plan: Sit 9 = 002, 032, 016.

## Habits & tangents to remember

### Watch out for (active)
- **`N` is read off the card, never recalled.**
- **Answer the step you are on, not the one next to it.** 048: asked why the exchange's *drop* was legal,
  he justified that the swap can't pick a problem against itself — right fact, wrong step. Ask *"what
  could go wrong right HERE?"* before calling the last brick laid.
- **Ask for the ANSWER's ceiling on its own line, before code is written.** 070: one term `≤ 2·10^9`
  fits `int`; the sum over `10^5` is `≤ 2·10^14` and does not. Nothing in the expression's shape warns you.
- **A sentinel is an identity only if you can state the ANSWER's ceiling.** 007: `INF = 1e9+7` against a
  true max of `1e9` — valid by **7**, not by design. Same fingerprint as 081's `0` sentinel.
- **A boundary is a case to answer, not to dodge** — 064 `d[0] += V` (arithmetic reached a fake cell);
  028 `result[-1]++` (heap overflow); 081 a guard that **refused a real window** and printed the sentinel.
  A guard that skips work silently shrinks your candidate set. Two honest repairs: *handle* the boundary,
  or *prove* it covered and write that argument in the comment.

### Transferable — with the card where it fires next
- **Prove an obligation can never arise, then delete the guard from the code.** 048: `A_i/2 < B_i` vanished
  entirely from the implementation — no ordering bookkeeping, no per-problem state — and that is correct
  *because* the sentence was written first. Order matters: prove, then remove. Never the reverse.
- **Pairing the terms bounds tighter than bounding them one at a time.** 048: 2N moves × `10^9` gives a
  loose `4·10^14`; pairs summing to `A_i` gives `N·10^9 = 2·10^14`, which is tight. → 037, 061.
- **When a greedy walks until it stops improving, ask what is MONOTONE** — usually a *count*, far easier
  to exhibit than a proof of transition (070: `Δ(a) = 2·#{x_i ≤ a} − N`). → 034, 089, Chapter 14.
- **`Δ(a)` prices the step OUT of `a`, not being at `a`** — so `Δ = 0` is sufficient, not necessary, and
  the minimiser set is an *interval*, not the set of medians. → Chapter 14's monotonicity.
- **Bound by partitioning, never by comparing patterns** (033); `C(N,5)` not `N^5` (055); divide before
  multiplying to test a bound (038); compare exact integers (020).

### Terse checklists
- **Types:** `1e18` is a `double` — write `1000000000000000000LL`. Sum `N·A[i]` *before* choosing int vs
  long long. `abs` needs a `long long` argument to pick that overload. `int A[2000][2000]` in `main` is
  8 MB of stack ⇒ segfault; heap or `static`. `-Wconversion` catches what `-Wall -Wextra` allow.
- **Prefix sums:** 1-index with `S[0] = 0` so `S[R] − S[L−1]` needs no branch at `L = 1`; always test `L = 1`.
- **Proof hygiene:** to test whether a statement's "permission" is load-bearing, delete it and see whether
  the proof survives. Sample contradicts statement ⇒ trust the sample, check the Japanese (033).

### Standing rules (how I work)
- **AC ≠ correct.** 081 AC'd while printing `0` on *every* `K = 5000` input — the missing case was the
  *boring* one. AC is evidence the test data contains no counterexample, not that none exists. Converse:
  an independent oracle is independent of *my* reasoning, not infallible — verify the findings that smell.
- Implementation runs in the Arena (`arena_run`); grading goes through `problem-grader` on the returned
  inline code and attempt diffs, **not** my own bash harness.
- **`-D_GLIBCXX_DEBUG` changes asymptotics, not just constants.** On 007 it rebinds `lower_bound` to the
  debug version: `Q log N` → `Q·N` = `10^10`, 175 s instead of 0.02 s. Debug builds are for *correctness*
  only — always re-time at plain `-O2`.
- `-DLOCAL` is never defined on any judge in his setup; the `freopen` block is inert. **Closed.**
- **No archive directory in the course folder, ever.** His `.cpp` files live in his Neovim practice
  workspace via `arena_run`; a ✓ in Plan and `arena_ledger` are the record. He deletes old files himself,
  on purpose — if a file seems to have gone missing, he meant that.
- He refuses defensive `cin`-failure checks as CP-unnecessary. **Conceded and closed — do not reopen.**

## Session log
- 2026-10-24 → sessions/2026-10-24.md
- 2026-10-25 → sessions/2026-10-25.md
- 2026-10-30 → sessions/2026-10-30.md
- 2026-11-01 → sessions/2026-11-01.md
- 2026-11-02 → sessions/2026-11-02.md
