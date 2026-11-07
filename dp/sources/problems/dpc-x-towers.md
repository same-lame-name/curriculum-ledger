# Tower

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_x
**Tags:** knapsack, exchange argument
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ blocks, numbered $1, 2, \ldots, N$.
For each $i$ ($1 \leq i \leq N$), Block $i$ has a weight of $w_i$, a solidness of $s_i$ and a value of $v_i$.

Taro has decided to build a tower by choosing some of the $N$ blocks and stacking them vertically in some order.
Here, the tower must satisfy the following condition:

- For each Block $i$ contained in the tower, the sum of the weights of the blocks stacked above it is not greater than $s_i$.

Find the maximum possible sum of the values of the blocks contained in the tower.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 10^3$
- $1 \leq w_i, s_i \leq 10^4$
- $1 \leq v_i \leq 10^9$

### Input
Input is given from Standard Input in the following format:

```
N
w_1 s_1 v_1
w_2 s_2 v_2
:
w_N s_N v_N
```

### Output
Print the maximum possible sum of the values of the blocks contained in the tower.

### Sample Input 1
```
3
2 2 20
2 1 30
3 1 40
```

### Sample Output 1
```
50
```

If Blocks $2, 1$ are stacked in this order from top to bottom, this tower will satisfy the condition, with the total value of $30 + 20 = 50$.

### Sample Input 2
```
4
1 2 10
3 1 10
2 4 10
1 6 10
```

### Sample Output 2
```
40
```

Blocks $1, 2, 3, 4$ should be stacked in this order from top to bottom.

### Sample Input 3
```
5
1 10000 1000000000
1 10000 1000000000
1 10000 1000000000
1 10000 1000000000
1 10000 1000000000
```

### Sample Output 3
```
5000000000
```

The answer may not fit into a 32-bit integer type.

### Sample Input 4
```
8
9 5 7
6 2 7
5 7 3
7 8 8
1 9 6
3 3 3
4 1 7
4 5 5
```

### Sample Output 4
```
22
```

We should, for example, stack Blocks $5, 6, 8, 4$ in this order from top to bottom.

## Editorial

Sort the blocks by $w_i + s_i$ ascending. This is the order in which an optimal tower can be arranged: for two adjacent blocks $a$ below $b$, swapping them never hurts when $w_a+s_a \le w_b+s_b$ (exchange argument).

`dp[j]` is the maximum value of a chosen set of total weight $j$. A stack of weight $j$ can sit on top of block $i$ only if $j \le s_i$, so for each block iterate $j$ from $s_i$ down to $0$ and relax

$$dp[j+w_i] = \max\bigl(dp[j+w_i],\; dp[j]+v_i\bigr).$$

The answer is $\max_j dp[j]$; with $w_i,s_i \le 10^4$ the work is $O(N \cdot \max(w_i+s_i))$.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAX_N = 1e3+1;

long long dp[20001];
int w[MAX_N], s[MAX_N], v[MAX_N], p[MAX_N];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N; cin >> N;
	for(int i = 0; i < N; ++i) cin >> w[i] >> s[i] >> v[i];

	iota(p, p + N, 0);

	sort(p, p + N, [&](const int &a, const int &b) {
		return w[a] + s[a] < w[b] + s[b];
	});

	for(int i = 0; i < N; ++i) {
		int x = p[i];
		for(int j = s[x]; j >= 0; --j) {
			dp[j + w[x]] = max(dp[j + w[x]], dp[j] + v[x]);
		}
	}

	cout << *max_element(dp, dp + 20001) << endl;
}
```

## Original statement (日本語)

### 問題文
$N$ 個のブロックがあります。
ブロックには $1, 2, \ldots, N$ と番号が振られています。
各 $i$ ($1 \leq i \leq N$) について、ブロック $i$ の重さは $w_i$ で、丈夫さは $s_i$ で、価値は $v_i$ です。

太郎君は、$N$ 個のブロックのうち何個かを選び、それらを任意の順序で一列に積み重ね、塔を作ることにしました。
このとき、塔は次の条件を満たさなければなりません。

- 塔に含まれる各ブロック $i$ について、ブロック $i$ より上に積まれたブロックの重さの総和は $s_i$ 以下である。

塔に含まれるブロックの価値の総和の最大値を求めてください。
