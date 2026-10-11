# Geometry v2, Phase 3 — Measures, Notation, Navigation and Panels

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make figures *readable as mathematics* — measured values printed from the geometry the engine already solved, written in real geometric notation, navigable by pan and zoom, with a givens box for when the drawing gets too dense, and able to share a view with a data table.

**Architecture:** all of this sits on Phase 2's SVG figure renderer. No new renderer, no change to the construction layer.

**Tech Stack:** TypeScript, React 19, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 2 — Geometry v2", the "Measure labels" section and the 2026-09-23 revision sub-sections ("the figure view is navigable", "Geometry notation", "A givens box", "Figures and tables share a view"). Read them before Task 1.

**Prior work:** Phase 1 (`geometry/`, construction maths) and Phase 2 (`figure/`, SVG renderer). You consume both and rewrite neither.

## Global Constraints

- **No new runtime dependencies.**
- **All 437 existing tests keep passing**, none weakened or deleted.
- **Determinism.** Byte-identical SVG across renders for the same input and the same view state. Phase 2 established this; do not regress it. Pan/zoom changes the viewBox, so determinism is asserted *at a given view state*.
- **Reuse the existing tolerance constant** (`GEOM_EPS`); do not introduce a second one.
- Test command: `npm run test --workspace=graph-engine`, plus `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine`. All three clean per task.
- Commit per task, lowercase `type(scope): summary`, body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  A fixed repo convention, not a description of which model did the work.

## Load-bearing decisions

**F1 — Measures are computed, and the asserting form is a check.** `label: AB` prints the computed length. `label: AB = 8` prints `8` and **fails** if the computed length is not 8, because a figure whose labels contradict its own geometry is a wrong figure. `label: AB = x` prints a symbolic placeholder and asserts nothing. Under `@scale: false` (not drawn to scale) the assertion is suppressed and the stated value printed — that flag exists precisely to permit the disagreement.

**F2 — Values print as decimals for now.** Exact/symbolic display is specced but not built, and lands at build-order step 3. Measure labels must route every number through one formatting function so that when exact values arrive, this becomes a one-place change rather than a sweep. Do not attempt symbolic output in this phase.

**F3 — Notation marks are SVG geometry, not Unicode combining characters.** Overbars, ray arrows and arc marks are drawn as paths positioned from measured text extents. Combining characters render inconsistently across fonts and cannot be positioned reliably. Relation symbols (`≅ ~ ∥ ⊥ ∠ △ °`) are ordinary characters and need no special handling.

**F4 — Navigation is a viewBox transform.** Pan and zoom adjust the SVG viewBox; nothing re-lays-out and nothing resamples. Labels and markers keep constant on-screen size as the view zooms, matching the convention the plot renderer already uses. There is no plot camera, no axes, and no world-coordinate readout.

**F5 — Panels compose; tables are additive.** A spec containing both geometry and table statements renders both side by side. `@mode: table` keeps meaning "table only", so stored specs are unaffected.

---

### Task 1: Measure computation

Create `graph-engine/src/figure/measure.ts` plus tests.

Given the resolved geometry, compute the quantities a label can name: segment length between two points, angle measure at a vertex (honouring `@angle`), and later arc measure. Provide the single number-formatting function **F2** requires, with stated precision.

Then the assertion rule from **F1**: compare a stated value against the computed one within `GEOM_EPS`, and produce a legible failure naming the label, the stated value and the computed one. Suppress under `@scale: false`.

**Tests:** lengths and angles against hand-computed values on non-axis-aligned inputs; both angle modes; the assertion passing, failing with a legible message, and being suppressed by the not-to-scale flag; the formatter pinned. **Prove the assertion test can fail by deleting the comparison**, not by perturbing the expected value.

---

### Task 2: Notation rendering

Create `graph-engine/src/figure/notation.ts` plus tests.

Per **F3**: given a rendered text extent, emit the overbar, ray arrow, double-arrow and arc overmark as SVG geometry correctly positioned above the glyphs. Provide the relation symbols as plain characters.

Notation must compose with measures — `AB = 8` where `AB` carries a segment overbar and `= 8` does not.

**Tests:** each mark's geometry relative to a given text extent; the mark scales with font size; a mark over a two-character label versus a three-character one is positioned correctly; output deterministic. Verify by geometry, not by asserting a string contains `<line>`.

---

### Task 3: The label grammar

Modify `graph-engine/src/parser/parseStatement.ts` and `types.ts`; wire into `graph-engine/src/figure/render.ts`. Tests in the existing parser and figure test files.

Grammar:
```
label: AB                 # computed length
label: AB = 8             # asserted
label: AB = x             # symbolic
label: angle ABC          # computed measure
label: angle ABC = 30     # asserted
segment AB                # notation form: overbar
ray AB                    # arrow
line AB                   # double arrow
```
Decide and state how an author selects notation versus plain text, and keep it consistent with the existing `label:` clause on `angle:`.

**Tests:** each form parses; an assertion failure surfaces as a legible spec error rather than a silent wrong figure; a measure label renders into the figure at a sensible position and participates in Phase 2's label-collision layout rather than bypassing it.

---

### Task 4: The givens box

Extend `graph-engine/src/figure/document.ts` plus tests.

An optional boxed panel — corner or side, author's choice — listing given values and relations instead of crowding the drawing. Inline and boxed labelling coexist per label.

The box participates in **E3**'s auto-fit: it must not overlap the figure, and the viewBox must contain both.

**Tests:** box placement in each supported position; contents laid out in stated order; the box never overlaps drawn geometry; auto-fit expands to include it; deterministic output.

---

### Task 5: Pan and zoom

Modify `graph-engine/src/FigureView.tsx` plus tests where the logic is testable in node.

Per **F4**: drag to pan, wheel to zoom, both as viewBox transforms. Labels and markers hold constant on-screen size. Provide a reset-to-fit control.

Put the viewBox arithmetic in a **pure, exported, testable function** — `FigureView` itself is not render-tested here because vitest runs node-only, so the decisions must live somewhere a test can reach, exactly as `resolveMode` does.

**Tests:** zoom about a point keeps that point fixed (the property that makes zooming feel right, and the one most often got wrong); pan translates without scaling; zoom limits clamp; reset restores the fitted view; label scale compensation computed correctly. Test the pure function directly.

---

### Task 6: Panels — a figure and a table together

Modify `graph-engine/src/GraphViewer.tsx` and the mode plumbing plus tests.

Per **F5**: a spec with both geometry and table statements renders both side by side. `@mode: table` still means table only. Decide the layout rule (side-by-side, wrapping narrow) and state it.

**Tests:** geometry + table renders both panels; geometry alone renders one; `@mode: table` with geometry present renders only the table; `@mode: graph` unaffected; existing table-only specs render identically to before.

---

## Verification

1. All three checks clean; all 437 pre-existing tests still passing.
2. A figure with computed measures on every side and angle renders correctly, with notation marks.
3. A deliberately wrong assertion (`label: AB = 99` on a side that is 8) fails with a message naming both values.
4. The same figure under `@scale: false` renders `99` without failing.
5. Zooming about a point holds that point still; labels do not grow.
6. A spec with a triangle and a data table renders both.
7. Byte-identical output at a fixed view state.

## Out of scope

Exact/symbolic values (specced, lands at build-order step 3 — measures print decimals until then), the unit circle, circle vocabulary, shading and boolean regions, 3D grammar and the solid vocabulary (Phase 4), and all competition-specific constructions. Build none of them.
