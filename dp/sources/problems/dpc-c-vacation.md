# Vacation

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_c
**Tags:** DP with last choice
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Taro's summer vacation starts tomorrow, and he has decided to make plans for it now.

The vacation consists of $N$ days.
For each $i$ ($1 \leq i \leq N$), Taro will choose one of the following activities and do it on the $i$-th day:

- A: Swim in the sea. Gain $a_i$ points of happiness.
- B: Catch bugs in the mountains. Gain $b_i$ points of happiness.
- C: Do homework at home. Gain $c_i$ points of happiness.

As Taro gets bored easily, he cannot do the same activities for two or more consecutive days.

Find the maximum possible total points of happiness that Taro gains.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 10^5$
- $1 \leq a_i, b_i, c_i \leq 10^4$

### Input
Input is given from Standard Input in the following format:

```
N
a_1 b_1 c_1
a_2 b_2 c_2
:
a_N b_N c_N
```

### Output
Print the maximum possible total points of happiness that Taro gains.

### Sample Input 1
```
3
10 40 70
20 50 80
30 60 90
```

### Sample Output 1
```
210
```

If Taro does activities in the order C, B, C, he will gain $70 + 50 + 90 = 210$ points of happiness.

### Sample Input 2
```
1
100 10 1
```

### Sample Output 2
```
100
```

### Sample Input 3
```
7
6 7 8
8 8 3
2 5 2
7 8 6
4 6 8
2 3 4
7 5 1
```

### Sample Output 3
```
46
```

Taro should do activities in the order C, A, B, A, C, B, A.

## Editorial

`dp[i][j]` is the maximum happiness for the first $i$ days when day $i$ ends with activity $j$ ($j = 0,1,2$). The base is `dp[0][j] = 0`.

$$dp[i][j] = \max_{k \ne j}\bigl(dp[i-1][k]\bigr) + A[i][j]$$

The answer is $\max_j dp[N][j]$. Each state looks at two predecessors, so the table is filled in $O(N)$ time and $O(1)$ extra memory.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int mx = 1e5+1;

bool ckmax(int& a, const int& b) {
	return a < b ? a = b, 1 : 0;
}

int dp[mx][3];

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int N; cin >> N;

	for(int i = 1; i <= N; ++i) {
		int a, b, c; cin >> a >> b >> c;
		ckmax(dp[i][0], max(dp[i - 1][1] + b, dp[i - 1][2] + c));
		ckmax(dp[i][1], max(dp[i - 1][0] + a, dp[i - 1][2] + c));
		ckmax(dp[i][2], max(dp[i - 1][0] + a, dp[i - 1][1] + b));
	}

	cout << max(dp[N][0], max(dp[N][1], dp[N][2])) << endl;
}
```

## Original statement (日本語)

### 問題文
明日から太郎君の夏休みが始まります。
太郎君は夏休みの計画を立てることにしました。

夏休みは $N$ 日からなります。
各 $i$ ($1 \leq i \leq N$) について、$i$ 日目には太郎君は次の活動のうちひとつを選んで行います。

- A: 海で泳ぐ。 幸福度 $a_i$ を得る。
- B: 山で虫取りをする。 幸福度 $b_i$ を得る。
- C: 家で宿題をする。 幸福度 $c_i$ を得る。

太郎君は飽き性なので、$2$ 日以上連続で同じ活動を行うことはできません。

太郎君が得る幸福度の総和の最大値を求めてください。
