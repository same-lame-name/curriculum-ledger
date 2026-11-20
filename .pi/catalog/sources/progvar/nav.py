#!/usr/bin/env python3
"""nav.py — navigate progvar.fun's problem sets: topic -> set title -> problems.

Mirrors clicking through https://progvar.fun. Covers only the 270 sets the site
itself can reach; the 382 ID-only sets live in the CSVs and are out of scope here.

USABLE TWO WAYS
---------------
1. As a library (preferred when scripting):

       import nav
       nav.topics()                                   # -> list of {topic, n_sets, n_problems}
       nav.sets("Dynamic Programming")                # -> list of {title, set_id, url, n_problems}
       nav.problems("DP on Broken Profile")           # -> {topic, set, problems:[...]}
       nav.find("knapsack")                           # -> {sets:[...], problems:[...]}

2. As a CLI:

       python3 nav.py topics
       python3 nav.py sets "Dynamic Programming"
       python3 nav.py problems "DP on Broken Profile"
       python3 nav.py problems "DP on Broken Profile" --topic "Dynamic Programming"
       python3 nav.py find knapsack
       python3 nav.py topics --json          # add --json to any command

Every CLI command accepts --json for machine-readable output. Exit codes:
  0 ok | 2 nothing matched (candidates are listed) | 3 nav.json missing

SEARCH SEMANTICS (read this before building queries)
---------------------------------------------------
Default matching is a CASE-INSENSITIVE, whitespace-trimmed SUBSTRING search, matched
anywhere in the string — not a prefix, not whole-word, not token/AND:

    'profile'  matches 'DP on Broken Profile'      (mid-string)
    'acks'     matches '...Lists, Stacks, Queues'  (inside a word)
    'Broken DP'  -> NO match   (words must be contiguous, in order)
    'on'       -> 71 sets      (no minimum length; short queries are useless)

There is no typo tolerance, no stemming, and NO relevance ranking — matches come back
in progvar's own order.

--exact is a STRICT, CASE-SENSITIVE full-string equality. Copy exact titles verbatim
from the output of topics()/sets()/problems(). This is deliberately stricter than the
default matcher:

    sets('Dynamic Programming')             -> 23 sets
    sets('dynamic programming', exact=True) -> NavError

What each command searches:
    sets(topic)      -> the 9 TOPIC names            (not set titles)
    problems(title)  -> SET TITLES, across all topics
    find(text)       -> SET TITLES *and* PROBLEM NAMES  <- use this when unsure

Note the last one matters: find('knapsack') returns 5 problems, while
problems('knapsack') raises NavError, because "knapsack" appears in no set title
among the 270 reachable sets — only in problem names.

Results are ordered exactly as progvar.fun orders them — this tool never re-ranks,
re-classifies or infers anything.
"""
import json, os, re, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
NAVJSON = os.path.join(HERE, "nav.json")
UNCLASSIFIED = "Not topic-classified on progvar.fun"
BASE = "https://progvar.fun"

HOSTS = {"atcoder.jp": "AtCoder", "codeforces.com": "Codeforces", "cses.fi": "CSES",
         "onlinejudge.org": "UVa", "hackerrank.com": "HackerRank", "codechef.com": "CodeChef",
         "spoj.com": "SPOJ", "acm.timus.ru": "Timus", "lightoj.com": "LightOJ"}

def platform(url):
    m = re.match(r"https?://([^/]+)/", (url or "") + "/")
    host = (m.group(1) if m else "").lower()
    for h, n in HOSTS.items():
        if host.endswith(h): return n
    return host

class NavError(Exception):
    """Raised when a topic/set does not match. .candidates lists near misses."""

    def __init__(self, msg, candidates=()):
        super().__init__(msg); self.candidates = list(candidates)

def _load():
    if not os.path.exists(NAVJSON):
        raise FileNotFoundError(f"{NAVJSON} missing — run: python3 build_nav.py")
    return json.load(open(NAVJSON, encoding="utf-8"))

