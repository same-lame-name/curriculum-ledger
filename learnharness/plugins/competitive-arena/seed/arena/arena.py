#!/usr/bin/env python3
"""arena.py — Competitive Programming Arena rating, diff, and ledger engine.

Encapsulates all access to .pi/arena/rating.json, .pi/arena/history.json,
and .pi/arena/active/*. Pure Python 3 standard library.

Subcommands:
  python3 .pi/arena/arena.py standing [--course-slug <slug|none>]
  python3 .pi/arena/arena.py inspect [--problem-ids p1,p2] [--session-id <sid>] [--course-slug <slug|none>] [--limit 20]
  python3 .pi/arena/arena.py abandon_active [--active-dir .pi/arena/active]
  python3 .pi/arena/arena.py budget --difficulty 1400 [--rating 1200]
  python3 .pi/arena/arena.py close_session [--active-dir .pi/arena/active]
  python3 .pi/arena/arena.py record_verdict --problem-id <id> --verdict <AC|WA|TLE|MLE|RE|ABANDON> [--session-id <sid>]
  python3 .pi/arena/arena.py annotate --problem-id <id> --note "<one line>"
  python3 .pi/arena/arena.py attempted

This CLI and the arena_ledger / arena_run tools are the Arena's API. Other parts
of the setup (the catalog, helpers, the teacher) ask through them and never read
rating.json, history.json, or active/ directly, so the storage can change
without breaking anyone.

Guided runs may carry no difficulty or domain; such entries stay out of the
rating and (without a domain) out of the domain statistics.
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


def compute_time_budget_seconds(difficulty: int, student_rating: int = 1200) -> int:
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
        wa_base = max(0.60, 1.0 - 0.10 * max(0, int(wrong_attempts)))
        if hints_used >= 2:
            base, floor = 0.10, 0.03
        elif hints_used == 1:
            base, floor = 0.25, 0.08
        else:
            base, floor = wa_base, 0.15

        if overtime_seconds > 0:
            tau = 0.4 * float(max(300, budget_seconds or 1500))
            actual = max(floor, base * math.exp(-float(overtime_seconds) / tau))
        else:
            actual = base
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


FAILURE_VERDICTS = ("WA", "TLE", "MLE", "RE", "ABANDON")


def as_difficulty(value: Any) -> Optional[int]:
    """CF difficulty as int, or None when the run carried none (guided runs may omit it)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def normalize_thinking_seconds(raw_val: Any, duration_sec: int) -> Optional[int]:
    """Clamp optional thinking cut-point into [0, duration_sec]; return None when absent."""
    if raw_val is None or isinstance(raw_val, bool):
        return None
    try:
        val = int(raw_val)
    except (TypeError, ValueError):
        return None
    val = max(0, val)
    return min(val, max(0, duration_sec))


def ever_solved(entry: Dict[str, Any]) -> bool:
    """A problem stays solved once any attempt on it was accepted."""
    if (entry.get("verdict") or "").upper() == "AC":
        return True
    return any((pa.get("verdict") or "").upper() == "AC" for pa in entry.get("past_attempts", []) or [])


def was_engaged(entry: Dict[str, Any]) -> bool:
    """True when the student actively worked on or submitted the problem (not purely SKIPPED)."""
    v = (entry.get("verdict") or "").upper()
    if v not in ("", "PENDING", "SKIPPED"):
        return True
    return any((pa.get("verdict") or "").upper() not in ("", "PENDING", "SKIPPED") for pa in entry.get("past_attempts", []) or [])


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
        if not entry.get("domain"):
            continue  # guided run without a domain: kept in history, out of domain stats
        dom = normalize_domain(entry.get("domain"))
        pid = entry.get("problem_id", "")
        diff = as_difficulty(entry.get("difficulty"))
        domains[dom]["attempted"] += 1
        if ever_solved(entry):
            domains[dom]["solved"] += 1
            if diff is not None:
                solved_diffs[dom].append(diff)
                if diff > domains[dom]["max_solved_difficulty"]:
                    domains[dom]["max_solved_difficulty"] = diff
        if v == "AC":
            if pid in domains[dom]["recent_failures"]:
                domains[dom]["recent_failures"].remove(pid)
        elif v in FAILURE_VERDICTS:
            if pid and pid not in domains[dom]["recent_failures"]:
                domains[dom]["recent_failures"].append(pid)
                domains[dom]["recent_failures"] = domains[dom]["recent_failures"][-5:]

    for d, diffs in solved_diffs.items():
        if diffs:
            domains[d]["avg_solved_difficulty"] = int(round(sum(diffs) / len(diffs)))

    rating_state["domains"] = domains


