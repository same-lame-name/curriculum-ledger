# Sushi

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_j
**Tags:** expected value DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ dishes, numbered $1, 2, \ldots, N$.
Initially, for each $i$ ($1 \leq i \leq N$), Dish $i$ has $a_i$ ($1 \leq a_i \leq 3$) pieces of sushi on it.

Taro will perform the following operation repeatedly until all the pieces of sushi are eaten:

- Roll a die that shows the numbers $1, 2, \ldots, N$ with equal probabilities, and let $i$ be the outcome. If there are some pieces of sushi on Dish $i$, eat one of them; if there is none, do nothing.

Find the expected number of times the operation is performed before all the pieces of sushi are eaten.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 300$
- $1 \leq a_i \leq 3$

### Input
Input is given from Standard Input in the following format:

```
N
a_1 a_2 ... a_N
```

### Output
Print the expected number of times the operation is performed before all the pieces of sushi are eaten.
The output is considered correct when the relative difference is not greater than $10^{-9}$.

### Sample Input 1
```
3
1 1 1
```

### Sample Output 1
```
5.5
```

The expected number of operations before the first piece of sushi is eaten, is $1$.
After that, the expected number of operations before the second sushi is eaten, is $1.5$.
After that, the expected number of operations before the third sushi is eaten, is $3$.
Thus, the expected total number of operations is $1 + 1.5 + 3 = 5.5$.

### Sample Input 2
```
1
3
```

### Sample Output 2
```
3
```

Outputs such as `3.00`, `3.000000003` and `2.999999997` will also be accepted.

### Sample Input 3
```
2
1 2
```

### Sample Output 3
```
4.5
```

### Sample Input 4
```
10
1 3 2 3 3 2 3 2 1 3
```

### Sample Output 4
```
54.48064457488221
```

## Editorial

Let $E(x,y,z)$ be the expected number of remaining moves with $x$ plates holding one sushi, $y$ holding two and $z$ holding three; there are $n$ plates in total. One move costs $1$ and moves a random plate down one level (or empties it):

$$E = 1 + \frac{x}{n}E(x-1,y,z) + \frac{y}{n}E(x+1,y-1,z) + \frac{z}{n}E(x,y+1,z-1).$$

Multiplying by $n$ and using $x+y+z=n$:

$$E(x,y,z) = \frac{n + xE(x-1,y,z) + yE(x+1,y-1,z) + zE(x,y+1,z-1)}{x+y+z}.$$

The base case is $E(0,0,0)=0$. Memoise over the three counts; $O(n^3)$ states.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

int n;

long double dp[301][301][301];
// let dp[i][j][k] be
// i dishes of 1 sushi
// j dishes of 2 sushi
// k dishes of 3 sushi

double memo(int x, int y, int z) {
	if(x < 0 || y < 0 || z < 0) return 0;
	if(x == 0 && y == 0 && z == 0) return 0;
	// if(x + y + z < 1) return 0;
	if(dp[x][y][z] > 0) return dp[x][y][z];

	long double ret = n + x * memo(x - 1, y, z)  // # 1 sushi
					+ y * memo(x + 1, y - 1, z)  // # 2 sushi
					+ z * memo(x, y + 1, z - 1); // # 3 sushi

	return dp[x][y][z] = ret / (x + y + z);
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	cin >> n;
	vector<int> a(n); for(int i = 0; i < n; ++i) cin >> a[i];

	vector<int> freq(3);
	for(int x : a) freq[x - 1]++;

	memset(dp, -1, sizeof dp);

	cout << fixed << setprecision(10) << memo(freq[0], freq[1], freq[2]) << endl;
}
```

## Original statement (日本語)

### 問題文
$N$ 枚の皿があります。
皿には $1, 2, \ldots, N$ と番号が振られています。
最初、各 $i$ ($1 \leq i \leq N$) について、皿 $i$ には $a_i$ ($1 \leq a_i \leq 3)$ 個の寿司が置かれています。

すべての寿司が無くなるまで、太郎君は次の操作を繰り返し行います。

- $1, 2, \ldots, N$ の目が等確率で出るサイコロを振り、出目を $i$ とする。 皿 $i$ に寿司がある場合、皿 $i$ の寿司を $1$ 個食べる。 皿 $i$ に寿司が無い場合、何も行わない。

すべての寿司が無くなるまでの操作回数の期待値を求めてください。
