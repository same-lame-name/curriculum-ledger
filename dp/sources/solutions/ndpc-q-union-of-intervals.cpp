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
