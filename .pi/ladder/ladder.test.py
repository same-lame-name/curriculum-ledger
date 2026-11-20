#!/usr/bin/env python3
"""Unit tests verifying ladder.py round domains, paginated/filtered rounds, and factual slot/theme stats."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ladder  # noqa: E402


class LadderApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.orig_ladder = ladder.LADDER_FILE
        self.orig_rounds = ladder.ROUNDS_FILE
        ladder.LADDER_FILE = os.path.join(self.tmp.name, "ladder.json")
        ladder.ROUNDS_FILE = os.path.join(self.tmp.name, "rounds.json")

    def tearDown(self):
        ladder.LADDER_FILE = self.orig_ladder
        ladder.ROUNDS_FILE = self.orig_rounds
        self.tmp.cleanup()

    def test_open_round_domains_rounds_cursor_and_stats(self):
        # Round 1: AK with domains
        r1 = ladder.cmd_open_round(
            theme="mixed",
            problems=["p1", "p2", "p3", "p4"],
            limit_minutes=120,
            titles=["P1", "P2", "P3", "P4"],
            urls=["u1", "u2", "u3", "u4"],
            domains=["Implementation", "Math", "Graphs", "Dynamic Programming"],
        )
        self.assertEqual([p.get("domain") for p in r1["problems"]], ["Implementation", "Math", "Graphs", "Dynamic Programming"])
        ladder.cmd_close_round(r1["round_id"], ["p1", "p2", "p3", "p4"])
        for pid in ("p1", "p2", "p3", "p4"):
            ladder.cmd_label(r1["round_id"], pid, "clean")

        # Round 2: non-AK direct:dp -> upsolve waived
        r2 = ladder.cmd_open_round(
            theme="direct:dp",
            problems=["d1", "d2", "d3", "d4"],
            limit_minutes=120,
            domains=["Dynamic Programming"] * 4,
        )
        ladder.cmd_close_round(r2["round_id"], ["d1", "d2"])
        ladder.cmd_label(r2["round_id"], "d1", "clean")
        ladder.cmd_label(r2["round_id"], "d2", "slow-recognition")
        ladder.cmd_label(r2["round_id"], "d3", "wrong-idea")
        ladder.cmd_label(r2["round_id"], "d4", "not-reached")
        ladder.cmd_waive("switching to targeted dp course")

        # Pagination / cursor / filters on cmd_rounds
        all_rounds = ladder.cmd_rounds()
        self.assertEqual(len(all_rounds), 2)
        self.assertEqual(all_rounds[0]["problems"][0]["slot_index"], "P1")
        self.assertTrue(all_rounds[0]["problems"][0]["solved"])
        self.assertEqual(all_rounds[0]["problems"][0]["label"], "clean")

        after_r1 = ladder.cmd_rounds(since_round_id=r1["round_id"])
        self.assertEqual([r["round_id"] for r in after_r1], [r2["round_id"]])

        only_dp = ladder.cmd_rounds(theme="direct:dp")
        self.assertEqual(len(only_dp), 1)
        self.assertTrue(only_dp[0]["waived"])

        single = ladder.cmd_rounds(round_id=r1["round_id"])
        self.assertEqual(len(single), 1)
        self.assertEqual(single[0]["problems"][3]["domain"], "Dynamic Programming")

        # Enriched factual rollups in cmd_stats
        st = ladder.cmd_stats()
        self.assertEqual(st["total_rounds"], 2)
        self.assertEqual(st["waivers"], 1)
        self.assertEqual(st["slot_stats"]["P1"]["solve_rate"], 1.0)
        self.assertEqual(st["slot_stats"]["P3"]["solve_rate"], 0.5)
        self.assertEqual(st["slot_stats"]["P3"]["labels"], {"clean": 1, "wrong-idea": 1})
        self.assertEqual(st["theme_stats"]["mixed"]["ak_rate"], 1.0)
        self.assertEqual(st["theme_stats"]["direct:dp"]["waivers"], 1)


if __name__ == "__main__":
    unittest.main()
