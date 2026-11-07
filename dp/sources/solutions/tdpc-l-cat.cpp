#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<vector<long long>> f(N, vector<long long>(N));
	for (int i = 0; i < N; ++i)
		for (int j = 0; j < N; ++j) cin >> f[i][j];

	const long long NEG = -(1LL << 60);
	// prev[j]: after placing the first i cats, the smallest index within
	// distance 1 of cat i is j (1-indexed), maximum total happiness.
	vector<long long> prev(N + 2, NEG);
	prev[1] = 0;

	for (int i = 1; i < N; ++i) {
		// prefix maximum over old states k <= j
		vector<long long> pref(N + 2, NEG);
		long long best = NEG;
		for (int k = 1; k <= i; ++k) {
			best = max(best, prev[k]);
			pref[k] = best;
		}
		pref[i + 1] = best;

		// suffix sums of f[i][l-1] for l = j..i+1
		vector<long long> suffix(N + 3, 0);
		for (int l = i + 1; l >= 1; --l)
			suffix[l] = suffix[l + 1] + f[i][l - 1];

		vector<long long> next(N + 2, NEG);
		for (int j = 1; j <= i + 1; ++j) {
			if (pref[j] == NEG) continue;
			// Each pair is counted in both cats' happiness.
			next[j] = pref[j] + 2 * suffix[j];
		}
		prev.swap(next);
	}

	cout << *max_element(prev.begin(), prev.end()) << '\n';
	return 0;
}
