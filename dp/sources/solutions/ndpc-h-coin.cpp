#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int N;
    cin >> N;
    vector<string> S(N);
    for (int i = 0; i < N; i++) cin >> S[i];

    const int INF = 1e9;
    vector<int> prev_min(N, INF), prev_max(N, -1);
    vector<int> cur_min(N, INF), cur_max(N, -1);
    vector<int> diff(2 * N + 2, 0);

    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            int best_min = INF, best_max = -1;
            if (i == 0 && j == 0) {
                best_min = best_max = 0;
            } else {
                if (i > 0) {
                    best_min = min(best_min, prev_min[j]);
                    best_max = max(best_max, prev_max[j]);
                }
                if (j > 0) {
                    best_min = min(best_min, cur_min[j - 1]);
                    best_max = max(best_max, cur_max[j - 1]);
                }
            }
            int coin = (S[i][j] == '@' ? 1 : 0);
            cur_min[j] = best_min + coin;
            cur_max[j] = best_max + coin;

            diff[cur_min[j]]++;
            diff[cur_max[j] + 1]--;
        }
        swap(prev_min, cur_min);
        swap(prev_max, cur_max);
    }

    int running = 0;
    for (int x = 0; x <= 2 * N - 2; x++) {
        running += diff[x];
        cout << running << '\n';
    }
    return 0;
}
