# Game

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_game
**Tags:** interval DP, game
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Snuke and Sumeke are playing a game. Initially there are two piles. The left pile has $A$ objects stacked on it, and the value of the $i$-th object from the top is $a_i$. The right pile has $B$ objects stacked on it, and the value of the $i$-th object from the top is $b_i$. Starting with Snuke, the two players alternately repeat the following operation.

- If both piles are empty, the game ends.
- If one pile is empty, take the top object of the non-empty pile.
- If neither pile is empty, choose either pile and take its top object.

When both players play optimally, find the total value of the objects Snuke takes.

### Constraints

- $1 \le A, B \le 1000$
- $1 \le a_i, b_i \le 1000$

### Input Format
Input is given from Standard Input in the following format:

```
A B
a_1 ... a_A
b_1 ... b_B
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
1 2
1
2 10
```

### Sample Output 1
```
11
```

Snuke should choose the 1 on the left first. Then Sumeke takes the 2 on the right, and Snuke takes the 10 on the right. The total value Snuke takes is 1 + 10 = 11.

### Sample Input 2
```
5 5
2 4 5 4 2
2 8 3 4 5
```

### Sample Output 2
```
21
```

## Editorial

### Claim

`DP[i][j]` = the value the first player obtains minus the value the second player obtains, starting from a state with $i$ objects remaining on the left and $j$ objects remaining on the right, with both players then playing optimally.

The answer is

$$\frac{\mathrm{DP}[A][B] + \sum_{i=1}^{A} a_i + \sum_{j=1}^{B} b_j}{2}.$$

The base case and transitions are:

- $\mathrm{DP}[0][0] = 0$
- $\mathrm{DP}[i][0] = a_{A+1-i} - \mathrm{DP}[i-1][j]$ for $i>0$
- $\mathrm{DP}[0][j] = b_{B+1-j} - \mathrm{DP}[i][j-1]$ for $j>0$
- $\mathrm{DP}[i][j] = \max(a_{A+1-i} - \mathrm{DP}[i-1][j], \; b_{B+1-j} - \mathrm{DP}[i][j-1])$ for $i,j>0$

Processing $i$ and $j$ in increasing order gives $O(AB)$.

### Complexity

$O(AB)$ time. A full table uses $O(AB)$ memory; keeping only the current and previous rows uses $O(B)$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int A, B;
	cin >> A >> B;
	vector<long long> a(A), b(B);
	long long total = 0;
	for (long long& x : a) { cin >> x; total += x; }
	for (long long& x : b) { cin >> x; total += x; }

	// dp[j] = (first player's value) - (second player's value) when
	// i items remain on the left and j items remain on the right.
	vector<long long> dp(B + 1), ndp(B + 1);
	dp[0] = 0;
	for (int j = 1; j <= B; ++j)
		dp[j] = b[B - j] - dp[j - 1];

	for (int i = 1; i <= A; ++i) {
		long long topLeft = a[A - i];
		ndp[0] = topLeft - dp[0];
		for (int j = 1; j <= B; ++j) {
			long long takeLeft = topLeft - dp[j];
			long long takeRight = b[B - j] - ndp[j - 1];
			ndp[j] = max(takeLeft, takeRight);
		}
		dp.swap(ndp);
	}

	cout << (dp[B] + total) / 2 << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

すぬけ君とすめけ君がゲームをしている。最初に、二つの山がある。左の山には $A$ 個の物が積まれており、上から $i$ 番目のものの価値は $a_i$ である。右の山には $B$ 個の物が積まれており、上から $i$ 番目のものの価値は $b_i$ である。すぬけ君とすめけ君は、すぬけ君からはじめて交互に次の操作を繰り返す。

- 両方の山が空であれば、ゲームを終了する。
- 片方の山が空であれば、空でないほうの山の一番上のものをとる。
- 両方の山が空でなければ、好きなほうの山を選び、一番上のものをとる。

両者が最善を尽くしたとき、すぬけ君の取るものの価値の合計を求めよ。
