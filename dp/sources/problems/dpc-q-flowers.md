# Flowers

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_q
**Tags:** Fenwick tree, prefix maximum
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There are $N$ flowers arranged in a row.
For each $i$ ($1 \leq i \leq N$), the height and the beauty of the $i$-th flower from the left is $h_i$ and $a_i$, respectively.
Here, $h_1, h_2, \ldots, h_N$ are all distinct.

Taro is pulling out some flowers so that the following condition is met:

- The heights of the remaining flowers are monotonically increasing from left to right.

Find the maximum possible sum of the beauties of the remaining flowers.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 2 × 10^5$
- $1 \leq h_i \leq N$
- $h_1, h_2, \ldots, h_N$ are all distinct.
- $1 \leq a_i \leq 10^9$

### Input
Input is given from Standard Input in the following format:

```
N
h_1 h_2 ... h_N
a_1 a_2 ... a_N
```

### Output
Print the maximum possible sum of the beauties of the remaining flowers.

### Sample Input 1
```
4
3 1 4 2
10 20 30 40
```

### Sample Output 1
```
60
```

We should keep the second and fourth flowers from the left.
Then, the heights would be $1, 2$ from left to right, which is monotonically increasing, and the sum of the beauties would be $20 + 40 = 60$.

### Sample Input 2
```
1
1
10
```

### Sample Output 2
```
10
```

The condition is met already at the beginning.

### Sample Input 3
```
5
1 2 3 4 5
1000000000 1000000000 1000000000 1000000000 1000000000
```

### Sample Output 3
```
5000000000
```

The answer may not fit into a 32-bit integer type.

### Sample Input 4
```
9
4 2 5 8 3 6 1 7 9
6 8 8 4 6 3 5 7 5
```

### Sample Output 4
```
31
```

We should keep the second, third, sixth, eighth and ninth flowers from the left.

## Editorial

Time Complexity: $\mathcal{O}(N\log N)$

Let $\texttt{dp}[i]$ represent the maximum beauty of a subsequence of flowers
ending at $i$.

$$\texttt{dp}[i]=\max(\texttt{dp}[j]) + a_i$$
such that $j < i$ and $h_j < h_i$.

However, looping through all values of $j$ would result in a complexity of
$\mathcal O(N^2)$, which would TLE.

We can use a data-structure to speed this up. Notice that when calculating
$\texttt{dp}[i]$, we're querying the maximum $\texttt{dp}[j]$ such that
$h_j < h_i$ and adding $a_i$.

In other words, we're querying the maximum $\texttt{dp}[j]$ which
$h_j\in[1, h_i - 1]$, which can be handled with a data-structure like a segment
tree or a binary indexed tree.

```
#include <bits/stdc++.h>

using namespace std;

const int MAXN = 2e5;

int n;
long long bit[MAXN + 1];

void update(int i, long long x) {
	for ( ; i <= n; i += i & -i)
		bit[i] = max(bit[i], x);
}

long long query(int i) {
	long long ans = 0;
	for ( ; i > 0; i -= i & -i)
		ans = max(ans, bit[i]);
	return ans;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	cin >> n;
	vector<int> h(n), a(n);
	for (int i = 0; i < n; ++i) cin >> h[i];
	for (int i = 0; i < n; ++i) cin >> a[i];
	for (int i = 0; i < n; ++i) {
		update(h[i], query(h[i] - 1) + a[i]);
	}
	cout << query(n) << '\n';
}
```

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

const int MAXN = 2e5;

int n;
long long bit[MAXN + 1];

void update(int i, long long x) {
	for ( ; i <= n; i += i & -i)
		bit[i] = max(bit[i], x);
}

long long query(int i) {
	long long ans = 0;
	for ( ; i > 0; i -= i & -i)
		ans = max(ans, bit[i]);
	return ans;
}

int main() {
	cin.tie(0)->sync_with_stdio(0);

	cin >> n;
	vector<int> h(n), a(n);
	for (int i = 0; i < n; ++i) cin >> h[i];
	for (int i = 0; i < n; ++i) cin >> a[i];
	for (int i = 0; i < n; ++i) {
		update(h[i], query(h[i] - 1) + a[i]);
	}
	cout << query(n) << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 本の花が横一列に並んでいます。
各 $i$ ($1 \leq i \leq N$) について、左から $i$ 番目の花の高さは $h_i$ で、美しさは $a_i$ です。
ただし、$h_1, h_2, \ldots, h_N$ はすべて相異なります。

太郎君は何本かの花を抜き去ることで、次の条件が成り立つようにしようとしています。

- 残りの花を左から順に見ると、高さが単調増加になっている。

残りの花の美しさの総和の最大値を求めてください。
