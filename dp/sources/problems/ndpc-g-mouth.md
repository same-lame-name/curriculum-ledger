# Mouth

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_g
**Tags:** ear DP, segment tree
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given an integer sequence $A = (A_1, A_2, \dots, A_N)$ of length $N$.

Process $Q$ queries. In each query, you are given an integer $i$ ($1 \leq i \leq N$) and a non-negative integer $v$. Update $A_i$ to $v$, and then solve the following problem. (The updates are permanent.)

There are $N$ people standing on a number line at positions $1$ to $N$, each with their mouth open. Person $i$ is at position $i$. Each person has a parameter called hunger, and the hunger of person $i$ is $A_i$.

You have an unlimited number of candies. You decide to perform the following sequence of actions exactly once to feed them:

- First, choose an integer $x$ such that $1 \leq x \leq N$, and stand at position $x$.
- Then, perform the following operations any number of times (possibly zero):
Let your current position be $y$. Move to position $y-1$, $y$, or $y+1$. However, you cannot move to a position where no person is standing.

- Throw one candy into the mouth of the person at your current position.

After finishing all operations, let $B_i$ be the number of candies given to person $i$. Find the minimum possible value of $\displaystyle \sum_{i=1}^N \vert A_i - B_i \vert$.

### Constraints

- $1 \leq N \leq 10^5$
- $1 \leq Q \leq 10^5$
- $0 \leq A_i \leq 10^9$
- $1 \leq i \leq N$
- $0 \leq v \leq 10^9$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If you solve the dataset with $Q \leq 10$, you will get $2$ points.

### Input
The input is given from standard input in the following format:

```
N Q
A_1 A_2 ... A_N
query_1
query_2
...
query_Q
```
Each query is given in the following format:

```
i v
```

### Output
Print $Q$ lines. For the $i$-th line, output the answer to the $i$-th query.

### Sample Input 1
```
4 3
1 3 0 2
2 0
1 3
3 5
```

### Sample Output 1
```
1
2
1
```
Consider processing the first query. You need to solve the problem for $A = (1,0,0,2)$.

In this case, the following actions achieve a value of $1$, which is optimal:

- Choose $x=3$ and stand at position $3$.
- Move to position $4$ and give one candy to person $4$.
- Stay at position $4$ again and give another candy to person $4$.
- End the operations. The resulting $B$ becomes $(0,0,0,2)$.

### Sample Input 2
```
10 9
1 0 0 0 0 0 4 0 0 2
3 2
7 0
1 9
6 4
1 1
10 0
1 0
6 0
5 7
```

### Sample Output 2
```
5
3
3
5
5
3
2
0
1
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
長さ $N$ の整数列 $A=(A_1,A_2,\dots,A_N)$ が与えられます。

$Q$ 個のクエリを処理してください。クエリでは $1 \leq i \leq N$ を満たす整数 $i$ および非負整数 $v$ が与えられるので、$A_i$ を $v$ に更新して、以下の問題を解いてください。(更新は永続的です。)

$1$ から $N$ の番号がついた $N$ 人の人が口を開けた状態で数直線上に並んでいます。人 $i$ は地点 $i$ にいます。各人は 空腹度 というパラメータを持っていて、人 $i$ の空腹度は $A_i$ です。

あなたはキャンディを無数に持っています。あなたはみんなにキャンディを食べさせてあげるために次の一連の行動を $1$ 回だけ行うことにしました。

- まず、$1 \leq x \leq N$ を満たす整数 $x$ を選び、地点 $x$ に立つ。
- そして、次の操作を $0$ 回以上自由な回数行う。
今いる地点を $y$ として、$y-1, y, y+1$ のいずれかの地点に移動する。ただし、人が立っていない地点に移動することは出来ない。

- 今いる地点にいる人の口にキャンディを $1$ 個放り込む。

行動を終了した時点で、人 $i$ の口に放り込んだキャンディの個数を $B_i$ とします。$\displaystyle \sum_{i=1}^N \vert A_i - B_i \vert$ としてあり得る最小値を求めてください。
