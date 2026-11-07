# Intervals

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_w
**Tags:** lazy segment tree, range add/range max
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Consider a string of length $N$ consisting of `0` and `1`.
The score for the string is calculated as follows:

- For each $i$ ($1 \leq i \leq M$), $a_i$ is added to the score if the string contains `1` at least once between the $l_i$-th and $r_i$-th characters (inclusive).

Find the maximum possible score of a string.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 2 × 10^5$
- $1 \leq M \leq 2 × 10^5$
- $1 \leq l_i \leq r_i \leq N$
- $|a_i| \leq 10^9$

### Input
Input is given from Standard Input in the following format:

```
N M
l_1 r_1 a_1
l_2 r_2 a_2
:
l_M r_M a_M
```

### Output
Print the maximum possible score of a string.

### Sample Input 1
```
5 3
1 3 10
2 4 -10
3 5 10
```

### Sample Output 1
```
20
```

The score for `10001` is $a_1 + a_3 = 10 + 10 = 20$.

### Sample Input 2
```
3 4
1 3 100
1 1 -10
2 2 -20
3 3 -30
```

### Sample Output 2
```
90
```

The score for `100` is $a_1 + a_2 = 100 + (-10) = 90$.

### Sample Input 3
```
1 1
1 1 -10
```

### Sample Output 3
```
0
```

The score for `0` is $0$.

### Sample Input 4
```
1 5
1 1 1000000000
1 1 1000000000
1 1 1000000000
1 1 1000000000
1 1 1000000000
```

### Sample Output 4
```
5000000000
```

The answer may not fit into a 32-bit integer type.

### Sample Input 5
```
6 8
5 5 3
1 1 10
1 6 -8
3 6 5
3 4 9
5 5 -2
1 3 -6
4 6 -7
```

### Sample Output 5
```
10
```

For example, the score for `101000` is $a_2 + a_3 + a_4 + a_5 + a_7 = 10 + (-8) + 5 + 9 + (-6) = 10$.

## Editorial

`dp[i]` is the best score of a binary string whose last $1$ is at position $i$. For a previous $1$ at $j<i$,

$$dp[i] = \max_{j<i}\bigl(dp[j] + \text{cost}(j,i)\bigr),$$

where `cost(j,i)` is the total weight of intervals that contain $i$ but no selected $1$ in $[l_i, r_i]$. Sweep $i$ with a lazy segment tree over $j$: when an interval $[l,r]$ starts, add its weight to every $dp[j]$ with $j<l$; when it ends at $r+1$, subtract the weight from those same positions. The value placed at $i$ is the maximum over $[0,i-1]$. Total $O((N+M)\log N)$.

## Solution

```cpp
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
```

## Original statement (日本語)

### 問題文
長さ $N$ の `0` と `1` からなる文字列を考えます。
この文字列のスコアを次のように計算します。

- 各 $i$ ($1 \leq i \leq M$) について、$l_i$ 文字目から $r_i$ 文字目までに `1` がひとつ以上含まれるならば、スコアに $a_i$ を加算する。

文字列のスコアの最大値を求めてください。
