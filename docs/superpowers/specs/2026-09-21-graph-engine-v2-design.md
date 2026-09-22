# Graph Engine v2

Date: 2026-09-21

## Context

`graph-engine` was built quickly, to work rather than to be right, and it
shows in four places at once: you cannot read a value off a 3D plot, the
feature-point system produces anonymous dots whose modes are
indistinguishable, geometry figures must be solved by hand before they can be
drawn, and the axis-label system throws away the author's own step as soon as
you zoom. Meanwhile Osmosis is expanding into an AI-tutor product where the
tutor authors figures over MCP and drives them live, which puts weight on the
engine it was never designed to carry.

This document is the master design for v2. It covers seven tracks. It
specifies in full the decisions that constrain the others — the document
model, parameter bindings, and the renderer split — and sketches the rest at
the level needed to keep the early tracks from foreclosing the later ones.
**Per-track implementation specs are written just-in-time, immediately before
each track is built**, so that a detailed flowchart spec written today is not
revised beyond recognition by the time the flowchart track starts.

Source of truth for v1 behavior is the code, not this document. Where this
document describes v1, it cites the file and line.

**Sibling spec:** `2026-09-22-document-engine-v2-design.md` covers the document
engine — the mode matrix, the markdown editor, the spreadsheet page, and the
text-encoding standard both engines obey. **This document owns the shared
document format**; that one references it.

## Build order

Revised 2026-09-22. This supersedes the earlier A/B/C milestone grouping. The
order interleaves engine work with the wider Osmosis build, because several
engine tracks are worth little until the surfaces that host them exist.

| # | Step | Owned by |
|---|---|---|
| 1 | **Milestone A — tracks 1-4** *(in flight)* | this spec |
| 2 | 2a — retention loop and identity backfill | Osmosis app |
| 3 | **Graph theme tokens**; decide sandbox ownership | this spec (track 5, split) |
| 4 | **D1-D3** — viewer/encoding, markdown editor, spreadsheet | document-engine spec |
| 5 | Sandbox build | Osmosis app |
| 6 | Shell docs, then shell + item presentation | Osmosis app |
| 7 | **Container / multi-page — the tie-in** | this spec (document model) |
| 8 | **Track 6, track 7, D4** — diagrams, live tutor, code pages | both specs |
| 9 | **Track 5 + D5 as one pass** | both specs |
| 10 | Homework and the rest | Osmosis app |

**After Milestone A the engine work pauses**, while the sandbox, items and the
rest of Osmosis are built out. Steps 7 onward depend on those surfaces
existing.

Within Milestone A, track 1 comes first: the live tutor tools selected for
track 7 depend on feature points being correct and typed, and tracks 2 and 4
both annotate features.

### What the revision changes

**Track 5 splits in two.** Its *theme tokens* move early, to step 3; the rest
of its customization and UI work moves late, to step 9. This is the right cut:
the token set is a **contract** that the document engine's D5 must share, so it
has to be settled before D1-D3 build against it, while the visual polish it
enables is only worth doing once there is a finished surface to polish. Step 9
pairs track 5 with D5 deliberately — a plot, a sheet and a page of prose in one
document must read as one object, which cannot be achieved by two passes months
apart.

**The container moves out on its own, to step 7.** The IR still takes its full
shape during Milestone A (see "What lands when"); only the serialized
multi-page container waits, and it now waits until after the shell exists to
open files with.

**D4 (code pages) detaches from D1-D3** and moves to step 8 alongside tracks 6
and 7, which suits it: an execution surface wants the diagram engine for
call-graph and data-structure rendering, and the live layer for tutor-driven
stepping.

### A sequencing consequence worth stating

**D3 lands at step 4, but the container that makes its headline feature work
lands at step 7.** The spreadsheet is specified as "the data page of the
document, whose defining property is that other pages read from it" —
`scatter from Data!A2:B40`. Cross-page references need multi-page documents.

So D3 builds the grid, the formula engine, the dependency graph and CSV import
against a single-page document, and the cross-page reference it exists to serve
cannot be demonstrated until step 7. That is workable, but it should be a
decision rather than a surprise: either D3 ships knowingly incomplete in its
most important dimension for three steps, or a minimal cross-page reference
mechanism is pulled forward with it.

## What v1 got wrong

These are defects with identified causes, not preferences.

