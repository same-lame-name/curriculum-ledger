#!/usr/bin/env python3
"""arena.py — Competitive Programming Arena rating, diff, and ledger engine.

Encapsulates all access to .pi/arena/rating.json, .pi/arena/history.json,
and .pi/arena/active/*. Pure Python 3 standard library.

Subcommands:
  python3 .pi/arena/arena.py standing
  python3 .pi/arena/arena.py budget --difficulty 1400 [--rating 1200]
  python3 .pi/arena/arena.py close_session [--active-dir .pi/arena/active]
  python3 .pi/arena/arena.py record_verdict --problem-id <id> --verdict <AC|WA|TLE|MLE|RE> [--session-id <sid>]
"""

import argparse
import datetime
import difflib
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
RATING_FILE = os.path.join(HERE, "rating.json")
HISTORY_FILE = os.path.join(HERE, "history.json")
ACTIVE_DIR = os.path.join(HERE, "active")

CANONICAL_DOMAINS = [
    "Dynamic Programming",
    "Data Structures",
    "Math",
    "Graphs",
    "Strings",
    "Geometry",
    "Implementation",
    "Algorithmic Techniques (except DP)",
]


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cf_tier(rating: int) -> str:
    if rating < 1200:
        return "Newbie (CF <1200)"
    if rating < 1400:
        return "Pupil (CF 1200-1399)"
    if rating < 1600:
        return "Specialist (CF 1400-1599)"
    if rating < 1900:
        return "Expert (CF 1600-1899)"
    if rating < 2100:
        return "Candidate Master (CF 1900-2099)"
    if rating < 2400:
        return "Master (CF 2100-2399)"
    return "Grandmaster (CF 2400+)"


def default_rating_state() -> Dict[str, Any]:
    domains = {}
    for d in CANONICAL_DOMAINS:
        domains[d] = {
            "solved": 0,
            "attempted": 0,
            "avg_solved_difficulty": 0,
            "max_solved_difficulty": 0,
            "recent_failures": [],
        }
    return {
        "version": 1,
        "global": {
            "rating": 1200,
            "tier": cf_tier(1200),
            "max_rating": 1200,
            "rated_solved": 0,
            "rated_attempted": 0,
            "unrated_solved": 0,
            "streak": 0,
            "last_updated": None,
        },
        "domains": domains,
    }


