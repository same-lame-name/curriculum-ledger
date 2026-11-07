#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int n; long long M;
	cin >> n >> M;

	vector<vector<int>> adj(n);
	for (int i = 0; i < n - 1; ++i) {
		int a, b;
		cin >> a >> b;
		--a; --b;
		adj[a].push_back(b);
		adj[b].push_back(a);
	}

	// iterative DFS: parent + preorder
	vector<int> par(n, -1), order;
	order.reserve(n);
	par[0] = -2;
	vector<int> st{0};
	while (!st.empty()) {
		int v = st.back(); st.pop_back();
		order.push_back(v);
		for (int u : adj[v]) if (par[u] == -1) {
			par[u] = v;
			st.push_back(u);
		}
	}

	// down pass: component of the subtree rooted at v
	vector<long long> down0(n, 1), down1(n, 1);
	for (int idx = n - 1; idx >= 0; --idx) {
		int v = order[idx];
		long long white = 1, black = 1;
		for (int u : adj[v]) if (par[u] == v) {
			white = white * down0[u] % M;
			black = black * ((down0[u] + down1[u]) % M) % M;
		}
		down0[v] = white;
		down1[v] = black;
	}

	// up pass: up[v] is the component above v, rooted at par[v]
	vector<long long> up0(n, 1), up1(n, 1), ans(n, 1);
	for (int idx = 0; idx < n; ++idx) {
		int v = order[idx];
		int d = (int)adj[v].size();
		vector<long long> pre(d + 1, 1), suf(d + 1, 1), contrib(d);
		for (int i = 0; i < d; ++i) {
			int u = adj[v][i];
			contrib[i] = (par[u] == v)
				? (down0[u] + down1[u]) % M
				: (up0[v] + up1[v]) % M;
			pre[i + 1] = pre[i] * contrib[i] % M;
		}
		for (int i = d - 1; i >= 0; --i)
			suf[i] = suf[i + 1] * contrib[i] % M;
		ans[v] = pre[d];
		for (int i = 0; i < d; ++i) {
			int u = adj[v][i];
			if (par[u] == v) {
				// cut (v,u): u's outside component is everything else at v
				up0[u] = 1;
				up1[u] = pre[i] * suf[i + 1] % M;
			}
		}
	}

	for (int i = 0; i < n; ++i) cout << ans[i] % M << '\n';
	return 0;
}
