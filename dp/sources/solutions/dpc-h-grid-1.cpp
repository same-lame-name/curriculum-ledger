#include <bits/stdc++.h>

using namespace std;

bool ok[1000][1000];
long long dp[1000][1000];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int h, w;
	cin >> h >> w;
	for (int i = 0; i < h; ++i) {
		string s;
		cin >> s;
		for (int j = 0; j < w; ++j)
			ok[i][j] = (s[j] == '.');
	}

	dp[0][0] = ok[0][0] ? 1 : 0;
	for (int i = 0; i < h; ++i) {
		for (int j = 0; j < w; ++j) {
			if (!ok[i][j]) { dp[i][j] = 0; continue; }
			if (i > 0) dp[i][j] = (dp[i][j] + dp[i - 1][j]) % 1000000007;
			if (j > 0) dp[i][j] = (dp[i][j] + dp[i][j - 1]) % 1000000007;
		}
	}

	cout << dp[h - 1][w - 1] << "\n";
	return 0;
}
