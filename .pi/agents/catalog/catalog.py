#!/usr/bin/env python3
"""catalog.py — unified Competitive Programming problem & resource catalog.

Unifies progvar.fun's curated sets and YouKn0wWho's Ultimate Topic List (UTL).

USABLE TWO WAYS:
1. As a CLI:
       python3 catalog.py domains
       python3 catalog.py buckets "Dynamic Programming"
       python3 catalog.py bucket "DP on Broken Profile"
       python3 catalog.py bucket "0-1 BFS" --urls --limit 10
       python3 catalog.py find "knapsack"
       python3 catalog.py problem "Counting Tilings"
       python3 catalog.py resources "Convex Hull Trick"
       # Add --json to any command for machine-readable output

2. As a Python library:
       import catalog
       catalog.domains()
       catalog.buckets("Graphs")
       catalog.bucket("0-1 BFS")
       catalog.find("knapsack")
       catalog.resources("2-SAT")
"""
import argparse, json, os, re, sys

# Reconfigure stdout/stderr to utf-8 if supported (handles Windows cp1252 console gracefully)
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_JSON = os.path.join(HERE, "catalog.json")

class CatalogError(Exception):
    def __init__(self, msg, candidates=()):
        super().__init__(msg)
        self.candidates = list(candidates)

_DATA = None
def data():
    global _DATA
    if _DATA is None:
        if not os.path.exists(CATALOG_JSON):
            raise FileNotFoundError(f"{CATALOG_JSON} missing — run: python3 build_catalog.py")
        with open(CATALOG_JSON, encoding="utf-8") as f:
            _DATA = json.load(f)
    return _DATA

def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def _matches_query(query, target):
    q = _norm(query)
    t = _norm(target)
    if not q: return True
    if q in t: return True
    tokens = q.split()
    return all(tok in t for tok in tokens)

# ---------------------------------------------------------------- Library API

def domains():
    d = data()
    out = []
    for dom in d["domains"]:
        buckets = [b for b in d["buckets"] if b["domain"] == dom]
        n_probs = sum(len(b["problems"]) for b in buckets)
        n_res = sum(len(b["resources"]) for b in buckets)
        out.append({
            "domain": dom,
            "n_buckets": len(buckets),
            "n_problems": n_probs,
            "n_resources": n_res
        })
    return out

def buckets(domain=None, bucket_type=None):
    d = data()
    res = []
    dom_norm = _norm(domain) if domain else None
    for b in d["buckets"]:
        if dom_norm and not _matches_query(dom_norm, b["domain"]):
            continue
        if bucket_type and b["type"] != bucket_type:
            continue
        res.append({
            "bucket_id": b["bucket_id"],
            "title": b["title"],
            "domain": b["domain"],
            "type": b["type"],
            "n_problems": len(b["problems"]),
            "n_resources": len(b["resources"]),
            "n_templates": len(b["templates"]),
            "absorbed_count": len(b["absorbed_topics"])
        })
    if domain and not res:
        cands = [dm["domain"] for dm in domains()]
        raise CatalogError(f"no domain matching {domain!r}", cands)
    return res

def _find_bucket(name_or_id):
    d = data()
    q = _norm(name_or_id)
    # 1. Exact bucket_id match
    for b in d["buckets"]:
        if b["bucket_id"].lower() == q:
            return b
    # 2. Exact title match
    for b in d["buckets"]:
        if _norm(b["title"]) == q:
            return b
    # 3. Substring / token match in bucket title
    matches = [b for b in d["buckets"] if _matches_query(q, b["title"])]
    if matches:
        return matches[0]
    # 4. Check absorbed topics
    for b in d["buckets"]:
        for a in b["absorbed_topics"]:
            if _matches_query(q, a["title"]) or _matches_query(q, a["topic_id"]):
                return b
    cands = [b["title"] for b in d["buckets"] if any(t in _norm(b["title"]) for t in q.split()[:2])][:10]
    raise CatalogError(f"no bucket matching {name_or_id!r}", cands)

