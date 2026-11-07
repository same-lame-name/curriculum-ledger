// TDPC O - String
// Count strings with prescribed letter frequencies and no equal neighbours.
//
// dp[a] = number of arrangements of the letters processed so far that have
// exactly a "bad" gaps (two equal letters adjacent).  When inserting cnt
// copies of the next letter, split them into i non-empty groups and put j of
// those groups into bad gaps and i-j into the remaining b = (len+1) - a gaps.
// The number of bad gaps becomes a + cnt - i - j.

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;
static long long C[305][305];

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	vector<int> freq(26);
	for (int& x : freq) cin >> x;

	for (int n = 0; n <= 300; ++n) {
		C[n][0] = 1;
		for (int k = 1; k <= n; ++k)
			C[n][k] = (C[n - 1][k - 1] + C[n - 1][k]) % MOD;
	}

	// Initially the empty arrangement: 0 letters, 0 bad gaps, 1 gap.
	vector<long long> dp(1, 1);
	int len = 0;

	for (int c = 0; c < 26; ++c) {
		int cnt = freq[c];
		if (cnt == 0) continue;

		vector<long long> nxt(len + cnt + 2, 0);
		for (int a = 0; a < (int)dp.size(); ++a) {
			if (dp[a] == 0) continue;
			int b = (len + 1) - a;  // total gaps minus bad gaps
			for (int i = 1; i <= cnt; ++i) {
				for (int j = 0; j <= min(a, i); ++j) {
					int k = i - j;  // groups placed into good gaps
					if (k > b) continue;
					long long ways = C[cnt - 1][i - 1] * C[a][j] % MOD * C[b][k] % MOD;
					int na = a + cnt - i - j;
					nxt[na] = (nxt[na] + dp[a] * ways) % MOD;
				}
			}
		}

		len += cnt;
		dp.swap(nxt);
	}

	cout << dp[0] % MOD << '\n';
	return 0;
}
