# Geometry v2, Phase 7 — Solid Figures: Solids by Points, and General Polyhedra

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** draw the solids competition problems actually state. Examples:
- a tetrahedron on four named points, or from its six edge lengths (AIME 2024 I: AB = CD = √41, AC = BD = √80, AD = BC = √89);
- a prism or pyramid over any polygon, including the regular hexagonal prism;
- an octahedron, and a frustum;
- the convex hull of named points;
- round solids placed and oriented by points, such as two cones whose axes cross at right angles.

**Architecture:**
- **Polyhedra** built from points go through one exact convex-hull builder. Its output is the `{vertices, faces}` polyhedron the convex hidden-edge rule already draws.
- **Round solids** gain a **placement**: an origin plus an orthonormal frame whose local y is the solid's axis. The existing y-axis silhouette and occlusion maths run unchanged in local coordinates, through a camera re-expressed in that frame.
- Everything already drawable keeps its exact bytes.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`. Read the Track 2 "Solids" section, in particular "Revised 2026-09-25" (build step 7, "Placement by points", and "The default view is not isometric"). Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, **especially lesson 1** and the phase 5/6/6b sections.

**Prior work to consume:**
- `figure/solids.ts`: `SolidSpec`, `SolidBody`, `buildSolid`, `solidOutline`, the H1 placement rules, `BASE_TURN`, `baseStartAngle`, `labelOrder`, `solidDimensions`, `solidDimensionSegment`.
- `figure/silhouette.ts`: y-axis cylinder, cone and sphere outlines, plus `coneSilhouetteAngles` and `projectCircle`.
- `figure/occlusion.ts`: segment visibility under the glass rule, whose round-solid code assumes the y axis.
- `figure/crossSection.ts`, `figure/project3d.ts` (`Camera`, `DEFAULT_CAMERA`, `projectSolid`), `figure/construct3d.ts` (the one Vec3 toolkit, `Plane3`, `planeThrough`), `figure/authorFrame.ts`.
- `figure/solidScope.ts` (`buildSolidFigure`: the source-order walk that builds solids and space points), and `parser/parseStatement.ts` (`parseSolidPrimitive`).

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical.** Every pre-existing spec renders byte-for-byte as before, under every view. No existing test is weakened or deleted.
- **No numeric solver, no sampling-as-answer.** Hull, placement, the six-edge tetrahedron, silhouettes and visibility splits are all closed-form or exact enumeration. The one finite search allowed is P5's placement rule. It fixes a *convention*, not a geometric answer, and it is over integer degrees.
- **Reuse `GEOM_EPS`,** and the one Vec3 toolkit in `construct3d.ts`. Do not create a second copy of either.
- **Author frame is z-up.** Every coordinate, axis and error message in the grammar is in the author frame, and conversion stays in `authorFrame.ts`.
- **Placement never depends on the active view.** Every convention is fixed against `DEFAULT_CAMERA`.
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and name the author's names.
- **Every emitted element carries `data-statement` / `data-object`.**
- **Every new capability has an example** in `graph-engine/src/examples.ts`.
- **Hidden-line removal stays convex-only,** and every solid reachable from the DSL stays convex by construction. The convexity invariant in `solids.test.ts` must cover every new primitive and the hull builder.
- **Proving a test can fail means deleting the behaviour it covers,** not perturbing its inputs. Record which deletion proved which test in each commit body. Never use an axis-parallel segment as the sole proof of true-versus-projected.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, lowercase `type(scope): summary`, body ending EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. That line is a fixed repo convention.
- **Vocabulary:** say "solid figure" or "space", never "3D engine" alone. No identifier named `space…`.

## Load-bearing decisions

**P1: a round solid has a placement, and the existing maths runs in its local frame.**
- **The placement.** A round solid carries `placement: { origin: Vec3; frame: { u: Vec3; axis: Vec3; w: Vec3 } }`, internal, orthonormal and right-handed, with local y = `axis`. Local coordinates map to world as `origin + x·u + y·axis + z·w`.
- **The local camera.** To draw or occlude, build a *local camera* whose `direction`, `right` and `up` are the world camera's vectors expressed in the local frame. Its `project(p)` is `camera.project(toWorld(p))`, and its `scale` and `name` are unchanged. The existing `cylinderOutline`, `coneOutline`, `sphereOutline`, occlusion candidates and `hidesPoint` then run unchanged against it.
- **Occlusion.** Transform a segment's endpoints into local coordinates. Span parameters are invariant under a rigid motion.
- **Byte identity.** When the placement is the identity (every existing round primitive), use the world camera itself, not a wrapped one, so existing bytes cannot move.
- **Deterministic frame for a given axis.** `u = normalize(axis × ref)`, where `ref` is internal author-X (internal `(0,0,1)`) unless `|axis · ref| > 1 − GEOM_EPS`, in which case `ref` is internal author-Y (internal `(1,0,0)`). Then `w = u × axis`. The silhouette of a round solid does not depend on rotation about its axis, but arc start angles do. That is why this is fixed.

**P2: frustum.**
- **The primitive.** A conical frustum is a round primitive: `{ kind: 'frustum'; radius; top; height }`, with base rim at y = −h/2 and top rim at y = +h/2 in local coordinates. `top < radius` is the normal case.
- **`top > radius`** is built as the same solid with its placement's axis reversed and the two radii swapped. It is one code path, not two.
- **`top == radius`** is refused with a pointer to `cylinder`. **`top == 0`** is refused with a pointer to `cone`.
- **Silhouette.** It is the generators of the frustum's extended cone, which reuses `coneSilhouetteAngles` for the virtual apex at height `h·radius/(radius − top)` above the base, clipped to the frustum's height, plus the two rims split at the silhouette angles.
- **Occlusion candidates** are the extended cone's, plus the top cap plane and the top rim's sweep.
- **Sections:** a plane perpendicular to the axis gives a circle, and one through the axis gives an isosceles trapezoid. A plane parallel to the axis but off it gives a hyperbola arc, refused like the cone's.

**P3: one exact convex-hull builder, `hullOf(points: Vec3[], names: string[]): Solid3D`.**
- **Brute-force supporting planes.** For every triple of points, the plane through them is a face plane when every point is on one side, within `GEOM_EPS` scaled to the points' extent. This is O(n⁴) and exact, and n is small.
- **Merging.** Coplanar supporting triples merge into **one polygonal face**: a cube's face is one quad, never two triangles. A split face would draw a spurious diagonal.
- **Face winding** is counter-clockwise seen from outside: sort by angle about the face centroid, using the outward normal.
- **Face order** is deterministic: faces sorted by their lowest vertex index, then by the rotated vertex sequence. **Vertex order is the input order**, so `labelOrder` is the identity.
- **Refusals, each naming the point(s):**
  - fewer than 4 points;
  - all coplanar ("a solid needs volume");
  - any named point **not a corner**, meaning inside the hull or on an edge or face ("E lies inside the solid on A…; every named vertex must be a corner").
- The convexity invariant applies to every hull by construction. Test it on random convex inputs with a fixed seed. The seed is a test input, not an answer.

**P4: the six-edge tetrahedron, placed like the regular one.**
`T = solid tetrahedron ABCD with AB = …, AC = …, AD = …, BC = …, BD = …, CD = …`
- **Edges.** The six pairs may come in any order and either letter order. Each unordered pair must appear exactly once, and the letters must be exactly the four named.
- **Feasibility is closed-form.** Each face must satisfy the strict triangle inequality, and the Cayley–Menger determinant must be positive. A failure is refused and names the face, or says "these six edges close only into a flat figure" / "cannot close".
- **Placement matches `tetrahedron edge e`.**
  - The base ABC lies in a horizontal plane.
  - The base centroid is on the vertical axis through the origin.
  - The base sits at author z = −h/2 and D at z = +h/2, where h is D's height above the base plane.
  - A sits at the default camera's azimuth + `BASE_TURN`, seen from the base centroid.
  - B and C run **counter-clockwise from above**, and D is above the base.
- **The identity test:** six equal edges e must give **the same position for every lettered vertex** as `tetrahedron edge e vertices ABCD`, within `GEOM_EPS`. The placement is not merely similar; it is the same.
- **Binding.** A, B, C, D bind as new space points; rebinding an existing name fails as it does elsewhere. Named dimensions: none. `label: AB` measures the real edge.

**P5: regular n-gon bases. One placement rule, one lettering rule.**
These apply to `prism regular`, `pyramid regular`, `frustum regular` and `octahedron`. The existing box, square pyramid and regular tetrahedron keep their pinned placements.
- **Rotation about the vertical axis.** Choose it among integer degrees in one symmetry period `[0, 360/n)`. The rotation must **maximise the minimum** of:
  - every face's angular margin from edge-on under `DEFAULT_CAMERA`;
  - every base vertex's angular distance from the camera's vertical plane through the axis, which is what keeps an apex-to-centre segment off a lateral edge.

  Ties go to the smallest rotation. Record the chosen rotation per n in a comment.
  - **Informational test:** report what the rule would pick for n = 3 and n = 4 pyramids, against the pinned 45° absolute (camera azimuth + 15°). Do not change those.
- **Lettering.** A is the **left end, from the viewer, of the front-most base edge**: the edge whose outward normal's azimuth is closest to the default camera's. The base runs counter-clockwise from above. A prism's or frustum's top follows in the same order, so the first top letter is over A. A pyramid's apex comes last.
  - The octahedron letters its equator by this rule, then the top apex, then the bottom apex.

**P6: grammar.** All coordinates are author, and point lists are hyphenated, like `plane A-B-C`.
```
# by points (space points must exist, definition-before-use)
S = solid hull A-B-C-D-E-F
T = solid tetrahedron A-B-C-D
P = solid pyramid A-B-C-D apex E                 # base polygon, then apex
Q = solid prism A-B-C-D height 5 vertices EFGH   # right prism on a base polygon; top names optional
O = solid sphere center M radius 5
C = solid cylinder from A to B radius 3
K = solid cone apex V base O radius 3
F = solid frustum from O radius 6 to P radius 3
# by edges
T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)
# by dimensions (placed by the H1 convention, centred, axis vertical)
solid cube edge 4                               # exactly prism 4 by 4 by 4, same bytes
solid prism regular 6 side 12, height 5
solid pyramid regular 5 side 4, height 6
solid pyramid rectangle 6 by 4, height 9        # width (Y) by depth (X), like prism
solid octahedron edge 6
solid frustum radius 6, top 3, height 4         # conical
solid frustum regular 4 side 6, top 3, height 4 # pyramidal
```
- **A prism on a base polygon** extends along the base's right-hand normal, `(B − A) × (C − A)`, so the base reads counter-clockwise from the new top. Reverse the base order to flip it.
- **The base polygon must be planar and convex,** and it is refused otherwise, naming the offending point. Pyramid, prism and tetrahedron on points check their specific degeneracies (a coplanar apex, a zero height) with specific messages, then build through `hullOf`.
- `vertices` on a point-built solid is refused: its vertices already have names. The exception is a prism's new top.
- **Named dimensions** (for `label: S <dim>`):

  | Solid | Dimensions |
  |---|---|
  | cube | edge |
  | regular prism, regular pyramid | side, height |
  | rectangle pyramid | width, depth, height |
  | octahedron | edge |
  | conical frustum | radius, top, height |
  | regular frustum | side, top, height |
  | point-built solids | none |

  For a point-built solid, `label: S height` is refused with a message pointing at `label: AB`. Add `side` and `top` to the parser's dimension words.
- The parser's primitive list and error message list every primitive.

**P7: sections on the new solids.**
- Polyhedra (including hulls) cut through the existing edge walk unchanged.
- A round solid whose axis is **not** author-vertical refuses `cut:`/`section:` with "sections of a tilted {solid} arrive with oblique planes (build step 8)".
- A vertical, off-origin round solid is cut correctly, and the plane offset is measured in world coordinates.

---

### Task 1: Round solids get a placement, and the frustum

**Files:** `figure/solids.ts` (the `SolidBody.placement` for round solids, identity for existing ones; the frustum spec), `figure/silhouette.ts` (`frustumOutline`, the local-camera helper), `figure/occlusion.ts` (run round-solid code in local coordinates; frustum candidates), `figure/crossSection.ts` (frustum sections; P7's refusal for tilted solids), and the parser (the `frustum radius … , top … , height …` form). Tests go in each module's test file.

- [ ] **Step 1: failing tests:**
  - **Local camera** (`silhouette.test.ts`):
    - For a placement with a tilted axis, the local camera's `direction`, `right` and `up` stay orthonormal and right-handed.
    - `localCamera.project(p)` equals `camera.project(toWorld(p))` on arbitrary points.
    - A cylinder with axis along author X, drawn through its placement, has silhouette lines genuinely tangent to its projected rims. Assert tangency by the rim ellipse's tangent at the touch angle, not by length.
    - **Identity:** an identity placement uses the world camera itself (`===`).
  - **Frustum:**
    - The silhouette lines of `frustum radius 6, top 3, height 4` pass through the virtual apex's projection and are tangent to both rims.
    - The back half of the base rim is dashed and the front half solid; the top rim is fully solid.
    - `top > radius` draws as the mirrored solid, bytes equal to the same frustum built with an explicitly reversed axis.
    - `top == radius` and `top == 0` are refused with their pointers.
  - **Occlusion with a tilted cylinder:** a segment behind a cylinder whose axis runs along author X is split at the silhouette planes, with split parameters hand-computed. A segment along its axis is hidden.
  - **Frustum occlusion:** a segment behind the frustum at the top rim's height is split by the **top-rim sweep**.
  - **Sections:**
    - A frustum cut perpendicular to its axis at mid-height gives a circle of radius (6+3)/2.
    - A cut through the axis gives a trapezoid with parallel sides 12 and 6.
    - A tilted cylinder's `cut:` is refused with P7's message.
  - **Byte identity:** every existing cylinder, cone and sphere spec renders unchanged. The existing tests cover this, and they must not be edited.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Use the world camera instead of the local one for a tilted cylinder: the tangency test must go red.
  - Delete the top-rim sweep candidates: the frustum occlusion test must go red.
  - Delete the axis reversal for `top > radius`: its test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): round solids carry a placement; the frustum`.

