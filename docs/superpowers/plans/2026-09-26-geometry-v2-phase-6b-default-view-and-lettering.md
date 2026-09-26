# Geometry v2, Phase 6b — A Default View That Works for Cubes, and Textbook Lettering

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make the two most common competition solids draw correctly by default. Today, exact isometric puts a cube's front and back corners on the same point, and flattens a regular tetrahedron so its altitude hides under an edge. Also re-letter prisms and pyramids in textbook order.

**Architecture:** add a new named camera, `standard`, which becomes the default. Keep `isometric` as a named view with its exact bytes. Tie the placement conventions (the tetrahedron's rotation, the dimension-label edges, vertex lettering) to the default camera rather than the active one.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`. Read the Track 2 "Solids" section, and in particular "Revised 2026-09-25", sub-section **"The default view is not isometric (decided 2026-09-26)"**. That sub-section holds the exact values this plan implements. Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, especially lesson 1 and the phase 5/6 sections.

**Prior work:** `figure/project3d.ts` (`Camera`, `VIEWPOINT_NAMES`, `cameraFor`, `projectPoint`, `ISOMETRIC_CAMERA`, `projectSolid`'s default camera parameter), `figure/solids.ts` (H1 placement rules, `BASE_START_ANGLE`, `labelOrder`, `solidDimensionSegment`), `figure/authorFrame.ts` (author ↔ internal), the parser/config default for `@view`.

## Global Constraints

- **No new runtime dependencies.**
- **Determinism.** Output is byte-identical for the same input at the same view state. Every number goes through the one formatter in `figure/svg.ts`.
- **`@view: isometric` output is byte-identical to today's default output**, except that vertex letters move (Task 2). Pin that before changing anything.
- **Sanctioned test changes.** Only two kinds of existing test change are allowed:
  1. Byte-pinned solid tests that relied on isometric being the default gain an explicit `@view: isometric` and keep their fixtures.
  2. Tests whose expectations encode the old vertex lettering are rewritten to the textbook order, and each rewrite asserts the new lettering explicitly.

  No other test is weakened or deleted.
- **Reuse `GEOM_EPS`.** Every emitted element carries `data-statement` / `data-object`.
- **Placement never depends on the active view.** Switching `@view:` must not re-letter, re-orient or re-choose the dimension edge of any solid.
- **Proving a test can fail means deleting the behaviour it covers,** not perturbing its inputs. Under the `standard` camera, axis-parallel segments no longer draw at true length. Still, never use an axis-parallel segment as the sole proof of true-versus-projected: prefer a diagonal.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, lowercase `type(scope): summary`, body ending EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. That line is a fixed repo convention.
- **Vocabulary:** say "solid figure" or "space", never "3D engine" alone.

## Load-bearing decisions (from the spec; exact values)

**V1: the `standard` camera.**
- It is orthographic, looking from **azimuth 30°** (from author +X toward +Y) and **elevation 25°**.
- Author Z projects to **page-up**, so vertical edges draw vertical.
- Uniform scale is **1**.
- It is built from its frame (`scale * dot(p, right)`, `scale * dot(p, up)`), converted into the internal frame through `authorFrame.ts`. Do not hand-derive a byte route for it: it has no legacy bytes to protect.
- It is the default for `@view`, and `VIEWPOINT_NAMES` gains `'standard'`.
- `isometric`, `front`, `top` and `side` are unchanged.

**V2: placement follows the default camera, not the active view.**
- The tetrahedron's first base vertex sits at the default camera's azimuth **+15°** (the rule 4 that `BASE_START_ANGLE` names today). This replaces "exactly facing the viewer".
- Update the H1 comment block to say why: facing the viewer exactly puts the apex, the front vertex and the base centroid in one vertical plane with the view.
- The dimension-label edges ("the front of the drawing under the default camera") are re-chosen for `standard`.

**V3: textbook lettering.**
- **Prism:** ABCD run counter-clockwise seen from above. **A is the front-left bottom corner** under `standard`, so the front face is ABFE and D is the hidden corner. E–H sit above A–D, with E over A.
- **Square pyramid:** base ABCD by the same rule, apex E.
- **Tetrahedron:** A is the first base vertex, B and C follow counter-clockwise seen from above, and D is the apex.
- Lettering lives in `labelOrder` and is view-independent (V2).

---

### Task 1: The `standard` camera, made the default

**Files:** modify `graph-engine/src/figure/project3d.ts`, the `@view` default in the parser/config, and `graph-engine/src/figure/solids.ts` (V2's tetrahedron rotation and dimension edges). Tests go in `project3d.test.ts`, `solids.test.ts` and `render.test.ts`.

- [ ] **Step 1: fixtures first.** Before any change, add `@view: isometric` to every byte-pinned solid test that relied on the default. Confirm that these tests stay green on the unchanged code: this proves the explicit directive reproduces the old default exactly.
- [ ] **Step 2: failing tests:**
  - `cameraFor('standard')` has a unit `direction` equal to the author direction (cos25·cos30, cos25·sin30, sin25), converted to internal. Its `up` is the projection of author Z, and right × up = direction.
  - With no `@view`, the camera is `standard`.
  - **Cube non-degeneracy.** For a unit cube placed by points, no two of the 8 vertices project closer than **0.45**. Under `isometric` the same assertion fails, because two vertices coincide, so the test demonstrably distinguishes the two views.
  - **Tetrahedron:**
    - Every face's angle to the view direction is at least **20°** from edge-on.
    - The projected altitude (apex to base centroid) is at least **8°** from every projected edge at the apex.
    - Exactly **one** edge is dashed: the back base edge.
  - **Box:** an 8×5×6 prism draws exactly **three** dashed edges, the ones meeting at the hidden corner.
  - **Placement is view-independent.** A tetrahedron's vertex positions (in world coordinates) are identical under `@view: standard`, `isometric` and `front`. The dimension-edge choice is identical too.
- [ ] **Step 3: implement V1 and V2.**
- [ ] **Step 4: prove it.**
  - Set the tetrahedron offset back to 0°: the altitude-separation test must go red.
  - Make placement read the active camera instead of the default: the view-independence test must go red.
  - Restore both.
- [ ] **Step 5:** run all three checks, then commit as `feat(graph-engine): a standard default view in general position, isometric kept by name`.

### Task 2: Textbook vertex lettering

**Files:** modify `graph-engine/src/figure/solids.ts` (`labelOrder` for prism, pyramid and tetrahedron, plus the H1 comment), the grammar header in `graph-engine/src/parser/parseStatement.ts`, and tests.

- [ ] **Step 1: failing tests**, using an 8×5×6 prism with `vertices ABCDEFGH`, under `standard`:
  - A is the front-left bottom corner: in author coordinates it is the corner with the largest X and the smallest Y at the bottom.
  - B, C, D follow counter-clockwise seen from above.
  - E is directly above A.
  - D is the hidden corner, and its three edges are the three dashed ones.
  - The space diagonal A–G projects **longer than any edge of the box**. It is the "long" diagonal, not the one aimed at the viewer.
  - `label: AB` measures the front bottom edge. With the width along Y, that is 8.
  - Pyramid: A–D counter-clockwise, E the apex. Tetrahedron: D the apex.
- [ ] **Step 2: implement.** Rewrite lettering-dependent expectations in existing tests to the new order. Each rewritten test asserts the new lettering explicitly; do not just update a number.
- [ ] **Step 3: prove it.** Revert `labelOrder` for the prism: the "E is over A" and "D is hidden" tests must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): textbook vertex lettering for prisms, pyramids and tetrahedra`.

### Task 3: Examples and handoff

**Files:** modify `graph-engine/src/examples.ts` and `docs/HANDOFF-2026-09-23-graph-engine-v2.md`.

- **Examples:** review every solid example under the new default. Two need fixing: "Cube by points", whose hand-dashed edges assumed A at the hidden corner, must now dash the edges at the new hidden corner; and "Box diagonal", whose AG must now draw long. Add one example, **"Regular tetrahedron and its height"**: a tetrahedron with edge 6, `vertices ABCD`, the foot of D to plane A-B-C, the segment D–F, and `label: DF`.
- **Handoff:**
  - Close open item 9 (camera and lettering) with what was decided.
  - Record `standard` as the default view.
  - Add to "Lessons that cost real time": exact isometric is degenerate for a cube, and the phase 5 examples hid it because 8×5×6 has unequal sides.
- [ ] **Step 1:** run `examples.test.ts`. Render each solid example to a scratch SVG with `vite-node` and inspect the output.
- [ ] **Step 2:** run all three checks, then commit as `docs: the standard view and textbook lettering — examples and handoff`.

## Verification

1. A unit cube with no `@view` draws 8 distinct vertices. With `@view: isometric` it draws exactly as before.
2. A regular tetrahedron shows one dashed edge, and its altitude is clearly separated from every edge.
3. A prism reads ABFE on its front face with D hidden, and AG draws long.
4. Switching `@view:` never re-letters or re-orients a solid.
5. All three checks clean. The only test changes are the sanctioned ones.

## Out of scope

Everything in build steps 7–11, oblique or cabinet projection, free camera, and exact values.
