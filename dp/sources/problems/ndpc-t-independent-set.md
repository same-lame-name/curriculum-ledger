# Independent Set

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_t
**Tags:** static top tree, tree DP
**Limits:** 10 sec / 1024 MiB

## Statement

### Problem Statement
You are given a tree with $N$ vertices, numbered from $1$ to $N$. The $i$-th edge connects vertices $u_i$ and $v_i$.

A set of vertices $S$ is called an independent set if it satisfies the following condition:

- For any two distinct vertices $u, v \in S$, $u$ and $v$ are not adjacent in the tree.

For a vertex $v$, let $F_v$ be the set of all independent sets $S$ such that $v \in S$.

You are given $Q$ queries. In each query, you are given an integer $v$ ($1 \leq v \leq N$) and an integer $q$. Compute:

$\displaystyle \left( \sum_{S \in F_v} q^{|S|}\right) \bmod 998244353$

Here, $|S|$ denotes the size of the set $S$.

### Constraints

- $2 \leq N \leq 1.3 \times 10^5$
- $1 \leq Q \leq 1.3 \times 10^5$
- $1 \leq u_i < v_i \leq N$
- The given graph is a tree
- $1 \leq v \leq N$
- $1 \leq q < 998244353$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If all queries satisfy $v=1$, you will get $5$ points.

### Input
The input is given from standard input in the following format:

```
N Q
u_1 v_1
u_2 v_2
...
u_N-1 v_N-1
query_1
query_2
...
query_Q
```
Each query is given in the following format:

```
v q
```

### Output
Print $Q$ lines. On the $i$-th line, output the answer to the $i$-th query.

### Sample Input 1
```
4 2
1 2
1 3
2 4
1 1
2 3
```

### Sample Output 1
```
2
12
```
Consider the first query. The independent sets that contain vertex $1$ are ${1}$ and ${1, 4}$, so there are $2$ such sets. Therefore, output $1^1 + 1^2 = 2$.

### Sample Input 2
```
10 10
1 2
2 3
1 4
1 5
1 6
6 7
6 8
5 9
1 10
1 1
1 2
1 3
1 4
1 5
1 6
1 7
1 8
1 9
1 10
```

### Sample Output 2
```
16
162
768
2500
6480
14406
28672
52488
90000
146410
```

### Sample Input 3
```
10 10
1 2
1 3
2 4
4 5
4 6
2 7
5 8
8 9
6 10
5 844033520
8 780395612
2 285523486
6 13801767
3 487663185
3 667406485
7 672229269
7 207478896
5 769551740
7 806405364
```

### Sample Output 3
```
665599367
675643489
193550820
987507475
230555342
555586355
204648376
83113599
299301383
545057926
```

## Editorial

### Claim
For a directed edge $u\to v$, let $A_{u\to v}(q)$ be the generating polynomial of independent sets in the component on the $u$ side of the edge $uv$, with $u$ not selected, and let $B_{u\to v}(q)$ be the same polynomial with $u$ selected. At a leaf $u$ whose only neighbour is $v$,
$$A_{u\to v}(q)=1,\qquad B_{u\to v}(q)=q.$$
For a vertex $u$ with neighbours other than $v$,
$$A_{u\to v}(q)=\prod_{c\ne v}\bigl(A_{c\to u}(q)+B_{c\to u}(q)\bigr),\qquad
B_{u\to v}(q)=q\prod_{c\ne v}A_{c\to u}(q).$$
Since a query requires $v$ itself to be selected, its answer is
$$F_v(q)=q\prod_{u\in N(v)}A_{u\to v}(q).$$

A static top tree stores these products as $2\times2$ transfer matrices whose entries are polynomials in $q$: the two boundary states are "selected" and "not selected", a leaf contributes weight $q$ or $1$, and merging two clusters composes their matrices. The source's "special divide and conquer" on the static top tree evaluates these matrices at the queries' $q$ values offline, so that all $Q$ values $F_v(q)$ are obtained without recomputing the tree DP for every query.

### Complexity
The source states no time or memory bound. A static top tree has height $O(\log N)$, so each query touches $O(\log N)$ clusters; the intended offline divide-and-conquer is what keeps the total within the limits.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
頂点に $1$ から $N$ の番号が付いた $N$ 頂点の木が与えられます。$i$ 番目の辺は頂点 $u_i$ と頂点 $v_i$ を結ぶ辺です。

頂点の集合 $S$ が次の条件を満たす時、$S$ を 独立集合 と呼びます。

- $S$ に含まれる任意の異なる $2$ 頂点 $u, v$ について、$u$ と $v$ は木の上で隣接していない。

頂点 $v$ について、$v \in S$ を満たす独立集合全てからなる集合を $F_v$ と表します。

$Q$ 個のクエリを処理してください。クエリでは $1 \leq v \leq N$ を満たす整数 $v$ および整数 $q$ が与えられるので、

$\displaystyle \left( \sum_{S \in F_v} q^{|S|}\right) \bmod 998244353$

を計算してください。ここで $|S|$ は集合のサイズを意味します。
