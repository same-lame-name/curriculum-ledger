#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int A, B;
	cin >> A >> B;
	vector<long long> a(A), b(B);
	long long total = 0;
	for (long long& x : a) { cin >> x; total += x; }
	for (long long& x : b) { cin >> x; total += x; }

	// dp[j] = (first player's value) - (second player's value) when
	// i items remain on the left and j items remain on the right.
	vector<long long> dp(B + 1), ndp(B + 1);
	dp[0] = 0;
	for (int j = 1; j <= B; ++j)
		dp[j] = b[B - j] - dp[j - 1];

	for (int i = 1; i <= A; ++i) {
		long long topLeft = a[A - i];
		ndp[0] = topLeft - dp[0];
		for (int j = 1; j <= B; ++j) {
			long long takeLeft = topLeft - dp[j];
			long long takeRight = b[B - j] - ndp[j - 1];
			ndp[j] = max(takeLeft, takeRight);
		}
		dp.swap(ndp);
	}

	cout << (dp[B] + total) / 2 << '\n';
	return 0;
}