def load_rating() -> Dict[str, Any]:
    if not os.path.exists(RATING_FILE):
        state = default_rating_state()
        save_rating(state)
        return state
    try:
        with open(RATING_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "global" not in data or "domains" not in data:
            return default_rating_state()
        for d in CANONICAL_DOMAINS:
            data["domains"].setdefault(
                d,
                {
                    "solved": 0,
                    "attempted": 0,
                    "avg_solved_difficulty": 0,
                    "max_solved_difficulty": 0,
                    "recent_failures": [],
                },
            )
        return data
    except Exception:
        return default_rating_state()


def save_rating(state: Dict[str, Any]) -> None:
    os.makedirs(HERE, exist_ok=True)
    state["global"]["tier"] = cf_tier(int(state["global"].get("rating", 1200)))
    with open(RATING_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_history() -> List[Dict[str, Any]]:
    if not os.path.exists(HISTORY_FILE):
        save_history([])
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_history(history: List[Dict[str, Any]]) -> None:
    os.makedirs(HERE, exist_ok=True)
    with open(HISTORY_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")


def compute_time_budget_seconds(difficulty: int, student_rating: int) -> int:
    """Calibrated default time budget in seconds: clamp(round(25 * 2^((D - R)/400)) * 60, 600, 5400)."""
    minutes = round(25.0 * (2.0 ** ((difficulty - student_rating) / 400.0)))
    minutes = max(10, min(90, int(minutes)))
    return minutes * 60


def normalize_domain(domain: Optional[str]) -> str:
    if not domain:
        return "Algorithmic Techniques (except DP)"
    d_low = domain.strip().lower()
    for canon in CANONICAL_DOMAINS:
        if canon.lower() == d_low or d_low in canon.lower():
            return canon
    if "dp" in d_low or "dynamic" in d_low:
        return "Dynamic Programming"
    if "graph" in d_low or "tree" in d_low or "flow" in d_low:
        return "Graphs"
    if "data" in d_low or "segment" in d_low or "fenwick" in d_low:
        return "Data Structures"
    if "math" in d_low or "number" in d_low or "combinat" in d_low:
        return "Math"
    if "string" in d_low:
        return "Strings"
    if "geom" in d_low:
        return "Geometry"
    if "impl" in d_low:
        return "Implementation"
    return "Algorithmic Techniques (except DP)"


def k_factor_for_session(purpose: str, grading_policy: str) -> int:
    p = (purpose or "guided").lower()
    gp = (grading_policy or "").lower()
    if p == "guided" or gp == "practice":
        return 0
    if p == "checkpoint" or gp == "contest":
        return 24
    return 16


def compute_elo_delta(
    student_rating: int,
    problem_difficulty: int,
    verdict: str,
    k_factor: int,
    wrong_attempts: int = 0,
    hints_used: int = 0,
    overtime_seconds: int = 0,
    budget_seconds: int = 1500,
) -> Dict[str, Any]:
    """Anti-inflation CF-scale Elo calculation ([D10])."""
    if k_factor <= 0:
        return {
            "rated": False,
            "expected_score": 0.0,
            "actual_score": 0.0,
            "rating_before": student_rating,
            "rating_after": student_rating,
            "rating_delta": 0,
        }

    expected = 1.0 / (1.0 + (10.0 ** ((problem_difficulty - student_rating) / 400.0)))
    v = (verdict or "").upper()

    if v == "AC":
        if hints_used >= 2:
            actual = 0.10
        elif hints_used == 1:
            actual = 0.15 if overtime_seconds > 0 else 0.25
        elif overtime_seconds > 0:
            b = max(300, budget_seconds or 1500)
            actual = 0.45 * math.exp(-float(overtime_seconds) / float(b))
            actual = max(0.05, min(0.45, actual))
        else:
            actual = max(0.60, 1.0 - 0.10 * max(0, int(wrong_attempts)))
    else:
        actual = 0.0

    delta = int(round(k_factor * (actual - expected)))
    new_rating = max(600, min(3500, student_rating + delta))
    return {
        "rated": True,
        "expected_score": round(expected, 4),
        "actual_score": round(actual, 4),
        "rating_before": student_rating,
        "rating_after": new_rating,
        "rating_delta": new_rating - student_rating,
    }


def recompute_domain_stats(rating_state: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Recompute objective per-domain counters from history.json so re-attempts/verdict updates stay exact."""
    domains: Dict[str, Dict[str, Any]] = {}
    for d in CANONICAL_DOMAINS:
        domains[d] = {
            "solved": 0,
            "attempted": 0,
            "avg_solved_difficulty": 0,
            "max_solved_difficulty": 0,
            "recent_failures": [],
        }

    solved_diffs: Dict[str, List[int]] = {d: [] for d in CANONICAL_DOMAINS}
    for entry in history:
        v = (entry.get("verdict") or "").upper()
        if v in ("", "PENDING", "SKIPPED"):
            continue
        dom = normalize_domain(entry.get("domain"))
        pid = entry.get("problem_id", "")
        diff = int(entry.get("difficulty") or 1200)
        domains[dom]["attempted"] += 1
        if v == "AC":
            domains[dom]["solved"] += 1
            solved_diffs[dom].append(diff)
            if diff > domains[dom]["max_solved_difficulty"]:
                domains[dom]["max_solved_difficulty"] = diff
            if pid in domains[dom]["recent_failures"]:
                domains[dom]["recent_failures"].remove(pid)
        elif v in ("WA", "TLE", "MLE", "RE", "ABANDON"):
            if pid and pid not in domains[dom]["recent_failures"]:
                domains[dom]["recent_failures"].append(pid)
                domains[dom]["recent_failures"] = domains[dom]["recent_failures"][-5:]

    for d, diffs in solved_diffs.items():
        if diffs:
            domains[d]["avg_solved_difficulty"] = int(round(sum(diffs) / len(diffs)))

    rating_state["domains"] = domains


def get_standing() -> Dict[str, Any]:
    rating_state = load_rating()
    history = load_history()

    solved_ids = []
    attempted_ids = []
    pending_submissions = []

    for h in history:
        pid = h.get("problem_id")
        cat_id = h.get("catalog_id")
        v = (h.get("verdict") or "").upper()
        if pid and pid not in attempted_ids:
            attempted_ids.append(pid)
        if cat_id and cat_id not in attempted_ids:
            attempted_ids.append(cat_id)
        if v == "AC":
            if pid and pid not in solved_ids:
                solved_ids.append(pid)
            if cat_id and cat_id not in solved_ids:
                solved_ids.append(cat_id)
        elif v == "SUBMITTED":
            pending_submissions.append(
                {
                    "session_id": h.get("session_id"),
                    "problem_id": pid,
                    "title": h.get("title"),
                    "difficulty": h.get("difficulty"),
                    "purpose": h.get("purpose"),
                    "timestamp": h.get("timestamp"),
                }
            )

    recent_compact = []
    for h in history[-15:]:
        recent_compact.append(
            {
                "session_id": h.get("session_id"),
                "problem_id": h.get("problem_id"),
                "title": h.get("title"),
                "difficulty": h.get("difficulty"),
                "domain": h.get("domain"),
                "purpose": h.get("purpose"),
                "verdict": h.get("verdict"),
                "duration_seconds": h.get("duration_seconds"),
                "overtime_seconds": h.get("overtime_seconds", 0),
                "wrong_attempts": h.get("wrong_attempts", 0),
                "hints_used": h.get("hints_used", 0),
                "rated": h.get("rated", False),
                "rating_before": h.get("rating_before"),
                "rating_after": h.get("rating_after"),
                "rating_delta": h.get("rating_delta", 0),
                "pending_verdict": h.get("pending_verdict", False),
                "timestamp": h.get("timestamp"),
            }
        )

    rated_tail = [
        {
            "problem_id": h.get("problem_id"),
            "rating_before": int(h.get("rating_before", 1200)),
            "rating_after": int(h.get("rating_after", 1200)),
            "rating_delta": int(h.get("rating_delta", 0)),
            "verdict": h.get("verdict"),
            "timestamp": h.get("timestamp"),
        }
        for h in history
        if h.get("rated") and not h.get("pending_verdict") and h.get("rating_after") is not None
    ][-100:]

    return {
        "global": rating_state["global"],
        "domains": rating_state["domains"],
        "solved_problem_ids": solved_ids,
        "attempted_problem_ids": attempted_ids,
        "pending_submissions": pending_submissions,
        "recent_history": recent_compact,
        "rating_trajectory": rated_tail,
    }


def read_text_safe(path: str) -> str:
    if not path or not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return ""


def compute_attempt_diffs(scratch_dir: str, prob_id: str, final_code: str) -> List[Dict[str, Any]]:
    """Compute unified diffs across sequential attempt snapshots in active/scratch/."""
    if not os.path.isdir(scratch_dir):
        return []
    prefix = f"{prob_id}_attempt_"
    attempt_files = []
    for fname in os.listdir(scratch_dir):
        if fname.startswith(prefix) and fname.endswith(".cpp"):
            # Expected pattern: <id>_attempt_<num>_<verdict>.cpp
            rest = fname[len(prefix) : -4]
            parts = rest.split("_", 1)
            try:
                num = int(parts[0])
            except ValueError:
                num = 0
            verdict_tag = parts[1] if len(parts) > 1 else "ATTEMPT"
            attempt_files.append((num, verdict_tag, fname, os.path.join(scratch_dir, fname)))

    attempt_files.sort(key=lambda x: x[0])
    if not attempt_files:
        return []

    snapshots = []
    for num, vtag, fname, fpath in attempt_files:
        code = read_text_safe(fpath)
        if code:
            snapshots.append((f"attempt_{num}_{vtag}.cpp", code))

    if final_code:
        snapshots.append((f"{prob_id}_final.cpp", final_code))

    diffs = []
    for i in range(len(snapshots) - 1):
        from_name, from_code = snapshots[i]
        to_name, to_code = snapshots[i + 1]
        if from_code.strip() == to_code.strip():
            continue
        diff_lines = list(
            difflib.unified_diff(
                from_code.splitlines(),
                to_code.splitlines(),
                fromfile=from_name,
                tofile=to_name,
                lineterm="",
                n=2,
            )
        )
        if diff_lines:
            diffs.append(
                {
                    "from": from_name,
                    "to": to_name,
                    "diff": "\n".join(diff_lines[:160]),
                }
            )
    return diffs


def apply_settled_verdict_to_global(
    rating_state: Dict[str, Any],
    elo_info: Dict[str, Any],
    verdict: str,
) -> None:
    g = rating_state["global"]
    v = (verdict or "").upper()
    if elo_info.get("rated"):
        g["rating"] = elo_info["rating_after"]
        if g["rating"] > g.get("max_rating", 1200):
            g["max_rating"] = g["rating"]
        g["rated_attempted"] = int(g.get("rated_attempted", 0)) + 1
        if v == "AC":
            g["rated_solved"] = int(g.get("rated_solved", 0)) + 1
            g["streak"] = int(g.get("streak", 0)) + 1
        else:
            g["streak"] = 0
    else:
        if v == "AC":
            g["unrated_solved"] = int(g.get("unrated_solved", 0)) + 1
    g["tier"] = cf_tier(int(g["rating"]))
    g["last_updated"] = now_iso()


def upsert_history_entry(history: List[Dict[str, Any]], new_entry: Dict[str, Any]) -> None:
    """Keep 1 compact record per problem_id in history.json, archiving earlier sessions in past_attempts."""
    pid = new_entry.get("problem_id")
    for idx, existing in enumerate(history):
        if existing.get("problem_id") == pid:
            past = list(existing.get("past_attempts", []))
            past.append(
                {
                    "session_id": existing.get("session_id"),
                    "timestamp": existing.get("timestamp"),
                    "purpose": existing.get("purpose"),
                    "verdict": existing.get("verdict"),
                    "duration_seconds": existing.get("duration_seconds"),
                    "wrong_attempts": existing.get("wrong_attempts", 0),
                    "hints_used": existing.get("hints_used", 0),
                    "rating_delta": existing.get("rating_delta", 0),
                }
            )
            new_entry["past_attempts"] = past[-10:]
            history.pop(idx)
            history.append(new_entry)
            return
    new_entry["past_attempts"] = []
    history.append(new_entry)


def close_session(active_dir: str = ACTIVE_DIR) -> Dict[str, Any]:
    manifest_path = os.path.join(active_dir, "manifest.json")
    result_path = os.path.join(active_dir, "result.json")
    scratch_dir = os.path.join(active_dir, "scratch")

    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Active manifest not found at {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    raw_result: Dict[str, Any] = {}
    if os.path.exists(result_path):
        with open(result_path, "r", encoding="utf-8") as f:
            raw_result = json.load(f)

    rating_state = load_rating()
    history = load_history()

    rating_start = int(rating_state["global"].get("rating", 1200))
    session_id = manifest.get("sessionId") or raw_result.get("sessionId") or f"arena_{int(datetime.datetime.now().timestamp())}"
    course_slug = manifest.get("courseSlug")
    purpose = manifest.get("purpose", "guided")
    grading_policy = manifest.get("gradingPolicy", "practice" if purpose == "guided" else "study")
    timer_mode = manifest.get("timerMode", "stopwatch" if purpose == "guided" else "per_problem")
    k_factor = k_factor_for_session(purpose, grading_policy)

    result_by_id: Dict[str, Dict[str, Any]] = {}
    for pr in raw_result.get("problems", []):
        if isinstance(pr, dict) and pr.get("id"):
            result_by_id[pr["id"]] = pr

    practice_dir = os.path.expanduser(os.environ.get("PI_PRACTICE_DIR", "~/playground/contests/practice"))

    enriched_problems = []
    timestamp = now_iso()

    for mp in manifest.get("problems", []):
        pid = mp["id"]
        pr = result_by_id.get(pid, {})
        verdict = (pr.get("verdict") or "SKIPPED").upper()
        duration_sec = int(pr.get("durationSeconds") or pr.get("duration_seconds") or 0)
        budget_sec = int(mp.get("timeBudgetSeconds") or compute_time_budget_seconds(int(mp.get("difficulty", 1200)), int(rating_state["global"]["rating"])))
        overtime_sec = int(pr.get("overtimeSeconds") or pr.get("overtime_seconds") or max(0, duration_sec - budget_sec if timer_mode != "stopwatch" else 0))
        wrong_attempts = int(pr.get("wrongAttempts") or pr.get("wrong_attempts") or 0)
        hints_used = int(pr.get("hintsUsed") or pr.get("hints_used") or 0)
        hints_viewed = pr.get("hintsViewed") or (mp.get("hints", [])[:hints_used])
        reflection = (pr.get("reflection") or "").strip()
        attempts_timeline = pr.get("attempts") or []

        # Read final C++ code from scratch/<id>_final.cpp, or fallback to practice_dir/<id>.cpp
        final_scratch = os.path.join(scratch_dir, f"{pid}_final.cpp")
        final_code = read_text_safe(final_scratch)
        if not final_code:
            fallback_cpp = os.path.join(practice_dir, f"{pid}.cpp")
            final_code = read_text_safe(fallback_cpp)

        attempt_diffs = compute_attempt_diffs(scratch_dir, pid, final_code)

        diff = int(mp.get("difficulty") or 1200)
        dom = normalize_domain(mp.get("domain"))
        cur_rating = int(rating_state["global"]["rating"])

        if verdict == "SUBMITTED":
            # Student submitted directly to Teacher (<leader>ms). Ledger stays pending until record_verdict.
            elo_info = {
                "rated": k_factor > 0,
                "expected_score": 0.0,
                "actual_score": 0.0,
                "rating_before": cur_rating,
                "rating_after": cur_rating,
                "rating_delta": 0,
            }
            pending_verdict = True
        elif verdict in ("AC", "WA", "TLE", "MLE", "RE", "ABANDON"):
            elo_info = compute_elo_delta(
                student_rating=cur_rating,
                problem_difficulty=diff,
                verdict=verdict,
                k_factor=k_factor,
                wrong_attempts=wrong_attempts,
                hints_used=hints_used,
                overtime_seconds=overtime_sec,
                budget_seconds=budget_sec,
            )
            apply_settled_verdict_to_global(rating_state, elo_info, verdict)
            pending_verdict = False
        else:
            # SKIPPED / untouched
            elo_info = {
                "rated": False,
                "expected_score": 0.0,
                "actual_score": 0.0,
                "rating_before": cur_rating,
                "rating_after": cur_rating,
                "rating_delta": 0,
            }
            pending_verdict = False

        if verdict != "SKIPPED":
            hist_entry = {
                "session_id": session_id,
                "course_slug": course_slug,
                "purpose": purpose,
                "grading_policy": grading_policy,
                "k_factor": k_factor,
                "problem_id": pid,
                "catalog_id": mp.get("catalogId") or pid,
                "title": mp.get("title", pid),
                "url": mp.get("url", ""),
                "platform": mp.get("platform", ""),
                "difficulty": diff,
                "domain": dom,
                "verdict": verdict,
                "pending_verdict": pending_verdict,
                "duration_seconds": duration_sec,
                "budget_seconds": budget_sec,
                "overtime_seconds": overtime_sec,
                "wrong_attempts": wrong_attempts,
                "hints_used": hints_used,
                "rated": elo_info["rated"],
                "rating_before": elo_info["rating_before"],
                "rating_after": elo_info["rating_after"],
                "rating_delta": elo_info["rating_delta"],
                "reflection": reflection,
                "timestamp": timestamp,
            }
            upsert_history_entry(history, hist_entry)

        enriched_problems.append(
            {
                "id": pid,
                "catalog_id": mp.get("catalogId") or pid,
                "title": mp.get("title", pid),
                "url": mp.get("url", ""),
                "platform": mp.get("platform", ""),
                "difficulty": diff,
                "domain": dom,
                "verdict": verdict,
                "pending_verdict": pending_verdict,
                "duration_seconds": duration_sec,
                "budget_seconds": budget_sec,
                "overtime_seconds": overtime_sec,
                "wrong_attempts": wrong_attempts,
                "attempts": attempts_timeline,
                "hints_used": hints_used,
                "hints_viewed": hints_viewed,
                "reflection": reflection,
                "rated": elo_info["rated"],
                "rating_before": elo_info["rating_before"],
                "rating_after": elo_info["rating_after"],
                "rating_delta": elo_info["rating_delta"],
                "final_code": final_code,
                "attempt_diffs": attempt_diffs,
            }
        )

    recompute_domain_stats(rating_state, history)
    save_rating(rating_state)
    save_history(history)

    rating_end = int(rating_state["global"]["rating"])
    return {
        "session_id": session_id,
        "title": manifest.get("title", "Arena Session"),
        "course_slug": course_slug,
        "purpose": purpose,
        "grading_policy": grading_policy,
        "timer_mode": timer_mode,
        "status": raw_result.get("status", "completed"),
        "rating_before": rating_start,
        "rating_after": rating_end,
        "rating_delta": rating_end - rating_start,
        "tier": rating_state["global"]["tier"],
        "problems": enriched_problems,
        "timestamp": timestamp,
    }


def record_verdict(problem_id: str, verdict: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    v = (verdict or "").strip().upper()
    if v not in ("AC", "WA", "TLE", "MLE", "RE", "ABANDON"):
        raise ValueError(f"Unsupported verdict {verdict!r}; expected AC, WA, TLE, MLE, RE, or ABANDON")

    rating_state = load_rating()
    history = load_history()

    target = None
    for entry in reversed(history):
        if entry.get("problem_id") == problem_id or entry.get("catalog_id") == problem_id:
            if session_id and entry.get("session_id") != session_id:
                continue
            target = entry
            break

    if target is None:
        raise ValueError(f"Problem {problem_id!r} not found in Arena history ledger")

    was_pending = bool(target.get("pending_verdict", False)) or target.get("verdict") == "SUBMITTED"
    cur_rating = int(rating_state["global"].get("rating", 1200))
    k_factor = int(target.get("k_factor", 16 if target.get("rated") else 0))

    target["verdict"] = v
    target["pending_verdict"] = False
    target["timestamp"] = now_iso()

    if was_pending and k_factor > 0:
        elo_info = compute_elo_delta(
            student_rating=cur_rating,
            problem_difficulty=int(target.get("difficulty") or 1200),
            verdict=v,
            k_factor=k_factor,
            wrong_attempts=int(target.get("wrong_attempts") or 0),
            hints_used=int(target.get("hints_used") or 0),
            overtime_seconds=int(target.get("overtime_seconds") or 0),
            budget_seconds=int(target.get("budget_seconds") or 1500),
        )
        apply_settled_verdict_to_global(rating_state, elo_info, v)
        target["rated"] = True
        target["rating_before"] = elo_info["rating_before"]
        target["rating_after"] = elo_info["rating_after"]
        target["rating_delta"] = elo_info["rating_delta"]
    elif was_pending and k_factor == 0:
        apply_settled_verdict_to_global(
            rating_state,
            {"rated": False, "rating_before": cur_rating, "rating_after": cur_rating, "rating_delta": 0},
            v,
        )

    recompute_domain_stats(rating_state, history)
    save_rating(rating_state)
    save_history(history)

    return {
        "ok": True,
        "session_id": target.get("session_id"),
        "problem_id": target.get("problem_id"),
        "title": target.get("title"),
        "verdict": v,
        "rated": target.get("rated", False),
        "rating_before": target.get("rating_before", cur_rating),
        "rating_after": target.get("rating_after", cur_rating),
        "rating_delta": target.get("rating_delta", 0),
        "current_rating": rating_state["global"]["rating"],
        "tier": rating_state["global"]["tier"],
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="arena.py", description="Competitive Programming Arena Backend Engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("standing", help="Output student standing, domain stats, and solved problem IDs as JSON")

    p_b = sub.add_parser("budget", help="Compute default time budget in seconds for a problem difficulty")
    p_b.add_argument("--difficulty", type=int, required=True)
    p_b.add_argument("--rating", type=int, default=None)

    p_c = sub.add_parser("close_session", help="Finalize active session, compute diffs & Elo, update ledger")
    p_c.add_argument("--active-dir", default=ACTIVE_DIR)

    p_rv = sub.add_parser("record_verdict", help="Settle a pending SUBMITTED verdict in the Arena ledger")
    p_rv.add_argument("--problem-id", required=True)
    p_rv.add_argument("--verdict", required=True)
    p_rv.add_argument("--session-id", default=None)

    args = ap.parse_args(argv)

    try:
        if args.cmd == "standing":
            print(json.dumps(get_standing(), indent=2, ensure_ascii=False))
        elif args.cmd == "budget":
            r = args.rating if args.rating is not None else int(load_rating()["global"].get("rating", 1200))
            b = compute_time_budget_seconds(args.difficulty, r)
            print(json.dumps({"difficulty": args.difficulty, "rating": r, "budget_seconds": b}))
        elif args.cmd == "close_session":
            res = close_session(args.active_dir)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.cmd == "record_verdict":
            res = record_verdict(args.problem_id, args.verdict, args.session_id)
            print(json.dumps(res, indent=2, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
