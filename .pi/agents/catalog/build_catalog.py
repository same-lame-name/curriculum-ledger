#!/usr/bin/env python3
"""build_catalog.py — builds unified catalog.json, CSV stores, and HTML/MD views.

Merges:
1. progvar.fun problem sets (sources/progvar/nav.json & sets.csv)
2. Ultimate Topic List (sources/utl via utl_load.py)
3. Topic mapping (utl_to_progvar.csv)
4. Pre-baked CF-scale problem difficulties (sources/official_ratings.json + catalog tier calibration)

Outputs:
- catalog.json
- catalog_buckets.csv
- catalog_problems.csv
- catalog_resources.csv
- inventory.html
- inventory.md
"""
import csv, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_PV = os.path.join(HERE, "sources", "progvar")
ROOT_UTL = os.path.join(HERE, "sources", "utl")
OFFICIAL_RATINGS_PATH = os.path.join(HERE, "sources", "official_ratings.json")

sys.path.insert(0, ROOT_UTL)
import utl_load

HOSTS = {
    "atcoder.jp": "AtCoder", "codeforces.com": "Codeforces", "cses.fi": "CSES",
    "onlinejudge.org": "UVa", "hackerrank.com": "HackerRank", "codechef.com": "CodeChef",
    "spoj.com": "SPOJ", "acm.timus.ru": "Timus", "lightoj.com": "LightOJ",
    "yosupo.jp": "Library Checker", "kattis.com": "Kattis", "toph.co": "Toph",
    "usaco.org": "USACO", "dmoj.ca": "DMOJ", "csacademy.com": "CSAcademy",
    "leetcode.com": "LeetCode", "acmicpc.net": "Baekjoon", "poj.org": "POJ",
    "hdu.edu.cn": "HDU", "hackerearth.com": "HackerEarth", "u-aizu.ac.jp": "Aizu",
    "szkopul.edu.pl": "Szkopul", "loj.ac": "LOJ", "zerojudge.tw": "ZeroJudge",
    "yukicoder.me": "Yukicoder", "vjudge.net": "VJudge"
}

CF_URL_RE = re.compile(
    r"codeforces\.com/(?:problemset/problem/|contest/|gym/)(\d+)/problem/([A-Za-z0-9]+)"
    r"|codeforces\.com/problemset/problem/(\d+)/([A-Za-z0-9]+)",
    re.I,
)
AC_URL_RE = re.compile(r"atcoder\.jp/contests/[^/]+/tasks/([A-Za-z0-9_]+)", re.I)
CSES_URL_RE = re.compile(r"cses\.fi/problemset/task/(\d+)", re.I)
SPOJ_URL_RE = re.compile(r"spoj\.com/problems/([A-Za-z0-9_]+)", re.I)
CODECHEF_URL_RE = re.compile(r"codechef\.com/(?:[^/]+/)?problems/([A-Za-z0-9_]+)", re.I)
KATTIS_URL_RE = re.compile(r"kattis\.com/problems/([A-Za-z0-9_-]+)", re.I)
LEETCODE_URL_RE = re.compile(r"leetcode\.com/problems/([A-Za-z0-9_-]+)", re.I)
USACO_URL_RE = re.compile(r"cp_id=(\d+)", re.I)

# Progvar track_id -> baseline CF-equivalent difficulty
PV_TRACK_BASE = {
    1: 950,    # Basics
    2: 1350,   # Intermediate
    3: 1700,   # Advanced Data Structures
    4: 1850,   # Advanced Algorithms
    5: 1950,   # Advanced Mathematics
    8: 1600,   # Experimental
    12: 900,   # Preliminaries
    15: 1050,  # 4-Problem ABC
    16: 1650,  # ARC
    18: 2200,  # ICPC World Finals
    24: 1200,  # 6-Problem ABC
    25: 1500,  # CF Educational Rounds
    26: 1300,  # 8-Problem ABC
    35: 1050,  # Beginner Training
    36: 1450,  # Intermediate Training
    37: 1450,  # Intermediate Training
}

# UTL topic difficulty (0..4) -> baseline CF-equivalent difficulty
UTL_TOPIC_BASE = {
    0: 850,    # Basics
    1: 1150,   # Easy
    2: 1550,   # Medium
    3: 1900,   # Hard
    4: 2300,   # Advanced
}

# UTL problem difficulty (1..4) -> offset from topic baseline
UTL_PROB_OFFSET = {
    1: -150,
    2: 0,
    3: 150,
    4: 300,
}


def norm_url(url):
    u = (url or "").strip().lower()
    u = re.sub(r"^https?://(www\.)?", "", u)
    u = re.sub(r"/+$", "", u)
    return u


