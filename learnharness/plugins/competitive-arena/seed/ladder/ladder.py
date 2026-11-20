#!/usr/bin/env python3
"""ladder.py — ThemeCP Ladder state engine.

Owns the ladder level, round history, and upsolve gating for themed
competitive-programming rounds.  Pure Python 3 standard library.

Subcommands:
  python3 .pi/ladder/ladder.py status
  python3 .pi/ladder/ladder.py slots --level N
  python3 .pi/ladder/ladder.py open_round --theme THEME --problems P1,P2,P3,P4 [--titles T1,T2,T3,T4] [--urls U1,U2,U3,U4] [--domains D1,D2,D3,D4] --limit-minutes N
  python3 .pi/ladder/ladder.py close_round --round-id ID --solved P1,P2,...
  python3 .pi/ladder/ladder.py clear_upsolve --problem-id ID
  python3 .pi/ladder/ladder.py waive --reason "text"
  python3 .pi/ladder/ladder.py stats
  python3 .pi/ladder/ladder.py rounds [--limit N] [--since-round-id ID] [--theme THEME] [--round-id ID]
  python3 .pi/ladder/ladder.py label --round-id ID --problem-id PID --label LABEL
"""

import argparse
import datetime
import json
import os
import sys
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
LADDER_FILE = os.path.join(HERE, "ladder.json")
ROUNDS_FILE = os.path.join(HERE, "rounds.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_ladder_state() -> Dict[str, Any]:
    return {
        "version": 1,
        "level": 11,
        "peak_level": 11,
        "pending_upsolve": None,
    }


def load_ladder() -> Dict[str, Any]:
    if not os.path.exists(LADDER_FILE):
        state = default_ladder_state()
        save_ladder(state)
        return state
    try:
        with open(LADDER_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        for key in ("version", "level", "peak_level", "pending_upsolve"):
            if key not in data:
                return default_ladder_state()
        return data
    except Exception:
        return default_ladder_state()


def save_ladder(state: Dict[str, Any]) -> None:
    os.makedirs(HERE, exist_ok=True)
    with open(LADDER_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_rounds() -> List[Dict[str, Any]]:
    if not os.path.exists(ROUNDS_FILE):
        save_rounds([])
        return []
    try:
        with open(ROUNDS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_rounds(rounds: List[Dict[str, Any]]) -> None:
    os.makedirs(HERE, exist_ok=True)
    with open(ROUNDS_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rounds, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------------------
# Level formula
# ---------------------------------------------------------------------------

# Hardcoded entry ramp (levels 1–13)
_ENTRY_RAMP: Dict[int, tuple] = {
    1:  (900,  [800, 800, 800, 800]),
    2:  (950,  [800, 800, 800, 900]),
    3:  (1000, [800, 800, 900, 900]),
    4:  (1050, [800, 900, 900, 900]),
    5:  (1100, [800, 900, 900, 1000]),
    6:  (1125, [800, 900, 1000, 1000]),
    7:  (1150, [800, 1000, 1000, 1000]),
    8:  (1175, [800, 1000, 1000, 1100]),
    9:  (1200, [800, 1000, 1100, 1100]),
    10: (1250, [800, 1000, 1100, 1200]),
    11: (1300, [800, 1000, 1200, 1200]),
    12: (1350, [800, 1000, 1200, 1300]),
    13: (1400, [800, 1000, 1200, 1400]),
}


def level_info(level: int) -> Dict[str, Any]:
    """Return {level, performance, slots, time_limit_minutes} for a given level."""
    level = max(1, level)
    if level <= 13:
        perf, slots = _ENTRY_RAMP[level]
    else:
        # Closed-form formula for levels 13–97
        k = level - 13
        perf = 1400 + 25 * k
        q = k // 4
        r = k % 4
        r1 = 800  + 100 * q + (100 if r >= 1 else 0)
        r2 = 1000 + 100 * q + (100 if r >= 2 else 0)
        r3 = 1200 + 100 * q + (100 if r >= 3 else 0)
        r4 = 1400 + 100 * q
        slots = [r1, r2, r3, r4]

    # Adaptive round length
    r4 = slots[3]
    raw = 120 + 60 * (r4 - 1500) / 800
    clamped = max(120, min(180, raw))
    limit = round(clamped / 15) * 15

    return {
        "level": level,
        "performance": perf,
        "slots": slots,
        "time_limit_minutes": limit,
    }


# ---------------------------------------------------------------------------
# Subcommand implementations
# ---------------------------------------------------------------------------

def cmd_status() -> Dict[str, Any]:
    state = load_ladder()
    rounds = load_rounds()
    info = level_info(state["level"])

    closed = [r for r in rounds if r.get("closed_at") is not None]
    total_rounds = len(closed)
    total_ak = sum(1 for r in closed if r.get("ak"))
    ak_rate = round(total_ak / total_rounds, 4) if total_rounds > 0 else 0

    recent = []
    for r in closed[-10:]:
        recent.append({
            "round_id": r.get("round_id"),
            "level": r.get("level"),
            "theme": r.get("theme"),
            "ak": r.get("ak"),
            "solved_count": len(r.get("solved_in_time", [])),
            "level_before": r.get("level_before"),
            "level_after": r.get("level_after"),
            "timestamp": r.get("timestamp"),
        })

    return {
        "level": state["level"],
        "peak_level": state["peak_level"],
        "performance": info["performance"],
        "slots": info["slots"],
        "time_limit_minutes": info["time_limit_minutes"],
        "pending_upsolve": state["pending_upsolve"],
        "ak_rate": ak_rate,
        "recent_rounds": recent,
        "total_rounds": total_rounds,
        "total_ak": total_ak,
    }


def cmd_slots(level: int) -> Dict[str, Any]:
    return level_info(level)


def cmd_open_round(
    theme: str,
    problems: List[str],
    limit_minutes: int,
    titles: Optional[List[str]] = None,
    urls: Optional[List[str]] = None,
    domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    state = load_ladder()

    # Block if upsolve is pending
    if state["pending_upsolve"] is not None:
        pid = state["pending_upsolve"].get("problem_id", "?")
        return {
            "error": f"Upsolve pending for {pid}. Clear it with clear_upsolve, or waive with waive."
        }

    rounds = load_rounds()
    info = level_info(state["level"])

    ts = now_iso()
    round_id = f"themecp_{int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)}"

    prob_records = []
    for i, pid in enumerate(problems):
        rec: Dict[str, Any] = {
            "slot": info["slots"][i] if i < len(info["slots"]) else 0,
            "problem_id": pid,
            "title": titles[i] if titles and i < len(titles) else pid,
            "url": urls[i] if urls and i < len(urls) else "",
        }
        if domains and i < len(domains) and domains[i]:
            rec["domain"] = domains[i]
        prob_records.append(rec)

    record: Dict[str, Any] = {
        "round_id": round_id,
        "level": state["level"],
        "performance": info["performance"],
        "slots": info["slots"],
        "theme": theme,
        "time_limit_minutes": limit_minutes,
        "problems": prob_records,
        "solved_in_time": [],
        "ak": False,
        "level_before": state["level"],
        "level_after": state["level"],
        "upsolve": None,
        "waived": False,
        "waive_reason": "",
        "labels": {},
        "timestamp": ts,
        "closed_at": None,
    }

    rounds.append(record)
    save_rounds(rounds)

    return record


def cmd_close_round(round_id: str, solved: List[str]) -> Dict[str, Any]:
    state = load_ladder()
    rounds = load_rounds()

    target = None
    for r in rounds:
        if r.get("round_id") == round_id:
            target = r
            break
    if target is None:
        raise ValueError(f"Round {round_id!r} not found")

    all_pids = [p["problem_id"] for p in target["problems"]]
    ak = len(solved) == len(all_pids) and len(solved) > 0

    level_before = state["level"]
    if ak:
        state["level"] += 1
    else:
        state["level"] = max(1, state["level"] - 1)
    level_after = state["level"]

    if state["level"] > state["peak_level"]:
        state["peak_level"] = state["level"]

    # If not AK, flag lowest-index unsolved problem for upsolve
    upsolve_problem_id = None
    if not ak:
        for p in target["problems"]:
            if p["problem_id"] not in solved:
                upsolve_problem_id = p["problem_id"]
                upsolve_rec = {
                    "problem_id": p["problem_id"],
                    "status": "pending",
                    "cleared_at": None,
                }
                target["upsolve"] = upsolve_rec
                state["pending_upsolve"] = {
                    "round_id": round_id,
                    "problem_id": p["problem_id"],
                    "problem_title": p.get("title", p["problem_id"]),
                    "problem_url": p.get("url", ""),
                    "flagged_at": now_iso(),
                }
                break

    target["solved_in_time"] = solved
    target["ak"] = ak
    target["level_before"] = level_before
    target["level_after"] = level_after
    target["closed_at"] = now_iso()

    save_ladder(state)
    save_rounds(rounds)

    return {
        "round_id": round_id,
        "ak": ak,
        "solved_count": len(solved),
        "total": len(all_pids),
        "level_before": level_before,
        "level_after": level_after,
        "upsolve_problem_id": upsolve_problem_id,
    }


def cmd_clear_upsolve(problem_id: str) -> Dict[str, Any]:
    state = load_ladder()
    if state["pending_upsolve"] is None:
        raise ValueError("No pending upsolve to clear")
    if state["pending_upsolve"].get("problem_id") != problem_id:
        raise ValueError(
            f"Pending upsolve is for {state['pending_upsolve']['problem_id']!r}, not {problem_id!r}"
        )

    round_id = state["pending_upsolve"]["round_id"]
    state["pending_upsolve"] = None

    rounds = load_rounds()
    for r in rounds:
        if r.get("round_id") == round_id and r.get("upsolve"):
            r["upsolve"]["status"] = "cleared"
            r["upsolve"]["cleared_at"] = now_iso()
            break

    save_ladder(state)
    save_rounds(rounds)

    return {"ok": True, "problem_id": problem_id, "round_id": round_id}


def cmd_waive(reason: str) -> Dict[str, Any]:
    state = load_ladder()
    if state["pending_upsolve"] is None:
        raise ValueError("No pending upsolve to waive")

    round_id = state["pending_upsolve"]["round_id"]
    problem_id = state["pending_upsolve"]["problem_id"]
    state["pending_upsolve"] = None

    rounds = load_rounds()
    for r in rounds:
        if r.get("round_id") == round_id:
            r["waived"] = True
            r["waive_reason"] = reason
            if r.get("upsolve"):
                r["upsolve"]["status"] = "waived"
            break

    save_ladder(state)
    save_rounds(rounds)

    return {"ok": True, "problem_id": problem_id, "round_id": round_id, "reason": reason}


def _compact_round_view(r: Dict[str, Any]) -> Dict[str, Any]:
    """Project a round into a compact diagnostic record."""
    solved_set = set(r.get("solved_in_time") or [])
    labels = r.get("labels") or {}
    probs = []
    for idx, p in enumerate(r.get("problems") or []):
        pid = p.get("problem_id", "")
        probs.append({
            "slot_index": f"P{idx + 1}",
            "slot": p.get("slot"),
            "problem_id": pid,
            "title": p.get("title", pid),
            "domain": p.get("domain"),
            "solved": pid in solved_set,
            "label": labels.get(pid),
        })
    return {
        "round_id": r.get("round_id"),
        "timestamp": r.get("timestamp"),
        "closed_at": r.get("closed_at"),
        "level": r.get("level"),
        "level_before": r.get("level_before"),
        "level_after": r.get("level_after"),
        "slots": r.get("slots"),
        "theme": r.get("theme"),
        "time_limit_minutes": r.get("time_limit_minutes"),
        "ak": r.get("ak"),
        "waived": r.get("waived", False),
        "waive_reason": r.get("waive_reason", ""),
        "upsolve": r.get("upsolve"),
        "problems": probs,
    }


def cmd_rounds(
    limit: int = 20,
    since_round_id: Optional[str] = None,
    theme: Optional[str] = None,
    round_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Query rounds with optional cursor, theme, or single-round filter."""
    rounds = load_rounds()
    if round_id:
        for r in rounds:
            if r.get("round_id") == round_id:
                return [_compact_round_view(r)]
        return []

    filtered = rounds
    if since_round_id:
        for idx, r in enumerate(rounds):
            if r.get("round_id") == since_round_id:
                filtered = rounds[idx + 1:]
                break

    if theme:
        filtered = [r for r in filtered if r.get("theme") == theme]

    max_items = max(1, int(limit or 20))
    return [_compact_round_view(r) for r in filtered[-max_items:]]


def cmd_stats() -> Dict[str, Any]:
    state = load_ladder()
    rounds = load_rounds()

    closed = [r for r in rounds if r.get("closed_at") is not None]
    total_rounds = len(closed)
    total_ak = sum(1 for r in closed if r.get("ak"))
    ak_rate = round(total_ak / total_rounds, 4) if total_rounds > 0 else 0
    waivers = sum(1 for r in closed if r.get("waived"))

    rounds_by_theme: Dict[str, int] = {}
    theme_acc: Dict[str, Dict[str, int]] = {}
    slot_acc: Dict[str, Dict[str, Any]] = {}

    for r in closed:
        t = r.get("theme", "unknown")
        rounds_by_theme[t] = rounds_by_theme.get(t, 0) + 1
        ta = theme_acc.setdefault(t, {"rounds": 0, "ak_count": 0, "waivers": 0})
        ta["rounds"] += 1
        if r.get("ak"):
            ta["ak_count"] += 1
        if r.get("waived"):
            ta["waivers"] += 1

        solved_set = set(r.get("solved_in_time") or [])
        labels = r.get("labels") or {}
        for idx, p in enumerate(r.get("problems") or []):
            skey = f"P{idx + 1}"
            sa = slot_acc.setdefault(skey, {"attempts": 0, "solved": 0, "labels": {}})
            sa["attempts"] += 1
            pid = p.get("problem_id", "")
            if pid in solved_set:
                sa["solved"] += 1
            lbl = labels.get(pid)
            if lbl:
                sa["labels"][lbl] = sa["labels"].get(lbl, 0) + 1

    slot_stats: Dict[str, Any] = {}
    for skey, sa in slot_acc.items():
        att = sa["attempts"]
        slot_stats[skey] = {
            "attempts": att,
            "solved": sa["solved"],
            "solve_rate": round(sa["solved"] / att, 4) if att > 0 else 0,
            "labels": sa["labels"],
        }

    theme_stats: Dict[str, Any] = {}
    for t, ta in theme_acc.items():
        cnt = ta["rounds"]
        theme_stats[t] = {
            "rounds": cnt,
            "ak_count": ta["ak_count"],
            "ak_rate": round(ta["ak_count"] / cnt, 4) if cnt > 0 else 0,
            "waivers": ta["waivers"],
        }

    last_20 = []
    for r in closed[-20:]:
        last_20.append({
            "round_id": r.get("round_id"),
            "level": r.get("level"),
            "theme": r.get("theme"),
            "ak": r.get("ak"),
            "solved_count": len(r.get("solved_in_time", [])),
        })

    return {
        "level": state["level"],
        "peak_level": state["peak_level"],
        "ak_rate": ak_rate,
        "total_rounds": total_rounds,
        "waivers": waivers,
        "rounds_by_theme": rounds_by_theme,
        "slot_stats": slot_stats,
        "theme_stats": theme_stats,
        "last_20_rounds": last_20,
    }


def cmd_label(round_id: str, problem_id: str, label: str) -> Dict[str, Any]:
    valid_labels = ("clean", "slow-recognition", "wrong-idea", "buggy-implementation", "not-reached")
    if label not in valid_labels:
        raise ValueError(f"Label must be one of {valid_labels}, got {label!r}")

    rounds = load_rounds()
    target = None
    for r in rounds:
        if r.get("round_id") == round_id:
            target = r
            break
    if target is None:
        raise ValueError(f"Round {round_id!r} not found")

    if "labels" not in target:
        target["labels"] = {}
    target["labels"][problem_id] = label

    save_rounds(rounds)

    return {"ok": True, "round_id": round_id, "problem_id": problem_id, "label": label}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(prog="ladder.py", description="ThemeCP Ladder State Engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Print current ladder status as JSON")

    p_slots = sub.add_parser("slots", help="Print slot info for a given level")
    p_slots.add_argument("--level", type=int, required=True)

    p_open = sub.add_parser("open_round", help="Open a new ladder round")
    p_open.add_argument("--theme", required=True)
    p_open.add_argument("--problems", required=True, help="Comma-separated problem IDs")
    p_open.add_argument("--titles", default=None, help="Comma-separated titles (same order as problems)")
    p_open.add_argument("--urls", default=None, help="Comma-separated URLs (same order as problems)")
    p_open.add_argument("--domains", default=None, help="Comma-separated canonical domains (same order as problems)")
    p_open.add_argument("--limit-minutes", type=int, required=True)

    p_close = sub.add_parser("close_round", help="Close a round with solve results")
    p_close.add_argument("--round-id", required=True)
    p_close.add_argument("--solved", required=True, help="Comma-separated solved problem IDs (empty string for 0)")

    p_clear = sub.add_parser("clear_upsolve", help="Clear a pending upsolve obligation")
    p_clear.add_argument("--problem-id", required=True)

    p_waive = sub.add_parser("waive", help="Waive a pending upsolve obligation")
    p_waive.add_argument("--reason", required=True)

    sub.add_parser("stats", help="Print aggregate statistics as JSON")

    p_rounds = sub.add_parser("rounds", help="List compact round records with optional filters")
    p_rounds.add_argument("--limit", type=int, default=20)
    p_rounds.add_argument("--since-round-id", default=None)
    p_rounds.add_argument("--theme", default=None)
    p_rounds.add_argument("--round-id", default=None)

    p_label = sub.add_parser("label", help="Label a problem in a round")
    p_label.add_argument("--round-id", required=True)
    p_label.add_argument("--problem-id", required=True)
    p_label.add_argument("--label", required=True)

    args = ap.parse_args(argv)

    try:
        if args.cmd == "status":
            result = cmd_status()
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "slots":
            result = cmd_slots(args.level)
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "open_round":
            problems = [p.strip() for p in args.problems.split(",") if p.strip()]
            titles = [t.strip() for t in args.titles.split(",") if t.strip()] if args.titles else None
            urls = [u.strip() for u in args.urls.split(",") if u.strip()] if args.urls else None
            domains = [d.strip() for d in args.domains.split(",")] if args.domains else None
            result = cmd_open_round(args.theme, problems, args.limit_minutes, titles, urls, domains)
            if "error" in result:
                print(json.dumps(result), file=sys.stderr)
                return 1
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "close_round":
            solved = [s.strip() for s in args.solved.split(",") if s.strip()]
            result = cmd_close_round(args.round_id, solved)
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "clear_upsolve":
            result = cmd_clear_upsolve(args.problem_id)
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "waive":
            result = cmd_waive(args.reason)
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "stats":
            result = cmd_stats()
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "rounds":
            result = cmd_rounds(args.limit, args.since_round_id, args.theme, args.round_id)
            print(json.dumps(result, indent=2, ensure_ascii=False))

        elif args.cmd == "label":
            result = cmd_label(args.round_id, args.problem_id, args.label)
            print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
