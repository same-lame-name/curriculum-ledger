# Deque

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_l
**Tags:** interval DP, game
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Taro and Jiro will play the following game against each other.

Initially, they are given a sequence $a = (a_1, a_2, \ldots, a_N)$.
Until $a$ becomes empty, the two players perform the following operation alternately, starting from Taro:

- Remove the element at the beginning or the end of $a$. The player earns $x$ points, where $x$ is the removed element.

Let $X$ and $Y$ be Taro's and Jiro's total score at the end of the game, respectively.
Taro tries to maximize $X - Y$, while Jiro tries to minimize $X - Y$.

Assuming that the two players play optimally, find the resulting value of $X - Y$.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 3000$
- $1 \leq a_i \leq 10^9$

### Input
Input is given from Standard Input in the following format:

```
N
a_1 a_2 ... a_N
```

### Output
Print the resulting value of $X - Y$, assuming that the two players play optimally.

### Sample Input 1
```
4
10 80 90 30
```

### Sample Output 1
```
10
```

The game proceeds as follows when the two players play optimally (the element being removed is written bold):

- Taro: (10, 80, 90, 30) → (10, 80, 90)
- Jiro: (10, 80, 90) → (10, 80)
- Taro: (10, 80) → (10)
- Jiro: (10) → ()

Here, $X = 30 + 80 = 110$ and $Y = 90 + 10 = 100$.

### Sample Input 2
```
3
10 100 10
```

### Sample Output 2
```
-80
```

The game proceeds, for example, as follows when the two players play optimally:

- Taro: (10, 100, 10) → (100, 10)
- Jiro: (100, 10) → (10)
- Taro: (10) → ()

Here, $X = 10 + 10 = 20$ and $Y = 100$.

### Sample Input 3
```
1
10
```

### Sample Output 3
```
10
```

### Sample Input 4
```
10
1000000000 1 1000000000 1 1000000000 1 1000000000 1 1000000000 1
```

### Sample Output 4
```
4999999995
```

The answer may not fit into a 32-bit integer type.

### Sample Input 5
```
6
4 2 9 7 1 5
```

### Sample Output 5
```
2
```

The game proceeds, for example, as follows when the two players play optimally:

- Taro: (4, 2, 9, 7, 1, 5) → (4, 2, 9, 7, 1)
- Jiro: (4, 2, 9, 7, 1) → (2, 9, 7, 1)
- Taro: (2, 9, 7, 1) → (2, 9, 7)
- Jiro: (2, 9, 7) → (2, 9)
- Taro: (2, 9) → (2)
- Jiro: (2) → ()

Here, $X = 5 + 1 + 9 = 15$ and $Y = 4 + 7 + 2 = 13$.

## Editorial

`dp[i][j]` is the best value of (current player's total minus the other player's total) on the interval $[i,j]$. A single element is a range of size $1$:

$$dp[i][i] = a_i, \qquad dp[i][j] = \max\bigl(a_i - dp[i+1][j],\; a_j - dp[i][j-1]\bigr).$$

Filling by increasing interval length gives the answer $dp[0][N-1]$ in $O(N^2)$ time.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

long long dp[3001][3001];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n;
	cin >> n;

	vector<int> a(n);
	for (int& x : a) cin >> x;

	for (int i = 0; i < n; ++i) dp[i][i] = a[i];

	for (int i = n - 1; i >= 0; i--)
		for (int j = i + 1; j < n; ++j)
			dp[i][j] = max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1]);
	cout << dp[0][n - 1] << '\n';
}
```

## Original statement (日本語)

### 問題文
太郎君と次郎君が次のゲームで勝負します。

最初に、数列 $a = (a_1, a_2, \ldots, a_N)$ が与えられます。
$a$ が空になるまで、二人は次の操作を交互に行います。
先手は太郎君です。

- $a$ の先頭要素または末尾要素を取り除く。 取り除いた要素を $x$ とすると、操作を行った人は $x$ 点を得る。

ゲーム終了時の太郎君の総得点を $X$、次郎君の総得点を $Y$ とします。
太郎君は $X - Y$ を最大化しようとし、次郎君は $X - Y$ を最小化しようとします。

二人が最適に行動すると仮定したとき、$X - Y$ を求めてください。