_DATA = None
def data():
    global _DATA
    if _DATA is None: _DATA = _load()
    return _DATA

def _groups():
    """Every (topic_name, set_dict) pair, topics first then the unclassified bucket."""
    d = data()
    out = []
    for t in d["topics"]:
        for s in t["sets"]: out.append((t["topic"], s))
    for s in d.get("unclassified_sets", []): out.append((UNCLASSIFIED, s))
    return out

def _m(needle, hay, exact):
    return hay == needle if exact else needle.lower().strip() in hay.lower()

# ---------------------------------------------------------------- library API
def topics():
    d = data()
    out = [{"topic": t["topic"], "n_sets": len(t["sets"]),
            "n_problems": sum(len(s["problems"]) for s in t["sets"])} for t in d["topics"]]
    u = d.get("unclassified_sets", [])
    if u:
        out.append({"topic": UNCLASSIFIED, "n_sets": len(u),
                    "n_problems": sum(len(s["problems"]) for s in u)})
    return out

def sets(topic, exact=False):
    """Set titles under one topic, in the site's order."""
    hits = [s for tn, s in _groups() if _m(topic, tn, exact)]
    if not hits:
        raise NavError(f"no topic matching {topic!r}", [t["topic"] for t in topics()])
    return [{"title": s["title"], "set_id": s["set_id"], "url": BASE + s["url"],
             "n_problems": len(s["problems"])} for s in hits]

def _problems_of(s):
    return [{"number": p["number"], "name": p["name"], "url": p["url"],
             "platform": platform(p["url"]), "solved_count": p.get("solved_count", 0),
             "dacu": p.get("dacu", 0)} for p in s["problems"]]

def problems(set_title, topic=None, exact=False, limit=None):
    """Problems for every set whose title matches. Returns {matches:[{topic,set,...}]}."""
    if topic and not any(_m(topic, tn, exact) for tn, _ in _groups()):
        raise NavError(f"no topic matching {topic!r}", [t["topic"] for t in topics()])
    out = []
    for tn, s in _groups():
        if topic and not _m(topic, tn, exact): continue
        if not _m(set_title, s["title"], exact): continue
        pr = _problems_of(s)
        if limit: pr = pr[:limit]
        out.append({"topic": tn, "set": s["title"], "set_id": s["set_id"],
                    "set_url": BASE + s["url"], "n_problems": len(s["problems"]), "problems": pr})
    if not out:
        where = f" within topic {topic!r}" if topic else ""
        cands = sorted({s["title"] for tn, s in _groups()
                        if (not topic or _m(topic, tn, exact)) and _m(set_title[:8], s["title"], False)})
        if not cands:  # right set, wrong topic? look everywhere before giving up
            cands = sorted({s["title"] for _, s in _groups() if _m(set_title, s["title"], False)})
        if not cands:
            cands = sorted({s["title"] for _, s in _groups() if _m(set_title[:6], s["title"], False)})
        raise NavError(f"no set matching {set_title!r}{where}", cands)
    return out

def find(text, limit=20):
    """The site's Search box: matches set titles and problem names."""
    t = text.lower().strip()
    hs = [{"topic": tn, "title": s["title"], "set_id": s["set_id"], "url": BASE + s["url"],
           "n_problems": len(s["problems"])} for tn, s in _groups() if t in s["title"].lower()]
    hp = []
    for tn, s in _groups():
        for p in s["problems"]:
            if t in p["name"].lower():
                hp.append({"topic": tn, "set": s["title"], "number": p["number"], "name": p["name"],
                           "url": p["url"], "platform": platform(p["url"]),
                           "solved_count": p.get("solved_count", 0), "dacu": p.get("dacu", 0)})
    return {"query": text, "n_sets": len(hs), "n_problems": len(hp),
            "sets": hs[:limit], "problems": hp[:limit]}

# ---------------------------------------------------------------- CLI
def _out(obj, as_json, render):
    if as_json: print(json.dumps(obj, ensure_ascii=False, indent=1))
    else: render(obj)

