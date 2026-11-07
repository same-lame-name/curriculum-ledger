# LIS

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_p
**Tags:** state design
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
For a positive integer $n$, define $f(n)$ as follows:

- Let $n$ have $d$ digits in decimal representation. Define a sequence $A = (A_1, \dots, A_d)$ of length $d$ as follows:
$A_i$ is the $i$-th digit from the left in the decimal representation of $n$.

- Let $f(n)$ be the length of the longest strictly increasing subsequence of $A$.

For example, $f(347) = 3$, $f(1192) = 2$, $f(10123456789) = 10$, and $f(11111) = 1$.

You are given a positive integer $N$.

Count the number of positive integers $x$ such that by repeatedly applying the operation $x \to x + f(x)$ zero or more times, you can obtain $N$.

You are given $T$ test cases. Solve each of them.

### Constraints

- $1 \leq T \leq 2 \times 10^4$
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
Print $T$ lines. On the $i$-th line, output the answer for the $i$-th test case.

### Sample Input 1
```
6
7
110
1000000000000000000
567784738694904180
555056967895592095
942135357890920474
```

### Sample Output 1
```
7
5
1000000000000000000
23644
22551
60795
```
For example, in the second test case, starting from $x = 102$ and repeatedly applying the operation $x \to x + f(x)$:

- $102 \to 104 \to 106 \to 108 \to 110$

we can obtain $N = 110$. The only values of $x$ satisfying the condition are $x = 102, 104, 106, 108, 110$, so there are $5$ in total.

## Editorial

### Claim
Let $g(x)=x+f(x)$, where $f(x)$ is the length of the longest strictly increasing subsequence of the decimal digits of $x$. The answer is the number of positive integers $x$ whose forward orbit under $g$ contains $N$; $x=N$ is counted because zero operations are allowed.

The editorial does not give a state, a transition, or a base case for this count. Its entire method is the sentence that adapting the $O(\log^3 N)$-time solution of *uninteresting bit sugoroku* (yukicoder No.262) to this $f$ solves the problem. In particular, no digit-DP state for $f$, no way of grouping the predecessors $x$ of a value $y$, and no accumulation rule for the answer are stated.

### Complexity
$O(\log^3 N)$ time per test case, as stated in the source; the memory bound is not stated.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
正整数 $n$ に対して $f(n)$ を以下の手順によって得られる整数とします。

- $n$ が $10$ 進表記で $d$ 桁であるとする。長さ $d$ の数列 $A=(A_1,\dots,A_d)$ を以下のように定める。
$A_i$ は「$n$ の $10$ 進表記を文字列とみなした時の左から $i$ 文字目の数字」を数とみなした値である。

- $A$ の最長狭義増加部分列の長さを $f(n)$ とする。

例えば $f(347) = 3, f(1192) = 2, f(10123456789) = 10, f(11111) = 1$ です。

正整数 $N$ が与えられます。

正整数 $x$ であって、$x$ を $x+f(x)$ に変換する操作を $0$ 回以上繰り返して $N$ を得ることが出来るものの個数を求めてください。

$T$ 個のテストケースが与えられるので、それぞれについて答えを求めてください。
