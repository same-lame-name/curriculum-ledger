#!/usr/bin/env python3
"""catalog.py — unified Competitive Programming problem & resource catalog.

Unifies progvar.fun's curated sets and YouKn0wWho's Ultimate Topic List (UTL).

USABLE TWO WAYS:
1. As a CLI:
       python3 catalog.py domains
       python3 catalog.py buckets "Dynamic Programming"
       python3 catalog.py bucket "DP on Broken Profile"
       python3 catalog.py bucket "0-1 BFS" --min-diff 1100 --max-diff 1600 --urls --limit 10
       python3 catalog.py find "knapsack" --min-diff 1000 --max-diff 1500
       python3 catalog.py problem "Counting Tilings"
       python3 catalog.py statement "cf_1800A"
       python3 catalog.py resources "Convex Hull Trick"
       python3 catalog.py pick --buckets "DP on Subsets;DP on Trees;DP on Digits" --min-diff 1300 --max-diff 1600 --count 3 --seed 1
       python3 catalog.py similar "Counting Tilings" --limit 5
       # Add --json to any command for machine-readable output
       # Add --exclude-attempted to bucket/find/pick/similar to skip problems already attempted in the Arena

2. As a Python library:
       import catalog
       catalog.domains()
       catalog.buckets("Graphs")
       catalog.bucket("0-1 BFS", min_diff=1100, max_diff=1600)
       catalog.find("knapsack")
       catalog.resources("2-SAT")
       catalog.pick(["DP on Subsets", "DP on Trees"], count=4, seed=1)
       catalog.similar("Counting Tilings", exclude_solved=True)

ATTEMPTED PROBLEMS (--exclude-attempted / exclude_solved=True):
    Asks the Arena through its API — `python3 ../arena/arena.py attempted` relative to this script
    (set PI_ARENA_CLI to use another copy) — and never reads the Arena's files itself. Every catalog
    problem whose id or URL matches an attempted problem's problem_id, catalog_id or url is excluded
    (URLs catch Arena ids that differ from catalog ids, e.g. "dpc_e" vs "dp_e"). When the Arena can't
    answer, nothing is excluded and a warning goes to stderr.
"""
import argparse, html, json, os, random, re, subprocess, sys

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
ARENA_CLI = os.path.normpath(os.path.join(HERE, "..", "arena", "arena.py"))


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
    if not q:
        return True
    if q in t:
        return True
    tokens = q.split()
    return all(tok in t for tok in tokens)


def _is_excluded(prob, exc_set):
    if not exc_set:
        return False
    pid = _norm(prob.get("id", ""))
    pname = _norm(prob.get("name", ""))
    purl = _norm(prob.get("url", ""))
    return (pid and pid in exc_set) or (pname and pname in exc_set) or (purl and purl in exc_set)


def _pkey(prob):
    """Identity of a problem across buckets: its id (URL as a fallback)."""
    return _norm(prob.get("id") or prob.get("url", ""))


def _pick_tier(prob):
    """pick() preference inside a bucket: 0 = progvar ([pv], [pv+utl]), 1 = starred utl, 2 = the rest."""
    if "pv" in prob["source"]:
        return 0
    return 1 if prob.get("is_starred", False) else 2


def arena_cli_path():
    """The Arena's CLI — its API for other components: $PI_ARENA_CLI when set, else .pi/arena/arena.py."""
    return os.environ.get("PI_ARENA_CLI") or ARENA_CLI


_ATTEMPTED = {"loaded": False, "entries": None}


def arena_attempted():
    """Problems the Arena reports as attempted (`arena.py attempted`), or None when it can't answer.

    The catalog asks the Arena instead of reading its ledger, so the Arena's storage can change freely.
    """
    if not _ATTEMPTED["loaded"]:
        entries = None
        try:
            proc = subprocess.run(
                [sys.executable, arena_cli_path(), "attempted"],
                capture_output=True, text=True, encoding="utf-8", timeout=30,
            )
            if proc.returncode == 0:
                parsed = json.loads(proc.stdout)
                entries = parsed if isinstance(parsed, list) else None
        except (OSError, ValueError, subprocess.SubprocessError):
            entries = None
        _ATTEMPTED["loaded"], _ATTEMPTED["entries"] = True, entries
    return _ATTEMPTED["entries"]


def solved_ids():
    """Normalized problem_id, catalog_id and url of every problem the Arena reports as attempted.

    URLs are included because Arena ids can differ from catalog ids (Arena "dpc_e" is catalog "dp_e").
    When the Arena can't answer, the set is empty, i.e. no exclusions.
    """
    ids = set()
    for entry in arena_attempted() or []:
        if isinstance(entry, dict):
            for key in ("problem_id", "catalog_id", "url"):
                val = entry.get(key)
                if isinstance(val, str) and val.strip():
                    ids.add(_norm(val))
    return ids


def _solved_keys():
    """Keys (see _pkey) of catalog problems in the Arena ledger, matched by id or URL exactly like --exclude.

    A match on any copy of a problem marks all of its copies, since one problem can carry several URLs.
    """
    marks = solved_ids()
    if not marks:
        return set()
    return {_pkey(p) for b in data()["buckets"] for p in b["problems"] if _is_excluded(p, marks)}


# ---------------------------------------------------------------- Library API


