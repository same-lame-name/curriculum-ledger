# Iwi

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_iwi
**Tags:** interval DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

$s$ is a string consisting of `i` and `w`. Snuke can repeatedly perform the following operation: choose a contiguous block of three characters that reads `iwi` and remove it. (When `iwi` is removed, the parts of the string to its left and right are joined, producing a new string that is three characters shorter.) Find the maximum number of operations he can perform.

### Constraints

- $1 \le |s| \le 300$
- Each character in $s$ is either `i` or `w`.

### Input Format
Input is given from Standard Input in the following format:

```
s
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
iwiwii
```

### Sample Output 1
```
2
```

It is optimal to first remove the `iwi` formed by the third through fifth characters.

### Sample Input 2
```
iwiwwwiiiwiwiwiiwii
```

### Sample Output 2
```
5
```

## Editorial

### Claim

Let `dp[i][j]` be the maximum number of operations for the half-open substring $s[i..j)$. The base case is `dp[i][i] = 0` for every $i$. Process intervals in increasing order of length $j-i$:

- Split the interval into two independent parts: for every $k$ with $i < k < j$, set `dp[i][j] = max(dp[i][j], dp[i][k] + dp[k][j])`.
- Use the two end characters in one operation: if $s[i] = s[j-1] =$ `i`, then for each $k$ with $i < k < j-1$ and $s[k] =$ `w`, if both interiors $s[i+1..k)$ and $s[k+1..j-1)$ are fully erasable, set `dp[i][j] = max(dp[i][j], (j-i)/3)`.

An interval $s[a..b)$ is fully erasable exactly when $b-a$ is divisible by $3$ and `dp[a][b] = (b-a)/3`; the empty interval qualifies. The split rule makes this test capture adjacent erasable blocks as well as a single outer operation, which is necessary: for example, `iiwiiwiwi` is erased by two adjacent `iwi` removals followed by an operation using the original end characters.

The answer is `dp[0][N]`.

### Complexity

$O(N^3)$ time and $O(N^2)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	string s;
	cin >> s;
	int n = (int)s.size();

	vector<vector<int>> dp(n + 1, vector<int>(n + 1, 0));

	// full(a, b): s[a..b) can be reduced to the empty string.  Every
	// operation removes three characters, so a fully erased interval has
	// length divisible by 3 and uses all of them.
	auto full = [&](int a, int b) {
		int len = b - a;
		return len % 3 == 0 && dp[a][b] == len / 3;
	};

	for (int len = 3; len <= n; ++len) {
		for (int i = 0; i + len <= n; ++i) {
			int j = i + len;

			// Split the interval into two independent parts.
			for (int k = i + 1; k < j; ++k)
				dp[i][j] = max(dp[i][j], dp[i][k] + dp[k][j]);

			// Remove the two end characters together with some 'w'.
			if (s[i] == 'i' && s[j - 1] == 'i') {
				for (int k = i + 1; k + 1 < j; ++k) {
					if (s[k] == 'w' && full(i + 1, k) && full(k + 1, j - 1)) {
						dp[i][j] = max(dp[i][j], len / 3);
						break;
					}
				}
			}
		}
	}

	cout << dp[0][n] << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$s$ は i と w からなる文字列である。すぬけ君は、この中から連続する三文字が "iwi" となっている部分を取り除く操作を繰り返すことができる。(iwi を取り除くと、その左側と右側にあった文字列が連結され、長さが三文字短い新しい文字列ができる。) 操作を行うことのできる回数の最大値を求めよ。
