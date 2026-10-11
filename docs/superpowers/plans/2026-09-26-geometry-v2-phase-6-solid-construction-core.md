# Geometry v2, Phase 6 — Solid Figures: the Construction Core

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** give solid figures what phase 1 gave 2D: named points in space, objects derived from them, and measures read off them. After this phase `A = (0,0,0)`, `M = midpoint A-E`, `F = foot D to plane A-B-C`, `segment: A-G` and `label: AG` all work in a solid figure, and a solid's named vertices are real points.

**Architecture:** the solid-figure engine converts the author's z-up coordinates to its internal y-up frame in one module, at the grammar boundary. A pure, camera-free maths module does the 3D constructions. A source-order walk (the 3D analogue of `buildConstructions`) builds solids and 3D constructions together, because a construction may reference a solid's vertices. The figure renderer projects the results through the existing camera. Segments get a visibility rule against every solid in the figure.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`. Read the Track 2 "Solids" section in full, **especially "Revised 2026-09-25 — two 3D engines, and the road to AIME"**, which this plan implements as build step 6. Also read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` before Task 1. It explains the pipeline, the contracts and the traps.

**Prior work to consume, not rewrite:**
- `figure/project3d.ts`: `Vec3`, `Solid3D`, `Camera`, `cameraFor`, `projectSolid`, `ProjectedEdge`, `drawEdge`.
- `figure/solids.ts`: `SolidSpec`, `SolidBody` (with `labelOrder`), `buildSolid`, `solidOutline`, and the placement convention H1.
- `figure/crossSection.ts`: `SectionPlane` (internal axis + offset), `sectionOf`, `trueShape`.
- `figure/render.ts`: the figure pass. It currently builds solids inline in its main loop and registers **no** points for solid vertices (they are `solidVertex` label items only).
- `scene/geometry/`: the 2D construction layer. `centres.ts` is reused in Task 3 for triangle centres in space.
- `scene/mode.ts`: `resolveMode`. `isThreeD` currently sends any 3-coordinate point to the **space** renderer.

## Vocabulary: say which 3D engine

There are two 3D engines and they share no code (see the spec table). **space** is track 3: three.js, orbitable, calculus. **Solid figures** is this track: SVG with fixed views. In code comments, test names, commit messages and errors, write "solid figure" or "space", never "3D engine" alone. **Do not name any new module or identifier `space…`.** That word belongs to track 3.

## Global Constraints

- **No new runtime dependencies.**
- **All existing tests keep passing, none weakened or deleted.** The one sanctioned exception is in Task 1: DSL test inputs that name an axis-perpendicular plane are rewritten into the new author frame, and each rewritten test must produce **byte-identical** output to its pre-change form.
- **Determinism.** Byte-identical SVG for the same input at the same view state. Every number goes through the one formatter in `figure/svg.ts`.
- **Reuse `GEOM_EPS`** (`scene/geometry/types.ts`). No second tolerance.
- **No numeric solver, no sampling-as-answer.** Every construction and every visibility split point is closed-form. A sampled result may *classify* a span already bounded by exact endpoints, and never locate one.
- **Errors are returned, not thrown, past `renderFigure`.** One bad statement must not blank the figure. Each message names the problem in the author's terms (their names, their z-up coordinates).
- **Element identity.** Every emitted element carries `data-statement` / `data-object`.
- **One Vec3 toolkit.** Small 3D vector helpers (`dot3` and the like) already exist privately in `silhouette.ts` and `project3d.ts`. Task 2 creates the exported set. Existing modules may switch to it only if their output stays byte-identical. Do not create a third copy.
- **If you add engine capability, add an example** in `graph-engine/src/examples.ts`. `examples.test.ts` asserts every example parses and draws.
- Test command: `npm run test --workspace=graph-engine`, plus `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine`. **All three clean per task.**
- Commit per task, lowercase `type(scope): summary` (scope `graph-engine`), body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  This is a fixed repo convention, not a description of which model did the work. Do not change it, and do not accept a reviewer's objection to it.

## Proving a test can fail

This project has shipped **five tests that passed for the wrong reason** (see the handoff, lesson 1). For every behaviour test in this plan, **delete the behaviour it covers** and watch the test go red, then restore it. Do not settle for perturbing an input. Record in the commit body which behaviour was deleted to prove each load-bearing test. A test that stays green with its behaviour deleted is a bug in the test.