**Feature points are detected from sampled output rather than from the math.**
`detectFeaturePoints` (`graph-engine/src/scene/detectFeaturePoints.ts`) finds
extrema by comparing consecutive entries of the sampled point array. For an
explicit `y = f(x)` curve, sorted left to right, that roughly works. Every
implicit curve — circle, ellipse, hyperbola, conic — is produced by
`traceImplicitCurve`, whose output is not in path order, so the detector emits
noise. Separately, every detected feature is emitted as
`{ label: null, style: 'outline' }` (`graph-engine/src/scene/buildScene.ts:117`),
so an x-intercept, a local maximum and an ordinary plotted point render as the
same anonymous dot. That is why `@points: none|intercepts|vertices|all` reads
as four settings with no visible difference: the modes differ, but their output
does not.

**The author's grid step is discarded on zoom.** `resolveStep`
(`graph-engine/src/render/grid.ts:41`) honors a fixed `@xstep` only while the
visible span holds between 3 and 14 divisions; outside that band it falls back
to `niceStep`'s universal 1-2-5 x 10^n ladder (`grid.ts:25`). A spec authored in
steps of 8 therefore shows steps of 10 as soon as you zoom out. There is also
no control for labels independent of axes — tick labels are drawn only when
`config.axes` is true — so "a graph with no numbers on it" is currently only
achievable as "a graph with no axes."

**Geometry figures must be solved before they can be drawn.** Every geometry
statement takes absolute coordinates. Drawing a regular hexagon means writing
six vertices as `3*cos(k*pi/3), 3*sin(k*pi/3)` by hand; drawing "right
triangle, legs 6 and 8, with the altitude to the hypotenuse" means computing
the foot of that altitude yourself before you can type the line. Test geometry
is specified by constraints and constructions, and v1 has neither.

**The 3D view has no chart layer at all.** In order of severity:

- `SceneObject3D` (`graph-engine/src/scene/types3d.ts`) has **no `color`
  field**, unlike its 2D counterpart. Two surfaces in one scene cannot be
  distinguished.
- There are **no numeric tick labels in 3D**. The frame is a fixed axis cross
  of length 6 plus a fixed 10-unit ground grid
  (`graph-engine/src/render/SceneRenderer3D.ts:9-10`), neither derived from the
  data. No value can be read off the plot.
- Sampling is hardcoded to `[-5, 5]` in both directions
  (`graph-engine/src/scene/buildScene3d.ts:11`) at a fixed 40x40 resolution
  (`:13`). A surface over any other domain cannot be plotted.
- Surfaces are one flat palette color under Lambert shading. Height, the
  primary information channel of a surface plot, is unencoded.
- Geometry is stored as `Vec3[]` — an array of JavaScript objects, 1,681 of
  them per surface today, which does not survive contact with real data.
- The 3D statement vocabulary is: surface, parametric surface, parametric
  curve, point, segment, ray. Contours, gradients, tangent planes, traces,
  vector fields and implicit surfaces do not exist.

**Neither engine supports logarithmic axes.** Noted here because it spans
tracks 3 and 4 and is easy to forget when specifying either alone.

## The document model

This is the decision that constrains every track, so it is settled first.

### Three layers

**Source.** The text DSL, unchanged in role. It remains what `graph_spec`
holds, what a tutor authors over MCP, and what a human reads and edits. This is
deliberate and load-bearing: a language model authors text well and authors
document trees badly, and the tutor is the primary author.

**IR.** A normalized, typed document model produced by the parser and consumed
by renderers, live patches, and the serializer. Internal; never hand-written.

**Container.** A file, which exists only when the document needs more than its
own text.

The DSL stays canonical **at the page level**; the document above it is
structured. This split was forced by the requirements rather than chosen: a
thing with pages, per-page camera state, overlays, shared parameters and
attached binary resources cannot be a string, while the content of any single
page is exactly the text a tutor would write.

### Pages

A document is an ordered list of pages. Each page has a kind, a source, an
overlay list, and a saved view:

```
document
  metadata      title, created, links to other documents
  bindings      document-level parameters
  resources     data grids, images, attachments
  pages[]
    kind        plot | space | figure | flow | text | sheet | code
    source      DSL text, markdown, or program source
    overlays[]  callouts, arrows, highlights
    view        saved camera / bounds
```

`plot` is the 2D graph, `space` the 3D view, `figure` geometry, `flow` a
diagram, `text` prose, `sheet` a spreadsheet, `code` an executable program. One
document can hold a 2D graph, a Calc 3 surface, a geometry figure, a flowchart,
a data sheet, a program and a page of explanation.

**A page is a unit of information, not a unit of length. There is no
pagination.** Pages never break by word count or height: one page is one graph,
or one 5,000-word document, or one sheet, or one program. The only thing that
creates a page is an author deciding there is a new thing. This is why the same
mechanism serves both a long research document and a lightweight presentation
deck — the deck's pages are short because its author made them short, not
because the format broke them up.

