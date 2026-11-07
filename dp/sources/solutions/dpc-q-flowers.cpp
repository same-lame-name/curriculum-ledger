#include <bits/stdc++.h>

using namespace std;

const int MAXN = 2e5;

int n;
long long bit[MAXN + 1];

void update(int i, long long x) {
	for ( ; i <= n; i += i & -i)
		bit[i] = max(bit[i], x);
}

long long query(int i) {
	long long ans = 0;
	for ( ; i > 0; i -= i & -i)
		ans = max(ans, bit[i]);
	return ans;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	cin >> n;
	vector<int> h(n), a(n);
	for (int i = 0; i < n; ++i) cin >> h[i];
	for (int i = 0; i < n; ++i) cin >> a[i];
	for (int i = 0; i < n; ++i) {
		update(h[i], query(h[i] - 1) + a[i]);
	}
	cout << query(n) << '\n';
}
