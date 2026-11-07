# Graph

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_graph
**Tags:** matrix exponentiation
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There is a directed graph with $N$ vertices. When $g_{i,j} = 1$, there is a directed edge from vertex $i$ to vertex $j$.

Initially, all vertices are painted white. Snuke can perform the following operation twice.

- Choose a vertex, and follow directed edges from that vertex to visit some vertices. The same vertex may be passed more than once.
- Paint black all vertices that were passed at least once.

Find the maximum number of black vertices after the two operations.

### Constraints

- $1 \le N \le 300$
- $0 \le g_{i,j} \le 1$
- $g_{i,i} = 0$

### Input Format
Input is given from Standard Input in the following format:

```
N
g_{1,1} ... g_{1,N}
...
g_{N,1} ... g_{N,N}
```

### Output Format

Print the answer on one line.

### Sample Input 1
```
4
0 0 0 1
0 0 0 1
0 0 0 1
0 0 0 0
```

### Sample Output 1
```
3
```

For example, if he follows 1->4 on the first operation and 2->4 on the second, 3 vertices are painted black.

### Sample Input 2
```
6
0 0 1 0 0 0
0 0 1 0 0 0
0 0 0 1 1 1
0 0 0 0 0 0
0 0 0 0 0 0
0 0 1 0 0 0
```

### Sample Output 2
```
6
```

For example, if he follows 1->3->6->3->4 on the first operation and 2->3->5 on the second, 6 vertices are painted black.

## Editorial

### Claim

First decompose the graph into strongly connected components (SCCs). Add a super vertex $s$ with an edge to every vertex and a super vertex $t$ with an edge from every vertex; then only $s \to t$ paths have to be considered, which makes the case analysis easier (depending on the implementation, 2 must be subtracted at the end). Topologically sort the graph after the SCC contraction, including the super vertices, and renumber the vertices $1, \ldots, M$.

Let ${\rm dp}[i][j]$ be the maximum number of vertices passed through by two paths from $s$ ending at $i$ and $j$. With ${\rm size}(i)$ the number of original vertices in SCC $i$ and $E_i$ the set of vertices having an edge into $i$:

$${\rm dp}[i][j] = \max_{k \in E_i} \{{\rm dp}[j][k]\} + {\rm size}(i) \quad (j<i)$$

$${\rm dp}[i][i] = \max_{j,\, k \in E_i} \{{\rm dp}[j][k]\} + {\rm size}(i).$$

$[ANNOTATION]$ The table is symmetric, ${\rm dp}[j][k] = {\rm dp}[k][j]$ (the two paths are interchangeable), and it is initialised at the super source, ${\rm dp}[1][1] = {\rm size}(1)$. Updating in increasing order gives ${\rm dp}[M][M]$, the answer, in $O(N^3)$ time.

### Complexity

$O(N^3)$ time and $O(N^2)$ memory.

## Solution

```cpp
// TDPC R - Graph
// Two walks in a directed graph; maximise the number of distinct vertices
// visited by their union.
//
// Condense SCCs (a walk visits the SCCs along one path of the condensation
// DAG, and inside an SCC it can visit every vertex).  Add a super source 0
// and a super sink C+1 with weight 0, topologically order the DAG, and let
// dp[i][j] (i >= j) be the maximum weight covered by two paths from the
// source ending at i and j.  Extending the path that ends at k to i adds
// weight(i); i cannot have been covered by the other path because j < i.

#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<vector<int>> g(N);
	for (int i = 0; i < N; ++i) {
		for (int j = 0; j < N; ++j) {
			int x;
			cin >> x;
			if (x) g[i].push_back(j);
		}
	}

	// Tarjan SCC (recursion depth <= N).
	vector<int> num(N, -1), low(N, 0), comp(N, -1), stk;
	vector<char> on(N, 0);
	int timer = 0, C = 0;
	function<void(int)> dfs = [&](int v) {
		num[v] = low[v] = timer++;
		stk.push_back(v);
		on[v] = 1;
		for (int u : g[v]) {
			if (num[u] == -1) {
				dfs(u);
				low[v] = min(low[v], low[u]);
			} else if (on[u]) {
				low[v] = min(low[v], num[u]);
			}
		}
		if (low[v] == num[v]) {
			while (true) {
				int u = stk.back();
				stk.pop_back();
				on[u] = 0;
				comp[u] = C;
				if (u == v) break;
			}
			++C;
		}
	};
	for (int v = 0; v < N; ++v)
		if (num[v] == -1) dfs(v);

	vector<int> weight(C, 0);
	for (int v = 0; v < N; ++v) ++weight[comp[v]];

	// Condensation edges (component ids from Tarjan; just collect them).
	vector<vector<int>> dag(C);
	for (int v = 0; v < N; ++v)
		for (int u : g[v])
			if (comp[v] != comp[u]) dag[comp[v]].push_back(comp[u]);
	for (auto& vec : dag) {
		sort(vec.begin(), vec.end());
		vec.erase(unique(vec.begin(), vec.end()), vec.end());
	}

	// Topological order of the condensation, then relabel sources first.
	vector<int> indeg2(C, 0);
	for (int c = 0; c < C; ++c)
		for (int d : dag[c]) ++indeg2[d];
	vector<int> q;
	for (int c = 0; c < C; ++c)
		if (indeg2[c] == 0) q.push_back(c);
	vector<int> topo;
	while (!q.empty()) {
		int c = q.back();
		q.pop_back();
		topo.push_back(c);
		for (int d : dag[c])
			if (--indeg2[d] == 0) q.push_back(d);
	}
	vector<int> id(C, -1);
	for (int t = 0; t < C; ++t) id[topo[t]] = t + 1;  // 1 .. C

	int M = C + 2;  // 0 = super source, C+1 = super sink
	vector<long long> w(M, 0);
	for (int c = 0; c < C; ++c) w[id[c]] = weight[c];

	vector<vector<int>> pred(M);
	for (int c = 0; c < C; ++c)
		for (int d : dag[c])
			pred[id[d]].push_back(id[c]);
	for (int c = 1; c <= C; ++c) pred[c].push_back(0);  // source reaches everything
	for (int c = 0; c <= C; ++c) pred[C + 1].push_back(c);

	const long long NEG = -(1LL << 50);
	vector<vector<long long>> dp(M, vector<long long>(M, NEG));
	dp[0][0] = w[0];
	auto get = [&](int a, int b) -> long long {
		if (a < b) swap(a, b);
		return dp[a][b];
	};

	for (int i = 1; i < M; ++i) {
		for (int j = 0; j < i; ++j) {
			long long best = NEG;
			for (int k : pred[i]) {
				long long v = get(j, k);
				if (v > best) best = v;
			}
			if (best > NEG) dp[i][j] = best + w[i];
		}
		long long best = NEG;
		for (int j : pred[i])
			for (int k : pred[i]) {
				long long v = get(j, k);
				if (v > best) best = v;
			}
		if (best > NEG) dp[i][i] = best + w[i];
	}

	cout << dp[M - 1][M - 1] << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 頂点からなる有向グラフがある。$g_{i,j} = 1$ であるとき頂点 $i$ から頂点 $j$ への有向辺がある。
最初に、すべての頂点は白く塗られている。すぬけ君は、以下の操作を二回行うことができる。

- ある頂点を選び、その頂点から有向辺をたどっていくつかの頂点に訪れる。同じ頂点を複数回とおってもよい。
- 一回以上通った頂点をすべて黒く塗る。

二回の操作後、黒く塗られた頂点の個数の最大値を求めよ。
