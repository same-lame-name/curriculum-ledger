#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<int> x(N);
	for (int& v : x) cin >> v;

	int at[16];
	fill(at, at + 16, -1);
	for (int i = 0; i < N; ++i) at[x[i]] = i;

	int full = (1 << N) - 1;
	vector<double> dp(1 << N, 0.0);
	for (int mask = 1; mask <= full; ++mask) {
		double best = 1e100;
		for (int j = 0; j <= 15; ++j) {
			int hit = 0;
			double sum = 0.0;
			for (int k = j - 1; k <= j + 1; ++k) {
				if (k < 0 || k > 15) continue;
				int id = at[k];
				if (id < 0 || !(mask >> id & 1)) continue;
				++hit;
				sum += dp[mask ^ (1 << id)];
			}
			if (hit > 0) best = min(best, (3.0 + sum) / hit);
		}
		dp[mask] = best;
	}

	cout << fixed << setprecision(9) << dp[full] << '\n';
	return 0;
}
