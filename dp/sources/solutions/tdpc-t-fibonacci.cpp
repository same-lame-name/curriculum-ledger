// TDPC T - Fibonacci
// a_1 = ... = a_K = 1, a_i = a_{i-1} + ... + a_{i-K}.  Find a_N mod 1e9+7.
//
// The companion matrix has characteristic polynomial
//   f(x) = x^K - x^{K-1} - ... - x - 1.
// Compute x^(N-K) mod f by binary exponentiation; if
//   x^(N-K) = sum_{j=0}^{K-1} c_j x^j   (mod f),
// then a_N = sum_j c_j a_{K+j}.  Polynomial multiplication and reduction are
// O(K^2), so the total is O(K^2 log N).

#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

int K;

// (a * b) mod f, where a and b have degree < K.
vector<long long> mulmod(const vector<long long>& a, const vector<long long>& b) {
	vector<long long> prod(2 * K - 1, 0);
	for (int i = 0; i < K; ++i) {
		if (!a[i]) continue;
		for (int j = 0; j < K; ++j)
			prod[i + j] = (prod[i + j] + a[i] * b[j]) % MOD;
	}
	// x^K == x^{K-1} + ... + x + 1
	for (int d = 2 * K - 2; d >= K; --d) {
		long long c = prod[d];
		if (!c) continue;
		for (int t = 1; t <= K; ++t)
			prod[d - t] = (prod[d - t] + c) % MOD;
	}
	prod.resize(K);
	return prod;
}

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	long long N;
	cin >> K >> N;

	if (N <= K) {
		cout << 1 << '\n';
		return 0;
	}

	long long e = N - K;  // >= 1
	vector<long long> res(K, 0), base(K, 0);
	res[0] = 1;           // x^0
	if (K >= 2) base[1] = 1;  // x

	while (e > 0) {
		if (e & 1) res = mulmod(res, base);
		base = mulmod(base, base);
		e >>= 1;
	}

	// a[1..2K-1]
	vector<long long> a(2 * K + 1, 0);
	long long window = 0;
	for (int i = 1; i <= K; ++i) {
		a[i] = 1;
		window = (window + 1) % MOD;
	}
	for (int i = K + 1; i <= 2 * K - 1; ++i) {
		a[i] = window;
		window = ((2 * window - a[i - K]) % MOD + MOD) % MOD;
	}

	long long ans = 0;
	for (int j = 0; j < K; ++j)
		ans = (ans + res[j] * a[K + j]) % MOD;
	cout << ans << '\n';
	return 0;
}
