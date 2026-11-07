# Candies

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_m
**Tags:** prefix-sum optimisation
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ children, numbered $1, 2, \ldots, N$.

They have decided to share $K$ candies among themselves.
Here, for each $i$ ($1 \leq i \leq N$), Child $i$ must receive between $0$ and $a_i$ candies (inclusive).
Also, no candies should be left over.

Find the number of ways for them to share candies, modulo $10^9 + 7$.
Here, two ways are said to be different when there exists a child who receives a different number of candies.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 100$
- $0 \leq K \leq 10^5$
- $0 \leq a_i \leq K$

### Input
Input is given from Standard Input in the following format:

```
N K
a_1 a_2 ... a_N
```

### Output
Print the number of ways for the children to share candies, modulo $10^9 + 7$.

### Sample Input 1
```
3 4
1 2 3
```

### Sample Output 1
```
5
```

There are five ways for the children to share candies, as follows:

- $(0, 1, 3)$
- $(0, 2, 2)$
- $(1, 0, 3)$
- $(1, 1, 2)$
- $(1, 2, 1)$

Here, in each sequence, the $i$-th element represents the number of candies that Child $i$ receives.

### Sample Input 2
```
1 10
9
```

### Sample Output 2
```
0
```

There may be no ways for the children to share candies.

### Sample Input 3
```
2 0
0 0
```

### Sample Output 3
```
1
```

There is one way for the children to share candies, as follows:

- $(0, 0)$

### Sample Input 4
```
4 100000
100000 100000 100000 100000
```

### Sample Output 4
```
665683269
```

Be sure to print the answer modulo $10^9 + 7$.

## Editorial

`dp[i][j]` is the number of ways to give $j$ candies to the first $i$ children. The last child receives between $0$ and $a_i$:

$$dp[i][j] = \sum_{j' = j-a_i}^{j} dp[i-1][j'],$$

with $dp[0][0]=1$. The sum is a sliding window over the previous row, so keep its prefix sums and compute each cell as `pre[j] - pre[j-a_i-1]`, giving $O(NK)$ time.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAXK = 100000;
const int MOD = 1000000007;

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}

int sub(int i, int j) {
	if ((i -= j) < 0)
		i += MOD;
	return i;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n, k, a;
	cin >> n >> k;

	static int dp[MAXK + 1], dq[MAXK + 1];
	dp[0] = 1;
	for (int i = 1; i <= n; ++i) {
		cin >> a;
		for (int j = 1; j <= k; ++j)
			dp[j] = add(dp[j - 1], dp[j]);
		for (int j = 0; j <= k; ++j)
			dq[j] = sub(dp[j], (j > a ? dp[j - a - 1] : 0));
		swap(dp, dq);
	}
	cout << dp[k] << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 人の子供たちがいます。
子供たちには $1, 2, \ldots, N$ と番号が振られています。

子供たちは $K$ 個の飴を分け合うことにしました。
このとき、各 $i$ ($1 \leq i \leq N$) について、子供 $i$ が受け取る飴の個数は $0$ 以上 $a_i$ 以下でなければなりません。
また、飴が余ってはいけません。

子供たちが飴を分け合う方法は何通りでしょうか？
$10^9 + 7$ で割った余りを求めてください。
ただし、$2$ 通りの方法が異なるとは、ある子供が存在し、その子供が受け取る飴の個数が異なることを言います。
