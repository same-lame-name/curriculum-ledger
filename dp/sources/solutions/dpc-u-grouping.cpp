#include <bits/stdc++.h>
using namespace std;

const int MAXN = 16;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	static int a[MAXN][MAXN];
	static long long cost[1 << MAXN];
	static long long dp[1 << MAXN];
	cin >> n;
	for (int i = 0; i < n; ++i)
		for (int j = 0; j < n; ++j)
			cin >> a[i][j];
	for (int i = 0; i < (1 << n); ++i)
		for (int j = 0; j < n; ++j)
			for (int k = j + 1; k < n; ++k)
				if (i & (1 << j) && i & (1 << k))
					cost[i] += a[j][k];
	for (int i = 0, j; i < (1 << n); ++i) {
		j = ((1 << n) - 1) ^ i;
		for (int k = j; k; k = (k - 1) & j)
			dp[i ^ k] = max(dp[i ^ k], dp[i] + cost[k]);
	}
	cout << dp[(1 << n) - 1] << '\n';
}
