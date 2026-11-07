# Grouping

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_u
**Tags:** subset DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ rabbits, numbered $1, 2, \ldots, N$.

For each $i, j$ ($1 \leq i, j \leq N$), the compatibility of Rabbit $i$ and $j$ is described by an integer $a_{i, j}$.
Here, $a_{i, i} = 0$ for each $i$ ($1 \leq i \leq N$), and $a_{i, j} = a_{j, i}$ for each $i$ and $j$ ($1 \leq i, j \leq N$).

Taro is dividing the $N$ rabbits into some number of groups.
Here, each rabbit must belong to exactly one group.
After grouping, for each $i$ and $j$ ($1 \leq i < j \leq N$), Taro earns $a_{i, j}$ points if Rabbit $i$ and $j$ belong to the same group.

Find Taro's maximum possible total score.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 16$
- $|a_{i, j}| \leq 10^9$
- $a_{i, i} = 0$
- $a_{i, j} = a_{j, i}$

### Input
Input is given from Standard Input in the following format:

```
N
a_1, 1 ... a_1, N
:
a_N, 1 ... a_N, N
```

### Output
Print Taro's maximum possible total score.

### Sample Input 1
```
3
0 10 20
10 0 -100
20 -100 0
```

### Sample Output 1
```
20
```

The rabbits should be divided as $\{1, 3\}, \{2\}$.

### Sample Input 2
```
2
0 -10
-10 0
```

### Sample Output 2
```
0
```

The rabbits should be divided as $\{1\}, \{2\}$.

### Sample Input 3
```
4
0 1000000000 1000000000 1000000000
1000000000 0 1000000000 1000000000
1000000000 1000000000 0 -1
1000000000 1000000000 -1 0
```

### Sample Output 3
```
4999999999
```

The rabbits should be divided as $\{1, 2, 3, 4\}$.
Note that the answer may not fit into a 32-bit integer type.

### Sample Input 4
```
16
0 5 -4 -5 -8 -4 7 2 -4 0 7 0 2 -3 7 7
5 0 8 -9 3 5 2 -7 2 -7 0 -1 -4 1 -1 9
-4 8 0 -9 8 9 3 1 4 9 6 6 -6 1 8 9
-5 -9 -9 0 -7 6 4 -1 9 -3 -5 0 1 2 -4 1
-8 3 8 -7 0 -5 -9 9 1 -9 -6 -3 -8 3 4 3
-4 5 9 6 -5 0 -6 1 -2 2 0 -5 -2 3 1 2
7 2 3 4 -9 -6 0 -2 -2 -9 -3 9 -2 9 2 -5
2 -7 1 -1 9 1 -2 0 -6 0 -6 6 4 -1 -7 8
-4 2 4 9 1 -2 -2 -6 0 8 -6 -2 -4 8 7 7
0 -7 9 -3 -9 2 -9 0 8 0 0 1 -3 3 -6 -6
7 0 6 -5 -6 0 -3 -6 -6 0 0 5 7 -1 -5 3
0 -1 6 0 -3 -5 9 6 -2 1 5 0 -2 7 -8 0
2 -4 -6 1 -8 -2 -2 4 -4 -3 7 -2 0 -9 7 1
-3 1 1 2 3 3 9 -1 8 3 -1 7 -9 0 -6 -8
7 -1 8 -4 4 1 2 -7 7 -6 -5 -8 7 -6 0 -9
7 9 9 1 3 2 -5 8 7 -6 3 0 1 -8 -9 0
```

### Sample Output 4
```
132
```

## Editorial

`cost[S]` is the total score of putting every rabbit in the set $S$ into one group. It is computed for all subsets by summing $a_{i,j}$ over pairs inside $S$, in $O(2^N N^2)$.

`dp[S]` is the best score for the rabbits in $S$. Fix one element of $S$ (for instance the lowest set bit) and let $k$ range over the submasks of $S$ that contain it; $k$ is the group containing that element and the rest is solved recursively:

$$dp[S] = \max_{k \subseteq S,\ \text{lowbit}(S) \in k}\bigl(cost[k] + dp[S \setminus k]\bigr).$$

Enumerating all submasks of every mask costs $O(3^N)$, and the answer is $dp[2^N-1]$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

const int MAXN = 16;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	static int a[MAXN][MAXN];
	static long long cost[1 << MAXN];
	static long long dp[1 << MAXN];
	cin >> n;
	for (int i = 0; i < n; ++i)
		for (int j = 0; j < n; ++j)
			cin >> a[i][j];
	for (int i = 0; i < (1 << n); ++i)
		for (int j = 0; j < n; ++j)
			for (int k = j + 1; k < n; ++k)
				if (i & (1 << j) && i & (1 << k))
					cost[i] += a[j][k];
	for (int i = 0, j; i < (1 << n); ++i) {
		j = ((1 << n) - 1) ^ i;
		for (int k = j; k; k = (k - 1) & j)
			dp[i ^ k] = max(dp[i ^ k], dp[i] + cost[k]);
	}
	cout << dp[(1 << n) - 1] << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 羽のうさぎたちがいます。
うさぎたちには $1, 2, \ldots, N$ と番号が振られています。

各 $i, j$ ($1 \leq i, j \leq N$) について、うさぎ $i$ と $j$ の相性が整数 $a_{i, j}$ によって与えられます。
ただし、各 $i$ ($1 \leq i \leq N$) について $a_{i, i} = 0$ であり、各 $i, j$ ($1 \leq i, j \leq N$) について $a_{i, j} = a_{j, i}$ です。

太郎君は、$N$ 羽のうさぎたちをいくつかのグループへ分けようとしています。
このとき、各うさぎはちょうど $1$ つのグループに属さなければなりません。
グループ分けの結果、各 $i, j$ ($1 \leq i < j \leq N$) について、うさぎ $i$ と $j$ が同じグループに属するならば、太郎君は $a_{i, j}$ 点を得ます。

太郎君の総得点の最大値を求めてください。