def bucket(name_or_id, source=None, starred_only=False, exclude=None, limit=None):
    b = _find_bucket(name_or_id)
    probs = list(b["problems"])

    # Exclusions
    if exclude:
        exc_set = {_norm(x) for x in exclude if x}
        probs = [p for p in probs if _norm(p["name"]) not in exc_set and _norm(p["url"]) not in exc_set]

    # Source filter
    if source == "pv":
        probs = [p for p in probs if "pv" in p["source"]]
    elif source == "utl":
        probs = [p for p in probs if "utl" in p["source"]]

    # Starred filter
    if starred_only:
        probs = [p for p in probs if p.get("is_starred", False)]

    if limit:
        probs = probs[:limit]

    return {
        "bucket_id": b["bucket_id"],
        "title": b["title"],
        "domain": b["domain"],
        "type": b["type"],
        "n_total_problems": len(b["problems"]),
        "n_returned_problems": len(probs),
        "problems": probs,
        "absorbed_topics": b["absorbed_topics"],
        "n_resources": len(b["resources"]),
        "n_templates": len(b["templates"])
    }

def find(text, limit=25, source=None, starred_only=False, exclude=None):
    d = data()
    q = _norm(text)
    if not q:
        return {"query": text, "matching_buckets": [], "matching_problems": []}

    exc_set = {_norm(x) for x in exclude if x} if exclude else set()

    hit_buckets = []
    for b in d["buckets"]:
        if _matches_query(q, b["title"]) or any(_matches_query(q, a["title"]) for a in b["absorbed_topics"]):
            hit_buckets.append({
                "bucket_id": b["bucket_id"],
                "title": b["title"],
                "domain": b["domain"],
                "type": b["type"],
                "n_problems": len(b["problems"])
            })

    hit_probs = []
    seen_urls = set()
    for b in d["buckets"]:
        for p in b["problems"]:
            p_url = p.get("url", "")
            if p_url in seen_urls: continue
            if _norm(p["name"]) in exc_set or _norm(p_url) in exc_set: continue
            if source == "pv" and "pv" not in p["source"]: continue
            if source == "utl" and "utl" not in p["source"]: continue
            if starred_only and not p.get("is_starred", False): continue

            if _matches_query(q, p["name"]):
                seen_urls.add(p_url)
                hit_probs.append({
                    "name": p["name"],
                    "url": p_url,
                    "platform": p["platform"],
                    "source": p["source"],
                    "is_starred": p.get("is_starred", False),
                    "bucket": b["title"],
                    "domain": b["domain"],
                    "solved_count": p.get("solved_count", 0),
                    "dacu": p.get("dacu", 0)
                })

    return {
        "query": text,
        "n_buckets": len(hit_buckets),
        "n_problems": len(hit_probs),
        "buckets": hit_buckets[:limit],
        "problems": hit_probs[:limit]
    }

def problem(name_or_url):
    d = data()
    q = _norm(name_or_url)
    occurrences = []
    target_prob = None

    for b in d["buckets"]:
        for p in b["problems"]:
            if _norm(p["name"]) == q or _norm(p.get("url", "")) == q or q in _norm(p["name"]):
                if not target_prob:
                    target_prob = p
                occurrences.append({
                    "bucket_id": b["bucket_id"],
                    "bucket_title": b["title"],
                    "domain": b["domain"],
                    "type": b["type"],
                    "origin": p.get("origin", "")
                })

    if not target_prob:
        cands = []
        for b in d["buckets"]:
            for p in b["problems"]:
                if any(tok in _norm(p["name"]) for tok in q.split()[:2]):
                    cands.append(p["name"])
                    if len(cands) >= 8: break
            if len(cands) >= 8: break
        raise CatalogError(f"no problem matching {name_or_url!r}", cands)

    return {
        "name": target_prob["name"],
        "url": target_prob["url"],
        "platform": target_prob["platform"],
        "source": target_prob["source"],
        "is_starred": target_prob.get("is_starred", False),
        "solved_count": target_prob.get("solved_count", 0),
        "dacu": target_prob.get("dacu", 0),
        "occurrences": occurrences
    }

