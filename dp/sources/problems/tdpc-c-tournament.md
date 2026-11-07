# Tournament

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_tournament
**Tags:** probability DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There is a tournament with $2^K$ participants. The tournament is held in the following format.

- In the first round, 1 plays 2, 3 plays 4, … .
- In the second round, (the winner of 1 vs 2) plays (the winner of 3 vs 4), (the winner of 5 vs 6) plays (the winner of 7 vs 8), … .
- In the third round, (the winner of (1 vs 2) vs (3 vs 4)) plays (the winner of (5 vs 6) vs (7 vs 8)), (the winner of (9 vs 10) vs (11 vs 12)) plays (the winner of (13 vs 14) vs (15 vs 16)), … .
- Rounds continue in the same way through round $K$.

The champion is determined when round $K$ ends. When person $i$'s Elo rating is $R_i$, find the probability that person $i$ wins the tournament.

Here, when a person $P$ with Elo rating $R_P$ plays a person $Q$ with Elo rating $R_Q$, the probability that $P$ wins is $1/(1+10^{(R_Q-R_P)/400})$, and the outcomes of different matches are independent.

### Constraints

- $1 \le K \le 10$
- $0 \le R_i \le 4000$

### Input Format
Input is given from Standard Input in the following format:

```
K
R_1
…
R_{2^K}
```

### Output Format
Print $2^K$ lines. The $i$-th line is the probability that person $i$ wins the tournament; it is judged correct when the absolute error is at most $10^{-6}$.

### Sample Input 1
```
1
2200
2600
```

### Sample Output 1
```
0.090909091
0.909090909
```

### Sample Input 2
```
3
2000
2500
2300
2700
2100
2400
2600
2200
```

### Sample Output 2
```
0.000086893
0.122042976
0.005522752
0.493464665
0.000651695
0.053982389
0.321828438
0.002420190
```

## Editorial

### Claim

$dp[i][j]$ = the probability that $j$ wins round $i$. Initialize $dp[0][j] = 1$ for every $j$; the editorial states that the answer is $dp[K][0]$.

In round $i$, $j$ and $k$ can be opponents exactly when

$$\left\lfloor \frac{j-1}{2^i} \right\rfloor = \left\lfloor \frac{k-1}{2^i} \right\rfloor
\quad\text{and}\quad
\left\lfloor \frac{j-1}{2^{i-1}} \right\rfloor \ne \left\lfloor \frac{k-1}{2^{i-1}} \right\rfloor .$$

For each such pair $(j,k)$, the transition contributes the probability that both players reach round $i$ and that $j$ wins:

$$dp[i][j] = dp[i-1][j] \sum_{k} dp[i-1][k]\cdot \frac{1}{1+10^{(R_k-R_j)/400}},$$

where $k$ ranges over the opponents of $j$ in round $i$.

### Complexity

$O(K4^K)$ if all $(i,j,k)$ triples are tested. Visiting only possible opponent pairs gives $O(K2^K + 4^K)$: in round $i$ each $j$ has $2^{i-1}$ possible opponents, and $\sum_i 2^{i-1}2^K = O(4^K)$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int K;
	cin >> K;
	int n = 1 << K;
	vector<int> R(n);
	for (int& x : R) cin >> x;

	vector<double> dp(n, 1.0), ndp(n);
	for (int i = 1; i <= K; ++i) {
		int half = 1 << (i - 1);
		int block = half << 1;
		for (int j = 0; j < n; ++j) {
			int base = j & ~(block - 1);
			int lo = ((j >> (i - 1)) & 1) ? base : base + half;
			int hi = ((j >> (i - 1)) & 1) ? base + half : base + block;
			double sum = 0.0;
			for (int k = lo; k < hi; ++k)
				sum += dp[k] / (1.0 + pow(10.0, (R[k] - R[j]) / 400.0));
			ndp[j] = dp[j] * sum;
		}
		dp.swap(ndp);
	}

	cout << fixed << setprecision(9);
	for (int j = 0; j < n; ++j) cout << dp[j] << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$2^K$ 人が参加するトーナメントがある。このトーナメントでは以下の形式で試合を行う。

- 第 1 ラウンドでは、1 と 2、3 と 4、…　が試合を行う。
- 第 2 ラウンドでは、(1 と 2 の勝者) と (3 と 4 の勝者), (5 と 6 の勝者) と (7 と 8 の勝者), …　が試合を行う。
- 第 3 ラウンドでは、((1 と 2 の勝者) と (3 と 4 の勝者) の勝者) と ((5 と 6 の勝者) と (7 と 8 の勝者) の勝者), ((9 と 10 の勝者) と (11 と 12 の勝者) の勝者) と ((13 と 14 の勝者) と (15 と 16 の勝者) の勝者), …　が試合を行う。
- 以下同様に第 $K$ ラウンドまで行う。

第 $K$ ラウンドの終了後に優勝者が決定する。人 $i$ の Elo Rating が $R_i$ であるとき、人 $i$ の優勝確率を求めよ。

ただし、Elo Rating $R_P$ の人 P と Elo Rating $R_Q$ の人 Q が対戦した場合、人 P が勝つ確率は $1 / (1 + 10^{(R_Q - R_P) / 400})$ であり、異なる試合の勝敗は独立であるとする。
