#include <bits/stdc++.h>
using namespace std;

using ll = long long;
struct Line {
	mutable ll k, m, p;
	bool operator<(const Line& o) const { return k < o.k; }
	bool operator<(ll x) const { return p < x; }
	long long eval(long long x) const { return k * x + m; }
};

struct CHT {
	deque<Line> hull;
	static const ll inf = LLONG_MAX;

	ll div(ll a, ll b) { // floored division
		return a / b - ((a ^ b) < 0 && a % b); }
	bool isect(Line &x, const Line &y) {
		if (x.k == y.k) x.p = x.m > y.m ? inf : -inf;
		else x.p = div(y.m - x.m, x.k - y.k);
		return x.p >= y.p;
	}
	void add(long long k, long long m) {
		Line L = {k, m, 0};
		while ((int) hull.size() >= 2 && (isect(L, hull.back()),
			isect(hull.back(), hull[(int) hull.size() - 2]), L.p < hull.back().p))
			hull.pop_back();
		hull.push_back(L);
	}
	long long query(long long x) {
		while ((int) hull.size() >= 2 && hull[0].eval(x) >= hull[1].eval(x))
			hull.pop_front();
		return hull[0].eval(x);
	}
};

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n; long long c;
	cin >> n >> c;
	vector<long long> h(n), dp(n);
	for (long long&x : h) cin >> x;

	CHT ch;
	auto ins = [&](int i) {
		ch.add(-h[i] * 2, (dp[i] + (h[i] * h[i])));
	};
	dp[0] = 0; ins(0);
	for (int i = 1; i < n; ++i) {
		long long x = ch.query(h[i]);
		dp[i] = c + (h[i] * h[i]) + x;
		ins(i);
	}
	cout << dp[n - 1] << '\n';
}