def detect_platform(url):
    m = re.match(r"https?://([^/]+)/", (url or "") + "/")
    host = (m.group(1) if m else "").lower()
    for h, n in HOSTS.items():
        if host.endswith(h):
            return n
    return host or "Other"


def derive_problem_id(url, name, utl_pid=None):
    """Derive a clean, deterministic, C++-filename-safe problem ID stem."""
    u = url or ""
    m = CF_URL_RE.search(u)
    if m:
        cid = m.group(1) or m.group(3)
        idx = (m.group(2) or m.group(4)).upper()
        return f"cf_{cid}{idx}"
    m = AC_URL_RE.search(u)
    if m:
        return m.group(1).lower()
    m = CSES_URL_RE.search(u)
    if m:
        return f"cses_{m.group(1)}"
    m = SPOJ_URL_RE.search(u)
    if m:
        return f"spoj_{m.group(1).lower()}"
    m = CODECHEF_URL_RE.search(u)
    if m:
        return f"cc_{m.group(1).lower()}"
    m = KATTIS_URL_RE.search(u)
    if m:
        return f"kattis_{m.group(1).lower().replace('-', '_')}"
    m = LEETCODE_URL_RE.search(u)
    if m:
        return f"lc_{m.group(1).lower().replace('-', '_')}"
    m = USACO_URL_RE.search(u)
    if m:
        return f"usaco_{m.group(1)}"
    if utl_pid:
        clean = re.sub(r"[^a-zA-Z0-9_]", "_", str(utl_pid)).strip("_").lower()
        if clean:
            return clean
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", (name or "prob").lower()).strip("_")
    return slug[:32] or "prob"


def round50(val):
    return int(max(800, min(3200, round(val / 50.0) * 50)))