`text`, `sheet` and `code` are rendered by the document engine and specified in
its own spec; they are listed here because the format is shared. A `sheet` page
is also how a document supplies data to a graph page — `scatter from Data!A2:B40`
resolves against it exactly as a resource does — and a `code` page can emit a
graph spec into a `plot` page or write values into a `sheet`.

A consequence worth stating explicitly: **the document engine becomes the
renderer for `kind: text` pages.** The two engines stop being separate products
and become two renderers behind one document model. The document-engine side of
that unification is out of scope here and gets its own design.

### Bindings (parameters)

Named parameters are hoisted out of the spec body to the document level:

```
@param a = 5 range [0, 10] step 0.1
@param n = 3 range [1, 20] integer
```

This one mechanism serves four separate requirements, which is why it is
specified now even though the features that consume it are deferred:

1. **Live updates become patches.** `set a = 3.2` instead of resending and
   reparsing an entire spec, with rebuild limited to what depends on `a`.
2. **Sliders are free.** The binding table is the slider UI.
3. **Animation is a timeline over bindings**, identical across 2D, 3D,
   figures and diagrams — one mechanism rather than one per renderer.
4. **Parameters are shared across pages.** One `a` drives a curve on page 1
   and a surface on page 2, so a single control moves the same idea through
   multiple representations.

Track 4 leans on this hard: Riemann `n`, Taylor degree, and a secant's second
endpoint are all parameters whose whole pedagogical value is in being swept.

**Bindings are built in Milestone A; playback and slider UI are deferred to
track 7.** Retrofitting parameters into a document format later is expensive;
building a scrub bar later is not.

### Overlays

Callouts, arrows, highlights and spotlights are a **document layer, not DSL
content**. Three reasons: they are created interactively by a tutor mid-session,
they are added and removed individually rather than by rewriting a source
document, and they must behave identically over a 3D page, a diagram, and a
page of prose.

The DSL nonetheless gets an authoring path — `note: "vertex here" at (1,-2)` —
which compiles into the same overlay objects. One model, two authoring paths.

Overlays anchor in page coordinates and track the data through pan, zoom and
orbit, rather than sitting in screen space.

### Resources

```
@data vol from "surfaces/spx.csv"
surface from vol
```

Named resources live in the container and are referenced by name from the
source. This keeps the source readable while allowing data of a size that
cannot be expressed as DSL lines — a 500x500 grid is not a set of statements.

### Container format

The canonical file is a **zip container** (`source.txt` per page, `doc.json`,
`data/*`), on the same reasoning as `.docx`/`.xlsx`: binary resources belong in
binary, not in base64 inside JSON.

**A bare text file remains a fully valid document.** A figure with no data, no
timeline and no attachments *is* its source text: no envelope, no ceremony,
opens in any editor, and remains exactly what `graph_spec` stores today. The
container materializes only when a document acquires pages, resources or
overlays. This preserves the simplicity of "the text is the document" for the
common case, and every existing question keeps working untouched.

An asset in Osmosis's existing asset system can therefore *be* a document.

### Addressing

Diagram nodes are linkable: a node may point at another page, another
document, or an external reference, which is what makes a flowchart usable as a
roadmap and index rather than only a picture. The format reserves an addressing
scheme (`doc://<id>#page3`) for this. The link semantics themselves are part of
track 6.

### Classification

One container format. What a file *is* is derived from its contents rather than
declared:

```
kinds: ['text', 'flow']    # the set of page kinds present
class: 'mixed'             # derived label naming the common cases
```

| Pages present | Class |
|---|---|
| `text` only | `document` |
| `plot` / `space` / `figure` only | `graph` |
| `flow` only | `flowchart` |
| `sheet` only | `spreadsheet` |
| `code` only | `code` |
| more than one family | `mixed` |

Derived, so it can never disagree with the contents. For filtering, `document`
and `flowchart` group together as authored content. This is independent of the
user-set kind tag (source, resource, homework, test): what is inside is
computed, what it is for is declared. One click opens one viewer either way,
which reads the page kinds present and renders accordingly.

`sheet` and `code` are page kinds owned by the document-engine spec; they are
listed here because classification spans both engines.

### Text encoding

Both engines obey one standard, specified in full in the document-engine spec:
UTF-8 throughout, NFC normalization on ingest and save, **all offsets as Unicode
codepoint indices**, and anchors carrying their quoted text. Beyond-ASCII
support — Greek, the full mathematical operator set, Japanese — is a hard
requirement, and Unicode symbols in prose are a separate mechanism from KaTeX
typesetting for raised and structured math. Neither substitutes for the other.

### What lands when

The document model is specified in full here but is not built in one piece.

- **Milestone A builds the IR in its full shape** — pages, overlays, resources
  and bindings all present as structure — while only **bindings and
  single-page documents** are actually exercised. This is the cheap half, and
  it is what keeps tracks 1-4 from hard-coding assumptions that the later
  tracks would have to unpick.
