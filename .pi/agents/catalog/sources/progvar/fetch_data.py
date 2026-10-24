#!/usr/bin/env python3
"""Clone progvar.fun problem-set recommendations into local CSV/JSON."""
import json, csv, os, re, time, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = "https://progvar.fun"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 personal-study-index/1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
CACHE = os.path.join(HERE, ".cache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

TOPICS = {18:"Algorithmic Techniques (except DP)",2:"Data Structures",10:"Dynamic Programming",
          11:"Geometry",12:"Graphs",8:"Implementation",1:"Math",17:"Strings"}
TRACKS = {12:"Preliminaries",1:"Basics",2:"Intermediate",3:"Advanced Data Structures",
          4:"Advanced Algorithms",5:"Advanced Mathematics",15:"4-Problem AtCoder Beginner Contests (Sorted)",
          24:"6-Problem AtCoder Beginner Contests (Sorted)",26:"8-Problem AtCoder Beginner Contests (Sorted)",
          16:"AtCoder Regular Contests (Sorted)",25:"Codeforces Educational Rounds",13:"ADMU ProgVar",
          9:"CS139.3 2018",11:"NOI.PH Training 2018",14:"NOI.PH Training 2019",8:"Experimental",
          18:"ICPC World Finals",20:"NOI.PH Training 2020",21:"ASHS ProgVar",22:"AIEP 2021 Track 1",
          23:"AIEP 2021 Track 2",27:"NOI.PH Training 2022",28:"AP CSCI21 2022",29:"Deprecated",
          30:"NOI.PH Training 2023",31:"AP CSCI 30 / CSCI 201 2023",33:"AP CSCI 21 / Math 71.1 2023",
          34:"NOI.PH Training 2024",35:"ADMU ProgVar Beginner Training 2024-2025",
          36:"ADMU ProgVar Intermediate Training 2024-2025",
          37:"ADMU ProgVar Intermediate Training 2025-2026"}

def get(path, tries=4):
    url = path if path.startswith("http") else BASE + path
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            time.sleep(0.5 * (a + 1))
    return None

def get_list(path, tries=4):
    """GET an encoded list endpoint with pagination."""
    url = BASE + path
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            time.sleep(0.5 * (a + 1))
    return None

# ---------- stage 1: all sets by ID ----------
def fetch_set(i):
    cached = os.path.join(CACHE, f"set_{i}.json")
    if os.path.exists(cached):
        try: return i, json.load(open(cached))
        except Exception: pass
    d = get(f"/api/problemsets/{i}")
    json.dump(d, open(cached, "w"))
    time.sleep(0.05)
    return i, d

print("stage 1: enumerating sets 1..999 ...", flush=True)
with ThreadPoolExecutor(max_workers=4) as ex:
    raw_sets = list(ex.map(fetch_set, range(1, 1000)))
sets = {i: d for i, d in raw_sets if isinstance(d, dict) and d.get("title")}
print(f"  resolved {len(sets)} sets")

# ---------- stage 2: labels ----------
print("stage 2: topic/track label passes ...", flush=True)
listed = set()
for off in range(0, 1000, 50):
    d = get_list(f"/api/problemsets?limit=50&offset={off}")
    if not d or not d.get("results"): break
    for r in d["results"]: listed.add(r["url"])
set_topics, set_track_filter = {}, {}
for tid in TOPICS:
    d = get_list(f"/api/problemsets?topic={tid}&limit=500")
    if d:
        for r in d["results"]:
            set_topics.setdefault(r["url"], set()).add(tid)
print(f"  topic labels for {len(set_topics)} sets")
for tr in TRACKS:
    d = get_list(f"/api/problemsets?track={tr}&limit=500")
    if d:
        for r in d["results"]:
            set_track_filter.setdefault(r["url"], set()).add(tr)

# ---------- stage 3: problems ----------
def fetch_problems(sid):
    cached = os.path.join(CACHE, f"prob_{sid}.json")
    if os.path.exists(cached):
        try: return sid, json.load(open(cached))
        except Exception: pass
    rows, off = [], 0
    while True:
        d = get_list(f"/api/problems?problemset={sid}&limit=500&offset={off}")
        if not d: break
        rows.extend(d.get("results", []))
        if not d.get("next"): break
        off += 500
    json.dump(rows, open(cached, "w"))
    time.sleep(0.05)
    return sid, rows

print(f"stage 3: fetching problems for {len(sets)} sets ...", flush=True)
with ThreadPoolExecutor(max_workers=4) as ex:
    prob_map = dict(ex.map(fetch_problems, sorted(sets)))
probs = {k: (v or []) for k, v in prob_map.items()}

# ---------- stage 4: assemble ----------
HOSTS = {"atcoder.jp":"AtCoder","codeforces.com":"Codeforces","cses.fi":"CSES",
         "onlinejudge.org":"UVa / OnlineJudge","hackerrank.com":"HackerRank",
         "codechef.com":"CodeChef","spoj.com":"SPOJ","e-olymp.com":"e-olymp",
         "acm.timus.ru":"Timus","lightoj.com":"LightOJ"}
def platform(u):
    if not u: return ""
    m = re.match(r"https?://([^/]+)/", u + "/")
    host = (m.group(1) if m else "").lower()
    for h, name in HOSTS.items():
        if host.endswith(h): return name
    return host
def code(s):
    return (s or "").split(" - ")[0].strip()

fetch_date = time.strftime("%Y-%m-%d")

with open(os.path.join(OUT, "sets.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["set_id","title","url","track_id","track_name","topic_ids","topic_names",
                "topic_source","n_problems","in_list_api"])
    for i in sorted(sets):
        d = sets[i]; u = d["url"]
        tids = sorted(set_topics.get(u, []))
        tnames = "; ".join(TOPICS[t] for t in tids)
        w.writerow([i, d["title"], u, d.get("track") or "", TRACKS.get(d.get("track"), ""),
                    ";".join(map(str, tids)), tnames,
                    "api-labelled" if tids else ("none" if u in listed else "not-listed/inferred-unknown"),
                    len(probs.get(i, [])), u in listed])

with open(os.path.join(OUT, "problems.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["set_id","set_title","set_url","track_name","topic_names","number",
                "problem_name","problem_code","platform","problem_url","solved_count","dacu","fetch_date"])
    for i in sorted(sets):
        d = sets[i]; u = d["url"]
        tids = sorted(set_topics.get(u, []))
        tn = "; ".join(TOPICS[t] for t in tids)
        for p in sorted(probs.get(i, []), key=lambda x: (x.get("number") or 0)):
            name = p.get("__str__", "")
            w.writerow([i, d["title"], u, TRACKS.get(d.get("track"), ""), tn, p.get("number",""),
                        name, code(name), platform(p.get("url","")), p.get("url",""),
                        p.get("solved_count", 0), p.get("dacu", 0), fetch_date])

uniq = {}
for i in sorted(sets):
    d = sets[i]; u = d["url"]
    for p in probs.get(i, []):
        k = p.get("url","")
        if not k: continue
        r = uniq.setdefault(k, {"name": p.get("__str__",""), "url": k, "platform": platform(k),
                                "code": code(p.get("__str__","")), "sets": [], "topics": set(),
                                "solved_count": 0, "dacu": 0})
        r["sets"].append(i)
        r["topics"] |= set(TOPICS[t] for t in set_topics.get(u, []))
        r["solved_count"] = max(r["solved_count"], p.get("solved_count", 0) or 0)
        r["dacu"] = max(r["dacu"], p.get("dacu", 0) or 0)

with open(os.path.join(OUT, "problems_unique.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["problem_code","problem_name","platform","problem_url","n_sets","set_ids",
                "topics","best_solved_count","best_dacu","fetch_date"])
    for r in sorted(uniq.values(), key=lambda x: -x["solved_count"]):
        w.writerow([r["code"], r["name"], r["platform"], r["url"], len(r["sets"]),
                    ";".join(map(str, r["sets"])), "; ".join(sorted(r["topics"])),
                    r["solved_count"], r["dacu"], fetch_date])

nested = {"source":"https://progvar.fun","fetched":fetch_date,
          "counts":{"sets":len(sets),"set_problem_rows":sum(len(v) for v in probs.values()),
                    "unique_problems":len(uniq),"sets_in_list_api":len(listed)},
          "topics":TOPICS,"tracks":TRACKS,
          "sets":[{"id":i,"title":sets[i]["title"],"url":sets[i]["url"],
                   "track":sets[i].get("track"),"track_name":TRACKS.get(sets[i].get("track"),""),
                   "topics":[TOPICS[t] for t in sorted(set_topics.get(sets[i]["url"], []))],
                   "in_list_api":sets[i]["url"] in listed,
                   "problems":[{"number":p.get("number"),"name":p.get("__str__"),
                                "code":code(p.get("__str__")),"platform":platform(p.get("url","")),
                                "url":p.get("url"),"solved_count":p.get("solved_count",0),
                                "dacu":p.get("dacu",0)} for p in probs.get(i, [])]}
                  for i in sorted(sets)]}
json.dump(nested, open(os.path.join(OUT, "progvar.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("DONE")
print(json.dumps(nested["counts"], indent=1))