### Task 2: The convex hull, and `solid hull`

**Files:** create `figure/hull.ts` and `figure/hull.test.ts`. Modify the parser (`solid hull A-B-…`), `figure/solidScope.ts` (build from space points), and `figure/solids.ts` (a `hull` spec carrying the built polyhedron; `labelOrder` the identity).

- [ ] **Step 1: failing tests** (`hull.test.ts`):
  - **Unit cube (8 points):** 6 faces, **each a quad**, no triangles. Every face is wound counter-clockwise from outside, with its outward normal pointing away from the centroid. Exactly 12 edges.
  - **Regular octahedron:** 8 triangular faces.
  - **Square pyramid from 5 points:** 1 quad and 4 triangles.
  - **Refusals:** a 9th point at the cube's centre is refused, naming it ("inside"). A point at an edge midpoint is refused ("not a corner"). Four coplanar points are refused. Three points are refused.
  - **Determinism:** the same input in the same order gives an identical face list. A permuted input gives the same set of faces (compare as sets). Face order is not asserted across permutations.
  - **Convexity invariant:** 20 seeded random convex point sets (points on a sphere, fixed seed) all pass `solids.test.ts`'s every-vertex-inside-every-face-plane check.
  - **Render:** `S = solid hull A-B-…-H` on the unit cube's eight points draws the same edges as `solid cube edge 1` translated to the same position. Compare the sets of world-space edges, not bytes.