## Load-bearing decisions

**S1: one author frame, converted at one boundary.** Authors write z-up. Internally the solid-figure engine stays y-up. The map is the cyclic permutation

```
author (X, Y, Z)  ->  internal (x, y, z) = (Y, Z, X)
internal (x, y, z) -> author (X, Y, Z) = (z, x, y)
```

It is a proper rotation that fixes (1,1,1), so the isometric camera views from the author's (+,+,+) octant: X toward the viewer and left, Y right, Z up. Author axis-planes map `X = c -> z = c`, `Y = c -> x = c`, `Z = c -> y = c`. **All conversion lives in one module.** Nothing downstream of the grammar boundary knows the author frame exists: construction maths, sections and projection all run in the internal frame. An error message that prints a coordinate converts it back.

**S2: dimension is a property of a name.** One namespace serves the whole figure, because a figure can hold a solid *and* a lifted section's 2D points. Every bound name is either a **plane point** (2D) or a **space point** (solid figure). A name is a space point when it is bound by a 3-coordinate point, by a solid's `vertices`, or by a construction whose operands are space points. A construction whose operands mix the two fails: *"M = midpoint A-P mixes a point in space (A) with a point in the plane (P)"*. A 2D-only construction given space points (rotate, reflect over a line, tangent, circle constructions, and so on) fails naming the construction and saying it is planar. **Names stay unique across both kinds**, the same "a bound name is an error, not a rebinding" rule as today.

**S3: the solid-figure walk owns solids and space constructions.** Today `buildConstructions` (shared 2D maths, consumed by both renderers) runs first, and solids are built later inside `render.ts`'s main loop. A space construction can name a solid's vertex, so solids and space constructions must be resolved **in one source-order walk**, definition-before-use, like 2D constructions. That walk is new. It builds `SolidBody`s (camera-free, `buildSolid` is pure) and space points. `render.ts` consumes its result instead of building solids inline. `buildConstructions` must **not** see space constructions: route them away by S2's classification, so it never reports "Unknown point A" for a vertex it was never meant to resolve.

**S4: a solid's named vertices are space points.** `S = solid prism 8 by 5 by 6 vertices ABCDEFGH` binds A–H at the vertices `labelOrder` names. This closes the handoff's open item #8. `label: AB` then measures the **true 3D length**, never the projected one. That is the same commitment `solidDimensions` makes ("the geometry wins").

**S5: mode inference respects solids.** A spec containing a `solid` or `crossSection` statement infers `figure`. That check comes **before** `isThreeD`, so a 3-coordinate point added to a solid figure no longer silently sends the whole spec to the space renderer. A spec with 3-coordinate points and **no** solid still infers `graph` (space), which is unchanged. Under a declared `@mode: figure`, a 3-coordinate point is a space point in the figure.

