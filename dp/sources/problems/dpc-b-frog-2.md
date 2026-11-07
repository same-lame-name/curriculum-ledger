# Frog 2

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_b
**Tags:** 1D DP, bounded jump
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ stones, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), the height of Stone $i$ is $h_i$.

There is a frog who is initially on Stone $1$.
He will repeat the following action some number of times to reach Stone $N$:

- If the frog is currently on Stone $i$, jump to one of the following: Stone $i + 1, i + 2, \ldots, i + K$. Here, a cost of $|h_i - h_j|$ is incurred, where $j$ is the stone to land on.

Find the minimum possible total cost incurred before the frog reaches Stone $N$.

### Constraints

- All values in input are integers.
- $2 \leq N \leq 10^5$
- $1 \leq K \leq 100$
- $1 \leq h_i \leq 10^4$

### Input
Input is given from Standard Input in the following format:

```
N K
h_1 h_2 ... h_N
```

### Output
Print the minimum possible total cost incurred.

### Sample Input 1
```
5 3
10 30 40 50 20
```

### Sample Output 1
```
30
```

If we follow the path $1$ → $2$ → $5$, the total cost incurred would be $|10 - 30| + |30 - 20| = 30$.

### Sample Input 2
```
3 1
10 20 10
```

### Sample Output 2
```
20
```

If we follow the path $1$ → $2$ → $3$, the total cost incurred would be $|10 - 20| + |20 - 10| = 20$.

### Sample Input 3
```
2 100
10 10
```

### Sample Output 3
```
0
```

If we follow the path $1$ → $2$, the total cost incurred would be $|10 - 10| = 0$.

### Sample Input 4
```
10 4
40 10 20 70 80 10 20 70 80 60
```

### Sample Output 4
```
40
```

If we follow the path $1$ → $4$ → $8$ → $10$, the total cost incurred would be $|40 - 70| + |70 - 70| + |70 - 60| = 40$.

## Editorial

Time Complexity: $\mathcal{O}(NK)$

This is the exact same problem as Frog 1, just with variable distances. Simply
loop through each of the possible jumps, and use the previous transition where
$\texttt{dp}[i]$ represents the best value for stone $i$.

$$\texttt{dp}[i + j] = \min_{0 \le i + j < N}(\texttt{dp}[i + j], \texttt{dp}[i] + |\texttt{A}[i] - \texttt{A}[i + j]|)$$
```
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

int A[mx], dp[mx];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N, K; cin >> N >> K;

	for(int i = 0; i < N; ++i) {
		cin >> A[i];
		dp[i] = 1e9 + 7;
	}

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		for(int j = 1; j <= K; ++j) { // j is jump
			if(i + j < N) dp[i + j] = min(dp[i + j], dp[i] + abs(A[i] - A[i + j]));
		}
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

	int N, K; cin >> N >> K;

	for(int i = 0; i < N; ++i) {
		cin >> A[i];
		dp[i] = 1e9 + 7;
	}

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		for(int j = 1; j <= K; ++j) { // j is jump
			if(i + j < N) dp[i + j] = min(dp[i + j], dp[i] + abs(A[i] - A[i + j]));
		}
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

- 足場 $i$ にいるとき、足場 $i + 1, i + 2, \ldots, i + K$ のどれかへジャンプする。 このとき、ジャンプ先の足場を $j$ とすると、コスト $|h_i - h_j|$ を支払う。

カエルが足場 $N$ に辿り着くまでに支払うコストの総和の最小値を求めてください。
