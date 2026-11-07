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
