---
name: visualize
description: "Add a clean, verified 3Blue1Brown-style visual to the Obsidian blackboard — a Before/After state diagram, spatial dual, or dependency graph — whenever seeing the geometry makes an algebraic rule or transition obvious."
---

# Sketching Visuals on the Blackboard

A great 3Blue1Brown visual shifts the camera angle so an opaque formula or loop condition becomes something you can see at a glance. You are the creative director: you know the exact 3–5 element example sitting on the board and the specific point the student is looking at. You decide *what* single relationship to show; the maker (`svg-maker` or `mermaid-maker`) renders the PNG and saves it into `<vaultRoot>/viz/`.

## When a Diagram Earns Its Keep

- **Draw a diagram when spatial geometry or structure does the explaining:** Before/After array state transitions, interval bars lined up over coordinates, slopes/envelopes, two-pointer calipers (`svg-maker`), or state dependency graphs (`mermaid-maker`).
- **Use the blackboard directly for text and tables:** When an idea is just English labels or numbers in a table without spatial geometry, write it directly on the blackboard as a trace rather than putting text inside image boxes.

## Writing the Brief & Delivering the Image

1. **Anchor the brief to the exact numbers and question on your board:** Target the specific relationship the student is looking at right now, passing the same 3–5 element asymmetric array, coordinates, or edges from the board and specifying which elements are active, which survive, and which are pruned:
   ```
   subagent(agent="svg-maker", task="<your board-anchored brief>")
   ```
   *(or `agent="mermaid-maker"` for node-and-edge graphs).*
2. **Check the rendered PNG with `read`:** Confirm that the numbers, indices, and arrows match your board and nothing overlaps. If `RESULT: NONE` comes back, let a quick blackboard trace carry the point.
3. **Deliver the image and explanation together in one message:** Call the maker, inspect the PNG with `read`, and then send your explanation and `![[viz-<slug>-<timestamp>.png|550]]` together in a single assistant turn so the picture and the words arrive at the board simultaneously.
