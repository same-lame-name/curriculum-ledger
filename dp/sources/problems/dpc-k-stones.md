# Stones

**Contest:** Educational DP Contest
**Link:** https://atcoder.jp/contests/dp/tasks/dp_k
**Tags:** game DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
There is a set $A = \{ a_1, a_2, \ldots, a_N \}$ consisting of $N$ positive integers.
Taro and Jiro will play the following game against each other.

Initially, we have a pile consisting of $K$ stones.
The two players perform the following operation alternately, starting from Taro:

- Choose an element $x$ in $A$, and remove exactly $x$ stones from the pile.

A player loses when he becomes unable to play.
Assuming that both players play optimally, determine the winner.

### Constraints

- All values in input are integers.
- $1 \leq N \leq 100$
- $1 \leq K \leq 10^5$
- $1 \leq a_1 < a_2 < \cdots < a_N \leq K$

### Input
Input is given from Standard Input in the following format:

```
N K
a_1 a_2 ... a_N
```

### Output
If Taro will win, print `First`; if Jiro will win, print `Second`.

### Sample Input 1
```
2 4
2 3
```

### Sample Output 1
```
First
```

If Taro removes three stones, Jiro cannot make a move.
Thus, Taro wins.

### Sample Input 2
```
2 5
2 3
```

### Sample Output 2
```
Second
```

Whatever Taro does in his operation, Jiro wins, as follows:

- If Taro removes two stones, Jiro can remove three stones to make Taro unable to make a move.
- If Taro removes three stones, Jiro can remove two stones to make Taro unable to make a move.

### Sample Input 3
```
2 7
2 3
```

### Sample Output 3
```
First
```

Taro should remove two stones. Then, whatever Jiro does in his operation, Taro wins, as follows:

- If Jiro removes two stones, Taro can remove three stones to make Jiro unable to make a move.
- If Jiro removes three stones, Taro can remove two stones to make Jiro unable to make a move.

### Sample Input 4
```
3 20
1 2 3
```

### Sample Output 4
```
Second
```

### Sample Input 5
```
3 21
1 2 3
```

### Sample Output 5
```
First
```

### Sample Input 6
```
1 100000
1
```

### Sample Output 6
```
Second
```

## Editorial

`dp[i]` is true if the player to move wins with $i$ stones left. A position is winning exactly when some legal move reaches a losing position:

$$\texttt{dp}[i] = \bigvee_{a_j \le i} \lnot \texttt{dp}[i-a_j].$$

`dp[0] = false`. The answer is `First` iff `dp[K]`; the work is $O(NK)$.

## Solution

```cpp
#include <bits/stdc++.h>

using namespace std;

int main() {
	cin.tie(0)->sync_with_stdio(0);

	int n, k;
	cin >> n >> k;
	vector<int> a(n);
	for (int& x : a) cin >> x;
	vector<bool> dp(k + 1);
	for (int i = 1; i <= k; ++i)
		for (int j : a)
			if (i >= j && !dp[i - j])
				dp[i] = 1;
	cout << (dp[k] ? "First" : "Second") << '\n';
}
```

## Original statement (日本語)

### 問題文
$N$ 個の正整数からなる集合 $A = \{ a_1, a_2, \ldots, a_N \}$ があります。
太郎君と次郎君が次のゲームで勝負します。

最初に、$K$ 個の石からなる山を用意します。
二人は次の操作を交互に行います。
先手は太郎君です。

- $A$ の元 $x$ をひとつ選び、山からちょうど $x$ 個の石を取り去る。

先に操作を行えなくなった人が負けです。
二人が最適に行動すると仮定したとき、どちらが勝つかを判定してください。
