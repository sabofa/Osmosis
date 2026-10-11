# Geometry v2, Phase 2 — The SVG Figure Renderer

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** give geometry figures their own renderer — static SVG, no camera, no plot chrome — selected automatically when a spec's drawable content is entirely geometry, and built from the start to carry AIME/AMC-scale configurations.

**Architecture:** the construction layer from Phase 1 is renderer-agnostic maths and stays untouched. A new `figure/` module turns constructed geometry into a layered SVG document. The existing three.js path also stays, because constructions must still render in graph mode on real axes. Two renderers, one shared construction layer.

**Tech Stack:** TypeScript, React 19 (the figure view is a component, as `TableView` is), Vitest. **No new dependencies** — SVG is emitted as markup, not via a library.

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 2 — Geometry v2", especially "Figure mode — a separate renderer, not hidden chrome" and its sub-sections. Read those before Task 1.

**Prior work:** `docs/superpowers/plans/2026-09-22-geometry-v2-phase-1.md` and its report. Phase 1 built the construction maths (`graph-engine/src/scene/geometry/`), which you consume and must not rewrite.

## Global Constraints

- **No new runtime dependencies.**
- **The three.js path keeps working.** Constructions rendering in graph mode is a commitment this spec makes explicitly. Every one of the 336 existing tests must still pass, and none may be weakened or deleted.
- **Determinism.** The same spec text must produce **byte-identical SVG** across runs. Not merely equivalent — identical. This is what makes figures cacheable, diffable, and safe for a tutor to generate. Test it directly by rendering twice and comparing strings.
- **Floating-point tolerance policy, stated once and used everywhere.** Long construction chains drift; concurrency and coincidence tests need a shared epsilon rather than per-call-site guesses. Phase 1 has `GEOM_EPS` — reuse it, do not introduce a second one.
- Test command: `npm run test --workspace=graph-engine`, plus `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine`. All three clean before a task is done.
- Commit per task, lowercase `type(scope): summary`, body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  A fixed repo convention, not a description of which model did the work.

## Load-bearing decisions

**E1 — Layered output.** The renderer emits in fixed layer order: region fills → auxiliary/construction lines → primary geometry → marks (ticks, angle arcs, right-angle squares) → points → labels. SVG paints in document order, and at competition density overlap is the norm, so layering is semantic rather than cosmetic. Emission order within a layer follows statement order, for determinism.

**E2 — Label layout is core.** Not a later sub-phase. Each label gets candidate positions scored against drawn geometry and already-placed labels; the best non-colliding set wins. With twenty labelled points, this is the difference between a figure and a mess. Ties broken deterministically.

**E3 — Auto-fit includes labels.** Two passes: lay out the geometry, measure the labels, expand the viewBox to contain both. A figure whose labels are clipped at the edge is a bug, and geometry-only bounds will clip them.

**E4 — Stable element identity.** Every emitted element carries a data attribute naming the statement index and the object that produced it. Track 7's tutor tools (point at this, mark that intersection, emphasis) address SVG elements directly, and inventing a second lookup mechanism later would be waste.

**E5 — Mode inference, with declaration as the house rule.** A spec whose drawable content is entirely geometry renders as a figure; any plotted function (`y=`, implicit, region, polar, parametric, field, scatter, surface) selects graph mode, constructions included. `@mode` takes `graph | figure | table` and an explicit value always wins. Inference is a safety net; the documentation must push explicit declaration, including `@mode: graph`.

**E6 — No interaction in the figure view.** Static SVG: no pan, zoom, hover or camera. Interaction arrives later with the tutor layer and will hang off E4's identities.

---

### Task 1: SVG primitive emitter

Create `graph-engine/src/figure/svg.ts` plus tests. A small, pure, dependency-free emitter: line, polyline, polygon, circle, arc (as a path), text, and a group — each taking geometry plus style, returning markup.

Numbers must be formatted through one function with fixed precision, because unbounded float formatting is the most likely source of non-identical output between runs. Decide the precision and state it.

**Tests:** each primitive's markup; special characters in text escaped; the number formatter pinned, including negative zero and values near the precision boundary; identical input producing identical output.

---

### Task 2: The figure document — layers, viewBox, auto-fit

Create `graph-engine/src/figure/document.ts` plus tests.

