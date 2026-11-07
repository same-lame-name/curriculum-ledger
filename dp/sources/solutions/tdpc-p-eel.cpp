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
