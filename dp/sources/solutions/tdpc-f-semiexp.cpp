#include <bits/stdc++.h>
using namespace std;

static constexpr long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, K;
	cin >> N >> K;

	// dp[j] = number of ways with j consecutive stops at the current station.
	// Only runs 0..K-1 are legal.  Station 1 is a forced stop.
	deque<long long> dp;
	dp.push_back(0);  // j = 0
	dp.push_back(1);  // j = 1: station 1
	for (int j = 2; j < K; ++j) dp.push_back(0);
	long long sum = 1;

	// Stations 2..N-1 are optional: skip (new run 0) or stop (shift runs).
	for (int i = 2; i <= N - 1; ++i) {
		long long drop = dp.back();
		dp.pop_back();
		dp.push_front(sum);
		sum = (2 * sum - drop) % MOD;
		if (sum < 0) sum += MOD;
	}

	// Station N is a forced stop: the previous run must be at most K-2.
	long long ans = (sum - dp.back()) % MOD;
	if (ans < 0) ans += MOD;
	cout << ans << '\n';
	return 0;
}