Assembles primitives into a complete SVG per **E1**'s layer order, computes the viewBox by **E3**'s two-pass fit with padding, and locks 1:1 aspect. Applies theme colours from the existing palette rather than hardcoding — figures must follow the light/dark theme like everything else.

**Tests:** layer ordering verified by element position in output, not just presence; a fill genuinely precedes a line that precedes a label; viewBox contains geometry that extends asymmetrically; padding applied; **byte-identical output across two renders of the same input**.

---

### Task 3: Label layout

Create `graph-engine/src/figure/labels.ts` plus tests. This is **E2** and the highest-value task in the plan.

Candidate positions per label, scored against drawn geometry and already-placed labels, best set selected, ties broken deterministically. Text metrics: SVG gives real ones via `getBBox()` in a browser, but the test environment is node — so estimate from font size and character count behind an interface the browser path can later sharpen. State the estimation rule.

**Tests:** two points close together get labels that do not overlap; a label does not land on top of a line passing near its anchor; a vertex label falls outside its polygon rather than inside; with twenty labelled points **no two labels overlap**; the same input produces the same placement every time. The twenty-point case is the one that matters — build it from an actual dense configuration, not twenty points in a row.

---

### Task 4: Rendering the construction layer

Create `graph-engine/src/figure/render.ts` plus tests. Consumes Phase 1's constructed geometry and emits through Tasks 1–3.

Covers everything Phase 1 produces: points with labels, lines (infinite lines clipped to the viewBox, rays, segments), circles, triangles, polygons, and the existing marks (`tick:`, `angle:`, `right-angle:`). Auxiliary lines dashed. Infinite lines must be clipped at render time against the final viewBox, not stored clipped.

**Tests:** each object kind emitted correctly; an infinite line clipped to bounds and re-clipped when bounds change; dashed rendering for auxiliary lines; a full worked figure — the Phase 1 motivating triangle with its altitude — producing a complete, well-formed SVG document.

---

### Task 5: The figure view and mode selection

Create `graph-engine/src/FigureView.tsx`; modify `graph-engine/src/GraphViewer.tsx` and the mode plumbing in `graph-engine/src/parser/parseConfig.ts` / `config.ts`.

`@mode` gains `figure`. `GraphViewer` gains a third branch alongside its existing table branch: dispose the three.js renderer, render `FigureView`. Follow exactly how `tableMode` already works — that path is the precedent and the user asked for this to work "like the tables function".

Implement **E5**'s inference, with an explicit `@mode` always winning.

**Tests:** `@mode: figure` selects the figure view; `@mode: graph` on a geometry-only spec forces the graph renderer (the migration escape hatch); a geometry-only spec with no `@mode` infers figure; adding one `y = f(x)` to that spec flips it to graph; `@mode: table` still works unchanged.

**Careful:** the three.js renderer must be disposed when switching in, or a WebGL context leaks on every mode change. `tableMode`'s existing handling shows the pattern.

---

### Task 6: 3D solids through the same renderer

Create `graph-engine/src/figure/project3d.ts` plus tests.

A projection module: 3D geometry in, 2D primitives plus a visible/hidden edge classification out, through a **fixed axonometric camera** (no orbit — these are drawings, not scenes). The figure renderer draws the result, dashing hidden edges.

This task builds **the pipeline and one primitive only** — a rectangular prism or a cylinder, your choice — to prove the path end to end. The full solid vocabulary is a later phase and is **out of scope here**.

**Tests:** the camera projection against hand-computed screen coordinates; hidden-edge classification putting the correct edges behind; deterministic output; the primitive producing a recognisable, well-formed SVG.

---

## Verification

1. All three checks clean; all 336 pre-existing tests still passing.
2. **Byte-identical SVG across repeated renders** of a figure exercising every object kind.
3. A dense figure — at least twenty labelled points with intersecting circles and lines — renders with **no overlapping labels** and correct layer order.
4. The Phase 1 motivating figure renders as a complete SVG.
5. Constructions still render in **graph mode** on real axes, unchanged.

## Out of scope for this phase

Circle vocabulary (chord, arc, sector, tangent), measure labels, the unit circle, exact/symbolic value display, shading and boolean regions, the full solid vocabulary, cross-sections, nets, composite solids, and all competition-specific constructions (excircles, nine-point circle, radical axes, cevian concurrency). Each is a later phase with its own plan. Build the surface they will draw onto; do not start them.
