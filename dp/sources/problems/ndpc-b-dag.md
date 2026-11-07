# DAG

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_b
**Tags:** DAG path counting
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given a simple directed graph with $N$ vertices and $M$ edges. The vertices are numbered from $1$ to $N$. The $i$-th edge goes from vertex $u_i$ to vertex $v_i$.

This graph has no cycles.

Find the number of paths from vertex $1$ to vertex $N$, modulo $998244353$.

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 10^5$
- $2 \leq N \leq 2 \times 10^5$
- $0 \leq M \leq \min\left(\frac{N(N-1)}{2}, 2 \times 10^5\right)$
- $1 \leq u_i \leq N$
- $1 \leq v_i \leq N$
- If $i \neq j$, then $(u_i, v_i) \neq (u_j, v_j)$
- The given graph is a simple directed graph with no cycles
- The sum of $N$ over all test cases is at most $2 \times 10^5$
- The sum of $M$ over all test cases is at most $2 \times 10^5$
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
N M
u_1 v_1
u_2 v_2
...
u_M v_M
```

### Output
Print $T$ lines. For the $i$-th line, output the answer for the $i$-th test case.

For each test case, output the number of paths from vertex $1$ to vertex $N$, modulo $998244353$.

### Sample Input 1
```
3
4 4
1 2
2 3
3 4
2 4
5 4
1 2
2 3
4 5
1 3
7 18
1 6
1 4
6 4
6 3
4 3
1 5
6 5
4 5
3 5
1 2
6 2
4 2
3 2
5 2
6 7
4 7
5 7
2 7
```

### Sample Output 1
```
2
0
24
```
For the first test case, there are $2$ paths from vertex $1$ to vertex $4$:

- vertex $1$ $\to$ vertex $2$ $\to$ vertex $3$ $\to$ vertex $4$
- vertex $1$ $\to$ vertex $2$ $\to$ vertex $4$

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
頂点に $1$ から $N$ の番号が付いた $N$ 頂点 $M$ 辺の単純有向グラフがあります。$i$ 番目の辺は頂点 $u_i$ から頂点 $v_i$ へ向かう辺です。

このグラフには閉路がありません。

頂点 $1$ から頂点 $N$ へ向かうパスの本数を $998244353$ で割った余りを求めてください。

$T$ 個のテストケースが与えられるので、それぞれについて答えを求めてください。