- [ ] **Step 2: implement per P3.**
- [ ] **Step 3: prove it.**
  - Delete the coplanar merge: the "each face a quad" test must go red.
  - Delete the corner check: the "inside" refusal test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): an exact convex hull, and solids as the hull of named points`.

### Task 3: Solids on named points

**Files:** the parser (P6's by-points forms), `figure/solidScope.ts`, `figure/solids.ts`, and tests (`solidScope.test.ts`, `render.test.ts`).

- [ ] **Step 1: failing tests:**
  - **Tetrahedron on points:** `solid tetrahedron A-B-D-E` on the unit-cube corners A=(0,0,0), B=(1,0,0), D=(0,1,0), E=(0,0,1) draws 6 edges.
    - Exactly **three** are dashed: AB, AD and AE. The three faces meeting at A have normals −X, −Y and −Z, all facing away from the (+,+,+)-side default camera, so every edge at A is hidden. BD, BE and DE are drawn solid.
    - `label: BD` prints √2.
  - **Pyramid on points:** `solid pyramid A-B-C-D apex E` with E over the square's centre draws as `pyramid square base …` translated. Compare world edges. A coplanar apex is refused, naming E.
  - **Prism on points:**
    - `solid prism A-B-C height 5 vertices DEF` on a triangle in the plane z = 0, wound counter-clockwise from above, puts D, E, F at z = +5.
    - The same base wound clockwise puts them at z = −5. This proves the right-hand rule by construction, not by name.
    - A non-convex base quad is refused, naming the reflex vertex.
  - **Round solids on points:**
    - `solid sphere center M radius 5` with M = (1, 2, 3) draws a circle centred at M's projection.
    - `solid cylinder from A to B radius 3` with A = (0,0,0) and B = (6,0,0) is a horizontal cylinder along author X, and its silhouette is tangent to both projected rims.
    - `solid cone apex V base O radius 3`: the silhouette lines pass through V's projection.
    - `solid frustum from O radius 6 to P radius 3` matches the Task 1 frustum under the same placement.
    - A zero-length axis (A = B) is refused, naming both points.
  - **Glass:** in a figure with two cones whose axes cross at right angles, each cone's own outline is byte-identical to drawing it alone.
  - **`vertices`** on a point-built solid (other than a prism's top) is refused, as is `label: T height` on one.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Invert the prism's extrusion normal: the clockwise/counter-clockwise test must go red.
  - Drop the cylinder's placement (build it at the origin): the horizontal-cylinder test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): solids on named points — hull-backed polyhedra and placed round solids`.

