# Cat

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_cat
**Tags:** LIS-style DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Snuke keeps $N$ cats. The friendliness between cat $i$ and cat $j$ is $f_{i,j}$. The happiness of a cat is the sum of the friendliness values between it and all cats within distance $1$ of it. Snuke decided to place cats $1$ through $N$ on a line in this order. (If $x_i$ is the coordinate of cat $i$, then $x_i$ is a real number satisfying $x_1 < x_2 < \dots < x_N$.) Find the maximum possible total happiness of the cats.

### Constraints

- $1 \le N \le 1000$
- $-1000 \le f_{i,j} \le 1000$
- $f_{i,i} = 0$
- $f_{i,j} = f_{j,i}$

### Input Format
Input is given from Standard Input in the following format:

```
N
f_{1,1} ... f_{1,N}
...
f_{N,1} ... f_{N,N}
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
3
0 2 3
2 0 -10
3 -10 0
```

### Sample Output 1
```
4
```

For example, if $x_1 = 1$, $x_2 = 1.5$, and $x_3 = 4$, then the happiness of cats $1$ and $2$ is $2$ each, and the happiness of cat $3$ is $0$.

### Sample Input 2
```
5
0 -3 5 2 -6
-3 0 6 -3 1
5 6 0 2 0
2 -3 2 0 4
-6 1 0 4 0
```

### Sample Output 2
```
28
```

## Editorial

### Claim

Let `dp[i][j]` be the maximum total happiness after placing cats $1$ through $i$, where $j$ is the smallest index among the cats within distance $1$ of cat $i$ (the most recently placed cat). The base case is `dp[1][1] = 0`, since cat $1$ is at distance $0$ from itself.

When cat $i+1$ is placed, let $j$ be the smallest index within distance $1$ of it. Then $x_{i+1}-x_j \le 1$, so every cat $j, j+1, \dots, i+1$ is within distance $1$ of cat $i+1$, and every cat with a smaller index is farther than $1$ away. The previous left boundary $k$ cannot be larger than $j$ (the left boundary moves only to the right), and every $k \le j$ is achievable. Hence

`dp[i+1][j] = max_{1 <= k <= j} dp[i][k] + 2 * sum_{l=j}^{i+1} f_{i+1,l}`

for $1 \le j \le i+1$. The factor $2$ is present because an unordered pair contributes its friendliness to the happiness of both cats. The suffix sums can be precomputed for each $i$, and the prefix maxima over $k$ make each state $O(1)$ after an $O(N)$ pass over the previous row. The answer is `max_j dp[N][j]`.

### Complexity

$O(N^2)$ time and $O(N)$ memory with rolling rows. The editorial obtains the range maximum with a segment tree and states $O(N^2 \log N)$; prefix maxima are sufficient here.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<vector<long long>> f(N, vector<long long>(N));
	for (int i = 0; i < N; ++i)
		for (int j = 0; j < N; ++j) cin >> f[i][j];

	const long long NEG = -(1LL << 60);
	// prev[j]: after placing the first i cats, the smallest index within
	// distance 1 of cat i is j (1-indexed), maximum total happiness.
	vector<long long> prev(N + 2, NEG);
	prev[1] = 0;

	for (int i = 1; i < N; ++i) {
		// prefix maximum over old states k <= j
		vector<long long> pref(N + 2, NEG);
		long long best = NEG;
		for (int k = 1; k <= i; ++k) {
			best = max(best, prev[k]);
			pref[k] = best;
		}
		pref[i + 1] = best;

		// suffix sums of f[i][l-1] for l = j..i+1
		vector<long long> suffix(N + 3, 0);
		for (int l = i + 1; l >= 1; --l)
			suffix[l] = suffix[l + 1] + f[i][l - 1];

		vector<long long> next(N + 2, NEG);
		for (int j = 1; j <= i + 1; ++j) {
			if (pref[j] == NEG) continue;
			// Each pair is counted in both cats' happiness.
			next[j] = pref[j] + 2 * suffix[j];
		}
		prev.swap(next);
	}

	cout << *max_element(prev.begin(), prev.end()) << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

すぬけ君は $N$ 匹の猫を飼っている。猫 $i$ と猫 $j$ の仲のよさは $f_{i,j}$ である。ある猫の幸福度は、その猫から距離 1 以内にいる猫との仲のよさの総和である。すぬけ君は、猫 1 から猫 $N$ をこの順に一次元上に配置することにした。(猫 i の座標を $x_i$ とすると、$x_i$ は $x_1 < x_2 < ... < x_N$ をみたす実数)　猫の幸福度の総和の最大値を求めよ。
