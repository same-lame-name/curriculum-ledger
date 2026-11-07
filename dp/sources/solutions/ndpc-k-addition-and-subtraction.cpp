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
