# Geometry v2, Phase 4 — Circle Vocabulary and the Givens Table

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the two gaps a reader hits first. Circles can currently only be drawn as an outline and intersected — no chord, arc, sector, tangent or secant — which is most of why circle geometry is unauthorable. And the givens panel is a stack of text lines where it should be a table.

**Architecture:** all of this sits on the existing construction layer (Phase 1) and SVG figure renderer (Phases 2–3). No new renderer, no new maths module beyond circle constructions.

**Tech Stack:** TypeScript, React 19, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 2 — Geometry v2". Read the full circle-vocabulary table and the "A givens table" section, including its 2026-09-23 revision, before Task 1.

## Global Constraints

- **No new runtime dependencies.**
- **All 603 existing tests keep passing**, none weakened or deleted.
- **Determinism.** Byte-identical SVG for the same input at the same view state.
- **Reuse `GEOM_EPS`.** Do not introduce a second tolerance.
- **Multi-solution constructions reuse the existing ordering rule** — sorted by x ascending then y, exactly as `intersect` does. `tangent from P` returns two lines and must be ordered the same way, for the same reason: reproducibility.
- Test command: `npm run test --workspace=graph-engine`, plus `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine`. All three clean per task.
- Commit per task, lowercase `type(scope): summary`, body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  A fixed repo convention, not a description of which model did the work.

## Load-bearing decisions

**G1 — An arc states its direction.** "The arc from P to Q" is ambiguous: there are two. Every arc construction carries an explicit sense (minor/major, or clockwise/counter-clockwise — pick one and state it), and the grammar must make the choice visible rather than defaulting silently. A figure that silently draws the wrong arc is worse than one that refuses.

**G2 — Arc measure and central angle are the same number.** They are computed from one function so they cannot disagree. `label: arc PQ` and the central angle mark must never print different values for the same arc.

**G3 — Tangency is a tolerance question.** After a chain of constructions, "does this line touch this circle" is never an exact test. Use `GEOM_EPS`. A near-miss must fail legibly — naming the gap — rather than drawing a tangent that visibly crosses.

**G4 — The givens panel is a table.** Aligned columns (subject, relation, value), optional header, consistent row rhythm, sections (`Given`, `Find`). Column alignment measures the **rendered** run including overmarks, not bare glyphs — otherwise every row containing an overbar is visibly misaligned.

**G5 — It is not the data table.** `@mode: table` remains the separate data-presentation path. The givens table is part of the figure, inside the same SVG, sized and placed with it.

---

### Task 1: Circle constructions

Extend `graph-engine/src/scene/geometry/` with a circle module plus tests.

Closed-form constructions for: chord between two points on a circle; arc with **G1**'s explicit direction; sector; circular segment; tangent at a point on the circle; **tangent from an external point** (two solutions, ordered per the shared rule); secant through a point; radius; diameter.

Failure cases per **G3** and the existing degeneracy policy: a tangent from a point *inside* the circle, a chord through a point not on the circle, a degenerate arc where the endpoints coincide.

**Tests:** each construction against hand-computed values on a non-axis-aligned circle. Tangent-from-external-point verified by checking the tangent length is equal on both solutions and that each touches at exactly one point. Ordering of the two tangents pinned. Every failure case rejected with a legible message. **Prove the ordering test can fail by deleting the sort**, not by reversing it — reversal catches an inverted comparator but not a missing sort, which is how an ordering bug already reached review once in this project.

---

### Task 2: Arc measure, and its agreement with the central angle

Extend the measure module from Phase 3 plus tests.

Per **G2**: one function computes the measure; arc labels and central-angle marks both read it. Honour `@angle` for degrees versus radians. Radians print as decimals for now — exact π multiples arrive with exact values at build-order step 3, so route through the existing single formatter and do not attempt symbolic output here.

**Tests:** arc measure against hand-computed values in both angle modes; the arc and its central angle producing identical numbers (assert they are equal, from one call each — a test that computes the expected value twice the same way proves nothing); a major arc measuring greater than 180°; measure of a full circle.

---

### Task 3: Circle grammar and rendering

Extend `parseStatement.ts`, `types.ts` and `figure/render.ts` plus tests.

Grammar for everything in Task 1, following the spec's table. Arcs render as SVG path arcs — not polyline approximations — because a real arc is what SVG is good at and a sampled one defeats the crispness the renderer exists for. Sectors and segments are filled regions and belong in the `regions` layer, behind lines, per the existing layer order.

Inscribed and central angle marks.

**Tests:** each grammar form parses; a wrong arc direction is not silently drawn (**G1**); arcs emit path arcs rather than polylines; sector and segment fills land in the `regions` layer; a full worked circle figure — a circle with a chord, its minor arc shaded as a segment, a tangent at one endpoint and a secant through it — renders correctly.

---

### Task 4: The givens table

Rework the givens panel in `figure/document.ts` (and wherever its layout lives) plus tests.

Per **G4**: aligned columns, optional header, row rhythm or rules, and sections. Cells contain notation runs, and **column widths measure the rendered run including overmarks**.

Grammar for a header and sections — decide the spelling, keep it consistent with the existing `given:` statement, and state what you chose.

**Tests:** columns align across rows of differing subject width; a row containing an overbar aligns with one that does not (this is the case the naive implementation gets wrong); the header renders; two sections render with their own headings; the box still participates in auto-fit and never overlaps the drawing; deterministic output. Build the alignment test from measured positions, not from the presence of elements.

---

### Task 5: Harness examples

Extend `graph-engine/src/App.tsx`.

Three phases of geometry shipped without any example exposing them, and the user could not find features that existed. Do not repeat it. Add examples covering: the circle vocabulary (chord, arc, sector, tangent, secant in one readable figure), a tangent-from-external-point construction, arc measure labelling, and a figure with a full givens table including a `Find` section.

**Tests:** extend or add a check that **every** example in the file parses with zero errors and, when it resolves to figure mode, emits drawn elements. A broken example button is immediately visible to a user and must not be possible to ship.

---

## Verification

1. All three checks clean; all 603 pre-existing tests still passing.
2. A circle figure using chord, arc, sector, tangent at a point, tangent from an external point and secant renders correctly.
3. `label: arc PQ` and the central angle for that arc print the same number, in both angle modes.
4. A givens table with a header, two sections, and rows mixing overbarred and plain subjects has visibly aligned columns.
5. Every harness example parses and draws.
6. Byte-identical output at a fixed view state.

## Out of scope

Exact/symbolic values (radians print decimals until step 3), the unit circle, shading beyond sectors and circular segments, 3D grammar and the solid vocabulary (a later phase), and competition-specific constructions — excircles, the nine-point circle, radical axes, cevian concurrency, homothety. Build none of them.