**S6: segment visibility follows the glass rule.** Solids are transparent to each other. A **construction segment** is occluded by every solid in the figure. A point `p` of a segment is **hidden** when the open ray from `p` toward the viewer (`p + t·d`, `t > 0`, `d` = the camera's `direction`) meets the **interior** of any solid. For a convex solid that set is a single interval of the segment, and the union over solids may be several. The drawn result is the segment split at exact parameters into alternating visible and hidden spans, emitted in order from the first endpoint. An author override forces either style: `segment: A-G dashed` or `segment: A-G plain`.

**Recommended method (exact, and simple to get right).** Collect the *candidate* parameters where a span's status can change, sort them, and classify each open span by testing its midpoint. Candidates per solid:
- *Polyhedron:* where the segment crosses each face plane, and where it crosses the plane containing each **silhouette edge** and `d`.
- *Sphere:* where it crosses the sphere, and where it crosses the infinite cylinder of the same radius whose axis passes through the centre along `d`.
- *Cylinder and cone:* where it crosses the lateral surface and the cap planes, the planes containing each silhouette line and `d`, and the elliptic cylinders swept along `d` by each rim.

All of these are linear or quadratic in the segment parameter. The midpoint test (ray against a convex solid's interior) is a half-space clip for a polyhedron and a quadratic for the round solids. Candidates may be superfluous. They must never be missing, so each solid's candidate set gets a test that **deletes one candidate family** and shows a wrong split.

**S7: what this phase does not draw.** No planes as drawn objects (a plane appears only inside constructions: `foot … to plane A-B-C`, `intersect line A-B, plane C-D-E`), and no named planes. No polygons in space, no angle marks in space, no circles in space. Each refusal is a legible error, not a silent drop.

---

### Task 1: The z-up author frame

**Files:**
- Create: `graph-engine/src/figure/authorFrame.ts`, `graph-engine/src/figure/authorFrame.test.ts`
- Modify: `graph-engine/src/parser/parseStatement.ts` (the `cut:`/`section:` path and the grammar header comment), `graph-engine/src/figure/render.ts` (where a parsed plane becomes a `SectionPlane`), `graph-engine/src/examples.ts`, `graph-engine/src/figure/render.test.ts` (DSL inputs only)
- Fix in passing: `graph-engine/src/figure/crossSection.ts`. Its comment "the guard in solids.ts makes sure of it" is stale: the guard was deliberately not built, and `solids.test.ts` pins the convexity invariant instead. Say that.

**Interfaces (produces):**
```ts
// authorFrame.ts
export type AuthorAxis = 'x' | 'y' | 'z'          // as the author writes it, z up
export function authorToWorld(p: Vec3): Vec3        // (X,Y,Z) -> (Y,Z,X)
export function worldToAuthor(p: Vec3): Vec3        // (x,y,z) -> (z,x,y)
export function authorPlane(axis: AuthorAxis, at: number): SectionPlane
export function describeAuthorPlane(plane: SectionPlane): string   // "z = 1", for error messages
```

- [ ] **Step 1: capture the byte fixtures first.** Before changing anything, render every DSL input in `render.test.ts` and `examples.ts` that contains `by plane`, and save the SVGs. Mapped into the new frame, `y = c` becomes `z = c`, `x = c` becomes `y = c`, and `z = c` becomes `x = c`. These are what Step 4 compares against.
- [ ] **Step 2: failing tests** in `authorFrame.test.ts`:
  - The two maps are inverses on arbitrary points.
  - The map is a proper rotation: the determinant of its matrix is +1, and it preserves cross products.
  - The isometric camera's `direction` maps to the author's (1,1,1)/√3.
  - `authorPlane('z', 1)` is internal `{axis:'y', at:1}`. Test all three axes.
  - A prism's `width` dimension segment, converted to the author frame, runs along Y, `depth` along X and `height` along Z.
- [ ] **Step 3: implement**, and route the parser/renderer's plane through `authorPlane`. Error messages that print a plane use `describeAuthorPlane` (for example, "The plane z = 9 does not cut "S"").
- [ ] **Step 4: rewrite the DSL test inputs and examples** into the author frame. Assert each against its Step 1 fixture, **byte for byte**.
- [ ] **Step 5: prove it.** Delete the conversion (pass the author axis straight through). The fixture comparisons must go red.
- [ ] **Step 5b: repair two phase 5 tests that pass for the wrong reason.** The isometric camera draws every **axis-parallel** segment at its true length: `projectPoint` sends an 8-long x-edge to `(8·cos30, −4)`, whose length is exactly 8. "6.93" is that edge's horizontal *extent*, not its drawn length. Both of these tests therefore pin nothing:
  - `render.test.ts`, *"prints the dimension the author asked the solid for, not the projected edge"*. Its `not.toContain('>6.93</text>')` cannot fail. Replace it with a dimension whose projection differs, or drop that assertion and say why in a comment.
  - `render.test.ts`, *"asserts that measure against the TRUE shape, not the projection"*. A section handing back projected coordinates would still measure PQ = 8 and QR = 6. Assert what the projection *does* distort: the diagonal `label: PR = 10` passes, the right angle at P holds, and each fails on projected coordinates.

  **Prove the repaired test by deleting the behaviour:** make `trueShape` return the projected points (`camera.project`) instead of `inPlane`. The repaired test must go red and the old one must stay green. Record both outcomes in the commit body.
- [ ] **Step 6:** update the grammar header comment in `parseStatement.ts`. The solid statements are documented as z-up, with the width/depth/height axes stated. Run all three checks, then commit as `feat(graph-engine): solid figures take z-up author coordinates`.

---

### Task 2: Construction maths in space

**Files:**
- Create: `graph-engine/src/figure/construct3d.ts`, `graph-engine/src/figure/construct3d.test.ts`

Pure and camera-free, and frame-agnostic (every function here is rotation-invariant). It imports nothing but `Vec3` and `GEOM_EPS`, the way `scene/geometry/` imports nothing but `Vec2`.

**Interfaces (produces):**
```ts
// Vec3 toolkit — the one exported copy
export function add3(a: Vec3, b: Vec3): Vec3
export function sub3(a: Vec3, b: Vec3): Vec3
export function scale3(v: Vec3, k: number): Vec3
export function dot3(a: Vec3, b: Vec3): number
export function cross3(a: Vec3, b: Vec3): Vec3
export function length3(v: Vec3): number
export function distance3(a: Vec3, b: Vec3): number

export interface Plane3 { point: Vec3; normal: Vec3 }   // normal is unit length

export function midpoint3(a: Vec3, b: Vec3): Vec3
export function divide3(a: Vec3, b: Vec3, m: number, n: number): Vec3        // m:n from a, as 2D divide
export function centroid3(points: Vec3[]): Vec3                               // 3 or 4 points in this phase
export function planeThrough(a: Vec3, b: Vec3, c: Vec3): Plane3              // throws on collinear
export function footToLine3(p: Vec3, a: Vec3, b: Vec3): Vec3                // infinite line a-b
export function footToPlane(p: Vec3, plane: Plane3): Vec3
export function lineMeetsPlane(a: Vec3, b: Vec3, plane: Plane3): Vec3       // infinite line; throws when parallel
export function pointLineDistance(p: Vec3, a: Vec3, b: Vec3): number
export function pointPlaneDistance(p: Vec3, plane: Plane3): number          // unsigned
export function lineLineDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number // skew or parallel
export function angle3(vertex: Vec3, from: Vec3, to: Vec3): number          // radians, non-reflex, atan2 form
```

**Decision:** `angle3` uses `atan2(|u×v|, u·v)`, for the reason `figure/measure.ts`'s `angleMeasure` gives (acos loses precision near 0 and π). `lineLineDistance` handles the parallel case separately, falling back to a point–line distance, instead of dividing by a near-zero cross product.

- [ ] **Step 1: failing tests, each against hand-computed values:**
  - The unit cube `[0,1]³`: its space diagonal is √3.
  - Midpoint of (0,0,0)-(2,4,6) is (1,2,3). `divide3` at 1:3 lands a quarter of the way.
  - Centroid of a regular tetrahedron's four vertices is its centre.
  - `planeThrough` on three collinear points throws a message that says they are collinear.
  - The foot from (1,1,1) to the plane z=0 is (1,1,0). The foot to the plane x+y+z=3 from the origin is (1,1,1).
  - The line (0,0,-1)-(0,0,1) meets z = 0.5 at (0,0,0.5). A line parallel to the plane throws.
  - The skew lines x-axis and the line through (0,1,0) along z are at distance 1. Parallel lines 2 apart are at distance 2.
  - The angle at a cube's vertex between two face diagonals is 60°.
- [ ] **Step 2: implement.** Degenerate inputs (coincident points, zero-length line) throw a message naming the degeneracy.
- [ ] **Step 3: prove it.** Delete the parallel branch of `lineLineDistance` and watch the parallel test fail with a non-finite or wrong value, then restore it.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): construction maths for solid figures`.

---

### Task 3: Names in space: the solid-figure walk

**Files:**
- Create: `graph-engine/src/figure/solidScope.ts`, `graph-engine/src/figure/solidScope.test.ts`
- Modify: `graph-engine/src/parser/types.ts` (`GeometryRef` gains a plane form; `triangleCentre`'s vertices may be 3 or 4 for centroid), `graph-engine/src/parser/parseStatement.ts` (`plane A-B-C` as a ref; `centroid ABCD`), `graph-engine/src/scene/geometry/buildConstructions.ts` (skip space constructions, per S3), `graph-engine/src/scene/mode.ts` (S5), `graph-engine/src/figure/render.ts` (consume the walk; draw space points; measures), plus tests in `render.test.ts` and `scene/mode.test.ts` (or wherever `resolveMode` is tested today)

**Interfaces:**
- Consumes: Task 1 `authorToWorld` / `worldToAuthor`; Task 2 everything; `buildSolid`, `SolidBody`.
- Produces:
```ts
// solidScope.ts
export interface SolidFigureScope {
  solids: Map<string, SolidBody>
  // Space points in the INTERNAL frame, keyed by name.
  points: Map<string, Vec3>
  // Which statements this walk owns, so buildConstructions and render.ts skip them.
  ownedStatements: Set<number>
  // Per owned statement: the solid built, or the space point(s) bound.
  byStatement: Map<number, { solid?: SolidBody; points: { name: string; at: Vec3; drawn: boolean }[] }>
  errors: SceneError[]
}
export function buildSolidFigure(statements: Statement[], value: (e: Expr) => number): SolidFigureScope
export function isSpaceName(scope: SolidFigureScope, name: string): boolean
```
`drawn` is false for a solid's own vertices, which keep today's label-only look. It is true for a plain or constructed space point, which gets a dot and a label.

**Grammar added (all in a solid figure):**
```
A = (0, 0, 0)                     # a space point, author z-up
S = solid prism 8 by 5 by 6 vertices ABCDEFGH   # A–H are now space points
M = midpoint A-E
P = divide A-G at 1:2
G = centroid ABCD                 # 3 or 4 names; 4 only for space points
O = circumcenter ABC              # also incenter / orthocenter, of a triangle in space
F = foot D to plane A-B-C
F = foot D to line A-B
X = intersect line A-G, plane B-D-E
label: AG                         # true 3D length
given: AG = 10                    # the givens table, asserting, true 3D
given: angle ABC                  # true 3D angle, table only in this phase
```

**Decisions:**
- **Triangle centres in space reuse `scene/geometry/centres.ts`.** Lay the triangle into its own plane with an orthonormal frame, compute the 2D centre, and lift it back. Do not write the centre formulas a second time. The frame choice must be deterministic: first axis along A→B, second in the ABC plane toward C.
- **`label: angle ABC` on space points is refused inline** with a message that points at `given: angle ABC`. An angle label with no drawn arc floats. Angle marks in space are build step 10.
- A space point's label sits at its projected position and goes through the existing collision layout. A true-length label on a space segment reuses the **solid-dimension placement path** (leader-capable), fed the projected endpoints. Do not build a third label placement.

- [ ] **Step 1: failing tests:**
  - **Mode (S5):**
    - A spec with a solid and `A = (1,2,3)` infers `figure`.
    - A spec with only `A = (1,2,3)` still infers `graph`, which is today's behaviour.
    - `@mode: figure` with only `A = (1,2,3)` draws a space point.
  - **Vertices are points (S4):** use an 8×5×6 prism with `vertices ABCDEFGH`.
    - `label: AB = 8` passes. This only shows the name resolves: an axis-parallel edge projects at true length (see Task 1, Step 5b), so an edge **cannot** distinguish true from projected.
    - The measure test uses the space diagonal AG instead. Assert that `label: AG = <√125 formatted>` passes and that `label: AG = <projected length, computed in the test from camera.project>` fails.
    - Also assert the two values differ by far more than `GEOM_EPS`, so the test cannot pass vacuously.
    - This replaces the "Unknown point A" behaviour, so assert that string no longer appears.
  - **Constructions, against hand-computed author coordinates.** Use the unit cube with ABCD as the bottom face counter-clockwise from the origin and E–H above them: A=(0,0,0), B=(1,0,0), C=(1,1,0), D=(0,1,0), E=(0,0,1), G=(1,1,1).
    - `midpoint A-G` is (½,½,½).
    - `foot A to plane B-D-E` is the centroid of BDE.
    - `intersect line A-G, plane B-D-E` is (⅓,⅓,⅓).
    - The `circumcenter` of an equilateral triangle in space is its centroid.
  - **S2:**
    - Mixing a space point and a plane point fails with both names in the message.
    - `rotate` on a space point fails, saying the construction is planar.
    - Rebinding a vertex name fails.
  - **S3:** a spec whose constructions all name solid vertices produces **no** construction errors from `buildConstructions`.
  - **Determinism:** two renders are byte-identical.
- [ ] **Step 2: implement.** Parser first, then the walk, then `render.ts` consuming it. Move solid building out of `render.ts`'s loop into the walk without changing a byte of existing solid output: every existing solid test must pass untouched.
- [ ] **Step 3: prove it.**
  - Delete the S5 ordering (put the solid check back after `isThreeD`) and watch the mode test fail.
  - Delete vertex registration and watch `label: AB = 8` fail.
  - Delete the lift-back in the centre reuse and watch the circumcenter test fail.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): named points and constructions in solid figures`.

---

### Task 4: Segments in space, and visibility against polyhedra

**Files:**
- Create: `graph-engine/src/figure/occlusion.ts`, `graph-engine/src/figure/occlusion.test.ts`
- Modify: `graph-engine/src/parser/parseStatement.ts` (`segment: A-G [dashed | plain]`, plus the coordinate form `(x1,y1,z1) -- (x2,y2,z2)` in a solid figure), `graph-engine/src/parser/types.ts` (the `namedSegment` style becomes `'auto' | 'dashed' | 'plain'`, where `dashed: true` today maps to `'dashed'` and the default is `'auto'`), `graph-engine/src/figure/render.ts`, and tests

**Interfaces:**
- Consumes: Task 2 toolkit; `Camera.direction`; `SolidBody`; `solidOutline` (for silhouette edges).
- Produces:
```ts
// occlusion.ts: all in the internal frame
export interface Span { from: number; to: number; hidden: boolean }   // segment parameters in [0,1], ordered, contiguous
export function segmentSpans(a: Vec3, b: Vec3, solids: SolidBody[], camera: Camera): Span[]
export function hidesPoint(body: SolidBody, p: Vec3, camera: Camera): boolean          // S6's ray test
export function occlusionCandidates(body: SolidBody, a: Vec3, b: Vec3, camera: Camera): number[]
```
In this task `hidesPoint` and `occlusionCandidates` handle polyhedra. For a round solid they throw *"segments against a cylinder/cone/sphere arrive in the next task"*. `segmentSpans` turns that into a render error, so a figure never draws a round solid's occlusion wrong. Adjacent spans with equal `hidden` are merged. A plane-2D `namedSegment` (both ends plane points) is unaffected.

- [ ] **Step 1: failing tests** on an 8×5×6 prism under the isometric camera, with vertices named:
  - The space diagonal A–G is one hidden span.
  - A diagonal of a **front** face is one visible span.
  - A diagonal of a **back** face is one hidden span.
  - A segment from a point outside the prism, through it, to a point outside on the far side gives visible–hidden–visible. The two split parameters are hand-computed: the entry and exit where the camera ray grazes the silhouette, not where the segment enters the solid.
  - A segment wholly behind the prism, partly overlapped in projection, gives visible–hidden–visible with split points at the projected silhouette.
  - A segment clear of the prism is one visible span.
  - A segment lying along a visible edge is visible, and one along a hidden edge is hidden.
  - `dashed` and `plain` override the rule both ways.
  - **Glass:** in a figure with two overlapping solids, each solid's own edges are unchanged from drawing it alone. Assert this byte for byte against a single-solid render's edges.
  - Two renders are byte-identical.
- [ ] **Step 2: implement** per S6's method. The split pieces are drawn through the existing edge emission (`drawEdge` / the figure's line items) with hidden spans dashed exactly as hidden solid edges are.
- [ ] **Step 3: prove it.**
  - Delete the silhouette-plane candidates and watch the "behind the prism" test go wrong: split at face crossings only, or not split.
  - Delete the face-plane candidates and watch the "through it" test go wrong.
  - Delete the midpoint classification and watch everything go visible.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): segments in solid figures, occluded by polyhedra`.

---

### Task 5: Visibility against round solids

**Files:**
- Modify: `graph-engine/src/figure/occlusion.ts`, `graph-engine/src/figure/occlusion.test.ts`
- Read first: `graph-engine/src/figure/silhouette.ts`. Its silhouette lines and rim geometry are the same objects the candidate sets need, so reuse them instead of re-deriving.

Per S6, `hidesPoint` and `occlusionCandidates` gain sphere, cylinder and cone. These are closed-form roots of linear and quadratic equations. A quadratic with a double root (tangency) yields that root once. A negative discriminant yields no candidate. Use `GEOM_EPS` for both calls.

- [ ] **Step 1: failing tests:**
  - **Sphere of radius 5:**
    - A radius from the centre to the front pole is hidden up to the surface point and has nothing visible beyond. State and test which: the centre is inside, so the whole radius is hidden.
    - A diameter perpendicular to the view is hidden.
    - A segment passing in front of the sphere is visible.
    - A segment passing behind it is hidden exactly where its projection lies inside the outline circle. The split points are hand-computed as the segment's crossings of the view-direction cylinder.
  - **Cylinder:**
    - The axis is hidden.
    - A segment along the front generator (on the surface, facing the viewer) is visible.
    - A segment behind the cylinder is split at the silhouette lines.
    - A segment behind it at the height of the top rim is split where the rim's swept elliptic cylinder bounds the occluded region. **This is the case that needs the rim candidates.**
  - **Cone:**
    - The axis is hidden.
    - A segment behind the cone near the apex is split at the silhouette lines.
    - A segment behind the base is split at the swept base rim.
  - **Tangency:** a segment whose camera rays graze the sphere at one point is not split.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.** Delete the rim-sweep candidates and watch the rim-height cylinder test and the cone-base test go wrong. Delete the view-cylinder candidates and watch the behind-the-sphere test go wrong.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): segments occluded by cylinders, cones and spheres`.