def _default_practice_dir() -> str:
    return os.path.expanduser(os.environ.get("PI_PRACTICE_DIR", "~/playground/contests/practice"))


def _resolve_solution_path(
    pid: str, saved_path: Optional[str] = None, practice_dir: Optional[str] = None
) -> Optional[str]:
    """Return persisted solution_path if present, else probe practice_dir/{pid}.cpp when on disk."""
    if isinstance(saved_path, str) and saved_path.strip():
        return saved_path.strip()
    pdir = practice_dir or _default_practice_dir()
    cand = os.path.join(pdir, f"{pid}.cpp")
    return os.path.abspath(cand) if os.path.exists(cand) else None


def _matches_course_slug(entry_slug: Any, course_slug: Optional[str]) -> bool:
    """Match course_slug filter ('none'/'null'/'themecp' matches unaffiliated entries)."""
    if course_slug is None:
        return True
    norm = course_slug.strip()
    if norm in ("none", "null", "themecp"):
        return entry_slug in (None, "")
    return entry_slug == norm


def get_standing(course_slug: Optional[str] = None) -> Dict[str, Any]:
    rating_state = load_rating()
    history = load_history()

    solved_ids = []
    attempted_ids = []
    pending_submissions = []
    upsolve_queue = []
    notes = []

    scoped_entries = []
    for h in history:
        pid = h.get("problem_id")
        cat_id = h.get("catalog_id")
        v = (h.get("verdict") or "").upper()
        if was_engaged(h):
            if pid and pid not in attempted_ids:
                attempted_ids.append(pid)
            if cat_id and cat_id not in attempted_ids:
                attempted_ids.append(cat_id)
        if ever_solved(h):
            if pid and pid not in solved_ids:
                solved_ids.append(pid)
            if cat_id and cat_id not in solved_ids:
                solved_ids.append(cat_id)

        if not _matches_course_slug(h.get("course_slug"), course_slug):
            continue
        scoped_entries.append(h)

        for n in h.get("notes", []) or []:
            notes.append(
                {
                    "problem_id": pid,
                    "course_slug": h.get("course_slug"),
                    "purpose": h.get("purpose"),
                    "session_id": h.get("session_id"),
                    "note": n.get("note", ""),
                    "timestamp": n.get("timestamp"),
                }
            )
        if not ever_solved(h) and v in FAILURE_VERDICTS:
            upsolve_queue.append(
                {
                    "session_id": h.get("session_id"),
                    "course_slug": h.get("course_slug"),
                    "problem_id": pid,
                    "title": h.get("title"),
                    "url": h.get("url"),
                    "verdict": v,
                    "purpose": h.get("purpose"),
                    "timestamp": h.get("timestamp"),
                }
            )
        if v == "SUBMITTED":
            pending_submissions.append(
                {
                    "session_id": h.get("session_id"),
                    "course_slug": h.get("course_slug"),
                    "problem_id": pid,
                    "title": h.get("title"),
                    "difficulty": h.get("difficulty"),
                    "purpose": h.get("purpose"),
                    "timestamp": h.get("timestamp"),
                }
            )

    recent_compact = []
    for h in scoped_entries[-15:]:
        recent_compact.append(
            {
                "session_id": h.get("session_id"),
                "course_slug": h.get("course_slug"),
                "problem_id": h.get("problem_id"),
                "title": h.get("title"),
                "difficulty": h.get("difficulty"),
                "domain": h.get("domain"),
                "purpose": h.get("purpose"),
                "verdict": h.get("verdict"),
                "duration_seconds": h.get("duration_seconds"),
                "thinking_seconds": h.get("thinking_seconds"),
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

    notes.sort(key=lambda n: n.get("timestamp") or "")
    return {
        "global": rating_state["global"],
        "domains": rating_state["domains"],
        "course_slug_filter": course_slug,
        "solved_problem_ids": solved_ids,
        "attempted_problem_ids": attempted_ids,
        "pending_submissions": pending_submissions,
        "upsolve_queue": upsolve_queue,
        "recent_notes": notes[-5:],
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
                    "thinking_seconds": existing.get("thinking_seconds"),
                    "wrong_attempts": existing.get("wrong_attempts", 0),
                    "hints_used": existing.get("hints_used", 0),
                    "rating_delta": existing.get("rating_delta", 0),
                    "approach": existing.get("approach", ""),
                }
            )
            new_entry["past_attempts"] = past[-10:]
            new_entry["notes"] = list(existing.get("notes", []) or [])[-5:]
            history.pop(idx)
            history.append(new_entry)
            return
    new_entry["past_attempts"] = []
    new_entry.setdefault("notes", [])
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

    practice_dir = _default_practice_dir()

    enriched_problems = []
    timestamp = now_iso()

    session_total_budget = int(manifest.get("totalTimeBudgetSeconds") or 0)
    session_duration = int(
        raw_result.get("pooledElapsedSeconds")
        or raw_result.get("pooled_elapsed_seconds")
        or raw_result.get("durationSeconds")
        or raw_result.get("duration_seconds")
        or 0
    )
    session_overtime = max(0, session_duration - session_total_budget) if (timer_mode == "pooled" and session_total_budget > 0) else 0
    has_contest_engagement = grading_policy == "contest" and any(
        (result_by_id.get(mp["id"], {}).get("verdict") or "SKIPPED").upper() != "SKIPPED"
        or int(result_by_id.get(mp["id"], {}).get("durationSeconds") or result_by_id.get(mp["id"], {}).get("duration_seconds") or 0) > 0
        for mp in manifest.get("problems", [])
    )

    for mp in manifest.get("problems", []):
        pid = mp["id"]
        pr = result_by_id.get(pid, {})
        verdict = (pr.get("verdict") or "SKIPPED").upper()
        duration_sec = int(pr.get("durationSeconds") or pr.get("duration_seconds") or 0)
        raw_thinking = pr.get("thinkingSeconds") if pr.get("thinkingSeconds") is not None else pr.get("thinking_seconds")
        thinking_sec = normalize_thinking_seconds(raw_thinking, duration_sec)
        diff = as_difficulty(mp.get("difficulty"))
        budget_sec = int(mp.get("timeBudgetSeconds") or 0)
        if budget_sec <= 0 and timer_mode != "stopwatch" and diff is not None:
            budget_sec = compute_time_budget_seconds(diff, int(rating_state["global"]["rating"]))

        # For pooled timer mode, overtime is pool-relative (never shadowed by per-problem elapsed clocks).
        if timer_mode == "pooled":
            if session_overtime == 0:
                default_overtime = 0
            else:
                solved_at = int(pr.get("solvedAtSeconds") or pr.get("solved_at_seconds") or 0)
                if solved_at > 0 and session_total_budget > 0:
                    default_overtime = max(0, solved_at - session_total_budget)
                else:
                    default_overtime = min(duration_sec, session_overtime) if duration_sec > 0 else session_overtime
            overtime_sec = default_overtime
        elif timer_mode != "stopwatch" and budget_sec > 0:
            default_overtime = max(0, duration_sec - budget_sec)
            raw_ot = pr.get("overtimeSeconds") if pr.get("overtimeSeconds") is not None else pr.get("overtime_seconds")
            overtime_sec = int(raw_ot) if raw_ot is not None else default_overtime
        else:
            overtime_sec = 0
        solved_at_sec = int(pr.get("solvedAtSeconds") or pr.get("solved_at_seconds") or 0)
        wrong_attempts = int(pr.get("wrongAttempts") or pr.get("wrong_attempts") or 0)
        hints_used = int(pr.get("hintsUsed") or pr.get("hints_used") or 0)
        hints_viewed = pr.get("hintsViewed") or (mp.get("hints", [])[:hints_used])
        reflection = (pr.get("reflection") or "").strip()
        approach = (pr.get("approach") or "").strip()
        local_judge = pr.get("localJudge") if isinstance(pr.get("localJudge"), dict) else None
        attempts_timeline = pr.get("attempts") or []

        # Read final C++ code from scratch/<id>_final.cpp, or fallback to practice_dir/<id>.cpp
        final_scratch = os.path.join(scratch_dir, f"{pid}_final.cpp")
        final_code = read_text_safe(final_scratch)
        fallback_cpp = os.path.join(practice_dir, f"{pid}.cpp")
        if not final_code:
            final_code = read_text_safe(fallback_cpp)
        solution_path = os.path.abspath(fallback_cpp) if os.path.exists(fallback_cpp) else None

        attempt_diffs = compute_attempt_diffs(scratch_dir, pid, final_code)

        dom = normalize_domain(mp.get("domain")) if mp.get("domain") else None
        cur_rating = int(rating_state["global"]["rating"])
        problem_k = k_factor if diff is not None else 0  # no difficulty, no rating move

        if verdict == "SUBMITTED":
            # Student handed the code to the teacher. Ledger stays pending until record_verdict.
            elo_info = {
                "rated": problem_k > 0,
                "expected_score": 0.0,
                "actual_score": 0.0,
                "rating_before": cur_rating,
                "rating_after": cur_rating,
                "rating_delta": 0,
            }
            pending_verdict = True
        elif verdict in ("AC", "WA", "TLE", "MLE", "RE", "ABANDON") or (verdict == "SKIPPED" and has_contest_engagement and problem_k > 0):
            elo_info = compute_elo_delta(
                student_rating=cur_rating,
                problem_difficulty=diff if diff is not None else cur_rating,
                verdict=verdict,
                k_factor=problem_k,
                wrong_attempts=wrong_attempts,
                hints_used=hints_used,
                overtime_seconds=overtime_sec,
                budget_seconds=budget_sec,
            )
            apply_settled_verdict_to_global(rating_state, elo_info, verdict)
            pending_verdict = False
        else:
            # SKIPPED / untouched (outside engaged contest)
            elo_info = {
                "rated": False,
                "expected_score": 0.0,
                "actual_score": 0.0,
                "rating_before": cur_rating,
                "rating_after": cur_rating,
                "rating_delta": 0,
            }
            pending_verdict = False

        if verdict != "SKIPPED" or elo_info["rated"]:
            hist_entry = {
                "session_id": session_id,
                "course_slug": course_slug,
                "purpose": purpose,
                "grading_policy": grading_policy,
                "k_factor": problem_k,
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
                "thinking_seconds": thinking_sec,
                "budget_seconds": budget_sec,
                "overtime_seconds": overtime_sec,
                "solved_at_seconds": solved_at_sec,
                "wrong_attempts": wrong_attempts,
                "hints_used": hints_used,
                "rated": elo_info["rated"],
                "rating_before": elo_info["rating_before"],
                "rating_after": elo_info["rating_after"],
                "rating_delta": elo_info["rating_delta"],
                "reflection": reflection,
                "approach": approach,
                "local_judge": local_judge,
                "solution_path": solution_path,
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
                "thinking_seconds": thinking_sec,
                "budget_seconds": budget_sec,
                "overtime_seconds": overtime_sec,
                "solved_at_seconds": solved_at_sec,
                "wrong_attempts": wrong_attempts,
                "attempts": attempts_timeline,
                "hints_used": hints_used,
                "hints_viewed": hints_viewed,
                "reflection": reflection,
                "approach": approach,
                "local_judge": local_judge,
                "solution_path": solution_path,
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

    if as_difficulty(target.get("difficulty")) is None:
        k_factor = 0  # no difficulty on record: settle the verdict without a rating move

    if was_pending and k_factor > 0:
        elo_info = compute_elo_delta(
            student_rating=cur_rating,
            problem_difficulty=int(target.get("difficulty")),
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


def attempted() -> List[Dict[str, Any]]:
    """Every engaged problem in the ledger (excluding pure-SKIPPED unreached problems)."""
    out = []
    for h in load_history():
        if not was_engaged(h):
            continue
        out.append(
            {
                "problem_id": h.get("problem_id"),
                "catalog_id": h.get("catalog_id"),
                "url": h.get("url") or "",
                "verdict": (h.get("verdict") or "").upper(),
                "solved": ever_solved(h),
            }
        )
    return out


def annotate(problem_id: str, note: str) -> Dict[str, Any]:
    """Attach a one-line practice note to the latest ledger entry for a problem (last 5 kept)."""
    note = (note or "").strip()
    if not note:
        raise ValueError("annotate needs a non-empty note")
    history = load_history()
    target = None
    for entry in reversed(history):
        if entry.get("problem_id") == problem_id or entry.get("catalog_id") == problem_id:
            target = entry
            break
    if target is None:
        raise ValueError(f"Problem {problem_id!r} is not in the Arena ledger yet")
    notes = list(target.get("notes", []) or [])
    notes.append({"note": note, "timestamp": now_iso()})
    target["notes"] = notes[-5:]
    save_history(history)
    return {"ok": True, "problem_id": target.get("problem_id"), "note": note, "notes_count": len(target["notes"])}


def inspect_history(
    problem_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    course_slug: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Return compact ledger records filtered by problemIds, sessionId, or courseSlug."""
    history = load_history()
    practice_dir = _default_practice_dir()
    pid_set = {p.strip() for p in problem_ids if p and p.strip()} if problem_ids else None
    max_items = max(1, min(100, int(limit or 20)))

    matches: List[Dict[str, Any]] = []
    for h in reversed(history):
        pid = h.get("problem_id") or ""
        cat_id = h.get("catalog_id") or ""
        if pid_set is not None and pid not in pid_set and cat_id not in pid_set:
            continue
        if session_id and h.get("session_id") != session_id:
            continue
        if not _matches_course_slug(h.get("course_slug"), course_slug):
            continue

        matches.append(
            {
                "session_id": h.get("session_id"),
                "course_slug": h.get("course_slug"),
                "purpose": h.get("purpose"),
                "grading_policy": h.get("grading_policy"),
                "problem_id": pid,
                "catalog_id": cat_id or pid,
                "title": h.get("title", pid),
                "url": h.get("url", ""),
                "platform": h.get("platform", ""),
                "difficulty": as_difficulty(h.get("difficulty")),
                "domain": h.get("domain"),
                "verdict": h.get("verdict"),
                "pending_verdict": bool(h.get("pending_verdict", False)),
                "duration_seconds": int(h.get("duration_seconds") or 0),
                "thinking_seconds": normalize_thinking_seconds(h.get("thinking_seconds"), int(h.get("duration_seconds") or 0)),
                "budget_seconds": int(h.get("budget_seconds") or 0),
                "overtime_seconds": int(h.get("overtime_seconds") or 0),
                "solved_at_seconds": int(h.get("solved_at_seconds") or 0),
                "wrong_attempts": int(h.get("wrong_attempts") or 0),
                "hints_used": int(h.get("hints_used") or 0),
                "rated": bool(h.get("rated", False)),
                "rating_delta": int(h.get("rating_delta") or 0),
                "approach": (h.get("approach") or "").strip(),
                "reflection": (h.get("reflection") or "").strip(),
                "local_judge": h.get("local_judge"),
                "notes": h.get("notes") or [],
                "solution_path": _resolve_solution_path(pid, h.get("solution_path"), practice_dir),
                "past_attempts_count": len(h.get("past_attempts") or []),
                "timestamp": h.get("timestamp"),
            }
        )
        if len(matches) >= max_items:
            break
    return matches


def _parse_events_jsonl(events_path: str) -> Dict[str, Dict[str, Any]]:
    """Aggregate live Neovim Arena events per problem ID."""
    per_prob: Dict[str, Dict[str, Any]] = {}
    if not os.path.exists(events_path):
        return per_prob
    with open(events_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            raw = line.strip()
            if not raw:
                continue
            try:
                ev = json.loads(raw)
            except Exception:
                continue
            if not isinstance(ev, dict):
                continue
            ev_type = ev.get("event") or ev.get("type")
            pid = ev.get("problemId") or ev.get("problem_id")
            if not pid:
                continue
            st = per_prob.setdefault(
                pid,
                {
                    "verdict": None,
                    "wrongAttempts": 0,
                    "hintsUsed": 0,
                    "durationSeconds": 0,
                    "thinkingSeconds": None,
                    "solvedAtSeconds": 0,
                    "approach": "",
                    "localJudge": None,
                    "attempts": [],
                },
            )
            if ev_type == "approach_noted":
                st["approach"] = str(ev.get("approach") or "").strip()
                if st["thinkingSeconds"] is None and ev.get("elapsedSeconds") is not None:
                    st["thinkingSeconds"] = ev.get("elapsedSeconds")
            elif ev_type == "hint_used":
                st["hintsUsed"] = max(st["hintsUsed"], int(ev.get("hintsUsed") or (st["hintsUsed"] + 1)))
            elif ev_type == "judged":
                st["localJudge"] = {
                    "verdict": ev.get("verdict"),
                    "passed": ev.get("passed"),
                    "total": ev.get("total"),
                    "failedCase": ev.get("failedCase"),
                }
            elif ev_type == "attempt_logged":
                wa = int(ev.get("wrongAttempts") or (st["wrongAttempts"] + 1))
                st["wrongAttempts"] = max(st["wrongAttempts"], wa)
                st["attempts"].append(
                    {
                        "attempt": wa,
                        "verdict": ev.get("verdict"),
                        "elapsedSeconds": int(ev.get("elapsedSeconds") or ev.get("elapsed_seconds") or 0),
                    }
                )
            elif ev_type == "problem_verdict":
                v = str(ev.get("verdict") or "").upper()
                st["verdict"] = v or st["verdict"]
                dur = int(ev.get("durationSeconds") or ev.get("duration_seconds") or 0)
                st["durationSeconds"] = max(st["durationSeconds"], dur)
                if ev.get("thinkingSeconds") is not None:
                    st["thinkingSeconds"] = ev.get("thinkingSeconds")
                st["wrongAttempts"] = max(st["wrongAttempts"], int(ev.get("wrongAttempts") or 0))
                st["hintsUsed"] = max(st["hintsUsed"], int(ev.get("hintsUsed") or 0))
                if v == "AC":
                    st["solvedAtSeconds"] = int(ev.get("solvedAtSeconds") or dur)
    return per_prob


def abandon_active(active_dir: str = ACTIVE_DIR) -> Dict[str, Any]:
    """Settle an active Arena session prematurely: preserve settled verdicts, mark remainder ABANDON."""
    manifest_path = os.path.join(active_dir, "manifest.json")
    result_path = os.path.join(active_dir, "result.json")
    events_path = os.path.join(active_dir, "events.jsonl")

    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Active manifest not found at {manifest_path}")
    if os.path.exists(result_path):
        return close_session(active_dir)

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    elapsed = 0
    created_raw = manifest.get("createdAt")
    if isinstance(created_raw, str) and created_raw.strip():
        try:
            created_dt = datetime.datetime.fromisoformat(created_raw.strip().replace("Z", "+00:00"))
            elapsed = max(0, int((datetime.datetime.now(datetime.timezone.utc) - created_dt).total_seconds()))
        except Exception:
            elapsed = 0

    live = _parse_events_jsonl(events_path)
    result_problems: List[Dict[str, Any]] = []
    for mp in manifest.get("problems", []):
        pid = mp["id"]
        st = live.get(pid, {})
        verdict = st.get("verdict") or "ABANDON"
        result_problems.append(
            {
                "id": pid,
                "verdict": verdict,
                "durationSeconds": int(st.get("durationSeconds") or 0),
                "thinkingSeconds": st.get("thinkingSeconds"),
                "solvedAtSeconds": int(st.get("solvedAtSeconds") or 0),
                "wrongAttempts": int(st.get("wrongAttempts") or 0),
                "hintsUsed": int(st.get("hintsUsed") or 0),
                "approach": st.get("approach") or "",
                "localJudge": st.get("localJudge"),
                "attempts": st.get("attempts") or [],
            }
        )

    synthetic_result = {
        "sessionId": manifest.get("sessionId"),
        "status": "abandoned",
        "pooledElapsedSeconds": elapsed,
        "durationSeconds": elapsed,
        "problems": result_problems,
    }
    with open(result_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(synthetic_result, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return close_session(active_dir)


def main(argv: Optional[List[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="arena.py", description="Competitive Programming Arena Backend Engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_st = sub.add_parser("standing", help="Output student standing, domain stats, and solved problem IDs as JSON")
    p_st.add_argument("--course-slug", default=None, help="Optional course slug filter ('none' for ThemeCP/unaffiliated)")

    p_in = sub.add_parser("inspect", help="Inspect compact ledger entries filtered by problem IDs, session, or course")
    p_in.add_argument("--problem-ids", default=None, help="Comma-separated problem IDs")
    p_in.add_argument("--session-id", default=None)
    p_in.add_argument("--course-slug", default=None)
    p_in.add_argument("--limit", type=int, default=20)

    p_ab = sub.add_parser("abandon_active", help="Abandon active Arena session, keeping settled verdicts and settling remainder")
    p_ab.add_argument("--active-dir", default=ACTIVE_DIR)

    p_b = sub.add_parser("budget", help="Compute default time budget in seconds for a problem difficulty")
    p_b.add_argument("--difficulty", type=int, required=True)
    p_b.add_argument("--rating", type=int, default=None)

    p_c = sub.add_parser("close_session", help="Finalize active session, compute diffs & Elo, update ledger")
    p_c.add_argument("--active-dir", default=ACTIVE_DIR)

    p_rv = sub.add_parser("record_verdict", help="Settle a pending SUBMITTED verdict in the Arena ledger")
    p_rv.add_argument("--problem-id", required=True)
    p_rv.add_argument("--verdict", required=True)
    p_rv.add_argument("--session-id", default=None)

    p_an = sub.add_parser("annotate", help="Attach a one-line practice note to a problem in the ledger")
    p_an.add_argument("--problem-id", required=True)
    p_an.add_argument("--note", required=True)

    sub.add_parser("attempted", help="List every attempted problem (ids, judge URL, latest verdict) as JSON")

    args = ap.parse_args(argv)

    try:
        if args.cmd == "standing":
            print(json.dumps(get_standing(args.course_slug), indent=2, ensure_ascii=False))
        elif args.cmd == "inspect":
            pids = [p.strip() for p in args.problem_ids.split(",") if p.strip()] if args.problem_ids else None
            res = inspect_history(pids, args.session_id, args.course_slug, args.limit)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.cmd == "abandon_active":
            res = abandon_active(args.active_dir)
            print(json.dumps(res, indent=2, ensure_ascii=False))
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
        elif args.cmd == "annotate":
            res = annotate(args.problem_id, args.note)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.cmd == "attempted":
            print(json.dumps(attempted(), indent=2, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
