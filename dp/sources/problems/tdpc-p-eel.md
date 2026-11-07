# Eel

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_eel
**Tags:** segment DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There is a tree with $N$ vertices in which vertex $a_i$ and vertex $b_i$ are connected by an edge. Find the number of ways to draw $K$ disjoint paths on this tree, modulo 1,000,000,007.

Here, a path is a route on the tree between two distinct vertices. Two paths are disjoint when they do not pass through a common vertex. The order in which the paths are drawn is not distinguished (for example, drawing path P-Q and then path R-S is considered the same as drawing path S-R and then path P-Q).

### Constraints

- $2 \le N \le 1000$
- $1 \le K \le 50$
- $1 \le a_i, b_i \le N$
- The input will represent a tree.

### Input Format
Input is given from Standard Input in the following format:

```
N K
a_1 b_1
...
a_{N-1} b_{N-1}
```

### Output Format

Print the answer on one line.

### Sample Input 1
```
4 1
1 2
2 3
3 4
```

### Sample Output 1
```
6
```

### Sample Input 2
```
8 3
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
9
```

## Editorial

### Claim

Root the tree and run a tree DP from the leaves. For $0 \le k \le 2$, $1 \le i \le N$, $0 \le x \le K$:

${\rm dp}[k][i][x]$ = the number of configurations of the subtree rooted at $i$ that contain $x$ eels, where exactly $k$ of the edges incident to $i$ other than its parent edge are part of an eel.

For $k=1$ the eel ending at $i$ may continue toward the parent; for $k=0$ the vertex $i$ is still free to be attached to an eel coming from the parent; $k=2$ means both child edges are already joined through $i$, so that eel is complete and the parent edge cannot be used. The children are merged like a knapsack: the edge to a child is either unused (the child's open eel, if any, is then closed and counted) or used (it stays open at $i$). A vertex with $C$ children costs $O(CK^2)$ to update, so the whole tree costs $O(NK^2)$.

$[ANNOTATION]$ $x$ counts only eels already completed inside the subtree, so a leaf has ${\rm dp}[0][leaf][0]=1$. At the root there is no parent edge, and the answer is ${\rm dp}[0][root][K] + {\rm dp}[1][root][K-1] + {\rm dp}[2][root][K]$.

### Complexity

$O(NK^2)$ time and $O(NK)$ memory.

## Solution

```cpp
// TDPC P - Eel
// Count sets of K vertex-disjoint paths in a tree.
//
// A set of vertex-disjoint paths is the same thing as a set of edges with
// maximum degree 2 and exactly K connected components (the tree has no
// cycles, so every component of such an edge set is a path).
//
// Root the tree.  For a vertex v:
//   f0[v][x] : v uses no child edge; x completed paths in the subtree
//   f1[v][x] : v uses one child edge; its path is still open at v; x completed
//   f2[v][x] : v uses two child edges; the path through v is completed and
//              included in x
// Children are merged like a knapsack; an edge to a child is either unused
// (an open path of the child is then closed) or used (it stays open at v).

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, K;
	cin >> N >> K;

	vector<vector<int>> adj(N);
	for (int i = 0; i < N - 1; ++i) {
		int a, b;
		cin >> a >> b;
		--a; --b;
		adj[a].push_back(b);
		adj[b].push_back(a);
	}

	// Iterative rooting and post-order.
	vector<int> parent(N, -1), order;
	order.reserve(N);
	order.push_back(0);
	parent[0] = -2;
	for (int idx = 0; idx < (int)order.size(); ++idx) {
		int v = order[idx];
		for (int u : adj[v]) {
			if (parent[u] == -1) {
				parent[u] = v;
				order.push_back(u);
			}
		}
	}

	vector<vector<long long>> f0(N), f1(N), f2(N);

	for (int oi = (int)order.size() - 1; oi >= 0; --oi) {
		int v = order[oi];

		vector<long long> g0(K + 1, 0), g1(K + 1, 0), g2(K + 1, 0);
		g0[0] = 1;

		for (int u : adj[v]) {
			if (parent[u] != v) continue;

			vector<long long> closed(K + 1, 0), open(K + 1, 0);
			for (int x = 0; x <= K; ++x) {
				closed[x] = f0[u][x];
				if (x >= 1) closed[x] = (closed[x] + f1[u][x - 1]) % MOD;
				closed[x] = (closed[x] + f2[u][x]) % MOD;
				open[x] = (f0[u][x] + f1[u][x]) % MOD;
			}

			vector<long long> h0(K + 1, 0), h1(K + 1, 0), h2(K + 1, 0);
			for (int x = 0; x <= K; ++x) {
				if (!g0[x] && !g1[x] && !g2[x]) continue;
				for (int y = 0; x + y <= K; ++y) {
					if (closed[y]) {
						if (g0[x]) h0[x + y] = (h0[x + y] + g0[x] * closed[y]) % MOD;
						if (g1[x]) h1[x + y] = (h1[x + y] + g1[x] * closed[y]) % MOD;
						if (g2[x]) h2[x + y] = (h2[x + y] + g2[x] * closed[y]) % MOD;
					}
					if (open[y]) {
						if (g0[x]) h1[x + y] = (h1[x + y] + g0[x] * open[y]) % MOD;
						if (g1[x]) h2[x + y] = (h2[x + y] + g1[x] * open[y]) % MOD;
					}
				}
			}
			g0.swap(h0);
			g1.swap(h1);
			g2.swap(h2);
		}

		f0[v] = g0;
		f1[v] = g1;
		// Two open paths join through v into one completed path.
		f2[v].assign(K + 1, 0);
		for (int x = 0; x < K; ++x)
			f2[v][x + 1] = g2[x];
	}

	long long ans = f0[0][K];
	if (K >= 1) ans = (ans + f1[0][K - 1]) % MOD;
	ans = (ans + f2[0][K]) % MOD;
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 頂点からなり、頂点 $a_i$ と $b_i$ が辺で結ばれている木がある。この木に $K$ 本の disjoint なパスを書く方法が何通りあるか、mod 1,000,000,007 で求めよ。

ただし、パスとは、異なる 二頂点間の木上での経路のことである。二つのパスは、共通の頂点を通らないとき disjoint であるという。また、パスを書く順番は区別しないものとする (たとえば、パス P-Q を書いた後にパス R-S を書くことも、パス S-R を書いた後にパス P-Q を書くことも同じであるとみなす。)