---

### Task 6: Examples, references and the handoff

**Files:**
- Modify: `graph-engine/src/examples.ts`, the grammar header in `graph-engine/src/parser/parseStatement.ts`, `docs/HANDOFF-2026-09-23-graph-engine-v2.md`

**Examples** (each must parse and draw; `examples.test.ts` covers that automatically):
1. **Cube, placed by points, with midpoints.** A unit-free cube given by `A = (0,0,0)` through `H`. Midpoints of three edges joined by segments, and `label:` on one of the joining segments. This is the precursor to the plane through the midpoints (build step 8).
2. **Box and its space diagonal.** `S = solid prism 8 by 5 by 6 vertices ABCDEFGH`, `segment: A-G`, `label: AG`, and `given: AB = 8` in the table.
3. **Foot of a perpendicular.** A tetrahedron's apex dropped to its base plane, with `F = foot D to plane A-B-C`, the segment D–F drawn, and its true length labelled.
4. **Sphere with a chord through it.** A sphere and a segment passing behind it, showing the visible–hidden–visible split.

**Human reference:** the grammar header documents every new form, the z-up frame and its axis meanings, `dashed` / `plain`, and the S5 mode rule.

**Handoff:**
- Add a phase 6 row to the phase table.
- Close open item #8 (vertex names).
- Add the solid-figure / space vocabulary and the author frame to "How the engine is put together".
- Record in open item #1 that `bootstrap.ts` (the tutor reference) now lags by one more phase, and that the house rule "declare `@mode:`" matters doubly for solid figures, because of S5.

