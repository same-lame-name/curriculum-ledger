# Coin

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_h
**Tags:** dimension reduction
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You are given an $N \times N$ grid. Let $(i,j)$ denote the cell in the $i$-th row from the top and the $j$-th column from the left.

The state of each cell is described by $N$ strings $S_1, S_2, \dots, S_N$, each of length $N$.

If the $j$-th character of $S_i$ is `@`, then cell $(i,j)$ contains one coin. If it is `.`, then the cell is empty.

You start at cell $(1,1)$. It is guaranteed that $(1,1)$ is empty.

You may perform the following action any number of times (including zero):

- Let your current position be $(i,j)$. Move to either the right cell $(i,j+1)$ or the down cell $(i+1,j)$. You cannot move outside the grid. If the destination cell contains a coin, you must pick it up.

For each $x = 0, 1, \dots, 2N-2$, solve the following:

- After performing some actions (possibly zero), you reach a cell $(i,j)$ while having exactly $x$ coins. How many possible cells $(i,j)$ are there?

### Constraints

- $2 \leq N \leq 4000$
- $S_1, S_2, \dots, S_N$ are strings of length $N$ consisting of `@` and `.`
- The first character of $S_1$ is `.`
- $N$ is an integer

### Partial Score
This problem has partial scoring.

- If you solve the dataset with $N \leq 1500$, you will get $2$ points.

### Input
The input is given from standard input in the following format:

```
N
S_1
S_2
...
S_N
```

### Output
Print $2N-1$ lines. On the $i$-th line, output the answer for $x = i-1$.

### Sample Input 1
```
3
.@@
..@
@..
```

### Sample Output 1
```
5
6
3
2
0
```
For example, when $x=0$, the possible cells $(i,j)$ are $(1,1), (2,1), (2,2), (3,2), (3,3)$, so there are $5$ such cells.

### Sample Input 2
```
7
...@@@.
..@@@@@
@...@..
..@..@.
.....@@
.@@@@@@
@@.@.@.
```

### Sample Output 2
```
15
29
28
23
19
13
6
5
3
0
0
0
0
```

## Editorial

### Claim
For every cell $(x,y)$, let $m_{x,y}$ and $M_{x,y}$ be the minimum and maximum numbers of coins that can be collected on a monotone path from $(1,1)$ to $(x,y)$. They satisfy
$$m_{x,y}=\min(m_{x-1,y},m_{x,y-1})+[S_{x,y}=\texttt{@}],\qquad
M_{x,y}=\max(M_{x-1,y},M_{x,y-1})+[S_{x,y}=\texttt{@}],$$
with the out-of-grid terms omitted and $m_{1,1}=M_{1,1}=0$. This is an $O(N^2)$ DP.

The key fact is that for every integer $k$ with $m_{x,y}\le k\le M_{x,y}$ there is a path to $(x,y)$ that collects exactly $k$ coins. To see this, encode a path by its string of `D` and `R` moves, and let $X$ and $Y$ be paths attaining the minimum and the maximum. Repeated adjacent swaps turn $X$ into $Y$; in the sequence $X=P_0\to P_1\to\cdots\to P_K=Y$, consecutive paths differ in exactly one visited cell, so their coin counts differ by at most $1$. The intermediate value theorem gives a path for every $k$ between the two counts.

Hence $(x,y)$ contributes $1$ to every coin count $k$ with $m_{x,y}\le k\le M_{x,y}$. Accumulate these intervals with a difference array over $0,\dots,2N-2$ and take prefix sums. The answer for a given number of coins is the number of cells whose interval contains it.

### Complexity
$O(N^2)$ time and $O(N^2)$ memory for the two DP tables; the interval accumulation is $O(N^2)$ time and $O(N)$ additional memory.

## Solution

```cpp
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
```

## Original statement (日本語)

### 問題文
縦横 $N$ マスのグリッドがあります。グリッドの上から $i$ 行目、左から $j$ 列目のマスを $(i,j)$ と呼びます。

グリッドの各マスの状態は $N$ 個の長さ $N$ の文字列 $S_1,S_2,\dots,S_N$ によって表されます。$S_i$ の $j$ 文字目が `@` である時は $(i,j)$ はコインが $1$ 枚落ちているマス、`.` である時は何もないマスです。

あなたはグリッドの $(1,1)$ にいます。$(1,1)$ は何もないマスであることが保証されています。

あなたは以下の行動を $0$ 回以上自由な回数行うことができます。

- 今自分がいるマスを $(i,j)$ とする。右のマスまたは下のマス、すなわち $(i,j+1)$ または $(i+1,j)$ に移動する。グリッドの外への移動はできない。移動した先のマスにコインが落ちていた場合、あなたはそれを必ず拾う。

$x = 0, 1, \dots, 2N-2$ について次の問題を解いてください。

- あなたは $0$ 回以上行動してあるマス $(i,j)$ にたどり着きました。この時、あなたはコインを $x$ 枚持っていました。$(i,j)$ としてあり得るマスは何マスありますか？
