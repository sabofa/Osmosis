# Handoff — Graph Engine v2, 2026-09-23

Written at a clean checkpoint for whoever picks this up next, including a
future me with none of this in context. It records the things that are **not**
recoverable from the code: why decisions went the way they did, what has
already been tried and failed, and which traps cost real time.

## Where things stand

**Branch `milestone-a/geometry`**, in the worktree
`.claude/worktrees/milestone-a-geometry` (renamed 2026-09-26 from
`graph-engine-track-1` / `graph-track-1`; see "Worktrees, milestones and parallel
agents" below). Working tree clean. **4050 tests passing** after the
Milestone A integration merge of geometry and space (2026-10-01),
`npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json
--noEmit` (both, from `graph-engine/`) clean, `oxlint` clean. (Not bare
`npx tsc --noEmit`: `graph-engine/tsconfig.json` is a solution file — `"files":
[]` plus `references` — so that invocation type-checks nothing at all and
exits clean regardless of what is broken.)

*2026-09-30: the visual pass, part 1 (figure styles and the style lab) landed
on this branch — see "Figure styles: `style/` and the pen" below; 2261 tests.*

*2026-10-04: 2D handling (`view2d/`) landed on this branch — figures pan, zoom, point and focus; see "2D handling (view2d)" below; 2681 tests.*

*Last updated 2026-09-27, after geometry phase 12 (shading and shaded
regions — "find the area of the shaded region"). Phase 11 completed the
solids build order of the spec's "Revised 2026-09-25" section; phase 12
returned to plane geometry.*

Nothing is merged to `main`. Another agent works on `main` directly, which is
why this lives in a worktree — their commits were interleaving with mine and
breaking test runs mid-task.

### Worktrees, milestones and parallel agents (2026-09-26)

**Worktrees are organised by milestone.** The current stopping point is
**Milestone A** (tracks 1–4). Every branch serving it carries the
`milestone-a/` prefix, so a branch named just `milestone-a` is impossible —
git cannot hold both `milestone-a` and `milestone-a/…`.

| Branch | Worktree | Holds |
|---|---|---|
| `milestone-a/main` | `.claude/worktrees/milestone-a` | Integration only. Sides merge in at phase boundaries; it merges to `main` when Milestone A is done |
| `milestone-a/geometry` | `.claude/worktrees/milestone-a-geometry` | Tracks 1–2: reading the graph, geometry, **solid figures** |
| `milestone-a/space` | `.claude/worktrees/milestone-a-space` | Track 3: **space**, a hand-made WebGL2 engine (Calc 3 now; Physics C is sub-project 3) — a separate agent; phase branches `milestone-a/space-s…` merge into it |
| `milestone-a/calc` | later | Track 4: calc-proofing the 2D engine |

**More than one agent works at once.** Expect branches, worktrees, stash
entries and review servers you did not create. Do not investigate, clean up,
pop or drop any of them. Stay in your own worktree, stage with explicit
`git add <paths>` (never `-A` / `.`), and never use bare `git stash` /
`git stash pop`. If a file in *your* worktree changes under you, stop and
report it.

**Review servers, one port per side,** all on the Tailscale IP:
`milestone-a/geometry` on **5181**, `milestone-a/space` on **5182**.

**The two 3D engines share no code.** *Space* is everything under
`graph-engine/src/space/`, a hand-made WebGL2 engine with no three.js (the
old `scene/buildScene3d.ts` and `render/SceneRenderer3D.ts` were deleted in
space S2); *solid figures* is everything under `graph-engine/src/figure/`.
Never write "3D engine" alone. Fixed between them
(spec, Track 2 "Revised 2026-09-25"):

- **One author frame, z-up, in both.** Coordinates mean the same place either way.
- **`solid:` belongs to solid figures.** Track 3's double integral is
  `volume: under z = f over region`.
- **The mode rule in `scene/mode.ts`:** a spec with a `solid` or `crossSection`
  statement infers `figure`, checked **before** `isThreeD`. A 3-coordinate point
  with no solid still infers `graph` (space). Do not reorder it.
- **`@view` is the solid-figure camera.** Space needs its own directive.

**Files both sides touch, so coordinate before editing:**
`parser/parseStatement.ts` (add a side's statements in their own block, or
better their own module, to keep merges easy), `parser/types.ts`,
`parser/config.ts`, `scene/mode.ts`, `examples.ts` / `examples.test.ts`, and
this handoff. **Neither side edits the other's directories.**

### The two specs are the authority

- `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — graph engine.
  **Also owns the shared document format** (pages, bindings, overlays,
  container, classification) because it was specified there first.
- `docs/superpowers/specs/2026-09-22-document-engine-v2-design.md` — document
  engine (mode matrix, markdown editor, spreadsheet, code pages).

Plans live in `docs/superpowers/plans/`. Every plan argues from a spec; where
they disagree, **the spec wins**.

### Build order (revised 2026-09-22, in the graph spec)

1. **Milestone A — tracks 1–4** ← in flight
2. 2a — retention loop and identity backfill *(Osmosis app)*
3. Graph theme tokens; **exact/symbolic values**; decide sandbox ownership
4. D1–D3 *(document engine)*
5. Sandbox build *(Osmosis app)*
6. Shell docs, then shell + item presentation *(Osmosis app)*
7. Container / multi-page — the tie-in
8. Track 6, track 7, D4
9. Track 5 + D5 as one pass
10. Homework and the rest

Engine work **pauses after Milestone A** while the sandbox, shell and items get
built.

### Done

- **Track 1 — reading the graph.** Feature points derived from statement maths
  (roots by bisection, extrema as roots of f′ classified by f″, intersections
  as roots of f−g), typed and distinctly marked, hover snapping, `@labels` /
  `@label-every`, `@step-mode`, chained inequalities.
- **Track 2 — geometry, phases 1–12.** Construction core (lines/points/circles
  as intersectable objects, derived points, triangle solvers, centres with
  their circles); the SVG figure renderer; measures, notation, navigation and
  panels; circle vocabulary and the givens table; solid primitives with
  dimensions and axis-perpendicular sections; points, constructions, true-3D
  measures and occluded segments in solid figures; a `standard` default view
  in general position and textbook vertex lettering; solids on named points,
  the tetrahedron from six edges, the exact convex hull, regular prisms and
  pyramids, the octahedron, frusta, and round solids at any position and tilt;
  planes as objects (six author forms, named planes) and sections of any
  solid by any plane, in place with the hidden outline dashed and lifted at
  true shape; inspheres and circumspheres of polyhedra and round solids,
  spheres placed by tangency, and a sphere's centre and radius as a point
  and a named dimension; measures and marks in space — angle arcs,
  asserted right angles and ticks on points in space, dihedral angles
  with their plane-angle mark, angles and distances between lines and
  planes in the givens table, and the common perpendicular of two lines; nets of every
  polyhedral and round primitive by per-primitive templates, folds dashed,
  and the shortest path over a solid's surface — an exact enumeration of
  face sequences over polyhedra, closed form on the unrolled side of a
  cylinder, cone or frustum; shaded regions of the plane — polygons, disks,
  sectors and circular segments and their exact booleans (a square minus
  its circle, a lens, an annulus, the arbelos) — with exact areas labelled
  inside them and asserted.

### Not started

Track 4 (calc-proofing). Track 3's sub-projects 1–2 are built (space S1–S6,
the integration pass, and the milestone gate fix on top of S6 — see "Track 3
— space" below); sub-project 3 (vector calculus, Physics C) and sub-project 4
(quant) are not.
All of D1–D5. **The solids build order is complete** (phase 11 was its
build step 11), and shading and boolean regions followed as phase 12.
What remains of Track 2: the competition-specific constructions
(excircles, nine-point circle, radical axes, cevian concurrency — the next
phase), and the unit circle, which is gated on exact values (build-order
step 3). Figure styles: part 1 is built; part 2 (movement) and part 3 (the
written guideline) are not.

### What each track-2 phase actually delivered

| Phase | Commits | What it means in practice |
|---|---|---|
| 1 | `b507767`..`c070b2d` | Constructions: a figure is *derived*, not hand-placed. `D = foot A to B-C` instead of computing the altitude's foot yourself |
| 2 | `06e16a3`..`7582783` | The SVG figure renderer. `@mode: figure` is a separate renderer, not axes switched off |
| 3 | `3781d6b`..`8f0eb54` | Measures (`label: AB` prints what the engine solved), notation (overbars, `∠`, `⊥`), pan/zoom, the givens panel, figure+table panels |
| 4 | `ff8580f`..`a98bdc7` | Circle vocabulary (chord, arc, sector, tangent at/from, secant, radius, diameter) and the givens **table** with sections |
| 5 | `5f09b6d`..`4977327` | Solids: the `solid:` statement, dimension labels, arcs in the edge type, analytic silhouettes, cross-sections |
| 6 | `2d4ecd4`..`8d4dd68` | Solid figures get a construction core: the z-up author frame, points in space, a solid's vertices as real points, midpoint/divide/centroid/centres/foot/line-meets-plane in space, true-3D `label:`/`given:`, and `segment:` split visible/hidden against every solid (the glass rule) |
| 6b | `242b04b`, `0f7a892`, then the docs commit | The default view is `standard` (azimuth 30°, elevation 25°, general position), not isometric; placement is fixed against the default camera, never the active view; prisms, pyramids and tetrahedra are lettered in textbook order |
| 7 | `df94340`..`d4a3aae`, then the docs commit | Solids are stated the way competition problems state them: on named points (hull, tetrahedron, pyramid, prism, sphere, cylinder, cone, frustum), a tetrahedron from its six edges (AIME 2024 I draws and measures), regular n-gon prisms and pyramids, the octahedron, conical and pyramidal frusta, the cube; round solids at any position and tilt through a placement and a local camera |
| 8 | `9677aeb`..`2b97c75`, then the docs commit | Planes are objects: through three points, perpendicular to a line, parallel to a plane, by an equation, the axis form, and named (`p = plane ...`, used as `plane p`), all canonicalised to one internal plane. Any solid is cut by any plane: the cube's central hexagon, the tetrahedron's square, the AIME pyramid's pentagon, the log wedge's half ellipse, a sphere's circle through three points. In place, the outline the solid hides is dashed; lifted, the section is true shape, corners nameable |
| 9 | `ac7c0fd`..`267576c`, then the docs commit | Spheres the figure constructs, each an ordinary sphere solid: the insphere and circumsphere of any polyhedron (a fixed-order linear solve, verified against every face or vertex, refused naming the first that fails) and of a cylinder, cone or frustum (closed form in its own frame, so placed and tilted ones work); a sphere tangent to a plane or externally/internally to another sphere; `M = center of S`; `label: S radius` on every sphere. The AIME 2024 I tetrahedron's insphere measures 20√21/63 |
| 10 | `b10860b`..`bc9903d`, then the docs commit | Measures and marks in space: `given: angle between A-B and C-D` (skew allowed), `… and plane <any form>`, `distance between A-B and C-D`, `distance from P to plane …` / `to line …` in the givens table; `dihedral C-A-B-D` as a value and as a drawn mark (`dihedral:`) — the AIME 2016 I hexagonal prism reads 60 at height √108; `P, Q = common perpendicular of A-B and C-D`; `angle:`, `right-angle:` (asserted 90), `tick:` and `label: angle ABC` on points in space, the marks built in space and projected, each drawn whole by its middle under the glass rule |
| 11 | `5c33aa4`..`c078df9`, then the docs commit | Nets and shortest paths over a surface: `net: S` unfolds every polyhedral primitive by its template (the cube's cross, a prism's strip, a pyramid's or tetrahedron's star, the octahedron's strip, the frustum's star) and every round one (rectangle, sector, annular sector, rims tangent), true size, lifted and stacked, folds dashed, letters repeated as display labels; `shortest: P to Q over S [unfold]` — Dudeney's spider reads 40 over five faces, the cube's corner path √5, the AIME fly on a cone 625 on the unrolling |
| 12 | `f565063`..`0e453f9`, then the docs commit | Shaded regions: `fill: square ABCD minus circle O`, `circle O and circle P` (the lens), `circle O minus circle P` (the annulus), sectors, circular segments and polygons, booleans with parentheses, drawn as ONE path (arcs as `A`, holes even-odd, no outline of its own) behind every line; `label: area R` prints the exact area inside the region (16 − 4π → 3.434), and a stated area asserts at the one shared tolerance, like every measure; `square`/`rectangle` are asserted shapes |
| Visual pass 1 | `c3b206b`..`e5481ea`, then the docs commit | Figure styles: `@style: clean \| ink \| pencil \| marker` and `@style-<setting>` for every token (six line types, seven fills, nine papers, three lettering faces, saturation, a seed); a renderer-independent `style/` module; figures draw through a pen (the clean pen is today's output, byte for byte); the style lab (`review/style-lab.html`) and contact sheets (`scripts/contact-sheet.ts`). Spec `2026-09-30-figure-styles-design.md`, plan `2026-09-30-figure-styles-part-1.md` |

Track 1 is `961471d`..`38cb2a6`, plus follow-ups through `17249eb`.

### Phase 5 in detail (solids), because it is the newest

Grammar that now works:

```
S = solid prism 8 by 5 by 6
T = solid tetrahedron edge 5 vertices ABCD
C = solid cylinder radius 3, height 8
label: S height = 5           # asserts, like every other measure
cut: S by plane y = 1         # shaded where it lies, behind the solid's lines
section: S by plane y = 1 vertices PQRS   # lifted out as a true-shape figure
```

Primitives: `prism`, `pyramid`, `tetrahedron`, `cylinder`, `cone`, `sphere`.
`@view:` selects a named viewpoint; there is no free camera by design. **Since
phase 6b the default is `standard`, not `isometric`** (see "Phase 6b in
detail").

**The two decisions worth not re-litigating:**

*Curved primitives are not faceted.* `SolidBody.polyhedron` is `null` for them;
they emit an **analytic silhouette** instead — a cylinder as two lines plus a
front and a back elliptical arc. Faceting was considered and rejected: it goes
visibly polygonal under the figure view's zoom, generates spurious facet edges
to suppress, and discards the crispness that chose SVG. This is why
`ProjectedEdge` carries arcs as well as segments.

*Cross-sections hand back real 2D geometry*, which is the whole seam. Because
the section is genuinely 2D, it picks up notation, tick marks and the givens
table for free.

**Correction (2026-09-26): the test said to pin this pins nothing.** It checks
that a section of an 8×5×6 prism measures `PQ = 8` "while the projected edge is
8·cos30 = 6.93". That is wrong: 6.93 is the edge's horizontal *extent*. The
isometric camera draws every **axis-parallel** segment at true length
(`(8·cos30, −4)` has length exactly 8), so a section returning projected
coordinates would also measure 8. The same mistake makes the dimension-label
test's `not.toContain('>6.93')` unfailable. Both are repaired in phase 6,
Task 1, Step 5b, by testing a diagonal or an angle, which the projection does
distort. **To tell true from projected in a solid figure, never test an
axis-parallel segment.**

**Hidden-line removal is convex-only**, and `SOLID_PRIMITIVES` is the only
route from a spec to a solid, so every solid reachable from the DSL is convex
by construction. The plan called for a runtime guard rejecting non-convex
solids; that would have been a branch no input can reach. The **invariant** is
pinned instead in `solids.test.ts` — every vertex on the inner side of every
face plane, with a deliberately dented cube alongside so the check cannot pass
vacuously. **If you add a non-convex primitive, that test fails and it is
telling you the visibility rule no longer holds.**

### Phase 6 in detail (the solid-figure construction core)

Grammar that now works, all z-up:

```
A = (0, 0, 0)                                   # a point in space: dot + label
S = solid prism 8 by 5 by 6 vertices ABCDEFGH   # A-H are points in space now
M = midpoint A-G                                # also divide, centroid ABC / ABCD,
F = foot D to plane A-B-C                       #   circumcenter/incenter/orthocenter ABC,
X = intersect line A-G, plane B-D-E             #   foot D to line A-B
segment: A-G                                    # dashed where a solid hides it
segment: A-G plain                              # ...or forced either way
(0, 0, 6) -- (0, 0, -12)                        # the coordinate form, in space
label: AG                                       # TRUE length, never the drawn one
given: angle ABC                                # true angle, givens table only
cut: S by plane z = 1                           # horizontal (was "y = 1" in phase 5)
```

**The decisions worth not re-litigating:**

*One author frame, converted at one boundary (S1).* Authors write z-up; the
solid-figure engine stays y-up inside, because every byte it emits depends on
it. `figure/authorFrame.ts` is the only module that knows both: author
(X, Y, Z) -> internal (Y, Z, X), a proper rotation fixing (1,1,1), so the
isometric camera views from the author's (+,+,+) octant — X toward the viewer
and left, Y right, Z up; width along Y, depth along X, height along Z. Error
messages convert back ("The plane z = 9 does not cut "S"").

*Dimension is a property of a name (S2).* A name is a plane point or a space
point; constructions may not mix them, a planar construction refuses a space
point by saying it is planar, and names stay unique across both kinds.

*One source-order walk owns solids and space constructions (S3).*
`figure/solidScope.ts` runs before `buildConstructions`, which now takes a
skip set so it never sees a space construction. Triangle centres in space
reuse `scene/geometry/centres.ts` by laying the triangle into its own plane
(first axis A->B, second toward C) and lifting the answer back — the centre
formulas exist once.

*The glass rule (S6).* Solids never hide each other; every solid hides a
construction segment. `figure/occlusion.ts` splits a segment at exact
candidate parameters (face planes and silhouette-edge planes for polyhedra;
the surface, cap/base planes, silhouette-line planes and swept rims for
cylinders and cones; the sphere and its view cylinder) and classifies each
span at its midpoint by the ray test. Candidates may be superfluous, never
missing; every family has a test that fails when it is deleted. Each solid is
shrunk by a rounding-sized margin for the ray test — without it, a segment
lying across an oblique front face (a tetrahedron's) is dashed by rounding.

*Mode (S5).* A solid or a cut/section infers `figure` BEFORE the depth
check, so a 3-coordinate point beside a solid no longer sends the spec to
the space renderer. 3-coordinate points with no solid still infer space.

**Two phase-5 tests pinned nothing and were repaired in phase 6.** The
isometric camera draws every axis-parallel segment at true length, so a
prism edge can never tell true from projected. The repaired tests measure a
tetrahedron edge and a section's diagonal and right angle instead. The rule
stands: **never test true-vs-projected with an axis-parallel segment.**

~~**A prism's vertex lettering runs clockwise seen from above.**~~ **Changed
in phase 6b**: prisms, pyramids and tetrahedra are lettered in textbook order
now; see below.

### Phase 6b in detail (the default view and lettering)

**The default view is `standard`, not isometric (V1).** Exact isometric looks
along a cube's space diagonal: a cube's front and back corners project to the
same point, and a regular tetrahedron flattens until its altitude lies under
an edge. `standard` is orthographic, from author azimuth 30° (from +X toward
+Y) and elevation 25°, author Z drawn page-up, scale 1, and it is built from
its frame (`orthographicCamera` in `project3d.ts`, converted through
`authorFrame.ts`). `DEFAULT_VIEW` / `DEFAULT_CAMERA` name it; `@view` defaults
to it; `projectSolid` and `renderSolidFigure` default to it. `isometric`,
`front`, `top` and `side` are unchanged, and `@view: isometric` draws
byte-for-byte what the old default drew (the S1 digests now pin it by name).
Measured: unit-cube vertices at least 0.49 apart on the page, tetrahedron
faces at least 21.2° from edge-on, its altitude at least 8.7° off every apex
edge.

**Placement follows the default camera, never the active view (V2).** The
tetrahedron's first base vertex sits 15° round from the default camera's
azimuth (`BASE_START_ANGLE = baseStartAngle(DEFAULT_CAMERA)`), which is the
45° phase 5 used, so the tetrahedron did not move; the camera did. Facing the
viewer exactly puts apex, front vertex and base centroid in one vertical
plane with the view: that was the overlap. The dimension edges were re-chosen
for `standard` and came out the same (a prism's nearest bottom corner is
unchanged). Switching `@view:` never re-letters, re-orients or re-chooses a
dimension edge; a render test pins vertex positions under three views.

**Textbook lettering (V3).** A prism's ABCD run counter-clockwise seen from
above from A, the front-left bottom corner (author largest X, smallest Y), so
the front face is ABFE, D is the hidden corner, E–H sit above A–D with E over
A, and AG is the *long* diagonal. A square pyramid's base is lettered the same
way, apex E. A tetrahedron's A is its first base vertex, B and C follow
counter-clockwise from above, D is the apex. It all lives in `labelOrder`.

**True-vs-projected, revisited.** `standard` does not draw axis-parallel
segments at true length, but AG, the long diagonal, draws within 0.05 of its
true length under it. The rule stands and gains a corollary: **pick a segment
the camera visibly foreshortens**, and check that it does, before using it to
tell true from projected.

### Phase 7 in detail (solids by points, and general polyhedra)

Grammar that now works (author frame, z up; points are defined first):

```
S = solid hull A-B-C-D-E-F                       # every named point must be a corner
T = solid tetrahedron A-B-C-D
P = solid pyramid A-B-C-D apex E                 # base flat and convex, or refused naming the corner
Q = solid prism A-B-C-D height 5 vertices EFGH   # rises along (B - A) x (C - A); top names optional
O = solid sphere center M radius 5
C = solid cylinder from A to B radius 3          # any direction
K = solid cone apex V base O radius 3
F = solid frustum from O radius 6 to P radius 3
T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)
solid frustum radius 6, top 3, height 4          # conical; top > radius is the same solid turned over
solid cube edge 4                                # byte for byte "prism 4 by 4 by 4"
solid prism regular 6 side 12, height 5
solid pyramid regular 5 side 4, height 6
solid pyramid rectangle 6 by 4, height 9         # width (Y) by depth (X)
solid octahedron edge 6
solid frustum regular 4 side 6, top 3, height 4  # pyramidal
```

**The decisions worth not re-litigating:**

*A round solid carries a placement, and the maths runs in its frame (P1).*
`SolidBody.placement` is an origin plus an orthonormal, right-handed frame
whose local y is the axis (`silhouette.ts`: `Placement`, `frameForAxis`,
`toWorld`/`toLocal`). To draw or occlude, the world camera is re-expressed in
that frame — a **local camera** whose `project(p)` is the world projection of
the placed point — and the existing y-axis silhouette and occlusion code runs
unchanged against it. Two things make that safe. An **identity placement
uses the world camera itself** (`===`), so every pre-phase-7 round solid kept
its bytes. And `Camera` gained an optional `projectVector`, the linear part
of a local camera's affine `project`: `projectCircle` and
`coneSilhouetteAngles` project radius VECTORS, which must not pick up the
placement's translation. A test at the origin cannot see that bug; the
off-origin tilted-cylinder test can (it went red when `projectVector` was
deleted, and the origin case did not). The frame for an axis is fixed
(u = axis × author-X, falling back to author-Y), so arc start angles are
deterministic.

*One exact convex-hull builder (P3).* `hull.ts`'s `hullOf` enumerates every
triple's plane (O(n⁴), exact, no iteration), keeps the supporting ones, and
**merges coplanar ones into one polygonal face** — a split face would draw a
spurious diagonal. Vertex order is the input order, so a point-built solid's
`labelOrder` is the identity. Every point-built polyhedron and the
six-edge tetrahedron is built by it, so they are convex by construction, and
the convexity invariant covers them (plus 20 seeded random hulls). It refuses
a named point that is not a corner — inside, on an edge, on a face — naming
it. **It is bounded (fix wave 1):** at most 24 points, refused legibly beyond
that, because O(n⁴) on authored input froze rendering (`prism regular 100`
took about 45 s when regular solids still went through it). Its tolerances
are taken about the points' own centroid, so a small solid far from the
origin is not refused as flat.

*The six-edge tetrahedron is placed exactly like the regular one (P4).*
`tetrahedron.ts`: every face by the strict triangle inequality, then the
Cayley–Menger determinant (288 V²) must be positive. The height comes from
the determinant (h = 3V / area), so the check is the whole story: without it
the height is NaN and the hull refuses in the wrong words. Base ABC level and
counter-clockwise from above, centroid on the axis, A at the default camera's
azimuth + 15°. Six equal edges reproduce `tetrahedron edge e vertices ABCD`
within GEOM_EPS. The AIME 2024 I tetrahedron measures all six edges and its
height 80 / (3√21) (from V = 160/3 and area 6√21, computed by hand).

*P5 — one placement rule and one lettering rule for regular bases.*
`regular.ts`: the rotation is the integer degree in one symmetry period that
maximises the least of every face's margin from edge-on under the default
camera and every base corner's azimuthal distance from the camera's vertical
plane; ties go to the smallest. **It is evaluated at a fixed reference
proportion, height = side** (controller ruling, fix wave 1), so the rotation
is a function of the kind and n alone — a pyramid no longer turns when only
its height changes, and a pyramidal frustum stands as its pyramid does.
Recorded: prism n = 3: 16°, 5: 3°, 6: 0°, 8: 19°; pyramid (and frustum)
n = 3: 12°, 4: 16°, 5: 8°, 6: 20°; octahedron 75° (the full table is in
`regular.ts`). The pinned regular tetrahedron and square pyramid stay at 45°
(the rule would pick 12° and 16°). Lettering: A is the left end, from the viewer, of the base edge whose
normal points nearest the camera; counter-clockwise from above; top over
base; apex last; the octahedron's equator, then its top, then its bottom
apex. It is the box's textbook lettering, generalised.

*A round solid's dimension label draws its reference line* (fix wave 1,
controller's browser look). A polyhedron's dimension hangs off an edge that
is already drawn; a cylinder's radius or height had nothing, so the label was
a bare number. Now `label: C radius` draws the radius from its rim's centre
to the rim and `label: C height` the axis between the rim (or apex) centres,
split by the glass rule against the solid itself — solid where a face shows
it, dashed where the solid hides it — in the auxiliary layer, carrying the
label's identity. A cylinder's height moved from its +x surface line to the
axis to make this possible. This deliberately changed the bytes of exactly
the specs that label a round solid's radius or height (the "Cylinder" example
and three baseline specs, under every view); nothing else moved. **Extended
the same wave:** a pyramid's (square, regular or rectangle) and a pyramidal
frustum's height hangs off the axis too, so it draws its reference — base
centre to apex or top centre, dashed. A reference seen end-on (a height from
the top view) projects to a point and is not drawn. A radius, whose
direction round its rim is only a convention (local +x), turns a quarter
turn to local +z in a view that sees +x end-on (`@view: side`), so it is
always drawn; every other view keeps the +x radius byte for byte. The isometric pin for a
labelled square pyramid now asserts the new line, then checks everything
else is still exactly ee9eda2's bytes.

*Point-built solids have no named dimensions* — `label: S height` is refused,
pointing at `label: AB` — and take no `vertices` clause except a prism's new
top. *A tilted round solid refuses `cut:`/`section:`* until oblique planes
(build step 8); a vertical one off the origin is cut where it is.

**Correction to the plan, recorded.** The plan said the hexagonal prism's
long diagonal AD is not axis-parallel. Under P5's rotation for n = 6 (0°) it
runs along author X. The test keeps AD = 24 and adds BE = 24, which is along
neither axis, and checks that the camera foreshortens it.

**Not yet reachable by the tutor:** `server/src/domain/bootstrap.ts` now lags
two phases (Open items 1). The user has scheduled the tutor reference for
much later.

### Phase 8 in detail (planes as objects, and oblique sections)

Grammar that now works (author frame, z up; every plane form works in
`cut:`, `section:`, `foot … to plane` and `intersect line …, plane …`):

```
p = plane A-B-C                              # a NAMED plane: binds p, draws nothing
q = plane through O perpendicular to A-G
r = plane through P parallel to A-B-C        # ...or "parallel to p"
s = plane 2x + y - z = 3                     # must be linear in x, y, z
cut: S by plane p                            # in place, hidden outline dashed
section: S by plane M-N-L vertices PQRS      # lifted at true shape
section: C by plane x - z = 5 vertices PQ    # a region: arcs + chords, corners named
F = foot A to plane p
```

**The decisions worth not re-litigating:**

*One internal plane, canonicalised (Q1).* Every author form resolves, in the
walk, to a `Plane3` and then to a `SectionPlane` (`figure/plane.ts`): a
normal parallel to an internal axis becomes phase 5's **axis** form exactly,
`{ axis, at }`, so `plane A-B-C` through three points at z = 1 cuts byte for
byte as `plane z = 1` — the same object down the same code path. Everything
else is **general**: its point is the foot of the origin (so one plane
written two ways is one value), its normal faces the DEFAULT camera (edge-on:
author +Z, then +X), `v` is author Z projected into it, `u = v × n`. A lifted
section therefore reads upright and unmirrored, and never turns with
`@view:`. **The equation form's linearity is read off the expression tree,
exactly** (`isAffine` in plane.ts: constants, x/y/z, ±, `*` with one side
constant, `/` by a constant, `^` and calls only over constants), and only
then are its coefficients read by evaluation at the origin and unit points.
The first version probed points instead, and review round 1 showed that no
probe set is sound once functions appear: `abs(x) + y = 1` and
`sqrt(x^2) + z = 2` agree with a plane at every probe with x, z ≥ 0 and
were drawn as one.

*The winding snap.* Q1's vertex order (angle about the centroid, from
atan2's cut at 9 o'clock) is ambiguous for a vertex exactly at 9 o'clock —
and the cube's central hexagon has one. A general plane takes that vertex as
−π, so it is always P; without the snap, the sign of a rounding error made it
last. The axis form keeps phase 5's bare atan2 and its bytes.

*Polyhedra: the edge walk with a signed distance (Q3).* `normal · p − normal
· point`; for the axis form, exactly `coordinate − at`. A plane holding a
face returns the face; one that only touches a vertex or an edge is refused
naming it in author coordinates.

*Round solids: solved in their own frame, in closed form (Q4,
`figure/conicSection.ts`).* An axis plane through an UPRIGHT round solid keeps
the phase-5/7 paths (bytes); everything else — an oblique plane, or any
plane through a tilted solid — goes to the local frame, which is what lifted
P7's tilted refusal. The cylinder's ellipse is parametrised by the cylinder
angle; the cone's and frustum's come from the cone's quadratic form restricted
to the plane (centre `−M⁻¹β`, principal semi-axes from a closed-form 2 × 2
eigenproblem). **Every ellipse is trimmed by one rule**: its height is
`c.y + K cos(t − φ)`, so a cap crosses it at a closed-form pair of angles.
The solid's support range along the normal is closed form too, and a plane
at either end only touches (apex, one generator, a rim point, tangent to a
sphere) and is refused as such. Parabolas and hyperbolas are refused.

*A section can be a region (Q5).* `Section` and `TrueShape` gain `{ kind:
'region', boundary }`, chords and arcs `center + u cos t + v sin t` chaining
end to end, counter-clockwise in the plane's frame from the lowest chord. A
circle stays a circle. Lifted, a region is a new 2D item drawn through the
SAME drawn-edge union a solid's outline uses (`drawEdge`, `edgeExtremes`),
its arcs from conjugate semi-diameters by the ONE closed form —
`ellipseFromConjugates`, moved out of `projectCircle` with its arithmetic
unchanged. Its corners (arc meets chord) take `vertices`; a whole ellipse
refuses them, as a circle does.

*In-place outlines dash what the solid hides (Q6,
`figure/sectionVisibility.ts`).* The fill stays in the regions layer, now
unstroked; the outline is drawn piece by piece like a solid's edges. A side
on a face is visible iff that face (either, along an edge) faces the viewer
— projectSolid's rule; a cap chord iff its cap does; an arc on a curved side
is split where `A cos t + B sin t + C` (the outward normal is affine in the
point) changes sign. **This is the one sanctioned byte change**: the sweep
over every spec the suite parses plus every example, under all five views,
changed exactly the 30 keys holding a `cut:` and nothing else; the three cut
digests were re-pinned beside explicit dash assertions.

**Lesson 1, again.** The render test for the tilted cylinder cut by `plane x
= 0` asserted only "no errors". Deleting the local-frame transform left it
GREEN: in the wrong frame that plane is parallel to the axis and cuts a
rectangle, which is not an error. It now asserts one lifted `<circle>` and no
straight side, and goes red. **"No error" is not a geometric assertion.**

**Corrections to the plan, recorded.** The tangent-plane refusal of a sphere
changed an existing expectation (the axis path said "misses"); it now says
"touches … at one point", as Q4's table asks. `vertices` accepts two names,
since a log wedge has only two corners. Plane messages quote the author's
text ("The plane A-B-C does not cut …"), except the three-point form's
collinearity refusal, which keeps phase 6's wording ("A, M and G are
collinear") so no existing message moved.

### Phase 9 in detail (inscribed and circumscribed spheres, and tangency)

Grammar that now works (author frame, z up):

```
I = solid insphere of T                          # tangent to every face
O = solid circumsphere of T                      # through every vertex
O = solid circumsphere A-B-C-D                   # four points, not in one plane
S = solid sphere center P tangent to plane p     # radius = distance to the plane (any plane form)
S = solid sphere center P externally tangent to T   # |PT| - r_T
S = solid sphere center P internally tangent to T   # r_T - |PT|
M = center of S                                  # any sphere's centre, as a point in space
label: S radius                                  # every sphere, however placed
```

**The decisions worth not re-litigating:**

*A constructed sphere is an ordinary sphere solid (R1).* The walk places it
with the same `placed(...)` call `sphere center M radius r` uses, so it draws,
occludes and is sectioned by the existing code and is glass to every other
solid. No drawing code changed; the byte sweep proved it (below). All the
maths is in `figure/spheres.ts`.

*Polyhedra: a fixed-order linear solve, then EVERY vertex or face checked
(R3).* Circumsphere: the first four vertices in vertex order not in one plane
(scan: P0; the first not at P0; the first off line P0P1; the first off plane
P0P1P2), the 3×3 system `2(Pk − P0)·c = |Pk|² − |P0|²` (solved about P0, the
same system shifted) by Cramer's rule, then every vertex. Insphere: faces as
`n·x = d` with Newell's normal turned away from the vertex centroid (so no
builder's winding matters), the first four faces whose rows `(n, 1)` are
independent (greedy Gram–Schmidt in face order), the 4×4 system `n·c + r = d`
by Cramer's rule, then every face (the centre strictly inside, at r). A
failure is refused naming the first vertex or face that fails, by the
author's letters (the walk keeps each polyhedron's vertex names by index) or
by where it is: `"S" has no inscribed sphere — no point inside it is
equidistant from all 6 of its faces: the face DAEH is 5 from the only
candidate centre, not 3`. The four rows fix (c, r) uniquely, so a failure
proves no sphere exists; nothing is ever approximated.

*Round solids: closed form in the local frame, through the placement (R4).*
Cylinder insphere only when h = 2r; cone always, ρ = RH/(R + √(R²+H²));
frustum only when h = 2√(r₁r₂), r₁ the WIDER rim (P2's local base). The
circumspheres always exist. Each answer is checked against the points that
fix it (a rim point, the apex, the foot on the side generator). Placed and
tilted solids need nothing more; a frustum wider at the top is handled by
its reversed placement.

*R2: a sphere's radius is a named dimension however it was placed.* The
by-points rule ("measure between its points instead") exempts spheres, and
only spheres; the reference line is phase 7's radius segment with its
side-view fallback.

*Tangency is scoped to R5 on purpose.* Build step 9's "tangency" is one
object at a time — a plane, or one sphere externally or internally. Spheres
tangent to several objects at once (three spheres and a plane) are a
solver, and stay out (R7): the author places such a sphere by its computed
centre and checks each tangency with a label. Also out, and refused where an
author could ask: contact circles on a cone or cylinder, inscribed cubes and
other inscribed polyhedra, tangency assertions in the givens table, opaque
stacking.

**Correction to the plan, recorded.** The plan said replacing the insphere's
linear solve with the vertex centroid turns the AIME test red. It cannot:
AB = CD, AC = BD, AD = BC make that tetrahedron a disphenoid, all four faces
congruent (6√21 each), so its incentre IS its vertex centroid. The deletion
is caught by the face-area identity test's scalene half, the corner
tetrahedron and the square pyramid.

**Grammar note.** `M = center of S` parsed at the base as a named constant
(`center*of*S`). A construction takes precedence over a named constant, as
every construction form does; the match is exactly `center of <name>`.

**Byte identity, and how it was measured.** Every `renderFigure` input the
suite makes (captured by a scratch vitest setup file that wraps
`renderFigure`; 402 distinct) plus every example, re-rendered under its own
config and all five views — 2412 keys — before and after each task:
identical, errors included.

### Phase 10 in detail (measures and marks in space)

Grammar that now works (author frame, z up):

```
given: angle between A-C and B-G                 # the ACUTE angle between the lines, skew allowed: ∠(AC, BG)
given: angle between A-G and plane A-B-C         # line–plane, [0, 90], any plane form: ∠(AG, ABC)
given: distance between A-G and B-F              # skew, parallel, or 0 where they meet: d(AG, BF)
given: distance from G to plane B-D-E            # d(G, BDE)
given: distance from G to line A-B               # d(G, AB)
given: dihedral A-B-C-G = 90                     # edge = the middle two names; ∠A-BC-G; asserts
P, Q = common perpendicular of A-G and B-F       # P on AG, Q on BF, PQ square to both
angle: A-B-G [label: θ]                          # an arc in the angle's plane, projected
label: angle ABG                                 # the arc, and the TRUE angle on it
right-angle: A-B-G                               # a square in space — refused unless 90 (@scale: false lifts)
tick: A-G count: 2                               # in the picture plane, at the projected segment
dihedral: A-B-F-G                                # the plane angle at the edge's midpoint
label: dihedral A-B-F-G                          # the value on the mark
```

**The decisions worth not re-litigating:**

*Marks live in the angle's plane in space, then project (M1).* An arc is
the circle arc centred at the vertex in the plane of the three points,
radius 0.2 × the shorter arm in WORLD units, drawn through `projectCircle`
as one elliptical-arc command — never a polyline, and never the 2D sweep of
the projected rays (which puts the ends in the wrong place wherever the
camera foreshortens an arm: the test that pins this went red when the arc
was drawn in the picture plane). A right angle is the square B, B + s u,
B + s u + s v, B + s v with s = 0.15 × the shorter arm, drawn as its
projected "L", the plane's convention. A tick is the exception on purpose:
it annotates the drawing, so it is drawn in the picture plane by the 2D
convention. All of it is `figure/spaceMarks.ts`.

*Right angles in space are asserted (M2).* A projected square on a
non-right angle states something false that no reader can check by eye,
so `right-angle:` on points in space refuses unless the true angle is 90
("A-B-D is not a right angle — its true angle is 45°", always in degrees).
`@scale: false` lifts it, as it lifts every measure assertion. The plane's
`right-angle:` is unchanged and unchecked.

*M4 — why a small mark is decided whole, by its middle.* A construction
segment is split exactly, as every segment in space is (`segmentSpans`) —
a dihedral's two segments included, and a test with a second solid in
front of part of one proves the split (it went red when the segments
were classified by their midpoints). An arc, a right-angle square and a
tick are a few millimetres of ink: splitting one where an outline crosses
it would draw a dash-and-a-half that reads as noise, and where a projected
elliptical arc crosses a silhouette is not a closed form this code has.
So each is drawn entirely visible or entirely hidden, decided by ONE
point — the arc's middle, the square's centre, the tick's point on its
segment — tested with `hidesPoint` against every solid. It is a stated
drawing convention, not a geometric answer; the grammar header says so.
Two consequences to expect: an arc on a hidden face, or inside a solid
(the angle ABG of a cube, whose plane is a diagonal section), is dashed;
and **a convex solid's dihedral arc always lies inside the solid, so it is
always dashed**, while its segments on front faces draw solid.

*The dihedral (M3).* `dihedral C-A-B-D` is the angle in [0°, 180°] between
the unit components of C − M and D − M square to AB, M its midpoint
(`construct3d.ts` `dihedral3`). **The perpendicular step is the whole of
it**, and the plan's proof of it could not work: in the AIME prism A and G
already lie in the plane through M square to BF (A is on the hexagon's
axis of symmetry through M), as the regular tetrahedron's and
octahedron's ends do. The cube's A-B-C-G, and an asymmetric hand case,
catch the deletion instead. The mark's segments are l = 0.3 |AB| long
**but never longer than either end's distance from the line AB** (plan
correction): 0.3 |BF| = 6.24 in the AIME prism while A is 6 from BF, so
the segment toward A ran out of the prism past its vertex A as a visible
stub. Capped, it ends at A. It caps LENGTH only: it does not keep a
segment inside its face (a face can be narrower at M than its end point
is far from the edge).

*Measures between lines and planes are table rows only (M5).* None has
one point to hang a label on, so `label:` refuses them at parse time,
pointing at the table or at drawing the construction. A measure's plane
is resolved by the solid-figure walk in source order (`measurePlanes`,
keyed by the parsed plane form object), so `plane p` follows `p = plane
…`. A plane equation carries its own "=": with two, the last asserts;
with one, it belongs to the plane when an equation side precedes it.

*The common perpendicular (M6)* is Cramer's rule on the two normal
equations (`commonPerpendicular3`), which returns parallel and meeting
lines as values, not throws: the walk words them, naming the meeting point
in author coordinates, because `construct3d.ts` knows no frame.

*Out of scope, refused in words (M8):* angle marks between skew lines
(`angle: between …` — no vertex; for a line and a plane, drop the foot F
and mark `angle: A-P-F`), the angle between two planes as such (write the
dihedral), line–plane distance, areas and volumes (`label: S volume`),
exact values, nets.

**Sanctioned byte changes.** Two phase 6 tests pinned refusals that phase
10 lifts, and were rewritten, each saying so: `label: angle ABG` on a box
now draws its arc and prints 90°, and a tick naming a vertex and a plane
point is now refused for mixing the two (its SVG is byte-identical; only
the error's words changed). The plane-only refusal no longer lists angle
marks and ticks. **Byte identity, measured as in phase 9** (a scratch
vitest setup file wrapping `renderFigure`: 431 distinct suite inputs under
their own config and the five views, plus the 73 examples under six view
settings and both palettes): every other digest identical after each
task, errors included.

### Phase 11 in detail (nets and shortest paths over a surface)

Grammar that now works (author frame, z up):

```
net: S                                   # S unfolded flat, lifted beside it (any prism, pyramid,
                                         #   tetrahedron, octahedron, frustum, cylinder, cone)
