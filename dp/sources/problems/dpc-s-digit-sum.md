# Digit Sum

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_s
**Tags:** digit DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
Find the number of integers between $1$ and $K$ (inclusive) satisfying the following condition, modulo $10^9 + 7$:

- The sum of the digits in base ten is a multiple of $D$.

### Constraints

- All values in input are integers.
- $1 \leq K < 10^{10000}$
- $1 \leq D \leq 100$

### Input
Input is given from Standard Input in the following format:

```
K
D
```

### Output
Print the number of integers satisfying the condition, modulo $10^9 + 7$.

### Sample Input 1
```
30
4
```

### Sample Output 1
```
6
```

Those six integers are: $4, 8, 13, 17, 22$ and $26$.

### Sample Input 2
```
1000000009
1
```

### Sample Output 2
```
2
```

Be sure to print the number modulo $10^9 + 7$.

### Sample Input 3
```
98765432109876543210
58
```

### Sample Output 3
```
635270834
```

## Editorial

Read $K$ as a string of length $L$. Let `free[i][j]` be the number of ways to fill the last $L-i$ digits so that their digit sum is $\equiv j \pmod D$:

$$free[L][0] = 1, \qquad free[i][j] = \sum_{d=0}^{9} free[i+1][(j+d) \bmod D].$$

Then scan $K$ from the left, keeping `carry` = the digit sum of the fixed prefix mod $D$. At position $i$, every digit $d < K_i$ contributes `free[i+1][(carry+d) mod D]`. After the scan, add $1$ if the whole number is divisible, then subtract $1$ to exclude $0$. The answer counts positive integers $\le K$ with digit sum divisible by $D$. $O(L D \cdot 10)$.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAXL = 10000;
const int MAXD = 100;
const int MOD = 1e9 + 7;

int dp[MAXL + 1][MAXD];

int add(int i, int j) {
	if ((i += j) >= MOD)
		i -= MOD;
	return i;
}

void init(int l, int d) {
	dp[l][0] = 1;
	for (int i = l - 1; i >= 0; --i)
		for (int j = 0; j < d; ++j)
			for (int k = 0; k < 10; ++k)
				dp[i][j] = add(dp[i][j], dp[i + 1][(j + k) % d]);
}

int query(const string& s, int d) {
	int ans = 0, carry = 0;
	for (int i = 0; i < (int) s.length(); ++i) {
		for (int j = 0; j < (s[i] - '0'); ++j)
			ans = add(ans, dp[i + 1][(carry + j) % d]);
		carry = (carry + (s[i] - '0')) % d;
	}
	if (carry == 0) ans++;
	if (--ans < 0) ans += MOD;
	return ans;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	string s; int d;
	cin >> s >> d;
	init((int) s.size(), d);
	cout << query(s, d) << '\n';
}
```

## Original statement (日本語)

### 問題文
$1$ 以上 $K$ 以下の整数のうち、十進表記における各桁の数字の総和が $D$ の倍数であるようなものは何個でしょうか？
$10^9 + 7$ で割った余りを求めてください。
