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
const double EPS = (1e-9);

int main() {
  FAST_IO
#ifdef LOCAL
  freopen("input.txt", "r", stdin);
  freopen("output.txt", "w", stdout);
#endif
  int N, K;
  // Requires long long, since the max_score can reach 2e14.
  long long max_score = 0;
  cin >> N >> K;

  vector<int> choices;

  for (int rep = 0, a, b; rep < N; ++rep) {
    cin >> a >> b;
    choices.push_back(b);
    choices.push_back(a - b);
  }

  sort(choices.rbegin(), choices.rend());

  // safe to iterate since K <= 2N
  for (int rep = 0; rep < K; ++rep) {
    max_score += choices[rep];
  }

  cout << max_score << '\n';
#ifdef LOCAL
  cout << endl
       << "finished in " << clock() * 1.0 / CLOCKS_PER_SEC << " sec" << endl;
#endif
  return 0;
}
