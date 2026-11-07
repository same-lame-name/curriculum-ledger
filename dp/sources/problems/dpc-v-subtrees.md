# Subtree

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_v
**Tags:** rerooting DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a tree with $N$ vertices, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N - 1$), the $i$-th edge connects Vertex $x_i$ and $y_i$.

Taro has decided to paint each vertex in white or black, so that any black vertex can be reached from any other black vertex by passing through only black vertices.

You are given a positive integer $M$.
For each $v$ ($1 \leq v \leq N$), answer the following question:

- Assuming that Vertex $v$ has to be black, find the number of ways in which the vertices can be painted, modulo $M$.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 10^5$
- $2 \leq M \leq 10^9$
- $1 \leq x_i, y_i \leq N$
- The given graph is a tree.

### Input
Input is given from Standard Input in the following format:

```
N M
x_1 y_1
x_2 y_2
:
x_N - 1 y_N - 1
```

### Output
Print $N$ lines.
The $v$-th ($1 \leq v \leq N$) line should contain the answer to the following question:

- Assuming that Vertex $v$ has to be black, find the number of ways in which the vertices can be painted, modulo $M$.

### Sample Input 1
```
3 100
1 2
2 3
```

### Sample Output 1
```
3
4
3
```

There are seven ways to paint the vertices, as shown in the figure below.
Among them, there are three ways such that Vertex $1$ is black, four ways such that Vertex $2$ is black and three ways such that Vertex $3$ is black.

![](assets/dpc-subtrees/cdf62bfaeb.png)

### Sample Input 2
```
4 100
1 2
1 3
1 4
```

### Sample Output 2
```
8
5
5
5
```

### Sample Input 3
```
1 100
```

### Sample Output 3
```
1
```

### Sample Input 4
```
10 2
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
0
0
1
1
1
0
1
0
1
1
```

Be sure to print the answers modulo $M$.

## Editorial

The black vertices must form one connected set. Root the tree and cut the edge above a vertex $v$. In a valid colouring the component containing $v$ is either entirely white, or rooted at a black $v$ with every black vertex in it connected to $v$.

$$f[v][0] = 1, \qquad f[v][1] = \prod_{c \text{ child of } v}\bigl(f[c][0]+f[c][1]\bigr).$$

For the answer at $v$, cut every edge at $v$; each neighbour $u$ contributes the component on its side:

$$\mathrm{ans}[v] = \prod_{u \in \mathrm{adj}(v)}\bigl(g[u][0]+g[u][1]\bigr).$$

Compute $f$ downward, then reroot upward to obtain every $g$. Since $M$ need not be prime, the reroot step uses prefix and suffix products instead of division. $O(N)$ time and memory, iterative.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int n; long long M;
	cin >> n >> M;

	vector<vector<int>> adj(n);
	for (int i = 0; i < n - 1; ++i) {
		int a, b;
		cin >> a >> b;
		--a; --b;
		adj[a].push_back(b);
		adj[b].push_back(a);
	}

	// iterative DFS: parent + preorder
	vector<int> par(n, -1), order;
	order.reserve(n);
	par[0] = -2;
	vector<int> st{0};
	while (!st.empty()) {
		int v = st.back(); st.pop_back();
		order.push_back(v);
		for (int u : adj[v]) if (par[u] == -1) {
			par[u] = v;
			st.push_back(u);
		}
	}

	// down pass: component of the subtree rooted at v
	vector<long long> down0(n, 1), down1(n, 1);
	for (int idx = n - 1; idx >= 0; --idx) {
		int v = order[idx];
		long long white = 1, black = 1;
		for (int u : adj[v]) if (par[u] == v) {
			white = white * down0[u] % M;
			black = black * ((down0[u] + down1[u]) % M) % M;
		}
		down0[v] = white;
		down1[v] = black;
	}

	// up pass: up[v] is the component above v, rooted at par[v]
	vector<long long> up0(n, 1), up1(n, 1), ans(n, 1);
	for (int idx = 0; idx < n; ++idx) {
		int v = order[idx];
		int d = (int)adj[v].size();
		vector<long long> pre(d + 1, 1), suf(d + 1, 1), contrib(d);
		for (int i = 0; i < d; ++i) {
			int u = adj[v][i];
			contrib[i] = (par[u] == v)
				? (down0[u] + down1[u]) % M
				: (up0[v] + up1[v]) % M;
			pre[i + 1] = pre[i] * contrib[i] % M;
		}
		for (int i = d - 1; i >= 0; --i)
			suf[i] = suf[i + 1] * contrib[i] % M;
		ans[v] = pre[d];
		for (int i = 0; i < d; ++i) {
			int u = adj[v][i];
			if (par[u] == v) {
				// cut (v,u): u's outside component is everything else at v
				up0[u] = 1;
				up1[u] = pre[i] * suf[i + 1] % M;
			}
		}
	}

	for (int i = 0; i < n; ++i) cout << ans[i] % M << '\n';
	return 0;
}
```

## Original statement (日本語)

### 問題文
$N$ 頂点の木があります。
頂点には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N - 1$) について、$i$ 番目の辺は頂点 $x_i$ と $y_i$ を結んでいます。

太郎君は、各頂点を白または黒で塗ることにしました。
このとき、どの黒い頂点からどの黒い頂点へも、黒い頂点のみを辿って到達できるようにします。

正整数 $M$ が与えられます。
各 $v$ ($1 \leq v \leq N$) について、次の質問に答えてください。

- 頂点 $v$ が黒であるような頂点の色の組合せは何通りか？ $M$ で割った余りを求めよ。
