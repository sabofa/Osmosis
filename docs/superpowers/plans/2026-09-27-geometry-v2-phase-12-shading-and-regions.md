# Geometry v2, Phase 12 — Shading and Shaded Regions

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** draw and measure "find the area of the shaded region" figures in plane geometry:
- a polygon, a disk, a sector or a circular segment, shaded;
- boolean combinations of them, such as a square minus its inscribed circle, the lens of two circles, an annulus, a crescent, or the arbelos;
- their **area**, measured exactly from the geometry and asserted like every other measure.

**Architecture:**
- **A pure, renderer-agnostic 2D region engine** in `scene/geometry/regions.ts`, the same layer as the phase 1 constructions. A region is a set of closed loops whose pieces are **line segments and circular arcs**.
- **Booleans** (union, intersection, difference) work in closed form:
  1. split both regions' boundaries at every mutual intersection (closed-form segment–segment, segment–arc and arc–arc);
  2. classify each piece against the other region by its midpoint (exact, because no piece crosses the other boundary);
  3. keep the pieces the operator needs;
  4. chain them back into loops.
- **Area** is exact: the shoelace sum over chords plus each arc's circular-segment term.
- The figure renderer draws a region as **one SVG path** (straight segments plus `A` arc commands) in the regions layer, behind every line.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 2:
- the circle vocabulary section: "Shading: `fill: A-B-C`, `fill: sector P-Q on O`, and boolean regions (`fill: square ABCD minus circle O`) for 'find the area of the shaded region'";
- "Overlap is the norm, so draw order is semantic. Fills must sit behind";
- the Track 2 build order ("… label layout → shading and boolean regions → …");
- the keyword-ownership paragraph (`fill:` is reserved for geometry; `NAME = region …` belongs to space).

Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first: "Worktrees, milestones and parallel agents", lesson 1, the design decisions on measure assertions and exactness, and the phase 3/4 sections (measures, circle vocabulary, arcs with stated directions).