### Task 4: The tetrahedron from six edges

**Files:** the parser (`tetrahedron ABCD with …`), `figure/solids.ts` or a small `figure/tetrahedron.ts` (the builder is load-bearing enough for its own file), `figure/solidScope.ts`, and tests.

- [ ] **Step 1: failing tests:**
  - **Identity (P4):** six equal edges of 6 give every lettered vertex exactly as `tetrahedron edge 6 vertices ABCD` places it (within `GEOM_EPS`).
  - **AIME 2024 I:** AB = CD = √41, AC = BD = √80, AD = BC = √89. Every `label: XY = <value>` assertion passes for all six edges, true 3D.
    - `F = foot D to plane A-B-C` then `label: DF` equals the height implied by the volume: `V = 160/3`, so `DF = 3V / area(ABC)`, and area(ABC) = 6√21 by Heron. Hand-compute this, not from the builder.
    - Also assert the base is horizontal: A, B, C share an author z.
  - **Order independence:** the six edges written in a different order, and with some pairs reversed (BA for AB), give byte-identical output.
  - **Refusals:**
    - A face failing the triangle inequality is refused, naming the face.
    - Six edges whose faces are fine but whose Cayley–Menger determinant is ≤ 0 are refused as "cannot close". Construct such a case: AB = AC = AD = BC = BD = 1 and CD = 1.99.
    - A missing pair, a repeated pair, or a fifth letter is refused, naming it.
