#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	string s;
	cin >> s;
	int n = (int)s.size();

	vector<vector<int>> dp(n + 1, vector<int>(n + 1, 0));

	// full(a, b): s[a..b) can be reduced to the empty string.  Every
	// operation removes three characters, so a fully erased interval has
	// length divisible by 3 and uses all of them.
	auto full = [&](int a, int b) {
		int len = b - a;
		return len % 3 == 0 && dp[a][b] == len / 3;
	};

	for (int len = 3; len <= n; ++len) {
		for (int i = 0; i + len <= n; ++i) {
			int j = i + len;

			// Split the interval into two independent parts.
			for (int k = i + 1; k < j; ++k)
				dp[i][j] = max(dp[i][j], dp[i][k] + dp[k][j]);

			// Remove the two end characters together with some 'w'.
			if (s[i] == 'i' && s[j - 1] == 'i') {
				for (int k = i + 1; k + 1 < j; ++k) {
					if (s[k] == 'w' && full(i + 1, k) && full(k + 1, j - 1)) {
						dp[i][j] = max(dp[i][j], len / 3);
						break;
					}
				}
			}
		}
	}

	cout << dp[0][n] << '\n';
	return 0;
}
