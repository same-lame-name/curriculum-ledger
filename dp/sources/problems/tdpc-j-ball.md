# Ball

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_ball
**Tags:** expected value DP, bitmask DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There are $N$ objects. The $i$-th object is placed at coordinate $x_i$. When Snuke throws a ball aiming at coordinate $x$, the ball flies to one of $x-1$, $x$, and $x+1$, each with probability $1/3$, and if an object is there, that object is knocked down. Find the expected number of balls Snuke must throw to knock down all objects when he uses an optimal strategy.

Addendum: The place to throw the ball can be chosen after seeing where the previous ball flew.

### Constraints

- $1 \le N \le 16$
- $0 \le x_i \le 15$
- The $x_i$ are pairwise distinct.

### Input Format
Input is given from Standard Input in the following format:

```
N
x_1 ... x_N
```

### Output Format
Print the answer on one line. It is judged correct when the absolute error is at most $10^{-6}$.

### Sample Input 1
```
2
0 2
```

### Sample Output 1
```
4.500000000
```

It is good to keep throwing the ball toward coordinate 1.

### Sample Input 2
```
5
1 3 4 2 5
```

### Sample Output 2
```
8.986111111
```

## Editorial

### Claim

Let `dp[S]` be the expected number of additional throws needed when the set of remaining objects is $S$. The base case is `dp[empty set] = 0`.

For a nonempty set $S$ and an aiming coordinate $j \in \{0,1,\dots,15\}$, let

$H_j(S) = \{k \in \{j-1,j,j+1\} : \text{an object at coordinate } k \text{ exists and is in } S\}$,

and let $q = |H_j(S)|$. If $q > 0$, aiming at $j$ gives

$E_j = \dfrac{3 + \sum_{k \in H_j(S)} dp[S \setminus \{k\}]}{q}$.

Then `dp[S] = min_j E_j`, over all $j$ with $q > 0$. The $3/q$ form comes from

$dp[S] = 1 + \frac{1}{3}\sum_{k \in H_j(S)} dp[S \setminus \{k\}] + \frac{3-q}{3} dp[S]$,

where the last term is the probability of missing every remaining object at this aim; moving the self-loop term to the left gives the formula above.

The answer is `dp[full set]`. Since $S \setminus \{k\}$ is a proper subset of $S$, the states can be processed in increasing order of the bitmask.

### Complexity

$O(16 \cdot 3 \cdot 2^N) = O(16 \cdot 2^N)$ time and $O(2^N)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<int> x(N);
	for (int& v : x) cin >> v;

	int at[16];
	fill(at, at + 16, -1);
	for (int i = 0; i < N; ++i) at[x[i]] = i;

	int full = (1 << N) - 1;
	vector<double> dp(1 << N, 0.0);
	for (int mask = 1; mask <= full; ++mask) {
		double best = 1e100;
		for (int j = 0; j <= 15; ++j) {
			int hit = 0;
			double sum = 0.0;
			for (int k = j - 1; k <= j + 1; ++k) {
				if (k < 0 || k > 15) continue;
				int id = at[k];
				if (id < 0 || !(mask >> id & 1)) continue;
				++hit;
				sum += dp[mask ^ (1 << id)];
			}
			if (hit > 0) best = min(best, (3.0 + sum) / hit);
		}
		dp[mask] = best;
	}

	cout << fixed << setprecision(9) << dp[full] << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 個のものがある。$i$ 番目のものは座標 $x_i$ におかれている。すぬけ君が、座標 $x$ の点を目指してボールを投げると $x-1, x, x+1$ のうちのいずれかに 1/3 ずつの確率で飛んでいき、そこに物がおいてあった場合は倒れる。最適な戦略でボールを投げたとき、すべての物を倒すのに必要なボールを投げる回数の期待値を求めよ。

追記 : ボールを投げる場所は、前に投げたボールの飛んだ場所を見た後に決めることができる。
