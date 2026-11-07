# Walk

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_r
**Tags:** matrix exponentiation
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a simple directed graph $G$ with $N$ vertices, numbered $1, 2, \ldots, N$.

For each $i$ and $j$ ($1 \leq i, j \leq N$), you are given an integer $a_{i, j}$ that represents whether there is a directed edge from Vertex $i$ to $j$.
If $a_{i, j} = 1$, there is a directed edge from Vertex $i$ to $j$; if $a_{i, j} = 0$, there is not.

Find the number of different directed paths of length $K$ in $G$, modulo $10^9 + 7$.
We will also count a path that traverses the same edge multiple times.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 50$
- $1 \leq K \leq 10^{18}$
- $a_{i, j}$ is $0$ or $1$.
- $a_{i, i} = 0$

### Input
Input is given from Standard Input in the following format:

```
N K
a_1, 1 ... a_1, N
:
a_N, 1 ... a_N, N
```

### Output
Print the number of different directed paths of length $K$ in $G$, modulo $10^9 + 7$.

### Sample Input 1
```
4 2
0 1 0 0
0 0 1 1
0 0 0 1
1 0 0 0
```

### Sample Output 1
```
6
```

$G$ is drawn in the figure below:

![](assets/dpc-walk/5955ba740b.png)

There are six directed paths of length $2$:

- $1$ → $2$ → $3$
- $1$ → $2$ → $4$
- $2$ → $3$ → $4$
- $2$ → $4$ → $1$
- $3$ → $4$ → $1$
- $4$ → $1$ → $2$

### Sample Input 2
```
3 3
0 1 0
1 0 1
0 0 0
```

### Sample Output 2
```
3
```

$G$ is drawn in the figure below:

![](assets/dpc-walk/ba4abeeb4e.png)

There are three directed paths of length $3$:

- $1$ → $2$ → $1$ → $2$
- $2$ → $1$ → $2$ → $1$
- $2$ → $1$ → $2$ → $3$

### Sample Input 3
```
6 2
0 0 0 0 0 0
0 0 1 0 0 0
0 0 0 0 0 0
0 0 0 0 1 0
0 0 0 0 0 1
0 0 0 0 0 0
```

### Sample Output 3
```
1
```

$G$ is drawn in the figure below:

![](assets/dpc-walk/d9a0cf501f.png)

There is one directed path of length $2$:

- $4$ → $5$ → $6$

### Sample Input 4
```
1 1
0
```

### Sample Output 4
```
0
```

### Sample Input 5
```
10 1000000000000000000
0 0 1 1 0 0 0 1 1 0
0 0 0 0 0 1 1 1 0 0
0 1 0 0 0 1 0 1 0 1
1 1 1 0 1 1 0 1 1 0
0 1 1 1 0 1 0 1 1 1
0 0 0 1 0 0 1 0 1 0
0 0 0 1 1 0 0 1 0 1
1 0 0 0 1 0 1 0 0 0
0 0 0 0 0 1 0 0 0 0
1 0 1 1 1 0 1 1 1 0
```

### Sample Output 5
```
957538352
```

Be sure to print the count modulo $10^9 + 7$.

## Editorial

The entries of $A^k$ count **walks** of length $k$: $(A^k)_{ij}$ is the number of sequences of $k$ edges from $i$ to $j$, with repeated vertices allowed. This holds by induction, with $A^0$ the identity. Binary exponentiation computes $A^K$ with $O(\log K)$ multiplications, each $O(N^3)$; the answer is the sum of all entries of $A^K$.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MOD = 1e9 + 7;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}
int mul(int i, int j) {
	return int((long long) i * j % MOD);
}

template<class T> struct Matrix {
	T **mat; int a, b;

	Matrix() : a(0), b(0) {}
	Matrix(int a_, int b_) : a(a_), b(b_) {
		int i, j;

		mat = new T*[a];
		for (i = 0; i < a; ++i) {
			mat[i] = new T[b];
			for (j = 0; j < b; ++j)
				mat[i][j] = 0;
		}
	}
	Matrix(const vector<vector<T>>& vt) {
		int i, j;

		*this = Matrix((int) vt.size(), (int) vt[0].size());
		for (i = 0; i < a; ++i)
			for (j = 0; j < b; ++j)
				mat[i][j] = vt[i][j];
	}
	Matrix operator*(const Matrix& m) {
		int i, j, k;

		assert(b == m.a);
		Matrix r(a, m.b);
		for (i = 0; i < a; ++i)
			for (j = 0; j < m.b; ++j)
				for (k = 0; k < b; ++k)
					r.mat[i][j] = add(r.mat[i][j],
						mul(mat[i][k], m.mat[k][j]));
		return r;
	}
	Matrix& operator*=(const Matrix& m) {
		return *this = (*this) * m;
	}
	friend Matrix power(Matrix m, long long p) {
		int i;

		assert(m.a == m.b);
		Matrix r(m.a, m.b);
		for (i = 0; i < m.a; ++i)
			r.mat[i][i] = 1;
		for ( ; p > 0; p >>= 1, m *= m)
			if (p & 1)
				r *= m;
		return r;
	}
};

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n; long long k;
	cin >> n >> k;
	vector<vector<int>> adj(n, vector<int>(n));
	for (int i = 0; i < n; ++i)
		for (int j = 0; j < n; ++j)
			cin >> adj[i][j];
	Matrix<int> mat(adj);
	mat = power(mat, k);
	int ans = 0;
	for (int i = 0; i < n; ++i)
		for (int j = 0; j < n; ++j)
			ans = add(ans, mat.mat[i][j]);
	cout << ans << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 頂点の単純有向グラフ $G$ があります。
頂点には $1, 2, \ldots, N$ と番号が振られています。

各 $i, j$ ($1 \leq i, j \leq N$) について、頂点 $i$ から $j$ への有向辺の有無が整数 $a_{i, j}$ によって与えられます。
$a_{i, j} = 1$ ならば頂点 $i$ から $j$ への有向辺が存在し、$a_{i, j} = 0$ ならば存在しません。

$G$ の長さ $K$ の有向パスは何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。
ただし、同じ辺を複数回通るような有向パスも数えるものとします。