**Where you work:** branch `milestone-a/geometry`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`. Other agents work in parallel in their own worktrees; follow the handoff's rules. **Every new example needs a `group`:** use `'Plane geometry'`, or add `'Shaded regions'` to `EXAMPLE_GROUPS` after `'Plane geometry'` if there are more than three examples.

**Prior work to consume:**
- `scene/geometry/`: `objects.ts` (points, lines, circles, `GEOM_EPS`), `intersect.ts` (line×line, line×circle, circle×circle with the D3 ordering), `circles.ts` (`Arc`, sector, segment, and arc direction resolution).
- `figure/render.ts`: the regions layer and `REGION_OPACITY`; the existing `circleShape` sector/segment fill (**unchanged by this phase**); the measure and givens paths; the `name:` statement clause.
- `figure/svg.ts`: the one number formatter and the arc emitters.

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical:** every pre-existing spec renders byte-for-byte as before under every view. The existing `sector` / `segment` statements are unchanged. Lines using `fill` as a name must parse exactly as at base: `fill = 3`, `fill(x) = x^2`, `fill + x = y`. Add them to the byte sweep; phase 8's `plane = 2` regression is the precedent.
- **No numeric solver, no sampling-as-answer.** Intersections are closed-form, and piece classification is the midpoint test on pieces whose endpoints are exact. Area is closed-form.
- **Reuse `GEOM_EPS`,** scaled to the regions' own extent, never absolute. That is phase 9's lesson.
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and in the author's names.
- **Every emitted element carries `data-statement` / `data-object`.** Every new capability has an example, with a `group`.
- **Proving a test can fail means deleting the behaviour it covers.** Record which deletion proved which test in each commit body. Hand-compute every expected value (the areas below) independently.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, with explicit `git add <paths>` (never `-A` or `.`). The body ends EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Visual checks:** no review server and no browser pane or page scripts. Use `vite-node` to write SVG, then headless Edge to PNG (PowerShell `Start-Process -Wait -NoNewWindow`, with a fresh `--user-data-dir` per shot). Put output in `.superpowers/sdd/<plan>/scratch/`.

## Load-bearing decisions

**F1: the region model.**
- **Pieces.** `Piece = { kind: 'segment'; a; b } | { kind: 'arc'; center; radius; from; to; ccw: boolean }`.
- **Loops.** A `Loop` is a closed chain of pieces. **Outer loops run counter-clockwise and holes run clockwise.**
- **Regions.** A `Region` is a list of loops, so an annulus is one outer loop plus one hole, and a region may have several components.
- **Primitives**, each built from the phase 1/4 objects:
  - a **polygon** from named points, which must be simple (refuse one that crosses itself, naming the crossing edges);
  - a **disk** from a named circle;
  - a **sector** P-Q on O and a **circular segment** P-Q on O, with arc direction resolved exactly as phase 4 resolves it.

**F2: exact booleans.**
- **Splitting.** For A ∘ B, split every piece of each region at its closed-form intersections with the other region's pieces. Dedupe split points within a tolerance scaled to the regions' extent.
- **Classification.** Each resulting piece is **inside**, **outside** or **on** the other region, decided by its midpoint (the arc's middle angle for arcs):
  - The inside test is an exact winding number over segments and arcs.
  - "On" means the midpoint lies on the other region's boundary within tolerance; it only occurs for **coincident** boundary pieces.
- **Selection:**

  | Operator | Keep |
  |---|---|
  | union | A-outside, B-outside, and **one copy** of each coincident piece whose two regions lie on the same side |
  | intersection | A-inside, B-inside, and one copy of each same-side coincident piece |
  | difference A − B | A-outside, B-inside **reversed**, and each coincident piece where A and B lie on **opposite** sides |

- **Assembly.** Chain the kept pieces endpoint to endpoint into loops (within tolerance), then orient each loop by the sign of its area.
  - Merge collinear consecutive segments and concentric consecutive arcs, so that, for example, the union of two squares sharing an edge is **one** loop with no seam.
  - An empty result is a legible refusal: "square ABCD minus circle O leaves nothing to shade".
- **Associativity.** Expressions evaluate left to right, with parentheses; see F4.

**F3: exact area.**
- area(Region) = Σ over loops Σ over pieces of the signed contribution: ½(x₁y₂ − x₂y₁) for each chord endpoint pair, **plus** each arc's circular-segment term ½r²(θ − sin θ), signed by the arc's direction.
- It is exact given exact pieces.
- This is the value `label: area` prints and `= value` asserts.

**F4: grammar.**
```
fill: A-B-C                          # polygon by named points (the spec's own form)
fill: polygon A-B-C-D
fill: triangle ABC
fill: square ABCD                    # asserted: four equal sides, four right angles
fill: rectangle ABCD                 # asserted: four right angles
fill: circle O                       # the disk of a named circle
fill: sector P-Q on O                # arc direction per phase 4 (clockwise / counterclockwise, major/minor as it already allows)
fill: segment P-Q on O               # circular segment
fill: square ABCD minus circle O
fill: circle O and circle P          # intersection — "and" / "intersect"
fill: circle O or circle P           # union — "or" / "union"
fill: (circle O or circle P) minus triangle ABC
fill: … name: R                      # the existing name: clause names the region
label: area R        given: area R [= value]        find: area R
given: area square ABCD minus circle O               # an inline region expression works too
```
- `square` and `rectangle` **assert** their shape, refusing with the true angles or sides unless `@scale: false`, exactly as `right-angle:` in space does. A figure labelled "square" that isn't one would state something false.
- **Colour:** the existing `color:` clause works. Several fills draw in statement order within the regions layer.
- **Named regions** use `name:` because `NAME = region …` belongs to space (spec keyword ownership). Do not add any `NAME = region` form.
- **Refusals:**
  - `fill:` on points in space: "fills are drawn in the plane".
  - `fill:` under `@mode: graph`: "fill: draws in figures — declare @mode: figure".
  - Unknown names; a self-crossing polygon; an empty result.

**F5: drawing.**
- A fill is **one SVG `<path>`**: `M`/`L` for segments, `A` for arcs (never polylines), `Z` per loop, with `fill-rule="evenodd"` so holes render. It is emitted in the **regions layer** at `REGION_OPACITY`, behind every line.
- **The fill draws no outline of its own.** The author's circles, polygons and segments draw the lines. That is the textbook convention, and it avoids doubled edges.
- **Bounds:** the region takes part in bounds (the extremes of its pieces, arcs included).
- **Label avoidance:** fills are a backdrop, not an obstacle.

**F6: where an area label sits.** `label: area R` hangs at a deterministic **interior point**:
- take the region's largest component and its height h;
- consider the **seven horizontal lines** at heights i·h/8 for i = 1 … 7;
- intersect each line with the region's pieces in closed form;
- take the midpoint of the **longest inside chord** over all seven lines, breaking ties by the lowest line, then the leftmost chord.

It is exact and never outside the region: an annulus's label sits in the ring, not in the hole.

A single middle line is **not** enough. For a square minus its inscribed circle, the middle line touches the circle exactly where it meets the square, so every chord there has zero length.

**F7: out of scope.** Hatching patterns (Track 5 styling), fills in graph mode, fills in solid figures (faces in space), regions bounded by conics other than circles, and exact symbolic areas (build step 3 turns 3.434 into 16 − 4π). Refuse legibly where an author could ask for these.

---

### Task 1: The region engine

**Files:** create `scene/geometry/regions.ts` and `scene/geometry/regions.test.ts`. The module is pure: it imports only the 2D geometry types, `intersect.ts` and `circles.ts`.

- [ ] **Step 1: failing tests.** Hand-compute every area.
  - **Primitives:**
    - Triangle (0,0),(4,0),(0,3): area 6.
    - Unit disk: π.
    - Sector r = 2 of 90°: π.
    - Circular segment r = 2 of 90°: ½·4·(π/2 − 1) = **π − 2**.
  - **Square minus its inscribed circle:** side 4, circle r = 2 at the centre: **16 − 4π** ≈ 3.4336. The result is 1 outer loop (the square) and 1 hole (the circle) with correct orientations.
  - **Annulus:** R = 3 minus r = 2 concentric: **5π**. There are no intersection points; the hole is detected by containment.
  - **Lens:** two unit circles with centres 1 apart, intersected: **2π/3 − √3/2** ≈ 1.2284. The result is one loop of two arcs.
  - **Crescent:** the unit circle at the origin minus the unit circle at (1, 0): **π − (2π/3 − √3/2) = π/3 + √3/2**.
  - **Arbelos:** the upper half-disk of radius 2 at the origin minus the upper half-disks of radius 1 centred at (−1, 0) and (1, 0): **π**. It has coincident boundary along the diameter, shared endpoints and tangent arcs.
  - **Coincident edges:**
    - Two 2×2 squares sharing an edge, united: area **8** and **one** loop of 4 segments after merging.
    - Two 2×2 squares overlapping by (1, 1), united: **7**.
    - A square minus the same square: refused as empty.
  - **Self-crossing polygon:** the bow-tie A(0,0) B(2,2) C(2,0) D(0,2) is refused, naming the crossing edges.
  - **Determinism:** the same input gives identical piece lists, and an operand-order swap of a commutative operator gives the same area.
- [ ] **Step 2: implement per F1–F3.**
- [ ] **Step 3: prove it.**
  - Drop coincident-piece handling: the shared-edge union must go red (seam or wrong area).
  - Drop the arc circular-segment term from the area: the disk and lens tests must go red.
  - Drop the containment check for non-intersecting loops: the annulus must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): an exact 2D region engine — booleans over segments and circular arcs, and their areas`.

