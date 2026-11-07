# Semi Express

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_semiexp
**Tags:** prefix-sum optimisation
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

A certain railway line has $N$ stations, station 1 through station $N$. Snuke has decided to run a semi-express train on this line.

- The semi-express stops at station 1, at a subset of $\{\text{station } 2, \ldots, \text{station } N-1\}$, and at station $N$.

If it stops at $K$ or more consecutive stations, passengers get bored, so it does not do that.

Find the number of possible combinations of stops for the semi-express, modulo $1{,}000{,}000{,}007$.

### Constraints

- $2 \le K \le N \le 1000000$

### Input Format
Input is given from Standard Input in the following format:

```
N K
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
10 2
```

### Sample Output 1
```
21
```

### Sample Input 2
```
10 10
```

### Sample Output 2
```
255
```

## Editorial

### Claim

$DP[i][j]$ = the number of ways after looking at the first $i$ stations such that $j$ stations are currently chosen consecutively.

The transitions are

- $DP[i+1][0] = \sum_{k=0}^{K} DP[i][k]$
- $DP[i+1][j] = DP[i][j-1]$ for $1\le j\le K$

A naive implementation is $O(NK)$ and clearly too slow, but if the DP table is reused the transition can be read as: insert the sum of the table at the front and delete the last element. Keeping the sum with a deque therefore processes it in $O(N)$.

### Complexity

$O(N)$ time with a deque, $O(K)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static constexpr long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N, K;
	cin >> N >> K;

	// dp[j] = number of ways with j consecutive stops at the current station.
	// Only runs 0..K-1 are legal.  Station 1 is a forced stop.
	deque<long long> dp;
	dp.push_back(0);  // j = 0
	dp.push_back(1);  // j = 1: station 1
	for (int j = 2; j < K; ++j) dp.push_back(0);
	long long sum = 1;

	// Stations 2..N-1 are optional: skip (new run 0) or stop (shift runs).
	for (int i = 2; i <= N - 1; ++i) {
		long long drop = dp.back();
		dp.pop_back();
		dp.push_front(sum);
		sum = (2 * sum - drop) % MOD;
		if (sum < 0) sum += MOD;
	}

	// Station N is a forced stop: the previous run must be at most K-2.
	long long ans = (sum - dp.back()) % MOD;
	if (ans < 0) ans += MOD;
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

ある路線には駅 1 から駅 $N$ までの $N$ 個の駅がある。すぬけ君は、この路線に準急を走らせることにした。

- 準急は、駅 1 に止まり、{駅 2, ..., 駅 $N$-1} の部分集合に止まり、駅 $N$ に止まる。
連続する $K$個以上の駅に止まると、客が飽きてしまうので、そのようなことはしない。

準急の停車駅の組み合わせとして何通り考えられるか、mod 1,000,000,007 で求めよ。
