#include <bits/stdc++.h>
using namespace std;

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);

	int n;
	cin >> n;
	vector<int> p(n);
	for (int& x : p) cin >> x;

	int sum = 0;
	vector<char> can(1, 1);
	for (int x : p) {
		vector<char> nxt(sum + x + 1, 0);
		for (int j = 0; j <= sum; ++j)
			if (can[j]) nxt[j] = nxt[j + x] = 1;
		sum += x;
		can.swap(nxt);
	}

	cout << count(can.begin(), can.end(), 1) << '\n';
	return 0;
}
