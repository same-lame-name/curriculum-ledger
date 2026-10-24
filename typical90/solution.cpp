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
const int INF = 1e9 + 7;
const double PI = acos(-1.0);
const double EPS = (1e-9);

int main() {
  FAST_IO
#ifdef LOCAL
  freopen("input.txt", "r", stdin);
  freopen("output.txt", "w", stdout);
#endif
  const int MAXN = 1005;
  int N;
  cin >> N;

  vector<vector<int>> grid(MAXN, vector<int>(MAXN, 0));
  vector<int> count(N + 1, 0);

  for (int rep = 0, lx, ly, rx, ry; rep < N; ++rep) {
    cin >> lx >> ly >> rx >> ry;

    grid[lx][ly] += 1;
    grid[lx][ry] -= 1;

    grid[rx][ly] -= 1;
    grid[rx][ry] += 1;
  }

  for (int r = 0; r < MAXN; ++r) {
    for (int c = 1; c < MAXN; ++c) {
      grid[r][c] += grid[r][c - 1];
    }
  }

  for (int c = 0; c < MAXN; ++c) {
    for (int r = 1; r < MAXN; ++r) {
      grid[r][c] += grid[r - 1][c];
    }
  }

  for (int r = 0; r < MAXN; ++r) {
    for (int c = 0; c < MAXN; ++c) {
      count[grid[r][c]] += 1;
    }
  }

  for (int c = 1; c <= N; ++c)
    cout << count[c] << '\n';

#ifdef LOCAL
  cout << endl
       << "finished in " << clock() * 1.0 / CLOCKS_PER_SEC << " sec" << endl;
#endif
  return 0;
}