def _r_topics(rows):
    print(f"{'TOPIC':<38}{'SETS':>6}{'PROBLEMS':>10}")
    for r in rows: print(f"{r['topic']:<38}{r['n_sets']:>6}{r['n_problems']:>10}")

def _r_sets(rows):
    print(f"{len(rows)} sets\n")
    for r in rows: print(f"  {r['title']:<62} {r['n_problems']:>3}p  (id={r['set_id']})")
def _r_problems(rows, urls):
    for m in rows:
        print(f"\n{m['topic']}  ›  {m['set']}   ({m['n_problems']} problems)")
        print(f"  {m['set_url']}")
        for p in m["problems"]:
            print(f"   {p['number']:>3}. {p['name'][:58]:<58} {p['platform']:<11} "
                  f"global={p['solved_count']:<7} group={p['dacu']}")
            if urls: print(f"        {p['url']}")

def _r_find(r):
    print(f"{r['n_sets']} matching sets, {r['n_problems']} matching problems\n")
    for s in r["sets"]: print(f"  SET   [{s['topic'][:22]:<22}] {s['title'][:56]} ({s['n_problems']}p)")
    if r["problems"]:
        print()
        for p in r["problems"]:
            print(f"  PROB  [{p['topic'][:22]:<22}] {p['name'][:50]:<50} {p['platform']:<11} {p['url']}")

def main(argv=None):
    # Flags are accepted both before and after the subcommand; SUPPRESS stops the
    # subparser's default from clobbering a value set before it.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help="machine-readable output")
    common.add_argument("--exact", action="store_true", default=argparse.SUPPRESS,
                        help="require exact (not substring) title match")
    common.add_argument("--limit", type=int, default=argparse.SUPPRESS,
                        help="cap problems returned per set")
    common.add_argument("--urls", action="store_true", default=argparse.SUPPRESS,
                        help="include problem URLs in text output")

    ap = argparse.ArgumentParser(
        prog="nav.py", description="Navigate progvar.fun problem sets: topic -> set -> problems.",
        parents=[common],
        epilog="Examples:\n"
               "  nav.py topics\n"
               "  nav.py sets 'Dynamic Programming'\n"
               "  nav.py problems 'DP on Broken Profile'\n"
               "  nav.py problems 'broken profile' --topic Dynamic --urls\n"
               "  nav.py find knapsack --json\n",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("topics", parents=[common], help="list the 8 topics")
    p = sub.add_parser("sets", parents=[common], help="list set titles under a topic")
    p.add_argument("topic")
    p = sub.add_parser("problems", parents=[common], help="list problems of a set")
    p.add_argument("set"); p.add_argument("--topic", help="disambiguate a set name")
    p = sub.add_parser("find", parents=[common], help="search set titles and problem names")
    p.add_argument("text")
    a = ap.parse_args(argv)
    as_json = getattr(a, "json", False)
    limit = getattr(a, "limit", None)
    urls = getattr(a, "urls", False)
    exact = getattr(a, "exact", False)

    try:
        if a.cmd == "topics":
            rows = topics()
            _out(rows, as_json, _r_topics)
        elif a.cmd == "sets":
            rows = sets(a.topic, exact)
            _out({"topic": a.topic, "n_sets": len(rows), "sets": rows}, as_json, lambda o: _r_sets(rows))
        elif a.cmd == "problems":
            rows = problems(a.set, a.topic, exact, limit)
            obj = rows[0] if len(rows) == 1 else {"n_matches": len(rows), "matches": rows}
            _out(obj, as_json, lambda o: _r_problems(rows, urls))
        elif a.cmd == "find":
            r = find(a.text)
            _out(r, as_json, _r_find)
    except NavError as e:
        if as_json:
            print(json.dumps({"error": str(e), "candidates": e.candidates}, indent=1))
        else:
            print(f"no match: {e}", file=sys.stderr)
            for c in e.candidates: print(f"   candidate: {c}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr); return 3
    return 0

if __name__ == "__main__":
    sys.exit(main())
