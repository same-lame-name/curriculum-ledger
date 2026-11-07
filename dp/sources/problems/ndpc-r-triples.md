# Triples

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_r
**Tags:** combinatorics
**Limits:** 3.5 sec / 1024 MiB

## Statement

### Problem Statement
For non-negative integers $u, v$, we write $u \subseteq v$ to mean $u\ \mathrm{OR}\ v = v$. Here, $\mathrm{OR}$ denotes the bitwise OR operation.

A sequence of triples of non-negative integers $((u_1,v_1,w_1),(u_2,v_2,w_2),\dots,(u_k,v_k,w_k))$ is called a good sequence if it satisfies all of the following conditions:

- $k \geq 2$.
- For all integers $i$ such that $1 \leq i \leq k-1$, it holds that $u_i \subseteq w_{i+1} \subseteq v_i$.

You are given a sequence of triples $A = ((x_1,y_1,z_1), (x_2,y_2,z_2), \dots, (x_N,y_N,z_N))$.

For all $i$ such that $1 \leq i \leq N$, it holds that $x_i \subseteq y_i$.

There are $2^N - N - 1$ subsequences of $A$ with length at least $2$ (counting different choices of indices separately).

Among them, find the number of good sequences, modulo $998244353$.

### Constraints

- $2 \leq N \leq 3 \times 10^5$
- $0 \leq x_i < 2^{24}$
- $0 \leq y_i < 2^{24}$
- $0 \leq z_i < 2^{24}$
- $x_i \ \mathrm{OR}\ y_i = y_i$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If you solve the dataset where $\max(x_i, y_i, z_i) < 2^{18}$ holds for every integer $i$ such that $1 \leq i \leq N$, you will get $4$ points.

### Input
The input is given from standard input in the following format:

```
N
x_1 y_1 z_1
x_2 y_2 z_2
...
x_N y_N z_N
```

### Output
Print the number of good sequences that are subsequences of $A$ with length at least $2$, modulo $998244353$.

### Sample Input 1
```
3
2 6 3
0 7 4
1 5 2
```

### Sample Output 1
```
2
```
There are $2$ sequences that satisfy the condition:

- $((2,6,3),(1,5,2))$
- $((0,7,4),(1,5,2))$

### Sample Input 2
```
8
0 9 5
0 16 3
0 8 4
0 5 23
0 20 29
0 12 26
0 6 0
0 19 8
```

### Sample Output 2
```
9
```

### Sample Input 3
```
13
0 16777215 14827221
8390656 12582911 5535137
4325888 16711679 2641072
8849409 16776703 15212885
8389632 16514814 9612654
0 12517373 13419138
0 16777215 5271292
14464 16236535 6997452
131072 15727483 10218943
16 16646111 15524257
1181961 14647295 5595336
8388768 16775147 5472548
0 16777215 297940
```

### Sample Output 3
```
34
```

## Editorial

### Claim
Process the triples from left to right. Let $dp[j]$ be the number of good sequences ending at position $j$, where a sequence of length $1$ is included. Then
$$dp[j]=1+\sum_{\substack{i<j\\ x_i\subseteq z_j\subseteq y_i}}dp[i],$$
and the required number of good sequences of length at least $2$ is $\sum_j(dp[j]-1)$.

For consecutive triples, the condition $x_i\subseteq z_j\subseteq y_i$ is bitwise: for every bit, $x_i\le z_j\le y_i$. Since $x_i\subseteq y_i$, each previous index $i$ defines a pattern over the bits of length $L$: the bit is fixed to $0$ when $(x_i,y_i)=(0,0)$, fixed to $1$ when $(1,1)$, and is $?$ when $(0,1)$. The DP therefore needs the following two operations $N$ times:
- add: given a $01?$ pattern, add a value to every index matching it;
- get: given a $01$ string, return its accumulated value.

For each bit choose one of three strategies:
1. direct: branch on $?$ and write both $0$ and $1$;
2. $0$-inclusion-exclusion: normalize over $\{0,?\}$, and handle a fixed $1$ as $?-0$;
3. $1$-inclusion-exclusion: normalize over $\{1,?\}$, and handle a fixed $0$ as $?-1$.

The number of elementary operations per bit is:

| strategy | add 0 | add 1 | add ? | get 0 | get 1 |
|---|---:|---:|---:|---:|---:|
| (1) direct | 1 | 1 | 2 | 1 | 1 |
| (2) $0$-inclusion-exclusion | 1 | 2 | 1 | 2 | 1 |
| (3) $1$-inclusion-exclusion | 2 | 1 | 1 | 1 | 2 |

Every column sums to $4$. Choosing one of the three strategies independently and uniformly for each bit makes the expected cost per bit $4/3$, so one add or get operation costs $O((4/3)^L)=O(1.334^L)$ in expectation. With $L\le24$ this gives an expected $O(N\cdot1.334^L)$ algorithm.

### Complexity
Expected $O(N\cdot1.334^L)$ time with $L\le24$; the memory bound is not stated in the source.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
非負整数 $u, v$ に対して $u \subseteq v$ を $u\ \mathrm{OR}\  v = v$ という意味で用います。ここで $\mathrm{OR}$ はビットごとの論理和です。

非負整数の $3$ つ組の列 $((u_1,v_1,w_1),(u_2,v_2,w_2),\dots,(u_k,v_k,w_k))$ が以下の条件を全て満たす時に 良い列 と呼びます。

- $k \geq 2$ である。
- $1 \leq i \leq k-1$ を満たす整数 $i$ 全てに対して $u_i \subseteq w_{i+1} \subseteq v_i$ が成り立つ。

非負整数の $3$ つ組の列 $A = ((x_1,y_1,z_1), (x_2,y_2,z_2), \dots, (x_N,y_N,z_N))$ が与えられます。ここで $1 \leq i \leq N$ を満たす整数 $i$ 全てにおいて $x_i \subseteq y_i$ が成り立ちます。

$A$ の長さ $2$ 以上の部分列は取り出す位置の違いを区別すると $2^N - N - 1$ 通りありますが、それらの中に含まれる良い列の個数を $998244353$ で割った余りを求めてください。