- **Milestone C builds the container, multi-page documents, overlays and
  addressing**, alongside the tracks that need them: a document only becomes
  multi-page once there are diagram pages to put in it, and overlays only
  matter once a tutor can draw them.

A document with one page, no resources and no overlays serializes to exactly
the bare source text it does today, so Milestone A ships without a new file
format existing at all.

## Cross-cutting decisions

Recorded with their reasoning so they are not relitigated.

**Geometry is constructive with closed-form shape solvers, not a general
constraint solver.** The classic triangle cases (SSS/SAS/ASA/AAS/RHS) are law
of sines and cosines and need no solver. A general solver can return a
different-but-valid figure between runs and fails in ways nobody can act on.
Since the tutor authors these, determinism and legible local failures
("line B-C and circle O do not intersect") matter more than expressive
generality.

**3D keeps three.js for scene management and uses custom GLSL for what
matters** — surfaces, fields, path clouds, depth cueing, contours. "Custom
made" means owning the chart layer and the shading, not hand-rolling a
rasterizer. The look being complained about comes from stock
`MeshLambertMaterial` plus a missing frame; both are addressed without giving
up the parts three.js does well.

**Test-style solids are 2D drawings, not 3D scenes.** A cylinder in a test
figure is an ellipse, two verticals and a dashed back-arc: an axonometric
projection with hidden-line convention, deterministic, no camera, no lighting.
Solids belong to the figure renderer in track 2 and share nothing with track 3.
Internally they are computed as 3D geometry and projected, which is what allows
cross-sections, nets and composites to fall out of one model instead of four.

**The viewer is a viewer.** v1's graph and document viewers were both designed
around test-taking, with every other use a degenerate case. In a workspace that
is backwards. The viewer renders, navigates and selects, and has no knowledge
that questions exist; test features — author-set anchors, markers, jump-to-
question, gating — compose over it as a layer. The practical test is that the
viewer must be complete and pleasant in a workspace where no question, session
or attempt exists at all.

**Rendering is exposure, not evidence.** Viewing writes to exposure (`seen`,
`dwell_ms`), never to responses. A clicked node or a selected feature emits an
exposure event; only elicited input produces evidence. The engine emits events
and never decides what they mean. Correspondingly, **an exposure-limited page
must be able to collapse into an unreadable state** and reopen once its gating
outcome is recorded — a render state the engine has to support.

**Steps are an enhancement, never a requirement.** A server-to-browser push path
may be absent; `health` reports `push: true|false`, and when false the tutor
presents the finished spec once. **The engine must render a complete spec
correctly with zero steps.** Every stepwise or live behavior is layered on top
of a correct one-shot render.

**Extensions register renderers or widgets, never outcome shapes.** If the
engine grows a plugin point, it cannot touch the outcome path.

**The live protocol separates durable from ephemeral operations.** Overlays,
parameter values, revealed statements and snapshots are state: they ride the
existing nudge-then-refetch contract (`web/src/lib/liveEvents.ts`), so a
reconnect replays them and nothing is lost. Laser pointers, ghost cursors and
in-flight animation frames stream directly, are never persisted and are dropped
on disconnect. This adds real-time interaction without breaking the resilience
principle the live system was built on.

## Track 1 — Reading the graph

### Feature points, derived from statements

Features are computed from the statement, by kind, replacing the sampled-array
scan entirely:

| Statement kind | Method |
|---|---|
| `y = f(x)` | Roots by bracketing plus bisection on sign changes, refined by Newton. Extrema are roots of f', inflections roots of f'', via central differences on a refined grid |
| Conics / implicit | Solved analytically from coefficients: a parabola knows its vertex, an ellipse its center, foci and vertices |
| Polar | r = 0 crossings and extrema of r |
| Parametric | Extrema of x(t) and y(t) from derivative roots |
| Between statements | Intersections by bracketing on f - g, pairwise |

Feature kinds become distinct and named: x-intercept, y-intercept, **local
maximum and local minimum as separate kinds**, inflection, asymptote, hole,
conic center/focus/vertex, intersection, domain endpoint. Each renders with its
own marker treatment and an optional coordinate label.

```
@points: roots, extrema, intersections
@point-labels: coords
```

Pairwise intersection detection is also what the tutor's "show me where these
cross" tool calls in track 7.

### Hover snapping

Hover currently reports the nearest *sampled* point on a curve, so hovering a
parabola's vertex yields a value near the vertex rather than the vertex.
Snapping locks hover to a feature within a snap radius and reports its exact
value, with the marker changing appearance so that exact and sampled readings
are visually distinguishable. Features win ties against ordinary curve points
within a bias radius.

