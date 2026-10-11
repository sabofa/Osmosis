# Geometry v2, Phase 8 — Solid Figures: Planes and Oblique Sections

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** cut any solid with any plane: the plane through three named points, through a point perpendicular to a line, through a point parallel to another plane, or given by an equation. The cut draws both in place and lifted at true shape. Examples:
- the regular hexagon a plane perpendicular to a cube's space diagonal cuts through its centre;
- the square a plane through four edge midpoints cuts from a regular tetrahedron;
- the half-ellipse a 45° cut takes from a cylindrical log;
- the circle a plane through three points cuts from a sphere.

**Architecture:**
- **Canonicalisation.** Every plane an author writes becomes one internal plane value. A plane perpendicular to an axis turns into the existing axis form, so every existing section keeps its exact code path and bytes.
- **Polyhedra** use the existing edge walk, generalised from "coordinate − at" to a signed distance.
- **Round solids** are cut in their own local frame (phase 7's placement) by a closed-form conic, trimmed to the solid's caps.
- **New section shape.** A section can now be a region bounded by line segments and elliptical arcs. It lifts into the ordinary 2D figure path like any other section.
- **In-place outlines** are dashed where the solid hides them.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 2 "Solids". Read "Cross-sections and nets produce 2D geometry" and "Revised 2026-09-25", build step 8: "planes through three points; polygon sections of any polyhedron; circles of a sphere; ellipses of a cylinder or cone (parabolic and hyperbolic cone sections still refuse)". Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, especially lesson 1 and the phase 5–7 sections.

**Prior work to consume:**
- `figure/crossSection.ts`: `SectionPlane` (axis + offset), `Section`, `TrueShape`, `sectionOf`, `placedSection` with its P7 tilted-solid refusal (which this phase removes), `trueShape`, `liftOffset`, and `inPlane`, whose frame convention must be preserved for axis planes.
- `figure/construct3d.ts`: `Plane3`, `planeThrough`, `footToPlane`, `lineMeetsPlane`, and the one Vec3 toolkit.
- `figure/solidScope.ts`: how `plane A-B-C` operands resolve for `foot` / `intersect` today.
- `figure/silhouette.ts`: `projectCircle(camera, centre, u, v)`, which already turns **any two conjugate semi-diameters** into an SVG ellipse; the local camera; `toWorld` / `toLocal` for placements.
- `figure/occlusion.ts` (the glass rule), `figure/authorFrame.ts`, and `render.ts`'s `crossSection` and `sectionFace` branches.

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical,** with one sanctioned exception. **Q6** changes the outline of in-place `cut:` sections: parts hidden by the solid become dashed. Every spec without a `cut:` statement renders byte-for-byte as before under every view. Every lifted `section:` is unchanged. Each changed test asserts the new dashing explicitly.
- **No numeric solver, no sampling-as-answer.** Every section vertex, conic, trim point and visibility split is closed-form.
- **Reuse `GEOM_EPS`** and the one Vec3 toolkit.
- **Author frame is z-up.** Plane equations and messages are author-frame, and conversion stays in `authorFrame.ts`.
- **Placement never depends on the active view.**
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and quote the plane as the author wrote it.
- **Every emitted element carries `data-statement` / `data-object`.** Every new capability has an example.
- **Proving a test can fail means deleting the behaviour it covers,** not perturbing inputs. Record which deletion proved which test in each commit body. Never use an axis-parallel segment as the sole proof of true-versus-projected.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, lowercase `type(scope): summary`, body ending EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. That line is a fixed repo convention.
- **Vocabulary:** say "solid figure" or "space", never "3D engine" alone.

## Load-bearing decisions

**Q1: one internal plane, canonicalised.**
- **The type.** `SectionPlane` becomes `{ kind: 'axis'; axis; at } | { kind: 'general'; point: Vec3; normal: Vec3; u: Vec3; v: Vec3; source: string }`, internal frame. `normal` is unit length; `u`, `v` is an orthonormal in-plane frame with `u × v = normal`; `source` is the plane as the author wrote it, for messages.
- **Canonicalisation.** Every author form builds a `Plane3` and then goes through `canonicalPlane`. A plane whose normal is parallel to an internal axis (within `GEOM_EPS`) becomes the axis form, with the sign normalised so `at` is the coordinate. Otherwise it is general.
- **Consequence:** `plane A-B-C` through three points that all have z = 1 behaves **exactly** like `plane z = 1`, bytes included.
- **Frame and orientation of a general plane.** These decide the lifted true shape.
  - Orient `normal` toward the default camera (`DEFAULT_CAMERA.direction · normal ≥ 0`, with ties broken toward author +Z, then +X).
  - `v` is the unit projection of **author Z** onto the plane when that is longer than `GEOM_EPS`; otherwise it is the unit projection of author Y.
  - `u = v × normal`.
  - So a lifted section reads upright: "up" in the plane is as close to vertical as the plane allows, seen from the viewer's side.
  - Fixed against the default camera, never the active view.
- **Vertex order** of a lifted polygon uses the rule axis sections already use: sorted by angle about the centroid in the plane's frame. Document it in the grammar header, since `vertices` naming depends on it.

**Q2: plane grammar.** Planes are author-frame, and each form is usable wherever a plane operand is accepted (`cut:`, `section:`, `foot … to plane`, `intersect line …, plane …`).
```
plane A-B-C                          # through three space points (existing operand form)
plane through P perpendicular to A-B # normal along line A-B
plane through P parallel to A-B-C    # parallel to plane A-B-C, through P
plane through P parallel to p        # ...or to a named plane
plane 2x + y - z = 3                 # an equation in author x, y, z
plane z = 1                          # the existing axis form — unchanged path
p = plane A-B-C                      # NAMED plane (binds p; any plane form on the right)
cut: S by plane p                    # a named plane used as an operand ("plane p")
section: S by plane M-N-P vertices QRSTUV
```
- **The equation form** parses both sides as expressions and checks the difference is **affine** in x, y, z. Evaluate at (0,0,0) and the three unit points, then check at (1,1,1) and (2,−1,3) that the affine fit reproduces the value within `GEOM_EPS` × scale. A non-linear equation is refused ("plane x^2 + y = 1 is not a plane — it must be linear in x, y, z"), as is an all-zero normal. The reading is exact for any genuinely linear input, so this is not a solver.
- **Named planes** follow S2's name rules: a name is unique across points, lines, circles and planes. A named plane **binds and does not draw**. Say this in the grammar header: a plane is drawn through the section it cuts (`cut:`), and drawn patches are out of scope.
- **Refusals:** collinear points for `plane A-B-C` ("A, B, C are collinear — they do not fix a plane"); a zero-length line A-B; a plane operand naming something that is not a plane; a plane used in a 2D-only construction.

**Q3: oblique sections of polyhedra.** The edge walk uses signed distance `normal · p − normal · point`, with the axis form as its special case.
- **Coincident face:** a plane containing a whole face returns that face.
- **Touching without cutting:** a plane touching only a vertex or an edge is refused as "the plane meets S only at vertex/along edge … — it does not cut through it".
- **Missing entirely:** as today.

**Q4: sections of round solids, in the solid's local frame.** Transform the plane into the local frame (P1 placement; axis = local y), solve, and transform back. This removes P7's tilted-solid refusal. The results are closed-form:

| Solid | Plane | Section |
|---|---|---|
| Sphere | any plane that cuts it | a circle: centre = foot of the centre, radius = √(r² − d²) |
| Sphere | tangent (d = r) | refused: "touches S at one point" |
| Cylinder | perpendicular to the axis | circle (the existing axis case) |
| Cylinder | parallel to the axis, 0 ≤ d < r | a rectangle bounded by two generators and two cap chords |
| Cylinder | oblique | an ellipse on the lateral surface, trimmed by the two caps |
| Cone, frustum | cuts every generator (ellipse case) | an ellipse, trimmed by the base (and a frustum's top) |
| Cone, frustum | parallel to a generator (parabola) or steeper (hyperbola) | refused: "the plane cuts K in a parabola/hyperbola, which is not drawn — only circles and ellipses are". This extends today's refusal. |
| Cone | through the apex, cutting the base disk | the triangle apex–chord endpoints |
| Cone | through the apex only, or along one generator | refused with a specific message |

- **The cylinder's oblique ellipse** is parametrised by the **cylinder angle θ**: the point is `(r cos θ, y(θ), r sin θ)` with `y(θ)` linear in cos θ and sin θ. That makes it `c + a cos θ + b sin θ`, with conjugate semi-diameters `a`, `b` that `projectCircle` already draws. Trimming by the caps y = ±h/2 is `y(θ) = ±h/2`, a closed-form pair of angles per cap.
- **The cone and frustum ellipse** is found analytically in the plane's frame: centre and conjugate semi-diameters from the quadratic form of the cone restricted to the plane. The base (and top) cap trims it by line–ellipse intersection, which is a quadratic.
- **The section region is convex.** Its boundary alternates elliptical arc and cap chord, with at most two of each. With no trimming it is a full ellipse.

**Q5: the new section shape, and its true shape.**
- `Section` gains `{ kind: 'region'; boundary: Piece[] }`, where `Piece = { kind: 'segment'; a: Vec3; b: Vec3 } | { kind: 'arc'; center: Vec3; u: Vec3; v: Vec3; from: number; to: number }`. Each arc is the ellipse `center + u cos t + v sin t` for t from `from` to `to`, and the pieces chain end to end, closed.
- A full ellipse is one arc spanning a whole turn. A circle stays `kind: 'circle'`, so axis cuts are unchanged.
- **`TrueShape`** gains the same region in 2D, each vector expressed in the plane's (u, v) frame.
- **In the 2D figure path**, a new figure item kind `region` draws the boundary: straight pieces as lines, arcs as SVG elliptical arcs, with the ellipse axes computed from conjugate semi-diameters by the same closed form `projectCircle` uses (share it; do not copy it). It is filled like a polygon and takes part in bounds and label avoidance.
- **Naming.** A region's **corners** (where arcs meet chords) can be named with `vertices`, in boundary order starting from the first chord's start. A full ellipse has no corners and refuses `vertices`, as a circle does.
- **Measuring.** `label: PQ` on named corners measures through the ordinary 2D path, at true size (H5).

**Q6: in-place outlines show what the solid hides.**
- `cut:` keeps its shaded fill in the regions layer, behind the solid's edges. The outline is now drawn **visible or hidden** by closed-form rules, because each boundary piece lies on the solid's surface:
  - **Polyhedron edge:** visible iff the face it lies on faces the viewer. On an edge shared by two faces, it is visible iff either one faces the viewer.
  - **Cap chord:** visible iff that cap faces the viewer.
  - **Arc on a lateral surface or sphere:** visible where the surface normal at the point faces the viewer. For a cylinder the normal is radial, so the test is `radial(θ) · d_local > 0`. For a sphere it is `(p − c) · d > 0`. For a cone or frustum it is the lateral normal at `p`. Each is `A cos t + B sin t + C > 0` in the arc's parameter, which gives exact split angles.
- **Scope:** this applies to **every** `cut:`, including the axis cuts phases 5 and 7 drew with a solid outline. That is the sanctioned byte change: a horizontal cut through a box drew its back two edges solid, which a textbook never does.
- **Other solids:** the outline is not occluded by other solids; the glass rule stands.

**Q7: what this phase does not draw.** Plane patches (a drawn quadrilateral for a plane), the intersection line of two planes, parabolic and hyperbolic sections, and nets. Refuse each legibly where an author could ask for it.

---

### Task 1: Planes as objects

**Files:**
- **Modify:** the parser (Q2 forms, named planes, the plane operand), `parser/types.ts` (plane forms and a `planeDef` statement or construction kind), `figure/solidScope.ts` (resolve every form to a `Plane3`; named planes in scope), `figure/crossSection.ts` (Q1's `SectionPlane` union, `canonicalPlane`, the general frame).
- **Create:** `figure/plane.ts`, if that keeps `crossSection.ts` focused: canonicalisation, frame and equation reading.
- **Tests:** `plane.test.ts`, `solidScope.test.ts`, `render.test.ts`.

- [ ] **Step 1: failing tests:**
  - **Canonicalisation:**
    - `plane A-B-C` through (0,0,1), (1,0,1), (0,1,1) canonicalises to the axis form for author z = 1.
    - `cut:` and `section:` with it are **byte-identical** to `plane z = 1` on the 8×5×6 prism.
    - A tilted plane stays general.
    - `plane 0x + 0y + 2z = 2` is also z = 1.
  - **General frame:**
    - For the plane x + y + z = 1 (author), `normal · DEFAULT_CAMERA.direction > 0` and `u × v = normal`.
    - `v` is the normalised projection of author Z.
    - For a vertical plane, `v` is exactly author Z.
  - **Equation form:**
    - `plane 2x + y - z = 3` gives normal ∝ (2, 1, −1) (author) through a point satisfying the equation.
    - `plane x^2 + y = 1` is refused as non-linear.
    - `plane 0x + 0y + 0z = 1` is refused.
  - **Perpendicular and parallel forms:**
    - `plane through O perpendicular to A-G` on the unit cube contains O and has normal ∝ (1, 1, 1).
    - `plane through P parallel to A-B-C` is parallel and passes through P.
  - **Named planes:**
    - `p = plane M-N-P` then `F = foot A to plane p` equals the foot to `plane M-N-P`.
    - Rebinding `p` fails.
    - `p` used as a point fails, and names that it is a plane.
  - **Refusals:** collinear A, B, C; a zero-length line A-B. Each message quotes the author's text.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Delete canonicalisation: the byte-identity test must go red.
  - Delete the normal orientation toward the camera: the frame test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): planes as objects — every author form, named planes, one canonical plane`.

### Task 2: Oblique sections of polyhedra

**Files:** `figure/crossSection.ts` (the generalised edge walk; the touch refusals; the lifted frame for general planes), `render.ts` (the `crossSection` branch takes any plane), and tests.

- [ ] **Step 1: failing tests:**
  - **Cube hexagon:** on a unit cube given by points, `section: C by plane through O perpendicular to A-G` (O the centre) lifts a **regular hexagon** of side √2/2. Assert all six sides √2/2 and all six angles 120° through `label:` measures on named vertices.
  - **Tetrahedron square:** the regular tetrahedron `edge 6` cut by the plane through the midpoints of AB, AC, BD (a plane parallel to edges BC and AD) lifts a **square** of side 3, with its diagonals 3√2.
  - **Oblique triangle:** the cube cut by `plane B-D-E` lifts an equilateral triangle of side √2.
  - **Square pyramid (AIME-style):** the pyramid cut by the plane through the midpoints of AE, BC and CD lifts a pentagon. Assert its vertex count is 5 and that each vertex lies on an edge of the pyramid (distance to the edge line < `GEOM_EPS`).
  - **Coincident face:** a plane containing a face returns that face.
  - **Touch refusals:** a plane touching only at a vertex; a plane touching only along an edge.
  - **Vertex order:** the lifted hexagon's `vertices PQRSTU` follow Q1's documented order. Assert where P sits.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Replace the signed distance with the axis coordinate: the hexagon test must go red.
  - Delete the touch refusals: those tests must go red (no silent degenerate polygon).
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): oblique sections of any polyhedron`.

### Task 3: Sections of round solids by any plane

**Files:** `figure/crossSection.ts` (Q4 and Q5's region section; removing P7's tilted refusal), the 2D figure path (the `region` item in `render.ts`, bounds, label avoidance, `svg.ts` emission through a shared conjugate-diameter helper), and tests.

- [ ] **Step 1: failing tests.** Hand-compute every expected value.
  - **Sphere:**
    - A plane at distance 3 from the centre of a sphere of radius 5 gives a circle of radius 4, centred at the foot.
    - **AIME check:** use `tetrahedron ABCO with AB = 13, BC = 14, CA = 15, AO = 20, BO = 20, CO = 20`, then `S = solid sphere center O radius 20`.
      - `section: S by plane A-B-C` is a circle of radius **65/8** (the circumradius of 13-14-15).
      - `label: OF` for `F = foot O to plane A-B-C` prints the formatted **15√95/8**.
    - A tangent plane is refused.
  - **Cylinder:**
    - For a cylinder of radius 3 and height 10 cut at 45° through its centre (normal ∝ (1, 0, 1) author, axis vertical), the lifted section is an ellipse with semi-axes **3 and 3√2**, untrimmed.
    - Cut through its centre by a plane whose normal is 60° from the axis, it reaches both caps: its reach along the axis is ±3·tan 60° ≈ ±5.2 against a half-height of 5. The section is a region of two elliptical arcs and two chords, with the chord lengths hand-computed.
    - **Log wedge:** a plane at 45° through a diameter of the base cap gives **half an ellipse**: one arc of half a turn and one chord of length 6 (the diameter).
    - Parallel to the axis at distance 2 gives a rectangle 2√5 by 10.
  - **Cone:**
    - For a cone of radius 3 and height 4, a plane tilted less steeply than the generators gives an ellipse. Check its semi-axes against the standard focal construction, or an independent parametric solve in the test.
    - The same cone cut by a plane parallel to a generator is refused as a parabola, and one parallel to the axis off-centre as a hyperbola.
    - A plane through the apex cutting the base is a triangle.
  - **Frustum:** a plane that meets both caps gives two arcs and two chords.
  - **Tilted solid:** a cylinder along author X cut by `plane x = 0` gives a circle of radius r. This used to be the P7 refusal.
  - **2D path:**
    - The region item emits SVG elliptical arcs (`A` commands), never polylines.
    - It takes part in bounds.
    - `vertices` names the corners of a trimmed region and is refused on a full ellipse.
    - `label: PQ` on two named corners of the log wedge measures 6.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Delete the cap trim: the 60° cylinder test must go red.
  - Swap the conic-type test so parabolas are drawn: the refusal test must go red.
  - Delete the local-frame transform: the tilted-cylinder test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): sections of spheres, cylinders, cones and frusta by any plane`.

### Task 4: In-place outlines with visibility

**Files:** `render.ts` (the `sectionFace` item carries boundary pieces with visibility; emission), `figure/crossSection.ts` or a small `figure/sectionVisibility.ts` (Q6's closed-form classification), and tests.

- [ ] **Step 1: failing tests:**
  - **Box:** for `cut: S by plane z = 1` on the 8×5×6 prism, exactly two outline edges are dashed. They are the edges on the two back faces, identified by their author coordinates. This test changes an existing expectation; it is the sanctioned change.
  - **Cube hexagon in place:**
    - Each hexagon edge's visibility matches its face.
    - Hand-derive which of the six faces face the `standard` camera; the camera looks from azimuth 30°, elevation 25°, so the +X, +Y and +Z faces face it.
  - **Cylinder, horizontal cut:** the ring is split into a visible front arc and a dashed back arc. The split angles are where the radial direction is perpendicular to the view, and they match `cylinderSilhouetteAngles`.
  - **Sphere, oblique cut:** the circle is split at the closed-form angles where `(p − c) · d = 0`.
  - **Log wedge in place:** the chord on the base cap is dashed, because the base faces away under `standard`, and the arc is split at the silhouette.
  - **Nothing else changes:** every spec without `cut:` is byte-identical, and every `section:` (lifted) is byte-identical.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Treat every piece as visible: the box test must go red.
  - Remove the arc split: the cylinder ring test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): in-place sections dash what the solid hides`.

### Task 5: Examples, reference and handoff

**Examples:**
1. **"Cube: the hexagonal section"**: a cube by points, O its centre, `cut:` and `section:` by the plane through O perpendicular to A-G, with lifted vertices named and one side labelled.
2. **"Tetrahedron: the square section"**: edge 6, the plane through three edge midpoints, lifted, with a side and a diagonal labelled.
3. **"Pyramid through midpoints"**: the pentagonal section of a square pyramid.
4. **"Log wedge"**: a cylinder cut at 45° through a base diameter, in place and lifted, with the chord labelled.
5. **"Sphere through three points"**: the AIME tetrahedron-on-a-sphere check, with the section circle lifted, F the foot, and `label: OF`.
6. **"Plane by equation"**: a box cut by `plane x + y + z = 4`, or similar, with a named plane reused by `foot`.

**Reference:** the grammar header documents every Q2 form, named planes (which bind and do not draw), the Q1 frame and vertex order, the Q4 table including the refusals, and Q6.

**Handoff:**
- Add a phase 8 row.
- Add canonicalisation and the region section shape to the architecture notes.
- Record Q7's out-of-scope items as open work.

- [ ] **Step 1:** add the examples and run `examples.test.ts`. Render each to a scratch SVG with `vite-node` and inspect it.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 8 planes and oblique sections — examples, reference, handoff`.

## Verification

1. All three checks clean. Every spec without `cut:` is byte-identical under every view.
2. The cube's hexagon, the tetrahedron's square and the log wedge's half-ellipse lift at true shape with correct measures.
3. `plane A-B-C` in the horizontal plane is byte-identical to `plane z = 1`.
4. Tilted round solids cut correctly, and parabolic and hyperbolic sections refuse legibly.
5. In-place outlines dash exactly what the solid hides.
6. Every new example is drawn and inspected.

## Out of scope

Plane patches and drawn planes, plane ∩ plane lines, parabolic and hyperbolic sections, inscribed and circumscribed solids (build step 9), angle and dihedral marks (step 10), nets (step 11), exact values, and the tutor reference.
