# Addition and Subtraction

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_k
**Tags:** subset sum
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given an integer sequence $A = (A_1, A_2, \dots, A_N)$ of length $N$.

You also have an integer $x$, which is initially $0$.

You will perform the following $N$ operations:

- For $i = 1, 2, \dots, N$, choose exactly one of the following three operations:
Replace $x$ with $x + A_i$.

- Replace $x$ with $\vert x - A_i \vert$.
- Do nothing.

Find the number of possible values of $x$ after all $N$ operations are completed.

### Constraints

- $1 \leq N \leq 5 \times 10^5$
- $1 \leq A_i \leq 2 \times 10^6$
- $\displaystyle 1 \leq \sum_{i=1}^N A_i \leq 2 \times 10^6$
- All input values are integers

### Partial Score
This problem has partial scoring.

- If you solve the dataset with $\displaystyle 1 \leq \sum_{i=1}^N A_i \leq 5 \times 10^5$, you will get $4$ points.

### Input
The input is given from standard input in the following format:

```
N
A_1 A_2 ... A_N
```

### Output
Print the number of possible values of $x$ after all $N$ operations are completed.

### Sample Input 1
```
3
2 7 5
```

### Sample Output 1
```
10
```
For example, you can obtain $x = 9$ by performing the following operations:

- Initially, $x = 0$.
- At $i = 1$, replace $x$ with $\vert x - A_i \vert = \vert 0 - 2 \vert = 2$.
- At $i = 2$, replace $x$ with $x + A_i = 2 + 7 = 9$.
- At $i = 3$, do nothing.

### Sample Input 2
```
10
49 85 36 30 71 65 38 45 73 27
```

### Sample Output 2
```
454
```

## Editorial

### Claim
Let $S=\sum_i A_i$ and let $c_a$ be the multiplicity of the value $a$ in $A$. The possible final values of $x$ are exactly the absolute values of signed sums $\sum_i \varepsilon_i A_i$ with $\varepsilon_i\in\{-1,0,1\}$. An addition contributes $+A_i$, an absolute subtraction contributes $-A_i$, and doing nothing contributes $0$; conversely, a desired sign can be realized by choosing between $x+A_i$ and $\lvert x-A_i\rvert$ according to the sign of the current signed sum.

Consider
$$F(x)=\prod_{i=1}^N(1+x^{A_i}+x^{2A_i})=\sum_e f_e x^e.$$
Since $1+x^a+x^{2a}=x^a(1+x^{-a}+x^a)$,
$$F(x)=x^S\prod_i(1+x^{-A_i}+x^{A_i}),$$
so the exponent $e$ corresponds to $S+\sum_i\varepsilon_iA_i$. The support of $F$ is symmetric about $S$, and the number of possible final values is
$$1+\#\{e:0\le e<S,\ f_e\ne0\}.$$

It remains to compute $F$. Using
$$1+x^a+x^{2a}=(1-x^{3a})(1-x^a)^{-1},$$
we have
$$\log F(x)=\sum_a c_a\bigl(\log(1-x^{3a})-\log(1-x^a)\bigr).$$
For $k\ge1$ put $w(k)=1$ if $3\nmid k$ and $w(k)=-2$ if $3\mid k$. Then
$$[x^m]\log F(x)=\frac1m\sum_{a\mid m}c_a\,a\,w(m/a).$$
The right-hand side is computed for all $m\le S$ by iterating over the distinct $a$ and their multiples; this is a harmonic-series loop of total length $O(S\log S)$. Now $F=\exp(\log F)$ with $F(0)=1$, using formal power series exponentiation over $\mathbb F_{998244353}$; all divisions are by integers at most $S<998244353$. Count the nonzero coefficients $f_e$ for $0\le e<S$ and add one.

### Complexity
$O(S\log S)$ time and $O(S)$ memory, where $S=\sum_i A_i$.

## Solution

