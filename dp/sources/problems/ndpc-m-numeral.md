# Numeral

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_m
**Tags:** SOS DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given a string $S$ of length $2^N$ consisting of characters `1`, `2`, $\dots$, `9`.

For each non-negative integer $n$ such that $0 \leq n \leq 2^N - 1$, define $f(n)$ as follows:

- List all non-negative integers $i$ such that $n \ \mathrm{OR} \ i = n$, and sort them in increasing order. Let them be $i_1, i_2, \dots, i_k$. Here, $\mathrm{OR}$ denotes the bitwise OR operation.
- Let $T$ be the string formed by taking the $(i_1+1)$-th, $(i_2+1)$-th, $\dots$, $(i_k+1)$-th characters of $S$ in this order.
- Interpret $T$ as a decimal integer, and let its value be $X$. Then define $f(n) = X \bmod 998244353$.

Compute all values $f(0), f(1), \dots, f(2^N - 1)$, and output the value of the following expression. Here, $\mathrm{XOR}$ denotes the bitwise exclusive OR operation.

$\displaystyle \sum_{n=0}^{2^N-1} \left(f(n) \ \mathrm{XOR} \ n\right)$

### Constraints

- $1 \leq N \leq 22$
- $S$ is a string of length $2^N$ consisting of `1`, `2`, $\dots$, `9`

### Input
The input is given from standard input in the following format:

```
N
S
```

### Output
Print $\displaystyle \sum_{n=0}^{2^N-1} \left(f(n) \ \mathrm{XOR} \ n\right)$.

### Sample Input 1
```
2
1234
```

### Sample Output 1
```
1262
```
For all $n$ such that $0 \leq n \leq 2^N-1$, the values of $f(n)$ are:

- When $n=0$, $f(n) = 1$
- When $n=1$, $f(n) = 12$
- When $n=2$, $f(n) = 13$
- When $n=3$, $f(n) = 1234$

Therefore, output $(1 \ \mathrm{XOR} \ 0) + (12 \ \mathrm{XOR} \ 1) + (13 \ \mathrm{XOR} \ 2) + (1234 \ \mathrm{XOR} \ 3) = 1 + 13 + 15 + 1233 = 1262$.

### Sample Input 2
```
4
6415986517946482
```

### Sample Output 2
```
790534415
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
`1`, `2`, $\dots$, `9` からなる長さ $2^N$ の文字列 $S$ が与えられます。

$0 \leq n \leq 2^N-1$ を満たす非負整数 $n$ に対して $f(n)$ を以下の手順に従って定義します。

- $n \ \mathrm{OR} \ i = n$ を満たす非負整数 $i$ を全て列挙して昇順に並べたものを $i_1, i_2, \dots, i_k$ と置く。ここで $\mathrm{OR}$ はビットごとの論理和を意味する。
- $S$ の $i_1+1$ 文字目, $i_2+1$ 文字目, $\dots$, $i_k+1$ 文字目をこの順に並べてできる文字列を $T$ とする。
- $T$ を $10$ 進整数とみなした時の値を $X$ とする。そして、$f(n) = X \bmod 998244353$ とする。

$f(0), f(1), \dots, f(2^N-1)$ を全て計算してください。そして、次式の値を出力してください。ここで $\mathrm{XOR}$ はビットごとの排他的論理和を意味します。

$\displaystyle \sum_{n=0}^{2^N-1} \left(f(n) \ \mathrm{XOR} \ n\right)$