shortest: P to Q over S                  # the shortest path over S's surface, P and Q points on it
shortest: P to Q over S unfold           # polyhedra: also lift the strip of faces it crosses
label: shortest P to Q over S = 40       # its length on the path; asserts
given: shortest P to Q over S            # a table row (and find:)
```

**The decisions worth not re-litigating:**

*A net is 2D geometry from a TEMPLATE (N1, N2; `figure/nets.ts`).* Each
primitive has one face tree written down — root, and which face hangs off
which along which edge — read off its lettering (`labelOrder`). Every face
is laid out SEEN FROM OUTSIDE in its own chart, and a child is placed by
the one rigid motion putting its shared edge on its parent's copy (the
fold into the parent's plane, done in the plane). Folds are the tree's
edges (dashed, auxiliary layer); every other face edge is a cut (solid).
A vertex copy is a class of (face, vertex) pairs joined across folds, and
its letter is a DISPLAY label (`netLabel` item), never a named point.
Round solids unroll in their local frame, the seam along the generator
directly away from the DEFAULT camera, rims tangent at the middles of the
edges they fold on.

*Lifts stack (N1).* `liftOffset` takes the running right edge of every
earlier lift (sections, nets, path unfoldings), in statement order. With
no earlier lift the arithmetic is phase 5's, so every single-lift spec kept
its bytes.

*Shortest paths over polyhedra are an exact enumeration (N3,
`figure/shortestPath.ts`).* Every simple face sequence from a face holding
P, depth first in face order, ending at the first face holding Q; each is
unfolded in closed form (the nets' machinery) and valid only when P'Q'
crosses every shared edge in order within it; the least valid length wins,
ties to the first found. Faces a path only touches at an end are trimmed.
At most 12 faces (about 13 ms for a decagonal prism, the worst case).
Drawn on the solid piece by piece under the glass rule, and with `unfold`
straight across the lifted strip, turned so the path runs left to right.

*Round solids are closed form on the unrolled side (N4).* Cylinder:
min over k of hypot(ds + 2 pi r k, dy). Cone: alpha = |d theta| r/l wrapped
modulo the sector the short way, then the law of cosines. **No
through-the-apex branch**: the short way is at most pi r/l < pi. A frustum
path passing inside the top rim is refused. Drawn only on the lifted
unrolling — the net's own, cut behind (fix round 1), so the generator facing
the viewer is its middle and P and Q sit where the net puts them; a path
crossing that seam is drawn as two straight pieces (a tie, exactly half a
turn round, goes the way that stays inside, which keeps the AIME path one
piece). P and Q are drawn by their own statements; no geodesic in space.

**Corrections to the plan, recorded.**
- *No template net reachable from the grammar can overlap.* The plan
  expected an obtuse six-edge tetrahedron's star to; it cannot — any two
  lateral faces share a base vertex whose base angle and two face angles
  sum below 360°, so their wedges there are disjoint. Right prisms, the
  regular frustum and the octahedron are fixed shapes, and 20000 seeded
  pyramids on points never overlapped. So there is **no runtime overlap
  check** (fix round 1): as phase 5 did for convexity — an unreachable
  runtime guard replaced by a pinned invariant — `nets.test.ts` checks
  every template the grammar can produce (every dimension primitive over a
  spread of n and proportions, seeded six-edge tetrahedra with the obtuse
  one, seeded prisms, pyramids and tetrahedra on points) with an EXACT
  test-only separating-axis predicate (`figure/net.testkit.ts`: positive
  area overlaps, touching along an edge or at a point does not), itself
  proven on hand-built faces — including two squares offset along an edge,
  which the first, runtime version wrongly passed.
- *The octahedron's strip alternates upper and lower faces in pairs*
  (L0 U0 U1 L1 L2 U2 U3 L3): single alternation has no chain.
- *The validity check's test* could not use a regular solid: a scratch
  search found invalid-but-shorter unfoldings only on frusta and irregular
  hulls. The test is a square frustum on points, from a top corner to a
  point on the same side face (1.5 exactly), where the chain round the top
  puts Q' 1.12 away.
- *Points half a turn apart cannot pin the shorter wrap on a cone*: both
  ways round are equal there. That test stays (it pins the largest
  separation, 4π/5 < π), and a three-quarter-turn test pins the wrap.

**Fix round 1.** No runtime overlap check (above). A net or a path's strip
reserves label clearance in its gap (`NET_LABEL_CLEARANCE`: 10% of the
size the figure is fitted to — the larger of its width and height, fix
round 2 — so about 64 view units at any scale and aspect: the cube's G no
longer runs into the net's E, nor a tall prism's letters into its strip's); sections keep phase 5's quarter-width gap,
bit for bit. The running lift edge advances only once a section is drawn. A
later `shortest: … unfold` of a path already drawn lifts its strip; a
polyhedron path lifts nothing unless asked (P = Q included). The round
path's unrolling is the net's (above). `turned` turns an arc's angles with
its centre. **Fix round 2:** a path from a cone's apex (a named apex carries
rounding, so within the tolerance) runs down one generator to where the net
puts the other end, in one piece; an end exactly on the seam is dotted on
the cut edge its path leaves from; the test-only overlap predicate's
tolerance is relative to the faces' own extent.

**Grammar notes.** A bare `net S` is still refused, now pointing at the
colon. `net = 5`, `net(x) = x^2`, `net + x = y`, `shortest = 3` and the
like parse exactly as at base (in the byte sweep and the tests).

**Byte identity, measured as in phases 9 and 10** (a scratch vitest setup
wrapping `renderFigure` and `parseStatement`: 516 distinct suite inputs
under their own config and five views, the 78 pre-existing examples under
six view settings and both palettes, 1364 parsed lines plus the constant
lines): 5509 keys, and after every task exactly two differ — the parse of
`net: S` and `net S`, the sanctioned phase 8 refusal lines.

### Phase 12 in detail (shading and shaded regions)

Grammar that now works (the plane; see the grammar header in
`parser/types.ts` for all of it):

```
fill: A-B-C                                  # polygon by named points; also polygon/triangle/square/rectangle
fill: circle O                               # the disk of a named circle
fill: sector P-Q on O minor                  # and segment P-Q on O <dir>
fill: square ABCD minus circle O name: R     # minus | and/intersect | or/union, left to right, parentheses
fill: (circle O or circle P) minus triangle ABC
label: area R                                # exact area, computed, printed inside the region
given: area circle O and circle P            # inline expressions work too (and find:)
```

**The decisions worth not re-litigating:**

*An exact region engine, not SVG masks (F1–F3, `scene/geometry/regions.ts`).*
A region is closed loops of segments and circle arcs, outer loops
counter-clockwise and holes clockwise, so the interior is always on a
piece's left. Booleans split both boundaries at every closed-form meeting
point (plus every end of one lying on the other — that is how coincident
overlaps are found), classify each piece by its midpoint (an exact winding
number; ON only for a coincident piece, whose side is read off the
direction of travel), keep per the F2 table, and chain and merge. Area is
the shoelace plus each arc's ½r²(θ − sin θ). Masks were rejected (ledger
ruling): not testable in node, no area, and mask ids collide between two
figures on one page. `intersect.ts` is not reused: its tolerances floor at
an absolute 1 and it throws on overlaps a boolean needs as values.

*The winding number reads one cross product.* The chord angle and the
"inside the circular segment" test both read cross(b − a, p − a), so a
point a rounding error off an arc's chord gets one answer from either
side; a point exactly on the chord inside the circle is swept half a turn
the way the arc runs. A scratch fuzz (inclusion–exclusion identities over
64k random polygon/disk/sector/segment pairs, on and off a grid) found the
exact-chord case; it is pinned by a test on a hole, where the sign of zero
went the wrong way.

*Where loops touch, the chain stays on the loop it came from* (else the
sharpest left turn). A circle inscribed in a square is one square and one
hole touching at four points — which F5's path test and F6's anchor both
assume — and two disks touching from outside stay two loops, not a figure
of eight. Both alternatives were tried and each breaks one of the two.

*F5: one path, no outline.* `svgClosedPaths` in `svg.ts`: per loop `M`, `L`
per side (the last side is the `Z`), `A` per arc (a whole turn is two),
`fill-rule="evenodd"`, `REGION_OPACITY`, the `color:` clause (the theme's
region colour otherwise, the same string a sector uses). The author's own
lines draw the edges. The existing `sector`/`segment` statements are
untouched.

*Areas assert at the one shared tolerance (fix round 1).* The first
version gave areas their own absolute tolerance (half a unit of the printed
third place) so the plan's `label: area R = 3.434` would pass for 16 − 4π.
Review round 1 refused it, and the controller ruled: ONE tolerance rule for
every measure assertion. It contradicted `checkMeasure`'s own policy (an
absolute tolerance accepts wrong figures drawn small — an area of 0.0003
stated as 0.0007 passed) and made areas inconsistent with lengths
(`label: AC = 5.657` for 4√2 is refused). Now `= 3.434` is refused for
16 − 4π, naming 3.434; the examples use `label: area R` (computed), and
the square example also writes `given: area R = 16 − 4π`, a SYMBOLIC
value, printed as written and not checked. Asserting an exact expression
against the value belongs to build step 3 (exact values), engine-wide.

*F6: the label sits ON a point inside the region.* The largest component
(holes assigned by a point strictly inside each hole, since a hole may
touch its outer loop), seven horizontal lines at i·h/8, the longest inside
chord's midpoint, ties to the lowest line then the leftmost. The layout
always offset a label from its anchor, so `labels.ts` gained an opt-in
`centred` candidate (the anchor itself, first), set only by area labels —
every other label lays out exactly as before.

*Names use `name:`,* never `R = region …` (space owns that form). `name:`
stays a group name (fix round 1, ruling): fills may share one and all draw
(`@hide` hides them together), and measuring a shared name is refused as
ambiguous, naming the fills. A hidden fill still names its region; when a
named fill was refused, `area R` says "was named, but its fill was refused:
<reason>" rather than "unknown". `square`/`rectangle` are asserted like
`right-angle:` in space, lifted by `@scale: false`.

*Fix round 1, the minor items.* Boundaries a tolerance or two apart that do
not meet (a circle 5e-9 wider than a square's inscribed one) used to surface
an internal "does not close at (…)"; assembly now returns null and
`combineRegions` refuses in the author's words ("… has boundaries too close
to tell apart"). F6 merges inside chords meeting at a point where the
boundary only touches the line: a disk r = 2 minus a disk r = 1 at (1, 0)
anchors at (0, −1), not (−0.366, −1); the annulus and square-minus-circle
anchors are unchanged. The lens's and the annulus's exact path strings are
pinned, so an arc's direction and flags are tested. `area R < area S` says
relations between areas are not stated yet — and, since fix round 2, so
does `area R = area S` (it printed "area S" as a symbol before). Fix round
2 also pinned the other half of the F6 merge: when a merged chord's
midpoint IS the touching point, its parts stand as chords of their own (a
small disk or a triangle's tip touching a line of a rectangle from above
anchors on the next line up, never on the hole's boundary).

**Byte identity, measured as in phases 9–11** (a scratch vitest setup
wrapping `renderFigure` and `parseStatement`: 551 distinct suite inputs
under five views, the 78 pre-existing examples under six view settings and
both palettes, 1652 parsed lines plus `fill = 3`, `fill(x) = x^2`,
`fill + x = y` and similar, and three graph specs using `fill` as a
constant): 5384 keys, 0 differ after every task.

### Track 3 — space (S1–S6, the integration pass, and the milestone gate fix, 2026-09-26/30)

*Written after the integration pass. Branch `milestone-a/space`, worktree
`.claude/worktrees/milestone-a-space`, review server on **5182**.*

**Space is a hand-made WebGL2 engine** (spec, Track 3 "Revised 2026-09-26":
the three.js decision was reversed for space only; the 2D plot renderer keeps
three.js, and solid figures are SVG). What an author writes goes:

```
parseSpec ── space/grammar/ (keyword rows, unkeyed forms, directives, @param)
   │           claims only space lines; returns null for anything else
   ▼
