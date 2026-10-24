# progvar.fun problem index

A local mirror of **progvar.fun's own navigation**:

```
topic  →  set title  →  problems (link + solved counts)
```

e.g. `Dynamic Programming` → `DP on Broken Profile` → UVa 10918 Tri Tiling, SPOJ GNY07H, CSES 2181 Counting Tilings, …

Nothing is invented, re-ranked, or inferred. The hierarchy, the ordering, and the set
membership are exactly what the site itself returns.

## Three ways in

### 1. `nav.py` — the script (for agents and for you)

Pure Python 3 stdlib, **no network, no dependencies**. Reads `nav.json` only.
Works as a CLI and as an importable library. Flags are accepted before *or* after the
subcommand, so `nav.py problems X --json` and `nav.py --json problems X` are both fine.

```bash
python3 nav.py topics                                   # the 8 topics + counts
python3 nav.py sets "Dynamic Programming"               # set titles under a topic
python3 nav.py problems "DP on Broken Profile"          # problems in a set
python3 nav.py problems "broken profile" --topic DP --urls
python3 nav.py find knapsack                            # the site's Search box
```

Add `--json` to any command for machine-readable output. Other flags: `--exact`
(strict case-sensitive full-title match instead of substring), `--limit N` (cap problems
per set), `--urls`. Matching several sets is normal — `problems()` returns a list, so
check `len` before indexing.

**Exit codes:** `0` ok · `2` nothing matched (candidates are printed) · `3` `nav.json` missing.

As a library:

```python
import nav
nav.topics()                                  # [{topic, n_sets, n_problems}, ...]
nav.sets("Dynamic Programming")               # [{title, set_id, url, n_problems}, ...]
nav.problems("DP on Broken Profile")          # [{topic, set, set_id, set_url, n_problems, problems:[...]}]
nav.find("knapsack")                          # {query, n_sets, n_problems, sets:[...], problems:[...]}
```

Each problem dict is `{number, name, url, platform, solved_count, dacu}`.
`nav.NavError` is raised on no match and carries a `.candidates` list.

### Search semantics

Default matching is a **case-insensitive, whitespace-trimmed substring** search —
anywhere in the string, not a prefix, not whole-word, not token/AND:

```
'profile'     -> matches 'DP on Broken Profile'       (mid-string)
'acks'        -> matches '...Lists, Stacks, Queues'   (inside a word)
'Broken DP'   -> NO match    (words must be contiguous, in order)
'on'          -> 71 sets     (no minimum length — short queries are useless)
```

No typo tolerance, no stemming, no relevance ranking — matches come back in progvar's
order.

**`--exact` is strict, case-sensitive full-string equality.** Copy titles verbatim from
the output of `topics()` / `sets()` / `problems()`:

```
sets('Dynamic Programming')              -> 23 sets
sets('dynamic programming', exact=True)  -> NavError
```

What each command searches:

| command | searches |
|---|---|
| `sets(topic)` | the 9 **topic names** (not set titles) |
| `problems(title)` | **set titles**, across all topics |
| `find(text)` | **set titles and problem names** ← use when unsure |

The last one matters: `find('knapsack')` returns 5 problems, while
`problems('knapsack')` raises `NavError` — "knapsack" appears in no *set title* among
the 270 reachable sets, only in problem names.

### 2. `navigate.html` — clickable

Double-click it. Left sidebar = the 8 topics; click one for its set titles; click a set
for the problem table (`#`, linked title, Global DACU, Group DACU). Self-contained —
no server, no internet.

### 3. `progvar-index.md` — Obsidian-native

The same hierarchy as a document: topic = `##`, set title = `###`, problems = numbered
links. Collapses natively and Obsidian search covers all 2,296 problem names.

## Scope rule (deliberate)

**Only what the site can reach by clicking is included.** progvar.fun's `/problemsets`
listing returns 270 sets, so those 270 are here and nothing else.

The API can also resolve **382 further sets by direct ID URL** — they appear in no
listing, so you cannot navigate to them, so they are **out of scope** for `nav.py`,
`navigate.html` and `progvar-index.md`. They remain in the raw data files below.

## Files

**Raw data scraped from progvar** — the source of truth, never edited:

| file | contents |
|---|---|
| `sets.csv` | all 652 sets: title, url, track, topics, problem count, reachability |
| `problems.csv` | all 5,766 set↔problem rows |
| `problems_unique.csv` | all 2,957 distinct problems |
| `progvar.json` | all of the above, nested |

**Navigation** (the 270 reachable sets only):

| file | contents |
|---|---|
| `nav.json` | the navigation model: topics → sets → problems |
| `nav.py` | query it (CLI + library) |
| `navigate.html` | browse it |
| `progvar-index.md` | read it in Obsidian |

**Pipeline:**

| file | role |
|---|---|
| `fetch_data.py` | progvar API → the four raw data files (~700 requests) |
| `build_nav.py` | raw data + 8 API calls (topic ordering) → `nav.json` |
| `render_views.py` | `nav.json` → `navigate.html` + `progvar-index.md` |

Rebuild:

```bash
python3 fetch_data.py      # only needed to refresh from the site
python3 build_nav.py
python3 render_views.py
```

`build_nav.py` reads the CSVs, not a cache — the raw data files are enough.
`render_views.py` regenerates the HTML and Markdown, overwriting any edits made inside them.

## Contents

| topic | sets | problems |
|---|---|---|
| Dynamic Programming | 23 | 282 |
| Data Structures | 26 | 301 |
| Math | 30 | 338 |
| Graphs | 22 | 263 |
| Strings | 5 | 46 |
| Geometry | 6 | 61 |
| Implementation | 2 | 25 |
| Algorithmic Techniques (except DP) | 19 | 223 |
| **Not topic-classified on progvar.fun** | 137 | 757 |

1,539 problems sit under a topic. The other 757 belong to 137 sets the site lists but
never assigned a topic to — a clearly-labelled bucket rather than a guess. No set
belongs to two topics, so the buckets don't overlap.

## About "solved / unsolved"

Two counters, the same ones the website's table shows:

- **Global DACU** (`solved_count`) — total solvers. Accurate for Codeforces, CSES, UVa,
  CodeChef, HackerRank, SPOJ. **Always 0 for AtCoder**, which publishes no counts —
  there, 0 means *unknown*, not *unsolved*.
- **Group DACU** (`dacu`) — solvers within progvar.fun's own tracked group. Small
  numbers (median ~28); the only signal available for AtCoder problems.

**Your own solved/unsolved is not in this data** — it needs a logged-in account. The
site's API does expose it given your progvar user id:

```bash
curl "https://progvar.fun/api/problems?problemset=3&user=<YOUR_ID>" | grep -o '"solved":[a-z]*'
```
