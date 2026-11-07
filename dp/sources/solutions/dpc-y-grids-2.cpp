#include <bits/stdc++.h>
using namespace std;

#define N	100000
#define M	3000
#define MOD	1000000007

int n, m, k, dp[M + 1];
long long fac[N << 1], ifac[N << 1];
struct P {
	int x, y;
	bool operator<(const P& other) const {
		if (x == other.x) return y < other.y;
		return x < other.x;
	}
} point[M + 1];

int power(long long x, int p) {
	long long res = 1;
	while (p > 0) {
		if (p & 1) res = res * x % MOD;
		x = x * x % MOD, p >>= 1;
	}
	return res;
}

void genFac(int size) {
	fac[0] = 1;
	for (int i = 1; i <= size; ++i)
		fac[i] = fac[i - 1] * i % MOD;
	ifac[size] = power(fac[size], MOD - 2);
	for (int i = size; i >= 1; --i)
		ifac[i - 1] = ifac[i] * i % MOD;
}
int choose(int n, int k) {
	assert(n >= k);
	return fac[n] * ifac[k] % MOD * ifac[n - k] % MOD;
}
int path(int i, int j, int x, int y) {
	assert(i <= x && j <= y);
	return choose(x - i + y - j, x - i);
}

int main() {
	scanf("%d%d%d", &n, &m, &k);
	genFac(n + m - 1);
	for (int i = 0; i < k; ++i)
		scanf("%d%d", &point[i].x, &point[i].y);
	point[k] = {n, m};
	sort(point, point + k + 1);
	for (int i = 0; i <= k; ++i) {
		long long sum = path(1, 1, point[i].x, point[i].y);
		for (int j = 0; j < i; ++j)
			if (point[i].y - point[j].y >= 0) {
				sum = sum - (long long) dp[j] * path(point[j].x, point[j].y, point[i].x, point[i].y) % MOD;
				if (sum < 0) sum += MOD;
			}
		dp[i] = sum;
	}
	printf("%d\n", dp[k]);
}