- [ ] **Step 2: implement per P4.**
- [ ] **Step 3: prove it.**
  - Place A on +x instead of the P4 azimuth: the identity test must go red.
  - Delete the Cayley–Menger check: the "cannot close" test must go red. It must fail for the right reason, NaN or a wrong solid, not pass.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): the tetrahedron from its six edges`.

### Task 5: More solids by dimensions

**Files:** the parser (cube, `prism regular`, `pyramid regular`, `pyramid rectangle`, octahedron, `frustum regular`), `figure/solids.ts` (builders, P5's placement and lettering, dimensions and dimension segments), and tests.

- [ ] **Step 1: failing tests:**
  - **Cube:** `solid cube edge 4` is byte-identical to `solid prism 4 by 4 by 4`, with and without `vertices`.
  - **P5 rule:**
    - For each of `prism regular n` (n = 3, 5, 6, 8), `pyramid regular n` (n = 3, 5, 6) and `octahedron`, the chosen rotation is what the rule produces. Assert the recorded integer degrees.
    - Under `DEFAULT_CAMERA`, every face's margin from edge-on is at least the value that rotation achieves.
    - Every pyramid's apex-to-base-centre segment is separated from every lateral edge in projection.
    - Informational: report the rule's choice for n = 3 and n = 4 pyramids, without changing the pinned solids.
  - **P5 lettering:** for the hexagonal prism, A is the left end of the front-most base edge and ABCDEF run counter-clockwise from above. G is over A. Assert with author coordinates.
  - **Hexagonal prism, side 12:** `label: AB = 12` passes. The long base diagonal `label: AD = 24` passes, and it is not axis-parallel.
  - **Octahedron, edge 6:** 8 faces, and the distance between opposite vertices is 6√2.
  - **Rectangle pyramid:** width along Y, depth along X, height along Z, in author coordinates.
  - **Regular frustum:** the top is concentric and rotated with the base. Lateral faces are trapezoids (quads, not split).
  - **Dimensions:** every named dimension in P6's table resolves, asserts, and hangs off a front edge that stays the same under `standard` and `isometric`.
  - **Convexity invariant** covers every new primitive.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Replace P5's rotation with 0°: the recorded-rotation and margin tests must go red.
  - Reverse the lettering direction: the counter-clockwise test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): cube, regular prisms and pyramids, octahedron, frusta`.

