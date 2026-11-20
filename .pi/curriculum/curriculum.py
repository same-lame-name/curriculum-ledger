#!/usr/bin/env python3
"""curriculum.py — Structured Curriculum Guide Query & Validation Engine.

Encapsulates read/query access to courses/<slug>/curriculum.md so `teacher:teach`
retrieves general structure (`overview`), Stage 1 diagnostic probes (`intake`),
focused chapter bundles (`chapter`), checkpoint blueprints (`practice`), and
cross-cutting lookups (`lookup`) without dumping 70-100 KB guides into context.

Subcommands:
  python3 .pi/curriculum/curriculum.py overview --course dp [--json]
  python3 .pi/curriculum/curriculum.py intake --course dp [--strand NAME] [--json]
  python3 .pi/curriculum/curriculum.py chapter --course dp (--chapter N | --query ID) [--json]
  python3 .pi/curriculum/curriculum.py practice --course dp [--after-chapter N] [--json]
  python3 .pi/curriculum/curriculum.py lookup --course dp [--section NAME] [--subsection SUB] [--query Q] [--json]
  python3 .pi/curriculum/curriculum.py validate <path/to/curriculum.md> [--json]
"""

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_VAULT_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))

# Generous limits ONLY on fixed-shape fields; scaled lists (chapters, problems, hold_back, source_flags) are unbounded.
HEADER_CHAR_LIMIT = 1500
STATIC_FIELD_LIMITS = {
    "rationale": 1200,
    "student_delta": 900,
    "focus": 800,
    "owned_when": 800,
}

# Field key aliases supported cleanly across retrofitted and new guides.
FIELD_ALIASES = {
    "problems": "problems",
    "problems (teaching order)": "problems",
    "tier": "tier",
    "rationale": "rationale",
    "order": "rationale",
    "student delta": "student_delta",
    "for this student": "student_delta",
    "focus": "focus",
    "the idea": "focus",
    "why the naive way breaks & the core idea": "focus",
    "owned when": "owned_when",
    "hold back": "hold_back",
    "source flags": "source_flags",
    "source notes": "source_flags",
    "transfers to": "transfers_to",
}

MANDATORY_STAGE2_SECTIONS = ("intake", "map", "chapters", "practice")


def _canon_section_kind(heading: str) -> str:
    h = heading.strip().lower()
    if h.startswith("intake"):
        return "intake"
    if h.startswith("strand"):
        return "strands"
    if h == "map":
        return "map"
    if h == "chapters":
        return "chapters"
    if h == "practice":
        return "practice"
    if h.startswith("hold back"):
        return "hold_back"
    if h.startswith("source notes") or h.startswith("source flags"):
        return "source_notes"
    return re.sub(r"[^a-z0-9]+", "_", h).strip("_")


