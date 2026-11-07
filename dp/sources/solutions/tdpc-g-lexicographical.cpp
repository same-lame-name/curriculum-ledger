#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	string s;
	long long K;
	cin >> s >> K;

	int n = (int)s.size();
	long long cap = K + 1;  // saturate counts above K

	// dp[i] = number of distinct subsequences (including the empty one)
	// of s[i..n-1].
	vector<long long> dp(n + 1, 1), nxt(n, -1);
	vector<int> last(26, -1);
	for (int i = n - 1; i >= 0; --i) {
		nxt[i] = last[s[i] - 'a'];
		last[s[i] - 'a'] = i;
		long long sub = (nxt[i] == -1) ? 0 : dp[nxt[i] + 1];
		dp[i] = min(cap, 2 * dp[i + 1] - sub);
	}

	if (dp[0] - 1 < K) {
		cout << "Eel\n";
		return 0;
	}

	vector<vector<int>> occ(26);
	for (int i = 0; i < n; ++i) occ[s[i] - 'a'].push_back(i);
	vector<size_t> cursor(26, 0);

	string ans;
	int pos = 0;
	while (K > 0) {
		for (int c = 0; c < 26; ++c) {
			while (cursor[c] < occ[c].size() && occ[c][cursor[c]] < pos)
				++cursor[c];
			if (cursor[c] == occ[c].size()) continue;
			int p = occ[c][cursor[c]];
			long long cnt = dp[p + 1];  // strings starting with this character
			if (K > cnt) {
				K -= cnt;
			} else {
				ans.push_back(char('a' + c));
				pos = p + 1;
				--K;
				break;
			}
		}
	}

	cout << ans << '\n';
	return 0;
}
