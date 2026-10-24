# CP Curriculum Problem & Resource Catalog

A unified, offline competitive programming inventory combining:
1. **progvar.fun** — 135 expert-classified concept sets (~2,300 curated problems) prioritizing conceptual signal and distilled invariants.
2. **YouKn0wWho's Ultimate Topic List (UTL)** — 570 granular topics, 3,880+ problems, 1,550+ curated tutorials, and 450+ verified C++ templates, providing fine-grained topic coverage, curator picks (`★`), and volume.

Total inventory: **5,471 unique problems**, **1,557 tutorials/blogs**, and **457 code templates** across **596 buckets** (135 Progvar concept sets + 326 standalone UTL topics + 135 contest sets).

---

## Quick Navigation

### 1. `catalog.py` — The CLI (for Agents and You)

Pure Python 3 standard library, **zero dependencies, completely offline**. Reads `catalog.json`.

```bash
# High-level overview
python3 catalog.py domains                              # The 8 canonical domains + Contest Sets
python3 catalog.py buckets "Graphs"                     # List all buckets in a domain

# Inspect a specific bucket
python3 catalog.py bucket "0-1 BFS"                     # Problems (progvar first, then UTL backfill)
python3 catalog.py bucket "Convex Hull Trick" --urls    # Include direct problem URLs
python3 catalog.py bucket "2-SAT" --starred             # Show only curator-starred problems (★)

# Multi-token search across all buckets and problems
python3 catalog.py find "knapsack"
python3 catalog.py find "broken profile" --limit 10

# Inspect where a problem sits in the curriculum
python3 catalog.py problem "Counting Tilings"

# Curated reading material & code templates (for resource-recommender)
python3 catalog.py resources "0-1 BFS"
python3 catalog.py resources "Li Chao Tree"
```

Add `--json` to any command for structured machine-readable JSON output.  
Use `--exclude "<p1,p2>"` to skip previously solved or rejected problems.

### 2. `inventory.html` — Interactive Web Browser

Open `inventory.html` directly in any web browser.
- Instant search across all buckets, absorbed topics, and problem titles.
- Color-coded source badges: `[pv]` (Progvar), `[utl]` (Ultimate Topic List), and `[pv+utl]` (present in both).
- Collapsible reading lists and code template links.
- 100% self-contained (zero server, no external scripts).

### 3. `inventory.md` — Obsidian & Markdown Native

A complete markdown document of the entire catalog hierarchy:
`Domain` → `Bucket` → `Problem Table` + `Reading Material` + `Templates`. Searchable directly in Obsidian or any markdown reader.

---

## Data Stores & File Structure

```
agents/catalog/
├── catalog.py              # CLI and importable library
├── catalog.json            # Unified normalized model (read by catalog.py and inventory.html)
├── inventory.html          # Interactive local web browser
├── inventory.md            # Markdown document of the full catalog
├── build_catalog.py        # Rebuild pipeline (sources + mapping -> catalog.json + views)
├── utl_to_progvar.csv      # Human-reviewed topic mapping table
├── catalog_buckets.csv     # Flat table of all 596 buckets
├── catalog_problems.csv    # Flat table of all problem occurrences (6,496 rows)
├── catalog_resources.csv   # Flat table of all 1,557 tutorial resources
└── sources/
    ├── progvar/            # Original progvar data, nav.json, and nav.py
    └── utl/                # Original topicList.js, topicListFullData.js, and utl_load.py
```

---

## Rebuilding the Catalog

If you edit the mapping in `utl_to_progvar.csv` or update raw sources:
```bash
python3 build_catalog.py
```
This regenerates `catalog.json`, all three CSV stores, `inventory.html`, and `inventory.md` in ~5 seconds.
