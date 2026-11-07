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
