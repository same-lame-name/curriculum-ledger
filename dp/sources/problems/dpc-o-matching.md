# Matching

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_o
**Tags:** bitmask DP, matching
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ men and $N$ women, both numbered $1, 2, \ldots, N$.

For each $i, j$ ($1 \leq i, j \leq N$), the compatibility of Man $i$ and Woman $j$ is given as an integer $a_{i, j}$.
If $a_{i, j} = 1$, Man $i$ and Woman $j$ are compatible; if $a_{i, j} = 0$, they are not.

Taro is trying to make $N$ pairs, each consisting of a man and a woman who are compatible.
Here, each man and each woman must belong to exactly one pair.

Find the number of ways in which Taro can make $N$ pairs, modulo $10^9 + 7$.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 21$
- $a_{i, j}$ is $0$ or $1$.

### Input
Input is given from Standard Input in the following format:

```
N
a_1, 1 ... a_1, N
:
a_N, 1 ... a_N, N
```

### Output
Print the number of ways in which Taro can make $N$ pairs, modulo $10^9 + 7$.

### Sample Input 1
```
3
0 1 1
1 0 1
1 1 1
```

### Sample Output 1
```
3
```

There are three ways to make pairs, as follows ($(i, j)$ denotes a pair of Man $i$ and Woman $j$):

- $(1, 2), (2, 1), (3, 3)$
- $(1, 2), (2, 3), (3, 1)$
- $(1, 3), (2, 1), (3, 2)$

### Sample Input 2
```
4
0 1 0 0
0 0 0 1
1 0 0 0
0 0 1 0
```

### Sample Output 2
```
1
```

There is one way to make pairs, as follows:

- $(1, 2), (2, 4), (3, 1), (4, 3)$

### Sample Input 3
```
1
0
```

### Sample Output 3
```
0
```

### Sample Input 4
```
21
0 0 0 0 0 0 0 1 1 0 1 1 1 1 0 0 0 1 0 0 1
1 1 1 0 0 1 0 0 0 1 0 0 0 0 1 1 1 0 1 1 0
0 0 1 1 1 1 0 1 1 0 0 1 0 0 1 1 0 0 0 1 1
0 1 1 0 1 1 0 1 0 1 0 0 1 0 0 0 0 0 1 1 0
1 1 0 0 1 0 1 0 0 1 1 1 1 0 0 0 0 0 0 0 0
0 1 1 0 1 1 1 0 1 1 1 0 0 0 1 1 1 1 0 0 1
0 1 0 0 0 1 0 1 0 0 0 1 1 1 0 0 1 1 0 1 0
0 0 0 0 1 1 0 0 1 1 0 0 0 0 0 1 1 1 1 1 1
0 0 1 0 0 1 0 0 1 0 1 1 0 0 1 0 1 0 1 1 1
0 0 0 0 1 1 0 0 1 1 1 0 0 0 0 1 1 0 0 0 1
0 1 1 0 1 1 0 0 1 1 0 0 0 1 1 1 1 0 1 1 0
0 0 1 0 0 1 1 1 1 0 1 1 0 1 1 1 0 0 0 0 1
0 1 1 0 0 1 1 1 1 0 0 0 1 0 1 1 0 1 0 1 1
1 1 1 1 1 0 0 0 0 1 0 0 1 1 0 1 1 1 0 0 1
0 0 0 1 1 0 1 1 1 1 0 0 0 0 0 0 1 1 1 1 1
1 0 1 1 0 1 0 1 0 0 1 0 0 1 1 0 1 0 1 1 0
0 0 1 1 0 0 1 1 0 0 1 1 0 0 1 1 1 1 0 0 1
0 0 0 1 0 0 1 1 0 1 0 1 0 1 1 0 0 1 1 0 1
0 0 0 0 1 1 1 0 1 0 1 1 1 0 1 1 0 0 1 1 0
1 1 0 1 1 0 0 1 1 0 1 1 0 1 1 1 1 1 0 1 0
1 0 0 1 1 0 1 1 1 1 1 0 1 0 1 1 0 0 0 0 0
```

### Sample Output 4
```
102515160
```

Be sure to print the number modulo $10^9 + 7$.

## Editorial

Time Complexity: $\mathcal{O}(N\cdot 2^N)$

If we define $\texttt{dp}[S]$ to be the number of matchings for females in the
set $S$ to the first $|S|$ males, this problem boils down to the following:

$$\texttt{dp}[S] = \sum \texttt{dp}[S\backslash x]:  \texttt{compatible}[|S|][x]$$
(The `:` stands for "such that".) In English, this is equivalent to the
following:

The number of matchings in a subset $S$ to include a certain female $x$ is
equivalent to the sum of all the matchings without female $x$ where female $x$
is compatible with the $|S|$-th male.

Our base case is the empty set, which has a value of $1$ (the empty set can be
considered as a single matching involving zero pairs).

```
#include <bits/stdc++.h>

using namespace std;

const int MOD = 1e9 + 7;
const int MAX_N = 21;

bool compat[MAX_N][MAX_N];
int dp[1 << MAX_N];

int main() {
	int N;
	cin >> N;
	for (int i = 0; i < N; ++i) {
		for (int j = 0; j < N; ++j) {
			cin >> compat[i][j];
		}
	}

	dp[0] = 1;

	for (int s = 0; s < (1 << N); s++) {
		int pair_num = __builtin_popcount(s);
		for (int w = 0; w < N; w++) {
			/*
			 * check that
			 * 1. this woman hasn't been paired already
			 * 2. she's also compatible with the {pair_num + 1}th man
			 */
			if ((s & (1 << w)) || !compat[pair_num][w])
				continue;

			// add the amount to future dp states
			dp[s | (1 << w)] += dp[s];
			dp[s | (1 << w)] %= MOD;
		}
	}

   	cout << dp[(1 << N) - 1] << endl;
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MOD = 1e9 + 7;
const int MAX_N = 21;

bool compat[MAX_N][MAX_N];
int dp[1 << MAX_N];

int main() {
	int N;
	cin >> N;
	for (int i = 0; i < N; ++i) {
		for (int j = 0; j < N; ++j) {
			cin >> compat[i][j];
		}
	}

	dp[0] = 1;

	for (int s = 0; s < (1 << N); s++) {
		int pair_num = __builtin_popcount(s);
		for (int w = 0; w < N; w++) {
			/*
			 * check that
			 * 1. this woman hasn't been paired already
			 * 2. she's also compatible with the {pair_num + 1}th man
			 */
			if ((s & (1 << w)) || !compat[pair_num][w])
				continue;

			// add the amount to future dp states
			dp[s | (1 << w)] += dp[s];
			dp[s | (1 << w)] %= MOD;
		}
	}

   	cout << dp[(1 << N) - 1] << endl;
}
```

## Original statement (日本語)

### 問題文
$N$ 人の男性たちと $N$ 人の女性たちがいます。
男性たちには $1, 2, \ldots, N$ と番号が振られています。
同様に、女性たちには $1, 2, \ldots, N$ と番号が振られています。

各 $i, j$ ($1 \leq i, j \leq N$) について、男性 $i$ と女性 $j$ の相性の良し悪しが整数 $a_{i, j}$ によって与えられます。
$a_{i, j} = 1$ ならば男性 $i$ と女性 $j$ は相性が良く、$a_{i, j} = 0$ ならば相性が悪いです。

太郎君は、相性が良い男女どうしのペアを $N$ 組作ろうとしています。
このとき、各男性および各女性はちょうど $1$ つのペアに属さなければなりません。

$N$ 組のペアを作る方法は何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。
