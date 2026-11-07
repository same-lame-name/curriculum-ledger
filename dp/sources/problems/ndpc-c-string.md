# String

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_c
**Tags:** DP on DP, automaton DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given three strings $S_1, S_2, S_3$, each consisting of lowercase English letters.

Find the number of strings $T$ of length $N$ (also consisting of lowercase English letters) such that none of $S_1, S_2, S_3$ appear as a subsequence of $T$. Output the answer modulo $998244353$.

### Constraints

- $1 \leq N \leq 10^3$
- $S_1, S_2, S_3$ are non-empty strings of lowercase English letters with length at most $10$
- $N$ is an integer

### Input
The input is given from standard input in the following format:

```
N
S_1 S_2 S_3
```

### Output
Print the number of strings $T$ of length $N$ consisting of lowercase English letters such that none of $S_1, S_2, S_3$ appear as a subsequence of $T$, modulo $998244353$.

### Sample Input 1
```
2
abc de f
```

### Sample Output 1
```
624
```
There are $676$ strings of length $2$ consisting of lowercase English letters. Among them, $1$ string contains $S_2$ = `de`, and $51$ strings contain $S_3$ = `f`. These sets do not overlap. Therefore, the answer is $676 - 1 - 51 = 624$.

### Sample Input 2
```
4
ab ab ab
```

### Sample Output 2
```
453125
```
Note that subsequence in the condition is different from substring.

For example, `accb` contains `ab` as a subsequence, so it does not satisfy the condition.

### Sample Input 3
```
1000
atcoder algorithm lectures
```

### Sample Output 3
```
669410767
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
英小文字からなる $3$ 個の文字列 $S_1, S_2, S_3$ が与えられます。

長さ $N$ の英小文字からなる文字列 $T$ であって $S_1, S_2, S_3$ のいずれも部分列として含まないものの個数を $998244353$ で割った余りを求めてください。
