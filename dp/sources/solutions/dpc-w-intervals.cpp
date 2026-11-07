#include <bits/stdc++.h>
using namespace std;

const long long INF = 0x3f3f3f3f3f3f3f3f;

template<class T> struct LazySeg {
	int sz; vector<T> st, lz;

	T comb(T a, T b) {
		return max(a, b);
	}
	void init(int n) {
		sz = 1; while (sz < n) sz <<= 1;
		st.assign(2 * sz, 0), lz.assign(2 * sz, 0);
	}
	void pull(int i) {
		st[i] = comb(st[i << 1], st[i << 1 | 1]);
	}
	void push(int i, int l, int r) {
		st[i] += lz[i];
		if (l != r) lz[i << 1] += lz[i], lz[i << 1 | 1] += lz[i];
		lz[i] = 0;
	}
	void update(int ql, int qr, T x, int i, int l, int r) {
		push(i, l, r); if (ql > r || qr < l) return;
		if (ql <= l && qr >= r) { lz[i] += x; return void(push(i, l, r)); }
		int m = (l + r) >> 1; update(ql, qr, x, i << 1, l, m);
		update(ql, qr, x, i << 1 | 1, m + 1, r); pull(i);
	}
	void update(int ql, int qr, T x) {
		update(ql, qr, x, 1, 0, sz - 1);
	}
	T query(int ql, int qr, int i, int l, int r) {
		push(i, l, r); if (ql > r || qr < l) return -INF;
		if (ql <= l && qr >= r) return st[i]; int m = (l + r) >> 1;
		return comb(query(ql, qr, i << 1, l, m), query(ql, qr, i << 1 | 1, m + 1, r));
	}
	T query(int ql, int qr) {
		return query(ql, qr, 1, 0, sz - 1);
	}
};

LazySeg<long long> st;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n, m;
	cin >> n >> m;
	vector<long long> add(n + 2);
	vector<vector<array<int, 2>>> todo(n + 2);
	while (m--) {
		int l, r, a;
		cin >> l >> r >> a;
		add[l] += a;
		todo[r + 1].push_back({a, l});
	}
	st.init(n + 1);
	for (int i = 1; i <= n + 1; ++i) {
		st.update(0, i - 1, add[i]);
		for (array<int, 2> ar : todo[i])
			st.update(0, ar[1] - 1, -ar[0]);
		st.update(i, i, st.query(0, i - 1));
	}
	cout << st.query(0, n) << '\n';
}