```
@hover: all | points | features | none
```

### Axis labels

Three currently-welded concerns come apart:

```
@axes: on           # the axis lines
@grid: on           # the gridlines
@labels: none       # numberless graph; axes still drawn
@labels: coarse     # major gridlines only
@label-every: 5     # label every 5th gridline
```

`@labels: none` is the no-clues mode. `@label-every` is the "only by fives"
mode.

### Step scaling

```
@step-mode: nice        # 1-2-5 x 10^n ladder (current behavior, default)
@step-mode: geometric   # the step doubles upward and floors at its own base
@step-mode: fixed       # never rescale, guarded against pathological counts
```

Under `geometric`, base 8 runs 8 -> 16 -> 32 -> 64 zooming out, and **zooming
in never goes below 8 at all** — the base is a floor, not just a starting
point.

Both halves of that exist for one reason, and it is pedagogical rather than
aesthetic: the mode is how an author withholds coordinates. A grid that
subdivides back to single units as the learner zooms in hands them the exact
values the question was meant to hide, so the floor is the feature and the
upward ladder is the concession. Every step stays a whole multiple of the
author's base.

A consequence worth stating: under doubling, base 10 runs 10 -> 20 -> 40 -> 80
and never reaches 100.

## Track 2 — Geometry v2

### Constructions

Points, **lines** and circles become first-class objects that can be
intersected with one another. Lines as objects is the structural fix: without
it, "the line through P parallel to AB" has nowhere to live, which is why the
parallel and bisector constructions are missing in v1 rather than merely
unimplemented.

```
m = line through P parallel to A-B
n = line through P perpendicular to A-B
b = bisector of angle A-B-C
p = perpendicular bisector of A-B
X = intersect m, n
```

Derived points: `midpoint`, `foot`, `intersect` (line x line, line x circle,
circle x circle), `centroid`, `incenter`, `circumcenter`, `orthocenter`,
`divide A-B at 2:3`, `reflect`, `rotate`, `translate`, `dilate`.

Solved shapes: `triangle` in the five classic cases, `right triangle`,
`rectangle`, `square`, `parallelogram`, `trapezoid`, `regular n-gon`.

Circle vocabulary — absent in v1 beyond the outline: `chord`, `arc`, `sector`,
`segment` (the region), `tangent at P`, `tangent from P`, `radius`, `diameter`,
central and inscribed angle marks, and `incircle`/`circumcircle` of a triangle,
which carry the correct radius (`r = Area/s`, `R = abc/(4*Area)`) and tangent
points. A center point without its circle is not usable.

Marks: parallel arrows (without which transversal problems cannot be drawn),
congruence ticks on angles as well as segments, multi-arc congruent angles.

Shading: `fill: A-B-C`, `fill: sector P-Q on O`, and boolean regions
(`fill: square ABCD minus circle O`) for "find the area of the shaded region."

The **ambiguous SSA case is expressible and is a strength of this model**:
intersecting a circle with a ray yields zero, one or two triangles
simultaneously, which is precisely the picture that answers "why can't this be
determined." A constraint solver would have silently picked one.

### Figure mode

`@mode: figure` renders paper rather than a plot: no axes, no grid, locked 1:1
aspect, auto-fit with padding, and the "figure not drawn to scale" convention
available as a flag that permits labels to disagree with drawn lengths.

**Constructions are orthogonal to mode.** `midpoint`, `foot`, `intersect` and
`bisector` all work in graph mode with axes and grid on, alongside `y = x^2`.
Mode controls chrome only. Coordinate-plane geometry is therefore better served
by v2 than by v1, not narrowed by it.

### Label layout

v1 offsets each label away from a polygon's centroid and caps the distance;
there is no global pass, so labels collide with edges, marks and each other.
v2 generates candidate placements per label, scores them against drawn geometry
and other labels, and selects a set. Self-contained and directly testable.

### Solids

Solids are computed as 3D geometry, projected through a fixed axonometric
camera, and emitted as 2D lines drawn by the figure renderer.

| Capability | Approach |
|---|---|
| Labeled primitives | Cylinder, cone, sphere, prisms, pyramid: silhouette plus visible/hidden edge classification, dimension labels with leaders |
| Cross-sections | Plane-solid intersection solved analytically per primitive; rendered shaded in place or lifted out beside the solid as a true-shape figure |
| Nets | Parameterized templates per primitive with fold lines dashed |
| Composite solids | Constrained composition only — see below |

Slicing a cone yields circle, ellipse, parabola and hyperbola: the same conics
the 2D engine plots, derivable from the figure that defines them.

