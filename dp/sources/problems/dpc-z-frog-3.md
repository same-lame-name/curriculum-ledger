# Frog 3

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_z
**Tags:** convex hull trick
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ stones, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), the height of Stone $i$ is $h_i$.
Here, $h_1 < h_2 < \cdots < h_N$ holds.

There is a frog who is initially on Stone $1$.
He will repeat the following action some number of times to reach Stone $N$:

- If the frog is currently on Stone $i$, jump to one of the following: Stone $i + 1, i + 2, \ldots, N$. Here, a cost of $(h_j - h_i)^2 + C$ is incurred, where $j$ is the stone to land on.

Find the minimum possible total cost incurred before the frog reaches Stone $N$.

### Constraints

- All values in input are integers.
- $2 \leq N \leq 2 \times 10^5$
- $1 \leq C \leq 10^{12}$
- $1 \leq h_1 < h_2 < \cdots < h_N \leq 10^6$

### Input
Input is given from Standard Input in the following format:

```
N C
h_1 h_2 ... h_N
```

### Output
Print the minimum possible total cost incurred.

### Sample Input 1
```
5 6
1 2 3 4 5
```

### Sample Output 1
```
20
```

If we follow the path $1$ → $3$ → $5$, the total cost incurred would be $((3 - 1)^2 + 6) + ((5 - 3)^2 + 6) = 20$.

### Sample Input 2
```
2 1000000000000
500000 1000000
```

### Sample Output 2
```
1250000000000
```

The answer may not fit into a 32-bit integer type.

### Sample Input 3
```
8 5
1 3 4 5 10 11 12 13
```

### Sample Output 3
```
62
```

If we follow the path $1$ → $2$ → $4$ → $5$ → $8$, the total cost incurred would be $((3 - 1)^2 + 5) + ((5 - 3)^2 + 5) + ((10 - 5)^2 + 5) + ((13 - 10)^2 + 5) = 62$.

## Editorial

`dp[i]` is the minimum cost to reach stone $i$:

$$dp[i] = \min_{j<i}\bigl(dp[j] + (h_i-h_j)^2 + C\bigr) = C + h_i^2 + \min_{j<i}\bigl(-2h_j\,h_i + dp[j] + h_j^2\bigr).$$

Each $j$ defines the line $y = (-2h_j)x + (dp[j]+h_j^2)$, and the query is its minimum at $x = h_i$. Since $h_i$ is increasing, the slopes $-2h_j$ are decreasing, so a monotone convex hull trick with a deque supports each add and query in amortised $O(1)$. Total $O(N)$.

## Solution

```cpp
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
```

## Original statement (日本語)

### 問題文
$N$ 個の足場があります。
足場には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N$) について、足場 $i$ の高さは $h_i$ です。
ここで、$h_1 < h_2 < \cdots < h_N$ です。

最初、足場 $1$ にカエルがいます。
カエルは次の行動を何回か繰り返し、足場 $N$ まで辿り着こうとしています。

- 足場 $i$ にいるとき、足場 $i + 1, i + 2, \ldots, N$ のどれかへジャンプする。 このとき、ジャンプ先の足場を $j$ とすると、コスト $(h_j - h_i)^2 + C$ を支払う。

カエルが足場 $N$ に辿り着くまでに支払うコストの総和の最小値を求めてください。
