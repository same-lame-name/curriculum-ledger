# Knapsack

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_n
**Tags:** unbounded knapsack
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are infinitely many items of each of $N$ types. The $i$-th type of item has weight $i$ and value $v_i$.

You are given $Q$ queries. In each query, you are given a positive integer $W$.

Find the maximum possible total value when you choose some items such that the total weight is exactly $W$.

### Constraints

- $1 \leq N \leq 4000$
- $1 \leq Q \leq 2 \times 10^5$
- $0 \leq v_i \leq 10^9$
- $1 \leq W \leq 10^9$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If you solve the dataset with $N \leq 300$, you will get $4$ points.

### Input
The input is given from standard input in the following format:

```
N Q
v_1 v_2 ... v_N
query_1
query_2
...
query_Q
```
Each query is given in the following format:

```
W
```

### Output
Print $Q$ lines. On the $i$-th line, output the answer for the $i$-th query.

### Sample Input 1
```
4 9
2 1 7 4
1
2
3
4
5
6
7
8
9
```

### Sample Output 1
```
2
4
7
9
11
14
16
18
21
```
For example, in the 6th query, $W=6$.

If you take two items of type $3$, the total value becomes $7 + 7 = 14$, which is the maximum.

### Sample Input 2
```
10 10
104 231 361 478 661 765 963 1132 1402 1552
1
10
15
27
48
100
853822501
687675302
281611653
844033520
```

### Sample Output 2
```
104
1552
2213
4206
7460
15572
133006571782
107124530332
43868837466
131481666104
```

## Editorial

### Claim
Let
$$dp[w]=\max\Bigl\{\sum_{i=1}^N c_i v_i:\sum_{i=1}^N i\,c_i=w,\ c_i\in\mathbb Z_{\ge0}\Bigr\}$$
be the best value for an exact total weight $w$ using unlimited copies of the $N$ item types. The base is $dp[0]=0$ and $dp[w]=-\infty$ for $w>0$, and the unbounded-knapsack transition is
$$dp[w]=\max_{1\le i\le\min(N,w)}\bigl(dp[w-i]+v_i\bigr),$$
evaluated for increasing $w$.

The author's claim is that it is enough to tabulate $dp[0],dp[1],\dots,dp[N^2]$: for $W>N^2$ the answer follows from a greedy rule, so the problem is reduced to DP on this range. A direct implementation of the recurrence takes $O(N^3)$ time and earns the subtask for $N\le300$. Adding a pruning to the direct implementation improves the bound to $O(N^2\log N)$; the pruning is the three-line pseudocode in the cited 2022 paper.

### Complexity
$O(N^2\log N+Q)$ time and $O(N^2)$ memory for the full solution; the direct $O(N^3)$ implementation is the partial solution.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
$N$ 種類の品物がそれぞれ無数にあります。$i$ 種類目の品物は重さ $i$、価値 $v_i$ です。

$Q$ 個のクエリに答えてください。各クエリでは正整数 $W$ が与えられるので、重さの総和がちょうど $W$ になるように品物を集めた時の、集めた品物の価値の総和としてあり得る最大値を求めてください。
