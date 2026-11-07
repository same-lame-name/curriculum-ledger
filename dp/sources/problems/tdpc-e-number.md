# Number

**Contest:** Typical DP Contest
**Link:** https://atcoder.jp/contests/tdpc/tasks/tdpc_number
**Tags:** digit DP
**Limits:** 2 sec / 256 MiB

## Statement

### Problem Statement

Find the number of positive integers at most $N$ whose digit sum in decimal notation is a multiple of $D$, modulo $1{,}000{,}000{,}007$.

### Constraints

- $1 \le N \le 10^{10000}$
- $1 \le D \le 100$

### Input Format
Input is given from Standard Input in the following format:

```
D
N
```

### Output Format
Print the answer on one line.

### Sample Input 1
```
3
100
```

### Sample Output 1
```
33
```

There are 33 multiples of 3 between 1 and 100 inclusive, and they satisfy the condition.

### Sample Input 2
```
7
123456789012345678901234567890
```

### Sample Output 2
```
468357804
```

## Editorial

### Claim

Write $L=|N|$ and read $N$ as a decimal string, so $L\le 10001$. Pad every integer in $[0,N]$ with leading zeros to exactly $L$ decimal digits. Padding does not change the digit sum, and the $L$-digit strings are in the same order and subject to the same upper bound as the integers, so counting strings counts the integers.

$dp[\mathit{tight}][r]$ is the DP state after processing a prefix: the number of ways to fill that prefix so that its digit sum is congruent to $r \pmod D$. Here $\mathit{tight}=1$ means the prefix is equal to the corresponding prefix of $N$, and $\mathit{tight}=0$ means it is already smaller.

Base case: $dp[1][0] = 1$ and all other entries are $0$.

At the next digit, let $N_{\mathit{pos}}$ be the digit of $N$ at the current position and let $\mathit{lim} = N_{\mathit{pos}}$ when $\mathit{tight}=1$ and $9$ otherwise. For each digit $d\in[0,\mathit{lim}]$, set $\mathit{ntight} = \mathit{tight} \wedge (d = N_{\mathit{pos}})$ and add $dp[\mathit{tight}][r]$ to $ndp[\mathit{ntight}][(r+d)\bmod D]$.

After all digits, $dp[0][0]+dp[1][0]$ counts every integer in $[0,N]$ whose digit sum is a multiple of $D$. Subtract $1$ for the number $0$, whose digit sum is $0$; what remains is the count of positive integers. All arithmetic is modulo $1{,}000{,}000{,}007$.

### Complexity

$O(L \cdot D \cdot 10)$ time and $O(D)$ memory.

### Verification

Checked against both samples: $(D,N)=(3,100)$ gives $33$, and $(D,N)=(7,123456789012345678901234567890)$ gives $468357804$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static constexpr long long MOD = 1000000007LL;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int D;
	string N;
	cin >> D >> N;

	// dp[tight][r]: number of prefixes with digit sum = r (mod D);
	// tight = 1 means the prefix is still equal to N's prefix.
	vector<array<long long, 2>> dp(D), ndp(D);
	for (auto& e : dp) e = {0, 0};
	dp[0][1] = 1;

	for (char ch : N) {
		for (auto& e : ndp) e = {0, 0};
		int lim = ch - '0';
		for (int r = 0; r < D; ++r) {
			for (int tight = 0; tight <= 1; ++tight) {
				long long ways = dp[r][tight];
				if (!ways) continue;
				int maxDigit = tight ? lim : 9;
				for (int d = 0; d <= maxDigit; ++d) {
					int nt = (tight && d == lim) ? 1 : 0;
					long long& to = ndp[(r + d) % D][nt];
					to += ways;
					if (to >= MOD) to -= MOD;
				}
			}
		}
		dp.swap(ndp);
	}

	// Subtract the number 0, whose digit sum is 0.
	long long ans = (dp[0][0] + dp[0][1] - 1) % MOD;
	if (ans < 0) ans += MOD;
	cout << ans << '\n';
	return 0;
}
```

## Original statement (日本語)

### Problem Statement

$N$ 以下の正整数であって、十進法表記したときの各桁の数の和が $D$ の倍数であるものの個数を mod 1,000,000,007 で求めよ。
