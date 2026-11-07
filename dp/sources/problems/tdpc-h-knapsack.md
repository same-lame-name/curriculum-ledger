# Knapsack

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_knapsack
**Tags:** knapsack, colour constraints
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There are $N$ items. The $i$-th item has weight $w_i$, value $v_i$, and color $c_i$. Snuke decided to put some of the items into a knapsack. The total weight of the items put into the knapsack must be at most $W$, and the items put in must use at most $C$ distinct colors. Find the maximum possible total value of the items put into the knapsack.

### Constraints

- $1 \le N \le 100$
- $1 \le W \le 10000$
- $1 \le C \le 50$
- $1 \le w_i, v_i \le 10000$
- $1 \le c_i \le 50$

### Input Format
Input is given from Standard Input in the following format:

```
N W C
w_1 v_1 c_1
...
w_N v_N c_N
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
4 5 2
1 10 1
1 20 2
1 30 3
10 100 4
```

### Sample Output 1
```
50
```

It is optimal to take the second and third items.

### Sample Input 2
```
10 20 2
4 5 6
3 3 9
5 2 9
4 1 6
6 8 3
3 7 6
2 4 9
4 7 3
6 5 6
3 2 9
```

### Sample Output 2
```
27
```

## Editorial

### Claim

Sort the items by color. Let `dp[i][j][k][l]` be the maximum value after deciding the first $i$ items, where $j$ is the total weight of the selected items, $k$ is the number of distinct colors selected, and $l = 1$ if at least one selected item has the same color as item $i$, while $l = 0$ otherwise. For $i = 0$, take $l = 0$ and no selected item.

For item $i$ (processed in sorted order), let `same` be true when $c_i = c_{i-1}$ and false for $i = 1$. The transitions are:

- Do not take item $i$: if `same`, keep $l$ and set `dp[i][j][k][l] <- dp[i-1][j][k][l]`; otherwise set `dp[i][j][k][0] <- dp[i-1][j][k][l]`.
- Take item $i$: let `add = 1` if `same` is false, and `add = [l = 0]` if `same` is true, where `[l = 0]` is $1$ when $l = 0$ and $0$ otherwise. If $j + w_i \le W$ and $k + \text{add} \le C$, set `dp[i][j+w_i][k+add][1] <- dp[i-1][j][k][l] + v_i`.

The base case is `dp[0][0][0][0] = 0`, with every other state at $-\infty$. The answer is the maximum of `dp[N][j][k][l]` over $0 \le j \le W$, $0 \le k \le C$, and $l \in \{0,1\}$.

### Complexity

$O(NWC)$ time and $O(WC)$ memory with rolling arrays over $i$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, W, C;
	cin >> N >> W >> C;
	vector<array<int, 3>> items(N);  // {color, weight, value}
	for (auto& it : items) {
		int w, v, c;
		cin >> w >> v >> c;
		it = {c, w, v};
	}
	sort(items.begin(), items.end());

	const long long NEG = -(1LL << 60);
	vector<vector<array<long long, 2>>> dp(
		C + 1, vector<array<long long, 2>>(W + 1, {NEG, NEG}));
	dp[0][0][0] = 0;

	for (int i = 0; i < N; ++i) {
		int c = items[i][0], w = items[i][1], v = items[i][2];
		bool same = (i > 0 && items[i - 1][0] == c);
		vector<vector<array<long long, 2>>> ndp(
			C + 1, vector<array<long long, 2>>(W + 1, {NEG, NEG}));
		for (int k = 0; k <= C; ++k) {
			for (int j = 0; j <= W; ++j) {
				for (int l = 0; l < 2; ++l) {
					long long cur = dp[k][j][l];
					if (cur == NEG) continue;
					// Do not take item i.
					int nl = same ? l : 0;
					ndp[k][j][nl] = max(ndp[k][j][nl], cur);
					// Take item i.
					int add = same ? (l == 0 ? 1 : 0) : 1;
					int nk = k + add;
					if (nk <= C && j + w <= W)
						ndp[nk][j + w][1] = max(ndp[nk][j + w][1], cur + v);
				}
			}
		}
		dp.swap(ndp);
	}

	long long ans = 0;
	for (int k = 0; k <= C; ++k)
		for (int j = 0; j <= W; ++j)
			ans = max({ans, dp[k][j][0], dp[k][j][1]});
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 個の物があり、$i$ 番目のものの重さ、価値、色はそれぞれ$w_i, v_i, c_i$ である。すぬけ君は、いくつかのものをナップザックに入れることにした。ただし、ナップザックに入れるものの重さの合計は $W$ 以下であり、色は $C$ 種類以下でなければならない。ナップザックに入れられるものの価値の合計の最大値を求めよ。