def resources(bucket_or_topic, limit=15):
    d = data()
    q = _norm(bucket_or_topic)
    res_list = []
    tmpl_list = []
    matched_bucket = None

    # Check bucket
    for b in d["buckets"]:
        if _matches_query(q, b["title"]) or b["bucket_id"].lower() == q or any(_matches_query(q, a["title"]) for a in b["absorbed_topics"]):
            matched_bucket = b
            res_list.extend(b["resources"])
            tmpl_list.extend(b["templates"])
            break

    # If no bucket hit, check specific topic_id / title in resources
    if not res_list:
        for b in d["buckets"]:
            for r in b["resources"]:
                if _matches_query(q, r["topic_title"]) or _matches_query(q, r["topic_id"]):
                    res_list.append(r)
            for t in b["templates"]:
                if _matches_query(q, t["topic_title"]) or _matches_query(q, t["topic_id"]):
                    tmpl_list.append(t)

    if not res_list and not tmpl_list:
        cands = [b["title"] for b in d["buckets"] if b["resources"]][:8]
        raise CatalogError(f"no resources matching {bucket_or_topic!r}", cands)

    # Deduplicate and sort: starred first
    seen_urls = set()
    dedup_res = []
    for r in res_list:
        if r["url"] not in seen_urls:
            seen_urls.add(r["url"])
            dedup_res.append(r)
    dedup_res.sort(key=lambda x: not x.get("is_starred", False))

    seen_tmpl = set()
    dedup_tmpl = []
    for t in tmpl_list:
        if t["url"] not in seen_tmpl:
            seen_tmpl.add(t["url"])
            dedup_tmpl.append(t)

    return {
        "query": bucket_or_topic,
        "bucket": matched_bucket["title"] if matched_bucket else "Various",
        "n_resources": len(dedup_res),
        "n_templates": len(dedup_tmpl),
        "resources": dedup_res[:limit],
        "templates": dedup_tmpl[:limit]
    }

# ---------------------------------------------------------------- CLI Renderers

def _r_domains(rows):
    print(f"{'DOMAIN':<38} {'BUCKETS':>8} {'PROBLEMS':>10} {'TUTORIALS':>10}")
    print("-" * 70)
    for r in rows:
        print(f"{r['domain']:<38} {r['n_buckets']:>8} {r['n_problems']:>10} {r['n_resources']:>10}")

def _r_buckets(rows):
    print(f"{len(rows)} matching buckets:\n")
    for r in rows:
        b_type = "pv" if r["type"] == "progvar_concept" else ("contest" if r["type"] == "contest" else "utl")
        print(f"  [{b_type:<7}] {r['title'][:54]:<54} {r['n_problems']:>4}p  {r['n_resources']:>3}res  ({r['domain']})")

def _r_bucket(b, show_urls):
    b_type = "Progvar Concept" if b["type"] == "progvar_concept" else ("Contest" if b["type"] == "contest" else "UTL Standalone")
    print(f"\n{b['domain']}  ›  {b['title']}  [{b_type}]")
    print(f"Total problems: {b['n_total_problems']}  |  Tutorials: {b['n_resources']}  |  Templates: {b['n_templates']}")
    if b["absorbed_topics"]:
        abs_str = ", ".join(a["title"] for a in b["absorbed_topics"][:4])
        if len(b["absorbed_topics"]) > 4: abs_str += f" (+{len(b['absorbed_topics'])-4} more)"
        print(f"Absorbed topics: {abs_str}")
    print()

    for p in b["problems"]:
        star = "★" if p["is_starred"] else " "
        solves = f"dacu={p['dacu']}" if p["dacu"] else f"solves={p['solved_count']}"
        print(f"  {star} {p['number']:>3}. {p['source']:<9} {p['name'][:52]:<52} {p['platform']:<12} {solves}")
        if show_urls:
            print(f"        {p['url']}")

def _r_find(r):
    print(f"Query: {r['query']!r} -> {r['n_buckets']} matching buckets, {r['n_problems']} matching problems\n")
    if r["buckets"]:
        print("BUCKETS:")
        for b in r["buckets"]:
            print(f"  [{b['domain'][:18]:<18}] {b['title'][:50]:<50} ({b['n_problems']}p)")
        print()
    if r["problems"]:
        print("PROBLEMS:")
        for p in r["problems"]:
            star = "★" if p["is_starred"] else " "
            print(f"  {star} {p['source']:<9} {p['name'][:46]:<46} {p['platform']:<11} in [{p['bucket'][:24]}]")
            print(f"        {p['url']}")

def _r_problem(p):
    star = " ★" if p["is_starred"] else ""
    print(f"\nProblem: {p['name']}{star}")
    print(f"Platform: {p['platform']}  |  Source: {p['source']}")
    print(f"Solvers: DACU={p['dacu']}  Global={p['solved_count']}")
    print(f"URL: {p['url']}")
    print("\nAppears in:")
    for oc in p["occurrences"]:
        print(f"  - [{oc['domain']}] {oc['bucket_title']} ({oc['type']})")