**Composite solids are limited to four canonical arrangements** — coaxially
stacked, embedded, coaxially subtracted, and face-adjacent — each with an
occlusion rule computed from the shared axis. General boolean solid modeling
with exact silhouette extraction is a CAD kernel and would consume the track.
Arrangements outside the set fail with a legible message naming the
requirement.

### Build order within the track

Lines as objects -> derived points and solved triangles -> circle vocabulary and
incircle/circumcircle -> figure mode and label layout -> shading and boolean
regions -> solid primitives -> cross-sections and nets -> composite solids.

## Track 3 — 3D / multivariable

Target coverage: Calc 3, Physics C, and a designed-for-but-not-built path
toward quantitative finance.

### The frame

Replace the fixed axis cross and ground grid with a real **axis box**: three
back walls carrying gridlines, tick marks with numeric labels on the near
edges, axis titles, bounds computed from the data with nice-step, and walls
that auto-flip to stay behind the data as the camera orbits. This alone is the
difference between a blob and a chart.

Add `@bounds3d` and an aspect mode (`equal | auto | 1:1:0.5`), which fixes both
the hardcoded `[-5, 5]` domain and the "z spans 1000 while x spans 10, so the
surface is a wall" problem. **Orthographic projection by default**, perspective
opt-in: perspective converges parallel lines, which defeats reading values.

### Encoding information

- **Colormap** by height or by a fourth expression (`color: |grad f|`),
  perceptually uniform for magnitude and **diverging for signed data**
  (divergence, curl, signed P&L). With a colorbar, without which the scale is
  meaningless.
- **Contours on the surface**, plus the projected contour shadow on the floor.
- **Depth cueing** — distance desaturation, heavier near lines.
- **Drop lines and wall projections**, so a point in space has a recoverable
  (x, y, z).
- **Hover on surfaces**, not only on curves.

### Vocabulary

| Concept | Statement |
|---|---|
| Level curves | `contour: z = f(x,y) levels: 12` |
| Partial derivatives | `trace: z = f(x,y) at x = 2` |
| Tangent plane | `tangent-plane: z = f(x,y) at (1,2)` |
| Gradient | `gradient: f at (1,2)` |
| Critical points | `critical: z = f(x,y)`, classified max/min/saddle |
| Vector fields | `field3d: (P, Q, R)` with density, glyph scaling, normalization |
| Field lines | `streamline: field F from (x,y,z)` |
| Space curve frames | `frame: TNB on r(t) at t = 1`, curvature, osculating circle |
| Double integrals | `region:` (type I/II, shaded) and `solid: under z = f over region` |
| Riemann visualization | `riemann: under z = f over region, n = 12` |
| Triple integrals | `cylindrical:` / `spherical:` coordinate boxes and surfaces |
| **Implicit surfaces** | Marching cubes — one primitive retiring every quadric, level set and constraint surface |
| Lagrange multipliers | `lagrange: max f subject to g = c` |
| Flux / Stokes / Green | `flux: F through S` with normals and boundary curve |
| Cross products | `cross: a x b` drawing the parallelogram and result |

Physics C needs almost nothing beyond this: field lines, flux through a
surface, Gaussian and Amperian overlays, trajectories carrying velocity and
acceleration vectors, and torque as r x F are all applications of `field3d`,
`streamline`, `flux` and `cross`.

### Reserved for quantitative work

Designed for now, built later. These are the items that would be expensive to
retrofit:

1. **Data-driven surfaces** — `surface from data`, a matrix plus axis vectors
   rather than an expression. An implied-volatility surface comes from data,
   never from a formula.
2. **Typed arrays end to end** — `Vec3[]` becomes `Float32Array`. Cheap now,
   a rewrite later.
3. **Path clouds** — thousands of Monte Carlo paths in one batched buffer with
   alpha, rather than one `THREE.Line` per path, which is one draw call per
   path and degrades well before the thousands this needs.
4. **Interactive slicing** — drag a plane through a surface and read the
   cross-section curve.
5. **Log axes** — missing from both engines today.
6. **Time as an axis** — a surface evolving over t, which is where this track
   meets track 7.

Also reserved, cheap once data input exists: 2D distribution primitives
(histogram, density, empirical CDF) and linear-transformation visualization
(unit circle to ellipse under A, with eigenvectors marked).

## Track 4 — Calc-proofing the 2D engine

