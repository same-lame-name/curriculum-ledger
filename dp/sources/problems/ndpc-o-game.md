# Game

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_o
**Tags:** Alien DP, max-plus convolution
**Limits:** 4 sec / 1024 MiB

## Statement

### Problem Statement
You are going to play a game. The game consists of actions over $N$ days. Each day, you choose an integer $x \in {0,1,2}$, pay $x$ yen, and perform action $x$. If you perform action $x$ on day $i$, you gain $A_{i,x}$ experience points. You cannot perform more than one action per day.

You are given $Q$ queries. In each query, you are given a pair of integers $(d, b)$ such that $1 \leq d \leq N$ and $0 \leq b \leq 2d$. Solve the following problem:

- Suppose you spend exactly $b$ yen in total from day $1$ to day $d$. What is the maximum possible total experience you can gain during these $d$ days?

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 10^4$
- $1 \leq N \leq 2.5 \times 10^5$
- $1 \leq Q \leq 10^4$
- $0 \leq A_{i,x} \leq 10^9$
- $1 \leq d \leq N$
- $0 \leq b \leq 2d$
- The sum of $N$ over all test cases is at most $2.5 \times 10^5$
- The sum of $Q$ over all test cases is at most $10^4$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If all queries satisfy $d = N$, you will get $5$ points.

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
N Q
A_1,0 A_1,1 A_1,2
A_2,0 A_2,1 A_2,2
...
A_N,0 A_N,1 A_N,2
query_1
query_2
...
query_Q
```
Each query is given in the following format:

```
d b
```

### Output
Output the answers for all test cases in order.

For each test case, print $Q$ lines. On the $i$-th line, output the answer to the $i$-th query.

### Sample Input 1
```
2
3 3
1 3 2
4 8 1
1 6 9
1 1
2 3
3 3
5 5
45 58 82
47 39 94
36 54 74
80 61 95
61 57 69
2 4
5 7
4 1
5 5
3 0
```

### Sample Output 1
```
3
10
18
176
387
226
371
128
```
For example, consider the $3$-rd query of the first test case: $d=3, b=3$.

You can achieve a total experience of $18$ in the following way, which is optimal:

- Day $1$: choose $x=0$. Pay $0$ yen and gain $A_{1,0}=1$ experience.
- Day $2$: choose $x=1$. Pay $1$ yen and gain $A_{2,1}=8$ experience.
- Day $3$: choose $x=2$. Pay $2$ yen and gain $A_{3,2}=9$ experience.

### Sample Input 2
```
1
10 10
76 30 16
30 94 48
60 67 90
43 63 47
49 33 66
14 49 79
39 62 37
34 79 96
29 86 85
59 42 69
10 16
10 13
10 8
10 20
10 2
10 5
10 4
10 0
10 15
10 19
```

### Sample Output 2
```
764
770
724
633
554
664
634
433
780
679
```

## Editorial

### Claim
For $1\le L\le R\le N$ and an integer $x$, let $f_{L,R}(x)$ be the maximum experience obtainable on days $L,\dots,R$ while paying exactly $x$ yen in total. For a single day $L=R$,
$$f_{L,L}(0)=A_{L,0},\qquad f_{L,L}(1)=A_{L,1},\qquad f_{L,L}(2)=A_{L,2},$$
and $f_{L,L}(x)=-\infty$ for all other $x$. For a split at $M$,
$$f_{L,R}(x)=\max_{0\le y\le 2(M-L+1)}\bigl(f_{L,M}(y)+f_{M+1,R}(x-y)\bigr),$$
a max-plus convolution.

Split each sequence by parity:
$$g_{L,R}(x)=f_{L,R}(2x),\qquad h_{L,R}(x)=f_{L,R}(2x+1).$$
Both $g_{L,R}$ and $h_{L,R}$ are concave. The author's proof is the inequality
$$f_{L,R}(x)+f_{L,R}(x+4)\le 2f_{L,R}(x+2),$$
which is the three-point concavity condition on each parity class. Because $g$ and $h$ are concave, their max-plus convolution is computed in linear time, so the arrays can be merged bottom-up as in a segment tree. For the subtask $d=N$, building the root once answers every query by one lookup in $g_{1,N}$ or $h_{1,N}$.

For the full score the intended solution is Alien DP: it removes the exact-budget constraint with a Lagrange multiplier and answers one query in $O(\log^3 N)$ time.

### Complexity
Subtask ($d=N$): $O(N\log N+Q)$ time after one bottom-up merge, $O(N\log N)$ memory. Full score: $O(\log^3 N)$ time per query, as stated by the author; the preprocessing bound is not stated.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
あなたはゲームをすることにしました。ゲームは $N$ 日間の行動からなります。あなたは毎日整数 $x \in \lbrace 0,1,2 \rbrace$ を $1$ つ選び、$x$ 円を支払って行動 $x$ を行います。$i$ 日目に行動 $x$ を行うと $A_{i,x}$ の経験値を得ます。$1$ 日に複数回行動を行うことは出来ません。

$Q$ 個のクエリに答えてください。クエリでは $1 \leq d \leq N, 0 \leq b \leq 2d$ を満たす整数の組 $(d,b)$ が与えられるので、次の問題を解いてください。

- $1$ 日目から $d$ 日目までに合計でちょうど $b$ 円支払ったとする。この時、$1$ 日目から $d$ 日目までに得た経験値の総和としてあり得る最大値を求めよ。

$T$ 個のテストケースが与えられるので、それぞれについて問題を解いてください。
