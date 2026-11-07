# Permutation

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_t
**Tags:** permutation DP, prefix-sum optimisation
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Let $N$ be a positive integer.
You are given a string $s$ of length $N - 1$, consisting of `<` and `>`.

Find the number of permutations $(p_1, p_2, \ldots, p_N)$ of $(1, 2, \ldots, N)$ that satisfy the following condition, modulo $10^9 + 7$:

- For each $i$ ($1 \leq i \leq N - 1$), $p_i < p_{i + 1}$ if the $i$-th character in $s$ is `<`, and $p_i > p_{i + 1}$ if the $i$-th character in $s$ is `>`.

### Constraints

- $N$ is an integer.
- $2 \leq N \leq 3000$
- $s$ is a string of length $N - 1$.
- $s$ consists of `<` and `>`.

### Input
Input is given from Standard Input in the following format:

```
N
s
```

### Output
Print the number of permutations that satisfy the condition, modulo $10^9 + 7$.

### Sample Input 1
```
4
<><
```

### Sample Output 1
```
5
```

There are five permutations that satisfy the condition, as follows:

- $(1, 3, 2, 4)$
- $(1, 4, 2, 3)$
- $(2, 3, 1, 4)$
- $(2, 4, 1, 3)$
- $(3, 4, 1, 2)$

### Sample Input 2
```
5
<<<<
```

### Sample Output 2
```
1
```

There is one permutation that satisfies the condition, as follows:

- $(1, 2, 3, 4, 5)$

### Sample Input 3
```
20
>>>><>>><>><>>><<>>
```

### Sample Output 3
```
217136290
```

Be sure to print the number modulo $10^9 + 7$.

## Editorial

`dp[i][j]` is the number of permutations of $1..i+1$ matching the first $i$ signs, where the last element has **rank** $j$ among those $i+1$ values. When a new last element of rank $j$ is appended, every old element of rank $\ge j$ shifts up by one, so the previous last rank $k$ must satisfy the sign:

- if the new sign is `<`, then $k < j$, so the transition is a prefix sum of `dp[i-1]`;
- if the new sign is `>`, then $k \ge j$, so the transition is a suffix sum.

The base is `dp[0][1] = 1`. Prefix sums make the table $O(N^2)$.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAXN = 3000;

const int MOD = 1e9 + 7;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}
int sub(int i, int j) {
	if ((i -= j) < 0)
		i += MOD;
	return i;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	string s;

	cin >> n >> s;
	static int dp[MAXN + 1], dq[MAXN + 1];
	dp[1] = 1;
	for (int i = 1; i < n; ++i) {
		for (int j = 1; j <= i + 1; ++j)
			dp[j] = add(dp[j], dp[j - 1]);
		for (int j = 1; j <= i + 1; ++j)
			if (s[i - 1] == '>')
				dq[j] = sub(dp[i], dp[j - 1]);
			else
				dq[j] = dp[j - 1];
		swap(dp, dq);
	}
	int ans = 0;
	for (int i = 1; i <= n; ++i)
		ans = add(ans, dp[i]);
	cout << ans << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ を正整数とします。
長さ $N - 1$ の文字列 $s$ が与えられます。
$s$ は `<` と `>` からなります。

$(1, 2, \ldots, N)$ を並べ替えた順列 $(p_1, p_2, \ldots, p_N)$ であって、次の条件を満たすものは何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。

- 各 $i$ ($1 \leq i \leq N - 1$) について、$s$ の $i$ 文字目が `<` の場合は $p_i < p_{i + 1}$ であり、$s$ の $i$ 文字目が `>` の場合は $p_i > p_{i + 1}$ である。
