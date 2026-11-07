# Independent Set

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_p
**Tags:** tree DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a tree with $N$ vertices, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N - 1$), the $i$-th edge connects Vertex $x_i$ and $y_i$.

Taro has decided to paint each vertex in white or black.
Here, it is not allowed to paint two adjacent vertices both in black.

Find the number of ways in which the vertices can be painted, modulo $10^9 + 7$.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 10^5$
- $1 \leq x_i, y_i \leq N$
- The given graph is a tree.

### Input
Input is given from Standard Input in the following format:

```
N
x_1 y_1
x_2 y_2
:
x_N - 1 y_N - 1
```

### Output
Print the number of ways in which the vertices can be painted, modulo $10^9 + 7$.

### Sample Input 1
```
3
1 2
2 3
```

### Sample Output 1
```
5
```

There are five ways to paint the vertices, as follows:

![](assets/dpc-independent-set/3473f4a4bc.png)

### Sample Input 2
```
4
1 2
1 3
1 4
```

### Sample Output 2
```
9
```

There are nine ways to paint the vertices, as follows:

![](assets/dpc-independent-set/ce9fa23ce3.png)

### Sample Input 3
```
1
```

### Sample Output 3
```
2
```

### Sample Input 4
```
10
8 5
10 8
6 5
1 5
4 8
2 10
3 6
9 2
1 7
```

### Sample Output 4
```
157
```

## Editorial

Time Complexity: $\mathcal{O}(N)$

First, lets root the tree arbitrary. Let $\texttt{dp}[i][j]$ represent the
number of ways to color subtree $i$, coloring node $i$ color $j$.

Here, $j=0$ is black and $j=1$ is white. If we color node $i$ black, then it's
children must be all white. So, we have

$$\texttt{dp}[i][0]=\prod \texttt{dp}[c][1]$$
such that $c$ is $i$'s child, and if we color node $i$ white, then it's children
can be either white or black:

$$\texttt{dp}[i][1]=\prod({\texttt{dp}[c][0] + \texttt{dp}[c][1]})$$
```
#include <bits/stdc++.h>

using namespace std;

const int MAXN = 1e5;
const int MOD = 1e9 + 7;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}
int mul(int i, int j) {
	return int((long long) i * j % MOD);
}

vector<int> adj[MAXN];
int dp[MAXN][2];

void dfs(int i, int p) {
	dp[i][0] = dp[i][1] = 1;
	for (int j : adj[i]) if (j != p) {
		dfs(j, i);
		dp[i][0] = mul(dp[i][0], dp[j][1]);
		dp[i][1] = mul(dp[i][1], add(dp[j][0], dp[j][1]));
	}
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;
	for (int i = 0, a, b; i + 1 < n; ++i) {
		cin >> a >> b, --a, --b;
		adj[a].push_back(b), adj[b].push_back(a);
	}
	dfs(0, 0);
	cout << add(dp[0][0], dp[0][1]) << '\n';
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAXN = 1e5;
const int MOD = 1e9 + 7;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}
int mul(int i, int j) {
	return int((long long) i * j % MOD);
}

vector<int> adj[MAXN];
int dp[MAXN][2];

void dfs(int i, int p) {
	dp[i][0] = dp[i][1] = 1;
	for (int j : adj[i]) if (j != p) {
		dfs(j, i);
		dp[i][0] = mul(dp[i][0], dp[j][1]);
		dp[i][1] = mul(dp[i][1], add(dp[j][0], dp[j][1]));
	}
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;
	for (int i = 0, a, b; i + 1 < n; ++i) {
		cin >> a >> b, --a, --b;
		adj[a].push_back(b), adj[b].push_back(a);
	}
	dfs(0, 0);
	cout << add(dp[0][0], dp[0][1]) << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 頂点の木があります。
頂点には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N - 1$) について、$i$ 番目の辺は頂点 $x_i$ と $y_i$ を結んでいます。

太郎君は、各頂点を白または黒で塗ることにしました。
ただし、隣り合う頂点どうしをともに黒で塗ってはいけません。

頂点の色の組合せは何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。
