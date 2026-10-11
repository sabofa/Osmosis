# Geometry v2, Phase 10 — Solid Figures: Measures and Marks in Space

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** mark and measure the angles and distances competition 3D problems ask about:
- angle arcs, right-angle marks and congruence ticks on points in space;
- angles between lines (including skew lines) and between a line and a plane;
- dihedral angles, with their plane-angle mark drawn on the edge (AIME 2016 I: "the dihedral angle … measures 60°");
- point-to-plane, point-to-line and skew-line distances, and the common perpendicular of two skew lines as a construction.

**Architecture:**
- **Values** are closed-form, from the phase 6 maths (`construct3d.ts`), in true 3D.
- **Marks** are built in the angle's own plane in space and projected through the existing camera: an arc is a circle arc in 3D, drawn as a projected elliptical arc by `projectCircle`, and a right-angle mark is a square in 3D, drawn as a parallelogram.
- 2D marks and 2D measures are unchanged. This phase only lifts phase 6's refusals for points in space and adds the space-only forms.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 2, "Revised 2026-09-25", build step 10: "Measures and marks in space — angles between lines, line–plane and dihedral angles with their marks, skew-line distance with the common perpendicular, right-angle marks in space". Also read "Measure assertions and `@scale: false` are designed together" in the handoff's design decisions. Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, especially "Worktrees, milestones and parallel agents", lesson 1, and the phase 5–9 sections.

