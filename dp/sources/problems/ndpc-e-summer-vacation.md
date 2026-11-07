# Summer Vacation

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_e
**Tags:** doubling
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Your summer vacation starts today and lasts for $N$ days.

There are $M$ events. The $i$-th event starts on the morning of day $A_i$ and ends on the evening of day $B_i$.

You are given $Q$ queries. In each query, you are given two integers $L$ and $R$, and you need to answer the following:

You decide to attend as many events as possible during the period from day $L$ to day $R$.

However, you cannot join or leave an event in the middle. Therefore, you cannot attend multiple events whose time periods overlap, and you also cannot attend any event that starts before day $L$ or ends after day $R$.

If you choose the events optimally, what is the maximum number of events you can attend?

### Constraints

- $1 \leq N \leq 2 \times 10^5$
- $1 \leq M \leq 2 \times 10^5$
- $1 \leq Q \leq 2 \times 10^5$
- $1 \leq A_i \leq B_i \leq N$
- $1 \leq L \leq R \leq N$
- All input values are integers

### Input
The input is given from standard input in the following format:

```
N M Q
A_1 B_1
A_2 B_2
...
A_M B_M
query_1
query_2
...
query_Q
```
Each query is given in the following format:

```
L R
```

### Output
Print $Q$ lines. For the $i$-th line, output the answer to the $i$-th query.

### Sample Input 1
```
5 3 3
1 3
4 5
2 2
1 5
1 1
3 5
```

### Sample Output 1
```
2
0
1
```
For example, in the first query, you can attend the 1st and 2nd events, and this is the maximum.

### Sample Input 2
```
9 13 8
4 6
1 5
8 9
5 6
1 7
4 9
4 6
2 8
5 6
5 8
2 6
3 7
1 3
5 7
5 7
5 7
3 4
1 8
2 6
6 8
8 9
```

### Sample Output 2
```
1
1
1
0
2
1
0
1
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
あなたは今日から夏休みです。夏休みは $N$ 日間からなります。

$M$ 個のイベントがあります。$i$ 個目のイベントは $A_i$ 日目の朝にはじまって $B_i$ 日目の夜に終わります。

$Q$ 個のクエリに答えてください。クエリでは $L, R$ が与えられるので、次の問いに答えてください。

あなたは $L$ 日目から $R$ 日目の間にできるだけたくさんのイベントに参加することにしました。

ただし、イベントは途中参加や途中抜けが出来ません。よって期間が被っている複数のイベントに参加したり、$L$ 日目より前や $R$ 日目より後を期間に含むイベントに参加することはできません。

参加するイベントを上手く選んだ時、最大で何個のイベントに参加できますか？
