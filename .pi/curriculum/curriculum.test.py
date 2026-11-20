#!/usr/bin/env python3
"""Unit tests for .pi/curriculum/curriculum.py — Stage 0/1/2 queries, appendix cross-refs, lookup, and validation."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import curriculum  # noqa: E402


STAGE1_DOC = """# Course guide: Tree DP Mastery

stage: 1
source: none
goal: Master subtree and rerooting DP on trees up to CF 1900.

## Strands

### 1. Subtree Dependency Order
- **Baseline:** Rooted tree size recurrence on 5 nodes -> answer: [5, 2, 2, 1, 1]
- **Boundary:** Postorder vs preorder failure case -> answer: parent reads stale 0

### 2. Rerooting Invariants
- **Baseline:** Sum of distances on a path of length 3 -> answer: [3, 2, 3]
- **Boundary:** Composite modulus prevents division -> answer: prefix/suffix products

## Map

```mermaid
graph TD
  C1["1. Subtree DP"] --> C2["2. Rerooting"]
```
"""

STAGE2_DOC = """# Lesson Guide: Tree DP Mastery

stage: 2
source: courses/tree-dp/sources/
goal: Cold-solve CF <= 1900 tree DP and rerooting problems.
probed: 2026-11-12 · 4 strands verified

## Intake baseline

- **Owns:** Recursive DFS postorder and basic subtree sums (Strand 1 baseline).
- **Edge:** Modular division error when rerooting mod composite M (Strand 2 boundary).
- **Habits:** Skips iterative stack check at N = 1e5.

## Map

```mermaid
graph TD
  C1["1. Subtree DP"] --> C2["2. Rerooting"]
```

## Custom Toolkit

Use iterative postorder when N = 1e5.

## Chapters

### 1. Subtree Boundaries
- **Tier:** core
- **Problems:**
  1. Independent Set (DPC P) [core, ~1600] — https://atcoder.jp/contests/dp/tasks/dp_p (courses/tree-dp/sources/dpc_p.md)
- **Rationale:** Establishes explicit parent-child boundary merges cleanly before rerooting removes root fixes.
- **Student delta:** DFS order owned; explicit iterative array needed at 1e5.
- **Focus:** Parent aggregates child subtree states across each edge once.
- **Owned when:** DPC P reaches AC with iterative postorder.
- **Hold back:**
  - DPC P: two-color product merge rule.

### 2. All-Roots Merging
- **Tier:** edge
- **Problems:**
  1. Subtree (DPC V) [edge, ~2200] — https://atcoder.jp/contests/dp/tasks/dp_v
- **Rationale:** Immediately tests the exact Strand 2 boundary failure where composite M breaks division.
- **Student delta:** Composite-mod prefix/suffix merge is new.
- **Focus:** Isolate each child branch's contribution via prefix and suffix products.
- **Owned when:** Derives prefix/suffix inversion replacement without division under composite M.
- **Source flags:**
  - DPC V editorial omits the iterative postorder note at N = 1e5.

## Practice

| After | Band | Mix | Reps | Pass Bar |
|---|---|---|---|---|
| Ch 2 | 1600-1900 | Subtree DP + Rerooting | 3 | 2/3 cold AC |

## Hold back

