# LCM

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_l
**Tags:** divisor zeta transform
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given a positive integer $N$ and a permutation $A = (A_1, A_2, \dots, A_N)$ of $(1, 2, \dots, N)$.

Consider a directed graph $G$ with $N$ vertices numbered from $1$ to $N$. For every pair of integers $(i, j)$ such that $1 \leq i < j \leq N$, there are $\mathrm{LCM}(A_i, A_j)$ directed edges from vertex $i$ to vertex $j$. (Here, $\mathrm{LCM}$ denotes the least common multiple.) There are no other edges in $G$.

For each $v = 2, 3, \dots, N$, find the number of paths from vertex $1$ to vertex $v$, modulo $998244353$. Here, two paths are considered different if the sets of edges they pass through are different.

### Constraints

- $2 \leq N \leq 2 \times 10^5$
- $(A_1, A_2, \dots, A_N)$ is a permutation of $(1, 2, \dots, N)$
- All input values are integers

### Input
The input is given from standard input in the following format:

```
N
A_1 A_2 ... A_N
```

### Output
Print $N-1$ lines. On the $i$-th line, output the answer for $v = i+1$.

### Sample Input 1
```
4
3 2 1 4
```

### Sample Output 1
```
6
15
96
```
The directed edges in $G$ are as follows:

- From vertex $1$ to vertex $2$: $6$ edges
- From vertex $1$ to vertex $3$: $3$ edges
- From vertex $1$ to vertex $4$: $12$ edges
- From vertex $2$ to vertex $3$: $2$ edges
- From vertex $2$ to vertex $4$: $4$ edges
- From vertex $3$ to vertex $4$: $4$ edges

### Sample Input 2
```
13
12 3 2 4 10 9 5 8 1 6 11 7 13
```

### Sample Output 2
```
12
84
492
11100
1018368
45948480
913466263
559040529
720204824
935993195
339767199
889449065
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
正整数 $N$ と $(1, 2, \dots, N)$ の順列 $A=(A_1,A_2,\dots,A_N)$ が与えられます。

頂点に $1$ から $N$ の番号が付いた $N$ 頂点の有向グラフ $G$ を考えます。$1 \leq i \lt j \leq N$ を満たす正整数の組 $(i,j)$ それぞれについて、頂点 $i$ から頂点 $j$ に向かう辺が $\mathrm{LCM}(A_i, A_j)$ 本存在します($\mathrm{LCM}$ は最小公倍数を意味する関数)。$G$ にそれ以外の辺はありません。

$v = 2, 3, \dots, N$ について、頂点 $1$ から頂点 $v$ へ向かうパスの本数を $998244353$ で割った余りを求めてください。ここで、$2$ 本のパスは通った辺の集合が異なる時に区別して数えます。
