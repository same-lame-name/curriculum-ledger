# Grid 1

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_h
**Tags:** grid path counting
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a grid with $H$ horizontal rows and $W$ vertical columns.
Let $(i, j)$ denote the square at the $i$-th row from the top and the $j$-th column from the left.

For each $i$ and $j$ ($1 \leq i \leq H$, $1 \leq j \leq W$), Square $(i, j)$ is described by a character $a_{i, j}$.
If $a_{i, j}$ is `.`, Square $(i, j)$ is an empty square; if $a_{i, j}$ is `#`, Square $(i, j)$ is a wall square.
It is guaranteed that Squares $(1, 1)$ and $(H, W)$ are empty squares.

Taro will start from Square $(1, 1)$ and reach $(H, W)$ by repeatedly moving right or down to an adjacent empty square.

Find the number of Taro's paths from Square $(1, 1)$ to $(H, W)$.
As the answer can be extremely large, find the count modulo $10^9 + 7$.

### Constraints

- $H$ and $W$ are integers.
- $2 \leq H, W \leq 1000$
- $a_{i, j}$ is `.` or `#`.
- Squares $(1, 1)$ and $(H, W)$ are empty squares.

### Input
Input is given from Standard Input in the following format:

```
H W
a_1, 1...a_1, W
:
a_H, 1...a_H, W
```

### Output
Print the number of Taro's paths from Square $(1, 1)$ to $(H, W)$, modulo $10^9 + 7$.

### Sample Input 1
```
3 4
...#
.#..
....
```

### Sample Output 1
```
3
```

There are three paths as follows:

![](assets/dpc-grid-1/418e424cf3.png)

### Sample Input 2
```
5 2
..
#.
..
.#
..
```

### Sample Output 2
```
0
```

There may be no paths.

### Sample Input 3
```
5 5
..#..
.....
#...#
.....
..#..
```

### Sample Output 3
```
24
```

### Sample Input 4
```
20 20
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
```

### Sample Output 4
```
345263555
```

Be sure to print the count modulo $10^9 + 7$.

## Editorial

`dp[i][j]` is the number of paths from the top-left cell to $(i,j)$ moving only right or down, avoiding blocked cells. `dp[0][0] = 1` if the start is open, and a blocked cell has value $0$. Otherwise

$$dp[i][j] = dp[i-1][j] + dp[i][j-1] \pmod{10^9+7},$$

with out-of-grid terms treated as zero. The answer is $dp[H-1][W-1]$, in $O(HW)$ time.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

bool ok[1000][1000];
long long dp[1000][1000];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int h, w;
	cin >> h >> w;
	for (int i = 0; i < h; ++i) {
		string s;
		cin >> s;
		for (int j = 0; j < w; ++j)
			ok[i][j] = (s[j] == '.');
	}

	dp[0][0] = ok[0][0] ? 1 : 0;
	for (int i = 0; i < h; ++i) {
		for (int j = 0; j < w; ++j) {
			if (!ok[i][j]) { dp[i][j] = 0; continue; }
			if (i > 0) dp[i][j] = (dp[i][j] + dp[i - 1][j]) % 1000000007;
			if (j > 0) dp[i][j] = (dp[i][j] + dp[i][j - 1]) % 1000000007;
		}
	}

	cout << dp[h - 1][w - 1] << "\n";
	return 0;
}
```

## Original statement (日本語)

### 問題文
縦 $H$ 行、横 $W$ 列のグリッドがあります。
上から $i$ 行目、左から $j$ 列目のマスを $(i, j)$ で表します。

各 $i, j$ ($1 \leq i \leq H$, $1 \leq j \leq W$) について、マス $(i, j)$ の情報が文字 $a_{i, j}$ によって与えられます。
$a_{i, j}$ が `.` ならばマス $(i, j)$ は空マスであり、$a_{i, j}$ が `#` ならばマス $(i, j)$ は壁のマスです。
マス $(1, 1)$ および $(H, W)$ は空マスであることが保証されています。

太郎君は、マス $(1, 1)$ から出発し、右または下に隣り合う空マスへの移動を繰り返すことで、マス $(H, W)$ まで辿り着こうとしています。

マス $(1, 1)$ から $(H, W)$ までの太郎君の経路は何通りでしょうか？
答えは非常に大きくなりうるので、$10^9 + 7$ で割った余りを求めてください。