- **Ch. 2 — DPC V:** reroot using prefix/suffix products; never divide mod M.
"""


class CurriculumEngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.course_dir = os.path.join(self.tmp.name, "courses", "tree-dp")
        os.makedirs(self.course_dir, exist_ok=True)
        with open(os.path.join(self.tmp.name, ".active-course"), "w", encoding="utf-8") as f:
            f.write("tree-dp\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _write_guide(self, text: str) -> str:
        path = os.path.join(self.course_dir, "curriculum.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_missing_guide_stage_zero(self):
        ov = curriculum.cmd_overview(None, vault_root=self.tmp.name)
        self.assertFalse(ov["exists"])
        self.assertEqual(ov["stage"], 0)
        self.assertEqual(ov["course_slug"], "tree-dp")

    def test_stage1_intake_and_validate(self):
        path = self._write_guide(STAGE1_DOC)
        val = curriculum.cmd_validate(path)
        self.assertTrue(val["ok"], val)

        intake_all = curriculum.cmd_intake(None, vault_root=self.tmp.name)
        self.assertEqual(intake_all["stage"], 1)
        self.assertEqual(len(intake_all["strands"]), 2)

        filtered = curriculum.cmd_intake(None, strand="rerooting", vault_root=self.tmp.name)
        self.assertEqual(len(filtered["strands"]), 1)
        self.assertIn("Composite modulus", filtered["strands"][0]["body"])

    def test_stage2_overview_chapter_practice_lookup_and_validate(self):
        path = self._write_guide(STAGE2_DOC)
        val = curriculum.cmd_validate(path)
        self.assertTrue(val["ok"], val)
        self.assertEqual(val["chapters_count"], 2)

        # General overview discovers custom sections & chapter index without full chapter prose
        ov = curriculum.cmd_overview(None, vault_root=self.tmp.name)
        self.assertTrue(ov["exists"])
        self.assertEqual(ov["stage"], 2)
        sec_names = [s["title"] for s in ov["sections"]]
        self.assertIn("Custom Toolkit", sec_names)
        self.assertEqual(len(ov["chapters"]), 2)
        self.assertIn("DPC P", ov["chapters"][0]["problem_tokens"])

        # Chapter query bundles inline fields, source_file, practice triggers, and appendix hold-backs
        ch1 = curriculum.cmd_chapter(None, chapter=1, vault_root=self.tmp.name)
        self.assertEqual(ch1["problems"][0]["source_file"], "courses/tree-dp/sources/dpc_p.md")
        self.assertIn("two-color", ch1["hold_back"]["inline"])

        ch2 = curriculum.cmd_chapter(None, query="DPC V", vault_root=self.tmp.name)
        self.assertEqual(ch2["number"], 2)
        self.assertTrue(any("prefix/suffix products" in line for line in ch2["hold_back"]["appendix"]))
        self.assertTrue(any("Ch 2" in line for line in ch2["practice_triggers"]))
        self.assertIn("iterative postorder", ch2["source_flags"]["inline"])

        # Practice query returns triggers & covered chapters + intake baseline cautions
        pr = curriculum.cmd_practice(None, after_chapter=2, vault_root=self.tmp.name)
        self.assertEqual(len(pr["covered_chapters"]), 2)
        self.assertTrue(any("Ch 2" in line for line in pr["after_chapter_triggers"]))
        self.assertTrue(any("Modular division" in line for line in pr["baseline_cautions"]))

        # Lookup retrieves custom section cleanly and searches across sections with breadcrumbs
        sec = curriculum.cmd_lookup(None, section="Custom Toolkit", vault_root=self.tmp.name)
        self.assertIn("iterative postorder", sec["content"])

        srch = curriculum.cmd_lookup(None, query="composite", vault_root=self.tmp.name)
        self.assertTrue(any("Chapters > 2. All-Roots Merging" == m["breadcrumb"] for m in srch["matches"]))

    def test_validate_catches_bad_numbering_missing_owned_when_and_static_essay_bloat(self):
        bad_doc = """# Bad Guide

stage: 2
source: none
goal: test failures

## Intake baseline
- Owns: basic arrays

## Map
graph TD

## Chapters

### 2. Out Of Order
- **Problems:** cf_1A
- **Focus:** """ + ("x" * 900) + """

## Practice
End of Ch 2 practice
"""
        path = self._write_guide(bad_doc)
        val = curriculum.cmd_validate(path)
        self.assertFalse(val["ok"])
        joined = "\n".join(val["errors"])
        self.assertIn("sequential", joined)
        self.assertIn("Owned when", joined)
        self.assertIn("exceeds concise bound", joined)

        # Verify large courses (e.g. 15 chapters with 5 problems each) do NOT trigger arbitrary size failure
        many_chapters = ["# Big Course", "", "stage: 2", "source: none", "goal: Big course check", "probed: today", "", "## Intake baseline", "- Owns: basics", "", "## Map", "A --> B", "", "## Chapters", ""]
        for i in range(1, 16):
            many_chapters.extend([
                f"### {i}. Chapter {i}",
                f"- **Problems:** p{i}a, p{i}b, p{i}c",
                "- **Focus:** Crisp focus sentence.",
                "- **Owned when:** Gate check passed.",
                "",
            ])
        many_chapters.extend(["## Practice", "Every 3 chapters.", ""])
        ok_big = self._write_guide("\n".join(many_chapters))
        big_res = curriculum.cmd_validate(ok_big)
        self.assertTrue(big_res["ok"], big_res)
        self.assertEqual(big_res["chapters_count"], 15)


if __name__ == "__main__":
    unittest.main()