def main():
    print("Loading progvar data...")
    nav = json.load(open(os.path.join(ROOT_PV, "nav.json"), encoding="utf-8"))

    pv_set_tracks = {}
    sets_csv_path = os.path.join(ROOT_PV, "sets.csv")
    if os.path.exists(sets_csv_path):
        with open(sets_csv_path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                try:
                    sid = int(r["set_id"])
                    tid = int(r["track_id"]) if r.get("track_id") else 2
                    pv_set_tracks[sid] = tid
                except Exception:
                    pass

    print("Loading official CF/AC ratings...")
    official_cf = {}
    official_ac = {}
    if os.path.exists(OFFICIAL_RATINGS_PATH):
        off = json.load(open(OFFICIAL_RATINGS_PATH, encoding="utf-8"))
        official_cf = off.get("cf", {})
        official_ac = off.get("ac", {})

    print("Loading UTL data...")
    utl = utl_load.load_all(ROOT_UTL)
    utl_info = utl["topicInfo"]
    utl_problems = utl["topicListProblems"]

    # Map UTL topic_id -> topic difficulty (0..4)
    utl_topic_diff = {}
    for cat in utl.get("topicList", []):
        for sub in cat.get("sub_categories", []):
            for t in sub.get("topics", []):
                utl_topic_diff[t["topic_id"]] = int(t.get("difficulty") or 0)

    print("Loading mapping CSV...")
    mapping_path = os.path.join(HERE, "utl_to_progvar.csv")
    with open(mapping_path, encoding="utf-8-sig") as f:
        mapping_rows = list(csv.DictReader(f))
    mapping = {r["utl_topic_id"]: r for r in mapping_rows}

    # Index all UTL problems by topic
    topic_to_utl_pids = defaultdict(list)
    for tid, info in utl_info.items():
        for pid in info.get("problem_order", []):
            if pid not in topic_to_utl_pids[tid]:
                topic_to_utl_pids[tid].append(pid)
    for pid, prob in utl_problems.items():
        for tid in prob.get("topics", []):
            if pid not in topic_to_utl_pids[tid]:
                topic_to_utl_pids[tid].append(pid)

    # URL sets for cross-referencing [pv] and [utl]
    pv_url_to_probs = defaultdict(list)
    CONTEST_RE = re.compile(r"^(ABC|ARC|AGC)\d+|ICPC World Finals|Educational Codeforces Round")

    all_pv_sets = []
    for t in nav["topics"]:
        for s in t["sets"]:
            all_pv_sets.append((t["topic"], s, False))
    for s in nav.get("unclassified_sets", []):
        is_contest = bool(CONTEST_RE.search(s["title"]))
        dom = "Contest Sets" if is_contest else (
            "Implementation" if s["set_id"] == 253 else "Algorithmic Techniques (except DP)"
        )
        all_pv_sets.append((dom, s, is_contest))

    for dom, s, is_contest in all_pv_sets:
        for p in s["problems"]:
            nu = norm_url(p["url"])
            if nu:
                pv_url_to_probs[nu].append((s["set_id"], p))

    utl_url_to_probs = defaultdict(list)
    for pid, p in utl_problems.items():
        nu = norm_url(p.get("problem_url", ""))
        if nu:
            utl_url_to_probs[nu].append((pid, p))

    def compute_problem_difficulty(p_url, pv_set_id=None, pv_idx=0, pv_total=1, utl_prob=None, utl_tid=None):
        """Return (difficulty_int, difficulty_source_str)."""
        u = p_url or ""
        # 1. Official Codeforces rating
        m_cf = CF_URL_RE.search(u)
        if m_cf:
            cid = m_cf.group(1) or m_cf.group(3)
            idx = (m_cf.group(2) or m_cf.group(4)).upper()
            code = f"{cid}{idx}"
            if code in official_cf:
                return int(official_cf[code]), "cf_official"

        # 2. Converted AtCoder IRT difficulty
        m_ac = AC_URL_RE.search(u)
        if m_ac:
            task_id = m_ac.group(1).lower()
            if task_id in official_ac:
                return int(official_ac[task_id]), "ac_converted"
            if re.match(r"^abc\d+_a$", task_id):
                return 800, "ac_converted"
            if re.match(r"^abc\d+_b$", task_id):
                return 850, "ac_converted"
            if re.match(r"^abc\d+_c$", task_id):
                return 1000, "ac_converted"

        # 3. Deterministic Catalog Tier calibration (UTL + Progvar)
        nu = norm_url(u)
        if utl_prob is None and nu in utl_url_to_probs:
            utl_prob = utl_url_to_probs[nu][0][1]
            if not utl_tid:
                tlist = utl_prob.get("topics") or []
                if tlist:
                    utl_tid = tlist[0]

        est_list = []

        if utl_prob is not None:
            raw_pdiff = utl_prob.get("difficulty")
            try:
                pdiff_int = int(raw_pdiff) if raw_pdiff is not None else 2
            except Exception:
                pdiff_int = 2
            if pdiff_int >= 800:
                est_list.append(pdiff_int)
            else:
                tdiff = utl_topic_diff.get(utl_tid, 1) if utl_tid else 1
                base = UTL_TOPIC_BASE.get(tdiff, 1300)
                offset = UTL_PROB_OFFSET.get(pdiff_int, 0)
                est_list.append(base + offset)

        if pv_set_id is not None:
            track_id = pv_set_tracks.get(pv_set_id, 2)
            base = PV_TRACK_BASE.get(track_id, 1350)
            frac = (pv_idx / max(1, pv_total - 1)) if pv_total > 1 else 0.3
            est_list.append(base + int(round(frac * 300)))

        if est_list:
            avg_est = sum(est_list) / len(est_list)
            return round50(avg_est), "catalog_tier"

        return 1300, "catalog_tier"

    print(f"Total unique Progvar URLs: {len(pv_url_to_probs)}")
    print(f"Total unique UTL URLs: {len(utl_url_to_probs)}")
    shared_urls = set(pv_url_to_probs.keys()) & set(utl_url_to_probs.keys())
    print(f"Shared URLs across sources: {len(shared_urls)}")

    canonical_domains = [
        "Dynamic Programming", "Data Structures", "Math", "Graphs",
        "Strings", "Geometry", "Implementation", "Algorithmic Techniques (except DP)",
        "Contest Sets"
    ]
    catalog = {
        "domains": canonical_domains,
        "buckets": [],
        "stats": {
            "total_buckets": 0,
            "progvar_concept_buckets": 0,
            "standalone_utl_buckets": 0,
            "contest_buckets": 0,
            "total_problems": 0,
            "unique_problems": 0,
            "shared_problems": len(shared_urls),
            "total_resources": 0,
            "total_templates": 0,
            "difficulty_sources": {"cf_official": 0, "ac_converted": 0, "catalog_tier": 0}
        }
    }

    absorbed_by_set = defaultdict(list)
    standalone_utl = []
    dropped_count = 0

    for tid, m in mapping.items():
        dec = m["decision"]
        if dec == "drop":
            dropped_count += 1
            continue
        elif dec == "absorb":
            absorbed_by_set[int(m["home_set_id"])].append(m)
        elif dec == "standalone":
            standalone_utl.append(m)

    print(f"Absorbed UTL groups: {len(absorbed_by_set)} sets")
    print(f"Standalone UTL topics: {len(standalone_utl)}")
    print(f"Dropped UTL topics: {dropped_count}")

    seen_problem_urls = set()
    diff_source_counts = defaultdict(int)

    # 1. Build Progvar Buckets (Concept + Contest)
    for dom, s, is_contest in all_pv_sets:
        sid = s["set_id"]
        title = s["title"]
        url = "https://progvar.fun" + s["url"]

        b_type = "contest" if is_contest else "progvar_concept"
        bucket = {
            "bucket_id": f"pv_{sid}",
            "title": title,
            "domain": dom,
            "type": b_type,
            "progvar_set_id": sid,
            "progvar_url": url,
            "problems": [],
            "absorbed_topics": [],
            "resources": [],
            "templates": []
        }

        pv_probs = s["problems"]
        n_pv = len(pv_probs)
        for idx_p, p in enumerate(pv_probs):
            p_url = p.get("url", "")
            nu = norm_url(p_url)
            if nu:
                seen_problem_urls.add(nu)
            is_in_utl = nu in utl_url_to_probs
            source_tag = "[pv+utl]" if is_in_utl else "[pv]"

            is_starred = False
            utl_pid_hint = None
            utl_prob_obj = None
            if is_in_utl:
                is_starred = any(up[1].get("is_starred", False) for up in utl_url_to_probs[nu])
                utl_pid_hint, utl_prob_obj = utl_url_to_probs[nu][0]

            diff_val, diff_src = compute_problem_difficulty(
                p_url, pv_set_id=sid, pv_idx=idx_p, pv_total=n_pv, utl_prob=utl_prob_obj
            )
            diff_source_counts[diff_src] += 1
            prob_id = derive_problem_id(p_url, p["name"], utl_pid=utl_pid_hint)

            bucket["problems"].append({
                "id": prob_id,
                "name": p["name"],
                "number": p["number"],
                "url": p_url,
                "platform": detect_platform(p_url),
                "difficulty": diff_val,
                "difficulty_source": diff_src,
                "source": source_tag,
                "is_starred": is_starred,
                "solved_count": p.get("solved_count", 0),
                "dacu": p.get("dacu", 0),
                "origin": "progvar"
            })

        absorbed = absorbed_by_set.get(sid, [])
        for m in absorbed:
            tid = m["utl_topic_id"]
            ttitle = m["utl_title"]
            bucket["absorbed_topics"].append({
                "topic_id": tid,
                "title": ttitle,
                "n_problems": int(m["n_problems"]),
                "n_reading": int(m["n_reading"])
            })

            info = utl_info.get(tid, {})
            for r in info.get("resources", []):
                bucket["resources"].append({
                    "topic_id": tid,
                    "topic_title": ttitle,
                    "title": r.get("resource_title", ""),
                    "url": r.get("resource_url", ""),
                    "is_starred": r.get("is_starred", False),
                    "is_video": r.get("is_video_type", False),
                    "comment": r.get("resource_comments", "")
                })
            for tmpl in info.get("template_codes", []):
                bucket["templates"].append({
                    "topic_id": tid,
                    "topic_title": ttitle,
                    "url": tmpl
                })

            existing_urls = {norm_url(p["url"]) for p in bucket["problems"]}
            utl_pids = topic_to_utl_pids.get(tid, [])

            candidate_probs = [(pid, utl_problems[pid]) for pid in utl_pids if pid in utl_problems]
            candidate_probs.sort(key=lambda x: (not x[1].get("is_starred", False), -x[1].get("solve_count", 0)))

            for up_pid, up in candidate_probs:
                up_url = up.get("problem_url", "")
                nu = norm_url(up_url)
                if not nu or nu in existing_urls:
                    continue
                seen_problem_urls.add(nu)
                is_in_pv = nu in pv_url_to_probs
                source_tag = "[pv+utl]" if is_in_pv else "[utl]"

                diff_val, diff_src = compute_problem_difficulty(
                    up_url, pv_set_id=sid, utl_prob=up, utl_tid=tid
                )
                diff_source_counts[diff_src] += 1
                prob_id = derive_problem_id(up_url, up.get("problem_title", ""), utl_pid=up_pid)

                bucket["problems"].append({
                    "id": prob_id,
                    "name": up.get("problem_title", ""),
                    "number": len(bucket["problems"]) + 1,
                    "url": up_url,
                    "platform": detect_platform(up_url),
                    "difficulty": diff_val,
                    "difficulty_source": diff_src,
                    "source": source_tag,
                    "is_starred": up.get("is_starred", False),
                    "solved_count": up.get("solve_count", 0),
                    "dacu": 0,
                    "origin": f"utl:{tid}"
                })
                existing_urls.add(nu)

        catalog["buckets"].append(bucket)

    # 2. Build Standalone UTL Buckets
    for m in standalone_utl:
        tid = m["utl_topic_id"]
        title = m["utl_title"]
        dom = m["domain"]
        kind = m["kind"]
        info = utl_info.get(tid, {})

        bucket = {
            "bucket_id": f"utl_{tid}",
            "title": title,
            "domain": dom,
            "type": "standalone_utl",
            "kind": kind,
            "utl_topic_id": tid,
            "utl_category": m["utl_category"],
            "utl_subcategory": m["utl_subcategory"],
            "problems": [],
            "absorbed_topics": [],
            "resources": [],
            "templates": []
        }

        for r in info.get("resources", []):
            bucket["resources"].append({
                "topic_id": tid,
                "topic_title": title,
                "title": r.get("resource_title", ""),
                "url": r.get("resource_url", ""),
                "is_starred": r.get("is_starred", False),
                "is_video": r.get("is_video_type", False),
                "comment": r.get("resource_comments", "")
            })
        for tmpl in info.get("template_codes", []):
            bucket["templates"].append({
                "topic_id": tid,
                "topic_title": title,
                "url": tmpl
            })

        utl_pids = topic_to_utl_pids.get(tid, [])
        candidate_probs = [(pid, utl_problems[pid]) for pid in utl_pids if pid in utl_problems]
        candidate_probs.sort(key=lambda x: (not x[1].get("is_starred", False), -x[1].get("solve_count", 0)))

        for i, (up_pid, up) in enumerate(candidate_probs, 1):
            up_url = up.get("problem_url", "")
            nu = norm_url(up_url)
            if nu:
                seen_problem_urls.add(nu)
            is_in_pv = nu in pv_url_to_probs
            source_tag = "[pv+utl]" if is_in_pv else "[utl]"

            diff_val, diff_src = compute_problem_difficulty(
                up_url, pv_set_id=None, utl_prob=up, utl_tid=tid
            )
            diff_source_counts[diff_src] += 1
            prob_id = derive_problem_id(up_url, up.get("problem_title", ""), utl_pid=up_pid)

            bucket["problems"].append({
                "id": prob_id,
                "name": up.get("problem_title", ""),
                "number": i,
                "url": up_url,
                "platform": detect_platform(up_url),
                "difficulty": diff_val,
                "difficulty_source": diff_src,
                "source": source_tag,
                "is_starred": up.get("is_starred", False),
                "solved_count": up.get("solve_count", 0),
                "dacu": 0,
                "origin": f"utl:{tid}"
            })

        catalog["buckets"].append(bucket)

    for b in catalog["buckets"]:
        b["resources"].sort(key=lambda r: not r.get("is_starred", False))

    total_probs = sum(len(b["problems"]) for b in catalog["buckets"])
    total_res = sum(len(b["resources"]) for b in catalog["buckets"])
    total_tmpl = sum(len(b["templates"]) for b in catalog["buckets"])

    catalog["stats"]["total_buckets"] = len(catalog["buckets"])
    catalog["stats"]["progvar_concept_buckets"] = sum(1 for b in catalog["buckets"] if b["type"] == "progvar_concept")
    catalog["stats"]["standalone_utl_buckets"] = sum(1 for b in catalog["buckets"] if b["type"] == "standalone_utl")
    catalog["stats"]["contest_buckets"] = sum(1 for b in catalog["buckets"] if b["type"] == "contest")
    catalog["stats"]["total_problems"] = total_probs
    catalog["stats"]["unique_problems"] = len(seen_problem_urls)
    catalog["stats"]["total_resources"] = total_res
    catalog["stats"]["total_templates"] = total_tmpl
    catalog["stats"]["difficulty_sources"] = dict(diff_source_counts)

    print("\nCatalog Stats:")
    for k, v in catalog["stats"].items():
        print(f"  {k}: {v}")

    cat_json_path = os.path.join(HERE, "catalog.json")
    print(f"\nWriting {cat_json_path}...")
    with open(cat_json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)

    write_csv_stores(catalog)
    render_inventory_views(catalog)
    print("Done!")


def write_csv_stores(catalog):
    b_path = os.path.join(HERE, "catalog_buckets.csv")
    with open(b_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "bucket_id", "title", "domain", "type", "n_problems", "n_resources", "n_templates", "absorbed_topics"
        ])
        w.writeheader()
        for b in catalog["buckets"]:
            abs_str = "; ".join(a["title"] for a in b["absorbed_topics"])
            w.writerow({
                "bucket_id": b["bucket_id"],
                "title": b["title"],
                "domain": b["domain"],
                "type": b["type"],
                "n_problems": len(b["problems"]),
                "n_resources": len(b["resources"]),
                "n_templates": len(b["templates"]),
                "absorbed_topics": abs_str
            })

    p_path = os.path.join(HERE, "catalog_problems.csv")
    with open(p_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "bucket_id", "bucket_title", "domain", "number", "id", "name", "url",
            "platform", "difficulty", "difficulty_source", "source", "is_starred", "solved_count", "dacu"
        ])
        w.writeheader()
        for b in catalog["buckets"]:
            for p in b["problems"]:
                w.writerow({
                    "bucket_id": b["bucket_id"],
                    "bucket_title": b["title"],
                    "domain": b["domain"],
                    "number": p["number"],
                    "id": p.get("id", ""),
                    "name": p["name"],
                    "url": p["url"],
                    "platform": p["platform"],
                    "difficulty": p.get("difficulty", 1200),
                    "difficulty_source": p.get("difficulty_source", "catalog_tier"),
                    "source": p["source"],
                    "is_starred": "yes" if p["is_starred"] else "no",
                    "solved_count": p["solved_count"],
                    "dacu": p["dacu"]
                })

    r_path = os.path.join(HERE, "catalog_resources.csv")
    with open(r_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "bucket_id", "bucket_title", "domain", "topic_id", "topic_title", "title", "url", "is_starred", "is_video", "comment"
        ])
        w.writeheader()
        for b in catalog["buckets"]:
            for r in b["resources"]:
                w.writerow({
                    "bucket_id": b["bucket_id"],
                    "bucket_title": b["title"],
                    "domain": b["domain"],
                    "topic_id": r["topic_id"],
                    "topic_title": r["topic_title"],
                    "title": r["title"],
                    "url": r["url"],
                    "is_starred": "yes" if r["is_starred"] else "no",
                    "is_video": "yes" if r["is_video"] else "no",
                    "comment": r["comment"]
                })


