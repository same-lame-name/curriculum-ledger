# Dice

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_dice
**Tags:** expected value DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Find the probability that the product of the numbers shown when a die is rolled $N$ times is a multiple of $D$.

### Constraints

- $1 \le N \le 100$
- $1 \le D \le 10^{18}$

### Input Format
Input is given from Standard Input in the following format:

```
N D
```

### Output Format
Print the answer on one line. It is judged correct when the absolute error is at most $10^{-6}$.

### Sample Input 1
```
2 6
```

### Sample Output 1
```
0.416666667
```

When a die is rolled twice there are 36 outcomes, and in 15 of them the product is a multiple of 6, so the required probability is 15/36.

### Sample Input 2
```
3 2
```

### Sample Output 2
```
0.875000000
```

## Editorial

### Claim

A die shows one of $1,2,3,4,5,6$, so the product contains only the prime factors $2,3,5$. If $D$ has any other prime factor, the answer is $0$. Otherwise write $D = 2^{p_2}3^{p_3}5^{p_5}$.

$dp[i][j][k][l]$ = the probability that after $i$ rolls the product contains $j$ factors of $2$, $k$ factors of $3$, and $l$ factors of $5$. Counts at or above $p_2,p_3,p_5$ are identified, so it suffices to keep $0\le j\le p_2$, $0\le k\le p_3$, $0\le l\le p_5$.

The base case is $dp[0][0][0][0] = 1$. Each of the six outcomes adds $dp[i][j][k][l]/6$ to:

- outcome $1$: $(j,k,l)$
- outcome $2$: $(\min(j+1,p_2),k,l)$
- outcome $3$: $(j,\min(k+1,p_3),l)$
- outcome $4$: $(\min(j+2,p_2),k,l)$
- outcome $5$: $(j,k,\min(l,p_5))$
- outcome $6$: $(\min(j+1,p_2),\min(k+1,p_3),l)$

The answer is $dp[N][p_2][p_3][p_5]$.

### Complexity

$O(Np_2p_3p_5)$ time, and $O(p_2p_3p_5)$ memory with a rolling layer. Under the constraints the largest table is $(p_2+1)(p_3+1)(p_5+1)=2700$, attained at $D=979552051200000000$ with $(p_2,p_3,p_5)=(19,14,8)$.

## Solution

```cpp
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
```

## Original statement (日本語)

### Problem Statement

サイコロを $N$ 回振ったとき、出た目の積が $D$ の倍数となる確率を求めよ。
