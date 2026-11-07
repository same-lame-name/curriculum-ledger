# Set

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_f
**Tags:** Cartesian tree, tree DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given a permutation $P = (P_1, P_2, \dots, P_N)$ of $(1, 2, \dots, N)$ and an integer array $A_1, A_2, \dots, A_N$ of length $N$.

A subset $S$ of the set $\lbrace 1,2,\dots,N \rbrace$ is called a good set if it satisfies the following condition:

- For every pair of integers $(x, y)$ such that $x < y$ and $x, y \in S$, the following holds:
Let $z$ be the integer such that $P_z = \min(P_x, P_{x+1}, \dots, P_y)$. (Such a $z$ is uniquely determined.) Then, it must hold that $z \in S$.

The cost of a good set $S$ is defined as $\displaystyle \sum_{i \in S} A_i$.

For each $K = 1, 2, \dots, N$, find the minimum possible cost among all good sets of size $K$.

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 5000$
- $1 \leq N \leq 5000$
- $1 \leq A_i \leq 10^9$
- $(P_1, P_2, \dots, P_N)$ is a permutation of $(1,2,\dots,N)$
- The sum of $N$ over all test cases is at most $5000$
- All input values are integers

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
P_1 P_2 ... P_N
A_1 A_2 ... A_N
```

### Output
Print $T$ lines. For the $i$-th line, output the answer for the $i$-th test case.

For each test case, output the answers for $K = 1,2,\dots,N$ in one line, separated by spaces.

### Sample Input 1
```
3
4
4 1 2 3
1 8 2 4
6
5 3 2 4 6 1
73 38 30 85 27 45
10
4 10 3 7 2 6 8 9 5 1
853822501 687675302 281611653 844033520 423210108 339630584 780395612 207907746 285523486 359061085
```

### Sample Output 1
```
1 6 11 15
27 57 95 140 213 298
207907746 493431232 833061816 1192122901 1537883577 1896944662 2584619964 3365015576 4209049096 5062871597
```
In the first test case:

- For $K=1$, $S=\lbrace 1 \rbrace$ is optimal,
- For $K=2$, $S=\lbrace 3,4 \rbrace$ is optimal,
- For $K=3$, $S=\lbrace 1,2,3 \rbrace$ is optimal,
- For $K=4$, $S=\lbrace 1,2,3,4 \rbrace$ is optimal.

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
$(1, 2, \dots, N)$ の順列 $P = (P_1, P_2, \dots, P_N)$ および長さ $N$ の整数列 $A_1, A_2, \dots, A_N$ が与えられます。

整数集合 $\lbrace 1,2,\dots, N \rbrace$ の部分集合 $S$ であって以下の条件を満たすものを 良い集合 と呼びます。

- $x \lt y$ かつ $x, y \in S$ である整数の組 $(x, y)$ 全てに対して以下の条件が成り立つ。
$z$ を $P_z = \min(P_x, P_{x+1}, \dots, P_y)$ を満たす整数とする。(このような $z$ は一意に定まる。) この時、$z \in S$ が成り立つ。

良い集合 $S$ の コスト を $\displaystyle \sum_{i \in S} A_i$ として定義します。

$K = 1, 2, \dots, N$ について、サイズ $K$ の良い集合のコストとしてあり得る値の最小値を求めてください。

$T$ 個のテストケースが与えられるので、それぞれについて答えを求めてください。