- [ ] **Step 1:** add the examples and run `examples.test.ts`.
- [ ] **Step 2: load it in a real browser.** Node-only tests cannot see DOM/CSS bugs (handoff lesson 2). From the worktree run `npm run review -- --port 5181 --host 100.90.203.2`, **restarting it if it was already running**, and open each new example. The Claude preview pane serves `main`, not this worktree, so do not use it for this (handoff lesson 3). Confirm dashed spans, labels and dots look right. Report what you saw, including anything wrong.
- [ ] **Step 3:** update the reference and the handoff.
- [ ] **Step 4:** run all three checks, then commit as `docs: phase 6 solid-figure construction core — examples, reference, handoff`.

---

## Verification

1. All three checks clean. Every pre-existing test passing, with only Task 1's frame rewrites (each byte-identical to its fixture) and Step 5b's two repaired tests.
2. `cut: S by plane z = 1` is a horizontal cut. `plane y = 1` is vertical.
3. On a named prism, `label: AB = 8` passes, the projected length fails, and "Unknown point A" is gone.
4. `midpoint`, `divide`, `centroid`, the triangle centres, `foot … to line / plane` and `intersect line …, plane …` work on space points against hand-computed author coordinates.
5. A spec with a solid and a 3-coordinate point stays a figure.
6. Segments split exactly against all six primitives. Solids stay glass to each other.
7. Byte-identical output at a fixed view state.
8. Every new example drawn and looked at in a real browser.

## Out of scope

Solids placed by points (tetrahedron on ABCD or by six edges, general polyhedra, round solids on an axis) — build step 7. Oblique sections and drawn or named planes — step 8. Inscribed and circumscribed solids — step 9. Angle marks, dihedral angles, right-angle marks and inline angle labels in space — step 10. Nets — step 11. Exact values. Opaque coaxial stacking. The tutor reference `server/src/domain/bootstrap.ts`. The space renderer (track 3), including renaming its `solid:` keyword, which exists only in the spec so far. Build none of them.
