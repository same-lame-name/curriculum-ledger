# Concatenation

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_concatenation
**Tags:** bitmask DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There are $N$ strings $w_1$, ..., $w_N$ consisting of 0 and 1. Snuke will choose some of these strings and concatenate them in any order to make a string (he may choose the same string more than once). Find the number of strings of length $L$ that can be made in this way, modulo 1,000,000,007. However, if the resulting strings are the same, different ways of concatenating them are considered the same.

### Constraints

- $1 \le N \le 510$
- $1 \le |w_i| \le 8$
- $1 \le L \le 100$
- Each character in $w_i$ will be either '0' or '1'.
- $w_i$ are pairwise distinct.

### Input Format
Input is given from Standard Input in the following format:

```
N L
w_1
...
w_N
```

### Output Format

Print the answer on one line.

### Sample Input 1
```
4 10
00
01
10
11
```

### Sample Output 1
```
1024
```

Every string of length 10 consisting of 0 and 1 can be made.

### Sample Input 2
```
3 5
01
10
0
```

### Sample Output 2
```
14
```

## Editorial

### Claim

Count strings, not concatenations. Since $|w_i| \le 8$, only the last 7 characters can still be extended, so it is enough to remember the last 7 bits and which prefixes of the string are obtainable. Define

${\rm DP}[n][i][j]$ = the number of strings of length $n$ whose last 7 bits are $i$ ($0 \le i \le 127$) and whose set of possible cut positions is the bitmask $j$ ($0 \le j \le 255$), where bit $x$ of $j$ is set iff the prefix of length $n-x$ is obtainable (so bit 0 marks an obtainable string, and $x=0$ is the required property).

$[ANNOTATION]$ ${\rm DP}[0][0][1] = 1$; for $n<7$ the window $i$ is the string's bits padded with zeros on the left.

Appending a character $k \in \{0,1\}$ gives $i' = (2i+k) \bmod 128$ and $j' = 2j \bmod 256$, plus 1 iff some set bit $x$ of $j$ is followed by a word of length $x+1$ matching the new suffix. That test is one bitwise AND with a precomputed mask of matching word lengths for the pair $(i,k)$, so each transition is $O(1)$. As a check, for fixed $n$ the entries sum to $2^n$ over all $i,j$.

The answer is the sum of ${\rm DP}[L][i][j]$ over all states with bit 0 of $j$ set.

### Complexity

$O(L \cdot 2^{2M})$ time and $O(2^{2M})$ memory with $M = \max |w_i| \le 8$; the realised table has $2^7 \cdot 2^8$ states per position.

## Solution

```cpp
// TDPC Q - Concatenation
// Count distinct length-L binary strings obtainable by concatenating the
// given words (repetition allowed).
//
// State: dp[i][j] where, after n characters, i holds the last 7 characters
// (7 bits) and j's bit x is set iff the prefix of length n-x is obtainable.
// Appending bit k shifts j left by one and sets bit 0 iff some obtainable
// cut position x plus a word of length x+1 matches the new suffix.

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

static long long dp[128][256], ndp[128][256];

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, L;
	cin >> N >> L;
	vector<string> w(N);
	for (auto& s : w) cin >> s;

	// match[i][k] bit x set <=> some word of length x+1 equals the last
	// x+1 bits of (i, k), where i is the 7-bit window of previous characters.
	int match[128][2] = {};
	for (int i = 0; i < 128; ++i) {
		for (int k = 0; k < 2; ++k) {
			int mask = 0;
			for (const string& s : w) {
				int len = (int)s.size();
				int value = 0;
				for (char ch : s) value = (value << 1) | (ch - '0');
				int window = ((i << 1) | k) & ((1 << len) - 1);
				if (window == value) mask |= 1 << (len - 1);
			}
			match[i][k] = mask;
		}
	}

	dp[0][1] = 1;  // empty string: window 0, bit 0 (whole prefix) obtainable
	for (int n = 0; n < L; ++n) {
		memset(ndp, 0, sizeof(ndp));
		// A word of length x+1 can only be used if x+1 <= n+1.
		int limit = (n + 1 >= 8) ? 0xFF : ((1 << (n + 1)) - 1);
		for (int i = 0; i < 128; ++i) {
			for (int j = 0; j < 256; ++j) {
				long long cur = dp[i][j];
				if (!cur) continue;
				for (int k = 0; k < 2; ++k) {
					int ni = ((i << 1) | k) & 127;
					int nj = (j << 1) & 255;
					if ((j & match[i][k] & limit) != 0) nj |= 1;
					ndp[ni][nj] = (ndp[ni][nj] + cur) % MOD;
				}
			}
		}
		memcpy(dp, ndp, sizeof(dp));
	}

	long long ans = 0;
	for (int i = 0; i < 128; ++i)
		for (int j = 0; j < 256; ++j)
			if (j & 1) ans = (ans + dp[i][j]) % MOD;
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 個の 0, 1 からなる文字列 $w_1$, ..., $w_N$ がある。すぬけ君は、この中から文字列をいくつか選び、好きな順番で連結して文字列を作ることにした (同じ文字列を複数回選んでもよい)。このようにして作ることのできる長さ $L$ の文字列の個数を mod 1,000,000,007 で求めよ。ただし、文字列として同じであれば、連結のしかたが異なるものも同じであるとみなす。