### Task 2: `fill:` — grammar and drawing

**Files:** the parser (F4, including parentheses and the shape assertions), `parser/types.ts` (the grammar comment and region-expression types), `scene/mode.ts` (`fill` is a GEOMETRY kind, so it infers figure), `figure/render.ts` (F5 emission, bounds, refusals), and tests.

- [ ] **Step 1: failing tests:**
  - **Square minus circle:** `fill: square ABCD minus circle O` on side 4, radius 2 emits **one** `<path>` in the regions layer.
    - Its `d` holds exactly the square's 4 `L`/`M` pieces and the circle's arc pieces as `A` commands (a full circle is two arcs).
    - It has `fill-rule="evenodd"` and `data-statement`.
    - It carries no stroke.
  - **Two fills:** each with its own `color:`, in statement order.
  - **Assertions:** `square ABCD` on a non-square rectangle is refused with the true sides; it draws under `@scale: false`.
  - **Parentheses:** `(circle O or circle P) minus triangle ABC` parses and draws the right loops.
  - **Refusals:** points in space; `@mode: graph`; an unknown circle name; an empty result.
  - **Byte identity:** `fill = 3`, `fill(x) = x^2` and `fill + x = y` parse exactly as at base. Every pre-existing spec is unchanged, confirmed by the sweep.
  - **Mode:** a spec with only `fill:` and its points infers figure.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Emit arcs as polylines: the `A`-command test must go red.
  - Drop `fill-rule="evenodd"`: an annulus rendering test asserting the attribute must go red.
  - Remove the square assertion: the refusal test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): fill — shaded regions and their booleans in figures`.

### Task 3: Area measures

**Files:** the parser (the `area` label/given/find subject: a region name or an inline region expression), `figure/render.ts` (the value, the F6 anchor, and the asserting form), and tests.

- [ ] **Step 1: failing tests:**
  - `fill: square ABCD minus circle O name: R` then `label: area R` prints **3.434**.
    - `label: area R = 3.434` passes, and `= 4` fails, naming the true value.
    - Under `@scale: false`, `= 4` is accepted.
  - `given: area circle O and circle P` prints 1.228 in the table for the lens.
  - **F6 anchor**, both hand-derived:
    - **Annulus** R = 3, r = 2 at the origin: the lowest line, y = −2.25, misses the hole and gives the longest chord (length 2√(9 − 5.0625) ≈ 3.97), so the anchor is **(0, −2.25)**. That is strictly between r and R from the centre.
    - **Square minus circle** (side 4, r = 2): the height is 4, so the lowest line is y = −2 + 4/8 = **−1.5**. The circle is at x = ±√(4 − 2.25) = ±1.3229 there, giving the chords [−2, −1.3229] and [1.3229, 2] of equal length (0.677, longer than on any higher line). The leftmost wins, so the anchor is **(−1.661, −1.5)**, in a corner, inside the region.
  - **Unknown region name:** refused, with a hint to use `name:` on a `fill:`.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Anchor at the centroid of the outer loop instead of F6's chord midpoint: the annulus anchor test must go red, because the centroid is in the hole.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): area of a shaded region, measured and asserted`.