def domains():
    d = data()
    out = []
    for dom in d["domains"]:
        buckets_in_dom = [b for b in d["buckets"] if b["domain"] == dom]
        n_probs = sum(len(b["problems"]) for b in buckets_in_dom)
        n_res = sum(len(b["resources"]) for b in buckets_in_dom)
        out.append({
            "domain": dom,
            "n_buckets": len(buckets_in_dom),
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
    for b in d["buckets"]:
        if b["bucket_id"].lower() == q:
            return b
    for b in d["buckets"]:
        if _norm(b["title"]) == q:
            return b
    matches = [b for b in d["buckets"] if _matches_query(q, b["title"])]
    if matches:
        return matches[0]
    for b in d["buckets"]:
        for a in b["absorbed_topics"]:
            if _matches_query(q, a["title"]) or _matches_query(q, a["topic_id"]):
                return b
    cands = [b["title"] for b in d["buckets"] if any(t in _norm(b["title"]) for t in q.split()[:2])][:10]
    raise CatalogError(f"no bucket matching {name_or_id!r}", cands)


def bucket(name_or_id, source=None, starred_only=False, exclude=None, min_diff=None, max_diff=None, limit=None, exclude_solved=False):
    b = _find_bucket(name_or_id)
    probs = list(b["problems"])

    if exclude:
        exc_set = {_norm(x) for x in exclude if x}
        probs = [p for p in probs if not _is_excluded(p, exc_set)]

    if source == "pv":
        probs = [p for p in probs if "pv" in p["source"]]
    elif source == "utl":
        probs = [p for p in probs if "utl" in p["source"]]

    if starred_only:
        probs = [p for p in probs if p.get("is_starred", False)]

    if min_diff is not None:
        probs = [p for p in probs if int(p.get("difficulty", 1200)) >= int(min_diff)]
    if max_diff is not None:
        probs = [p for p in probs if int(p.get("difficulty", 1200)) <= int(max_diff)]

    if exclude_solved:
        solved = _solved_keys()
        kept = [p for p in probs if _pkey(p) not in solved]
        n_solved, probs = len(probs) - len(kept), kept

    if limit:
        probs = probs[:limit]

    res = {
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
    if exclude_solved:
        res["n_excluded_solved"] = n_solved
    return res


def find(text, limit=25, source=None, starred_only=False, exclude=None, min_diff=None, max_diff=None, exclude_solved=False):
    d = data()
    q = _norm(text)
    if not q:
        return {"query": text, "matching_buckets": [], "matching_problems": []}

    exc_set = {_norm(x) for x in exclude if x} if exclude else set()
    solved = _solved_keys() if exclude_solved else set()
    hidden_solved = set()

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
            if p_url in seen_urls:
                continue
            if _is_excluded(p, exc_set):
                continue
            if source == "pv" and "pv" not in p["source"]:
                continue
            if source == "utl" and "utl" not in p["source"]:
                continue
            if starred_only and not p.get("is_starred", False):
                continue
            p_diff = int(p.get("difficulty", 1200))
            if min_diff is not None and p_diff < int(min_diff):
                continue
            if max_diff is not None and p_diff > int(max_diff):
                continue

            if _matches_query(q, p["name"]) or _matches_query(q, p.get("id", "")):
                if solved and _pkey(p) in solved:
                    hidden_solved.add(_pkey(p))
                    continue
                seen_urls.add(p_url)
                hit_probs.append({
                    "id": p.get("id", ""),
                    "name": p["name"],
                    "url": p_url,
                    "platform": p["platform"],
                    "difficulty": p_diff,
                    "difficulty_source": p.get("difficulty_source", "catalog_tier"),
                    "source": p["source"],
                    "is_starred": p.get("is_starred", False),
                    "bucket": b["title"],
                    "domain": b["domain"],
                    "solved_count": p.get("solved_count", 0),
                    "dacu": p.get("dacu", 0)
                })

    res = {
        "query": text,
        "n_buckets": len(hit_buckets),
        "n_problems": len(hit_probs),
        "buckets": hit_buckets[:limit],
        "problems": hit_probs[:limit]
    }
    if exclude_solved:
        res["n_excluded_solved"] = len(hidden_solved)
    return res


def problem(name_or_url):
    d = data()
    q = _norm(name_or_url)
    occurrences = []
    target_prob = None

    for b in d["buckets"]:
        for p in b["problems"]:
            pid = _norm(p.get("id", ""))
            pname = _norm(p["name"])
            purl = _norm(p.get("url", ""))
            if pid == q or pname == q or purl == q or q in pname or q in purl:
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
                    if len(cands) >= 8:
                        break
            if len(cands) >= 8:
                break
        raise CatalogError(f"no problem matching {name_or_url!r}", cands)

    return {
        "id": target_prob.get("id", ""),
        "name": target_prob["name"],
        "url": target_prob["url"],
        "platform": target_prob["platform"],
        "difficulty": target_prob.get("difficulty", 1200),
        "difficulty_source": target_prob.get("difficulty_source", "catalog_tier"),
        "source": target_prob["source"],
        "is_starred": target_prob.get("is_starred", False),
        "solved_count": target_prob.get("solved_count", 0),
        "dacu": target_prob.get("dacu", 0),
        "occurrences": occurrences
    }


def _clean_html_text(raw_html):
    if not raw_html:
        return ""
    text = re.sub(r'<span class="tex-font-style-tt">([^<]+)</span>', r'`\1`', raw_html)
    text = re.sub(r'<span class="tex-span">([^<]+)</span>', r'\1', text)
    text = re.sub(r'<div class="test-example-line[^"]*">', '', text)
    text = re.sub(r'</div>', '\n', text)
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'</p>', '\n\n', text)
    text = re.sub(r'<li[^>]*>', '- ', text)
    text = re.sub(r'</li>', '\n', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in text.splitlines()]
    res = []
    prev_blank = False
    for l in lines:
        if not l:
            if not prev_blank:
                res.append("")
                prev_blank = True
        else:
            res.append(l)
            prev_blank = False
    return "\n".join(res).strip()


def _fetch_url(url, timeout=15):
    import importlib.util
    import os

    browser_fetch_path = os.environ.get("LH_BROWSER_FETCH_PY") or os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "browser", "browser_fetch.py")
    )
    spec = importlib.util.spec_from_file_location("_lh_browser_fetch", browser_fetch_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load browser_fetch module at {browser_fetch_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if hasattr(mod, "fetch_raw"):
        res = mod.fetch_raw(url, timeout=timeout)
        status = int(res.get("status", 0))
        if not (200 <= status < 300):
            raise RuntimeError(f"HTTP {status} while fetching {url}")
        return res.get("body", "")
    return mod.raw_fetch(url, timeout=timeout)


def _parse_codeforces(html_text, fallback_title=""):
    title_m = re.findall(r'<div class="title">\s*([^<]+)\s*</div>', html_text)
    title = title_m[0].strip() if title_m else fallback_title

    tl_m = re.findall(r'<div class="time-limit">\s*<div class="property-title">time limit per test</div>\s*([^<]+)\s*</div>', html_text)
    ml_m = re.findall(r'<div class="memory-limit">\s*<div class="property-title">memory limit per test</div>\s*([^<]+)\s*</div>', html_text)
    tl = tl_m[0].strip() if tl_m else "2.0s"
    ml = ml_m[0].strip() if ml_m else "256MB"

    body_m = re.search(r'<div class="problem-statement">.*?<div class="header">.*?</div>(.*?)<div class="input-specification">', html_text, re.DOTALL)
    body = _clean_html_text(body_m.group(1)) if body_m else ""

    in_m = re.search(r'<div class="input-specification">(.*?)</div>\s*<div class="output-specification">', html_text, re.DOTALL)
    out_m = re.search(r'<div class="output-specification">(.*?)</div>\s*<div class="sample-tests">', html_text, re.DOTALL)
    if not out_m:
        out_m = re.search(r'<div class="output-specification">(.*?)</div>\s*<div class="note">', html_text, re.DOTALL)

    in_spec = _clean_html_text(in_m.group(1)) if in_m else ""
    out_spec = _clean_html_text(out_m.group(1)) if out_m else ""

    summary = body
    if in_spec or out_spec:
        summary += f"\n\nInput:\n{in_spec}\n\nOutput:\n{out_spec}"

    samples = []
    raw_ins = re.findall(r'<div class="input"><div class="title">Input</div><pre(?:\s+data-content="([^"]*)")?>(.*?)</pre>', html_text, re.DOTALL)
    raw_outs = re.findall(r'<div class="output"><div class="title">Output</div><pre(?:\s+data-content="([^"]*)")?>(.*?)</pre>', html_text, re.DOTALL)

    for i in range(min(len(raw_ins), len(raw_outs))):
        in_attr, in_body = raw_ins[i]
        out_attr, out_body = raw_outs[i]
        s_in = html.unescape(in_attr) if in_attr else _clean_html_text(in_body)
        s_out = html.unescape(out_attr) if out_attr else _clean_html_text(out_body)
        samples.append({"input": s_in.strip(), "output": s_out.strip()})

    constraints = f"Time Limit: {tl} | Memory Limit: {ml}"
    return {
        "title": title,
        "time_limit": tl,
        "memory_limit": ml,
        "statementSummary": summary.strip(),
        "constraints": constraints,
        "samples": samples
    }


def _parse_atcoder(html_text, fallback_title=""):
    title = fallback_title
    title_m = re.findall(r'<title>(.*?)</title>', html_text)
    if title_m:
        t = title_m[0].split(" - ")[0].strip()
        if t and len(t) > 2:
            title = t
        elif fallback_title:
            title = fallback_title

    limits_m = re.findall(r'Time Limit:\s*([^/<]+)\s*/\s*Memory Limit:\s*([^<]+)', html_text)
    tl = limits_m[0][0].strip() if limits_m else "2 sec"
    ml = limits_m[0][1].strip() if limits_m else "1024 MB"

    en_section = html_text
    lang_en_m = re.search(r'<span class="lang-en">(.*?)</span>\s*(?:<span class="lang-ja">|<!-- end lang-en -->|</div>\s*</div>\s*<div id="task-lang-btn">)', html_text, re.DOTALL)
    if lang_en_m:
        en_section = lang_en_m.group(1)

    stmt_m = re.search(r'<h3>\s*Problem Statement\s*</h3>(.*?)<h3>\s*Constraints\s*</h3>', en_section, re.DOTALL)
    body = _clean_html_text(stmt_m.group(1)) if stmt_m else ""

    cons_m = re.search(r'<h3>\s*Constraints\s*</h3>(.*?)<h3>\s*Input\s*</h3>', en_section, re.DOTALL)
    cons = _clean_html_text(cons_m.group(1)) if cons_m else ""

    in_m = re.search(r'<h3>\s*Input\s*</h3>(.*?)<h3>\s*Output\s*</h3>', en_section, re.DOTALL)
    out_m = re.search(r'<h3>\s*Output\s*</h3>(.*?)<hr\s*/?>', en_section, re.DOTALL)
    in_spec = _clean_html_text(in_m.group(1)) if in_m else ""
    out_spec = _clean_html_text(out_m.group(1)) if out_m else ""

    summary = body
    if in_spec or out_spec:
        summary += f"\n\nInput:\n{in_spec}\n\nOutput:\n{out_spec}"

    samples = []
    sample_ins = re.findall(r'<h3>\s*Sample Input\s*\d+\s*</h3>\s*<pre>(.*?)</pre>', en_section, re.DOTALL)
    sample_outs = re.findall(r'<h3>\s*Sample Output\s*\d+\s*</h3>\s*<pre>(.*?)</pre>', en_section, re.DOTALL)
    for i in range(min(len(sample_ins), len(sample_outs))):
        samples.append({
            "input": html.unescape(sample_ins[i]).strip(),
            "output": html.unescape(sample_outs[i]).strip()
        })

    constraints = f"Time Limit: {tl} | Memory Limit: {ml}\n{cons}".strip()
    return {
        "title": title,
        "time_limit": tl,
        "memory_limit": ml,
        "statementSummary": summary.strip(),
        "constraints": constraints,
        "samples": samples
    }


def _parse_cses(html_text, fallback_title=""):
    title_m = re.findall(r'<title>CSES - ([^<]+)</title>', html_text)
    title = title_m[0].strip() if title_m else fallback_title

    tl_m = re.findall(r'Time limit:</b>\s*([^<]+)</li>', html_text)
    ml_m = re.findall(r'Memory limit:</b>\s*([^<]+)</li>', html_text)
    tl = tl_m[0].strip() if tl_m else "1.0s"
    ml = ml_m[0].strip() if ml_m else "512MB"

    content_m = re.search(r'<ul class="task-constraints">.*?</ul>(.*?)(?:<h1[^>]*>Example|<p>\s*Input:)', html_text, re.DOTALL)
    if not content_m:
        content_m = re.search(r'<div class="content">(.*?)(?:<h1[^>]*>Example|<p>\s*Input:)', html_text, re.DOTALL)
    summary = _clean_html_text(content_m.group(1)) if content_m else ""

    samples = []
    in_m = re.search(r'<p>\s*Input:\s*</p>\s*<pre>(.*?)</pre>', html_text, re.DOTALL)
    out_m = re.search(r'<p>\s*Output:\s*</p>\s*<pre>(.*?)</pre>', html_text, re.DOTALL)
    if in_m and out_m:
        samples.append({
            "input": html.unescape(in_m.group(1)).strip(),
            "output": html.unescape(out_m.group(1)).strip()
        })

    constraints = f"Time Limit: {tl} | Memory Limit: {ml}"
    return {
        "title": title,
        "time_limit": tl,
        "memory_limit": ml,
        "statementSummary": summary.strip(),
        "constraints": constraints,
        "samples": samples
    }


def _parse_generic(html_text, fallback_title=""):
    title_m = re.findall(r'<title>\s*([^<]+)\s*</title>', html_text)
    title = title_m[0].strip() if title_m else fallback_title

    pre_tags = re.findall(r'<pre[^>]*>(.*?)</pre>', html_text, re.DOTALL)
    samples = []
    for i in range(0, len(pre_tags) - 1, 2):
        s_in = _clean_html_text(pre_tags[i])
        s_out = _clean_html_text(pre_tags[i+1])
        if s_in and s_out and len(s_in) < 2000 and len(s_out) < 2000:
            samples.append({"input": s_in, "output": s_out})

    summary = _clean_html_text(html_text[:4000])
    return {
        "title": title,
        "time_limit": "2.0s",
        "memory_limit": "256MB",
        "statementSummary": summary,
        "constraints": "Standard limits apply",
        "samples": samples
    }


def statement(name_or_url):
    prob_meta = None
    try:
        prob_meta = problem(name_or_url)
    except Exception:
        pass

    target_id = prob_meta.get("id") if prob_meta else None
    target_url = prob_meta.get("url") if prob_meta else (name_or_url if name_or_url.startswith("http") else "")
    target_platform = prob_meta.get("platform") if prob_meta else ""
    target_diff = prob_meta.get("difficulty") if prob_meta else 1200
    target_domain = prob_meta["occurrences"][0]["domain"] if (prob_meta and prob_meta.get("occurrences")) else "General"
    fallback_title = prob_meta.get("name", name_or_url) if prob_meta else name_or_url

    # Synthesize URL from ID if not found in catalog
    if not target_url:
        cf_m = re.match(r'^cf_(\d+)([A-Za-z0-9]+)$', name_or_url, re.IGNORECASE)
        if cf_m:
            target_url = f"https://codeforces.com/problemset/problem/{cf_m.group(1)}/{cf_m.group(2).upper()}"
            target_id = f"cf_{cf_m.group(1)}{cf_m.group(2).upper()}"
            target_platform = "Codeforces"
        elif re.match(r'^(abc|arc|agc|ahc)\d+_[a-z0-9]+$', name_or_url, re.IGNORECASE):
            contest = name_or_url.split('_')[0].lower()
            target_url = f"https://atcoder.jp/contests/{contest}/tasks/{name_or_url.lower()}"
            target_id = name_or_url.lower()
            target_platform = "AtCoder"
        elif re.match(r'^cses_(\d+)$', name_or_url, re.IGNORECASE):
            task_id = name_or_url.split('_')[1]
            target_url = f"https://cses.fi/problemset/task/{task_id}"
            target_id = f"cses_{task_id}"
            target_platform = "CSES"

    if not target_url:
        raise CatalogError(f"no URL found for problem {name_or_url!r}")

    # Synthesize clean ID from URL if target_id is still missing
    if not target_id:
        cf_url_m = re.search(r'codeforces\.com/(?:contest/(\d+)/problem/([A-Za-z0-9]+)|problemset/problem/(\d+)/([A-Za-z0-9]+))', target_url)
        if cf_url_m:
            cid = cf_url_m.group(1) or cf_url_m.group(3)
            pid = cf_url_m.group(2) or cf_url_m.group(4)
            target_id = f"cf_{cid}{pid.upper()}"
        else:
            ac_url_m = re.search(r'atcoder\.jp/contests/[^/]+/tasks/([a-z0-9_]+)', target_url)
            if ac_url_m:
                target_id = ac_url_m.group(1).lower()
            else:
                cses_url_m = re.search(r'cses\.fi/problemset/task/(\d+)', target_url)
                if cses_url_m:
                    target_id = f"cses_{cses_url_m.group(1)}"
                else:
                    target_id = re.sub(r'[^A-Za-z0-9_-]', '_', name_or_url)

    html_text = _fetch_url(target_url)
    if not html_text:
        raise CatalogError(f"failed to fetch statement from {target_url}")

    url_lower = target_url.lower()
    if "codeforces.com" in url_lower:
        parsed = _parse_codeforces(html_text, fallback_title)
        platform = "Codeforces"
    elif "atcoder.jp" in url_lower:
        parsed = _parse_atcoder(html_text, fallback_title)
        platform = "AtCoder"
    elif "cses.fi" in url_lower:
        parsed = _parse_cses(html_text, fallback_title)
        platform = "CSES"
    else:
        parsed = _parse_generic(html_text, fallback_title)
        platform = target_platform or "Online Judge"

    return {
        "id": target_id,
        "title": parsed["title"] or fallback_title,
        "url": target_url,
        "platform": platform,
        "difficulty": target_diff,
        "domain": target_domain,
        "time_limit": parsed["time_limit"],
        "memory_limit": parsed["memory_limit"],
        "statementSummary": parsed["statementSummary"],
        "constraints": parsed["constraints"],
        "samples": parsed["samples"]
    }


def resources(bucket_or_topic, limit=15):
    d = data()
    q = _norm(bucket_or_topic)
    res_list = []
    tmpl_list = []
    matched_bucket = None

    for b in d["buckets"]:
        if _matches_query(q, b["title"]) or b["bucket_id"].lower() == q or any(_matches_query(q, a["title"]) for a in b["absorbed_topics"]):
            matched_bucket = b
            res_list.extend(b["resources"])
            tmpl_list.extend(b["templates"])
            break

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


def pick(bucket_names, count=3, min_diff=None, max_diff=None, starred_only=False, exclude=None, exclude_solved=False, seed=None):
    """Mixed practice set drawn round-robin from several buckets (a list, or one "A;B;C" string).

    Each name is resolved like `bucket`. Inside a bucket, progvar problems ([pv], [pv+utl]) come first,
    then starred utl, then the rest; ties are broken by a random key derived from `seed` and the problem id
    (a seed is drawn and reported when omitted, so any pick can be replayed). Because each key depends only
    on (seed, id), excluding a problem never reorders the others. The same problem is never returned twice.
    """
    if isinstance(bucket_names, str):
        bucket_names = bucket_names.split(";")
    names = [n.strip() for n in bucket_names if n and n.strip()]
    if not names:
        raise CatalogError("no bucket names given (e.g. --buckets \"DP on Trees;DP on Digits\")")
    bks = []
    for n in names:
        b = _find_bucket(n)
        if all(b["bucket_id"] != x["bucket_id"] for x in bks):
            bks.append(b)

    if seed is None:
        seed = random.randrange(10**6)
    exc_set = {_norm(x) for x in exclude if x} if exclude else set()
    solved = _solved_keys() if exclude_solved else set()
    # pv and utl copies of one problem can carry different names, so excluding any copy excludes them all
    excluded = {_pkey(p) for b in bks for p in b["problems"] if _is_excluded(p, exc_set)}

    queues, info, hidden_solved = [], [], set()
    for b in bks:
        best = {}
        for p in b["problems"]:
            k = _pkey(p)
            p_diff = int(p.get("difficulty", 1200))
            if k in excluded or (starred_only and not p.get("is_starred", False)):
                continue
            if (min_diff is not None and p_diff < int(min_diff)) or (max_diff is not None and p_diff > int(max_diff)):
                continue
            if k in solved:
                hidden_solved.add(k)
                continue
            if k not in best or _pick_tier(p) < _pick_tier(best[k]):
                best[k] = p
        order = sorted(best.values(), key=lambda p: (_pick_tier(p), random.Random(f"{seed}:{_pkey(p)}").random()))
        queues.append(iter([(b, p) for p in order]))
        info.append({"bucket_id": b["bucket_id"], "title": b["title"], "domain": b["domain"], "type": b["type"], "n_candidates": len(best)})

    picked, seen = [], set()
    while queues and len(picked) < count:
        for q in list(queues):
            hit = next((bp for bp in q if _pkey(bp[1]) not in seen), None)
            if hit is None:
                queues.remove(q)
                continue
            b, p = hit
            seen.add(_pkey(p))
            picked.append(dict(p, bucket_id=b["bucket_id"], bucket=b["title"], domain=b["domain"]))
            if len(picked) >= count:
                break

    res = {
        "buckets": info,
        "count": count,
        "min_diff": min_diff,
        "max_diff": max_diff,
        "starred_only": starred_only,
        "seed": seed,
        "n_returned_problems": len(picked),
        "problems": picked
    }
    if exclude_solved:
        res["n_excluded_solved"] = len(hidden_solved)
    return res


def similar(name_or_url, limit=10, min_diff=None, max_diff=None, exclude=None, exclude_solved=False):
    """Problems sharing at least one bucket with the given problem (resolved exactly like `problem`).

    Ranked by number of shared buckets (desc), then |difficulty - the problem's difficulty| (asc);
    remaining ties keep catalog order. Each candidate is reported as its first occurrence in the shared buckets.
    """
    d = data()
    target = problem(name_or_url)
    tkey = _norm(target["id"] or target["url"])
    t_diff = int(target["difficulty"])
    t_buckets = [b for b in d["buckets"] if any(_pkey(p) == tkey for p in b["problems"])]

    exc_set = {_norm(x) for x in exclude if x} if exclude else set()
    solved = _solved_keys() if exclude_solved else set()
    cands, excluded = {}, set()
    for b in t_buckets:
        for p in b["problems"]:
            k = _pkey(p)
            if k == tkey:
                continue
            if _is_excluded(p, exc_set):
                excluded.add(k)
            c = cands.setdefault(k, {"prob": p, "shared": {}})
            c["shared"][b["bucket_id"]] = b["title"]

    rows, hidden_solved = [], set()
    for k, c in cands.items():
        p = c["prob"]
        p_diff = int(p.get("difficulty", 1200))
        if k in excluded:
            continue
        if (min_diff is not None and p_diff < int(min_diff)) or (max_diff is not None and p_diff > int(max_diff)):
            continue
        if k in solved:
            hidden_solved.add(k)
            continue
        rows.append(dict(p, n_shared_buckets=len(c["shared"]), shared_buckets=list(c["shared"].values()), difficulty_delta=p_diff - t_diff))
    rows.sort(key=lambda r: (-r["n_shared_buckets"], abs(r["difficulty_delta"])))
    shown = rows[:limit] if limit else rows

    res = {
        "query": name_or_url,
        "problem": {k: v for k, v in target.items() if k != "occurrences"},
        "buckets": [{"bucket_id": b["bucket_id"], "title": b["title"], "domain": b["domain"], "type": b["type"]} for b in t_buckets],
        "n_matches": len(rows),
        "n_returned_problems": len(shown),
        "problems": shown
    }
    if exclude_solved:
        res["n_excluded_solved"] = len(hidden_solved)
    return res


def round_pick(slots_str, theme="random", exclude=None, exclude_solved=False, seed=None, per_slot=1):
    """Pick candidate problem(s) per difficulty slot for a round.

    slots_str: comma-separated target difficulties, e.g. "800,1000,1200,1200"
    theme: "random", "mixed", or "direct:<technique>" (e.g. "direct:dp", "direct:binary-search")
    per_slot: number of ranked candidates per slot to include in slot_candidates (default 1).

    For "mixed": each primary pick must come from a different canonical domain.
    For "direct:<t>": all problems must come from buckets matching the technique.
    For "random": no constraints beyond the slot match.

    Slot matching: prefer |difficulty - target| <= 50, then widen to <= 100.
    Prefer problems with difficulty_source != "catalog_tier" (i.e. official/converted ratings).
    Prefer [pv] and [pv+utl] source problems over [utl].
    """
    slots = [int(x.strip()) for x in slots_str.split(",")]
    k_per_slot = max(1, min(10, int(per_slot or 1)))

    # Parse theme
    direct_technique = None
    if theme.startswith("direct:"):
        direct_technique = theme[len("direct:"):].strip().lower()

    d = data()

    # Collect eligible buckets
    eligible_buckets = []
    for b in d["buckets"]:
        # Skip Contest Sets domain
        if _norm(b["domain"]) == _norm("Contest Sets"):
            continue
        if direct_technique:
            title_lower = b["title"].lower()
            domain_lower = b["domain"].lower()
            cleaned_domain = domain_lower.replace("(except dp)", "").strip()
            if direct_technique in ("dp", "dynamic programming"):
                matches = "dynamic programming" in domain_lower or "dp" in title_lower.split() or "dp:" in title_lower or "dp " in title_lower or "dynamic programming" in title_lower
            else:
                matches = (direct_technique in title_lower) or (direct_technique in cleaned_domain)
            if not matches:
                continue
        eligible_buckets.append(b)

    # Build flat deduplicated candidate list
    exc_set = {_norm(x) for x in exclude if x} if exclude else set()
    solved = _solved_keys() if exclude_solved else set()

    seen_keys = set()
    candidates = []  # list of (problem_dict, bucket) tuples
    for b in eligible_buckets:
        for p in b["problems"]:
            k = _pkey(p)
            if k in seen_keys:
                continue
            if _is_excluded(p, exc_set):
                continue
            if k in solved:
                continue
            seen_keys.add(k)
            candidates.append((p, b))

    if seed is None:
        seed = random.randrange(10**6)

    # For each slot, find matching problems and sort by preference
    problems = []
    slot_candidates = []
    unfilled_slots = []
    used_keys = set()
    used_domains = set()

    def _to_round_entry(prob, bkt, slot_target, slot_idx):
        entry = dict(prob)
        entry["slot"] = slot_target
        entry["slot_index"] = slot_idx
        entry["bucket_id"] = bkt["bucket_id"]
        entry["bucket"] = bkt["title"]
        entry["domain"] = bkt["domain"]
        return entry

    for i, target in enumerate(slots):
        # Find candidates within tolerance
        slot_cands = []
        for p, b in candidates:
            diff = int(p.get("difficulty", 1200))
            delta = abs(diff - target)
            if delta <= 50:
                slot_cands.append((p, b, delta))

        if not slot_cands:
            # Widen to <= 100
            for p, b in candidates:
                diff = int(p.get("difficulty", 1200))
                delta = abs(diff - target)
                if delta <= 100:
                    slot_cands.append((p, b, delta))

        # Sort by preference tiers
        def sort_key(item):
            p, b, delta = item
            tier0 = _pick_tier(p)
            tier1 = 1 if p.get("difficulty_source", "catalog_tier") == "catalog_tier" else 0
            tier2 = delta
            tier3 = random.Random(f"{seed}:{_pkey(p)}").random()
            return (tier0, tier1, tier2, tier3)

        slot_cands.sort(key=sort_key)

        # Pick up to k_per_slot candidates not colliding on ID (or already-taken mixed domains)
        picked_list = []
        seen_slot_keys = set()
        for p, b, delta in slot_cands:
            k = _pkey(p)
            if k in used_keys or k in seen_slot_keys:
                continue
            if theme == "mixed" and _norm(b["domain"]) in used_domains:
                continue
            seen_slot_keys.add(k)
            picked_list.append((p, b))
            if len(picked_list) >= k_per_slot:
                break

        if picked_list:
            p0, b0 = picked_list[0]
            used_keys.add(_pkey(p0))
            if theme == "mixed":
                used_domains.add(_norm(b0["domain"]))
            problems.append(_to_round_entry(p0, b0, target, i))
            slot_candidates.append([_to_round_entry(cp, cb, target, i) for cp, cb in picked_list])
        else:
            unfilled_slots.append(i)
            slot_candidates.append([])

    res = {
        "slots": slots,
        "theme": theme,
        "seed": seed,
        "problems": problems,
        "unfilled_slots": unfilled_slots,
    }
    if k_per_slot > 1:
        res["per_slot"] = k_per_slot
        res["slot_candidates"] = slot_candidates
    return res


# ---------------------------------------------------------------- CLI Renderers


def _fmt_problem(p):
    star = "★" if p["is_starred"] else " "
    solves = f"dacu={p['dacu']}" if p["dacu"] else f"solves={p['solved_count']}"
    pid = p.get("id", "")
    diff = p.get("difficulty", 1200)
    return f"  {star} {p['number']:>3}. {p['source']:<9} [{pid:<14}] {p['name'][:44]:<44} {p['platform']:<11} diff={diff:<4} {solves}"


def _solved_note(r):
    return f"  |  Excluded (attempted in the Arena): {r['n_excluded_solved']}" if "n_excluded_solved" in r else ""


def _band(lo, hi):
    if lo is not None and hi is not None:
        return f"{lo}-{hi}"
    if lo is not None:
        return f">={lo}"
    return f"<={hi}" if hi is not None else "any"


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
    print(f"Total problems: {b['n_total_problems']}  |  Shown: {b['n_returned_problems']}  |  Tutorials: {b['n_resources']}  |  Templates: {b['n_templates']}{_solved_note(b)}")
    if b["absorbed_topics"]:
        abs_str = ", ".join(a["title"] for a in b["absorbed_topics"][:4])
        if len(b["absorbed_topics"]) > 4:
            abs_str += f" (+{len(b['absorbed_topics'])-4} more)"
        print(f"Absorbed topics: {abs_str}")
    print()

    for p in b["problems"]:
        print(_fmt_problem(p))
        if show_urls:
            print(f"        {p['url']}")


def _r_find(r):
    print(f"Query: {r['query']!r} -> {r['n_buckets']} matching buckets, {r['n_problems']} matching problems{_solved_note(r)}\n")
    if r["buckets"]:
        print("BUCKETS:")
        for b in r["buckets"]:
            print(f"  [{b['domain'][:18]:<18}] {b['title'][:50]:<50} ({b['n_problems']}p)")
        print()
    if r["problems"]:
        print("PROBLEMS:")
        for p in r["problems"]:
            star = "★" if p["is_starred"] else " "
            pid = p.get("id", "")
            diff = p.get("difficulty", 1200)
            print(f"  {star} {p['source']:<9} [{pid:<14}] {p['name'][:40]:<40} {p['platform']:<11} diff={diff:<4} in [{p['bucket'][:22]}]")
            print(f"        {p['url']}")


def _r_problem(p):
    star = " ★" if p["is_starred"] else ""
    print(f"\nProblem: {p['name']}{star}  (ID: {p.get('id', '')})")
    print(f"Platform: {p['platform']}  |  Difficulty: {p.get('difficulty', 1200)} ({p.get('difficulty_source', 'catalog_tier')})  |  Source: {p['source']}")
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


def _r_pick(r, show_urls):
    starred = "  |  Starred only" if r["starred_only"] else ""
    print(f"\nPractice set  ›  {r['n_returned_problems']} of {r['count']} requested  |  Difficulty: {_band(r['min_diff'], r['max_diff'])}  |  Seed: {r['seed']}{starred}{_solved_note(r)}")
    print("From: " + ", ".join(f"{b['title']} ({b['n_candidates']} candidates)" for b in r["buckets"]))
    print()
    for p in r["problems"]:
        print(f"{_fmt_problem(p):<115} in [{p['bucket']}]")
        if show_urls:
            print(f"        {p['url']}")


def _r_similar(r, show_urls):
    t = r["problem"]
    star = " ★" if t["is_starred"] else ""
    print(f"\nSimilar to: {t['name']}{star}  (ID: {t['id']})  |  Difficulty: {t['difficulty']}")
    print("Its buckets: " + "; ".join(f"[{b['domain']}] {b['title']}" for b in r["buckets"]))
    print(f"Matches: {r['n_matches']}  |  Shown: {r['n_returned_problems']}{_solved_note(r)}")
    print()
    for p in r["problems"]:
        print(f"{_fmt_problem(p):<115} shared={p['n_shared_buckets']} delta={p['difficulty_delta']:+d}")
        print(f"        in: {'; '.join(p['shared_buckets'])}")
        if show_urls:
            print(f"        {p['url']}")


def _r_round(r):
    print(f"\nThemeCP Round  ›  Theme: {r['theme']}  |  Seed: {r['seed']}")
    print(f"Slots: {r['slots']}")
    if r["unfilled_slots"]:
        print(f"Unfilled slots: {r['unfilled_slots']}")
    print()
    for p in r["problems"]:
        star = "★" if p.get("is_starred", False) else " "
        pid = p.get("id", "")
        diff = p.get("difficulty", 1200)
        print(f"  {star} slot={p['slot']:<5} [{pid:<14}] {p['name'][:44]:<44} {p['platform']:<11} diff={diff:<4} [{p['bucket']}] ({p['domain']})")
        print(f"        {p.get('url', '')}")


def _r_statement(r):
    print(f"\nProblem Statement & Samples: {r['title']} (ID: {r['id']})")
    print(f"Platform: {r['platform']}  |  Difficulty: {r['difficulty']}  |  Domain: {r['domain']}")
    print(f"Limits: {r['time_limit']} / {r['memory_limit']}")
    print(f"URL: {r['url']}")
    print("-" * 60)
    print("STATEMENT SUMMARY:")
    lines = r['statementSummary'].splitlines()
    if len(lines) > 25:
        print("\n".join(lines[:25]))
        print(f"\n[... {len(lines)-25} more lines in full statement ...]")
    else:
        print(r['statementSummary'])
    print("-" * 60)
    print("CONSTRAINTS:")
    print(r['constraints'])
    print("-" * 60)
    print(f"SAMPLES ({len(r['samples'])} cases):")
    for i, s in enumerate(r['samples'], 1):
        print(f"  Sample {i} Input:\n{s['input']}")
        print(f"  Sample {i} Output:\n{s['output']}")
        if i < len(r['samples']):
            print()


# ---------------------------------------------------------------- Main CLI


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        prog="catalog.py",
        description="Unified CP Curriculum Problem & Resource Catalog (progvar.fun + Ultimate Topic List)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="output machine-readable JSON")
    solved_help = "skip every problem the Arena reports as attempted (asks: arena.py attempted)"

    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("domains", parents=[common], help="list all high-level curriculum domains")

    p_bks = sub.add_parser("buckets", parents=[common], help="list buckets under a domain")
    p_bks.add_argument("domain", nargs="?", help="filter by domain (e.g. Graphs, Dynamic Programming)")
    p_bks.add_argument("--type", choices=["progvar_concept", "standalone_utl", "contest"], help="filter by bucket type")

    p_bk = sub.add_parser("bucket", parents=[common], help="list problems & resources in a bucket")
    p_bk.add_argument("name", help="bucket name or id (e.g. '0-1 BFS', 'Convex Hull Trick')")
    p_bk.add_argument("--source", choices=["pv", "utl", "all"], default="all", help="filter problems by source")
    p_bk.add_argument("--starred", action="store_true", help="show only curator-starred problems")
    p_bk.add_argument("--exclude", help="comma-separated list of problem IDs, names, or URLs to exclude")
    p_bk.add_argument("--min-diff", type=int, default=None, help="minimum CF-scale difficulty (e.g. 1000)")
    p_bk.add_argument("--max-diff", type=int, default=None, help="maximum CF-scale difficulty (e.g. 1600)")
    p_bk.add_argument("--limit", type=int, help="cap number of problems returned")
    p_bk.add_argument("--urls", action="store_true", help="include direct URLs in text output")
    p_bk.add_argument("--exclude-attempted", dest="exclude_solved", action="store_true", help=solved_help)

    p_f = sub.add_parser("find", parents=[common], help="search buckets and problems across both catalogs")
    p_f.add_argument("text", help="search keyword")
    p_f.add_argument("--source", choices=["pv", "utl", "all"], default="all", help="filter by source")
    p_f.add_argument("--starred", action="store_true", help="show only curator-starred problems")
    p_f.add_argument("--exclude", help="comma-separated list of problem IDs, names, or URLs to exclude")
    p_f.add_argument("--min-diff", type=int, default=None, help="minimum CF-scale difficulty (e.g. 1000)")
    p_f.add_argument("--max-diff", type=int, default=None, help="maximum CF-scale difficulty (e.g. 1600)")
    p_f.add_argument("--limit", type=int, default=20, help="max results")
    p_f.add_argument("--exclude-attempted", dest="exclude_solved", action="store_true", help=solved_help)

    p_p = sub.add_parser("problem", parents=[common], help="inspect a specific problem by ID, name, or URL")
    p_p.add_argument("name_or_url", help="problem ID, title, or URL")

    p_r = sub.add_parser("resources", parents=[common], help="fetch tutorial primers and code templates for a concept")
    p_r.add_argument("concept", help="bucket title or topic name (e.g. 'Convex Hull Trick', '2-SAT')")
    p_r.add_argument("--limit", type=int, default=10, help="max resources to return")

    p_pk = sub.add_parser("pick", parents=[common], help="mixed practice set: round-robin across buckets within a difficulty band")
    p_pk.add_argument("--buckets", required=True, help="semicolon-separated bucket names or ids (e.g. 'DP on Subsets;DP on Trees')")
    p_pk.add_argument("--count", type=int, default=3, help="number of problems to pick (default 3)")
    p_pk.add_argument("--min-diff", type=int, default=None, help="minimum CF-scale difficulty (e.g. 1000)")
    p_pk.add_argument("--max-diff", type=int, default=None, help="maximum CF-scale difficulty (e.g. 1600)")
    p_pk.add_argument("--starred", action="store_true", help="pick only curator-starred problems")
    p_pk.add_argument("--exclude", help="comma-separated list of problem IDs, names, or URLs to exclude")
    p_pk.add_argument("--exclude-attempted", dest="exclude_solved", action="store_true", help=solved_help)
    p_pk.add_argument("--seed", type=int, default=None, help="random seed for a reproducible pick (printed when omitted)")
    p_pk.add_argument("--urls", action="store_true", help="include direct URLs in text output")

    p_s = sub.add_parser("similar", parents=[common], help="problems sharing buckets with a given problem, closest difficulty first")
    p_s.add_argument("name_or_url", help="problem ID, title, or URL")
    p_s.add_argument("--limit", type=int, default=10, help="max results (default 10)")
    p_s.add_argument("--min-diff", type=int, default=None, help="minimum CF-scale difficulty (e.g. 1000)")
    p_s.add_argument("--max-diff", type=int, default=None, help="maximum CF-scale difficulty (e.g. 1600)")
    p_s.add_argument("--exclude", help="comma-separated list of problem IDs, names, or URLs to exclude")
    p_s.add_argument("--exclude-attempted", dest="exclude_solved", action="store_true", help=solved_help)
    p_s.add_argument("--urls", action="store_true", help="include direct URLs in text output")

    p_rnd = sub.add_parser("round", parents=[common], help="ThemeCP round: one problem per difficulty slot with theme constraints")
    p_rnd.add_argument("--slots", required=True, help="comma-separated target difficulties, e.g. '800,1000,1200,1200'")
    p_rnd.add_argument("--theme", default="random", help="'random', 'mixed', or 'direct:<technique>'")
    p_rnd.add_argument("--exclude", help="comma-separated list of problem IDs, names, or URLs to exclude")
    p_rnd.add_argument("--exclude-attempted", dest="exclude_solved", action="store_true", help=solved_help)
    p_rnd.add_argument("--seed", type=int, default=None, help="random seed for reproducible picks")
    p_rnd.add_argument("--per-slot", type=int, default=1, help="ranked candidates per slot (1-10, default 1)")

    p_stmt = sub.add_parser("statement", parents=[common], help="fetch statement, constraints, and sample test cases for a problem")
    p_stmt.add_argument("name_or_url", help="problem ID, title, or URL")

    args = ap.parse_args(argv)

    def parse_exclude(val):
        if not val:
            return None
        return [x.strip() for x in val.split(",") if x.strip()]

    if getattr(args, "exclude_solved", False) and arena_attempted() is None:
        print(f"Warning: the Arena could not report attempted problems ({arena_cli_path()} attempted); nothing excluded", file=sys.stderr)

    try:
        if args.cmd == "domains":
            res = domains()
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_domains(res)

        elif args.cmd == "buckets":
            res = buckets(args.domain, args.type)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_buckets(res)

        elif args.cmd == "bucket":
            exc = parse_exclude(args.exclude)
            res = bucket(args.name, args.source, args.starred, exc, args.min_diff, args.max_diff, args.limit, args.exclude_solved)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_bucket(res, args.urls)

        elif args.cmd == "find":
            exc = parse_exclude(args.exclude)
            res = find(args.text, args.limit, args.source, args.starred, exc, args.min_diff, args.max_diff, args.exclude_solved)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_find(res)

        elif args.cmd == "problem":
            res = problem(args.name_or_url)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_problem(res)

        elif args.cmd == "resources":
            res = resources(args.concept, args.limit)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_resources(res)

        elif args.cmd == "pick":
            res = pick(args.buckets, args.count, args.min_diff, args.max_diff, args.starred, parse_exclude(args.exclude), args.exclude_solved, args.seed)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_pick(res, args.urls)

        elif args.cmd == "similar":
            res = similar(args.name_or_url, args.limit, args.min_diff, args.max_diff, parse_exclude(args.exclude), args.exclude_solved)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_similar(res, args.urls)

        elif args.cmd == "round":
            exc = parse_exclude(args.exclude) if hasattr(args, 'exclude') and args.exclude else None
            res = round_pick(args.slots, args.theme, exc, args.exclude_solved if hasattr(args, 'exclude_solved') else False, args.seed, args.per_slot)
            if args.json:
                print(json.dumps(res, indent=2))
            else:
                _r_round(res)

        elif args.cmd == "statement":
            res = statement(args.name_or_url)
            if args.json:
                print(json.dumps(res, indent=2, ensure_ascii=False))
            else:
                _r_statement(res)

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
