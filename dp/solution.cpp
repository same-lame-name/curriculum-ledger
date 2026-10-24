#include "bits/stdc++.h"
#define PRECISION(x) cout << fixed << setprecision(x)
#define FAST_IO                                                                \
  ios::sync_with_stdio(false);                                                 \
  cin.tie(NULL);                                                               \
  cout.tie(NULL);

using namespace std;

template <class T> bool max_self(T &a, const T &b) {
  return b > a ? a = b, true : false;
}
template <class T> bool min_self(T &a, const T &b) {
  return b < a ? a = b, true : false;
}
typedef long long LL;
const int INF = 1e9 + 7;
const double PI = acos(-1.0);
const int MOD = 1e9 + 7;

int add(int a, int b) { return ((1LL * a + b) % MOD + MOD) % MOD; }

template <typename Head, typename... Tail> int add(Head h, Tail... t) {
  return add(h, add(t...));
}

int sub(int a, int b) { return add(a, -b); }

int mult(int a, int b) { return 1LL * a * b % MOD; }

template <typename Head, typename... Tail> int mult(Head h, Tail... t) {
  return mult(h, mult(t...));
}

int pow(int b, int p) {
  int res = 1;
  while (p) {
    if (p & 1) {
      res = mult(res, b);
    }
    p /= 2;
    b = mult(b, b);
  }
  return res;
}

int inv(int x) { return pow(x, MOD - 2); }

int divide(int a, int b) { return mult(a, inv(b)); }

const double EPS = (1e-9);

int main() {
  FAST_IO
#ifdef LOCAL
  freopen("input.txt", "r", stdin);
  freopen("output.txt", "w", stdout);
#endif
  int H, W;
  cin >> H >> W;

  vector<string> grid(H);
  for (string &row : grid)
    cin >> row;

  vector<vector<int>> dp(H + 1, vector<int>(W + 1, 0));
  dp[0][0] = 1;

  for (int r = 0; r < H; ++r) {
    for (int c = 0; c < W; ++c) {
      if (grid[r][c] == '#')
        continue;
      if (r - 1 >= 0)
        dp[r][c] = add(dp[r][c], dp[r - 1][c]);
      if (c - 1 >= 0)
        dp[r][c] = add(dp[r][c], dp[r][c - 1]);
    }
  }

  cout << dp[H - 1][W - 1] << '\n';

#ifdef LOCAL
  cout << endl
       << "finished in " << clock() * 1.0 / CLOCKS_PER_SEC << " sec" << endl;
#endif
  return 0;
}
