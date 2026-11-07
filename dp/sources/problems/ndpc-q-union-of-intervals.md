# Union of Intervals

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_q
**Tags:** polynomial interpolation
**Limits:** 10 sec / 16 MiB

## Statement

### Problem Statement
You are given an integer $M$ and $N$ pairs of integers $(L_1, R_1), \dots, (L_N, R_N)$. For each $i$ ($1 \leq i \leq N$), it holds that $1 \leq L_i \leq R_i \leq M$.

For each $K = 1, 2, \dots, M$, solve the following problem:

There are $2^N$ possible subsets $S \subseteq \lbrace 1,2,\dots,N\rbrace$. Among them, how many satisfy the following condition? Output the answer modulo $998244353$.

- The number of integers $m$ ($1 \leq m \leq M$) satisfying the following condition is exactly $K$:
There exists an integer $i \in S$ such that $L_i \leq m \leq R_i$.

### Constraints

- $1 \leq N \leq 2000$
- $1 \leq M \leq 4000$
- $1 \leq L_i \leq R_i \leq M$
- All input values are integers

### Input
The input is given from standard input in the following format:

```
N M
L_1 R_1
L_2 R_2
...
L_N R_N
```

### Output
Print $M$ lines. On the $i$-th line, output the answer for $K = i$.

### Sample Input 1
```
3 4
1 2
3 4
2 4
```

### Sample Output 1
```
0
2
2
3
```
When $K=1$, there are $0$ subsets $S$ that satisfy the condition.

When $K=2$, there are $2$ such subsets: $\lbrace 1\rbrace , \lbrace 2\rbrace$.

When $K=3$, there are $2$ such subsets: $\lbrace 3\rbrace , \lbrace 2,3\rbrace$.

When $K=4$, there are $3$ such subsets: $\lbrace 1,2\rbrace , \lbrace 1,3\rbrace , \lbrace 1,2,3\rbrace$.

### Sample Input 2
```
8 10
6 10
1 4
5 9
6 8
1 5
7 9
4 6
4 8
```

### Sample Output 2
```
0
0
3
2
15
25
26
20
72
92
```

## Editorial

### Claim
Sort the intervals by $L_i$ ascending. Let $dp[n][r][k]$ be the number of subsets of the first $n$ intervals whose union has rightmost covered point $r$ and total covered length $k$. The base is $dp[0][0][0]=1$, with $r=0$ denoting the empty union. For the $n$-th interval $(L,R)$, skipping it keeps $(r,k)$; taking it changes the state to
$$
\begin{cases}
(R,\ k+R-L+1), & r<L,\\
(R,\ k+R-r), & L\le r<R,\\
(r,\ k), & r\ge R.
\end{cases}
$$
The answer for $K$ is $\sum_r dp[N][r][K]$.

The natural DP has $O(NM^2)$ states, and even an in-place version over $n$ keeps $O(M^2)$ states, which exceeds the memory limit. Regard $dp[n][r]$ as a polynomial in a formal variable $x$, with $[x^k]dp[n][r]$ equal to the number of subsets of union size $k$. The transitions above only add polynomials and multiply them by powers of $x$, so the final answer is a polynomial $A(x)=\sum_K \mathrm{ans}_K x^K$ of degree at most $M$.

Evaluate the DP at $x=0,1,\dots,M$ and interpolate $A$ from the $M+1$ values. For a fixed $x$ the DP state is scalar. Its transition can be maintained with a lazy segment tree over $r$: for $r\ge R$ the old value is doubled (skip and take both keep $r$), while at $R$ one adds
$$x^{R-L+1}\sum_{r<L}dp[r]+\sum_{L\le r<R}x^{R-r}dp[r].$$

One evaluation therefore takes $O(N\log M)$ time, and the interpolation recovers all coefficients.

### Complexity
$O(MN\log M)$ time for all evaluations and $O(M)$ memory; the interpolation is an additional $O(M^2)$ with the standard Lagrange implementation (or $O(M\log^2 M)$ with fast polynomial interpolation).

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static const int MOD = 998244353;

long long mod_pow(long long a, long long e) {
    long long r = 1;
    while (e > 0) {
        if (e & 1) r = r * a % MOD;
        a = a * a % MOD;
        e >>= 1;
    }
    return r;
}

struct SegTree {
    int n;
    vector<int> sum_plain, sum_weighted, lazy;

    SegTree(int n_) : n(n_) {
        sum_plain.assign(4 * n, 0);
        sum_weighted.assign(4 * n, 0);
        lazy.assign(4 * n, 1);
    }

    void reset() {
        fill(sum_plain.begin(), sum_plain.end(), 0);
        fill(sum_weighted.begin(), sum_weighted.end(), 0);
        fill(lazy.begin(), lazy.end(), 1);
    }

    void apply(int node, int mul) {
        sum_plain[node] = (long long)sum_plain[node] * mul % MOD;
        sum_weighted[node] = (long long)sum_weighted[node] * mul % MOD;
        lazy[node] = (long long)lazy[node] * mul % MOD;
    }

    void push(int node) {
        if (lazy[node] != 1) {
            apply(node * 2, lazy[node]);
            apply(node * 2 + 1, lazy[node]);
            lazy[node] = 1;
        }
    }

    void pull(int node) {
        sum_plain[node] = sum_plain[node * 2] + sum_plain[node * 2 + 1];
        if (sum_plain[node] >= MOD) sum_plain[node] -= MOD;
        sum_weighted[node] = sum_weighted[node * 2] + sum_weighted[node * 2 + 1];
        if (sum_weighted[node] >= MOD) sum_weighted[node] -= MOD;
    }

