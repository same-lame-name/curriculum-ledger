#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int K;
	cin >> K;
	int n = 1 << K;
	vector<int> R(n);
	for (int& x : R) cin >> x;

	vector<double> dp(n, 1.0), ndp(n);
	for (int i = 1; i <= K; ++i) {
		int half = 1 << (i - 1);
		int block = half << 1;
		for (int j = 0; j < n; ++j) {
			int base = j & ~(block - 1);
			int lo = ((j >> (i - 1)) & 1) ? base : base + half;
			int hi = ((j >> (i - 1)) & 1) ? base + half : base + block;
			double sum = 0.0;
			for (int k = lo; k < hi; ++k)
				sum += dp[k] / (1.0 + pow(10.0, (R[k] - R[j]) / 400.0));
			ndp[j] = dp[j] * sum;
		}
		dp.swap(ndp);
	}

	cout << fixed << setprecision(9);
	for (int j = 0; j < n; ++j) cout << dp[j] << '\n';
	return 0;
}
