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