```cpp
#include <bits/stdc++.h>
using namespace std;

static const int MOD = 998244353;
static const int PRIMITIVE_ROOT = 3;

int mod_pow(long long a, long long e) {
    long long r = 1;
    while (e > 0) {
        if (e & 1) r = r * a % MOD;
        a = a * a % MOD;
        e >>= 1;
    }
    return (int)r;
}

int ceil_pow2(int n) {
    int x = 0;
    while ((1U << x) < (unsigned)n) x++;
    return x;
}

static int sum_e[30], sum_ie[30];
static bool roots_ready = false;

void prepare_roots() {
    if (roots_ready) return;
    roots_ready = true;
    int cnt2 = __builtin_ctz(MOD - 1);
    int e = mod_pow(PRIMITIVE_ROOT, (MOD - 1) >> cnt2);
    int ie = mod_pow(e, MOD - 2);
    vector<int> es(cnt2 - 1), ies(cnt2 - 1);
    for (int i = cnt2; i >= 2; i--) {
        es[i - 2] = e;
        ies[i - 2] = ie;
        e = (int)((long long)e * e % MOD);
        ie = (int)((long long)ie * ie % MOD);
    }
    int now = 1;
    for (int i = 0; i <= cnt2 - 2; i++) {
        sum_e[i] = (int)((long long)es[i] * now % MOD);
        now = (int)((long long)now * ies[i] % MOD);
    }
    now = 1;
    for (int i = 0; i <= cnt2 - 2; i++) {
        sum_ie[i] = (int)((long long)ies[i] * now % MOD);
        now = (int)((long long)now * es[i] % MOD);
    }
}

void butterfly(vector<int>& a) {
    prepare_roots();
    int n = (int)a.size();
    int h = ceil_pow2(n);
    for (int ph = 1; ph <= h; ph++) {
        int w = 1 << (ph - 1);
        int p = 1 << (h - ph);
        int now = 1;
        for (int s = 0; s < w; s++) {
            int offset = s << (h - ph + 1);
            for (int i = 0; i < p; i++) {
                int l = a[i + offset];
                int r = (int)((long long)a[i + offset + p] * now % MOD);
                int sum = l + r;
                if (sum >= MOD) sum -= MOD;
                int dif = l - r;
                if (dif < 0) dif += MOD;
                a[i + offset] = sum;
                a[i + offset + p] = dif;
            }
            now = (int)((long long)now * sum_e[__builtin_ctz(~(unsigned int)s)] % MOD);
        }
    }
}

void butterfly_inv(vector<int>& a) {
    prepare_roots();
    int n = (int)a.size();
    int h = ceil_pow2(n);
    for (int ph = h; ph >= 1; ph--) {
        int w = 1 << (ph - 1);
        int p = 1 << (h - ph);
        int inow = 1;
        for (int s = 0; s < w; s++) {
            int offset = s << (h - ph + 1);
            for (int i = 0; i < p; i++) {
                int l = a[i + offset];
                int r = a[i + offset + p];
                int sum = l + r;
                if (sum >= MOD) sum -= MOD;
                int dif = l - r;
                if (dif < 0) dif += MOD;
                a[i + offset] = sum;
                a[i + offset + p] = (int)((long long)dif * inow % MOD);
            }
            inow = (int)((long long)inow * sum_ie[__builtin_ctz(~(unsigned int)s)] % MOD);
        }
    }
}

vector<int> convolution(vector<int> a, vector<int> b, int need) {
    if (need <= 0 || a.empty() || b.empty()) return {};
    if (min(a.size(), b.size()) <= 20) {
        int as = (int)a.size(), bs = (int)b.size();
        vector<int> c(min((long long)need, (long long)as + bs - 1), 0);
        for (int i = 0; i < as; i++) {
            if (a[i] == 0) continue;
            int lim = (int)min((long long)bs, (long long)need - i);
            for (int j = 0; j < lim; j++) {
                c[i + j] = (c[i + j] + (long long)a[i] * b[j]) % MOD;
            }
        }
        return c;
    }
    int total = (int)a.size() + (int)b.size() - 1;
    int n = 1;
    while (n < total) n <<= 1;
    a.resize(n);
    b.resize(n);
    butterfly(a);
    butterfly(b);
    for (int i = 0; i < n; i++) a[i] = (int)((long long)a[i] * b[i] % MOD);
    butterfly_inv(a);
    int inv_n = mod_pow(n, MOD - 2);
    for (int i = 0; i < total; i++) a[i] = (int)((long long)a[i] * inv_n % MOD);
    a.resize(min(need, total));
    return a;
}

vector<int> poly_inv(const vector<int>& f, int n) {
    vector<int> g(1, mod_pow(f[0], MOD - 2));
    int m = 1;
    while (m < n) {
        int m2 = min(2 * m, n);
        vector<int> fcut(f.begin(), f.begin() + min((int)f.size(), m2));
        vector<int> fg = convolution(fcut, g, m2);
        fg.resize(m2);
        for (int& x : fg) x = (x == 0 ? 0 : MOD - x);
        fg[0] += 2;
        if (fg[0] >= MOD) fg[0] -= MOD;
        g = convolution(g, fg, m2);
        g.resize(m2);
        m = m2;
    }
    g.resize(n);
    return g;
}

vector<int> poly_log(const vector<int>& f, int n, const vector<int>& inv_int) {
    if (n == 1) return vector<int>(1, 0);
    vector<int> fcut(f.begin(), f.begin() + min((int)f.size(), n));
    fcut.resize(n);
    vector<int> der(n - 1);
    for (int i = 1; i < n; i++) der[i - 1] = (int)((long long)i * fcut[i] % MOD);
    vector<int> invf = poly_inv(fcut, n);
    vector<int> q = convolution(der, invf, n - 1);
    vector<int> res(n, 0);
    for (int i = 1; i < n; i++) {
        res[i] = (int)((long long)q[i - 1] * inv_int[i] % MOD);
    }
    return res;
}

vector<int> poly_exp(const vector<int>& f, int n, const vector<int>& inv_int) {
    vector<int> g(1, 1);
    int m = 1;
    while (m < n) {
        int m2 = min(2 * m, n);
        vector<int> logg = poly_log(g, m2, inv_int);
        vector<int> h(m2, 0);
        for (int i = 0; i < m2; i++) {
            int fi = (i < (int)f.size() ? f[i] : 0);
            h[i] = fi - logg[i];
            if (h[i] < 0) h[i] += MOD;
        }
        h[0] += 1;
        if (h[0] >= MOD) h[0] -= MOD;
        g = convolution(g, h, m2);
        g.resize(m2);
        m = m2;
    }
    g.resize(n);
    return g;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int N;
    cin >> N;
    vector<int> A(N);
    int S = 0;
    for (int i = 0; i < N; i++) {
        cin >> A[i];
        S += A[i];
    }

    vector<int> cnt(S + 1, 0);
    for (int a : A) cnt[a]++;

    vector<int> inv_int(S + 1, 1);
    for (int i = 2; i <= S; i++) {
        inv_int[i] = (int)((long long)(MOD - MOD / i) * inv_int[MOD % i] % MOD);
    }

    // g[m] = sum_{a | m} cnt[a] * a * w(m/a),
    // where w(k) = 1 for k % 3 != 0 and w(k) = -2 for k % 3 == 0.
    vector<int> gser(S + 1, 0);
    for (int a = 1; a <= S; a++) {
        if (cnt[a] == 0) continue;
        long long ca = (long long)cnt[a] * a % MOD;
        for (int k = 1; (long long)a * k <= S; k++) {
            int w = (k % 3 == 0) ? MOD - 2 : 1;
            gser[a * k] = (gser[a * k] + ca * w) % MOD;
        }
    }

    vector<int> logf(S + 1, 0);
    for (int m = 1; m <= S; m++) {
        logf[m] = (int)((long long)gser[m] * inv_int[m] % MOD);
    }

    vector<int> f = poly_exp(logf, S + 1, inv_int);

    long long nonzero_below_center = 0;
    for (int e = 0; e < S; e++) {
        if (f[e] != 0) nonzero_below_center++;
    }
    long long answer = nonzero_below_center + 1;
    cout << answer % MOD << '\n';
    return 0;
}
```

## Original statement (日本語)

### 問題文
長さ $N$ の整数列 $A = (A_1, A_2, \dots, A_N)$ があります。

また、あなたは整数 $x$ を持っています。はじめ $x=0$ です。
あなたは次の $N$ 回の操作を行います。

- $i = 1, 2, \dots, N$ の順に、次の $3$ 種類の操作のうちどれか $1$ つを行う。
$x$ を $x + A_i$ に置き換える。

- $x$ を $\vert x - A_i \vert$ に置き換える。
- 何もしない。

$N$ 回の操作が終了した時点での $x$ の値としてあり得るものの個数を求めてください。
