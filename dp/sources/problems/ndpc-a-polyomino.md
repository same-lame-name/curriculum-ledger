# Polyomino

**Contest:** Next DP Contest
**Link:** https://atcoder.jp/contests/ndpc/tasks/ndpc2026_a
**Tags:** profile DP
**Limits:** 2 sec / 1024 MiB

## Statement

### Problem Statement
You have an unlimited number of the following two types of polyominoes:

- A rectangular polyomino of size $2$ (height) × $1$ (width)
- An L-shaped polyomino formed by removing one $1 \times 1$ square from a $2 \times 2$ square

You are given a grid of size $2$ (height) × $N$ (width). You want to completely tile all cells of the grid using these polyominoes under the following conditions:

- Each cell of the grid must be covered by exactly one polyomino.
- You may rotate the polyominoes when placing them.

Find the number of ways to place the polyominoes satisfying these conditions. Note that two arrangements are considered different even if one can be obtained from the other by rotating or flipping the entire grid. Also, polyominoes of the same shape are indistinguishable.

### Constraints

- $1 \leq N \leq 40$
- $N$ is an integer

### Input
The input is given from standard input in the following format:

```
N
```

### Output
Print the number of valid tilings.

### Sample Input 1
```
3
```

### Sample Output 1
```
5
```
There are $5$ valid tilings as shown below.

![](assets/ndpc-polyomino/a53d5b7fac.png)

### Sample Input 2
```
40
```

### Sample Output 2
```
25366833951139
```

## Editorial

No editorial is stored for this problem.

## Solution

No verified solution is stored for this problem.

## Original statement (日本語)

### 問題文
あなたは次の $2$ 種類のポリオミノを無数に持っています：

- 縦 $2$ マス、横 $1$ マスの長方形型のポリオミノ
- 一辺が $2$ マスの正方形型のポリオミノから一辺が $1$ マスの正方形を $1$ 個取り除いてできる、L 字型のポリオミノ

縦 $2$ マス、横 $N$ マスのグリッドがあります。あなたは次の条件を満たすようにグリッドの全てのマスにポリオミノを敷き詰めることにしました。

- グリッドの各マスにはちょうど $1$ 個のポリオミノが置かれている。
- ポリオミノを置くときに回転させることができる。

条件を満たすポリオミノの配置の個数を求めてください。ただし、グリッドを回転・反転してはじめて一致する配置は別々に数えます。また、同じ形のポリオミノ同士は区別できないものとします。