| Concept | Statement |
|---|---|
| Riemann sums | `riemann: f on [a,b] n = 8 method: left/right/mid/trapezoid` |
| Area between curves | `area: between f and g on [a,b]` |
| Solids of revolution | `revolve: f on [a,b] about x-axis` — representative slice on the plot, solid on a `space` page |
| Shell / washer | `shell:` / `washer:` — the slice that makes the method legible |
| Derivative definition | `secant: f from a to b`, sweeping b toward a into the tangent |
| Limits | `limit: f at a` — two-sided approach, holes, asymptotes |
| Epsilon-delta | `epsilon-delta: f at a` |
| Taylor | `taylor: f at a degree n` with error band |
| Series | `series: partial sums` |
| Arc length | `arc-length: f on [a,b]` |
| Polar area | `polar-area: r = f(theta) on [alpha,beta]` |
| Differential equations | `solution: through (x0,y0)` — RK integral curve on the existing slope field |
| Newton's method | `newton: f from x0` — iterations drawn |

Riemann `n`, Taylor degree and the secant endpoint are all parameters; each
becomes an animation for free once bindings exist.

## Track 5 — Customization and UI

**This track has not had a design pass.** What follows is a sketch from stated
intent, to be replaced by a real design before the track is built.

Stated intent: textured backgrounds and textured lines, custom colors, theming.

Existing foundation: `graph-engine/src/render/palette.ts` defines light and
dark palettes and `resolvePalette` already reads host design tokens off the
viewer's own container; the app has a theme editor, theme presets, and MCP
tools (`save_theme`, `list_themes`, `set_active_theme`). The engine is already
themeable in principle; what is missing is the vocabulary and the surface.

Candidate scope:

- **Paper and background textures** — grain, graph paper, engineering paper,
  blueprint, dot grid, isometric grid, rendered as a shader rather than an
  image where possible.
- **Line treatments** — sketch/hand-drawn jitter, chalk, ink bleed, pencil,
  tapered and variable-width strokes, richer dash patterns. This is shader
  work and is the direct beneficiary of track 3's custom-GLSL decision.
- **A graph theme as a token set** — background, paper, ink, minor and major
  grid, axis, an *ordered* series palette, point, hover, region fill alpha,
  and per-kind feature marker colors.
- **Series palette control**, including colorblind-safe orderings.
- **Typography** — axis and label fonts and sizes.
- **Visual weight** — a global thin/normal/bold scale on top of the existing
  canvas-size line-weight scaling.
- **Marker styles** per feature kind.
- **Grid styles** — ruled, dotted, crosshatch, polar, logarithmic.
- **Preset looks** bundling texture, palette, line treatment and type:
  textbook, chalkboard, blueprint, notebook, minimal.
- **A print/export theme** — high contrast, no texture, for printed worksheets
  and exported figures.
- **Per-document theme pinning**, so a figure looks identical wherever it is
  embedded.
- **Accessibility** — colorblind-safe palettes, contrast floors, and pattern
  fills as a redundant channel to color for regions.

**One gap found while surveying: there is no legend.** A spec with several
statements renders several colors with no key to them. That is as much an
information defect as a styling one and belongs in this track.

A theme must apply across every page kind, so that a diagram and a plot in one
document read as the same object.

## Track 6 — Diagram / flowchart mode

**Do not build flowcharts. Build a node-and-edge diagram engine** in which
"flowchart" is one preset of {layout algorithm + shape vocabulary}. The same
engine then yields state machines, trees, DAGs, call graphs and linked
structures, none of which are free if flowcharts are special-cased.

| Preset | Layout | Unlocks |
|---|---|---|
| `flow` | Layered, orthogonal edges | Control flow, if/while/for |
| `tree` | Tidy-tree (Reingold-Tilford) | BSTs, heaps, parse trees, recursion trees |
| `automaton` | Layered with self-loops | DFA/NFA, accept states, epsilon transitions |
| `dag` | Layered | Dependency and build graphs |
| `graph` | Force or manual | Weighted graphs, MST, network flow |
| `sequence` | Lifelines | Message passing, protocols |
| `manual` | Author-placed | Anything the layouts get wrong |

Layout is where diagram engines are good or garbage. Recommendation: embed a
mature deterministic layout library for `flow`/`dag`/`automaton`, and hand-roll
tidy-tree, which is short and markedly better for trees than generic layered
layout. Determinism matters for the same reason it does in geometry — the tutor
generates these.

Core features: role-based shape vocabulary; **orthogonal routing with correct
back-edges**, which is what generic layouts render worst and which every loop
needs; **self-loops**, non-negotiable for automata; edge labels with
collision-aware placement; titled subgraphs and clusters; swimlanes; **trace
highlighting**, marking a path through the diagram; step-through of a trace;
and a state panel beside the diagram showing variables, a stack or an array per
step.

Second tier: node state badges for algorithm walkthroughs; code-to-diagram
linking with pseudocode beside the figure; tree, graph-algorithm, automaton and
linked-structure specializations; and dual rendering of one model as either a
diagram or an adjacency table, reusing the existing table mode.

