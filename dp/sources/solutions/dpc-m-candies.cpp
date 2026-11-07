#include <bits/stdc++.h>

using namespace std;

const int MAXK = 100000;
const int MOD = 1000000007;

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

	int n, k, a;
	cin >> n >> k;

	static int dp[MAXK + 1], dq[MAXK + 1];
	dp[0] = 1;
	for (int i = 1; i <= n; ++i) {
		cin >> a;
		for (int j = 1; j <= k; ++j)
			dp[j] = add(dp[j - 1], dp[j]);
		for (int j = 0; j <= k; ++j)
			dq[j] = sub(dp[j], (j > a ? dp[j - a - 1] : 0));
		swap(dp, dq);
	}
	cout << dp[k] << '\n';
}
