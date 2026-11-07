# Knapsack 2

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_e
**Tags:** knapsack by value
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ items, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), Item $i$ has a weight of $w_i$ and a value of $v_i$.

Taro has decided to choose some of the $N$ items and carry them home in a knapsack.
The capacity of the knapsack is $W$, which means that the sum of the weights of items taken must be at most $W$.

Find the maximum possible sum of the values of items that Taro takes home.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 100$
- $1 \leq W \leq 10^9$
- $1 \leq w_i \leq W$
- $1 \leq v_i \leq 10^3$

### Input
Input is given from Standard Input in the following format:

```
N W
w_1 v_1
w_2 v_2
:
w_N v_N
```

### Output
Print the maximum possible sum of the values of items that Taro takes home.

### Sample Input 1
```
3 8
3 30
4 50
5 60
```

### Sample Output 1
```
90
```

Items $1$ and $3$ should be taken.
Then, the sum of the weights is $3 + 5 = 8$, and the sum of the values is $30 + 60 = 90$.

### Sample Input 2
```
1 1000000000
1000000000 10
```

### Sample Output 2
```
10
```

### Sample Input 3
```
6 15
6 5
5 6
6 4
6 6
3 5
7 2
```

### Sample Output 3
```
17
```

Items $2, 4$ and $5$ should be taken.
Then, the sum of the weights is $5 + 6 + 3 = 14$, and the sum of the values is $6 + 6 + 5 = 17$.

## Editorial

Time Complexity: $\mathcal{O}(N^2V)$

This is the exact same problem except instead of a high value of $v_i$, there is
a high value of $w_i$. Now, we must minimize the value of $w_i$ for any given
$v_i$, and then try to find out the maximum value of $v_i$ that can be reached.

Define $\texttt{dp}[i]$ as the lowest weight we can achieve for value $i$. The
transition then, is:

$$\texttt{dp}[j + \texttt{v}[i]] = \min (\texttt{dp}[j + \texttt{v}[i]],\texttt{dp}[j] + \texttt{w}[i])$$
```
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

template<class T> bool ckmin(T& a, const T& b) {
	return a > b ? a = b, 1 : 0;
}

long long dp[mx];
int w[101], v[101];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N, W; cin >> N >> W;
	for(int i = 0; i < N; ++i) cin >> w[i] >> v[i];
	for(int i = 0; i < mx; ++i) dp[i] = 1e18;

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		for(int j = mx - 1; j >= 0; j--) {
			if(dp[j] + w[i] <= W) ckmin(dp[j + v[i]], dp[j] + w[i]);
		}
	}

	for(int i = mx - 1; i >= 0; i--) {
		if(dp[i] != 1e18) {
			cout << i << endl;
			break;
		}
	}
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

template<class T> bool ckmin(T& a, const T& b) {
	return a > b ? a = b, 1 : 0;
}

long long dp[mx];
int w[101], v[101];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N, W; cin >> N >> W;
	for(int i = 0; i < N; ++i) cin >> w[i] >> v[i];
	for(int i = 0; i < mx; ++i) dp[i] = 1e18;

	dp[0] = 0;

	for(int i = 0; i < N; ++i) {
		for(int j = mx - 1; j >= 0; j--) {
			if(dp[j] + w[i] <= W) ckmin(dp[j + v[i]], dp[j] + w[i]);
		}
	}

	for(int i = mx - 1; i >= 0; i--) {
		if(dp[i] != 1e18) {
			cout << i << endl;
			break;
		}
	}
}
```

## Original statement (日本語)

### 問題文
$N$ 個の品物があります。
品物には $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N$) について、品物 $i$ の重さは $w_i$ で、価値は $v_i$ です。

太郎君は、$N$ 個の品物のうちいくつかを選び、ナップサックに入れて持ち帰ることにしました。
ナップサックの容量は $W$ であり、持ち帰る品物の重さの総和は $W$ 以下でなければなりません。

太郎君が持ち帰る品物の価値の総和の最大値を求めてください。
