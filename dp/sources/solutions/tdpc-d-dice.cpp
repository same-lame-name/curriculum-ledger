#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	long long D;
	cin >> N >> D;

	int p2 = 0, p3 = 0, p5 = 0;
	while (D % 2 == 0) { D /= 2; ++p2; }
	while (D % 3 == 0) { D /= 3; ++p3; }
	while (D % 5 == 0) { D /= 5; ++p5; }
	if (D != 1) {
		cout << "0\n";
		return 0;
	}

	int s3 = p3 + 1, s5 = p5 + 1;
	auto id = [&](int j, int k, int l) {
		return (j * s3 + k) * s5 + l;
	};

	vector<double> dp((p2 + 1) * s3 * s5, 0.0), ndp(dp.size(), 0.0);
	dp[0] = 1.0;

	for (int i = 0; i < N; ++i) {
		fill(ndp.begin(), ndp.end(), 0.0);
		for (int j = 0; j <= p2; ++j)
			for (int k = 0; k <= p3; ++k)
				for (int l = 0; l <= p5; ++l) {
					double cur = dp[id(j, k, l)] / 6.0;
					if (cur == 0.0) continue;
					ndp[id(j, k, l)] += cur;                               // 1
					ndp[id(min(j + 1, p2), k, l)] += cur;                  // 2
					ndp[id(j, min(k + 1, p3), l)] += cur;                  // 3
					ndp[id(min(j + 2, p2), k, l)] += cur;                  // 4
					ndp[id(j, k, min(l + 1, p5))] += cur;                  // 5
					ndp[id(min(j + 1, p2), min(k + 1, p3), l)] += cur;     // 6
				}
		dp.swap(ndp);
	}

	cout << fixed << setprecision(9) << dp[id(p2, p3, p5)] << '\n';
	return 0;
}