def _read_text(path: str) -> str:
    """Read UTF-8 text from path using a deterministic context manager."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def resolve_curriculum_path(course_slug: Optional[str], vault_root: Optional[str] = None) -> Tuple[str, str]:
    root = os.path.abspath(vault_root or DEFAULT_VAULT_ROOT)
    slug = (course_slug or "").strip()
    if not slug:
        active_file = os.path.join(root, ".active-course")
        if os.path.exists(active_file):
            raw = _read_text(active_file).strip()
            if raw and raw.lower() not in ("none", "off"):
                slug = raw
    if not slug:
        raise ValueError("No active course and no courseSlug provided")
    if "/" in slug or "\\" in slug or ".." in slug:
        raise ValueError(f"Invalid course slug: {slug!r}")
    return slug, os.path.join(root, "courses", slug, "curriculum.md")


def parse_markdown_sections(text: str) -> Dict[str, Any]:
    """Split a curriculum.md file into front header + ordered ## sections + ### subsections."""
    norm = text.replace("\r\n", "\n")
    lines = norm.split("\n")

    title = ""
    meta: Dict[str, str] = {}
    header_lines: List[str] = []
    sections: List[Dict[str, Any]] = []

    current_sec: Optional[Dict[str, Any]] = None
    in_fence = False

    for line_no, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence

        if not in_fence and re.match(r"^#\s+\S", line) and not title and current_sec is None:
            title = re.sub(r"^#\s+", "", line).strip()
            header_lines.append(line)
            continue

        if not in_fence and re.match(r"^##\s+\S", line):
            sec_title = re.sub(r"^##\s+", "", line).strip()
            current_sec = {
                "title": sec_title,
                "kind": _canon_section_kind(sec_title),
                "start_line": line_no,
                "lines": [],
            }
            sections.append(current_sec)
            continue

        if current_sec is None:
            header_lines.append(line)
            m = re.match(r"^([A-Za-z][A-Za-z0-9 _-]{1,30}):\s*(.+)$", line.strip())
            if m:
                key = m.group(1).strip().lower().replace(" ", "_")
                meta[key] = m.group(2).strip()
        else:
            current_sec["lines"].append(line)

    # Trim trailing separator "---" cleanly from each section body.
    for sec in sections:
        body_lines = list(sec["lines"])
        while body_lines and body_lines[-1].strip() in ("", "---"):
            body_lines.pop()
        sec["body"] = "\n".join(body_lines).strip()
        sec["char_count"] = len(sec["body"])
        sec["line_count"] = len(body_lines)
        sec["subsections"] = _parse_subsections(sec["body"])

    if "goal" not in meta and "scope" in meta:
        meta["goal"] = meta["scope"]

    header_text = "\n".join(header_lines).strip()
    return {
        "title": title,
        "meta": meta,
        "header_text": header_text,
        "header_chars": len(header_text),
        "sections": sections,
    }


def _parse_subsections(body: str) -> List[Dict[str, Any]]:
    subs: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    in_fence = False
    for line in body.split("\n"):
        if line.strip().startswith("```"):
            in_fence = not in_fence
        if not in_fence and re.match(r"^###\s+\S", line):
            sub_title = re.sub(r"^###\s+", "", line).strip()
            cur = {"title": sub_title, "lines": []}
            subs.append(cur)
        elif cur is not None:
            cur["lines"].append(line)

    for s in subs:
        while s["lines"] and s["lines"][-1].strip() in ("", "---"):
            s["lines"].pop()
        s["body"] = "\n".join(s["lines"]).strip()
        s["char_count"] = len(s["body"])
    return subs


def _extract_problem_refs(problems_text: str) -> Tuple[List[Dict[str, Optional[str]]], List[str]]:
    """Extract problem labels, IDs/codes, URLs, and optional courses/<slug>/sources/... paths."""
    entries: List[Dict[str, Optional[str]]] = []
    tokens: List[str] = []

    raw_items: List[str] = []
    for line in problems_text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if s.startswith(("- ", "* ")) or re.match(r"^\d+\.\s+", s):
            raw_items.append(re.sub(r"^(?:[-*]|\d+\.)\s+", "", s))
        else:
            raw_items.extend([part.strip() for part in s.split("·") if part.strip()])

    for item in raw_items:
        url_m = re.search(r"https?://\S+", item)
        url = url_m.group(0).rstrip(").,") if url_m else None
        src_m = re.search(r"(?:courses/[^/\s)]+/)?sources/[A-Za-z0-9._/-]+", item)
        source_file = src_m.group(0).rstrip(").,") if src_m else None
        code_tokens = re.findall(r"\b(?:DPC|TDPC|NDPC)\s+[A-Z]\b|\b(?:cf|abc|arc|agc|cses|dp|dpc|tdpc|ndpc|typical90)_[A-Za-z0-9_]+\b|\b0\d{2}\b", item, re.IGNORECASE)
        for t in code_tokens:
            if t not in tokens:
                tokens.append(t)
        entries.append(
            {
                "raw": item,
                "url": url,
                "source_file": source_file,
                "codes": code_tokens,
            }
        )
    return entries, tokens