Later: pseudocode-to-flowchart generation, which has the highest ceiling of
anything in the track for a tutor; sequence diagrams; railroad diagrams;
before/after diffs; and interactive quizzing that blanks an edge label or node
so the diagram becomes an answerable item, which matters uniquely for Osmosis
since a figure that cannot be answered is not an item.

**Node selection is reported.** Clicking a node reports which node was selected,
as an event the host consumes. Its first consumer is the unit map — a node graph
of a unit's concepts — where selecting a node navigates or focuses. Per
Cross-cutting decisions, a selection is an exposure event, not an answer, unless
something above the engine explicitly asked a question.

Nodes are linkable (see Addressing), which is what makes a diagram usable as a
roadmap over other documents and research.

## Track 7 — Live tutor layer

`update_show` (`server/src/domain/shows.ts`) already replaces a graph show's
spec in place and emits `show_updated` over SSE. The transport exists; what is
missing is that the channel carries whole spec strings and therefore cannot
express pointing, marking, or moving.

The channel becomes **operations** — `set-param`, `add-overlay`, `set-view`,
`mark`, `measure` — split into durable and ephemeral as described in
Cross-cutting decisions.

**Stepwise building and multi-page are one capability.** A tutor calling
`update(item_id, payload)` to build a graph in steps while it explains, and a
learner paging through a file whose pages are the same graph under different
callouts, are the same sequence of states with different drivers — live in one
case, learner-paced in the other. They are designed and built together; doing
them separately would produce two mechanisms for one idea.

**Degradation is mandatory, not best-effort.** When `health` reports
`push: false`, the tutor presents the finished spec once and no step ever
arrives. The engine's correct one-shot render is therefore the base case, and
the stepwise path is an enhancement over it.

**Selected for the first version:**

*Attention and annotation* — world-anchored arrows that survive pan and zoom;
callout bubbles anchored to a point, curve or node; emphasis and spotlight;
laser pointer and ghost cursor (both ephemeral); redirecting the learner's
camera with an animated rather than cut transition; and follow mode until the
learner takes control.

*Feature marking and measurement* — live intersection detection between
statements, recomputed as parameters change; "mark the vertex / intercept /
inflection / asymptote" by name, resolved by track 1's feature engine;
distance, slope, angle and area-under-curve measurement with values displayed;
and pinned coordinate readouts.

**Deferred:** parameter sweeps, partial curve drawing with pause, tweening,
keyframes and learner-facing playback; and the interactive handback cluster
(draggable points, learner sliders, "your turn" tools, click-to-identify,
predict-then-reveal). Both are deferred as *builds*, not as designs — bindings
land in Milestone A, and geometry's construction model makes a dragged point
merely a construction input changing.

**Session snapshots** deserve separate mention: a show currently dies with its
session. Snapshotting a live state as a page in the learner's own document is
what lets a tutoring session leave behind something durable.

## Backlog — specced later

**Number-line mode (`@mode: numberline`).** A one-dimensional presentation of
an inequality's solution set: a horizontal axis with a **filled** endpoint dot
for an inclusive bound, an **open** dot for a strict one, and shading along the
ray or interval. This is how "graph the solution set" is actually asked, and it
is a different renderer from 2D region shading rather than a tweak to it.

State what already exists so it is not rebuilt by accident: in 2D a strict
inequality already draws a **dashed** boundary and a non-strict one a **solid**
boundary (`graph-engine/src/scene/buildScene.ts`'s region builder). That is the
2D convention and it works today. The 1D convention does not exist at all.

Needs its own spec before building: an axis renderer, endpoint markers,
interval and ray shading, and compound forms (`x < -2 or x > 5`,
`-2 <= x < 5`). It depends on chained-inequality parsing, which track 1's
follow-up work adds.

## Non-goals

- A general geometric constraint solver.
- General boolean solid modeling (CSG) or general polyhedron unfolding.
- Composite solids outside the four canonical arrangements.
- An IR-canonical document in which the DSL is merely one front-end; the source
  text stays canonical at the page level.
- A hand-written WebGL rasterizer.
- Document-engine redesign, which is acknowledged as coupled here and specified
  separately.

## Open questions

1. **Geometric step scaling for base 5.** The rule is read as multiply-by-base,
   making base 5 run 5 -> 25 -> 125 rather than 5 -> 50 -> 500. Both stated
   examples (8 -> 64, 10 -> 100) fit multiply-by-base, but the 5 case was not
   stated and is the one where an alternative reading exists.
2. **Track 5 needs a design pass** before it is built; the section above is a
   sketch from stated intent, not a design.
3. **Diagram-node link semantics** — what a link does when followed, and
   whether a document may embed another document's page by reference rather
   than linking to it — is deferred to track 6's own spec.
