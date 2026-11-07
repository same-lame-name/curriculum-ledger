# String

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_string
**Tags:** string DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Find the number of strings satisfying both of the following conditions, modulo 1,000,000,007.

- The string contains $freq_1$ copies of a, $freq_2$ copies of b, ..., $freq_{26}$ copies of z, and no other characters.
- No two equal characters are adjacent.

### Constraints

- $0 \le freq_i \le 10$
- At least one of the $freq_i$ is nonzero.

### Input Format
Input is given from Standard Input in the following format:

```
freq_1 ... freq_{26}
```

### Output Format

Print the answer on one line.

### Sample Input 1
```
1 0 2 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
```

### Sample Output 1
```
6
```

acdc, cacd, cadc, cdac, cdca and dcac satisfy the conditions.

### Sample Input 2
```
1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
```

### Sample Output 2
```
3628800
```

## Editorial

### Claim

Process the letters in the order a, b, ..., z. Let

${\rm DP}[n][a]$ = the number of arrangements after the first $n$ letters have been placed that have exactly $a$ places where equal letters are adjacent (places that the remaining letters still have to break up; for example "aaabaacc" has 4 such places).

${\rm DP}[26][0]$ is the answer. When the $n$-th letter is placed, put $f = freq_n$; the $m = freq_1 + \cdots + freq_{n-1}$ letters already placed form an arrangement with $m+1$ gaps, of which $a$ are equal-letter gaps and $b = m+1-a$ are the others. Choose $1 \le i \le f$: split the $f$ copies into $i$ nonempty groups, choose $j$ of the equal-letter gaps and $i-j$ of the other gaps, and place the groups there. The number of ways is

$$_{f-1}C_{i-1} \times {}_aC_j \times {}_bC_{i-j},$$

and the new number of equal-letter gaps is $a + f - i - j$. Hence

`DP[n][a+f-i-j] += DP[n-1][a] * Comb(f-1, i-1) * Comb(a, j) * Comb(b, i-j)`

### Complexity

$O(26 \cdot S \cdot F^2)$ time and $O(S)$ memory, where $S = \sum_i freq_i \le 260$ and $F = \max_i freq_i \le 10$: at most $S$ values of $a$ and at most $F^2$ pairs $(i,j)$ are examined per letter.

## Solution

```cpp
// TDPC O - String
// Count strings with prescribed letter frequencies and no equal neighbours.
//
// dp[a] = number of arrangements of the letters processed so far that have
// exactly a "bad" gaps (two equal letters adjacent).  When inserting cnt
// copies of the next letter, split them into i non-empty groups and put j of
// those groups into bad gaps and i-j into the remaining b = (len+1) - a gaps.
// The number of bad gaps becomes a + cnt - i - j.

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;
static long long C[305][305];

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	vector<int> freq(26);
	for (int& x : freq) cin >> x;

	for (int n = 0; n <= 300; ++n) {
		C[n][0] = 1;
		for (int k = 1; k <= n; ++k)
			C[n][k] = (C[n - 1][k - 1] + C[n - 1][k]) % MOD;
	}

	// Initially the empty arrangement: 0 letters, 0 bad gaps, 1 gap.
	vector<long long> dp(1, 1);
	int len = 0;

	for (int c = 0; c < 26; ++c) {
		int cnt = freq[c];
		if (cnt == 0) continue;

		vector<long long> nxt(len + cnt + 2, 0);
		for (int a = 0; a < (int)dp.size(); ++a) {
			if (dp[a] == 0) continue;
			int b = (len + 1) - a;  // total gaps minus bad gaps
			for (int i = 1; i <= cnt; ++i) {
				for (int j = 0; j <= min(a, i); ++j) {
					int k = i - j;  // groups placed into good gaps
					if (k > b) continue;
					long long ways = C[cnt - 1][i - 1] * C[a][j] % MOD * C[b][k] % MOD;
					int na = a + cnt - i - j;
					nxt[na] = (nxt[na] + dp[a] * ways) % MOD;
				}
			}
		}

		len += cnt;
		dp.swap(nxt);
	}

	cout << dp[0] % MOD << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

以下の条件を満たす文字列の個数を mod 1,000,000,007 で求めよ。

- a を $freq_1$ 個、b を $freq_2$ 個、... z を $freq_{26}$ 個含む (他の文字は含まない)。
- 同じ文字が隣り合うことはない。
