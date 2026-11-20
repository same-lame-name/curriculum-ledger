#!/usr/bin/env python3
"""Unit tests verifying anti-inflation OJ calibration, pooled overtime, and contest SKIPPED handling in arena.py."""

import json
import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arena  # noqa: E402


class ArenaScoringAndBudgetTests(unittest.TestCase):
    def test_budget_scales_with_difficulty_minus_rating_without_double_inflation(self):
        # Higher-rated solvers are held to tighter time expectations for the same difficulty.
        b_even = arena.compute_time_budget_seconds(1400, 1400)
        b_strong = arena.compute_time_budget_seconds(1200, 1600)
        b_stretch = arena.compute_time_budget_seconds(1600, 1200)
        self.assertEqual(b_even, 25 * 60)
        self.assertLess(b_strong, b_even)
        self.assertGreater(b_stretch, b_even)
        self.assertGreaterEqual(arena.compute_time_budget_seconds(800, 2400), 10 * 60)
        self.assertLessEqual(arena.compute_time_budget_seconds(2400, 800), 90 * 60)

    def test_no_one_second_cliff_and_strict_overtime_decay(self):
        b = 1500  # 25m on-level budget
        tau = 0.4 * b  # 10m
        on_time = arena.compute_elo_delta(1400, 1400, "AC", 24, overtime_seconds=0, budget_seconds=b)
        one_sec = arena.compute_elo_delta(1400, 1400, "AC", 24, overtime_seconds=1, budget_seconds=b)
        ten_min_late = arena.compute_elo_delta(1400, 1400, "AC", 24, overtime_seconds=600, budget_seconds=b)
        twenty_min_late = arena.compute_elo_delta(1400, 1400, "AC", 24, overtime_seconds=1200, budget_seconds=b)

        self.assertEqual(on_time["actual_score"], 1.0)
        self.assertAlmostEqual(one_sec["actual_score"], math.exp(-1.0 / tau), places=4)
        self.assertEqual(on_time["rating_delta"], one_sec["rating_delta"])
        # +10m and +20m overtime on-level must drop negative (anti-inflation!)
        self.assertLess(ten_min_late["rating_delta"], 0)
        self.assertLess(twenty_min_late["rating_delta"], ten_min_late["rating_delta"])

    def test_wrong_attempts_and_hints_preserve_strict_ordering(self):
        b = 1500
        for ot in (0, 1, 600, 1500, 20000):
            clean = arena.compute_elo_delta(1400, 1400, "AC", 24, wrong_attempts=0, hints_used=0, overtime_seconds=ot, budget_seconds=b)["actual_score"]
            sloppy = arena.compute_elo_delta(1400, 1400, "AC", 24, wrong_attempts=4, hints_used=0, overtime_seconds=ot, budget_seconds=b)["actual_score"]
            h1 = arena.compute_elo_delta(1400, 1400, "AC", 24, hints_used=1, overtime_seconds=ot, budget_seconds=b)["actual_score"]
            h2 = arena.compute_elo_delta(1400, 1400, "AC", 24, hints_used=2, overtime_seconds=ot, budget_seconds=b)["actual_score"]
            fail = arena.compute_elo_delta(1400, 1400, "ABANDON", 24, overtime_seconds=ot, budget_seconds=b)["actual_score"]
            if ot <= 900:
                self.assertGreater(clean, sloppy)
            else:
                self.assertGreaterEqual(clean, sloppy)
            self.assertGreater(sloppy, h1)
            self.assertGreater(h1, h2)
            self.assertGreater(h2, fail)


class ArenaSessionSettlementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.orig_rating = arena.RATING_FILE
        self.orig_history = arena.HISTORY_FILE
        arena.RATING_FILE = os.path.join(self.tmp.name, "rating.json")
        arena.HISTORY_FILE = os.path.join(self.tmp.name, "history.json")

    def tearDown(self):
        arena.RATING_FILE = self.orig_rating
        arena.HISTORY_FILE = self.orig_history
        self.tmp.cleanup()

    def _run_session(self, manifest: dict, result: dict) -> dict:
        active_dir = os.path.join(self.tmp.name, f"active_{manifest['sessionId']}")
        os.makedirs(os.path.join(active_dir, "scratch"), exist_ok=True)
        with open(os.path.join(active_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with open(os.path.join(active_dir, "result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f)
        return arena.close_session(active_dir)

    def test_pooled_overtime_reads_pooledElapsedSeconds_and_ignores_problem_overtime(self):
        manifest_ok = {
            "sessionId": "s1",
            "title": "ThemeCP Pool Under Limit",
            "purpose": "checkpoint",
            "gradingPolicy": "contest",
            "timerMode": "pooled",
            "totalTimeBudgetSeconds": 7200,
            "problems": [
                {"id": "p1", "title": "P1", "difficulty": 1200, "domain": "Math", "timeBudgetSeconds": 1500}
            ],
        }
        # Finished under 7200s pool despite 40m (2400s > 1500s) spent on P1 and per-problem overtimeSeconds=900
        res_ok = self._run_session(manifest_ok, {
            "pooledElapsedSeconds": 5400,
            "problems": [{"id": "p1", "verdict": "AC", "durationSeconds": 2400, "overtimeSeconds": 900, "solvedAtSeconds": 5400}],
        })
        self.assertEqual(res_ok["problems"][0]["overtime_seconds"], 0)
        self.assertEqual(res_ok["problems"][0]["rating_delta"], 12)

        # Finished 20m PAST 7200s pool -> must compute 1200s overtime even though per-problem duration < 1500s
        manifest_late = dict(manifest_ok, sessionId="s2")
        res_late = self._run_session(manifest_late, {
            "pooledElapsedSeconds": 8400,
            "problems": [{"id": "p1", "verdict": "AC", "durationSeconds": 1200, "overtimeSeconds": 0, "solvedAtSeconds": 8400}],
        })
        self.assertEqual(res_late["problems"][0]["overtime_seconds"], 1200)
        self.assertLess(res_late["problems"][0]["rating_delta"], 0)

    def test_contest_skipped_problems_are_rated_zero_without_burning_catalog(self):
        manifest = {
            "sessionId": "c1",
            "title": "ThemeCP Partial",
            "purpose": "checkpoint",
            "gradingPolicy": "contest",
            "timerMode": "pooled",
            "totalTimeBudgetSeconds": 7200,
            "problems": [
                {"id": "p1", "title": "P1", "difficulty": 800, "domain": "Implementation", "timeBudgetSeconds": 600},
                {"id": "p2", "title": "P2", "difficulty": 1400, "domain": "Graphs", "timeBudgetSeconds": 2100},
            ],
        }
        # P1 solved cleanly (+2 Elo at 1200), P2 untouched (SKIPPED -> rated loss ~ -6 Elo at 1200 vs 1400!)
        res = self._run_session(manifest, {
            "pooledElapsedSeconds": 7200,
            "problems": [
                {"id": "p1", "verdict": "AC", "durationSeconds": 600, "solvedAtSeconds": 600},
                {"id": "p2", "verdict": "SKIPPED", "durationSeconds": 0},
            ],
        })
        self.assertTrue(res["problems"][1]["rated"])
        self.assertLess(res["problems"][1]["rating_delta"], 0)
        self.assertLess(res["rating_delta"], 0)

        # P2 was never engaged, so catalog --exclude-attempted & domain attempts remain unpolluted!
        att_ids = [a["problem_id"] for a in arena.attempted()]
        self.assertEqual(att_ids, ["p1"])
        standing = arena.get_standing()
        self.assertEqual(standing["attempted_problem_ids"], ["p1"])
        self.assertEqual(standing["domains"]["Graphs"]["attempted"], 0)

    def test_aborted_empty_contest_and_drill_skipped_stay_unrated(self):
        # Aborted contest (no engagement at all) -> unrated
        m_abort = {
            "sessionId": "ab1",
            "title": "Aborted",
            "purpose": "checkpoint",
            "gradingPolicy": "contest",
            "timerMode": "pooled",
            "totalTimeBudgetSeconds": 7200,
            "problems": [{"id": "pa", "title": "PA", "difficulty": 1200, "domain": "Math"}],
        }
        r_abort = self._run_session(m_abort, {"pooledElapsedSeconds": 0, "problems": [{"id": "pa", "verdict": "SKIPPED"}]})
        self.assertFalse(r_abort["problems"][0]["rated"])
        self.assertEqual(r_abort["rating_delta"], 0)

        # Standalone drill with a skipped problem -> skipped remains unrated
        m_drill = {
            "sessionId": "dr1",
            "title": "Drill",
            "purpose": "drill",
            "gradingPolicy": "study",
            "timerMode": "per_problem",
            "problems": [
                {"id": "d1", "title": "D1", "difficulty": 1200, "domain": "DP"},
                {"id": "d2", "title": "D2", "difficulty": 1400, "domain": "Graphs"},
            ],
        }
        r_drill = self._run_session(m_drill, {
            "problems": [
                {"id": "d1", "verdict": "AC", "durationSeconds": 900},
                {"id": "d2", "verdict": "SKIPPED", "durationSeconds": 0},
            ],
        })
        self.assertTrue(r_drill["problems"][0]["rated"])
        self.assertFalse(r_drill["problems"][1]["rated"])

    def test_course_slug_standing_filter_solution_path_and_inspect(self):
        practice_dir = os.path.join(self.tmp.name, "practice_cpp")
        os.makedirs(practice_dir, exist_ok=True)
        with open(os.path.join(practice_dir, "dp_x.cpp"), "w", encoding="utf-8") as f:
            f.write("int main() { return 0; }\n")

        prev_pdir = os.environ.get("PI_PRACTICE_DIR")
        os.environ["PI_PRACTICE_DIR"] = practice_dir
        try:
            self._run_session(
                {
                    "sessionId": "s_dp",
                    "courseSlug": "dp",
                    "title": "DP Session",
                    "purpose": "drill",
                    "gradingPolicy": "study",
                    "timerMode": "per_problem",
                    "problems": [
                        {"id": "dp_x", "title": "DP X", "difficulty": 1200, "domain": "DP"},
                        {"id": "dp_miss", "title": "DP Miss", "difficulty": 1300, "domain": "DP"},
                    ],
                },
                {
                    "problems": [
                        {"id": "dp_x", "verdict": "AC", "durationSeconds": 600, "approach": "knapsack"},
                        {"id": "dp_miss", "verdict": "WA", "durationSeconds": 800, "wrongAttempts": 2},
                    ]
                },
            )
            self._run_session(
                {
                    "sessionId": "s_theme",
                    "courseSlug": None,
                    "title": "ThemeCP Round",
                    "purpose": "checkpoint",
                    "gradingPolicy": "contest",
                    "timerMode": "pooled",
                    "totalTimeBudgetSeconds": 7200,
                    "problems": [{"id": "th_miss", "title": "TH Miss", "difficulty": 1400, "domain": "Math"}],
                },
                {"pooledElapsedSeconds": 3000, "problems": [{"id": "th_miss", "verdict": "WA", "durationSeconds": 1200}]},
            )
            arena.annotate("dp_x", "recognized knapsack")

            # Global standing sees all solves + both upsolve items with origin tags
            st_all = arena.get_standing()
            self.assertIn("dp_x", st_all["solved_problem_ids"])
            self.assertEqual(len(st_all["upsolve_queue"]), 2)
            self.assertEqual(st_all["upsolve_queue"][0]["course_slug"], "dp")
            self.assertIsNone(st_all["upsolve_queue"][1]["course_slug"])

            # Course-scoped standing keeps global solves while filtering upsolve/history/notes
            st_dp = arena.get_standing(course_slug="dp")
            self.assertEqual([u["problem_id"] for u in st_dp["upsolve_queue"]], ["dp_miss"])
            self.assertEqual(len(st_dp["recent_notes"]), 1)

            st_theme = arena.get_standing(course_slug="none")
            self.assertEqual([u["problem_id"] for u in st_theme["upsolve_queue"]], ["th_miss"])
            self.assertIn("dp_x", st_theme["solved_problem_ids"])

            # Inspect filters & solution_path
            insp = arena.inspect_history(problem_ids=["dp_x"])
            self.assertEqual(len(insp), 1)
            self.assertEqual(insp[0]["course_slug"], "dp")
            self.assertEqual(insp[0]["approach"], "knapsack")
            self.assertTrue(insp[0]["solution_path"].endswith("dp_x.cpp"))

            # Inspect gracefully handles legacy entries missing solution_path/approach/notes
            with open(arena.HISTORY_FILE, "r+", encoding="utf-8") as f:
                hist = json.load(f)
                hist.append({"session_id": "legacy_1", "course_slug": "typical90", "problem_id": "typ_1", "verdict": "AC"})
                f.seek(0)
                json.dump(hist, f)
                f.truncate()
            leg = arena.inspect_history(course_slug="typical90")
            self.assertEqual(len(leg), 1)
            self.assertEqual(leg[0]["problem_id"], "typ_1")
            self.assertIsNone(leg[0]["solution_path"])
        finally:
            if prev_pdir is None:
                os.environ.pop("PI_PRACTICE_DIR", None)
            else:
                os.environ["PI_PRACTICE_DIR"] = prev_pdir

    def test_abandon_active_preserves_settled_verdicts_and_abandons_rest(self):
        active_dir = os.path.join(self.tmp.name, "active_abandon")
        os.makedirs(os.path.join(active_dir, "scratch"), exist_ok=True)
        manifest = {
            "sessionId": "ab_live_1",
            "courseSlug": None,
            "title": "ThemeCP Live",
            "purpose": "checkpoint",
            "gradingPolicy": "contest",
            "timerMode": "pooled",
            "totalTimeBudgetSeconds": 7200,
            "createdAt": "2026-11-11T10:00:00Z",
            "problems": [
                {"id": "p1", "title": "P1", "difficulty": 1000, "domain": "Math", "timeBudgetSeconds": 900},
                {"id": "p2", "title": "P2", "difficulty": 1200, "domain": "Graphs", "timeBudgetSeconds": 1500},
            ],
        }
        events = [
            json.dumps({"event": "approach_noted", "problemId": "p1", "approach": "prefix parity", "elapsedSeconds": 180}),
            json.dumps({"event": "problem_verdict", "problemId": "p1", "verdict": "AC", "durationSeconds": 420, "thinkingSeconds": 180, "wrongAttempts": 0, "hintsUsed": 0}),
            json.dumps({"event": "attempt_logged", "problemId": "p2", "verdict": "WA", "wrongAttempts": 1, "elapsedSeconds": 700}),
            "{partial json line",
        ]
        with open(os.path.join(active_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with open(os.path.join(active_dir, "events.jsonl"), "w", encoding="utf-8") as f:
            f.write("\n".join(events) + "\n")

        res = arena.abandon_active(active_dir)
        by_id = {p["id"]: p for p in res["problems"]}
        self.assertEqual(by_id["p1"]["verdict"], "AC")
        self.assertEqual(by_id["p1"]["approach"], "prefix parity")
        self.assertEqual(by_id["p1"]["thinking_seconds"], 180)
        self.assertEqual(by_id["p1"]["solved_at_seconds"], 420)
        self.assertEqual(by_id["p2"]["verdict"], "ABANDON")
        self.assertIsNone(by_id["p2"]["thinking_seconds"])
        self.assertEqual(by_id["p2"]["wrong_attempts"], 1)
        self.assertTrue(by_id["p2"]["rated"])
        self.assertLess(by_id["p2"]["rating_delta"], 0)

    def test_thinking_seconds_clamped_and_backwards_compatible_with_legacy(self):
        res = self._run_session(
            {
                "sessionId": "think_1",
                "title": "Thinking Cutoff",
                "purpose": "drill",
                "gradingPolicy": "study",
                "timerMode": "per_problem",
                "problems": [{"id": "t1", "title": "T1", "difficulty": 1500, "domain": "Math"}],
            },
            {"problems": [{"id": "t1", "verdict": "AC", "durationSeconds": 2164, "thinkingSeconds": 1800}]},
        )
        self.assertEqual(res["problems"][0]["thinking_seconds"], 1800)
        self.assertEqual(arena.inspect_history(problem_ids=["t1"])[0]["thinking_seconds"], 1800)

        # Clamps out-of-range thinkingSeconds without failing and leaves omitted entries None
        res_clamp = self._run_session(
            {
                "sessionId": "think_2",
                "title": "Clamp Test",
                "purpose": "drill",
                "gradingPolicy": "study",
                "timerMode": "per_problem",
                "problems": [
                    {"id": "t2", "title": "T2", "difficulty": 1500, "domain": "Math"},
                    {"id": "t3", "title": "T3", "difficulty": 1500, "domain": "Math"},
                ],
            },
            {
                "problems": [
                    {"id": "t2", "verdict": "AC", "durationSeconds": 500, "thinkingSeconds": 9999},
                    {"id": "t3", "verdict": "AC", "durationSeconds": 500},
                ]
            },
        )
        self.assertEqual(res_clamp["problems"][0]["thinking_seconds"], 500)
        self.assertIsNone(res_clamp["problems"][1]["thinking_seconds"])
        self.assertIsNone(arena.inspect_history(problem_ids=["t3"])[0]["thinking_seconds"])


if __name__ == "__main__":
    unittest.main()
