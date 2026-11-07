# Coins

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_i
**Tags:** probability DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Let $N$ be a positive odd number.

There are $N$ coins, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), when Coin $i$ is tossed, it comes up heads with probability $p_i$ and tails with probability $1 - p_i$.

Taro has tossed all the $N$ coins.
Find the probability of having more heads than tails.

### Constraints

- $N$ is an odd number.
- $1 \leq N \leq 2999$
- $p_i$ is a real number and has two decimal places.
- $0 < p_i < 1$

### Input
Input is given from Standard Input in the following format:

```
N
p_1 p_2 ... p_N
```

### Output
Print the probability of having more heads than tails.
The output is considered correct when the absolute error is not greater than $10^{-9}$.

### Sample Input 1
```
3
0.30 0.60 0.80
```

### Sample Output 1
```
0.612
```

The probability of each case where we have more heads than tails is as follows:

- The probability of having $(Coin 1, Coin 2, Coin 3) = (Head, Head, Head)$ is $0.3 × 0.6 × 0.8 = 0.144$;
- The probability of having $(Coin 1, Coin 2, Coin 3) = (Tail, Head, Head)$ is $0.7 × 0.6 × 0.8 = 0.336$;
- The probability of having $(Coin 1, Coin 2, Coin 3) = (Head, Tail, Head)$ is $0.3 × 0.4 × 0.8 = 0.096$;
- The probability of having $(Coin 1, Coin 2, Coin 3) = (Head, Head, Tail)$ is $0.3 × 0.6 × 0.2 = 0.036$.

Thus, the probability of having more heads than tails is $0.144 + 0.336 + 0.096 + 0.036 = 0.612$.

### Sample Input 2
```
1
0.50
```

### Sample Output 2
```
0.5
```

Outputs such as `0.500`, `0.500000001` and `0.499999999` are also considered correct.

### Sample Input 3
```
5
0.42 0.01 0.42 0.99 0.42
```

### Sample Output 3
```
0.3821815872
```

## Editorial

`dp[i][j]` is the probability that among the first $i$ coins **at least** $j$ are heads. `dp[i][0] = 1` for every $i$, and

$$dp[i][j] = dp[i-1][j-1]\cdot p_i + dp[i-1][j]\cdot(1-p_i),$$

with `dp[i-1][j] = 0` when $j > i-1$. Reading the state as a tail probability is what makes `dp[i][0] = 1` correct. The answer is $dp[N][\lfloor N/2\rfloor + 1]$, the probability of a strict majority. $O(N^2)$ time.

## Solution

```cpp
#include<bits/stdc++.h>

using namespace std;

long double dp[3001][3001];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;

	vector<long double> p(n);

	for(int i = 0; i < n; ++i) cin >> p[i];

	int leastHeads = n / 2 + 1;

	for(int i = 0; i <= n; ++i) {
			dp[i][0] = 1;
	}

	for(int i = 1; i <= n; ++i) {
		for(int j = 1; j <= leastHeads; ++j) {
			dp[i][j] = dp[i - 1][j - 1] * p[i - 1] + dp[i - 1][j] * (1 - p[i - 1]);
		}
	}

	cout << fixed << setprecision(10) << dp[n][leastHeads] << endl;
}
```

## Original statement (日本語)

### 問題文
$N$ を正の奇数とします。

$N$ 枚のコインがあります。
コインには $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N$) について、コイン $i$ を投げると、確率 $p_i$ で表が出て、確率 $1 - p_i$ で裏が出ます。

太郎君は $N$ 枚のコインをすべて投げました。
このとき、表の個数が裏の個数を上回る確率を求めてください。