def _parse_chapter_fields(body: str) -> Dict[str, Any]:
    fields: Dict[str, str] = {}
    cur_key: Optional[str] = None
    cur_lines: List[str] = []

    def _flush():
        nonlocal cur_key, cur_lines
        if cur_key is not None:
            text = "\n".join(cur_lines).strip()
            fields[cur_key] = f"{fields[cur_key]}\n{text}".strip() if cur_key in fields and fields[cur_key] else text
        cur_key = None
        cur_lines = []

    bullet_re = re.compile(r"^-\s+\*\*([^:*]+?)(?::\*\*|\*\*:\s*|:\*\*\s*)(.*)$")
    for line in body.split("\n"):
        m = bullet_re.match(line.strip())
        if m:
            raw_label = m.group(1).strip().lower()
            raw_label_clean = re.sub(r"\s*\([^)]*\)\s*$", "", raw_label).strip()
            canon = FIELD_ALIASES.get(raw_label) or FIELD_ALIASES.get(raw_label_clean)
            if canon:
                _flush()
                cur_key = canon
                rest = m.group(2).strip()
                if rest:
                    cur_lines.append(rest)
                continue
        if cur_key is not None:
            cur_lines.append(line.rstrip())
    _flush()
    return fields


def _parse_chapters(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    chap_sec = next((s for s in parsed["sections"] if s["kind"] == "chapters"), None)
    if not chap_sec:
        return []
    chapters: List[Dict[str, Any]] = []
    for sub in chap_sec["subsections"]:
        m = re.match(r"^(\d+)\.\s*(.+)$", sub["title"])
        num = int(m.group(1)) if m else None
        raw_title = m.group(2).strip() if m else sub["title"]
        tier = "stretch" if "stretch" in raw_title.lower() else "core"
        fields = _parse_chapter_fields(sub["body"])
        if fields.get("tier"):
            tier = fields["tier"].strip().strip("`'\"").lower()
        prob_entries, prob_tokens = _extract_problem_refs(fields.get("problems", ""))
        chapters.append(
            {
                "number": num,
                "title": raw_title,
                "tier": tier,
                "fields": fields,
                "problems": prob_entries,
                "problem_tokens": prob_tokens,
                "char_count": sub["char_count"],
                "raw_body": sub["body"],
            }
        )
    return chapters


def _match_appendix_items(sec_body: str, ch_num: int, prob_tokens: List[str]) -> List[str]:
    """Extract bullets or table rows belonging to Chapter N from optional appendix sections."""
    if not sec_body:
        return []
    ch_pat = re.compile(rf"\bCh(?:apter)?\.?\s*{ch_num}\b", re.IGNORECASE)
    token_pats = [re.compile(rf"(?<![A-Za-z0-9_]){re.escape(tok)}(?![A-Za-z0-9_])", re.IGNORECASE) for tok in prob_tokens]
    hits: List[str] = []
    for line in sec_body.split("\n"):
        s = line.strip()
        if not s or s.startswith(("#", "---", "|---")):
            continue
        if ch_pat.search(s) or any(tp.search(s) for tp in token_pats):
            hits.append(s)
    return hits


def _summarize_intake(parsed: Dict[str, Any]) -> Dict[str, Any]:
    sec = next((s for s in parsed["sections"] if s["kind"] == "intake"), None)
    if not sec:
        return {"present": False, "title": None, "summary": []}
    summary_lines: List[str] = []
    for sub in sec["subsections"]:
        summary_lines.append(f"{sub['title']} ({sub['char_count']} chars)")
    if not summary_lines:
        for line in sec["body"].split("\n"):
            if line.strip().startswith("- "):
                summary_lines.append(line.strip()[:180])
    return {"present": True, "title": sec["title"], "summary": summary_lines[:10], "body": sec["body"]}


def cmd_overview(course_slug: Optional[str], vault_root: Optional[str] = None) -> Dict[str, Any]:
    slug, path = resolve_curriculum_path(course_slug, vault_root)
    if not os.path.exists(path):
        return {"exists": False, "stage": 0, "course_slug": slug, "message": "No curriculum.md yet — run curriculum-architect MODE: stage1."}

    raw = _read_text(path)
    parsed = parse_markdown_sections(raw)
    chapters = _parse_chapters(parsed)
    map_sec = next((s for s in parsed["sections"] if s["kind"] == "map"), None)
    practice_sec = next((s for s in parsed["sections"] if s["kind"] == "practice"), None)
    intake = _summarize_intake(parsed)

    stage_val = parsed["meta"].get("stage", "2")
    stage_num = int(stage_val) if str(stage_val).isdigit() else 2

    return {
        "exists": True,
        "course_slug": slug,
        "title": parsed["title"],
        "stage": stage_num,
        "metadata": parsed["meta"],
        "sections": [
            {
                "title": s["title"],
                "kind": s["kind"],
                "char_count": s["char_count"],
                "subsections": [sub["title"] for sub in s["subsections"]],
            }
            for s in parsed["sections"]
        ],
        "intake_summary": {"title": intake["title"], "highlights": intake["summary"]},
        "map": map_sec["body"] if map_sec else "",
        "practice_preview": (practice_sec["body"][:900] + ("..." if len(practice_sec["body"]) > 900 else "")) if practice_sec else "",
        "chapters": [
            {
                "number": ch["number"],
                "title": ch["title"],
                "tier": ch["tier"],
                "problem_tokens": ch["problem_tokens"],
                "problem_count": len(ch["problems"]),
                "owned_when": ch["fields"].get("owned_when", ""),
                "char_count": ch["char_count"],
            }
            for ch in chapters
        ],
    }


def cmd_intake(course_slug: Optional[str], strand: Optional[str] = None, vault_root: Optional[str] = None) -> Dict[str, Any]:
    slug, path = resolve_curriculum_path(course_slug, vault_root)
    if not os.path.exists(path):
        return {"exists": False, "stage": 0, "course_slug": slug}

    raw = _read_text(path)
    parsed = parse_markdown_sections(raw)
    stage_val = parsed["meta"].get("stage", "2")
    stage_num = int(stage_val) if str(stage_val).isdigit() else 2

    strands_sec = next((s for s in parsed["sections"] if s["kind"] == "strands"), None)
    intake_sec = next((s for s in parsed["sections"] if s["kind"] == "intake"), None)

    strands_list = []
    if strands_sec:
        q = (strand or "").strip().lower()
        for sub in strands_sec["subsections"]:
            if q and q not in sub["title"].lower() and q not in sub["body"].lower():
                continue
            strands_list.append({"title": sub["title"], "body": sub["body"]})

    return {
        "exists": True,
        "course_slug": slug,
        "stage": stage_num,
        "probed": parsed["meta"].get("probed", ""),
        "goal": parsed["meta"].get("goal", ""),
        "strands": strands_list,
        "intake_baseline": intake_sec["body"] if intake_sec else "",
    }


def cmd_chapter(
    course_slug: Optional[str],
    chapter: Optional[int] = None,
    query: Optional[str] = None,
    vault_root: Optional[str] = None,
) -> Dict[str, Any]:
    slug, path = resolve_curriculum_path(course_slug, vault_root)
    if not os.path.exists(path):
        return {"exists": False, "stage": 0, "course_slug": slug}

    raw = _read_text(path)
    parsed = parse_markdown_sections(raw)
    chapters = _parse_chapters(parsed)
    if not chapters:
        raise ValueError("No numbered chapters found in curriculum.md")

    target: Optional[Dict[str, Any]] = None
    if chapter is not None:
        target = next((ch for ch in chapters if ch["number"] == chapter), None)
    elif query:
        q = query.strip().lower()
        for ch in chapters:
            if q in ch["title"].lower() or any(q in tok.lower() for tok in ch["problem_tokens"]) or q in ch["fields"].get("problems", "").lower():
                target = ch
                break
        if target is None:
            for ch in chapters:
                if q in ch["raw_body"].lower():
                    target = ch
                    break

    if target is None:
        raise ValueError(f"Chapter not found (chapter={chapter!r}, query={query!r})")

    ch_num = target["number"] or 0
    hb_sec = next((s for s in parsed["sections"] if s["kind"] == "hold_back"), None)
    sn_sec = next((s for s in parsed["sections"] if s["kind"] == "source_notes"), None)
    rt_sec = next((s for s in parsed["sections"] if s["kind"] == "route"), None)
    pr_sec = next((s for s in parsed["sections"] if s["kind"] == "practice"), None)
    intake_sec = next((s for s in parsed["sections"] if s["kind"] == "intake"), None)

    hold_back_inline = target["fields"].get("hold_back", "")
    hold_back_extra = _match_appendix_items(hb_sec["body"], ch_num, target["problem_tokens"]) if hb_sec else []

    source_flags_inline = target["fields"].get("source_flags", "")
    source_flags_extra = _match_appendix_items(sn_sec["body"], ch_num, target["problem_tokens"]) if sn_sec else []

    practice_triggers = _match_appendix_items(pr_sec["body"], ch_num, []) if pr_sec else []
    intake_track_rows = _match_appendix_items(intake_sec["body"], ch_num, []) if intake_sec else []
    route_rows = _match_appendix_items(rt_sec["body"], ch_num, target["problem_tokens"]) if rt_sec else []

    return {
        "exists": True,
        "course_slug": slug,
        "number": target["number"],
        "title": target["title"],
        "tier": target["tier"],
        "problems": target["problems"],
        "problem_tokens": target["problem_tokens"],
        "rationale": target["fields"].get("rationale", ""),
        "student_delta": target["fields"].get("student_delta", ""),
        "focus": target["fields"].get("focus", ""),
        "owned_when": target["fields"].get("owned_when", ""),
        "transfers_to": target["fields"].get("transfers_to", ""),
        "hold_back": {
            "inline": hold_back_inline,
            "appendix": hold_back_extra,
        },
        "source_flags": {
            "inline": source_flags_inline,
            "appendix": source_flags_extra,
        },
        "practice_triggers": practice_triggers,
        "route_entries": route_rows,
        "intake_notes": intake_track_rows,
        "raw_body": target["raw_body"] if not target["fields"] else "",
    }


def cmd_practice(
    course_slug: Optional[str],
    after_chapter: Optional[int] = None,
    vault_root: Optional[str] = None,
) -> Dict[str, Any]:
    slug, path = resolve_curriculum_path(course_slug, vault_root)
    if not os.path.exists(path):
        return {"exists": False, "stage": 0, "course_slug": slug}

    raw = _read_text(path)
    parsed = parse_markdown_sections(raw)
    pr_sec = next((s for s in parsed["sections"] if s["kind"] == "practice"), None)
    intake_sec = next((s for s in parsed["sections"] if s["kind"] == "intake"), None)
    chapters = _parse_chapters(parsed)

    after_chapter_hits: List[str] = []
    covered_chapters: List[Dict[str, Any]] = []
    if after_chapter is not None and pr_sec:
        after_chapter_hits = _match_appendix_items(pr_sec["body"], after_chapter, [])
        covered_chapters = [
            {"number": ch["number"], "title": ch["title"], "focus": ch["fields"].get("focus", "")}
            for ch in chapters
            if ch["number"] is not None and ch["number"] <= after_chapter
        ]

    # Extract concise edge/habit bullets from intake baseline to help shape problem-recommender briefs.
    edge_habits: List[str] = []
    if intake_sec:
        in_caution_block = False
        for line in intake_sec["body"].split("\n"):
            s = line.strip()
            if not s:
                continue
            low = s.lower()
            is_top_label = not line.startswith(" ") and s.startswith("- **")
            if is_top_label:
                in_caution_block = any(k in low for k in ("edge", "habit", "build", "break"))
                # Include inline content if present after the colon, skip bare header labels.
                after_colon = s.split(":", 1)[1].strip(" *") if ":" in s else ""
                if in_caution_block and after_colon:
                    edge_habits.append(s)
            elif in_caution_block and s.startswith("- "):
                edge_habits.append(s)
            elif any(k in low for k in ("edge", "habit", "build", "break", "slip")) and s.startswith("- "):
                edge_habits.append(s)

    return {
        "exists": True,
        "course_slug": slug,
        "goal": parsed["meta"].get("goal", ""),
        "after_chapter": after_chapter,
        "after_chapter_triggers": after_chapter_hits,
        "covered_chapters": covered_chapters,
        "baseline_cautions": edge_habits[:8],
        "practice": pr_sec["body"] if pr_sec else "",
    }


def cmd_lookup(
    course_slug: Optional[str],
    section: Optional[str] = None,
    subsection: Optional[str] = None,
    query: Optional[str] = None,
    vault_root: Optional[str] = None,
) -> Dict[str, Any]:
    slug, path = resolve_curriculum_path(course_slug, vault_root)
    if not os.path.exists(path):
        return {"exists": False, "stage": 0, "course_slug": slug}

    raw = _read_text(path)
    parsed = parse_markdown_sections(raw)

    if section:
        q_sec = section.strip().lower()
        sec = next((s for s in parsed["sections"] if s["title"].lower() == q_sec or s["kind"] == _canon_section_kind(q_sec)), None)
        if sec is None:
            sec = next((s for s in parsed["sections"] if q_sec in s["title"].lower()), None)
        if sec is None:
            raise ValueError(f"Section {section!r} not found. Available: {[s['title'] for s in parsed['sections']]}")

        if subsection:
            q_sub = subsection.strip().lower()
            sub = next((sb for sb in sec["subsections"] if q_sub in sb["title"].lower()), None)
            if sub is None:
                raise ValueError(f"Subsection {subsection!r} not found in {sec['title']!r}")
            return {
                "exists": True,
                "course_slug": slug,
                "section": sec["title"],
                "subsection": sub["title"],
                "content": sub["body"],
            }
        return {"exists": True, "course_slug": slug, "section": sec["title"], "content": sec["body"]}

    if query:
        tokens = [t for t in query.strip().lower().split() if t]
        matches: List[Dict[str, Any]] = []
        for sec in parsed["sections"]:
            if sec["subsections"]:
                for sb in sec["subsections"]:
                    hit_lines = [ln.strip() for ln in sb["body"].split("\n") if ln.strip() and all(tok in ln.lower() for tok in tokens)]
                    if hit_lines or all(tok in sb["title"].lower() for tok in tokens):
                        matches.append(
                            {
                                "breadcrumb": f"{sec['title']} > {sb['title']}",
                                "hits": hit_lines[:8] if hit_lines else [sb["body"][:400]],
                            }
                        )
            else:
                hit_lines = [ln.strip() for ln in sec["body"].split("\n") if ln.strip() and all(tok in ln.lower() for tok in tokens)]
                if hit_lines:
                    matches.append({"breadcrumb": sec["title"], "hits": hit_lines[:8]})
        return {"exists": True, "course_slug": slug, "query": query, "matches": matches[:25]}

    raise ValueError('lookup needs either "section" or "query"')


def cmd_validate(file_path: str) -> Dict[str, Any]:
    """Validate a curriculum.md file against structural completeness & static-field bounds."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Curriculum file not found: {file_path}")

    raw = _read_text(file_path)
    parsed = parse_markdown_sections(raw)
    meta = parsed["meta"]
    errors: List[str] = []
    warnings: List[str] = []

    if not parsed["title"]:
        errors.append("Missing top-level '# <Title>' heading")
    if parsed["header_chars"] > HEADER_CHAR_LIMIT:
        errors.append(f"Front header block exceeds static limit ({parsed['header_chars']} > {HEADER_CHAR_LIMIT} chars)")

    for key in ("stage", "source", "goal"):
        if not meta.get(key):
            errors.append(f"Missing required header field '{key}:' (note: 'scope:' aliases 'goal:')")

    stage_raw = str(meta.get("stage", "")).strip()
    if stage_raw not in ("1", "2"):
        errors.append(f"Header 'stage:' must be '1' or '2', got {stage_raw!r}")

    kinds = {s["kind"] for s in parsed["sections"]}

    if stage_raw == "1":
        if "strands" not in kinds and "intake" not in kinds:
            errors.append("Stage 1 guide requires a '## Strands' (or '## Intake strands') section")
        strands_sec = next((s for s in parsed["sections"] if s["kind"] == "strands"), None)
        if strands_sec and not strands_sec["subsections"]:
            errors.append("Stage 1 '## Strands' must define numbered '### <N>. <Strand>' blocks")
    elif stage_raw == "2":
        if not meta.get("probed"):
            warnings.append("Stage 2 header is missing 'probed:' metadata line")
        for req in MANDATORY_STAGE2_SECTIONS:
            if req not in kinds:
                errors.append(f"Stage 2 guide missing mandatory '## {req.title()}' section")

        chapters = _parse_chapters(parsed)
        if not chapters:
            errors.append("Stage 2 '## Chapters' must contain at least one '### 1. <Title>' chapter")
        expected_num = 1
        for ch in chapters:
            if ch["number"] != expected_num:
                errors.append(f"Chapter numbering must be sequential (expected {expected_num}, got {ch['number']!r} on '{ch['title']}')")
            expected_num += 1
            if not ch["fields"].get("problems"):
                errors.append(f"Chapter {ch['number']} ('{ch['title']}') missing '- **Problems:**' bullet")
            if not ch["fields"].get("owned_when"):
                errors.append(f"Chapter {ch['number']} ('{ch['title']}') missing '- **Owned when:**' bullet")
            for static_key, limit in STATIC_FIELD_LIMITS.items():
                val = ch["fields"].get(static_key, "")
                if len(val) > limit:
                    errors.append(
                        f"Chapter {ch['number']} '{static_key}' exceeds concise bound ({len(val)} > {limit} chars — keep blueprint crisp; do not write essays)"
                    )

        # Warn if deprecated sermon/tutorial prose headings appear.
        if "why the naive way breaks" in raw.lower():
            warnings.append("Contains 'why the naive way breaks' — ensure guide stays on 'what & order', not preaching 'how'")

    return {
        "ok": len(errors) == 0,
        "file": file_path,
        "stage": stage_raw,
        "chapters_count": len(_parse_chapters(parsed)),
        "errors": errors,
        "warnings": warnings,
    }


def main(argv: Optional[List[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(prog="curriculum.py", description="Structured Course Curriculum Query & Validator Engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_ov = sub.add_parser("overview")
    p_ov.add_argument("--course", default=None)
    p_ov.add_argument("--vault-root", default=None)

    p_in = sub.add_parser("intake")
    p_in.add_argument("--course", default=None)
    p_in.add_argument("--strand", default=None)
    p_in.add_argument("--vault-root", default=None)

    p_ch = sub.add_parser("chapter")
    p_ch.add_argument("--course", default=None)
    p_ch.add_argument("--chapter", type=int, default=None)
    p_ch.add_argument("--query", default=None)
    p_ch.add_argument("--vault-root", default=None)

    p_pr = sub.add_parser("practice")
    p_pr.add_argument("--course", default=None)
    p_pr.add_argument("--after-chapter", type=int, default=None)
    p_pr.add_argument("--vault-root", default=None)

    p_lu = sub.add_parser("lookup")
    p_lu.add_argument("--course", default=None)
    p_lu.add_argument("--section", default=None)
    p_lu.add_argument("--subsection", default=None)
    p_lu.add_argument("--query", default=None)
    p_lu.add_argument("--vault-root", default=None)

    p_val = sub.add_parser("validate")
    p_val.add_argument("file")

    for p in (p_ov, p_in, p_ch, p_pr, p_lu, p_val):
        p.add_argument("--json", action="store_true", help="Accepted for CLI uniformity (output is JSON)")

    args = ap.parse_args(argv)

    try:
        if args.cmd == "overview":
            res = cmd_overview(args.course, args.vault_root)
        elif args.cmd == "intake":
            res = cmd_intake(args.course, args.strand, args.vault_root)
        elif args.cmd == "chapter":
            res = cmd_chapter(args.course, args.chapter, args.query, args.vault_root)
        elif args.cmd == "practice":
            res = cmd_practice(args.course, args.after_chapter, args.vault_root)
        elif args.cmd == "lookup":
            res = cmd_lookup(args.course, args.section, args.subsection, args.query, args.vault_root)
        elif args.cmd == "validate":
            res = cmd_validate(args.file)
            print(json.dumps(res, indent=2, ensure_ascii=False))
            return 0 if res["ok"] else 2
        else:
            raise ValueError(f"Unknown command: {args.cmd}")

        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