### Task 6: Examples, reference and handoff

**Examples** (`examples.test.ts` covers parse-and-draw automatically):
1. **"AIME tetrahedron"**: the √41/√80/√89 tetrahedron, with the foot of D on ABC, segment D–F, `label: DF`, and `given:` rows for three of the edges.
2. **"Hexagonal prism"**: side 12, height 8, `vertices` named, with the triangle from A to its three neighbours drawn as segments. This is the AIME dihedral-angle setup; the angle mark itself is build step 10.
3. **"Two cones and a sphere"**: two cones of radius 3 and height 8 whose axes cross at right angles at O, 3 from each base, and the sphere at O of radius `15/sqrt(73)` inside both (r² = 225/73).
   - Cone 1: base centre (−3,0,0), apex (5,0,0).
   - Cone 2: base centre (0,−3,0), apex (0,5,0).
   - **Verify in a test that the radius is right:** the distance from O to cone 1's generator through (−3,3,0) equals 15/√73. A wrong radius draws a sphere that is not tangent, and nothing else would catch it.
4. **"Frustum"**: a conical frustum with `label:` on its three dimensions.
5. **"Hull of points"**: a polyhedron given only as the hull of named points, for example a cube with one corner sliced off. Coordinates: the unit-cube corners minus one, plus the three midpoints adjacent to it. Every point must be a corner.

**Reference:** the grammar header in `parseStatement.ts` (and the types grammar comment it points to) documents every form in P6, the P2 frustum rules, and P7.

**Handoff:**
- Add a phase 7 row.
- Add the placement/local-camera decision (P1) and the hull (P3) to "How the engine is put together".
- Add the P5 conventions to the placement notes.
- Record that the tutor reference (`bootstrap.ts`) lags further; the user has scheduled it for much later.

- [ ] **Step 1:** add the examples and run `examples.test.ts`. Render each to a scratch SVG with `vite-node` and inspect it.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 7 solids by points — examples, reference, handoff`.

## Verification

1. All pre-existing specs are byte-identical under every view, and all three checks are clean.
2. The AIME 2024 I tetrahedron draws, measures all six edges exactly (to the formatter), and its height DF matches the hand-computed value.
3. Six equal edges reproduce the regular tetrahedron's lettered vertices exactly.
4. The hull builds one polygon per face and refuses non-corner points.
5. Round solids draw and occlude correctly with tilted axes. Tilted-solid sections refuse legibly.
6. Every new example drawn and inspected.

## Out of scope

Oblique section planes and drawn planes (build step 8). Inscribed and circumscribed solids and tangency (step 9; the sphere in the cones example is placed by its known radius). Angle and dihedral marks (step 10). Nets (step 11). Exact values. Opaque stacking. Non-convex solids. The tutor reference.
