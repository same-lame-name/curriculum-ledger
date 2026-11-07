# Update Positions

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_i
**Tags:** insertion DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
For a sequence $B = (B_1, B_2, \dots, B_N)$ of length $N$, define prefix max update positions and suffix max update positions as follows:

- An index $i$ is called a prefix max update position if for all $1 \leq j < i$, we have $B_j < B_i$.
- An index $i$ is called a suffix max update position if for all $i < j \leq N$, we have $B_j < B_i$.

You are given a sequence $A = (A_1, A_2, \dots, A_N)$ of length $N$, and integers $L$ and $R$.

Consider all sequences obtained by rearranging the elements of $A$. Among them, count how many sequences have exactly $L$ prefix max update positions and exactly $R$ suffix max update positions. Output the answer modulo $998244353$.

Two sequences are considered the same if they are identical as sequences.

### Constraints

- $1 \leq N \leq 400$
- $1 \leq L \leq N$
- $1 \leq R \leq N$
- $1 \leq A_i \leq N$
- All input values are integers

### Input
The input is given from standard input in the following format:

```
N L R
A_1 A_2 ... A_N
```

### Output
Print the number of sequences satisfying the conditions, modulo $998244353$.

### Sample Input 1
```
4 2 1
1 2 3 4
```

### Sample Output 1
```
2
```
There are $2$ such sequences:

- $(3,2,1,4)$
- $(3,1,2,4)$

### Sample Input 2
```
10 3 2
6 10 4 1 5 9 8 6 5 1
```

### Sample Output 2
```
50424
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
長さ $N$ の数列 $B = (B_1, B_2, \dots, B_N)$ に対して、prefix max の更新点 と suffix max の更新点 を次のように定義します。

- 任意の $1 \leq j \lt i$ について $B_j \lt B_i$ が成り立つ整数 $i$ を prefix max の更新点と呼ぶ。
- 任意の $i \lt j \leq N$ について $B_j \lt B_i$ が成り立つ整数 $i$ を suffix max の更新点と呼ぶ。

長さ $N$ の数列 $A=(A_1, A_2, \dots, A_N)$ および $L,R$ が与えられます。

$A$ の要素を並べ替えてできる数列であって、prefix max の更新点が $L$ 個、suffix max の更新点が $R$ 個であるものとしてあり得る数列の個数を $998244353$ で割った余りを求めてください。ただし、$2$ つの数列は列として一致する時に同じであるとみなします。
