#include "bits/stdc++.h"
#ifdef LOCAL
#include "../../algorithms/debug.cpp"
#else
#define debug(...) ""
#endif
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
const long long INF = 1e12 + 7;
const double PI = acos(-1.0);
const double EPS = (1e-9);

int main() {
  FAST_IO
#ifdef LOCAL
  freopen("input.txt", "r", stdin);
  freopen("output.txt", "w", stdout);
#endif
  int N, W;
  cin >> N >> W;

  vector<int> weights(N), value(N);
  // since the value for one item can be atmost 1e9 and there could be 100
  // items, we are working with 1e11 as maximum-value, needs long long
  vector<vector<long long>> dp(N + 1, vector<long long>(W + 1, -INF));

  for (int idx = 0; idx < N; ++idx) {
    cin >> weights[idx] >> value[idx];
  }

  // If there are no items to rob, with the bag of capacity 'w', the max-value
  // one can loot is zero.
  for (int w = 0; w <= W; ++w) {
    dp[0][w] = 0;
  }

  for (int item = 0, curr_w, curr_v; item < N; ++item) {
    curr_v = value[item], curr_w = weights[item];
    for (int w = 0; w <= W; ++w) {
      // Don't pick the item.
      max_self(dp[item + 1][w], dp[item][w]);

      // Pick the item only if the bag capacity allows it.
      if (w + curr_w <= W) {
        max_self(dp[item + 1][w + curr_w], dp[item][w] + curr_v);
      }
    }
  }

  cout << dp[N][W] << '\n';
#ifdef LOCAL
  cout << endl
       << "finished in " << clock() * 1.0 / CLOCKS_PER_SEC << " sec" << endl;
#endif
  return 0;
}
