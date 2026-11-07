# Number and Total

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_j
**Tags:** digit DP, carry
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given a sequence of positive integers $A = (A_1, A_2, \dots, A_N)$ of length $N$, and positive integers $S$ and $T$.

Find the number of sequences of non-negative integers $(c_1, c_2, \dots, c_N)$ that satisfy all of the following conditions, modulo $998244353$:

- $c_1 + c_2 + \dots + c_N = S$
- $A_1 c_1 + A_2 c_2 + \dots + A_N c_N = T$

### Constraints

- $1 \leq N \leq 20$
- $1 \leq S \leq 10^{18}$
- $1 \leq T \leq 10^{18}$
- $1 \leq A_i \leq 200$
- $\displaystyle \sum_{i=1}^N A_i \leq 200$
- All input values are integers

### Input
The input is given from standard input in the following format:

```
N S T
A_1 A_2 ... A_N
```

### Output
Print the number of sequences of non-negative integers $(c_1, c_2, \dots, c_N)$ that satisfy the conditions, modulo $998244353$.

### Sample Input 1
```
4 4 10
1 2 3 4
```

### Sample Output 1
```
5
```
The following $5$ sequences satisfy the conditions:

- $(0,2,2,0)$
- $(0,3,0,1)$
- $(1,0,3,0)$
- $(1,1,1,1)$
- $(2,0,0,2)$

### Sample Input 2
```
10 34016955048482281 206283256471036323
38 35 28 54 3 15 4 16 6 1
```

### Sample Output 2
```
230312634
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
長さ $N$ の正整数列 $A=(A_1,A_2,\dots,A_N)$ と正整数 $S,T$ が与えられます。

以下の条件を全て満たす非負整数列 $(c_1,c_2,\dots,c_N)$ としてあり得るものの個数を $998244353$ で割った余りを求めてください。

- $c_1 + c_2 + \dots + c_N = S$
- $A_1 c_1 + A_2 c_2 + \dots + A_N c_N = T$