    void point_add(int node, int l, int r, int pos, int plain, int weighted) {
        if (l == r) {
            sum_plain[node] += plain;
            if (sum_plain[node] >= MOD) sum_plain[node] -= MOD;
            sum_weighted[node] += weighted;
            if (sum_weighted[node] >= MOD) sum_weighted[node] -= MOD;
            return;
        }
        push(node);
        int mid = (l + r) >> 1;
        if (pos <= mid) point_add(node * 2, l, mid, pos, plain, weighted);
        else point_add(node * 2 + 1, mid + 1, r, pos, plain, weighted);
        pull(node);
    }

    void range_mul(int node, int l, int r, int ql, int qr, int mul) {
        if (qr < l || r < ql) return;
        if (ql <= l && r <= qr) {
            apply(node, mul);
            return;
        }
        push(node);
        int mid = (l + r) >> 1;
        range_mul(node * 2, l, mid, ql, qr, mul);
        range_mul(node * 2 + 1, mid + 1, r, ql, qr, mul);
        pull(node);
    }

    pair<int, int> query(int node, int l, int r, int ql, int qr) {
        if (qr < l || r < ql) return {0, 0};
        if (ql <= l && r <= qr) return {sum_plain[node], sum_weighted[node]};
        push(node);
        int mid = (l + r) >> 1;
        auto a = query(node * 2, l, mid, ql, qr);
        auto b = query(node * 2 + 1, mid + 1, r, ql, qr);
        int s1 = a.first + b.first;
        if (s1 >= MOD) s1 -= MOD;
        int s2 = a.second + b.second;
        if (s2 >= MOD) s2 -= MOD;
        return {s1, s2};
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int N, M;
    cin >> N >> M;
    vector<pair<int, int>> intervals(N);
    for (int i = 0; i < N; i++) {
        int L, R;
        cin >> L >> R;
        intervals[i] = {L, R};
    }
    sort(intervals.begin(), intervals.end());

    int points = M + 1;
    vector<int> fact(points + 1, 1), invfact(points + 1, 1);
    for (int i = 1; i <= points; i++) fact[i] = (long long)fact[i - 1] * i % MOD;
    invfact[points] = mod_pow(fact[points], MOD - 2);
    for (int i = points; i >= 1; i--) invfact[i - 1] = (long long)invfact[i] * i % MOD;

    vector<int> value(points);
    vector<int> powx(M + 2), invpowx(M + 2);
    SegTree seg(M);

    for (int idx = 0; idx < points; idx++) {
        int x = idx + 1;
        int xinv = mod_pow(x, MOD - 2);
        powx[0] = 1;
        invpowx[0] = 1;
        for (int i = 1; i <= M + 1; i++) {
            powx[i] = (long long)powx[i - 1] * x % MOD;
            invpowx[i] = (long long)invpowx[i - 1] * xinv % MOD;
        }

        seg.reset();
        seg.point_add(1, 0, M, 0, 1, 1);

        for (auto [L, R] : intervals) {
            auto left = seg.query(1, 0, M, 0, L - 1);
            auto mid = seg.query(1, 0, M, L, R - 1);
            long long delta = 0;
            delta += (long long)powx[R - L + 1] * left.first % MOD;
            delta += (long long)powx[R] * mid.second % MOD;
            delta %= MOD;

            seg.range_mul(1, 0, M, R, M, 2);
            seg.point_add(1, 0, M, R, (int)delta, (int)(delta * invpowx[R] % MOD));
        }
        value[idx] = seg.sum_plain[1];
    }

    // P(x) = product_{i=0}^{points-1} (x - (i+1)).
    vector<int> poly(points + 1, 0);
    poly[0] = 1;
    for (int i = 0; i < points; i++) {
        int c = i + 1;
        vector<int> next(points + 1, 0);
        for (int j = 0; j <= i; j++) {
            next[j] = (next[j] - (long long)c * poly[j]) % MOD;
            if (next[j] < 0) next[j] += MOD;
            next[j + 1] += poly[j];
            if (next[j + 1] >= MOD) next[j + 1] -= MOD;
        }
        poly.swap(next);
    }

    vector<int> answer(M + 1, 0);
    for (int i = 0; i < points; i++) {
        int c = i + 1;
        // Q_i(x) = P(x) / (x - c), by synthetic division.
        vector<int> q(points, 0);
        q[points - 1] = poly[points];
        for (int j = points - 1; j >= 1; j--) {
            q[j - 1] = (poly[j] + (long long)c * q[j]) % MOD;
        }
        long long denom = (long long)fact[i] * fact[points - 1 - i] % MOD;
        if ((points - 1 - i) & 1) denom = (MOD - denom) % MOD;
        long long coef = (long long)value[i] * mod_pow(denom, MOD - 2) % MOD;
        for (int j = 0; j < points; j++) {
            answer[j] = (answer[j] + coef * q[j]) % MOD;
        }
    }

    for (int K = 1; K <= M; K++) {
        cout << answer[K] << '\n';
    }
    return 0;
}
```

## Original statement (日本語)

### 問題文
整数 $M$ および $N$ 個の整数の組 $(L_1, R_1), \dots, (L_N, R_N)$ が与えられます。ここで任意の $1 \leq i \leq N$ を満たす整数 $i$ について $1 \leq L_i \leq R_i \leq M$ が成り立ちます。

$K = 1, 2, \dots, M$ に対して以下の問題の答えを求めてください。

$S \subseteq \lbrace 1, 2,\dots, N \rbrace$ である集合 $S$ としてあり得るものは $2^N$ 通りありますが、そのうち以下の条件を満たすものは何個ありますか？答えを $998244353$ で割った余りを求めてください。

- $1$ 以上 $M$ 以下の整数 $m$ のうち、以下を満たすものがちょうど $K$ 個である。
ある整数 $i \in S$ が存在して、$L_i \leq m \leq R_i$ が成り立つ。
