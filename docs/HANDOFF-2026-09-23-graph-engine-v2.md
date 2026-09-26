# Handoff — Graph Engine v2, 2026-09-23

Written at a clean checkpoint for whoever picks this up next, including a
future me with none of this in context. It records the things that are **not**
recoverable from the code: why decisions went the way they did, what has
already been tried and failed, and which traps cost real time.

## Where things stand

**Branch `milestone-a/geometry`**, in the worktree
`.claude/worktrees/milestone-a-geometry` (renamed 2026-09-26 from
`graph-engine-track-1` / `graph-track-1`; see "Worktrees, milestones and parallel
agents" below). Working tree clean. **1599 tests passing**,
`tsc -b graph-engine/tsconfig.json --noEmit` clean, `oxlint` clean.

*Last updated 2026-09-26, after geometry phase 9 (inscribed and
circumscribed spheres, and tangency).*

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
| `milestone-a/space` | `.claude/worktrees/milestone-a-space` | Track 3: **space** (three.js, Calc 3, Physics C) — a separate agent |
| `milestone-a/calc` | later | Track 4: calc-proofing the 2D engine |

**More than one agent works at once.** Expect branches, worktrees, stash
entries and review servers you did not create. Do not investigate, clean up,
pop or drop any of them. Stay in your own worktree, stage with explicit
`git add <paths>` (never `-A` / `.`), and never use bare `git stash` /
`git stash pop`. If a file in *your* worktree changes under you, stop and
report it.

**Review servers, one port per side,** all on the Tailscale IP:
`milestone-a/geometry` on **5181**, `milestone-a/space` on **5182**.

**The two 3D engines share no code.** *Space* is `scene/buildScene3d.ts`,
`render/SceneRenderer3D.ts`; *solid figures* is everything under
`graph-engine/src/figure/`. Never write "3D engine" alone. Fixed between them
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
- **Track 2 — geometry, phases 1–8.** Construction core (lines/points/circles
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
  and a named dimension.

### Not started

Tracks 3 (3D/multivariable) and 4 (calc-proofing) — the bulk of Milestone A.
All of D1–D5. Track 2 beyond phase 9: build steps 10–11 of the spec's
"Revised 2026-09-25" section (measures and marks in space, nets),
shading and boolean regions, and the competition-specific constructions
(excircles, nine-point circle, radical axes, cevian concurrency).

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

**Two 3D engines, and they share no code.** *Space* is track 3 — three.js,
orbitable, calculus (`scene/buildScene3d.ts`, `render/SceneRenderer3D.ts`).
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

### Contracts worth knowing before you edit

- **`renderFigure(statements, config, palette) → { svg, errors }`.** Errors are
  returned, not thrown — one bad statement must not blank the figure.
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
npm run test --workspace=graph-engine          # 1599 tests, node-only, no DOM
npx tsc -b graph-engine/tsconfig.json --noEmit
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
   too. **As of phase 8, by three**: planes as objects and oblique sections. **As of phase 9, by four**: inspheres, circumspheres, spheres by tangency and `center of`. The user has scheduled the tutor reference for much later.
   The house rule "declare `@mode:`" matters doubly for solid figures: under
   S5 a spec of 3-coordinate points with no solid still infers the *space*
   renderer, so a tutor sketching points in space before adding the solid gets
   a different renderer until it declares `@mode: figure`.
2. **Migration sweep of stored geometry questions.** Mode inference changes how
   v1 `polygon:`/`circle:`/`angle:` specs render — bare figure instead of a
   plot with axes. Almost certainly better, but it is live content and the spec
   asks for a sweep. `@mode: graph` restores the old rendering.
3. **`r = bisector of angle A-B-C` silently parses as a polar curve.** The
   polar grammar claims any `r = <expr>`. Any construction bound to a name the
   plotting grammar reserves is silently misread — no error, wrong figure.
   Pre-existing; the grammar should disambiguate or reject.
4. **Scientific notation fails silently.** `y = 1e6 * x` lexes `1e6` as
   `1 * e6` with `e6` unbound, producing **no curve and no error**. Pre-existing,
   and it will bite quant work.
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
    cone or frustum (refused, naming the conic); nets (`net:` is refused,
    build step 11). ~~Inscribed and circumscribed solids are build step 9~~
    (**done in phase 9**, for spheres); angle and dihedral marks step 10.

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