space/kernel/  createSpaceKernel: one builder per form via registry.ts,
   │           typed arrays, two passes (the box pass, below), setValue
   ▼           rebuilds only what a binding touches
SpaceScene     marks (mesh, lines, points, arrows, boxes), labels, colour
   │           scales, extent, errors: plain data, backend-agnostic
   ▼
SpaceRenderer  frame/ (box, aspect, ticks, walls), camera/ (turntable),
   │           pick/ (CPU rays re-evaluated on the true function), ui/ (DOM
   ▼           overlay, readouts, pins, parameter panel)
space/gl/      the only WebGL: frame loop, MSAA, OIT, lines as quads
```

**What each phase delivered** (each: one implementer, an independent review,
fix rounds until clean):

| Phase | Commits | Delivered |
|---|---|---|
| S1 | `bbed1b7`..`0bce803` | `math/` (compile, diff, simplify, roots, quadrature, linalg), the space grammar hook, domains and style clauses, `@param`, the `SpaceScene` contract, kernel builders for the old forms, the boundary test |
| S2 | `dd737c3`..`f023bea` | `gl/` backend, camera, frame (box, axes, none), DOM overlay; `SpaceRenderer` replaced `SceneRenderer3D`; `review/space.html` |
| S3 | `a45e5dc`..`bec5d12` | colormaps and colorbar, mesh lines, back-face tint, box clipping, hidden-line dashes, weighted blended OIT, depth cue, MSAA; probe, pins, drop lines; parameter panel, play, drag; events |
| S4a | `174ca39`..`b1f32c3` (merge `de551e2`) | implicit and level surfaces by marching tetrahedra, lines, planes, cross and projection, cylindrical and spherical coordinate surfaces, TNB frames, osculating circle, motion |
| S4b | `8498899`..`d81fa5c` (merge `c9482c3`) | level curves, paths, traces, tangent planes, gradients, directional derivatives, classified critical points, Lagrange (2 and 3 variables) |
| S5 | `a0207ca`..`95ea254` (merge `eed87a1`) | regions (type I/II, polar, inequality, named), volumes under and between surfaces, Riemann boxes (the box pipeline), triple integrals in three coordinate systems, centroids. **Its fix round 3 (honest quadrature error by construction) merges over this later.** |
| Integration | `fe4cc5b`..`daccc28`, then the docs commit | contour dispatch by arity and level surfaces for S4b; coordinate and gradient readouts; scientific notation in the shared tokenizer (open item 4); boxes in the frame loop (opaque pass, OIT); the box pass |
| S5 fix rounds 3–5, breaker ruling | merge `59bdf64` | Honest quadrature error by construction; `S5_SAFETY` = 100 on the digits a readout shows (1 for a bounded mesh sum's own error, a direct measurement across resolutions rather than a heuristic decay estimate); thin inequality regions resolved where honest or refused where not; the one-honest-digit fallback for when SAFETY's own search finds no unit at all. |
| S6, visual polish | merge `64b076b` | V1–V11 (flat-scene z boxes, label collision layout, the on-figure display-digit cap, OIT depth weight, draggable-point halos, quieter Riemann-box lattices, dark-theme contrast, held-resolution meshing while dragged/scrubbed/played, chrome fixes) and fix round 1's I1–I7/C1/M1–M6 corrections — see "Open, for S6 and after" below. **The milestone gate review then found three real bugs in S6's own work (the display cap could show a digit the true value contradicted; a small held-resolution surface could vanish entirely rather than mesh coarser; a test helper had stopped checking the on-figure text) — fixed in the same commit as this handoff update; see "Open after the milestone gate fix" below.** |

**The box pass (integration J1) is the contract most likely to bite.** The
kernel builds in two passes: statements that define the scene first; then the
box is resolved from their extent with `frame/bounds.ts` `resolveBox` (the
renderer's own function), and box-dependent statements build against
`context.box` (`registry.ts`: `boxDependent`, `boxOf`; the list is at
registration in `kernel/index.ts`). Box-dependent: implicit and level
surfaces, contours, `line:`, `plane:`, coordinate surfaces, `frame:`, every
S4b tool, `centroid:`; `region:` by its z only; and a coordinate surface
only when a defaulted r, ρ or z range reads the box (`spherical: rho = 2`
sizes the box itself). A tool draws into `toolBox(context, rect)`: its `over`
rectangle (else the box's x and y) by the box's z; back-wall copies go on the
frame's own wall. `scene.extent` is the first pass's extent, so the
renderer draws the same box **by construction** — clipping dependent marks
would not be enough, because rounding a wider extent can pick a coarser step
(pinned in `kernel/boxPass.test.ts`). During play and drag the renderer passes
its frozen box (`setValues(values, { holdBox })`). Consequences worth knowing:
a tool drawn alone gets `@bounds3d` or [-5, 5]³, so tools are meant to sit
beside the surface they describe (every example does); Riemann boxes and
volume bottoms start at z = 0, the integral's zero, not the floor.

**How to verify space.** Node tests cover everything but pixels (the GL layer
through a recording fake context, `gl/fakeGl.ts`). Pixels are checked by
**headless Edge screenshots from PowerShell**, never the browser pane (each
load asks the user to approve the site) nor Chrome:

```
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -Wait -NoNewWindow -ArgumentList @("--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=`"$env:TEMP\claude-headless-x`"","--window-size=1400,900","--virtual-time-budget=7000","--screenshot=`"<out.png>`"",'"http://100.90.203.2:5182/space.html?example=<slug>&theme=dark"')
```

then Read the PNG. `?spec=<url-encoded spec>` loads any spec. The slug is the
example label without "Space · ", lower-cased, non-alphanumerics to `-`.

**Lessons from track 3 worth keeping.**

- **Merge seams should be named in the plan, with a named owner.** S4a, S4b
  and S5 ran in parallel and each left a stub for the others (a registered-by-
  name contour builder, a null level-surface mesher, an interim box draw);
  the integration plan listed every one, which is why wiring them took hours,
  not a redesign. Ledger "merge notes" were the source.
- **A per-tool box estimate is the wrong seam.** S4b's tools each estimated
  the frame's box from their own target; with two surfaces the floor was
  wrong. The fix was structural (the box pass), not per tool.
- **"The renderer resolves the same box" is only true by construction.** The
  plan argued clipping would suffice; a hand-worked counterexample (x over
  [0.19, 2.71]) showed a plane spanning the box would move it. Test the
  argument, not only the code.
- **Wall-clock asserts flake on a shared machine.** Other agents' suites and a
  sync client push a 250 ms test past a 1 s bound (S5's round 3 replaces them
  with evaluation counts). Prefer counting work.
- **`Math.max(...array)` throws past ~120k arguments.** A constraint mesh at
  res 120 crossed it; take extremes in a loop over anything mesh-sized.
- **Fake-GL tests pass for the wrong reason easily** (S3's I4: extensions not
  re-enabled after a restore, yet the test passed). The fake now turns
  extensions off on a loss, as a real context does.
- **Shared-tokenizer changes need a byte-identity sweep over every literal,
  not only the examples.** The scientific-notation sweep (5818 literals, every
  figure example under every `@view`) found only test titles changed.

**Open, for S6 and after** (from the phase ledgers and the integration pass's
headless shots of every example, light and dark). **S6 (2026-09-30) closed
every item below**, then an Opus phase review of the whole diff found real
bugs in several of the first pass's own fixes — **fix round 1 (2026-09-30)**
corrected those (marked below); see the plan,
`docs/superpowers/plans/2026-09-27-space-s6-visual-polish.md`, for V1–V11,
and its fix-round-1 brief for I1–I7, C1 and M1–M6.

- **Nothing is broken.** Every one of the 49 space examples (40 in
  `examples.ts` + 9 in `surfaceToolExamples.ts`) draws, in light
  and dark (integration pass, 2026-09-27). What follows is ugly, not wrong.
- **A scene whose only data is flat has an empty z axis.** A lone `region:`
  (A polar region, The centroid of a half-disc) sizes x and y, and z falls
  back to [-5, 5] by the box pass's rule, so the region lies on the floor of
  a tall empty box with meaningless z ticks. Flat vectors (Projection of u
  onto v) get the opposite: a thin [0, 1] z. S6 should decide what a flat
  scene's box is (a flat box, or no z ticks).
  **Fixed (V1):** a flat scene gets a thin z box (half-extent 0.15x the
  larger x/y span under `auto` aspect) with one z tick at the data's value;
  an authored `@bounds3d z` still wins.
  **Corrected in fix round 1 (I1):** the first pass could flatten an axis a
  statement not yet built still needed — an implicit surface, a plane, an
  S4b tool — carving a sliver from geometry that is not flat (a sphere plus
  two points at z = 0, say). The kernel now reports, all-or-nothing, whether
  any fully box-dependent statement is in the scene at all (`boxSpanning`,
  kernel/index.ts) — not which axes it occupies, since a statement built
  against the resolved box in full cannot be assumed to leave any one axis
  alone before it has actually built — and flatAxes leaves every axis alone
  whenever it is; a centroid's own drop-line decoration is exempted
  (`flatExempt`), since it adapts to whatever box there is rather than
  needing it tall. **Confirmed in fix round 2** with a spec-driven kernel
  test (a sphere plus two points at z = 0, through `createSpaceKernel`
  itself, not a hand-built `boxSpanning`): `scene.boxSpanning` comes back
  `{ x: true, y: true, z: true }`, and the resolved box keeps z's real span.
  **Also fixed (M1):** the flat tick's single label used the step ladder's
  own decimals (`0.00` for a value the ladder was never built to show); it
  now uses the value's own digits, up to 4 significant. A lone region's tick
  now sits at the box's floor, where the region actually shades, not the
  box's arbitrary centre.
- **Readouts collide** with tick labels and each other: the two gradient
  readouts run into the x ticks; the half-disc's centroid and area readouts
  overlap; level-curve labels crowd a saddle point. Readouts need the same
  collision layout as tick labels.
  **Fixed (V2):** one label placer (`ui/labelPlacer.ts`, pure) places every
  tick, point, readout and contour label by priority; a label that fits
  nowhere is dropped, except a readout.
  **Corrected in fix round 1 (I3):** the first pass gave a contour's value
  label the same priority and "never dropped" guarantee as a readout, so it
  could permanently outrank and block a point label; its own fallback, when
  every candidate within 60 px was blocked, reused `candidates[0]` — the
  very spot that had just been rejected; and a readout placed 26–60 px out
  (a normal fit, not the fallback) got no leader at all. Now: a contour
  label is its own role, ranked under a point label and dropped like one,
  never force-shown; an exhausted readout searches out to 120 px for the
  least-overlapping spot instead of reusing a blocked one; any readout
  landing more than 14 px from its anchor gets a leader, whichever way it
  got there. (Also, M2: the placer sizes a currently-expanded readout — one
  a click opened to its full digits — from that full text, not its capped
  display, so expanding one in place cannot silently overlap a neighbour.)
- **S5 readouts print many digits** (`∬ ≈ 25.1327412287`,
  `area ≈ 0.166666666667`): honest to the error estimate, heavy to read.
  **Fixed (V3):** integral readouts are capped at 6 significant digits
  (hover readouts stay at 4) in `kernel/integrals/common.ts`, through
  `chosenDisplay` — the same function that picks the honest, SAFETY-checked
  digit count in the first place, asked to search no finer than the cap; the
  cap is a display choice enforced by re-checking S5's own half-unit rule at
  whatever coarser unit it settles on, not a claim that truncating an
  already-rounded value's digits is automatically honest (an earlier draft
  of this note made exactly that claim, and it was false — see the gate
  fix's C1 below). What a click expands is the on-figure annotation label
  itself, to every digit its estimate supports, not a separate "pinned
  readout's box".
  **Corrected in fix round 1 (C1):** a rebuild where the capped text stayed
  the same but the full digits moved left an expanded label showing the OLD
  value's digits (labelPool.ts's fullText-changed branch skipped its own
  text write whenever the capped text hadn't changed); it now always writes
  the current capped text there, so the toggle can never show stale digits.
- **A translucent sphere under OIT is a flat tint.** "Lagrange in three
  variables" first showed a flat grey ball: that was a double draw (a
  hand-drawn sphere left from before S4a, coinciding with the tool's own
  constraint mesh), since removed. Re-shot alone, a single translucent sphere
  (`x^2 + y^2 + z^2 = 9 opacity: 0.35`) reads as a tinted ball with the walls
  showing through; its shading is flat, since OIT averages its front and back
  faces. Not a bug; a look S6 may want to strengthen.
  **Fixed (V4):** back faces contribute at half weight in the OIT
  accumulate, and the OIT depth weight's z is normalised by the box's own
  depth range, so nearer layers dominate as intended.
  **Corrected in fix round 1 (I2): the first pass's normalisation had no
  actual effect.** It divided the raw eye-distance z by the box's own depth
  span without first making z relative to the box's near edge; at this
  renderer's scale the eye sits several box radii back, so that ratio never
  dropped below about 1.5 for any fragment in the box — every one clamped
  to the same floor weight regardless of depth, same as the literal-200 bug
  it replaced. Now normalises the way depthCue() already does: zRel =
  clamp((z − u_cueRange.x) / depthSpan, 0, 1), weight = a · max(floor, peak
  · (1 − zRel)³ ) — a genuine near > mid > far ordering, checked through
  markLook's real cueRange for both projections. **Fix round 2** found that
  check only ever exercised oitWeight()'s TypeScript mirror of the formula,
  never the shader source itself — deleting the "− u_cueRange.x" straight
  out of the GLSL (mesh.ts, box.ts) left every one of those tests green.
  oit.test.ts now also asserts the shaders' own zRel line contains it.
- **A draggable point is easy to lose**: a small dot on a dark underside
  (Drag a point on a paraboloid, A tangent plane you can drag). Give
  draggable points a halo.
  **Fixed (V5):** a draggable point draws at 1.5x size with a 2 px
  background-colour halo and a thin ink ring, and the cursor becomes
  `grab`/`grabbing` over it; hovered and pinned markers get the same halo,
  and every point gets a 1 px background-coloured outline so it reads on
  any surface. (M3: the halo band itself is 2 px, past the 1 px outline
  every point already draws — the phase review's own comment fix, no
  behaviour change.)
- **A hole at a pole leaves sliver triangles** (Limits along two paths, at
  the origin).
  **Withdrawn (V8; see fix round 4 below).** The first attempt dropped
  triangles near a removed (non-finite) vertex whose smallest
  parameter-space angle is below 3 degrees, or whose area is below 1e-4 of
  a cell, after the hole is cut, keeping the mesh manifold elsewhere ("A
  pole cut by the box", `z = 1/(x^2+y^2)`).
  **Corrected in fix round 1 (I4):** the first pass paid the full check
  (a median, a Set lookup and a trig call per candidate) on every mesh even
  with no hole to filter (2.56 → 6.65 ms at 128²), and produced false drops
  on a strongly anisotropic domain — a 20:1 aspect lost 128 well-shaped
  cells, because angle and area were measured in raw (u, v) units, not the
  grid's own index space. Now returns early with no hole edges at all, and
  computes its median from area alone (the full angle-and-area shape runs
  only for candidates actually on the hole's boundary).
  **Corrected again in fix round 2 (NB4):** that median was a per-candidate
  edge sample sorted with a boxed comparator — at 128² with a hole, 12.5–
  16.8 ms against a 7.9 ms base. Replaced with one first-cell (u, v) delta,
  read directly off the mesh's own topology instead of sorted from every
  candidate — but that delta is a genuine (u, v) value, and on a domain
  that is not a plain rectangle (a polar one; a "type I" region whose
  y-span closes to nothing at one x) it can be almost entirely a cross
  term, inflating the estimated scale 77x or more and dropping good
  triangles at a hole's edge.
  **Corrected again in fix round 3:** angle and area are no longer measured
  in (u, v) at all, nor by any estimated step from it. Every parameterized
  mesh here comes from `gridIndices`' one two-triangle-per-cell topology
  (`mesh.ts` `rowWidthOf`), so each vertex's own (i, j) is read off its flat
  index directly — a uniform integer lattice by construction, so its shape
  never depends on how the domain curves. A mesh whose topology does not
  fit that convention (a hand-built fixture) falls back to raw (u, v)
  units, unchanged from before any grid-step normalisation existed.
  **Withdrawn in fix round 4.** Round 3's own grid-index reading turned out
  unsound too, on a mesh an inequality condition (`over ...`) clips: its
  re-triangulated boundary cells do not carry the two-triangle-per-cell
  topology the row-width reader assumed, misread as an enormous row width
  that collapsed every hole-edge triangle onto one row — every one
  "collinear", so every one dropped (`z = sqrt(x^2+y^2-1) over y <= x` fell
  from 8890 triangles to 8856). Rather than a fourth reading, the filter
  itself is gone: `finishMesh` once again only ever drops a triangle
  touching an invalid vertex or one genuinely degenerate in world space,
  as it did before V8, at every resolution and on every domain. The
  reasoning: a rectangular or iterated parameterized mesh only ever hands
  this pass one of `gridIndices`' own two canonical cell triangles, which
  is always exactly 45°/45°/90° in grid-index terms — there the filter
  could only ever misfire, never actually catch a sliver, at a real cost
  (~3.7 ms per holed mesh at 128²). That guarantee holds only for those
  grids: an inequality-clipped cell (`over ...`) is re-triangulated and is
  not one of those two canonical shapes, and there V8's original filter did
  drop one real, genuine clipped triangle, not only slivers — 549 triangles
  fell to 548 under it. And dropping a genuinely clipped boundary triangle
  opens a gap in the surface, which is worse than the needle it was
  removing. The origin artefact in "Limits along two paths" that V8 was
  first written for is now understood as shading near a removed vertex,
  not a needle — parked for track 5, not fixed here.
- **Riemann boxes' edges seen through translucent boxes make a busy lattice.**
  **Fixed (V6):** translucent Riemann box edges draw at 0.35 opacity and
  1 px and are excluded from the hidden pass, so the lattice quiets down;
  mesh lines generally mix toward the theme's ink (light) or background
  (dark) at a strength tuned per theme. (No correction in fix round 1.)
- **Dark theme:** the balance map's neutral centre nearly vanishes (S3,
  parked); grey operands (`project:`, `cross:`) are low-contrast; mesh lines
  mixed toward the light ink are loud.
  **Fixed (V7):** the balance map's neutral centre is theme-aware (Oklab
  L ~= 0.62 in dark, 0.92 in light), keeping symmetry.
  **Corrected in fix round 1 (I5):** the operand/construction grey still
  resolved to its own hard-coded hex pair (0x6b6b63 / 0xa8a89e) — a second,
  undocumented grey alongside the host's own `--muted` token, exactly what
  S6's "colours come from the theme" constraint rules out. It now resolves
  to `palette.muted` directly (5.39:1 light, 6.17:1 dark against the
  background — a healthier margin than the fixed hex it replaced).
- **V10 chrome — three more bugs the phase review found (fix round 1, I6),
  none flagged by the first pass:**
  - A colorbar's tick labels sit outside `.space-colorbars`' own measured
    box (SpaceView.css's `right: 18px` places them past
    `.space-colorbar-body`, and an absolutely positioned child never grows
    its parent's box), so the label placer's chrome obstacle under-reported
    how far left the chrome actually reached. Fixed: the obstacle is now the
    union of the container's rectangle and every one of its tick labels'.
  - Hovering the parameter panel open or closed happens entirely inside its
    own DOM listeners, with no way for the renderer to know its rectangle
    just moved — so the cached chrome rectangle (S6's own carried item b)
    went stale and no frame was requested to re-lay labels out against it.
    Fixed: a `chromeChanged` callback drops the cache and asks for a frame,
    and `updateColorbars()`/`setBindings()` drop it too, so a moving
    colormap domain or a renamed parameter also re-measures.
  - The hover probe's own readout box counted as a chrome obstacle, so a
    tick label could blink in and out as the box passed over it while
    hovering. Fixed: only a *pinned* readout is an obstacle now.
- **Parked in the phase ledgers:**
  - OIT depth-weight normalisation (S3 M10) — **fixed for real in fix round
    1**; see V4 above (the original "fixed" claim did not hold).
  - corner labels (S3) — **fixed**: V2's placer resolves the corner
    duplicate as part of tick-label thinning.
  - implicit surfaces cost ~0.5 s per setValue at res 64 (S4a) — **fixed
    (V11):** held at res/2 while dragging or playing (~11.5 ms vs.
    59–66 ms at full res), with one full-res rebuild forced on release.
    **Extended in fix round 1 (I7):** a 3-variable `contour:` (a level
    surface) marches the same way but had not been given this treatment;
    it now has. Scrubbing a parameter slider — not only a play or a
    point-drag — now counts as held too (from the first `input` event
    until the interaction ends), so a box-dependent statement bound to a
    slider meshes coarser while the reader is still moving it, not at full
    cost on every `input` tick. **Corrected in fix round 2 (NB1):** it ends
    on the native `change`, but `change` only fires when the slider's
    value nets out different from where the scrub began — a scrub that
    wanders off and back to its start fires no `change` at all, so the
    hold never ended. `pointerup`/`pointercancel` now end it too,
    unconditionally, whether or not the value moved.
  - parametric setValue is 10.8–14.5 ms against an 8 ms budget (S1) —
    **fixed (V11):** 7.1–7.8 ms at 128x128 on the review machine, by sharing
    subexpressions across r, r_u and r_v through the existing register
    program (`compileMany`).
  - **Still open:** a grazing pick ray can pass between march steps near a
    silhouette (S3); a drag could jump behind a surface in rare views (S3) —
    neither is a look-and-feel item, so S6 did not touch either.
  - **Still open, parked for track 5:** the origin artefact in "Limits along
    two paths" (V8's own named example) is shading near a removed vertex,
    not a needle triangle — V8 (dropping a further "sliver" triangle at a
    hole's boundary) was withdrawn in fix round 4 rather than fixed a
    fourth time (three rounds of false drops on real specs, and no real
    spec it ever needed to fire on; see the V8 entry above). Whatever look
    this example still wants at the origin is a shading question for
    track 5, not a meshing one.
  - **Still open, and out of scope by the S6 plan:** curves of critical
    points, e.g. the ring (x²+y²−1)², want a "critical curves" feature (S4b
    M4) — seeding from the mesh decides which critical points are found, so
    this is correctness, not look; no committed test of GraphViewer's
    remount orchestration (S2, needs a jsdom layer).
- **Two more from fix round 1, not carried from S6's own ledgers:**
  - **M4:** `resetView()`'s ease (double-click, the `0` key) used to leave
    `getView()` reporting the transient, still-interpolating view — a host
    reading it a moment after triggering a reset would see a value already
    stale. `getView()` now reports where the ease is headed immediately;
    the renderer's own draw() still animates from the true, interpolating
    view every frame regardless. If the box moves mid-ease (a value change
    shifts the resolved box while the camera itself was not re-authored),
    the ease now re-targets to the new box's centre instead of easing to a
    point the box has already left.
  - **M6:** the readout box's drop shadow (removed for a pinned one, still
    present for the hover probe's — an inconsistency, and itself against
    the plan's "no gradients or drop shadows on chrome beyond a hairline
    border") is gone from both. `--space-line` (the chrome's hairline
    border token) now reads the palette's `grid`, which
    render/palette.ts's TOKEN_FOR maps to the host's own `--line` token —
    not `gridStrong` (`--line-strong`, a stronger role meant for the
    graph's own axis-adjacent grid).

**Open after the milestone gate fix (2026-09-30).** The gate review found
three real bugs in S6's own work — the fixes are in this same commit; what
is still open:

- **M2:** releasing a held value rebuilds every record that was built while
  held, not only the ones that read `held` themselves. `kernel/index.ts`'s
  release check (`record.builtHeld && !held`) exists so a resolution-
  sensitive builder (an implicit or level surface, S4b's `gradient: ...
  surface`) gets its one full-res rebuild on release even when the box
  never moved — but it fires for every held-built record, including
  `centroid:` and `plane:`, which never mesh differently while held and
  gain nothing from rebuilding (confirmed directly: releasing an unchanged
  parameter changes both marks' identity even though neither reads `held`).
  A triple-integral centroid's own quadrature is expensive enough that this
  shows up as a real hitch, on the order of 0.4–1.4 s, on every release.
  Suggested fix: a `heldSensitive` flag on a builder's registry entry
  (`registry.ts`), set only by the handful of builders the half-resolution
  fix (V11) actually touches, so `kernel/index.ts`'s release-rebuild check
  can skip everything else.
- **Parked from S5, still open:** at least 3 significant digits for
  inequality-form regions' readouts (Richardson extrapolation was tried
  there and failed S5's own honesty gate, so those regions still print
  fewer digits than a rectangular one would); a per-statement quadrature
  budget (today each integral gets its own `QUAD_BUDGET` of 6M evaluations
  — `quadrature.ts` falls back to `quadBudget()` and no caller passes one —
  so nothing caps a whole statement or scene: a centroid runs 4–5 integrals,
  about 15M evaluations for the cone); the exotic residuals S5's ledger
  flagged (a hand-built narrow spike, bumps narrower than 1e-3 of the range,
  ∭(xy)^(−2/3) and 3D 1/√|z| refused on budget, the ring |r−1| ≤ 0.01
  message, |x−0.01|^−0.9 located at x = 0).
- **A held build over the triangle budget names the halved res** ("res 80
  would make …" while dragging a `res: 160` implicit or level surface;
  `implicit.ts`, `levelSurfaces.ts`, `levelSurface.ts`). The message should
  name the authored res. Minor, from the gate re-review.

**What remains for track 5, specific to space** (track 5 is customization and
UI — theming, textures, line treatments, legends — see the graph spec's
Track 5 section; S6 only carried space's existing look to a finished state on
the tokens it already had):

- **The foundation is already there.** Every space colour comes from the
  host's theme tokens (`resolvePalette`, `space/theme.ts`); no hard-coded hex
  outside the documented categorical and colormap tables (SP11's S6 row).
  A theme editor built for the 2D and figure renderers should reach space for
  free through those same tokens — track 5 should confirm that rather than
  build a second path.
- **No legend.** A scene with several coloured curves or marks (The TNB frame
  of a helix, Velocity and acceleration with components) has no on-figure key
  tying colour to name. The spec already calls this out as a general gap;
  space needs it as much as the 2D engine does.
- **No line treatments.** Space's `gl/` lines are flat-shaded quads; sketch,
  chalk, tapered or variable-width strokes (track 5's line-treatment
  candidate scope) have no shader hook yet in `space/gl/`.
  Same for paper/grid background textures: space draws a plain themed
  background, with no texture layer.
  Colormap presets are similarly fixed today (viridis, diverging, etc.);
  track 5's "series palette control" would need a way to pick or pin one per
  document.
- **No marker-style variety.** Every space point is the same disc (S6 gave it
  a halo and an outline, not a shape); "marker styles per feature kind" would
  need a new attribute on point marks and a renderer path to draw it.
- **Categorical colours are contrast-checked, not colorblind-audited.** V7
  tested contrast for construction grey and the balance map's neutral centre
  only; the categorical series used for curves, points and vectors has not
  been audited for a colorblind-safe ordering.
- **No print/export theme or per-document theme pinning for space.** Space
  always draws from the live host theme; there is no snapshot or export path
  that would let a figure look identical wherever it is embedded, the way
  track 5's per-document pinning intends.

---

---

## How the engine is put together

Read this before touching code; it is the map the module names do not give you.

### The pipeline, end to end

```
spec text
  │  parser/parseSpec.ts        → { statements, errors, config }
  │    parseStatement.ts          one line → one Statement (the big one, ~1100 lines)
  │    parseConfig.ts             "@key: value" directives
  ▼
scene/mode.ts  resolveMode / resolvePanels
  │    decides WHICH renderer draws, and whether a table sits beside it
  ├──────────────┬────────────────────┬─────────────────────
  ▼              ▼                    ▼
graph           figure               table
scene/          figure/              scene/buildTable.ts
buildScene.ts   render.ts            → TableView.tsx (DOM)
→ Scene         → { svg, errors }
→ render/       → FigureView.tsx
  SceneRenderer   (SVG string via
  (three.js)       dangerouslySetInnerHTML)
```

`GraphViewer.tsx` owns that fork. It disposes the three.js renderer entirely
when switching to figure or table — missing that leaks a WebGL context per
switch, which is why the figure branch follows the table branch line for line.

### The three layers that matter most

**1. Construction maths — `scene/geometry/`.** Renderer-agnostic. Imports
nothing but `Vec2` and the angle-mode config, which is what let the figure
renderer arrive later without touching any of it.

```
objects.ts       point / line / circle, and the name → object scope
intersect.ts     line×line, line×circle, circle×circle (ordered, see D3 below)
derive.ts        midpoint, foot, divide, reflect, rotate, translate, dilate
lines.ts         parallel / perpendicular through a point, bisectors
centres.ts       centroid, circumcenter, incenter, orthocenter, incircle, circumcircle
solveTriangle.ts SSS / SAS / ASA / AAS / RHS
circles.ts       chord, arc, sector, segment, tangent at/from, secant, radius, diameter
regions.ts       phase 12: regions of segments and arcs, exact booleans (split, midpoint
                 classification, chain), exact areas, F6's interior label point
buildConstructions.ts  statements → resolved geometry (the adapter)
sceneObjects.ts        resolved geometry → three.js SceneObjects (graph mode)
```

**2. The SVG figure renderer — `figure/`.** Pure string emission; no DOM.

```
svg.ts         primitive emitters + THE number formatter (determinism lives here)
document.ts    layers, viewBox, two-pass auto-fit, the givens table
labels.ts      candidate-position collision layout — the hardest part
notation.ts    overbars, arrows, arc marks as positioned SVG geometry
measure.ts     computed lengths/angles/arcs + the asserting form
render.ts      orchestrates all of the above → { svg, errors }
viewport.ts    pan/zoom viewBox arithmetic (pure, so it is testable)

project3d.ts    3D → 2D projection, cameras, the convex hidden-edge rule
solids.ts       the six primitives, placement convention, SolidBody
silhouette.ts   analytic outlines for cylinder, cone, sphere
crossSection.ts plane ∩ solid, serving both `cut:` and `section:`; the SectionPlane union,
                the polyhedron walk, the region shape, true shape
plane.ts        Q1: canonicalisation, a general plane's frame, the equation form, signed distance
conicSection.ts Q4: a round solid by any plane, in its own frame, closed form (conics, trims, refusals)
sectionVisibility.ts  Q6: an in-place outline's pieces, visible or hidden
authorFrame.ts  the z-up author frame <-> the internal y-up frame (S1)
construct3d.ts  the Vec3 toolkit and constructions in space, camera-free
solidScope.ts   the solid-figure walk: solids + space points, source order
occlusion.ts    the glass rule: segments split visible/hidden, exactly
hull.ts         the one exact convex-hull builder (P3), and base-polygon checks
tetrahedron.ts  the tetrahedron from six edges, Cayley-Menger checked (P4)
regular.ts      regular n-gon solids and the octahedron: P5's rotation and lettering
spheres.ts      phase 9: in- and circumspheres (fixed-order solves, verified), tangency radii
spaceMarks.ts   phase 10: arcs, right-angle squares and dihedral marks in space (M1, M3), M4's whole-mark rule
nets.ts         phase 11: per-primitive net templates, the closed-form unfolding (charts, rigid motion), round unrollings (net.testkit.ts: the test-only overlap predicate)
shortestPath.ts phase 11: shortest paths over a surface — polyhedra by exact face-sequence enumeration (N3), round solids closed form (N4)
```

**Placements and the local camera (P1).** A round solid (cylinder, cone,
sphere, frustum) is always computed in H1's frame — centred, axis +y — and
carries a `placement` saying where that frame sits in the world.
`solidOutline`, `hidesPoint`/`occlusionCandidates` and `sectionOf` convert at
their door: outlines through `localCamera(camera, placement)`, occlusion by
taking the segment into local coordinates, sections by moving the plane.
Identity placements short-circuit every conversion, which is what kept every
pre-phase-7 byte. Polyhedra need none of this: their vertices are world
points already.

**Every polyhedron built from points goes through `hullOf` (P3).** The
phase 7 dimension primitives do NOT: their faces are known, and `regular.ts`
writes them in closed form (caps, then lateral quads or triangles), with
vertices in lettering order so `labelOrder` is the identity. A regular base
has 3 to 24 sides. A dimension label on a built solid reads its segment off
`body.polyhedron`, never a rebuilt copy. The pre-phase-7 box, square pyramid
and regular tetrahedron keep their hand-built face lists, because their bytes
are pinned.

**Two 3D engines, and they share no code.** *Space* is track 3 — hand-made
WebGL2, orbitable, calculus (`graph-engine/src/space/`; see "Track 3 —
space").
*Solid figures* are this track — the SVG figure renderer through fixed named
views (the modules above). Say "space" or "solid figure" in code, tests,
commits and errors, never "3D engine" alone, and do not name anything in the
solid-figure engine `space…`. The two share one thing an author sees: the
z-up frame. The solid-figure engine converts it at one boundary
(`authorFrame.ts`); nothing downstream of the grammar knows it exists.

Layer order is fixed and semantic: `regions → auxiliary → primary → marks →
points → labels`. SVG paints in document order, and at competition density
overlap is normal, so this is correctness rather than style.

**3. The plot renderer — `render/`.** Unchanged v1 three.js machinery plus
track 1's work (`grid.ts` for steps and labels, `hover.ts` for snapping,
`featureMarker.ts` for the per-kind marker shapes).

### 2D handling (view2d)

Figures move: drag to pan (with coasting), wheel or pinch to zoom about the
cursor, `+`/`-`/arrows/`0`/`Esc`/`C` from the keyboard, double-click or
double-tap to reset, hover and click to point at things, `@focus` to open
somewhere, and a coordinate tool to find a focus by looking. Design:
`docs/superpowers/specs/2026-10-04-2d-handling-design.md`; the build plan and
per-task reports are under `.superpowers/sdd/2026-10-04-2d-handling/`.

**The shape: a pure core and thin adapters.** `view2d/` is DOM-free, clockless
and imports nothing from the rest of the engine, so tables, flowcharts and the
2D plot can adopt it unchanged.

```
view2d/feel.ts       EVERY number that decides how it feels: zoom limits (0.1-64), pan margin,
                     smoothing and coasting constants, wheel sensitivity, tolerances (8 px mouse,
                     16 px touch). Tune the feel here and only here.
view2d/types.ts      Camera {cx, cy, zoom}, Rect, Vec, Size. Zoom is relative to the FITTED view.
view2d/camera.ts     content <-> screen, visible rect, anchored zoom and pan
view2d/limits.ts     the limits policy (clampCamera)
view2d/motion.ts     ViewMotion: drag, coast, smoothed zoom/pan, eased reset and focus
view2d/input.ts      GestureRecognizer: pointer, wheel and key samples -> intents
view2d/pointing.ts   HitItem shapes, hitTest (tolerance in px, point beats line beats area), selection
view2d/focus.ts      parseFocus / formatFocus, AuthorMapping, focusCamera
view2d/readout.ts    how numbers print (formatPoint, formatZoom, formatCoordinate)
view2d/dom/          the browser layer: useView2d (one hook, a Controller class), appliers (SVG
                     viewBox now, CSS transform for later views), startView (reset and "at start"
                     decisions), domInput (key and tolerance decisions), CoordinateTool + css
figure/frame.ts      FigureFrame: author coordinates <-> drawing units (plane: invertible;
                     space: forward only). figure/hitItems.ts: items from renderFigure.
figure/highlight.ts  hover and selection look (SVG filters, constant on screen)
figure/focusLine.ts  the coordinate tool's text: cursor, centre, and the @focus: line Copy writes
FigureView.tsx       the adapter: renderFigure's frame + items + useView2d + the tool
```

**Rules worth knowing.**
- **Shift + click selects several** (2026-10-07): `PointerSelection` is an
  ordered set, and `onSelect` (FigureView, GraphViewer) reports an array of ids.
- **A moving view is not redrawn.** The drawn SVG is slid and scaled with a CSS
  transform (`view2d/liveTransform.ts`) and the `viewBox` is committed when the
  view has rested `SETTLE_MS`, or has drifted ×2, or left the 30% overscan
  (never more than every 250 ms); highlights go on the outermost element only.
  The constants (`OVERSCAN`, `SETTLE_MS`, `COMMIT_DRIFT`, `COMMIT_THROTTLE_MS`,
  `COAST_TAU`, `COAST_STOP`) are in `feel.ts`. Spec: "Moving a heavy drawing".
- **`renderFigure`'s SVG did not change.** It now also returns `frame` and
  `items`; the markup is byte-identical (a sweep of every figure example, in
  clean, ink, pencil and marker, light and dark, is the check). Hover and
  selection are classes and filters applied to the live DOM, never markup.
- **The view is the SVG's viewBox**, not a transform on the markup; labels and point dots are compensated so they keep their screen
  size, and strokes use `vector-effect: non-scaling-stroke` (clean figures
  only; a styled figure's lines are filled outlines and scale with the view,
  keeping every mark in proportion).
- **Reset has two stops.** Reset goes to the start view (the spec's `@focus`,
  else fitted); already there, it fits everything.
- **A new figure starts at its own start view; the same drawing rebuilt keeps
  the reader where they were.** The key is by value (`startView.ts`).
- **Keys act only with the surface focused**, and ctrl/meta/alt-modified keys
  are never taken. `C` is taken only when the host turned the coordinate tool
  on (`coordinates` prop); otherwise it is left to the page.
- **No text selection in a figure**, by CSS, `selectstart`/`dragstart` and
  `preventDefault` on pointerdown (which is why focus is given by hand).
- **A solid figure cannot be inverted.** The cursor line shows the hovered
  vertex's `(X, Y, Z)`, else `view (u, v)`; Copy writes the vertex within the
  tolerance of the centre, else `view (u, v)`.
- **A label shares its object's id** and comes after it in `items`, so an
  id -> item map holds the label, which has no author coordinates. Use
  `itemForId` (it prefers the item that has them).
- **The pointer and the camera are published only while the tool is open**
  (`trackPointer`, `trackCamera`); every mouse move or frame would otherwise
  re-render the figure. The camera is rendered with `flushSync` from the frame
  that drew it: a state update from a rAF callback is left to React's
  scheduler, which can run after the paint (under a headless screenshot, never
  before it), leaving the readout one camera behind the drawing.
  The view keeps the latest camera and pointer in plain fields even while
  untracked, and `publishOnTrack` hands them over the moment the tool opens, so
  a tool opened after the view settled is right at once, not after the next move.
- **The coordinate tool sits bottom-left** (panel opening upward), top-right
  when `@givens` is `bottom-left` or `left` (`toolCorner`); the top-left is
  the givens table's default corner and the bottom-right is the reset button's.

**How tables and flowcharts adopt it.** Give the engine four things and call
`useView2d`: a content frame (the table's pixel box, the flowchart's layout
units), an applier (`applyCssTransform` for HTML, the viewBox for SVG), items
with hit shapes in content units (cells by DOM hit test, nodes and edges), and
an `AuthorMapping` (`(row, column)` for a table; layout units for a flowchart).
Then render `CoordinateTool` with that engine's own lines. The 2D plotting
engine gets a variant later (its camera changes the plotted window), shaped to
extend this core rather than fork it.

**Not covered by node tests (the DOM and the feel).** `useView2d`, the
appliers' DOM calls, `FigureView` and the tool's CSS are checked by eye in the
review harness (it has the coordinate tool on). Ben judges the feel live.

### Figure styles: `style/` and the pen (visual pass, part 1)

A figure can be drawn in a look. Two halves, split so the graphing engine can
adopt the first later:

**`graph-engine/src/style/` — the style model, renderer-independent.** It
imports nothing from `figure/`, `scene/`, `render/` or `parser/` (a test in
`style/determinism.test.ts` reads the imports), and no `Math.random` or clock
anywhere in `style/` or `figure/` (same test).

```
tokens.ts      the five groups (line, fill, paper, lettering, colour) + seed, and TOKENS:
               the ONE table that validates directives, names valid values in refusals,
               writes a style back out (directivesFor), and builds the lab's controls
presets.ts     clean, ink, pencil, marker — complete looks
resolve.ts     layers: clean -> base (host) -> figure directives; applyStyleDirective,
               checkLayer (a host's base style, errors returned), isClean, directivesFor
random.ts      FNV-1a of "identity|seed" into mulberry32; smoothNoise
color.ts       OKLCH: saturate (chroma x s, gamut-fit by chroma), deepen (lightness)
path.ts        abstract chains (line / arc / ellipticalArc / cubic), exact sampling,
               Catmull-Rom smoothing through samples, dashing
lines/         one file per line type + hand.ts (the shared hand: wobble pinned at the ends
               at looseness 0; bowing, end offsets, overshoot scale with looseness)
fills/         one file per fill + region.ts (flattening, even-odd inside, scanlines)
papers/        one file per paper + common.ts (the 7-view cover, grain tiles)
lettering.ts   font stacks (textbook IS clean's sans stack) and tiltFor (<= 4 degrees)
textures.ts    the SVG filters for grain/chalk/bleed/wash/soften — texture only, never geometry
markup.ts      a few lines of SVG writing for textures and papers (same 3-decimal rule)
```

**The pen — `figure/pen.ts`, `figure/styledPen.ts`.** `render.ts` decides WHAT
to draw and calls a `FigurePen` (`stroke`, `fill`, `mark`, `text`,
`notation`, `panel`, `paper`, `svg`); every call carries an identity key
(`"<statement>/<object>"`, plus a piece index) and a layer. `render.ts`
imports no SVG emitter (`pen.test.ts` reads its imports).
- **The clean pen** forwards each call to the emitter render.ts used to call,
  same arguments, same order — that is how clean stays byte-identical.
  `renderFigure(statements, config, palette, baseStyle?)` resolves the style
  and a style that is clean (seed aside) ALWAYS gets the clean pen.
- **The styled pen** turns each call into chains (`strokeChains`,
  `regionChains`), draws them through the line type seeded by the identity,
  fills regions through the fill with every non-area mark clipped to a
  `<clipPath>` of the region's EXACT outline, lays the paper under a
  `data-layer="paper"` group, sets labels in the face and turns them about
  their own anchor. Texture filters sit on the stroke layers, once per figure.
  Ids in `<defs>` come from a hash of the finished document (a private-use
  placeholder is swapped for the prefix), so two figures on a page never
  collide.

**Adding a line type, fill or paper is one file plus one registry entry:**
1. Add its name to the kind list in `style/tokens.ts` (`LINE_TYPES`,
   `FILL_TYPES` or `PAPER_TYPES`). TOKENS picks it up, so the directive, the
   refusal message and the lab's picker follow.
2. Write `style/lines/<name>.ts` (a `LineType`: `draw(StrokeInput) ->
   Primitive[]` and `texture(settings)`), `style/fills/<name>.ts` (a
   `FillType`: `draw(FillInput) -> { marks }`) or `style/papers/<name>.ts` (a
   `PaperType`: `draw(PaperInput) -> { defs, background }`). Open it with a
   comment saying what the look is and how it is built.
3. Register it in that folder's `index.ts`.
4. The suites then hold it to the rules without new tests: `lines.test.ts`
   (determinism, ends exact and within half a width at looseness 0, strays at
   1, finite, a structural signature distinct from the others), `fills.test.ts`
   (marks inside, the annulus's hole empty), `papers.test.ts` (covers 3 view
   boxes each way, ids defined). Add a character test of its own, and look at
   it on the contact sheet.

**Seeing it.** `npx vite-node graph-engine/scripts/contact-sheet.ts <out dir>`
writes the sheet as one HTML page per section (the presets in two halves),
each short enough for headless Edge to paint whole; the script's header has
the screenshot command. (One page of the whole sheet is ~13 000 px, and Edge
paints nothing past ~8 000.) The lab is
`http://100.90.203.2:5181/style-lab.html` on the geometry review server, and a
tab of the harness.

**Roughness (2026-09-30 revision — "imperfection").** Ben's first look at the
contact sheets: scribble was too clean, ink wanted its own rough-brush
texture, and fills generally needed to be a little less perfect. So:
- **`fill.roughness`** (`@style-fill-roughness`, alias `@style-roughness`), a
  new token alongside line's `looseness`. At 0 every fill draws exactly as
  before — pinned by hash in `fills/fills.test.ts` for all seven fills, on a
  square, an annulus and a two-loop region — and the rough code paths never
  run (no extra random draw to shift what follows). Above 0: hatch and
  crosshatch stray in place, angle and where they end, and skip or break a
  line now and then (`fills/hatch.ts`); scribble's turns wander, its legs
  bend, turns sometimes loop, the whole run is a smooth curve rather than a
  zig-zag, and past 0.3 a second sparser scribble goes over a patch of it
  (`fills/scribble.ts`, `path.ts`'s `smoothThrough`); stipple clumps into
  slow patches and varies its dot size more (`fills/stipple.ts`); flat and
  wash sit a little off register — translated and clipped back to the exact
  outline, so the tint misses the true line on one side and never spills on
  the other (`fills/region.ts`'s `offRegister`) — and flat takes a faint
  `mottle` texture (`textures.ts`). Presets: ink 0.35, pencil 0.45, marker
  0.6, clean 0 (unread).
- **Ink has variance, not grain** (Ben's call after the first rough-ink pass, with a
  reference of brush-pen strokes). The ink line (`lines/ink.ts`) is one solid
  outline: its width swells and thins with slow pressure noise, tapers to fine
  points at both ends (over at most 14 widths, and never on a loop), and each
  edge has its own small bumps (`ribbon2`), all
  following `variation` and `taper`. There is no texture, no dry brush, no end
  blots and no second pass, and `grain` is not read. The pinhole `bleed`
  texture is gone. Ink preset: width 1.7, variation 0.75, taper 0.8. Fill
  roughness: ink 0.45, pencil 0.5, marker 0.6.
- The contact sheet's new **"Imperfection"** section shows hatch,
  crosshatch, scribble, stipple and flat at roughness 0/0.5/1, and the ink
  line at variation 0/0.5/1.

**Roughness's own fix round 1.** An independent review of the above caught,
critically, that the `bleed` pinhole mask (`textures.ts`) was inverted —
`speckle`'s cut left positive alpha only above noise ~0.64, so most of
every ink line and every ink-preset fill vanished, even at grain 0.
Corrected, and pinned by reading the gain/cut straight out of the filter
markup (`style/textures.test.ts`). Also fixed: rough hatch and crosshatch
could go 17.5% over `MARK_BUDGET` (the clean family is now fit to a share
of the budget that leaves room for the rough inflation); scribble's second
pass now ramps in over roughness 0.3–0.4 rather than jumping; dry-brush
strands now follow the ribbon's own taper and pressure
(`Math.min(half[i], width/2)`), not a flat nominal width; `ribbon2`'s end
caps interpolate between the two ragged sides rather than averaging them;
fill textures are keyed by name AND strength in `styledPen.ts`. Scribble's
roughening moved to `fills/scribbleRough.ts` and `offRegister` to
`fills/offRegister.ts`, so `scribble.ts` and `region.ts` stay one idea
each.

**Rules added in review round 1 (worth knowing before you edit).**
- Clean byte identity is guarded in the repo by `figure/cleanGolden.test.ts`
  (288 hashes of every figure example, computed by the code at `1951e6a`).
- Loops (circles, rims) close exactly at looseness 0 and overlap along their
  own curve above it — `lines/hand.ts`'s `handChain`; no caps, blots or
  tangent overshoot at a loop's seam.
- Technical keeps the caller's line cap and dashes natively
  (`LineType.nativeDash`), so clean plus one setting keeps clean's ends.
- A region's fill has a mark budget (`fills/region.ts` `MARK_BUDGET`: 40k
  units of line, 6k dots); past it the spacing opens out.
- Labels are laid out at the style's lettering size
  (`drawFigure(..., letteringSize)`), not just drawn at it.
- A styled `<svg>` carries `data-style`; FigureView.css keeps strokes
  non-scaling only for clean figures, so every mark of a styled figure scales
  with the zoom together.
- A preset's own paper decides its palette: a light paper in a dark app
  resolves ink and author colours against the light palette
  (`render.ts` `paperPalette`); `none` and `theme` papers follow the host.
- Colour settings take the shared names (`style/colorNames.ts`) and bare hex;
  `color:` takes bare hex too (`color: d03030`), since `#` starts a comment.

**Known limits (part 1).** Styled SVGs are heavier than clean: ~100 KB on
average, under 1 MB at the finest spacing thanks to the budget. A preset's
paper keeps its own tint in the dark theme (by design, above). `#` starts a
comment in a spec, so colours are written as names or bare hex.

### Contracts worth knowing before you edit

- **`renderFigure(statements, config, palette, baseStyle?) → { svg, errors }`.**
  Errors are returned, not thrown — one bad statement must not blank the
  figure, and a bad base style is reported the same way. A style that
  resolves to clean draws through the clean pen, byte for byte.
- **Byte-identical output** for the same input at the same view state. Every
  number goes through one formatter in `svg.ts`. Break that and caching,
  diffing and the tests all go with it.
- **Element identity.** Emitted elements carry `data-statement` and
  `data-object`, so track 7's tutor tools can address them without a second
  lookup mechanism.
- **`GEOM_EPS`** is the single shared tolerance. Do not add another.
- **Parse errors vs render errors** are separate channels and surface
  differently. A measure assertion failing is a *render* error.

### Running and verifying

```
npm run test --workspace=graph-engine          # 4380 tests (after the 2D handling merge, 2026-10-10), node-only, no DOM
npx tsc -p tsconfig.app.json --noEmit          # from graph-engine/; NOT bare
npx tsc -p tsconfig.node.json --noEmit         # `npx tsc --noEmit` — the root
                                                # tsconfig.json is a solution
                                                # file ("files": [] plus
                                                # references) and that bare
                                                # form checks nothing
npm run lint --workspace=graph-engine
npm run review -- --port 5181 --host 100.90.203.2   # from the geometry worktree (space uses 5182)
```

For anything renderer-shaped, a `vite-node` scratch script against
`parseSpec` + `renderFigure` is the fastest way to see real output — far
quicker than the browser, and it is how most of the diagnosis in this session
was done.

## Lessons that cost real time

### 1. Five tests shipped passing for the wrong reason

This is the single most expensive recurring failure in the project. Instances:

- `1/x` pole test passed because a sample landed **exactly** on x=0, so the
  pole discriminator never ran.
- Dedupe test never reached the comparison with a non-empty accumulator.
- Feature-marker inequality test pinned nothing — two shapes could be swapped.
- Hover "outside the snap radius" test placed the point 333px away, so the
  outer cutoff rejected it before the snap logic was reached.
- **D3 intersection ordering**: deleting the sort left all 336 tests green.

**The rule, learned the hard way:** proving a test can fail means **deleting
the behaviour it covers**, not perturbing its inputs. The D3 case is the
clearest — the builder *did* mutation-test it, using `hits.reverse()`, which
catches an inverted comparator but not a missing sort.

Put this in every implementation dispatch. Phase 2's builder applied it and
caught three of its own; Phase 3's caught three more.

### 2. Node-only tests cannot see DOM or CSS bugs

Two bugs reached the user with a fully green suite:

- **React compares the `dangerouslySetInnerHTML` object, not the string**, so
  the `<svg>` was replaced every pan frame and labels grew with the zoom.
- **`.graph-viewer` was only a flex container when split**, so a single
  `.graph-viewer-panel` with `flex: 1 1 0` collapsed to zero height. Figures
  rendered invisibly; the canvas fell back to its attribute height and looked
  cut off.

vitest here is node-only (`include: ['src/**/*.test.ts']`, environment node).
If this area grows, it wants a jsdom layer or a standing "load it in a real
browser before calling it done" step.

### 3. The preview pane is pinned to the main checkout

`preview_start` / the Claude preview pane launch the dev server in
`C:/Users/benif/Osmosis`, **not** the worktree — so it serves main's code and
every "verify in the harness" step verifies nothing. Run instead:

```
npm run review -- --port 5181 --host 100.90.203.2
```

from the worktree. `100.90.203.2` is the machine's Tailscale IP; binding to it
specifically (not `0.0.0.0`) keeps it on the tailnet only. The user reviews
from another machine over Tailscale.

**Restart it after big changes.** Vite HMR does not survive a new React
component plus a new module directory; a stale server is what made the user
report the engine as broken.

### 4. Features nobody can find are features that do not exist

Three separate times, work shipped with no way to reach it from the review
harness, and the user reasonably concluded it was broken. Now guarded:
`graph-engine/src/examples.test.ts` asserts **every** example parses *and*
draws. It caught three of five new examples on its first run.

If you add engine capability, add an example in `graph-engine/src/examples.ts`.

### 5. Exact isometric is degenerate for a cube, and the examples hid it

Phase 5 shipped isometric as the default and every example looked right,
because every example was an 8×5×6 box: unequal sides move the far corner off
the near one. A cube puts them on **one point** (isometric looks along its
space diagonal), and a regular tetrahedron's altitude vanishes under an edge.
It took phase 6's "Cube by points" example to show it, by looking. **Test a
projection on the symmetric solids** (cube, regular tetrahedron), the ones
competition problems use, not only on a convenient box.

### 6. The commit trailer is a fixed string

Every commit body ends with exactly:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

It is a repo convention, **not** a description of which model did the work. A
haiku implementer substituted its own name and had to amend; a reviewer later
flagged the *correct* trailer as wrong for the same reason. Say so explicitly
in dispatches, and do not let a reviewer's objection to it stand.

---

## Design decisions and why (expensive to rediscover)

**Geometry is constructive with closed-form solvers, never a numeric constraint
solver.** An AI tutor authors these specs. A general solver can return a
different-but-valid figure between runs and fails in ways nobody can act on.
Determinism and legible local failure — *"line B-C and circle O do not
intersect"* — matter more than expressive generality. This is a spec Non-goal;
do not add a solver.

**Determinism needs a fixed convention, not just deterministic code.**
Constraints fix a triangle's *shape* but neither its position nor orientation,
and a line×circle intersection has two solutions. Hence D5 (first vertex at
origin, second on +x, third in upper half-plane) and D3 (solutions sorted x
then y). Without those, "deterministic" is unachievable.

**Figures are a separate SVG renderer, not the plot renderer with axes off.**
The deciding argument is text: a figure is mostly labels, and in three.js those
are sprite atlases with hand-computed metrics. SVG text is native with real
metrics. A figure is tens of elements, so canvas's throughput advantage does
not apply. Also: crisp at print resolution, dashed strokes and arcs as
primitives, no WebGL context, and DOM nodes so track 7's tutor tools get
hit-testing free (emitted elements carry `data-statement` / `data-object`
identity for exactly that).

**Constructions are shared maths, consumed by *both* renderers.** "Geometry has
no graphing interface" constrains the figure renderer only — `M = midpoint A-B`
still works in graph mode beside `y = x^2`. This was nearly lost twice; it is
the commitment that keeps coordinate geometry working.

**Mode is inferred but should always be declared.** Inference is a safety net;
under it, adding one plotted function to a figure silently changes the whole
presentation. The house rule — state `@mode:` explicitly, *including
`@mode: graph`* — must land in the tutor-facing reference, not just the human
one.

**`@step-mode: geometric` doubles upward and floors at its base.** 8 → 16 → 32
→ 64, and zooming in never goes below 8. The floor is the *feature*: the mode
exists so an author can withhold coordinates, and a grid that returns to single
units hands back exactly what the question was hiding. I removed that floor
once during preflight to satisfy my own bad test — do not remove it again.

**Measure assertions and `@scale: false` are designed together.** `label: AB = 8`
fails if the side is not 8; `@scale: false` suppresses it. Without the
assertion the flag is meaningless; without the flag the assertion makes
deliberately-not-to-scale figures unauthorable.

**Exactness is structural, never inferred.** An exact value exists only when
whatever produced it knows it — a literal `sqrt(3)/2`, a π-scaled axis, a
closed-form solver. The engine must **not** inspect a float and guess `0.333…`
was `1/3`. That inference is cheap and tempting and asserts something false
whenever it is wrong. Form set is `(p/q)·√r·πᵉ`; sums are out of scope.

---

## Open items, roughly by value

1. **`server/src/domain/bootstrap.ts` still documents the v1 directive
   surface.** This is the highest-value item. It is the condensed reference the
   MCP tutor actually reads, so **the tutor cannot reach any of this work** —
   not `@labels`, `@step-mode`, `roots`/`extrema`, chained inequalities, nor
   any geometry construction, figure mode, measure or circle vocabulary. The
   declare-your-mode rule landed there; nothing else has. **As of phase 6 it
   lags by one more phase**: points in space, the z-up frame, constructions
   in space and `segment: … dashed | plain` are all unreachable to the tutor.
   **As of phase 7 it lags by two**: every solid on points, the six-edge
   tetrahedron, the hull, the frustum and the regular solids are unreachable
   too. **As of phase 8, by three**: planes as objects and oblique sections. **As of phase 9, by four**: inspheres, circumspheres, spheres by tangency and `center of`. **As of phase 10, by five**: measures between lines and planes, dihedrals, the common perpendicular, and every mark on points in space. **As of phase 11, by six**: nets and shortest paths over a surface. **As of phase 12, by seven**: `fill:` and area measures. The user has scheduled the tutor reference for much later.
   The house rule "declare `@mode:`" matters doubly for solid figures: under
   S5 a spec of 3-coordinate points with no solid still infers the *space*
   renderer, so a tutor sketching points in space before adding the solid gets
   a different renderer until it declares `@mode: figure`.
2. **Migration sweep of stored geometry questions.** Mode inference changes how
   v1 `polygon:`/`circle:`/`angle:` specs render — bare figure instead of a
   plot with axes. Almost certainly better, but it is live content and the spec
   asks for a sweep. `@mode: graph` restores the old rendering.
3. **FIXED — `r = bisector of angle A-B-C` was silently read as a polar curve.**
   Ruling: reject, do not re-route. A construction bound to `r`, `x`, `y` or `z`
   is refused with a message naming the reserved name, quoting the line and
   suggesting a rename (`R = bisector of angle A-B-C`). The check is
   `refuseReservedConstruction` in `parser/parseStatement.ts`; it asks
   `parseConstructionBody`, so there is no second keyword list.
4. ~~**Scientific notation fails silently.**~~ **Closed 2026-09-27** by the
   space integration pass (Task 3, `fix(graph-engine): the tokenizer reads
   scientific notation; …`). `y = 1e6 * x` used to lex `1e6` as `1 * e6` with
   `e6` unbound, producing no curve and no error. The rule, agreed with the
   solid-figure side: a lowercase `e` is an exponent only when it directly
   follows a numeral and is directly followed by an optional sign and a digit
   (`1e-12`, `2e3`, `1.5e+6`); an uppercase `E` never is (`2E3` is 2 times
   `E3`). `2e`, `3e x`, `2e^x`, `2e-x` and `e^(-x)` keep the constant e. The
   byte-identity sweep over every example, every test literal and every
   figure example under every `@view` changed only test titles that mention
   such numbers.
5. **The `Vector` example now infers figure mode**, so it draws with no axes —
   arguably wrong, since a vector's meaning is its coordinates. A
   classification question about whether `vector:` is plot or figure content.
6. **Exact/symbolic values** — specced, scheduled at build-order step 3. Until
   then measures print decimals; everything routes through one formatter so it
   becomes a one-place change.
7. **Solids beyond phase 5.** *Superseded 2026-09-26.* The spec's "Revised
   2026-09-25 — two 3D engines, and the road to AIME" replaces this item: build
   steps 6–11, the z-up author frame, and the glass rule in place of the four
   composite arrangements. Phase 6's plan is
   `docs/superpowers/plans/2026-09-26-geometry-v2-phase-6-solid-construction-core.md`.
   The original text follows for the record.

   Composite solids (the four constrained
   arrangements in the spec), nets, and oblique cross-sections. Phase 5
   delivered the grammar, all six primitives, dimension labels and
   axis-perpendicular cross-sections; these three were explicitly out of its
   scope. Composites are the one with real difficulty in it: they need
   occlusion *between* solids, which the convex per-solid rule does not do,
   and which is why the spec pre-constrained them to four arrangements rather
   than allowing general boolean modelling.

   **How far this is from AIME, measured rather than guessed.** The solids
   path currently draws one solid, an axis-perpendicular cut, dimension
   labels and a lifted section. Competition 3D mostly asks for what is
   missing: a sphere inscribed in a cone or a cube in a sphere (composites),
   a plane through the midpoints of edges (oblique sections — the regular
   tetrahedron's square cross-section is the canonical example and cannot be
   drawn), shortest-path-over-the-surface problems (nets), and skew lines and
   dihedral angles (no vocabulary at all). What exists is solid AMC 10/12
   early-to-mid territory. Oblique sections are probably the highest value
   per unit of work of the three, since the machinery already solves
   plane ∩ solid and only the plane's generality is restricted.

8. ~~**Solid vertex names are drawn but not measurable.**~~ **Closed in
   phase 6.** A solid's named vertices are points in space (S4): `label: AB`
   resolves, and measures the TRUE 3D length, as does every length between
   points in space. "Unknown point A" is gone.
8. Minor, recorded: intersections have no secondary sort key;
   `conic-vertex`/`local-max` and `focus`/`intersection` share marker shapes
   (latent — nothing emits the conic kinds); `x = f(y)` gets no feature points;
   tangencies are not detected by intersection finding (sign-change based), and
   **track 7's "show me where these cross" will inherit that silent miss**.
9. ~~**Phase 6: the default camera and prism lettering.**~~ **Closed in phase
   6b.** Decided with the user: a new `standard` default camera in general
   position (azimuth 30°, elevation 25°), `isometric` kept by name with its
   bytes, placement fixed against the default camera rather than the active
   view (the tetrahedron's first vertex 15° off it), and textbook lettering
   for prisms, pyramids and tetrahedra. See "Phase 6b in detail". The "Cube
   by points" example is re-lettered with D the hidden corner, "Box diagonal"
   draws AG long, "Cylinder and cone" turned its two lines 15° with the
   camera, and "Regular tetrahedron and its height" shows the altitude clear
   of every edge.

10. **Phase 8's out-of-scope items (Q7), each refused legibly today.** A
    plane drawn on its own (a patch — `plane: A-B-C` is refused, pointing at
    `cut:` and at naming it); the line where two planes meet (`intersect
    plane …, plane …` is refused); parabolic and hyperbolic sections of a
    cone or frustum (refused, naming the conic). ~~Nets (`net:` is
    refused, build step 11)~~ (**done in phase 11**). ~~Inscribed and circumscribed solids are build step 9~~
    (**done in phase 9**, for spheres); angle and dihedral marks step 10
    (**done in phase 10**).

11. **Phase 9's out-of-scope items (R7), left out on purpose.** Build step
    9's "tangency" is scoped to one object at a time (R5). Spheres tangent
    to several objects at once need a solver and are refused at parse time
    ("tangent to plane z = 0 and T"), as is a tangent sphere with no centre;
    the author places such a sphere by its computed centre, and a label
    checks each tangency. Not drawn: contact circles on a cone or cylinder;
    inscribed cubes and other inscribed polyhedra (`insphere`/`circumsphere`
    only ever make spheres); tangency assertions in the givens table; opaque
    coaxial stacking. `center of` takes only a sphere (a 2D circle's centre
    is already the point it was drawn around).

12. **Two concentric spheres' radius references coincide.** `label: S
    radius` draws its reference from the centre along the sphere's local +x
    (phase 7's convention), so an insphere and a circumsphere with one
    centre (a cube's, a regular solid's) draw their radii on the same line,
    one over the other. The "Cube between two spheres" example therefore
    labels the circumradius through a segment to a vertex (`segment: M-G`,
    `label: MG`). A fix would turn a second concentric radius to another
    direction (as the side-view fallback turns one to local +z); not done.
13. **Tiny solids on named points are refused by phase 6's absolute floors.**
    Phase 9's round 2 made every threshold in `figure/spheres.ts` relative to
    the figure's own size, so a regular tetrahedron of edge 1e-6 far from the
    origin gets its insphere and circumsphere. But four points 1e-6 apart
    written as `solid tetrahedron A-B-C-D` still fail first with "A, B and C
    are collinear", from the absolute tolerances in `construct3d.ts` and
    `hull.ts`. No competition figure is that small. The fix is the same
    make-it-relative change there.
14. **A space `plane:` statement inside a solid figure** will hit the generic
    "is a plot; a solid figure does not draw plots" refusal once
    `milestone-a/space` is merged, because space owns `plane:` (spec, "Keyword
    ownership"). After that merge, give it its own message saying a plane is
    drawn through the section it cuts (`cut:`). It can't be done before the
    merge: the `space` statement kind exists only on that branch.
15. **Phase 10's out-of-scope items (M8), each refused legibly.** Angle
    marks between skew lines have no vertex (`angle: between A-B and C-D`
    is refused, pointing at the table and at marking the foot); marks for
    line–plane angles are the author's to build (`F = foot …`, then
    `angle: A-P-F`); the angle between two planes is written as the
    dihedral along their common edge; line–plane distance, areas and
    volumes (`label: S volume`) are refused in words. Values print as
    decimals until exact values land (build-order step 3). Two drawing
    notes from the PNG review: a convex solid's dihedral arc is always
    dashed (it lies inside the solid, M4), and its radius, 0.2 × 0.3 |AB|,
    is small — a candidate for a larger fraction if review finds it faint.

16. **Phase 11's out-of-scope items (N6), each refused legibly.** General
    polyhedron unfolding (`net:` on a hull of named points), nets of
    spheres, paths over the flat ends of round solids, over spheres, or
    over polyhedra of more than 12 faces, geodesics drawn on a curved
    surface in space, and areas. Drawing notes from the PNG review: a
    SECTION's letters can still sit close to the solid's (its gap is phase
    5's quarter of the solid's width, kept for byte identity; nets and path
    strips reserve label clearance since fix round 1); a path's
    `unfold` strip is turned so the path runs left to right, so the strip
    itself is usually tilted; points written as literals (a room's corners)
    are dotted as every literal point is, so the examples place solids by
    dimensions where they can.

17. **Phase 12's out-of-scope items (F7), each refused legibly where an
    author could ask.** Hatching patterns (Track 5 styling; a fill is a flat
    tint), fills in graph mode, fills on points in space (a face in a solid
    figure is drawn as a section), and regions bounded by conics other than
    circles. **Exact symbolic areas wait on build-order step 3**, and so
    does asserting one: today an area prints as a decimal (3.434, not
    16 − 4π), a stated decimal asserts at the shared tolerance like every
    measure, and a symbolic `= 16 − 4π` prints as written and is not
    checked. Checking an exact expression against the value is build step
    3's, for every measure — not a special case for areas. `area.test.ts`
    pins the gap as a test named "KNOWN GAP (handoff item 17)", which
    expects a wrong symbolic area (`= 16 - 3π`) to pass; flip it to a
    refusal then. Drawing notes
    from the PNG review: a fill's edges are drawn only where the author
    draws them, so a fill with no lines of its own reads as a soft shape;
    and a union's F6 label can land in the overlap of its parts when the
    widest chord runs through it (two overlapping squares do this, which is
    why the "Shaded union" example is a square and a circle).

18. **The measure-refusal wording can read as a contradiction** (engine-wide,
    not now). When an author states the rounded value the label itself
    prints — `label: area R = 3.434` for 16 − 4π — the refusal says
    `"area R = 3.434" disagrees with the figure — the geometry gives 3.434`,
    two equal-looking numbers. It is correct (the stated value is compared
    at the shared tolerance, and 3.434 is the rounded 3.43363…), but a
    later change to `checkMeasure`'s message, for every measure, could say
    so when the stated value equals the printed one: "that is the rounded
    value; state it to full precision, write it symbolically, or use
    `@scale: false`".

---

## Working practice that worked

- **Subagent-driven execution** with a plan per phase, one Opus agent owning a
  whole phase end to end, then an independent review agent. Cheaper and better
  than driving task-by-task once plans got good.
- **Write plans for the executor you have.** Track 1's plan contained literal
  code for cheap transcribers. The geometry plans specify *decisions,
  interfaces and required test cases* instead, because over-specified code
  constrains a capable executor into a worse implementation.
- **The ledger at `.superpowers/sdd/<plan>/progress.md` is gitignored** and
  does not survive. Anything that matters belongs in a spec, a plan, a commit
  message, or this file.
- **Verify headline claims personally.** Several reports were accurate but the
  two that were not (a "hollow ring marker" that was actually a hole punched in
  the curve; "byte-identical output" measured from a cleared WebGL buffer) were
  only caught by looking.
