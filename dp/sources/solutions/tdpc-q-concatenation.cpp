// TDPC Q - Concatenation
// Count distinct length-L binary strings obtainable by concatenating the
// given words (repetition allowed).
//
// State: dp[i][j] where, after n characters, i holds the last 7 characters
// (7 bits) and j's bit x is set iff the prefix of length n-x is obtainable.
// Appending bit k shifts j left by one and sets bit 0 iff some obtainable
// cut position x plus a word of length x+1 matches the new suffix.

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

static long long dp[128][256], ndp[128][256];

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, L;
	cin >> N >> L;
	vector<string> w(N);
	for (auto& s : w) cin >> s;

	// match[i][k] bit x set <=> some word of length x+1 equals the last
	// x+1 bits of (i, k), where i is the 7-bit window of previous characters.
	int match[128][2] = {};
	for (int i = 0; i < 128; ++i) {
		for (int k = 0; k < 2; ++k) {
			int mask = 0;
			for (const string& s : w) {
				int len = (int)s.size();
				int value = 0;
				for (char ch : s) value = (value << 1) | (ch - '0');
				int window = ((i << 1) | k) & ((1 << len) - 1);
				if (window == value) mask |= 1 << (len - 1);
			}
			match[i][k] = mask;
		}
	}

	dp[0][1] = 1;  // empty string: window 0, bit 0 (whole prefix) obtainable
	for (int n = 0; n < L; ++n) {
		memset(ndp, 0, sizeof(ndp));
		// A word of length x+1 can only be used if x+1 <= n+1.
		int limit = (n + 1 >= 8) ? 0xFF : ((1 << (n + 1)) - 1);
		for (int i = 0; i < 128; ++i) {
			for (int j = 0; j < 256; ++j) {
				long long cur = dp[i][j];
				if (!cur) continue;
				for (int k = 0; k < 2; ++k) {
					int ni = ((i << 1) | k) & 127;
					int nj = (j << 1) & 255;
					if ((j & match[i][k] & limit) != 0) nj |= 1;
					ndp[ni][nj] = (ndp[ni][nj] + cur) % MOD;
				}
			}
		}
		memcpy(dp, ndp, sizeof(dp));
	}

	long long ans = 0;
	for (int i = 0; i < 128; ++i)
		for (int j = 0; j < 256; ++j)
			if (j & 1) ans = (ans + dp[i][j]) % MOD;
	cout << ans << '\n';
	return 0;
}
