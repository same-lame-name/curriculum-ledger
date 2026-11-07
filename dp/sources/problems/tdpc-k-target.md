# Target

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_target
**Tags:** longest chain DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

A sequence of circles $C_1, C_2, \dots, C_K$ is called a target of size $K$ if, for every $1 \le i < K$, $C_{i+1}$ lies strictly inside $C_i$.

Snuke drew $N$ circles. The $i$-th circle has center $(x_i, 0)$ and radius $r_i$. Find the maximum size of a target that can be made by choosing some of these circles.

### Constraints

- $1 \le N \le 100000$
- $0 \le x_i \le 100{,}000{,}000$
- $1 \le r_i \le 100{,}000{,}000$

### Input Format
Input is given from Standard Input in the following format:

```
N
x_1 r_1
...
x_N r_N
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
3
1 1
0 3
3 2
```

### Sample Output 1
```
2
```

If we let $C_1$ be the second circle and $C_2$ be the first circle, the sequence is a target.

### Sample Input 2
```
2
1 1
2 2
```

### Sample Output 2
```
1
```

The containment relation is strict: if the boundaries touch, the circle is not considered to be inside.

## Editorial

### Claim

Represent the $i$-th circle by its interval $[x_i-r_i, x_i+r_i]$ on the $x$-axis. For two circles $A$ and $B$, $B$ lies strictly inside $A$ exactly when

$x_B-r_B > x_A-r_A$ and $x_B+r_B < x_A+r_A$.

Sort the circles by left endpoint $x_i-r_i$ in descending order, breaking ties by right endpoint $x_i+r_i$ in descending order. Then a target corresponds to a subsequence whose right endpoints are strictly increasing when the subsequence is read in sorted order. Reversing that subsequence gives the target from outermost to innermost: for consecutive selected circles in sorted order, the later circle has a strictly smaller left endpoint (the tie-break makes the inequality strict) and a strictly larger right endpoint, so it strictly contains the earlier circle.

Therefore the answer is the length of the longest strictly increasing subsequence of the sorted right endpoints, computed with `lower_bound` in $O(N \log N)$ time. The `lower_bound` variant replaces the first element that is greater than or equal to the new value, so equal right endpoints are not chained.

### Complexity

$O(N \log N)$ time and $O(N)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int N;
	cin >> N;
	vector<pair<long long, long long>> circle(N);
	for (auto& [l, r] : circle) {
		long long x, rad;
		cin >> x >> rad;
		l = x - rad;
		r = x + rad;
	}

	// Outer circles have strictly smaller left endpoint and strictly larger
	// right endpoint.  Sort by left endpoint descending (ties: right endpoint
	// descending) and find the longest strictly increasing subsequence of
	// right endpoints.
	sort(circle.begin(), circle.end(), [](const auto& a, const auto& b) {
		if (a.first != b.first) return a.first > b.first;
		return a.second > b.second;
	});

	vector<long long> tails;
	for (auto& [l, r] : circle) {
		auto it = lower_bound(tails.begin(), tails.end(), r);
		if (it == tails.end()) tails.push_back(r);
		else *it = r;
	}

	cout << tails.size() << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

円の列 $C_1, C_2, ..., C_K$ は各 $i$ に対し $C_{i+1}$ が $C_i$ の strictly に内部にあるときサイズ $K$ のターゲットであるという。
すぬけ君は、円を $N$ 個描いた。$i$ 番目の円は中心が $(x_i, 0)$ であり、半径が $r_i$ である。この中から円をいくつか選んでターゲットを作るとき、ターゲットの最大サイズを求めよ。