**Where you work:** branch `milestone-a/geometry`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`. Other agents work in parallel in their own worktrees; follow the handoff's rules. **Every new example needs a `group`** (see `EXAMPLE_GROUPS` in `examples.ts`). The new group for this phase's examples is `'Measures in space'`: add it to `EXAMPLE_GROUPS` after `'Spheres'`.

**Prior work to consume:**
- `figure/construct3d.ts`: `angle3`, `lineLineDistance`, `pointLineDistance`, `pointPlaneDistance`, `footToLine3`, `footToPlane`, and the Vec3 toolkit.
- `figure/plane.ts`: every phase 8 plane operand, including named planes.
- `figure/silhouette.ts`: `projectCircle` and `ellipseFromConjugates`.
- `figure/occlusion.ts`: `segmentSpans`, the exact visibility of a segment against every solid.
- `render/geometryMarks.ts`: the 2D `angleSweep`, `rightAngleSquarePoints` and `tickMarkSegments`, reused for sizes and conventions where they apply.
- `figure/render.ts`: the phase 6 refusals for angle marks, ticks and inline angle labels on space points (around lines 617 and 1039), which this phase replaces; the givens table.

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical:** every pre-existing spec renders byte-for-byte as before under every view. 2D angle marks, right-angle marks, ticks and measures are untouched. Only statements on **points in space**, which phase 6 refused, change: they now draw. No existing test is weakened or deleted. The one exception: the tests that pinned those phase 6 refusals are rewritten to pin the new behaviour, and each rewrite says so.
- **No numeric solver, no sampling-as-answer.** Values and constructions are closed-form. The one sampled decision is M4's visibility of a small mark, a stated drawing convention that decides a whole mark and never locates a split.
- **Reuse `GEOM_EPS`,** the one Vec3 toolkit, and the existing angle formatter and `@angle` unit handling. **Author frame is z-up;** conversion stays in `authorFrame.ts`. **Placement never depends on the active view.**
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and in the author's names.
- **Every emitted element carries `data-statement` / `data-object`.** Every new capability has an example, with a `group`.
- **Proving a test can fail means deleting the behaviour it covers.** Record which deletion proved which test in each commit body. Hand-compute every expected value independently of the code. Never use an axis-parallel segment as the sole proof of true-versus-projected.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, with explicit `git add <paths>` (never `-A` or `.`). The body ends EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, a fixed repo convention.
- **Vocabulary:** say "solid figure" or "space", never "3D engine" alone.
- **Visual checks:** no review server and no browser page scripts. Render to SVG with `vite-node`, then to PNG with headless Edge (`--headless=new --screenshot=… --user-data-dir=<fresh dir per shot>`), into `.superpowers/sdd/<plan>/scratch/`.

## Load-bearing decisions

**M1: marks live in the angle's plane in space, then project.**
- **Angle arc.** For an angle A-B-C on space points, the arc is the circle arc centred at B in the plane of A, B and C, from ray BA to ray BC through the interior angle.
  - Its radius in world units is **0.2 × the shorter arm** (min(|BA|, |BC|)).
  - It is drawn as a projected elliptical arc through `projectCircle` (centre B, u = ρ·unit(BA), v = ρ·the unit in-plane perpendicular toward C). It is **never** a polyline.
- **Right-angle mark.** The square B, B + s·û, B + s·û + s·v̂, B + s·v̂, with s = **0.15 × the shorter arm**, drawn as the projected parallelogram.
- **Tick marks** on a space segment are drawn in the **picture plane**, perpendicular to the projected segment at its projected midpoint, using the 2D tick convention. A congruence tick is an annotation on the drawing, not an object in space.
- **Degenerate cases:** a degenerate arm, or A, B and C collinear, is refused, naming the points.

**M2: right angles in space are asserted.**
- `right-angle: A-B-C` on space points refuses to draw unless the true angle at B is 90° within tolerance: "A-B-C is not a right angle — its true angle is 45°".
  - A projected square on a non-right angle would state something false, and a reader cannot check it by eye in a projection.
- `@scale: false` suppresses the check, exactly as it suppresses measure assertions.
- **2D `right-angle:` behaviour is unchanged.** Say that in the grammar header.

**M3: dihedral angles.**
- `dihedral: C-A-B-D` names the dihedral angle along edge AB between half-plane ABC and half-plane ABD. The edge is the **middle two** names, the notation for "C-AB-D".
- **The value** is the angle in [0°, 180°] between `u` and `v`:
  - `u` is the component of (C − M) perpendicular to AB, normalised;
  - `v` is the same for D;
  - M is the midpoint of AB.
- **The mark** is the dihedral's plane angle drawn at M:
  - two construction segments, M→M + ℓu and M→M + ℓv, with ℓ = **0.3 × |AB|**;
  - M1's arc between them, whose radius is 0.2 × ℓ.
- **Refusals:** A = B; C or D on line AB (the half-plane is undefined).
- **Measuring:** `label: dihedral C-A-B-D` prints the value on the mark, and `given: dihedral C-A-B-D` / `find:` put it in the table. The `= value` form asserts, as every measure does.

**M4: visibility of marks, under the glass rule.**
- **Segments** that belong to a mark (a dihedral's two construction segments) use phase 6's `segmentSpans`, which is exact.
- **Arcs, right-angle squares and ticks** are small, and each is drawn **entirely visible or entirely hidden**. The deciding point is its midpoint: the arc's middle point, the square's centre, or the tick's point on the segment. The midpoint is tested with `hidesPoint` against every solid.
- This is a stated drawing convention, not a geometric answer, and the grammar header says so.
- A hidden mark is dashed like a hidden edge.

**M5: measures between lines and planes, in the givens table.** These are **table rows only**: the forms have no single vertex to hang an inline label on.
```
given: angle between A-B and C-D           # the acute angle between the two lines' directions (skew allowed)
given: angle between A-B and plane P-Q-R   # line–plane angle, in [0°, 90°]; any phase 8 plane operand
given: distance between A-B and C-D        # line–line distance (skew or parallel; 0 if they meet)
given: distance from P to plane P-Q-R
given: distance from P to line A-B
find: …                                    # every form above also works as "find:"
```
- Inline `label:` on these forms is refused, with a pointer to the table or to drawing the construction (a foot or a common perpendicular) and labelling the segment.
- `= value` asserts.
- The table shows readable notation. For example, "∠(AB, CD)", "∠(AB, PQR)", "d(AB, CD)", "d(P, PQR)" and "d(P, AB)" is acceptable; the choice is yours, but document it.

**M6: the common perpendicular, as a construction.**
- `P, Q = common perpendicular of A-B and C-D` binds P on line AB and Q on line CD, where PQ is perpendicular to both. It is closed-form.
- **Refusals:**
  - Parallel lines: "A-B and C-D are parallel, so their common perpendicular is not unique".
  - Intersecting lines: "A-B and C-D meet at a point, so their common perpendicular has zero length". Name the intersection point's coordinates in author form.
- P and Q are ordinary space points: `segment: P-Q`, `label: PQ` and `right-angle: A-P-Q` all work on them.

**M7: inline angle labels on space points.**
- `label: angle ABC` on space points no longer refuses. It draws M1's arc and hangs the label on the arc's middle, pushed outward along the angle's bisector in space, then projected. This matches the 2D behaviour of the same statement.
- `angle: A-B-C label: 60°` works as in 2D.

**M8: out of scope.** Angle marks between skew lines (there is no vertex), marks for line–plane angles (the author draws the foot and marks `angle: A-P-F`), area and volume measures, exact values, and nets. Refuse legibly where an author could ask for these.

---

### Task 1: Measures and the common perpendicular

**Files:** the parser (M5's `between` / `from` forms, `dihedral` subjects, M6), `parser/types.ts` (measure subjects), `figure/render.ts` (the givens table, measure values), `figure/solidScope.ts` (M6 binding), `figure/construct3d.ts` (the common-perpendicular solve, and a dihedral helper if it fits there), and tests.

- [ ] **Step 1: failing tests.** Use the unit cube A=(0,0,0), B=(1,0,0), C=(1,1,0), D=(0,1,0), E=(0,0,1), F=(1,0,1), G=(1,1,1), H=(0,1,1).
  - `given: angle between A-C and B-G` is **60°**: directions (1,1,0) and (0,1,1).
  - `given: angle between A-G and plane A-B-C` is **arcsin(1/√3) ≈ 35.26°**.
  - `given: distance between A-G and B-F` is **√2/2**.
  - `given: distance from G to plane B-D-E` is **2/√3**: the plane is x+y+z=1.
  - `given: distance from G to line A-B` is **√2**.
  - **Common perpendicular:** `P, Q = common perpendicular of A-G and B-F` gives **P = (½, ½, ½)** and **Q = (1, 0, ½)**, and `label: PQ` prints √2/2. Also: parallel lines A-B and D-C are refused; intersecting lines A-B and A-D are refused, naming (0, 0, 0).
  - **Dihedral values:**
    - `given: dihedral A-B-C-G`, along edge BC between faces BCA and BCG of the cube, is **90°**.
    - The regular tetrahedron of edge 6 has dihedral **arccos(1/3) ≈ 70.53°** along any edge.
    - The octahedron of edge 6 has **arccos(−1/3) ≈ 109.47°**.
    - **AIME 2016 I:** on `prism regular 6 side 12, height sqrt(108) vertices ABCDEFGHIJKL`, `given: dihedral A-B-F-G` (edge BF, the base face through A against the face GBF) is **60°**. Check: A is 6 from BF, and tan 60° = √108/6.
  - **Asserting forms:** `given: dihedral A-B-C-G = 90` passes, and `= 80` fails naming the true value. `@angle: radians` prints π/2 as 1.571.
  - **Refusals:** inline `label: angle between …` points at the table.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Replace the common-perpendicular solve with the foot of P onto line CD: the P = (½,½,½) test must go red.
  - Drop the perpendicular-component step in the dihedral (use C − M directly): the AIME 60° test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): angles, distances and dihedrals in space, and the common perpendicular`.

