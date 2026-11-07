# Banknote

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_d
**Tags:** state reduction
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
In the AtCoder Kingdom, banknotes of denominations $1$ yen, $10$ yen, $100$ yen, $\dots$, $10^{100}$ yen are used.

Alice wants to pay $N$ yen to Bob. Find the minimum possible total number of banknotes exchanged, which is the sum of:

- the number of banknotes Alice gives to Bob, and
- the number of banknotes Bob gives back as change.

More precisely, for any integer $M \geq N$, consider:

- the minimum number of banknotes needed to represent exactly $M$ yen, and
- the minimum number of banknotes needed to represent exactly $M - N$ yen.

Find the minimum possible value of their sum.

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 10^4$
- $1 \leq N \leq 10^{18}$
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
```

### Output
Print $T$ lines. For the $i$-th line, output the answer for the $i$-th test case.

### Sample Input 1
```
3
7
34
123456789123456789
```

### Sample Output 1
```
4
7
44
```
In the first test case:

- Alice pays $10$ yen using one $10$-yen banknote, and
- Bob returns $3$ yen as change using three $1$-yen banknotes.

In this case, the total number of banknotes exchanged is $4$, which is optimal.

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
AtCoder 王国では $1$ 円紙幣, $10$ 円紙幣, $100$ 円紙幣, $\dots$, $10^{100}$ 円紙幣が流通しています。

Alice は Bob に $N$ 円を支払うことにしました。Alice が Bob に支払う紙幣の枚数とお釣りとしてもらう紙幣の枚数の合計の最小値を求めてください。

厳密に述べると、$N$ 以上の整数値を取る $M$ に対して「$M$ 円ちょうどを表すのに必要な最小の紙幣の枚数」と「$M-N$ 円ちょうどを表すのに必要な最小の紙幣の枚数」の和の最小値を求めてください。

$T$ 個のテストケースが与えられるので、それぞれについて答えを求めてください。
