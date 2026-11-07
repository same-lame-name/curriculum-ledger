#include <bits/stdc++.h>

using namespace std;

const int MAXN = 3000;

const int MOD = 1e9 + 7;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}
int sub(int i, int j) {
	if ((i -= j) < 0)
		i += MOD;
	return i;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	string s;

	cin >> n >> s;
	static int dp[MAXN + 1], dq[MAXN + 1];
	dp[1] = 1;
	for (int i = 1; i < n; ++i) {
		for (int j = 1; j <= i + 1; ++j)
			dp[j] = add(dp[j], dp[j - 1]);
		for (int j = 1; j <= i + 1; ++j)
			if (s[i - 1] == '>')
				dq[j] = sub(dp[i], dp[j - 1]);
			else
				dq[j] = dp[j - 1];
		swap(dp, dq);
	}
	int ans = 0;
	for (int i = 1; i <= n; ++i)
		ans = add(ans, dp[i]);
	cout << ans << '\n';
}