def _r_resources(r):
    print(f"\nCurated Learning Resources for: {r['query']} ({r['bucket']})")
    print(f"Tutorials: {r['n_resources']}  |  Code Templates: {r['n_templates']}\n")
    if r["resources"]:
        print("READING MATERIAL / TUTORIALS:")
        for res in r["resources"]:
            star = "★ " if res["is_starred"] else "  "
            vid = " [VIDEO]" if res["is_video"] else ""
            print(f"  {star}{res['title']}{vid}")
            if res.get("comment"):
                print(f"      Note: {res['comment']}")
            print(f"      Link: {res['url']}")
    if r["templates"]:
        print("\nCODE TEMPLATES:")
        for t in r["templates"]:
            tname = t["url"].split("/")[-1].replace("%20", " ")
            print(f"  - {tname}")
            print(f"      {t['url']}")

# ---------------------------------------------------------------- Main CLI

def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="catalog.py",
        description="Unified CP Curriculum Problem & Resource Catalog (progvar.fun + Ultimate Topic List)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="output machine-readable JSON")
    
    sub = ap.add_subparsers(dest="cmd", required=True)

    # domains
    sub.add_parser("domains", parents=[common], help="list all high-level curriculum domains")

    # buckets
    p_bks = sub.add_parser("buckets", parents=[common], help="list buckets under a domain")
    p_bks.add_argument("domain", nargs="?", help="filter by domain (e.g. Graphs, Dynamic Programming)")
    p_bks.add_argument("--type", choices=["progvar_concept", "standalone_utl", "contest"], help="filter by bucket type")

    # bucket
    p_bk = sub.add_parser("bucket", parents=[common], help="list problems & resources in a bucket")
    p_bk.add_argument("name", help="bucket name or id (e.g. '0-1 BFS', 'Convex Hull Trick')")
    p_bk.add_argument("--source", choices=["pv", "utl", "all"], default="all", help="filter problems by source")
    p_bk.add_argument("--starred", action="store_true", help="show only curator-starred problems")
    p_bk.add_argument("--exclude", help="comma-separated list of problem names or URLs to exclude")
    p_bk.add_argument("--limit", type=int, help="cap number of problems returned")
    p_bk.add_argument("--urls", action="store_true", help="include direct URLs in text output")

    # find
    p_f = sub.add_parser("find", parents=[common], help="search buckets and problems across both catalogs")
    p_f.add_argument("text", help="search keyword")
    p_f.add_argument("--source", choices=["pv", "utl", "all"], default="all", help="filter by source")
    p_f.add_argument("--starred", action="store_true", help="show only curator-starred problems")
    p_f.add_argument("--exclude", help="comma-separated list of problem names or URLs to exclude")
    p_f.add_argument("--limit", type=int, default=20, help="max results")

    # problem
    p_p = sub.add_parser("problem", parents=[common], help="inspect a specific problem by name or URL")
    p_p.add_argument("name_or_url", help="problem title or URL")

    # resources
    p_r = sub.add_parser("resources", parents=[common], help="fetch tutorial primers and code templates for a concept")
    p_r.add_argument("concept", help="bucket title or topic name (e.g. 'Convex Hull Trick', '2-SAT')")
    p_r.add_argument("--limit", type=int, default=10, help="max resources to return")

    args = ap.parse_args(argv)

    def parse_exclude(val):
        if not val: return None
        return [x.strip() for x in val.split(",") if x.strip()]

    try:
        if args.cmd == "domains":
            res = domains()
            if args.json: print(json.dumps(res, indent=2))
            else: _r_domains(res)

        elif args.cmd == "buckets":
            res = buckets(args.domain, args.type)
            if args.json: print(json.dumps(res, indent=2))
            else: _r_buckets(res)

        elif args.cmd == "bucket":
            exc = parse_exclude(args.exclude)
            res = bucket(args.name, args.source, args.starred, exc, args.limit)
            if args.json: print(json.dumps(res, indent=2))
            else: _r_bucket(res, args.urls)

        elif args.cmd == "find":
            exc = parse_exclude(args.exclude)
            res = find(args.text, args.limit, args.source, args.starred, exc)
            if args.json: print(json.dumps(res, indent=2))
            else: _r_find(res)

        elif args.cmd == "problem":
            res = problem(args.name_or_url)
            if args.json: print(json.dumps(res, indent=2))
            else: _r_problem(res)

        elif args.cmd == "resources":
            res = resources(args.concept, args.limit)
            if args.json: print(json.dumps(res, indent=2))
            else: _r_resources(res)

    except CatalogError as e:
        if args.json:
            print(json.dumps({"error": str(e), "candidates": e.candidates}, indent=2))
        else:
            print(f"Error: {e}", file=sys.stderr)
            if e.candidates:
                print("Did you mean:", file=sys.stderr)
                for c in e.candidates:
                    print(f"  - {c}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 3

    return 0

if __name__ == "__main__":
    sys.exit(main())
