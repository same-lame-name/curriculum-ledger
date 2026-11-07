# House

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_house
**Tags:** bitmask DP
**Limits:** 8 sec / 256 MiB

## Statement

### Problem Statement

Snuke's house has $H$ floors, and every floor has the same structure. Each floor has $R$ rooms, and there is a bidirectional corridor between rooms $i$ and $j$ when $g_{i,j} = 1$. Also, one can use the stairs to go down from room $r$ on floor $h$ to room $r$ on floor $h-1$. (Addendum: $h$ and $r$ are arbitrary integers.) (It is not possible to go up.)

Find the number of paths from room $1$ on floor $H$ to room $1$ on floor $1$ that do not pass through the same room twice, modulo $1{,}000{,}000{,}007$.

### Constraints

- $2 \le H \le 1{,}000{,}000{,}000$
- $1 \le R \le 16$
- $0 \le g_{i,j} \le 1$
- $g_{i,i} = 0$
- $g_{i,j} = g_{j,i}$

### Input Format
Input is given from Standard Input in the following format:

```
H R
g_{1,1} ... g_{1,R}
...
g_{R,1} ... g_{R,R}
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
10 2
0 1
1 0
```

### Sample Output 1
```
512
```

### Sample Input 2
```
2 5
0 1 1 1 1
1 0 1 1 1
1 1 0 1 1
1 1 1 0 1
1 1 1 1 0
```

### Sample Output 2
```
1025
```

## Editorial

### Claim

Let `dp[h][r]` be the number of ways, after descending to floor $h$, to be in room $r$. The initial state is `dp[H][1] = 1`. The answer appears as `dp[0][1]`: descending from floor $1$ to floor $0$ is a formal way to say "stop at room $1$ on floor $1$", and the zero-length path from room $1$ to itself on a floor has one way.

For a single floor, let `c(r,s)` be the number of paths from room $r$ to room $s$ that visit no room twice. Then

`dp[h-1][s] = sum_{r=1}^{R} dp[h][r] * c(r,s)`.

To compute `c(r,s)`, fix a start $r$ and use a subset DP: `ways[S][v]` is the number of simple paths that start at $r$, visit exactly the rooms in $S$, and end at $v$. Initialize `ways[{r}][r] = 1`; for every edge $(v,u)$ with $v \in S$ and $u \notin S$, add `ways[S][v]` to `ways[S union {u}][u]`. Then `c(r,s) = sum_S ways[S][s]` over all $S$ containing $r$. The only path from $r$ to $r$ is the zero-length path, so `c(r,r) = 1`.

The transition matrix $C = (c(r,s))$ does not depend on $h$. Apply it $H$ times by binary exponentiation: with row vectors, the answer is the first component of $e_1 C^H$.

### Complexity

Computing all `c(r,s)` takes $O(2^R R^3)$ time; binary exponentiation takes $O(R^3 \log H)$ time. Memory is $O(2^R R + R^2)$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static const long long MOD = 1000000007LL;

using Matrix = vector<vector<long long>>;

Matrix matmul(const Matrix& A, const Matrix& B) {
	int n = (int)A.size();
	Matrix C(n, vector<long long>(n, 0));
	for (int i = 0; i < n; ++i)
		for (int k = 0; k < n; ++k) {
			if (A[i][k] == 0) continue;
			for (int j = 0; j < n; ++j)
				C[i][j] = (C[i][j] + A[i][k] * B[k][j]) % MOD;
		}
	return C;
}

vector<long long> vecmul(const vector<long long>& v, const Matrix& A) {
	int n = (int)v.size();
	vector<long long> w(n, 0);
	for (int i = 0; i < n; ++i) {
		if (v[i] == 0) continue;
		for (int j = 0; j < n; ++j)
			w[j] = (w[j] + v[i] * A[i][j]) % MOD;
	}
	return w;
}

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	long long H;
	int R;
	cin >> H >> R;
	vector<vector<int>> g(R, vector<int>(R));
	for (int i = 0; i < R; ++i)
		for (int j = 0; j < R; ++j) cin >> g[i][j];

	// c[r][s]: simple paths on one floor from room r to room s.
	Matrix c(R, vector<long long>(R, 0));
	int full = (1 << R) - 1;
	for (int s = 0; s < R; ++s) {
		vector<long long> dp((size_t)(1 << R) * R, 0);
		dp[(size_t)(1 << s) * R + s] = 1;
		for (int mask = 0; mask <= full; ++mask) {
			if (!(mask >> s & 1)) continue;
			for (int v = 0; v < R; ++v) {
				long long ways = dp[(size_t)mask * R + v];
				if (ways == 0) continue;
				c[s][v] += ways;
				for (int u = 0; u < R; ++u)
					if (g[v][u] && !(mask >> u & 1))
						dp[(size_t)(mask | (1 << u)) * R + u] += ways;
			}
		}
		for (int v = 0; v < R; ++v) c[s][v] %= MOD;
	}

	// One matrix application per floor (floors H, H-1, ..., 1).
	vector<long long> v(R, 0);
	v[0] = 1;
	long long e = H;
	Matrix M = c;
	while (e > 0) {
		if (e & 1) v = vecmul(v, M);
		M = matmul(M, M);
		e >>= 1;
	}

	cout << v[0] % MOD << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

すぬけ君の家は $H$ 階建てであり、どの階も同じ構造をしている。各階には $R$ 個の部屋があり、部屋 $i$ と部屋 $j$ の間には $g_{i,j} = 1$ であるとき bidirectional な通路がある。また、$h$ 階の部屋 $r$ から $h-1$ 階の部屋 $r$ に階段を使って降りることができる。(追記 : h, r は任意の整数) (登ることはできない。)　$H$ 階の部屋 1 から $1$ 階の部屋 1 に同じ部屋をとおらずに行く経路の個数を mod 1,000,000,007 で求めよ。
