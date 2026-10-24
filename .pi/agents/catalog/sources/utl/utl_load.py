#!/usr/bin/env python3
"""utl_load.py — read the Ultimate Topic List JS exports without Node.

The two source files (topicList.js, topicListFullData.js) are ES modules of the form
    export const name = <JS object literal>;
with unquoted keys and trailing commas, so they are not JSON. This module tokenizes
the literal and parses it with a tiny recursive-descent parser. Stdlib only.

    import utl_load
    ex = utl_load.load_all()      # {"topicList": [...], "usefulLinks": [...],
                                  #  "topicInfo": {...}, "topicListProblems": {...}}
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ("topicList.js", "topicListFullData.js")

_TOK = re.compile(r"""
    (?P<ws>\s+|//[^\n]*|/\*.*?\*/)
  | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)
  | (?P<num>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<id>[A-Za-z_$][\w$]*)
  | (?P<p>[{}\[\]:,;=])
""", re.S | re.X)

_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def _unescape(body):
    out, i = [], 0
    while i < len(body):
        c = body[i]
        if c != "\\":
            out.append(c); i += 1; continue
        n = body[i + 1]
        if n == "u":
            out.append(chr(int(body[i + 2:i + 6], 16))); i += 6
        elif n == "x":
            out.append(chr(int(body[i + 2:i + 4], 16))); i += 4
        else:
            out.append(_ESC.get(n, n)); i += 2
    return "".join(out)


def _tokens(src):
    pos, toks = 0, []
    while pos < len(src):
        m = _TOK.match(src, pos)
        if not m:
            raise ValueError(f"unexpected character {src[pos]!r} at offset {pos}")
        pos = m.end()
        k = m.lastgroup
        if k == "ws":
            continue
        v = m.group()
        if k == "str":
            toks.append(("str", _unescape(v[1:-1])))
        elif k == "num":
            toks.append(("num", float(v) if any(ch in v for ch in ".eE") else int(v)))
        else:
            toks.append((k, v))
    return toks


class _Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self, kind=None, val=None):
        k, v = self.peek()
        if (kind and k != kind) or (val is not None and v != val):
            raise ValueError(f"expected {val or kind}, got {v!r} at token {self.i}")
        self.i += 1
        return v

    def value(self):
        k, v = self.peek()
        if v == "{": return self.obj()
        if v == "[": return self.arr()
        if k in ("str", "num"): self.i += 1; return v
        if k == "id":
            self.i += 1
            return {"true": True, "false": False, "null": None, "undefined": None}[v]
        raise ValueError(f"unexpected token {v!r} at {self.i}")

    def obj(self):
        self.take(val="{"); out = {}
        while self.peek()[1] != "}":
            k, key = self.peek()
            if k not in ("id", "str", "num"):
                raise ValueError(f"bad object key {key!r} at {self.i}")
            self.i += 1
            self.take(val=":")
            out[str(key)] = self.value()
            if self.peek()[1] == ",": self.i += 1
        self.take(val="}")
        return out

    def arr(self):
        self.take(val="["); out = []
        while self.peek()[1] != "]":
            out.append(self.value())
            if self.peek()[1] == ",": self.i += 1
        self.take(val="]")
        return out

    def module(self):
        exports = {}
        while self.i < len(self.t):
            if self.peek()[1] == ";": self.i += 1; continue
            if self.peek()[1] == "export": self.i += 1
            self.take("id")              # const / let / var
            name = self.take("id")
            self.take(val="=")
            exports[name] = self.value()
        return exports


def load(path):
    with open(path, encoding="utf-8") as f:
        return _Parser(_tokens(f.read())).module()


def load_all(folder=HERE):
    out = {}
    for fn in FILES:
        out.update(load(os.path.join(folder, fn)))
    return out


if __name__ == "__main__":
    ex = load_all()
    for k, v in ex.items():
        print(f"{k:<20} {type(v).__name__:<5} {len(v)}")
