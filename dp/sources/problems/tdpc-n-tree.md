# Tree

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_tree
**Tags:** tree DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Vertices $1$ through $N$ are drawn on a piece of paper. Snuke decided to draw edges between vertices $a_i$ and $b_i$ to make a tree. Find the number of orders in which the edges can be drawn so that, at every moment while the tree is being drawn, the edges drawn so far form a connected graph, modulo $1{,}000{,}000{,}007$.

### Constraints

- $2 \le N \le 1000$
- $1 \le a_i, b_i \le N$
- The input represents a tree.

### Input Format
Input is given from Standard Input in the following format:

```
N
a_1 b_1
...
a_{N-1} b_{N-1}
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
4
1 2
2 3
3 4
```

### Sample Output 1
```
4
```

- 1-2 -> 2-3 -> 3-4
- 2-3 -> 1-2 -> 3-4
- 2-3 -> 3-4 -> 1-2
- 3-4 -> 2-3 -> 1-2

These four orders are possible. (If edges 1-2 and 3-4 are drawn first, the edges are disconnected at that point.)

### Sample Input 2
```
8
1 2
4 6
6 7
3 2
2 4
4 5
8 6
```

### Sample Output 2
```
752
```

## Editorial

### Claim

Root the tree at a vertex $r$. For a vertex $v$, let `dp[v]` be the number of orders of the edges in the subtree rooted at $v$ such that every prefix is connected and the first edge is incident to $v$. For a leaf, `dp[v] = 1`.

Let the children of $v$ be $c_1, \dots, c_K$, and let $x_c$ be the number of vertices in the subtree rooted at child $c$ (the author's $x_i$). A valid order for $v$'s subtree is formed by taking, for each child $c$, the edge $(v,c)$ followed by one of the `dp[c]` valid orders of $c$'s subtree, and interleaving these $K$ blocks. Each block for child $c$ contains $x_c$ edges, so the number of interleavings is the multinomial

$(x_{c_1} + \dots + x_{c_K})! / (x_{c_1}! \cdots x_{c_K}!) = (\mathrm{size}[v]-1)! / \prod_c x_c!$.

Thus

`dp[v] = (size[v]-1)! / prod_c x_c! * prod_c dp[c]` modulo $10^9+7$.

Every valid global order has a unique first edge $\{u,v\}$. It is counted in `dp[u]` when the tree is rooted at $u$, and in `dp[v]` when the tree is rooted at $v$, and in no other root's count, because the first edge is not incident to any other vertex. Therefore the answer is

`(sum_{r=1}^{N} dp_r[r]) / 2` modulo $10^9+7$,

where `dp_r` is the DP rooted at $r$.

The subtree sizes and DP values for one root are computed in $O(N)$ by a postorder traversal; doing this for all $N$ roots gives $O(N^2)$ time. Precompute factorials and inverse factorials up to $N$ to evaluate the multinomial factors.

### Complexity

$O(N^2)$ time and $O(N)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

long long modpow(long long a, long long e) {
	long long r = 1;
	while (e > 0) {
		if (e & 1) r = r * a % MOD;
		a = a * a % MOD;
		e >>= 1;
	}
	return r;
}

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<vector<int>> g(N);
	for (int i = 0; i < N - 1; ++i) {
		int a, b;
		cin >> a >> b;
		--a, --b;
		g[a].push_back(b);
		g[b].push_back(a);
	}

	vector<long long> fact(N + 1, 1), invfact(N + 1, 1);
	for (int i = 1; i <= N; ++i) fact[i] = fact[i - 1] * i % MOD;
	invfact[N] = modpow(fact[N], MOD - 2);
	for (int i = N; i >= 1; --i) invfact[i - 1] = invfact[i] * i % MOD;

	// Count valid orders of the whole tree whose first edge is incident to
	// the chosen root, then sum over all roots and divide by two.
	vector<int> parent(N), order;
	vector<int> sz(N);
	vector<long long> dp(N);
	long long total = 0;

	for (int root = 0; root < N; ++root) {
		order.clear();
		order.push_back(root);
		parent[root] = -1;
		for (size_t idx = 0; idx < order.size(); ++idx) {
			int v = order[idx];
			for (int u : g[v]) {
				if (u == parent[v]) continue;
				parent[u] = v;
				order.push_back(u);
			}
		}

		for (int idx = N - 1; idx >= 0; --idx) {
			int v = order[idx];
			sz[v] = 1;
			dp[v] = 1;
			for (int u : g[v]) {
				if (u == parent[v]) continue;
				sz[v] += sz[u];
				dp[v] = dp[v] * dp[u] % MOD * invfact[sz[u]] % MOD;
			}
			dp[v] = dp[v] * fact[sz[v] - 1] % MOD;
		}
		total = (total + dp[root]) % MOD;
	}

	cout << total * modpow(2, MOD - 2) % MOD << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

頂点 1 から頂点 $N$ までが紙が描かれている。すぬけ君は、頂点 $a_i$ と頂点 $b_i$ の間に辺を描き、木にすることにした。木を書いている途中で常に辺が連結になっているようにしたいとき、辺を描く順番は何通り考えられるか、mod 1,000,000,007 で求めよ。
