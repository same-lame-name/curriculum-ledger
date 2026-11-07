# Two doors

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_s
**Tags:** shortest path, characteristic 2
**Limits:** 3 sec / 1024 MiB

## Statement

### Problem Statement
You are given an $N \times N$ grid. Let $(i,j)$ denote the cell in the $i$-th row from the top and the $j$-th column from the left.

The state between adjacent cells (sharing an edge) is represented by a character $c$:

- If $c =$ `.`, there is nothing between the cells, and you can pass freely.
- If $c =$ `D`, there is a door, and you can pass freely.
- If $c =$ `A`, there is a special door called $A$, and you can pass freely.
- If $c =$ `B`, there is a special door called $B$, and you can pass freely.
- If $c =$ `#`, there is a wall, and you cannot pass.

Here, there is exactly one door $A$ and one door $B$ in the grid.

The states between adjacent cells are given by strings $S_1, S_2, \dots, S_{N-1}$ and $T_1, T_2, \dots, T_N$:

- For $1 \leq i \leq N-1$, $1 \leq j \leq N$, the state between $(i,j)$ and $(i+1,j)$ is $S_{i,j}$.
- For $1 \leq i \leq N$, $1 \leq j \leq N-1$, the state between $(i,j)$ and $(i,j+1)$ is $T_{i,j}$.

A grid is called a good state if you can start from $(1,1)$ and reach $(N,N)$ by moving up, down, left, or right without passing through walls.

You will block some of the doors (except $A$ and $B$), making them impassable, so that the following conditions are satisfied:

- The grid is in a good state.
- Even if you additionally block exactly one of $A$ or $B$, the grid is still in a good state.
- If you additionally block both $A$ and $B$, the grid is no longer in a good state.

Is it possible to satisfy these conditions? If it is possible, find the minimum number of doors you need to block.

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 10^5$
- $2 \leq N \leq 40$
- Each $S_i$ is a string of length $N$ consisting of `.`, `D`, `A`, `B`, `#`
- Each $T_i$ is a string of length $N-1$ consisting of `.`, `D`, `A`, `B`, `#`
- `A` and `B` each appear exactly once among all $S_{i,j}$ and $T_{i,j}$
- The sum of $N^2$ over all test cases is at most $2 \times 10^5$
- The sum of $N^4$ over all test cases is at most $40^4$

### Input
The input is given from standard input in the following format:

```
T
case_1
case_2
...
case_T
```
Each test case is given in the following format:

```
N
S_1
S_2
...
S_N-1
T_1
T_2
...
T_N
```

### Output
Print $T$ lines. On the $i$-th line, output the answer for the $i$-th test case.

For each test case, if it is possible to satisfy the conditions, output the minimum number of doors that need to be blocked; otherwise, output `-1`.

### Sample Input 1
```
6
2
.A
.
B
2
.A
#
B
3
#D.
#BD
.A
.#
..
4
DDBD
..#D
#D.D
#DD
#DD
.A.
#.#
4
D.#D
DD#.
D.B.
#D.
.#D
...
.DA
9
DDD.D#DDD
DDDADDDDD
DD.DDDDDD
DDDD#.DDD
DD#DDDD.#
DDDDD#.#D
DD.#..DDD
DDDDD#D.D
DDD...DD
D#.D#D#D
D#DD#D.#
DDD#DD##
BDDD.D#D
DD#DDDDD
DDDDD#DD
DDD#DDDD
##DDD.#D
```

### Sample Output 1
```
0
-1
0
3
-1
7
```
For example, in the first test case, the conditions are already satisfied.

## Editorial

### Claim
Contract every `.` edge of the grid and delete every `#` edge. The resulting graph $G$ has one edge for each remaining `D`, `A`, or `B`. Let $S$ and $T$ be the vertices containing $(1,1)$ and $(N,N)$. If $S$ and $T$ are not connected in $G$, the answer is $-1$. Otherwise only the connected component containing $S$ and $T$ matters.

