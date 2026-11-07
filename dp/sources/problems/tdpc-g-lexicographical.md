# Lexicographical

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_lexicographical
**Tags:** lexicographic DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Among the non-empty subsequences of a string $s$, find the $K$-th one in lexicographical order. If no such subsequence exists, output `"Eel"` (quotes for clarity).

Here, a subsequence is obtained by removing some characters from $s$ (possibly zero) and concatenating the remaining characters without changing their order. For example, the subsequences of `"aba"` are the six strings `"a"`, `"b"`, `"aa"`, `"ab"`, `"ba"`, `"aba"`. The string `"a"` appears at two different positions, but occurrences that are equal as strings are not distinguished.

### Constraints

- $1 \le |s| \le 1000000$
- Each character in $s$ is a lowercase English letter (`a`-`z`).
- $1 \le K \le 10^{18}$

### Input Format
Input is given from Standard Input in the following format:

```
s
K
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
eel
6
```

### Sample Output 1
```
Eel
```

The subsequences of `eel` in lexicographical order are `e`, `ee`, `eel`, `el`, `l`. The sixth one does not exist.

### Sample Input 2
```
lexicographical
100
```

### Sample Output 2
```
capal
```

## Editorial

### Claim

Let $N=|s|$ and let $M$ be the alphabet size. Let $\mathrm{next}_{i,x}$ be the first position at or after $i$ where the character $x$ appears; it can be found by a DP from the right.

The condition "occurrences at different positions are not distinguished when the strings are equal" can be rephrased as "among equal strings, only the one whose chosen positions are lexicographically smallest is selected" (※).

If the number $X[i]$ of strings that can be made from position $i$ onward is known for every $i$, the answer can be found by trying characters from the front in $O(NM)$. For example, the subsequences starting with $x$ number $X[\mathrm{next}_{i,x}]$, so by checking $x=\text{a},\text{b},\ldots$ in order and finding when the running total exceeds $K$, the first character of the answer is determined. The second and later characters are handled in the same way.

It remains to compute $X[i]$, which is also done by a DP from the right. With (※) in mind,

$$X[i] = X[i+1]\cdot 2 - X[\mathrm{next}_i].$$

$X[i]$ grows too large as written, but only values up to $K$ are needed, so it may be capped appropriately.

This gives $O(NM)$.

### Complexity

$O(NM)$ time and $O(NM)$ memory if every $\mathrm{next}_{i,x}$ is stored; the author notes that this array caused MLE and that their submission stores only $\mathrm{next}_i$ and updates the rest on the fly.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	string s;
	long long K;
	cin >> s >> K;

	int n = (int)s.size();
	long long cap = K + 1;  // saturate counts above K

	// dp[i] = number of distinct subsequences (including the empty one)
	// of s[i..n-1].
	vector<long long> dp(n + 1, 1), nxt(n, -1);
	vector<int> last(26, -1);
	for (int i = n - 1; i >= 0; --i) {
		nxt[i] = last[s[i] - 'a'];
		last[s[i] - 'a'] = i;
		long long sub = (nxt[i] == -1) ? 0 : dp[nxt[i] + 1];
		dp[i] = min(cap, 2 * dp[i + 1] - sub);
	}

	if (dp[0] - 1 < K) {
		cout << "Eel\n";
		return 0;
	}

	vector<vector<int>> occ(26);
	for (int i = 0; i < n; ++i) occ[s[i] - 'a'].push_back(i);
	vector<size_t> cursor(26, 0);

	string ans;
	int pos = 0;
	while (K > 0) {
		for (int c = 0; c < 26; ++c) {
			while (cursor[c] < occ[c].size() && occ[c][cursor[c]] < pos)
				++cursor[c];
			if (cursor[c] == occ[c].size()) continue;
			int p = occ[c][cursor[c]];
			long long cnt = dp[p + 1];  // strings starting with this character
			if (K > cnt) {
				K -= cnt;
			} else {
				ans.push_back(char('a' + c));
				pos = p + 1;
				--K;
				break;
			}
		}
	}

	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

文字列 $s$ の空でない部分列のうち、辞書順で $K$ 番目のものを求めよ。そのようなものが存在しない場合は "Eel" (quotes for clarity) と出力せよ。

ただし、$s$ から何文字か取り除き (0 文字でもよい)、残りの文字を順番を変えずにつなげたものを部分列という。たとえば、"aba" の部分列は "a", "b", "aa", "ab", "ba", "aba" の 6 個である。"a" は異なる場所に二回現れるが、文字列として同じであれば区別しないものとする。
