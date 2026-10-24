---
name: visualize
description: "Add a clean, verified 3Blue1Brown-style visual to the Obsidian whiteboard — a Before/After state diagram, spatial dual, or dependency graph — whenever seeing the geometry makes an algebraic rule or transition obvious."
---

# Sketching Visuals on the Whiteboard

A good diagram shifts the camera angle so an opaque formula or loop invariant becomes something you can see at a glance. This skill builds **one** focused diagram, checks the rendered image to make sure the numbers and layout are right, and drops it inline on the Obsidian whiteboard alongside your explanation.

You are the creative director: you know the exact 3–5 element example sitting on the board and the specific friction point the student is looking at. You decide *what* single relationship to show; the maker subagent (`svg-maker` or `mermaid-maker`) writes the source, renders the PNG, inspects it, and saves it into `<vaultRoot>/viz/`.

## When a Diagram Earns Its Keep

Reach for a visual when moving from algebra or code to a spatial picture makes the invariant click faster than prose:

- **Before $\to$ After state steps (`svg-maker`):** Showing why a monotonic deque pops larger older elements (skyline shadows), why walking capacity backward vs. forward in 1D Knapsack avoids or causes self-overwrites, or how a lazy tag pushes down a segment tree.
- **Spatial and geometric duals (`svg-maker`):** Fenwick tree interval bars lined up under array indices, two-pointer calipers, convex hull trick lower envelopes, WQS binary search tangents, or Euler-tour subtree ranges.
- **Dependency and state graphs (`mermaid-maker`):** DP state DAGs, 2-SAT implication graphs, automaton transitions, or tree decompositions.

Skip decorative flowcharts that just repeat English words inside boxes without showing structure, coordinates, or direction.

## Picking the Right Maker

- **`svg-maker` (Coordinates, Arrays, Intervals & Before/After Panels):** Use whenever exact alignment, array cells, interval bars, number lines, slopes, or two-panel state comparisons matter.
- **`mermaid-maker` (Nodes & Edges):** Use when the idea is purely a graph or tree where automatic node-and-arrow layout is the natural fit.

## Writing a Concrete Brief

The maker subagent has no access to your chat history—it only sees the brief you send it:
1. **Use the exact numbers already on your board:** Pass the same 3–5 element asymmetric array, interval bounds, or graph edges you are tracing with the student so the diagram matches your prose.
2. **Show one thing clearly:** Don't cram an entire algorithm into one canvas. Isolate the single step or comparison that matters right now.
3. **Name what should stand out:** Tell `svg-maker` which elements are the active focus, which ones survive the invariant, and which ones are dead weight being pruned.

- *Too vague:* "Draw a diagram explaining how a monotonic queue works for sliding window minimum."
- *Sharp and anchored:* "2-panel Before/After SVG on array `[6, 2, 7, 4, 3]` when index 4 (value `3`) enters the window `[2, 7, 4]`. Top panel (Before): deque holds `[2, 7, 4]` with bar heights matching values; incoming `3` in blue on the right. Bottom panel (After): `7` and `4` shaded crimson/dashed as 'popped (bigger than 3 and older — can never win a future min query)', surviving deque `[2, 3]` in emerald."

## Calling the Maker & Checking the Image

Call the maker with `subagent`:
```
subagent(agent="svg-maker", task="<your board-anchored brief>")
```
```
subagent(agent="mermaid-maker", task="<your board-anchored brief>")
```
The maker renders the PNG, checks its own work, saves it to `<vaultRoot>/viz/`, and returns:
```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <vaultRoot>/viz/viz-<slug>-<timestamp>.png
```
If it returns `RESULT: NONE`, let your prose and a quick ASCII trace carry the point without mentioning any skipped diagram.

Before embedding a returned PNG, **open `path` with `read`** to look at the rendered image yourself:
- Do the numbers, indices, and arrows match the example on your board?
- Is every label readable with no overlapping text?
If something is off, ask the maker for a quick fix before showing it to the student.

## Deliver the Diagram and Explanation in the Same Assistant Message

A diagram and the explanation around it belong to the same whiteboard moment:
- Call the maker subagent first, inspect the PNG with `read`, and then write your explanation and the `![[viz-<slug>-<timestamp>.png|550]]` embed together in **one assistant message**.
- Never send a *"Hold on while I draw a diagram..."* teaser message, and never send the explanation in one message and the image in the next.
- Let the picture do the heavy lifting—point to the key contrast in the diagram and ask your follow-up question right against the coordinates shown.
