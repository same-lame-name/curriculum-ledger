# Grid 2

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_y
**Tags:** combinatorics, obstacle subtraction
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a grid with $H$ horizontal rows and $W$ vertical columns.
Let $(i, j)$ denote the square at the $i$-th row from the top and the $j$-th column from the left.

In the grid, $N$ Squares $(r_1, c_1), (r_2, c_2), \ldots, (r_N, c_N)$ are wall squares, and the others are all empty squares.
It is guaranteed that Squares $(1, 1)$ and $(H, W)$ are empty squares.

Taro will start from Square $(1, 1)$ and reach $(H, W)$ by repeatedly moving right or down to an adjacent empty square.

Find the number of Taro's paths from Square $(1, 1)$ to $(H, W)$, modulo $10^9 + 7$.

### Constraints

- All values in input are integers.
- $2 \leq H, W \leq 10^5$
- $1 \leq N \leq 3000$
- $1 \leq r_i \leq H$
- $1 \leq c_i \leq W$
- Squares $(r_i, c_i)$ are all distinct.
- Squares $(1, 1)$ and $(H, W)$ are empty squares.

### Input
Input is given from Standard Input in the following format:

```
H W N
r_1 c_1
r_2 c_2
:
r_N c_N
```

### Output
Print the number of Taro's paths from Square $(1, 1)$ to $(H, W)$, modulo $10^9 + 7$.

### Sample Input 1
```
3 4 2
2 2
1 4
```

### Sample Output 1
```
3
```

There are three paths as follows:

![](assets/dpc-grids-2/2d6aeb03cc.png)

### Sample Input 2
```
5 2 2
2 1
4 2
```

### Sample Output 2
```
0
```

There may be no paths.

### Sample Input 3
```
5 5 4
3 1
3 5
1 3
5 3
```

### Sample Output 3
```
24
```

### Sample Input 4
```
100000 100000 1
50000 50000
```

### Sample Output 4
```
123445622
```

Be sure to print the count modulo $10^9 + 7$.

## Editorial

Sort the obstacles and the goal by (row, column). `dp[i]` is the number of monotone paths from $(1,1)$ to point $i$ that pass through no earlier obstacle. The unrestricted count is $\binom{r_i-1+c_i-1}{r_i-1}$; for every earlier obstacle $j$ with $c_j \le c_i$, subtract the paths that do pass through $j$:

$$dp[i] = \binom{r_i+c_i-2}{r_i-1} - \sum_{j<i,\ c_j \le c_i} dp[j]\cdot\binom{r_i-r_j+c_i-c_j}{r_i-r_j}.$$

Appending $(H,W)$ to the list makes the answer its `dp` value. $O(K^2 + H + W)$ after precomputing factorials.

## Solution

```cpp
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
```

## Original statement (日本語)

### 問題文
縦 $H$ 行、横 $W$ 列のグリッドがあります。
上から $i$ 行目、左から $j$ 列目のマスを $(i, j)$ で表します。

グリッドのうち、$N$ 個のマス $(r_1, c_1), (r_2, c_2), \ldots, (r_N, c_N)$ は壁のマスであり、それら以外のマスはすべて空マスです。
マス $(1, 1)$ および $(H, W)$ は空マスであることが保証されています。

太郎君は、マス $(1, 1)$ から出発し、右または下に隣り合う空マスへの移動を繰り返すことで、マス $(H, W)$ まで辿り着こうとしています。

マス $(1, 1)$ から $(H, W)$ までの太郎君の経路は何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。
