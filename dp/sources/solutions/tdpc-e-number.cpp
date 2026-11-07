#include <bits/stdc++.h>
using namespace std;

static constexpr long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int D;
	string N;
	cin >> D >> N;

	// dp[tight][r]: number of prefixes with digit sum = r (mod D);
	// tight = 1 means the prefix is still equal to N's prefix.
	vector<array<long long, 2>> dp(D), ndp(D);
	for (auto& e : dp) e = {0, 0};
	dp[0][1] = 1;

	for (char ch : N) {
		for (auto& e : ndp) e = {0, 0};
		int lim = ch - '0';
		for (int r = 0; r < D; ++r) {
			for (int tight = 0; tight <= 1; ++tight) {
				long long ways = dp[r][tight];
				if (!ways) continue;
				int maxDigit = tight ? lim : 9;
				for (int d = 0; d <= maxDigit; ++d) {
					int nt = (tight && d == lim) ? 1 : 0;
					long long& to = ndp[(r + d) % D][nt];
					to += ways;
					if (to >= MOD) to -= MOD;
				}
			}
		}
		dp.swap(ndp);
	}

	// Subtract the number 0, whose digit sum is 0.
	long long ans = (dp[0][0] + dp[0][1] - 1) % MOD;
	if (ans < 0) ans += MOD;
	cout << ans << '\n';
	return 0;
}
