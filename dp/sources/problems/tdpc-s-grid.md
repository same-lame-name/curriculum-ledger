# Grid

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_grid
**Tags:** profile DP
**Limits:** 8 sec / 256 MiB

## Statement

### Problem Statement

Snuke has decided to paint the cells of an $H \times W$ grid black and white.

- The top-left cell and the bottom-right cell are painted black.
- It is possible to go from the top-left cell to the bottom-right cell by following black cells up, down, left and right.

Find the number of such colourings, modulo 1,000,000,007.

### Constraints

- $2 \le H \le 6$
- $2 \le W \le 100$

### Input Format
Input is given from Standard Input in the following format:

```
H W
```

### Output Format

Print the answer on one line.

### Sample Input 1
```
2 2
```

### Sample Output 1
```
3
```

Colourings in which the top-left and bottom-right cells are black and at least one of the bottom-left and top-right cells is black satisfy the conditions.

### Sample Input 2
```
5 8
```

### Sample Output 2
```
950397139
```

## Editorial

### Claim

Process the columns from left to right.

${\rm dp}[i][S]$ = the number of colourings of the first $i$ columns whose $i$-th column has connectivity state $S$.

A connectivity state records which cells belong to the same connected component. Number the cells of the column as follows: 0 = white; 1 = black and in the same component as the top-left cell; 2, 3 = black and in components different from the top-left cell, with equal numbers for the same component and different numbers for different components. At most 3 components can coexist in one column (there are at most 3 black runs in $H \le 6$ cells), so labels 4 and above never occur and there are at most $4^H$ states.

For a transition, look at the current state and a colouring of the next column, join the cells with a union-find, and normalise the labels of the next column by coordinate compression. After the last column, the answer is the sum over states in which the bottom-right cell has label 1.

$[ANNOTATION]$ The first column is initialised directly: the top-left cell is black, each vertical run of black cells is one component, and the run containing the top-left cell is labelled 1 (the other runs get 2, 3, ...).

### Complexity

$O(HW8^H\log H)$ time if one transition costs $O(H\log H)$, as estimated by the source; $O(4^H)$ memory for two layers of states.

## Solution

```cpp
// TDPC S - Grid
// Count colourings of an H x W grid with the top-left and bottom-right cells
// black and a black 4-connected path between them.
//
// Column DP.  A state labels the cells of the current column:
//   0 = white, 1 = connected to the top-left cell, 2,3 = other components.
// Labels of components other than the start component are normalised in
// order of first appearance, so the state is a base-4 number (H <= 6).
// When moving to the next column, union-find forms the components of the new
// column; the start component must survive (otherwise the top-left can never
// reach the bottom-right), and components that disappear are simply gone.

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int H, W;
	cin >> H >> W;

	int states = 1 << (2 * H);  // 4^H
	vector<long long> dp(states, 0), ndp(states, 0);

	// DSU over old column (0..H-1) and new column (H..2H-1).
	vector<int> par(2 * H), rnk(2 * H);
	auto find = [&](int x) {
		while (par[x] != x) x = par[x] = par[par[x]];
		return x;
	};
	auto unite = [&](int a, int b) {
		a = find(a);
		b = find(b);
		if (a == b) return;
		if (rnk[a] < rnk[b]) swap(a, b);
		par[b] = a;
		if (rnk[a] == rnk[b]) ++rnk[a];
	};

	vector<int> label(H), nlabel(H);

	// First column: choose a black mask containing row 0.
	for (int mask = 0; mask < (1 << H); ++mask) {
		if (!(mask & 1)) continue;
		int code = 0, next = 0;
		for (int r = 0; r < H; ++r) {
			if (mask >> r & 1) {
				if (r == 0 || !(mask >> (r - 1) & 1)) ++next;
				label[r] = next;
				code += label[r] * (1 << (2 * r));
			} else {
				label[r] = 0;
			}
		}
		dp[code] = (dp[code] + 1) % MOD;
	}

	for (int col = 0; col + 1 < W; ++col) {
		fill(ndp.begin(), ndp.end(), 0);
		for (int code = 0; code < states; ++code) {
			if (!dp[code]) continue;
			for (int r = 0; r < H; ++r)
				label[r] = (code >> (2 * r)) & 3;

			for (int mask = 0; mask < (1 << H); ++mask) {
				for (int i = 0; i < 2 * H; ++i) {
					par[i] = i;
					rnk[i] = 0;
				}
				// Old components.
				for (int a = 0; a < H; ++a)
					for (int b = a + 1; b < H; ++b)
						if (label[a] && label[a] == label[b]) unite(a, b);
				// New black cells, vertically adjacent.
				for (int r = 0; r + 1 < H; ++r)
					if ((mask >> r & 1) && (mask >> (r + 1) & 1))
						unite(H + r, H + r + 1);
				// Old cell and new cell in the same row.
				for (int r = 0; r < H; ++r)
					if (label[r] && (mask >> r & 1)) unite(r, H + r);

				int startRoot = -1;
				for (int r = 0; r < H; ++r)
					if (label[r] == 1) { startRoot = find(r); break; }

				bool survives = false;
				for (int r = 0; r < H; ++r)
					if ((mask >> r & 1) && find(H + r) == startRoot) survives = true;
				if (!survives) continue;

				int rootLabel[2 * H];
				for (int i = 0; i < 2 * H; ++i) rootLabel[i] = -1;
				int next = 1, ncode = 0;
				for (int r = 0; r < H; ++r) {
					if (!(mask >> r & 1)) { nlabel[r] = 0; continue; }
					int root = find(H + r);
					if (root == startRoot) {
						nlabel[r] = 1;
					} else {
						if (rootLabel[root] == -1) rootLabel[root] = ++next;
						nlabel[r] = rootLabel[root];
					}
					ncode += nlabel[r] * (1 << (2 * r));
				}
				ndp[ncode] = (ndp[ncode] + dp[code]) % MOD;
			}
		}
		dp.swap(ndp);
	}

	long long ans = 0;
	for (int code = 0; code < states; ++code) {
		int bottom = (code >> (2 * (H - 1))) & 3;
		if (bottom == 1) ans = (ans + dp[code]) % MOD;
	}
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

すぬけ君は、$H$ x $W$ のマス目を白と黒に塗り分けることにした。

- 左上のマス目と右下のマス目は黒に塗る。
- 左上のマス目から、黒いますを上下左右にたどって、右下のマス目に行くことができる。

条件を満たす塗り分け方の個数を mod 1,000,000,007 で求めよ。
