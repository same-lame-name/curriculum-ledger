# Longest Path

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_g
**Tags:** DAG longest path
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a directed graph $G$ with $N$ vertices and $M$ edges.
The vertices are numbered $1, 2, \ldots, N$, and for each $i$ ($1 \leq i \leq M$), the $i$-th directed edge goes from Vertex $x_i$ to $y_i$.
$G$ does not contain directed cycles.

Find the length of the longest directed path in $G$.
Here, the length of a directed path is the number of edges in it.

### Constraints

- All values in input are integers.
- $2 \leq N \leq 10^5$
- $1 \leq M \leq 10^5$
- $1 \leq x_i, y_i \leq N$
- All pairs $(x_i, y_i)$ are distinct.
- $G$ does not contain directed cycles.

### Input
Input is given from Standard Input in the following format:

```
N M
x_1 y_1
x_2 y_2
:
x_M y_M
```

### Output
Print the length of the longest directed path in $G$.

### Sample Input 1
```
4 5
1 2
1 3
3 2
2 4
3 4
```

### Sample Output 1
```
3
```

The red directed path in the following figure is the longest:

![](assets/dpc-longest-path/ab3d098bd3.png)

### Sample Input 2
```
6 3
2 3
4 5
5 6
```

### Sample Output 2
```
2
```

The red directed path in the following figure is the longest:

![](assets/dpc-longest-path/9e05fad240.png)

### Sample Input 3
```
5 8
5 3
2 3
2 4
5 2
5 1
1 4
4 3
1 3
```

### Sample Output 3
```
3
```

The red directed path in the following figure is one of the longest:

![](assets/dpc-longest-path/8c00be9a70.png)

## Editorial

Time Complexity: $\mathcal{O}(N + M)$

Simply perform a DFS on the graph, defining $\texttt{dp}[i]$ as the longest path
that node $i$ can take. Notice how the optimal substructure is formed: the best
path for any node $x$ is one added to the best path for any of its children.

```
#include <bits/stdc++.h>

using namespace std;

vector<int> dp(100001);
vector<vector<int>> adj(100001);

int dfs(int x) {
	if (dp[x]) return dp[x];
	for (auto e : adj[x]){
			dp[e] = dfs(e);
			dp[x] = max(dp[e] + 1, dp[x]);
	}
	return dp[x];
}

int main(){
	int n,m;
	cin >> n >> m;

	for(int i = 0; i < m; ++i) {
		int a, b;
		cin >> a >> b;
		a--; b--;
		adj[a].push_back(b);
	}

	for (int i = 0; i < n; ++i) {
		dfs(i);
	}

	int ans = 0;

	for (int i = 0;i < n; ++i) {
		ans = max(dp[i], ans);
	}

	cout << ans;
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

vector<int> dp(100001);
vector<vector<int>> adj(100001);

int dfs(int x) {
	if (dp[x]) return dp[x];
	for (auto e : adj[x]){
			dp[e] = dfs(e);
			dp[x] = max(dp[e] + 1, dp[x]);
	}
	return dp[x];
}

int main(){
	int n,m;
	cin >> n >> m;

	for(int i = 0; i < m; ++i) {
		int a, b;
		cin >> a >> b;
		a--; b--;
		adj[a].push_back(b);
	}

	for (int i = 0; i < n; ++i) {
		dfs(i);
	}

	int ans = 0;

	for (int i = 0;i < n; ++i) {
		ans = max(dp[i], ans);
	}

	cout << ans;
}
```

## Original statement (日本語)

### 問題文
$N$ 頂点 $M$ 辺の有向グラフ $G$ があります。
頂点には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq M$) について、$i$ 番目の有向辺は頂点 $x_i$ から $y_i$ へ張られています。
$G$ は有向閉路を含みません。

$G$ の有向パスのうち、最長のものの長さを求めてください。
ただし、有向パスの長さとは、有向パスに含まれる辺の本数のことです。
