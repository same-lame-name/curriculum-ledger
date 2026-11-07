# Frog 1

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_a
**Tags:** 1D DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ stones, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), the height of Stone $i$ is $h_i$.

There is a frog who is initially on Stone $1$.
He will repeat the following action some number of times to reach Stone $N$:

- If the frog is currently on Stone $i$, jump to Stone $i + 1$ or Stone $i + 2$. Here, a cost of $|h_i - h_j|$ is incurred, where $j$ is the stone to land on.

Find the minimum possible total cost incurred before the frog reaches Stone $N$.

### Constraints

- All values in input are integers.
- $2 \leq N \leq 10^5$
- $1 \leq h_i \leq 10^4$

### Input
Input is given from Standard Input in the following format:

```
N
h_1 h_2 ... h_N
```

### Output
Print the minimum possible total cost incurred.

### Sample Input 1
```
4
10 30 40 20
```

### Sample Output 1
```
30
```

If we follow the path $1$ → $2$ → $4$, the total cost incurred would be $|10 - 30| + |30 - 20| = 30$.

### Sample Input 2
```
2
10 10
```

### Sample Output 2
```
0
```

If we follow the path $1$ → $2$, the total cost incurred would be $|10 - 10| = 0$.

### Sample Input 3
```
6
30 10 60 10 60 50
```

### Sample Output 3
```
40
```

If we follow the path $1$ → $3$ → $5$ → $6$, the total cost incurred would be $|30 - 60| + |60 - 60| + |60 - 50| = 40$.

## Editorial

Time Complexity: $\mathcal{O}(N)$

Use dynamic programming and define $\texttt{dp}[i]$ as the minimum cost to reach
stone $i$. Then, there are only two transitions:

- Jump one stone:

$$\texttt{dp}[i + 1] = \min(\texttt{dp}[i + 1], \texttt{dp}[i] + |\texttt{A}[i] - \texttt{A}[i + 1]|)$$

- Jump two stones:

$$\texttt{dp}[i + 2] = \min_{0 \le i + j < N}(\texttt{dp}[i + 2], \texttt{dp}[i] + |\texttt{A}[i] - \texttt{A}[i + 2]|)$$

```
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

int A[mx], dp[mx];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N; cin >> N;

	for(int i = 0; i < N; ++i) {
		cin >> A[i];
		dp[i] = 1e9 + 7;
	}

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		if(i + 1 < N) dp[i + 1] = min(dp[i + 1], dp[i] + abs(A[i] - A[i + 1]));
		if(i + 2 < N) dp[i + 2] = min(dp[i + 2], dp[i] + abs(A[i] - A[i + 2]));
	}

	cout << dp[N - 1] << endl;
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

int A[mx], dp[mx];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N; cin >> N;

	for(int i = 0; i < N; ++i) {
		cin >> A[i];
		dp[i] = 1e9 + 7;
	}

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		if(i + 1 < N) dp[i + 1] = min(dp[i + 1], dp[i] + abs(A[i] - A[i + 1]));
		if(i + 2 < N) dp[i + 2] = min(dp[i + 2], dp[i] + abs(A[i] - A[i + 2]));
	}

	cout << dp[N - 1] << endl;
}
```

## Original statement (日本語)

### 問題文
$N$ 個の足場があります。
足場には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N$) について、足場 $i$ の高さは $h_i$ です。

最初、足場 $1$ にカエルがいます。
カエルは次の行動を何回か繰り返し、足場 $N$ まで辿り着こうとしています。

- 足場 $i$ にいるとき、足場 $i + 1$ または $i + 2$ へジャンプする。 このとき、ジャンプ先の足場を $j$ とすると、コスト $|h_i - h_j|$ を支払う。

カエルが足場 $N$ に辿り着くまでに支払うコストの総和の最小値を求めてください。