### Task 2: Angle arcs, right-angle marks and ticks in space

**Files:** `figure/render.ts` (replace phase 6's refusals for angle, right-angle and tick on space points; new mark items or extensions of the existing ones carrying 3D geometry), `figure/silhouette.ts` (reuse only), a small `figure/spaceMarks.ts` if it keeps `render.ts` focused, and tests.

- [ ] **Step 1: failing tests** on the unit cube:
  - **Angle arc:**
    - `angle: A-B-G` draws one SVG elliptical arc (`A` command, not a polyline).
    - Its projected endpoints equal `camera.project(B + 0.2·min(|BA|,|BG|)·unit(BA))` and the same toward G, within `GEOM_EPS` in picture units.
    - The swept angle in space is 90°. Assert that through the arc's 3D definition, not the picture.
  - **Inline label:** `label: angle ABG` draws the arc and a label reading **90**.
  - **Right angles:**
    - `right-angle: A-B-G` draws a parallelogram whose 3D corners are B, B + s·x̂, B + s·x̂ + s·ŷ, B + s·ŷ in the angle's frame, with s = 0.15.
    - `right-angle: A-B-D` (45°) is refused with "its true angle is 45°", and draws under `@scale: false`.
  - **Tick:** `tick: A-G count: 2` draws two ticks perpendicular to the projected A–G at its projected midpoint.
  - **M4 visibility:**
    - An angle arc at a hidden corner of a solid cube (hull of the cube's points) is dashed.
    - The same arc on a front face is solid.
    - Assert the midpoint rule directly, by moving the mark's midpoint across a face boundary in a constructed case.
  - **2D unchanged:** every existing 2D angle, right-angle and tick spec is byte-identical, confirmed by the sweep.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Draw the arc in the picture plane (the 2D sweep of the projected rays) instead of in space: the endpoint test must go red.
  - Delete the 90° assertion: the refusal test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): angle arcs, right-angle marks and ticks on points in space`.

### Task 3: Dihedral marks

**Files:** the parser (`dihedral:` statement; `dihedral` as a label subject), `figure/render.ts`, `figure/spaceMarks.ts`, and tests.

- [ ] **Step 1: failing tests:**
  - **Hexagonal prism (AIME):** `dihedral: A-B-F-G` draws two construction segments from the midpoint M of BF, each of length 0.3·|BF| in world units, along u and v per M3, and an arc between them. `label: dihedral A-B-F-G` prints **60**.
  - **Visibility per M4 (prism):** the construction segments use `segmentSpans`. In the AIME prism, **both** are dashed:
    - the one in face ABF lies in the base, which faces away under `standard`;
    - the one in plane GBF runs through the prism's interior (glass rule: construction lines are occluded by solids).
    - Assert both.
  - **Cube:** `dihedral: A-B-C-G` prints 90, and its arc spans 90° in space. Under `standard`:
    - the segment in half-plane BCA lies in the hidden base, so it is **dashed**;
    - the segment in half-plane BCG lies on the +X face, which faces the camera, so it is **solid**.
    - Assert both.
  - **Straddling case:** add a second solid in front of part of one construction segment, so that segment splits visible–hidden. This is the case the next step's deletion must break.
  - **Refusals:** C on line AB; A = B.
  - **Determinism:** two renders are byte-identical.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Use (C − M) without removing its AB component for the mark direction: the segment-direction test must go red.
  - Classify the construction segments by the midpoint rule instead of `segmentSpans`: the dashed/solid test must go red, provided the test is built so a segment straddles a visibility change. Build it that way.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): dihedral angles drawn as their plane angle on the edge`.

### Task 4: Examples, reference and handoff

**Examples,** all in group `'Measures in space'`:
1. **"AIME: dihedral in a hexagonal prism":** side 12, height sqrt(108), the pyramid on A and its neighbours B, F, G drawn as segments, `dihedral: A-B-F-G` with its label, and `find: h` or the height labelled.
2. **"Skew lines and their common perpendicular":** a unit cube by points, the diagonal A-G and edge B-F drawn, `P, Q = common perpendicular …`, `segment: P-Q`, right-angle marks at P and Q, and `label: PQ`.
3. **"Angles in a cube":** an arc for angle A-B-G with its label, `right-angle: A-B-G`, and ticks on two equal face diagonals.
4. **"Tetrahedron's dihedral angle":** a regular tetrahedron with one dihedral marked and labelled (70.53°).
5. **"Line meets a plane":** the diagonal A-G, its foot F on the base plane, `angle: G-A-F` marked, and a `given:` row with `angle between A-G and plane A-B-C`.

**Reference:** the grammar header documents M1–M8, including the M4 convention, the M2 assertion and its `@scale: false` escape, and the M5 table notation.

**Handoff:**
- Add a phase 10 row.
- Record the M4 convention and why arcs are decided whole.
- Update the open items, including that marks between skew lines are out of scope.

- [ ] **Step 1:** add the examples, plus the `'Measures in space'` group in `EXAMPLE_GROUPS`, and run `examples.test.ts`. Render each to PNG and inspect it.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 10 measures and marks in space — examples, reference, handoff`.

## Verification

1. All three checks clean, and every pre-existing spec is byte-identical under every view.
2. The AIME prism's dihedral reads 60° at height √108. The cube's skew distance and common perpendicular match the hand values.
3. Arcs are projected elliptical arcs built in space. Right angles in space assert 90° unless `@scale: false`.
4. Every new example is drawn and inspected in PNG.

## Out of scope

Everything in M8, nets (build step 11), exact values, and the tutor reference.
