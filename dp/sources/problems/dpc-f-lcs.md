# LCS

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_f
**Tags:** LCS, reconstruction
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given strings $s$ and $t$.
Find one longest string that is a subsequence of both $s$ and $t$.

### Notes
A subsequence of a string $x$ is the string obtained by removing zero or more characters from $x$ and concatenating the remaining characters without changing the order.

### Constraints

- $s$ and $t$ are strings consisting of lowercase English letters.
- $1 \leq |s|, |t| \leq 3000$

### Input
Input is given from Standard Input in the following format:

```
s
t
```

### Output
Print one longest string that is a subsequence of both $s$ and $t$.
If there are multiple such strings, any of them will be accepted.

### Sample Input 1
```
axyb
abyxb
```

### Sample Output 1
```
axb
```

The answer is `axb` or `ayb`; either will be accepted.

### Sample Input 2
```
aa
xayaz
```

### Sample Output 2
```
aa
```

### Sample Input 3
```
a
z
```

### Sample Output 3
```

```

The answer is `` (an empty string).

### Sample Input 4
```
abracadabra
avadakedavra
```

### Sample Output 4
```
aaadara
```

## Editorial

`dp[i][j]` is the length of the longest common subsequence of the first $i$ characters of $s$ and the first $j$ characters of $t$. The base is `dp[0][j] = dp[i][0] = 0`.

$$dp[i][j] = \begin{cases} dp[i-1][j-1] + 1, & s_i = t_j \\ \max(dp[i-1][j], dp[i][j-1]), & s_i \ne t_j \end{cases}$$

To rebuild the string, walk back from $(n,m)$: on a match take the character and step diagonally; otherwise move to the neighbour with the larger value. $O(nm)$ time and memory.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

template<class T> bool ckmax(T& a, const T& b) {
	return a < b ? a = b, 1 : 0;
}

int dp[3001][3001];

int main() {
	cin.tie(0)->sync_with_stdio(0);
	string s, t; cin >> s >> t;
	int n = s.size(), m = t.size();

	for(int i = 0 ; i <= n; ++i) {
		for(int j = 0; j <= m; ++j)  {
			if(!i || !j) dp[i][j] = 0;
			else if(s[i - 1] == t[j - 1]) dp[i][j] = 1 + dp[i - 1][j - 1];
			else dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
		}
	}

	string ret = "";

	while(n && m) {
		if(s[n - 1] == t[m - 1]) {
			ret += s[n - 1];
			n--;
			m--;
		}
		else if(dp[n - 1][m] > dp[n][m - 1]) n--;
		else m--;
	 }

	 reverse(ret.begin(), ret.end());

	 cout << ret << endl;
}
```

## Original statement (日本語)

### 問題文
文字列 $s$ および $t$ が与えられます。
$s$ の部分列かつ $t$ の部分列であるような文字列のうち、最長のものをひとつ求めてください。

### 注釈
文字列 $x$ の部分列とは、$x$ から $0$ 個以上の文字を取り除いた後、残りの文字を元の順序で連結して得られる文字列のことです。
