#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<pair<long long, long long>> circle(N);
	for (auto& [l, r] : circle) {
		long long x, rad;
		cin >> x >> rad;
		l = x - rad;
		r = x + rad;
	}

	// Outer circles have strictly smaller left endpoint and strictly larger
	// right endpoint.  Sort by left endpoint descending (ties: right endpoint
	// descending) and find the longest strictly increasing subsequence of
	// right endpoints.
	sort(circle.begin(), circle.end(), [](const auto& a, const auto& b) {
		if (a.first != b.first) return a.first > b.first;
		return a.second > b.second;
	});

	vector<long long> tails;
	for (auto& [l, r] : circle) {
		auto it = lower_bound(tails.begin(), tails.end(), r);
		if (it == tails.end()) tails.push_back(r);
		else *it = r;
	}

	cout << tails.size() << '\n';
	return 0;
}
