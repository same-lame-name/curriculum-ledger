# Slimes

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_n
**Tags:** interval DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ slimes lining up in a row.
Initially, the $i$-th slime from the left has a size of $a_i$.

Taro is trying to combine all the slimes into a larger slime.
He will perform the following operation repeatedly until there is only one slime:

- Choose two adjacent slimes, and combine them into a new slime. The new slime has a size of $x + y$, where $x$ and $y$ are the sizes of the slimes before combining them. Here, a cost of $x + y$ is incurred. The positional relationship of the slimes does not change while combining slimes.

Find the minimum possible total cost incurred.

### Constraints

- All values in input are integers.
- $2 \leq N \leq 400$
- $1 \leq a_i \leq 10^9$

### Input
Input is given from Standard Input in the following format:

```
N
a_1 a_2 ... a_N
```

### Output
Print the minimum possible total cost incurred.

### Sample Input 1
```
4
10 20 30 40
```

### Sample Output 1
```
190
```

Taro should do as follows (slimes being combined are shown in bold):

- (10, 20, 30, 40) → (30, 30, 40)
- (30, 30, 40) → (60, 40)
- (60, 40) → (100)

### Sample Input 2
```
5
10 10 10 10 10
```

### Sample Output 2
```
120
```

Taro should do, for example, as follows:

- (10, 10, 10, 10, 10) → (20, 10, 10, 10)
- (20, 10, 10, 10) → (20, 20, 10)
- (20, 20, 10) → (20, 30)
- (20, 30) → (50)

### Sample Input 3
```
3
1000000000 1000000000 1000000000
```

### Sample Output 3
```
5000000000
```

The answer may not fit into a 32-bit integer type.

### Sample Input 4
```
6
7 6 8 6 1 1
```

### Sample Output 4
```
68
```

Taro should do, for example, as follows:

- (7, 6, 8, 6, 1, 1) → (7, 6, 8, 6, 2)
- (7, 6, 8, 6, 2) → (7, 6, 8, 8)
- (7, 6, 8, 8) → (13, 8, 8)
- (13, 8, 8) → (13, 16)
- (13, 16) → (29)

## Editorial

Let $\texttt{dp}[i][j]$ represent the minimum cost to merge the slimes $i\dots j$ into one slime.

To calculate $\texttt{dp}[i][j]$, we want to merge two smaller (combined) slimes in the range $[i, j]$. To do this, we loop through all $k$ in the range $[i, j - 1]$ and simulate merging $[i, k]$ and $[k + 1, j]$. Note that the cost of this is $\texttt{dp}[i][k] + \texttt{dp}[k + 1][j] + a[i] + a[i + 1] + \dots + a[j]$. Here, $a[i] + a[i + 1] + \dots + a[j]$ can be precalculated with prefix sums.

This takes $\mathcal O(N^3)$ which fits in the Time Limit but can be optimized to $\mathcal O(N^2)$ with Knuth's Optimization.

The code below is $\mathcal O(N^3)$.

```
#include <bits/stdc++.h>
using namespace std;

const int MAXN = 400;
const long long INF = 0x3f3f3f3f3f3f3f3f;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;
	vector<long long> a(n), p(n);
	for (long long& x : a) cin >> x;
	for (int i = 0; i < n; ++i)
		p[i] = (i == 0 ? 0 : p[i - 1]) + a[i];
	auto query = [&](int l, int r) {
		return p[r] - (l == 0 ? 0 : p[l - 1]); };

	static long long dp[MAXN][MAXN];
	memset(dp, 0x3f, sizeof(dp));
	for (int i = 0; i + 1 < n; ++i) dp[i][i + 1] = a[i] + a[i + 1];
	for (int i = 0; i < n; ++i) dp[i][i] = 0;
	for (int i = n - 1; i >= 0; --i)
		for (int j = i + 2; j < n; ++j) {
			long long best = INF;
			for (int k = i; k < j; ++k)
				best = min(best, dp[i][k] + dp[k + 1][j]);
			dp[i][j] = query(i, j) + best;
		}
	cout << dp[0][n - 1] << '\n';
}
```

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

const int MAXN = 400;
const long long INF = 0x3f3f3f3f3f3f3f3f;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;
	vector<long long> a(n), p(n);
	for (long long& x : a) cin >> x;
	for (int i = 0; i < n; ++i)
		p[i] = (i == 0 ? 0 : p[i - 1]) + a[i];
	auto query = [&](int l, int r) {
		return p[r] - (l == 0 ? 0 : p[l - 1]); };

	static long long dp[MAXN][MAXN];
	memset(dp, 0x3f, sizeof(dp));
	for (int i = 0; i + 1 < n; ++i) dp[i][i + 1] = a[i] + a[i + 1];
	for (int i = 0; i < n; ++i) dp[i][i] = 0;
	for (int i = n - 1; i >= 0; --i)
		for (int j = i + 2; j < n; ++j) {
			long long best = INF;
			for (int k = i; k < j; ++k)
				best = min(best, dp[i][k] + dp[k + 1][j]);
			dp[i][j] = query(i, j) + best;
		}
	cout << dp[0][n - 1] << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 匹のスライムが横一列に並んでいます。
最初、左から $i$ 番目のスライムの大きさは $a_i$ です。

太郎君は、すべてのスライムを合体させて $1$ 匹のスライムにしようとしています。
スライムが $1$ 匹になるまで、太郎君は次の操作を繰り返し行います。

- 左右に隣り合う $2$ 匹のスライムを選び、それらを合体させて新しい $1$ 匹のスライムにする。 合体前の $2$ 匹のスライムの大きさを $x$ および $y$ とすると、合体後のスライムの大きさは $x + y$ となる。 このとき、太郎君は $x + y$ のコストを支払う。 なお、合体の前後でスライムたちの位置関係は変わらない。

太郎君が支払うコストの総和の最小値を求めてください。