### Task 4: Examples, reference and handoff

**Examples** (shaded, lines drawn by the author's own statements, and the area labelled):
1. **"Square minus its circle".**
2. **"Lens of two circles".**
3. **"Annulus".**
4. **"Arbelos".**
5. **"Circular segment"**: a sector minus its triangle, which equals `segment P-Q on O`. Show both agree by labelling both areas.
6. **"Shaded union".** Two overlapping squares, or a polygon or circle union.

**Reference:** the grammar header documents F1–F7: the operators, precedence and parentheses, the shape assertions, the `name:` rule and why `NAME = region` is not used, fills drawing no outline, area measures, and the refusals.

**Handoff:**
- Add a phase 12 row.
- Add the region engine to "How the engine is put together".
- Record in the open items that exact symbolic areas wait on build step 3.

- [ ] **Step 1:** add the examples and run `examples.test.ts`. Render each to PNG and inspect it: holes must actually render as holes.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 12 shading and regions — examples, reference, handoff`.

## Verification

1. All three checks clean. Every pre-existing spec is byte-identical, and `fill` used as a name parses as before.
2. The hand-computed areas hold: 16 − 4π, 5π, the lens, the crescent, the arbelos (π), the segment (π − 2), and the shared-edge union (8, one loop).
3. Fills are one path with arcs as `A` commands, rendered with evenodd holes, behind every line, with no outline of their own.
4. Every new example is drawn and inspected in PNG.

## Out of scope

Everything in F7, competition constructions (next phase), the unit circle (gated on exact values), and the tutor reference.
