#!/usr/bin/env python3
"""Build nav.json — progvar.fun's own navigation: topic -> set title -> problems.

Depends only on the raw data files (sets.csv, problems.csv) plus 8 small API calls
that fetch the site's *ordering* of sets within each topic. Writes nav.json.
"""
import csv, json, os, time, urllib.request

BASE = "https://progvar.fun"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 personal-study-index/1.0"
HERE = os.path.dirname(os.path.abspath(__file__))

# (topic_id, topic_name) — exactly the site's Topic dropdown, in its order
TOPICS = [(10, "Dynamic Programming"), (2, "Data Structures"), (1, "Math"), (12, "Graphs"),
          (17, "Strings"), (11, "Geometry"), (8, "Implementation"),
          (18, "Algorithmic Techniques (except DP)")]

def get(path, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            time.sleep(0.5 * (a + 1))
    return None

def main():
    sets = list(csv.DictReader(open(os.path.join(HERE, "sets.csv"), encoding="utf-8")))
    probs = list(csv.DictReader(open(os.path.join(HERE, "problems.csv"), encoding="utf-8")))

    # reachability boundary: only sets the site's listing shows
    reachable = {r["url"]: r for r in sets if r["in_list_api"] == "True"}

    byset = {}
    for p in probs:
        byset.setdefault(int(p["set_id"]), []).append({
            "number": int(p["number"] or 0), "name": p["problem_name"], "url": p["problem_url"],
            "solved_count": int(p["solved_count"] or 0), "dacu": int(p["dacu"] or 0)})
    for v in byset.values():
        v.sort(key=lambda x: x["number"])

    def bundle(rec):
        return {"title": rec["title"], "url": rec["url"], "set_id": int(rec["set_id"]),
                "problems": byset.get(int(rec["set_id"]), [])}

    nav = {"source": "https://progvar.fun", "fetched": time.strftime("%Y-%m-%d"),
           "note": "Only sets reachable by clicking on progvar.fun are included.",
           "topics": [], "unclassified_sets": []}
    seen = set()
    for tid, tname in TOPICS:
        d = get(f"/api/problemsets?topic={tid}&limit=500")
        rows = [r for r in (d or {}).get("results", []) if r["url"] in reachable]
        if not rows:
            print(f"  ! {tname}: API returned nothing (offline?)")
        t = {"topic": tname, "sets": []}
        for r in rows:
            seen.add(r["url"])
            t["sets"].append(bundle(reachable[r["url"]]))
        nav["topics"].append(t)
        print(f"  {tname:<38} {len(t['sets'])} sets")

    nav["unclassified_sets"] = sorted((bundle(reachable[u]) for u in reachable if u not in seen),
                                      key=lambda x: x["title"])

    json.dump(nav, open(os.path.join(HERE, "nav.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    tot = sum(len(s["problems"]) for t in nav["topics"] for s in t["sets"])
    unc = sum(len(s["problems"]) for s in nav["unclassified_sets"])
    print(f"\nnav.json: {len(nav['topics'])} topics, "
          f"{sum(len(t['sets']) for t in nav['topics'])} topic-listings ({tot} problems)")
    print(f"          {len(nav['unclassified_sets'])} sets with no topic ({unc} problems)")
    assert all(s["url"] in reachable for t in nav["topics"] for s in t["sets"])

if __name__ == "__main__":
    main()