def render_inventory_views(catalog):
    md_path = os.path.join(HERE, "inventory.md")
    print(f"Rendering {md_path}...")
    lines = [
        "# CP Curriculum Problem & Resource Inventory",
        "",
        f"> Unified inventory combining **progvar.fun** (quality, human-curated sets) with **YouKn0wWho's Ultimate Topic List** (exhaustive topics, tutorials, and templates).",
        f"> Total unique problems: **{catalog['stats']['unique_problems']:,}** across **{catalog['stats']['total_buckets']} buckets**.",
        "",
        "## Table of Contents",
        ""
    ]

    by_domain = defaultdict(list)
    for b in catalog["buckets"]:
        by_domain[b["domain"]].append(b)

    for dom in catalog["domains"]:
        if dom not in by_domain:
            continue
        slug = dom.lower().replace(" ", "-").replace("(", "").replace(")", "")
        lines.append(f"- [{dom}](#{slug}) ({len(by_domain[dom])} buckets, {sum(len(b['problems']) for b in by_domain[dom])} problems)")

    lines.append("")

    for dom in catalog["domains"]:
        if dom not in by_domain:
            continue
        buckets = by_domain[dom]
        lines.append(f"## {dom}")
        lines.append("")

        for b in buckets:
            type_badge = "Progvar Concept" if b["type"] == "progvar_concept" else (
                "Contest" if b["type"] == "contest" else "UTL Standalone"
            )
            lines.append(f"### {b['title']} `[{type_badge}]`")
            lines.append(f"*{len(b['problems'])} problems | {len(b['resources'])} tutorials | {len(b['templates'])} code templates*")
            lines.append("")

            if b["absorbed_topics"]:
                abs_names = ", ".join(f"`{a['title']}`" for a in b["absorbed_topics"])
                lines.append(f"**Absorbed UTL Topics:** {abs_names}\n")

            if b["problems"]:
                lines.append("| # | Source | ID | Problem | Platform | Diff (CF) | DACU / Solves |")
                lines.append("|---|:---:|---|---|---|:---:|:---:|")
                for p in b["problems"]:
                    star = " ★" if p["is_starred"] else ""
                    solves = f"dacu={p['dacu']}" if p["dacu"] else f"{p['solved_count']:,}"
                    lines.append(f"| {p['number']} | `{p['source']}` | `{p.get('id', '')}` | [{p['name']}]({p['url']}){star} | {p['platform']} | {p.get('difficulty', 1200)} | {solves} |")
                lines.append("")

            if b["resources"]:
                lines.append("<details><summary><b>Reading Material & Tutorials</b> (" + str(len(b['resources'])) + ")</summary>\n")
                for r in b["resources"]:
                    star = "★ " if r["is_starred"] else ""
                    vid = " 🎬" if r["is_video"] else ""
                    cmt = f" — *{r['comment']}*" if r["comment"] else ""
                    lines.append(f"- {star}[{r['title']}]({r['url']}){vid}{cmt}")
                lines.append("\n</details>\n")

            if b["templates"]:
                lines.append("<details><summary><b>Code Templates</b> (" + str(len(b['templates'])) + ")</summary>\n")
                for t in b["templates"]:
                    tname = t["url"].split("/")[-1].replace("%20", " ")
                    lines.append(f"- [{tname}]({t['url']})")
                lines.append("\n</details>\n")

    with open(md_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    html_path = os.path.join(HERE, "inventory.html")
    print(f"Rendering {html_path}...")
    render_html(catalog, html_path)


def render_html(catalog, out_path):
    data_js = json.dumps(catalog, ensure_ascii=False)
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CP Problem & Resource Catalog</title>
<style>
  :root {{
    --bg: #0f172a; --panel: #1e293b; --border: #334155; --text: #f8fafc;
    --muted: #94a3b8; --accent: #38bdf8; --star: #f59e0b; --badge: #334155;
    --pv: #3b82f6; --utl: #10b981; --both: #8b5cf6;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }}
  #sidebar {{ width: 340px; border-right: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; }}
  #search-box {{ padding: 12px; border-bottom: 1px solid var(--border); }}
  #search-box input {{ width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; }}
  #domains-list {{ flex: 1; overflow-y: auto; padding: 8px; }}
  .domain-header {{ font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); padding: 8px 10px 4px; font-weight: 700; }}
  .bucket-item {{ padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text); margin-bottom: 2px; }}
  .bucket-item:hover {{ background: rgba(56, 189, 248, 0.1); }}
  .bucket-item.active {{ background: rgba(56, 189, 248, 0.2); color: var(--accent); font-weight: 600; }}
  .bucket-count {{ font-size: 11px; color: var(--muted); }}
  #main {{ flex: 1; overflow-y: auto; padding: 24px 32px; }}
  .header {{ margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }}
  .header h1 {{ font-size: 24px; margin-bottom: 6px; }}
  .header .meta {{ color: var(--muted); font-size: 14px; display: flex; gap: 16px; align-items: center; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; background: var(--badge); }}
  .tag-pv {{ background: rgba(59, 130, 246, 0.2); color: #60a5fa; }}
  .tag-utl {{ background: rgba(16, 185, 129, 0.2); color: #34d399; }}
  .tag-both {{ background: rgba(139, 92, 246, 0.2); color: #c084fc; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }}
  th, td {{ padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }}
  th {{ color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 600; }}
  tr:hover {{ background: rgba(255,255,255,0.02); }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .star {{ color: var(--star); }}
  .section {{ margin-top: 32px; }}
  .section h2 {{ font-size: 16px; margin-bottom: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }}
  .resource-item {{ padding: 8px 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; font-size: 14px; display: flex; justify-content: space-between; }}
  .resource-meta {{ font-size: 12px; color: var(--muted); margin-top: 4px; }}
</style>
</head>
<body>
<div id="sidebar">
  <div id="search-box">
    <input type="text" id="filter-input" placeholder="Search buckets, topics or problems...">
  </div>
  <div id="domains-list"></div>
</div>
<div id="main">
  <div id="content"><div style="color: var(--muted); padding: 40px; text-align: center;">Select a bucket from the sidebar</div></div>
</div>

<script>
const CATALOG = {data_js};
let activeBucket = null;

function init() {{
  renderSidebar('');
  document.getElementById('filter-input').addEventListener('input', (e) => {{
    renderSidebar(e.target.value.toLowerCase().trim());
  }});
  if (CATALOG.buckets.length > 0) {{
    selectBucket(CATALOG.buckets[0].bucket_id);
  }}
}}

function renderSidebar(query) {{
  const list = document.getElementById('domains-list');
  list.innerHTML = '';

  const byDomain = {{}};
  CATALOG.domains.forEach(d => byDomain[d] = []);
  CATALOG.buckets.forEach(b => {{
    if (!byDomain[b.domain]) byDomain[b.domain] = [];
    if (!query || b.title.toLowerCase().includes(query) || b.absorbed_topics.some(a => a.title.toLowerCase().includes(query))) {{
      byDomain[b.domain].push(b);
    }}
  }});

  CATALOG.domains.forEach(d => {{
    const buckets = byDomain[d];
    if (!buckets || buckets.length === 0) return;

    const h = document.createElement('div');
    h.className = 'domain-header';
    h.textContent = d + ' (' + buckets.length + ')';
    list.appendChild(h);

    buckets.forEach(b => {{
      const item = document.createElement('div');
      item.className = 'bucket-item' + (activeBucket === b.bucket_id ? ' active' : '');
      item.innerHTML = `<span>${{b.title}}</span><span class="bucket-count">${{b.problems.length}}</span>`;
      item.onclick = () => selectBucket(b.bucket_id);
      list.appendChild(item);
    }});
  }});
}}

function selectBucket(id) {{
  activeBucket = id;
  document.querySelectorAll('.bucket-item').forEach(el => el.classList.remove('active'));
  const b = CATALOG.buckets.find(x => x.bucket_id === id);
  if (!b) return;

  const content = document.getElementById('content');
  let typeTag = b.type === 'progvar_concept' ? '<span class="badge tag-pv">Progvar Concept</span>' :
                (b.type === 'contest' ? '<span class="badge">Contest</span>' : '<span class="badge tag-utl">UTL Standalone</span>');

  let absorbedHtml = '';
  if (b.absorbed_topics && b.absorbed_topics.length > 0) {{
    absorbedHtml = `<div style="margin-top: 10px; font-size: 13px; color: var(--muted);">
      <b>Absorbed Topics:</b> ${{b.absorbed_topics.map(a => `<span class="badge">${{a.title}}</span>`).join(' ')}}
    </div>`;
  }}

  let problemsHtml = '';
  if (b.problems.length > 0) {{
    problemsHtml = `
      <table>
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th style="width: 90px;">Source</th>
            <th>Problem Name</th>
            <th style="width: 130px;">Platform</th>
            <th style="width: 100px;">Diff (CF)</th>
            <th style="width: 120px;">Solvers</th>
          </tr>
        </thead>
        <tbody>
          ${{b.problems.map(p => {{
            let tagClass = p.source === '[pv+utl]' ? 'tag-both' : (p.source === '[pv]' ? 'tag-pv' : 'tag-utl');
            let star = p.is_starred ? '<span class="star">★</span> ' : '';
            let solvers = p.dacu ? `dacu: ${{p.dacu}}` : (p.solved_count ? p.solved_count.toLocaleString() : '-');
            return `<tr>
              <td style="color: var(--muted);">${{p.number}}</td>
              <td><span class="badge ${{tagClass}}">${{p.source}}</span></td>
              <td>${{star}}<a href="${{p.url}}" target="_blank">${{p.name}}</a> <span style="color: var(--muted); font-size: 11px;">(${{p.id || ''}})</span></td>
              <td>${{p.platform}}</td>
              <td><span class="badge">${{p.difficulty || 1200}}</span></td>
              <td style="color: var(--muted); font-size: 12px;">${{solvers}}</td>
            </tr>`;
          }}).join('')}}
        </tbody>
      </table>
    `;
  }} else {{
    problemsHtml = '<div style="color: var(--muted); padding: 20px 0;">No direct practice problems (reading material only).</div>';
  }}

  let resourcesHtml = '';
  if (b.resources.length > 0) {{
    resourcesHtml = `
      <div class="section">
        <h2>Reading & Tutorials (${{b.resources.length}})</h2>
        ${{b.resources.map(r => `
          <div class="resource-item">
            <div>
              ${{r.is_starred ? '<span class="star">★</span> ' : ''}}
              <a href="${{r.url}}" target="_blank"><b>${{r.title}}</b></a>
              ${{r.comment ? `<div class="resource-meta">${{r.comment}}</div>` : ''}}
            </div>
            <div style="font-size: 12px; color: var(--muted);">${{r.topic_title}}</div>
          </div>
        `).join('')}}
      </div>
    `;
  }}

  let templatesHtml = '';
  if (b.templates.length > 0) {{
    templatesHtml = `
      <div class="section">
        <h2>Code Templates (${{b.templates.length}})</h2>
        ${{b.templates.map(t => `
          <div class="resource-item">
            <a href="${{t.url}}" target="_blank">${{t.url.split('/').pop()}}</a>
            <div style="font-size: 12px; color: var(--muted);">${{t.topic_title}}</div>
          </div>
        `).join('')}}
      </div>
    `;
  }}

  content.innerHTML = `
    <div class="header">
      <h1>${{b.title}}</h1>
      <div class="meta">
        <span>${{b.domain}}</span>
        ${{typeTag}}
        <span>${{b.problems.length}} Problems</span>
        <span>${{b.resources.length}} Tutorials</span>
        <span>${{b.templates.length}} Templates</span>
      </div>
      ${{absorbedHtml}}
    </div>
    <div class="section">
      <h2>Problems (${{b.problems.length}})</h2>
      ${{problemsHtml}}
    </div>
    ${{resourcesHtml}}
    ${{templatesHtml}}
  `;
}}

init();
</script>
</body>
</html>"""
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(html_content)


if __name__ == "__main__":
    main()
