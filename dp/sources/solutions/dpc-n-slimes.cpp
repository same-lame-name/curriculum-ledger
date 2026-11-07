#include <bits/stdc++.h>
using namespace std;

const int MAXN = 400;
const long long INF = 0x3f3f3f3f3f3f3f3f;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;
	vector<long long> a(n), p(n);
	for (long long& x : a) cin >> x;
	for (int i = 0; i < n; ++i)
		p[i] = (i == 0 ? 0 : p[i - 1]) + a[i];
	auto query = [&](int l, int r) {
		return p[r] - (l == 0 ? 0 : p[l - 1]); };

	static long long dp[MAXN][MAXN];
	memset(dp, 0x3f, sizeof(dp));
	for (int i = 0; i + 1 < n; ++i) dp[i][i + 1] = a[i] + a[i + 1];
	for (int i = 0; i < n; ++i) dp[i][i] = 0;
	for (int i = n - 1; i >= 0; --i)
		for (int j = i + 2; j < n; ++j) {
			long long best = INF;
			for (int k = i; k < j; ++k)
				best = min(best, dp[i][k] + dp[k + 1][j]);
			dp[i][j] = query(i, j) + best;
		}
	cout << dp[0][n - 1] << '\n';
}
