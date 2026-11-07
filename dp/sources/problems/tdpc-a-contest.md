# Contest

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_contest
**Tags:** subset sum
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

There is a contest with $N$ problems, and the $i$-th problem is worth $p_i$ points. A contestant solves some of the problems, and the score is the sum of the points of the solved problems. How many different scores can this contest produce?

### Constraints

- $1 \le N \le 100$
- $1 \le p_i \le 100$

### Input Format
Input is given from Standard Input in the following format:

```
N
p_1 p_2 ... p_N
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
3
2 3 5
```

### Sample Output 1
```
7
```

The seven possible scores are 0, 2, 3, 5, 7, 8 and 10.

### Sample Input 2
```
10
1 1 1 1 1 1 1 1 1 1
```

### Sample Output 2
```
11
```

The eleven possible scores are 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10.

## Editorial

### Claim

`dp[i][j]` = whether $j$ points can be scored using the first $i$ problems. With $M = \max p_i$ the table has $O(N^2 M)$ states, each updated in $O(1)$:

```
dp[i+1][j]     |= dp[i][j]
dp[i+1][j+p_i] |= dp[i][j]
```

The transition can also be done with bit operations: keep each row as a bitset and OR in `row << p_i`.

### Complexity

$O(N^2 M)$ time with the plain table, $O(N \cdot \text{maxSum} / 64)$ with bitsets; $O(N M)$ memory.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int n;
	cin >> n;
	vector<int> p(n);
	for (int& x : p) cin >> x;

	int sum = 0;
	vector<char> can(1, 1);
	for (int x : p) {
		vector<char> nxt(sum + x + 1, 0);
		for (int j = 0; j <= sum; ++j)
			if (can[j]) nxt[j] = nxt[j + x] = 1;
		sum += x;
		can.swap(nxt);
	}

	cout << count(can.begin(), can.end(), 1) << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 問の問題があるコンテストがあり、$i$ 問目の問題の配点は $p_i$ 点である。コンテスタントは、この問題の中から何問か解き、解いた問題の配点の合計が得点となる。このコンテストの得点は何通り考えられるか。