Let $X$ be the set of `D` edges that are blocked. The requirements are:
- $G-X$ connects $S$ and $T$;
- $G-X-\{A\}$ connects $S$ and $T$;
- $G-X-\{B\}$ connects $S$ and $T$;
- $G-X-\{A,B\}$ does not connect $S$ and $T$.

Call such an $X$ good. The key equivalence is:

> $X$ is a minimal good set if and only if $X\cup\{A,B\}$ is a minimal $S$-$T$ cut.

For the forward direction, put $H=G-X-\{A,B\}$ and let $V_1,V_2$ be the components of $H$ containing $S$ and $T$. The good conditions force $A$ and $B$ to cross $V_1$ and $V_2$. Minimality of $X$ forces $H$ to have no other components: otherwise $X$ contains an edge with an endpoint outside $V_1\cup V_2$, and deleting that edge from $X$ keeps all four conditions. Hence $X\cup\{A,B\}$ is exactly the set of edges crossing the partition $(V_1,V_2)$, a minimal $S$-$T$ cut. The converse is immediate.

Therefore the answer is the minimum of $|C|-2$ over minimal $S$-$T$ cuts $C$ that contain both $A$ and $B$, or $-1$ if there is no such cut.

In the planar dual, a minimal $S$-$T$ cut is a simple cycle separating $S$ from $T$, and its length is the number of primal edges it crosses. Adding suitable super vertices $S',T'$ to the dual turns the requirement that the cycle pass through the duals of both $A$ and $B$ into a shortest-path problem through specified vertices. The cited paper gives a polynomial-time DP over a field of characteristic $2$ for that problem; the resulting bound is about $O(N^4)$ for an $N\times N$ grid.

### Complexity
$O(N^4)$ time, as stated in the source; the memory bound is not stated.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
縦横 $N$ マスのグリッドがあります。上から $i$ 行目、左から $j$ 列目のマスを $(i,j)$ と表します。

辺で隣接するマスの間の状態は文字 $c$ で表されて、

- $c =$ `.` の時、マスの間には何もなく、自由に通行可能です。
- $c =$ `D` の時、マスの間には扉があり、自由に通行可能です。
- $c =$ `A` の時、マスの間には $A$ と呼ばれる扉があり、自由に通行可能です。
- $c =$ `B` の時、マスの間には $B$ と呼ばれる扉があり、自由に通行可能です。
- $c =$ `#` の時、マスの間には壁があり、通行は不可能です。

ここで 扉 $A$, 扉 $B$ はグリッド上にそれぞれちょうど $1$ 枚あります。

グリッド上の辺で隣接するマスの間の状態は文字列 $S_1, S_2, \dots, S_{N-1}, T_1, T_2, \dots, T_N$ によって表されて、

- $1 \leq i \leq N-1, 1 \leq j \leq N$ について $(i,j)$ と $(i+1,j)$ の間の状態は $S_{i,j}$、
- $1 \leq i \leq N, 1 \leq j \leq N-1$ について $(i,j)$ と $(i,j+1)$ の間の状態は $T_{i,j}$

となっています。

$(1, 1)$ からスタートして、通行が不可能な場所を通らないように上下左右のマスへの移動を繰り返して $(N, N)$ まで移動することができるグリッドの状態を 良い状態 と呼びます。

あなたは次の条件を満たすように、扉 $A$, 扉 $B$ 以外の扉のうちいくつかを封鎖して通行不可能にします。

- グリッドは良い状態である。
- 追加で 扉 $A$, 扉 $B$ のちょうど一方を封鎖しても、グリッドは良い状態である。
- 追加で 扉 $A$, 扉 $B$ の両方を封鎖した時に、グリッドは良い状態でなくなる。

条件を満たすことは可能ですか？可能である場合は最小で何枚の扉を封鎖すれば条件を満たすかを求めてください。

$T$ 個のテストケースが与えられるので、それぞれについて答えを求めてください。
