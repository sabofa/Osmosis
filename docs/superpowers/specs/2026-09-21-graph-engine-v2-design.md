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
| 3 | **Graph theme tokens**; **exact/symbolic values**; decide sandbox ownership | this spec (track 5 split; cross-cutting) |
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

**Values can be exact, and exactness comes from construction rather than from
guessing.** Every number the engine displays currently goes through
`formatCoord`, which produces a decimal. That is not a formatting preference;
it silently destroys mathematical content. A unit circle labelled `0.866`
instead of `√3/2` teaches nothing, a radian axis labelled `1.571` instead of
`π/2` is unreadable, and an intercept at `√3` shown as `1.73` has lost the fact
that it is exact.

A displayed value therefore carries an optional **exact form** alongside its
number. The closed set of forms is deliberately small — `(p/q)·√r·πᵉ`, with
`p`, `q` integers, `r` a squarefree positive integer (`r = 1` meaning no
radical) and `e ∈ {0, 1}`. That covers `1/2`, `√2`, `√3/2`, `2√5`, `π`, `π/6`,
`3π/2` and `0`, which is the range school and undergraduate work actually uses.
**Sums are out of scope** — `1 + √2` and `4 + 2√3` fall back to decimal — as
are `e`, logarithms and everything transcendental beyond π.

**Exactness is structural, never inferred.** An exact form exists only when the
thing that produced the value knows it: a literal `sqrt(3)/2` written in the
source, a π-scaled axis whose ticks are multiples of π by construction, a
closed-form triangle solver that produced `4√3`. The engine does **not** inspect
a float and guess that `0.3333333` was meant to be `1/3`. Inferring exactness is
a small and tempting feature that asserts something false about the mathematics
whenever it is wrong, and a wrong exact label is worse than an honest decimal.

```
@values: auto        # show exact where it is known, decimal otherwise (default)
@values: exact       # show exact where known; a value with no exact form is an error
@values: decimal     # always decimal, ignoring any exact form
```

`auto` is the default and changes nothing today, because nothing currently
produces exact forms; it begins paying off as producers are added. `exact` is
for figures where a decimal leaking through is a defect worth failing on.

One formatter serves every surface — tick labels, point and feature coordinate
labels, hover readouts, measure labels and table cells — so exactness cannot be
correct in one place and lost in another. Inside the engine the rendered form is
Unicode text (`√3/2`, `π/6`, `-2√5/3`); the formatter also exposes a LaTeX
string for hosts that can typeset it.

**Where this lands in the build order:** early, alongside theme tokens at step
3. Like them it is a contract rather than a feature — geometry's measure labels,
the unit circle, and calc-proofing's π-scaled trig axes and radical intercepts
all build against it, and retrofitting it means changing what a coordinate is
allowed to be after three tracks have assumed otherwise.

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

**Circle vocabulary, in full (2026-09-23).** v1 could draw a circle's outline
and nothing else, which is most of why circle geometry was unauthorable. The
vocabulary, with what each one is *for*:

| Construction | Why it is needed |
|---|---|
| `chord P-Q on O` | The basic circle segment; power-of-a-point and inscribed-angle work start here |
| `arc P-Q on O` | Minor/major arc as a drawn path, with a stated direction so which arc is meant is never ambiguous |
| `sector P-Q on O` | The filled wedge — area problems |
| `segment P-Q on O` | The region between a chord and its arc, distinct from the sector |
| `tangent at P on O` | The tangent line at a point of the circle |
| `tangent from P to O` | The two tangent lines from an external point; **two solutions, so it needs the same ordering rule as `intersect`** |
| `secant through P on O` | A line cutting the circle twice — the other half of power-of-a-point |
| `radius O to P`, `diameter P-Q on O` | Drawn as marked segments rather than left implicit |
| `inscribed angle P-Q-R on O` | The angle-at-the-circumference mark |
| `central angle P-Q on O` | The angle-at-the-centre mark, and the thing an arc measure names |

**Arc measure and radians.** An arc has a measure, and it is the measure a
problem asks about. `label: arc PQ` prints it, honouring `@angle` — so degrees
or radians, and **radians print as multiples of π once exact values land**
(`π/3`, not `1.047`). Until then they print as decimals like every other
measure. An arc's measure and its central angle are the same number, and the
engine should not let those disagree.

**Tangency needs a tolerance rule, not an equality test.** Whether a line
touches a circle is a floating-point question after any chain of
constructions. Use the shared `GEOM_EPS`, and make the near-miss case fail
legibly rather than drawing a "tangent" that visibly crosses.

Original summary line, kept for continuity — `chord`, `arc`, `sector`,
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

### Measure labels

v1 can only write a measure as free text — `angle: A-B-C label: 60°` — which
nothing checks against the figure. A constructive engine has already solved the
triangle, so refusing to print what it computed wastes the model's main
advantage.

```
label: AB               # prints the computed length
label: AB = 8           # prints 8, and FAILS if the computed length is not 8
label: AB = x           # prints "x" — a symbolic placeholder, no assertion
label: angle A          # prints the computed measure
label: angle A = 30     # prints 30, and fails if the computed measure is not 30
label: angle A = θ      # symbolic
label: arc PQ           # arc measure
```

**The `= <number>` form asserts.** A figure whose labels contradict its own
geometry is a wrong figure, and this is the cheapest possible way to catch one.
The assertion is suppressed by the not-to-scale flag below: under
`@scale: false` the stated value is printed and the computed value ignored,
which is exactly what that flag is for. The two features are designed together
— without the assertion the flag is meaningless, and without the flag the
assertion would make deliberately-not-to-scale figures unauthorable.

Angle measures honour `@angle: degrees|radians`, so `label: angle A` prints
`30°` or `π/6` depending on the mode — and `π/6` rather than `0.524` only
because exact values exist (see Cross-cutting decisions). This is the seam
where that contract earns its place.

### The unit circle

Absent from v1 entirely, and the central object of trigonometry teaching.

```
unit-circle:                    # the standard figure: circle, axes, special angles
unit-circle: angles 30          # mark every 30 degrees
unit-circle: angles pi/6        # the same, written in radians
unit-circle: mark 3*pi/4        # terminal ray, labelled point, reference angle
unit-circle: quadrant 1         # restrict to one quadrant
```

Draws the circle with marked special angles, each carrying both its angle label
(`π/6` or `30°`, following `@angle`) and its **exact** coordinates
(`(√3/2, 1/2)`), plus a terminal ray and reference-angle mark for any marked
angle.

**This feature is the reason exact values are a contract and not a nicety.** A
unit circle labelled with decimals is not a unit circle; it is a circle of
radius one with the interesting part removed. Do not build this before exact
display exists.

Works in figure mode and in graph mode — a unit circle drawn on real axes is a
different and equally common picture from one drawn on bare paper.

### Figure mode — a separate renderer, not hidden chrome

**Revised 2026-09-22.** Figure mode is not the plot renderer with its axes
switched off. It is **its own renderer**, selected the way `@mode: table`
already selects `TableView`: the three.js renderer is disposed entirely and a
figure view takes over. No camera, no canvas, no pan/zoom, no plot chrome —
because a geometry figure is paper, not a graph with things drawn on it.

**Figures render as SVG.** The deciding argument is text. A geometry figure is
mostly labels — vertex names, side measures, angle values — and in three.js
those are sprite atlases with hand-computed metrics, which is the entire reason
label layout is a specced sub-phase with a collision-scoring algorithm. In SVG
text is native and `getBBox()` gives real metrics, which collapses most of that
problem. The rest follows: a figure is tens of elements rather than thousands
of curve samples, so canvas's throughput advantage does not apply; dashed
strokes, arcs and tick marks are SVG primitives instead of hand-built geometry;
output is crisp at print resolution and embeds directly into a document page;
and there is no WebGL context to lose.

`@mode` therefore takes three values: `graph | figure | table`.

Figure mode locks 1:1 aspect, auto-fits with padding, and supports the "figure
not drawn to scale" flag that permits labels to disagree with drawn lengths.

#### Constructions stay shared

**The construction layer is maths and belongs to neither renderer.**
`midpoint`, `foot`, `intersect`, `bisector`, the triangle solvers and the
centres all produce plain coordinates, and **both renderers consume them**.

So `M = midpoint A-B` still works in graph mode beside `y = x^2`, on real axes,
with grid and numbers. "Geometry has no graphing interface" means the *figure
renderer* has none — not that constructions are banished from graphs.
Coordinate-plane geometry remains better served by v2 than by v1, which is the
commitment this document made earlier and still makes.

#### Selection is automatic, but declaring it is the house rule

Mode is inferred when not stated: a spec whose drawable content is entirely
geometry renders as a figure; a spec containing any plotted function
(`y = f(x)`, implicit curves, regions, polar, parametric, fields, scatter,
surfaces) renders as a graph, constructions included.

**Authors — and the tutor above all — should state the mode explicitly
anyway, including `@mode: graph`.** Inference is a safety net, not the
recommended path, and the reason is concrete: under inference, adding one
plotted function to a figure silently changes the entire presentation from
paper to plot. An explicit `@mode:` line makes that impossible and makes the
author's intent legible to the next reader. A spec that declares its mode
cannot be surprised by its own content.

This must be stated as a rule in `GRAPH-DSL-REFERENCE.md` and, more
importantly, in `server/src/domain/bootstrap.ts`'s condensed reference — the
one the tutor actually reads. Write it as hygiene the tutor is expected to
follow, not as an optional stylistic note.

#### Revision 2026-09-23: the figure view is navigable, not static

An earlier decision made the figure view deliberately static — no pan, no zoom,
no camera. **That is reversed.** A competition figure is dense enough that the
reader needs to get closer to part of it, and a figure that cannot be
manipulated is a picture rather than a tool.

The figure view gains pan and zoom over the SVG. This is cheaper than the
equivalent on canvas: panning and zooming an SVG is a viewBox transform, with
no redraw and no re-layout, so the figure stays crisp at any magnification
rather than resampling. Labels keep their on-screen size as the view zooms, the
same convention the plot renderer already uses for tick labels and markers.

What stays true from the original decision: the figure has **no plot camera**.
There are no axes, no grid and no world-coordinate readout. Navigation is
"move and magnify the drawing", not "change the plotted window".

#### Geometry notation, not just text

Labels must be able to carry real mathematical notation, because that is what
the subject is written in:

- **Segment** — an overbar: the segment through two vertices
- **Ray** and **line** — the corresponding arrow and double-arrow overmarks
- **Angle** — `∠ABC`; **triangle** — `△ABC`; **arc** — the arc overmark
- **Relations** — congruent `≅`, similar `~`, parallel `∥`, perpendicular `⊥`
- **Degrees** — `°`, and exact angle measures once exact values land

Overbars and arrow marks are drawn as SVG geometry above the glyphs rather than
composed from Unicode combining characters, which render inconsistently across
fonts and cannot be positioned reliably. The relation symbols are ordinary
characters and need no special handling.

#### A givens table

Dense figures reach a point where inline labelling makes them worse, not
better. The renderer therefore supports an optional **boxed panel** — placed in
a corner or beside the figure — listing given values and relations rather than
crowding them onto the drawing. This is the convention competition figures
already use, and it is the pressure valve for the label-density problem: when
placement gets hard, move some of it out of the drawing entirely.

Inline and boxed labelling coexist; an author chooses per label.

**Revised 2026-09-23: it is a table, not a list of lines.** The first
implementation stacked each given as one run of text inside a border. That is
a caption block, and it stops being readable at the length a competition
problem actually reaches. A statement of givens is tabular data — a subject, a
relation, and a value — and it should be set as one:

- **Aligned columns.** Subjects share a left edge, relations share theirs,
  values share theirs. Ragged rows are what makes a stacked list hard to scan.
- **An optional header**, so the box can say what it is (`Given`, `Find`).
- **Rules between rows**, or at minimum consistent row rhythm, so a long list
  stays legible.
- **Notation inside cells** — a cell holds `AB` with its overbar, `∠BAC`,
  `⊥`, `≅`, `≅`-marked congruences, all of it. Column alignment must measure
  the *rendered* run including its overmarks, not the bare glyphs, or the
  columns will be visibly off wherever a bar appears.

This is **not** the existing `@mode: table` data table, which exists to present
rows of data and belongs to a different part of the engine. A givens table is
part of the figure, sized and placed with it, and inside the same SVG.

**Sections.** A problem often states givens and then asks for something. The
table should support more than one section — conventionally `Given` and
`Find` — rather than forcing everything into one undifferentiated list.

#### Figures and tables share a view

`@mode` is currently one-of, which forces a problem containing both a figure
and a data table to choose. Real problems contain both.

So the renderer composes **panels** rather than selecting a single mode: a spec
containing geometry and table statements renders both, laid out side by side.
Mode selection still exists and still matters — it decides which renderer draws
the *drawable* content — but a table is additive rather than exclusive.

`@mode: table` keeps its current meaning of "table only", so nothing already
stored changes.

#### The complexity target is AIME / AMC 12, not SAT

This matters because it changes the renderer's requirements rather than just
its vocabulary. A competition figure is not a bigger SAT figure:

- **Element count is an order of magnitude higher.** Twenty to fifty objects in
  one configuration is normal — multiple circles, cevians, auxiliary lines,
  a dozen or more labelled points.
- **Label density is the binding constraint.** With twenty labelled points,
  naive placement is unreadable, and unreadable means wrong. Label layout is
  therefore **core to the renderer, not a later sub-phase** — the single
  decision most likely to determine whether this is usable.
- **Overlap is the norm, so draw order is semantic.** Fills must sit behind
  lines, marks behind points, labels above everything. SVG paints in document
  order, so the renderer emits explicit layers rather than relying on emission
  sequence.
- **Auxiliary construction lines are first-class**, usually dashed, and often
  outnumber the "real" figure.
- **Long construction chains accumulate floating-point drift.** A point derived
  through six steps and then tested for concurrency with another such point
  needs a tolerance policy, not exact comparison.

Vocabulary this target implies, beyond the SAT set already specced: excircles,
the nine-point circle, radical axes, power-of-a-point configurations,
internally and externally tangent circles, cevians and their concurrency,
cyclic quadrilaterals, and homothety/spiral-similarity constructions. Those are
later phases; what matters now is that the renderer is built to carry them.

#### 3D solids render through the same SVG renderer

The spec already decided that test-style solids are 2D drawings rather than 3D
scenes — computed as 3D geometry, projected through a fixed axonometric camera,
emitted as 2D lines with hidden-line convention. **SVG is the natural target
for exactly that**, and it means there is no third renderer: a projection module
turns 3D geometry into 2D primitives plus a visible/hidden classification, and
the figure renderer draws them, dashing what is hidden.

Competition 3D adds tetrahedra, skew lines, dihedral angles, inscribed and
circumscribed spheres, and cross-sections of all of them — but none of it
changes the pipeline, only what feeds it.

#### A side benefit worth designing for

SVG elements are DOM nodes, so hit-testing and highlighting are free. Track 7's
tutor tools — "point at this", "mark that intersection", emphasis and spotlight
— are substantially cheaper against SVG than against a canvas, where every
interaction needs manual hit-testing against projected coordinates. Give
emitted elements stable identity (a data attribute naming the statement and
object that produced them) so that layer can address them later without a
second lookup mechanism.

#### A migration consequence to face deliberately

Inference changes how **existing stored questions render**. A v1 spec using
`polygon:`, `circle:`, `angle:` and `tick:` with no plotted function currently
draws on the graphing canvas with axes and grid; under inference it becomes a
bare figure. That is almost certainly the better picture — those specs were
drawing geometry onto a plot because there was nowhere else to draw it — but it
is a change to content already in the bank, not a new-content-only feature.

The escape hatch is an explicit `@mode: graph`, which restores the old
presentation exactly. Before this ships, existing geometry questions should be
swept and spot-checked rather than assumed fine.

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

*(Superseded 2026-09-25 by the glass rule — see "Revised 2026-09-25" below.)*
**Composite solids are limited to four canonical arrangements** — coaxially
stacked, embedded, coaxially subtracted, and face-adjacent — each with an
occlusion rule computed from the shared axis. General boolean solid modeling
with exact silhouette extraction is a CAD kernel and would consume the track.
Arrangements outside the set fail with a legible message naming the
requirement.

#### How solids are actually represented (2026-09-23)

The projection pipeline built in phase 2 models a solid as
`{ vertices, faces }` — a **polyhedron** — and classifies an edge as hidden
when every face meeting it turns away from the camera. That is exactly right
for a convex polyhedron and is the rule a textbook drawing follows. It is also
the whole of what exists, and it cannot express most of the vocabulary above.

**A cylinder has no edges in that sense.** Its outline is two lines and two
elliptical arcs; a sphere's is a circle; a cone's is two lines and an ellipse.
None of that is vertices-and-faces, and none of it fits the current
`ProjectedEdge`, which carries a straight segment only.

**Decision: two representations behind one interface.** Polyhedra keep
vertices-and-faces. Curved primitives carry their parameters and know how to
emit their own **analytic silhouette** under the camera. Both satisfy one
`outline(solid, camera)` contract returning drawn edges, and **that edge type
widens to carry arcs as well as segments**.

The alternative — facet curved solids into fine polyhedra so one code path
serves everything — was rejected. Faceting makes silhouettes visibly polygonal
the moment a reader zooms, which the figure view now lets them do; it generates
dozens of spurious facet edges that then have to be suppressed; and it discards
the crispness that chose SVG in the first place. A cylinder drawn as two lines
and two arcs is both correct and smaller than its faceted approximation.

**Hidden-line removal is only solved for convex solids.** The
every-adjacent-face-turns-away rule is wrong for a non-convex polyhedron, where
a front-facing face can still be occluded by another part of the same solid,
and it does not consider other solids at all. This is why composites are
pre-constrained to four arrangements with per-arrangement rules. A non-convex
single solid outside those arrangements is **out of scope**, and must fail
rather than draw something plausible and wrong.

**The camera is fixed, but not to one direction.** Free orbit stays rejected —
these are drawings. But a single fixed viewpoint is degenerate for solids whose
features align with the view direction. The engine therefore offers a small set
of **named viewpoints** (`@view: isometric | front | top | front-right`, or
similar), which preserves determinism and adds no camera control, while letting
an author escape a bad projection.

**Every primitive states its placement**, the same way a solved triangle does.
Constraints fix a solid's shape, not where it sits; without a stated convention
"deterministic" fails exactly as it would have for triangles.

#### Cross-sections and nets produce 2D geometry

This is the seam most worth getting right. A cross-section is a plane figure.
So is a net. Both are **3D input, 2D figure output**.

So the 3D layer is not a second renderer. It is a **producer feeding the
existing SVG figure renderer**, in two modes:

- **projected** — the solid drawn in axonometric with hidden edges dashed
- **true-shape** — the cross-section or unfolded net handed back as ordinary
  2D geometry, drawn by the same code that draws every other figure, and
  therefore able to carry measures, notation and labels for free

Getting this seam right makes cross-sections and nets nearly free once the
solids exist. Getting it wrong means building a second figure pipeline.

#### Build order within the solids work

1. **Polyhedra** — grammar, placement conventions, dimension labels with
   leader lines. The existing convex visibility rule already serves this, so
   prisms, pyramids and tetrahedra are reachable first.
2. **Curved primitives** — widen the edge type to carry arcs, then analytic
   silhouettes for cylinder, cone and sphere.
3. **Cross-sections** — plane ∩ solid, shaded in place and lifted out as a
   true-shape figure.
4. **Nets** — per-primitive unfolding templates with fold lines dashed.
5. **Composites** — the four constrained arrangements.

Each step is shippable alone, and step 1 by itself covers a large share of
what a test figure asks for.

#### Revised 2026-09-25 — two 3D engines, and the road to AIME

Steps 1–3 above shipped as phase 5. Measured against competition problems,
what they reach is AMC 10/12 early-to-mid: one solid, sitting at the origin,
described by its dimensions. This section **supersedes steps 4 and 5 above
and the four-arrangement rule for composites**, for the reasons below.

##### There are two 3D engines, and they are not to be confused

| | **space** | **solid figures** |
|---|---|---|
| Track | 3 | 2 (geometry) |
| Page kind | `space` | `figure` |
| Renderer | three.js + GLSL, orbitable | the SVG figure renderer, fixed named views |
| Content | surfaces, fields, curves, Calc 3, Physics C | polyhedra, round solids, constructions in space |
| Code | `scene/buildScene3d.ts`, `render/SceneRenderer3D.ts` | `figure/project3d.ts`, `solids.ts`, `silhouette.ts`, `crossSection.ts`, and what follows here |

They **share no code**, and neither is "the 3D engine". Say *space* or *solid
figures* in specs, plans, code comments and the tutor reference.

They do share two things an author sees, and both are fixed here:

**One author frame: z is up, in both.** Authors write coordinates and planes in
a right-handed frame with **z vertical** — the calculus convention, and the one
a competition solution uses when it sets up coordinates. The solid-figure
engine keeps its internal y-up frame (every existing byte depends on it) and
converts at the grammar boundary, in one module, by the cyclic map

```
author (X, Y, Z)  ->  internal (x, y, z) = (Y, Z, X)
```

A cyclic permutation is a proper rotation, and it fixes the (1, 1, 1)
direction — so the isometric camera views from the author's (+, +, +) octant,
which is the textbook drawing: X toward the viewer and left, Y to the right, Z
up. A primitive's width therefore runs along Y, its depth along X and its
height along Z. The shipped `cut: S by plane y = 1` becomes `plane z = 1`.

**Keywords belong to one engine.** `solid:` is the solid-figure statement;
track 3's double-integral statement is renamed `volume: under z = f over
region`. A 3-coordinate point is a *space* point by default and a *figure*
point in any spec that contains a solid or declares `@mode: figure` — the same
coordinates mean the same place either way, because the frame is shared.

**Keyword ownership, agreed 2026-09-26 between the two sides.** A line-start
`word:` keyword belongs to exactly one engine:

- **Space** (track 3, as built on `milestone-a/space`): `line:`, `plane:`,
  `cross:`, `project:`, `cylindrical:`, `spherical:`, `implicit:`, `contour:`,
  `frame:`, `osculating:`, `motion:`, `path:`, `trace:`, `tangent-plane:`,
  `gradient:`, `directional:`, `critical:`, `lagrange:`, `region:`, `volume:`,
  `riemann:`, `centroid:`. Space also claims these unkeyed forms: `NAME = region …`,
  `NAME = volume …`, the vector constant `NAME = <a, b, c>`, and multi-parameter
  and vector function definitions.
- **Solid figures and 2D geometry** (track 2): `solid:`, `segment:`, `angle:`,
  `right-angle:`, `tick:`, `cut:`, `section:`, and every existing geometry
  statement. Reserved for later phases: `fill:`, `net:`, `shortest:`, `dihedral:`.
- **The point-list rule.** No space keyword claims a statement whose operand is
  only a hyphenated list of point names (`A-B`, `A-B-C`, …), optionally followed
  by `dashed` / `plain`. Those stay with solid figures, so a drawn line, plane or
  polyline between named points can arrive there without renaming anything.
- **Plane operands stay geometry's:** `plane A-B-C`, named `p = plane …` and
  `by plane …` are unaffected by space owning the `plane:` statement.
- **Space never claims** `NAME = <solid-figure form>` (`solid`, point tuples,
  `midpoint`, `divide`, `foot`, `intersect`, `centroid`, `center of`, `plane`,
  `circumsphere`, `insphere`), nor an equation without `z`, so
  `x^2 + y^2 = 25` stays the 2D implicit curve.
- **Style clauses** (`opacity:`, `colormap:`, `mesh:`, `res:`, `width:`,
  `dashed`) are stripped only inside lines space has already claimed, never in
  the shared trailing-clause loop.

##### The missing layer is constructions, not features

Solids today are primitives with dimensions. There are no points in space, no
segments between them, no planes through them and no derived objects — which
is what phase 1 gave 2D. Competition 3D is almost entirely constructions on
named points: *the plane through the midpoints of AE, BC and CD*, *the foot of
the perpendicular from D to face ABC*, *the centres of the faces*. That is why
oblique sections alone would not reach AIME: they need midpoints, which need
3D points that can be addressed, which is also why a solid's named vertices
can be drawn but not measured.

Every construction needed is closed-form, so the **no-solver non-goal
stands**: midpoints, division, centroids, feet to lines and planes, line ∩
plane; a tetrahedron from six edges placed by a stated convention (the D5
analogue) with a Cayley–Menger check that fails legibly when the edges cannot
close; a circumsphere as a 3×3 linear solve; an insphere as the face-area
weighted mean of the vertices.

##### Composites: the glass rule replaces the four arrangements

Competition composite figures — a sphere in a cube, a cube in a sphere, a
sphere in a cone, the insphere of a tetrahedron — are drawn with the solids
**transparent to each other**: each solid dashes only its own back, and the
inner solid shows through the outer one. The four-arrangement occlusion model
was aimed at opaque stacking, which is the rarer case and the wrong default.

- **Solids are glass to each other.** Each is drawn with its own convex
  visibility rule, exactly as today.
- **Construction lines are occluded by solids.** A point of a segment is
  hidden when the ray from it toward the viewer passes through the interior of
  any solid. For a convex solid this set is one interval along the segment,
  so a space diagonal draws dashed, a face diagonal on a front face draws
  solid, and a segment passing through a solid draws solid–dashed–solid. An
  author may force either style per segment.
- **Opaque coaxial stacking** (a cone on a cylinder) is the one arrangement
  needing occlusion between solids. It is deferred, and it is the easy case of
  it: the shared axis gives the occlusion boundary.

##### Placement by points

The origin-centred, axis-vertical convention stays for a standalone
primitive. A solid **defined by points** — a tetrahedron on ABCD, a sphere on
a centre, a cone on an apex and a base centre — is placed by those points and
inherits their determinism, as a solved triangle does.

##### The default view is not isometric (decided 2026-09-26)

Exact isometric looks along a cube's space diagonal. A cube's front and back
corners then project to **the same point**, and a regular tetrahedron
flattens to a rhombus whose altitude lies under an edge. Those are the two
most common competition solids. Phase 6 found this by looking at the drawings.
The rectangular-prism examples had hidden it, because 8×5×6 has unequal sides.

**The default camera is a fixed, orthographic view in general position,
named `standard`.** It looks from azimuth **30°** (measured from +X toward +Y)
and elevation **25°**, both in the author frame, with author Z drawn vertical,
at uniform scale 1. `isometric` stays as a named view with its exact
bytes, and front, top and side are unchanged. Measured at this camera:
- the closest two unit-cube vertices sit 0.49 apart on the page;
- every face of a regular tetrahedron stays at least 21° from edge-on;
- a tetrahedron's altitude projects at least 8.7° away from every edge.

The placement conventions are fixed against **the default camera, not the
active view**, so switching `@view:` never re-letters or re-orients a solid:
- **Tetrahedron:** the first base vertex sits 15° round from the camera's
  azimuth rather than exactly facing it. Facing the viewer exactly puts the
  apex, the front vertex and the base centroid in one vertical plane with the
  view, which is the overlap above.
- **Prism and pyramid lettering, in textbook order:** ABCD run
  counter-clockwise seen from above. A is the front-left bottom corner, so
  the front face is ABFE and D is the hidden corner. E–H sit above A–D, with
  E over A. A pyramid's apex is E.

##### Revised build order (continues from phase 5)

6. **Construction core** — the z-up author frame; points, segments and
   derived points in space; solid vertices as real points; true-3D lengths;
   segment visibility against solids.
7. **Solids by points and general polyhedra** — tetrahedron on four points or
   six edges, prisms and pyramids over any polygon, frustum, octahedron, the
   convex hull of named points; round solids placed and oriented by points.
8. **Oblique sections** — planes through three points; polygon sections of
   any polyhedron; circles of a sphere; ellipses of a cylinder or cone
   (parabolic and hyperbolic cone sections still refuse).
9. **Inscribed and circumscribed solids** under the glass rule — insphere,
   circumsphere, spheres in cones and cylinders, tangency.
10. **Measures and marks in space** — angles between lines, line–plane and
    dihedral angles with their marks, skew-line distance with the common
    perpendicular, right-angle marks in space.
11. **Nets** — per-primitive unfolding with fold lines dashed, and the
    shortest-path-over-the-surface problems they exist for.

Exact values (build-order step 3) matter more here than anywhere: a
competition tetrahedron is given as √41, √80, √89.

**Deliberately out:** tori, liquid-level problems, and assemblies of unit
cubes. Each is its own machinery for a handful of problems.

### Build order within the track

Lines as objects -> derived points and solved triangles **(phase 1, done)** ->
**the SVG figure renderer** -> circle vocabulary and incircle/circumcircle ->
measure labels -> the unit circle -> label layout -> shading and boolean regions
-> solid primitives -> cross-sections and nets -> composite solids.

**The figure renderer moves up, to directly after phase 1.** It was originally
sequenced late, as "figure mode and label layout", on the assumption that figure
mode was chrome-hiding on the existing renderer. Now that it is a separate SVG
renderer it becomes the surface everything after it draws onto, and building
circle vocabulary, measure labels or the unit circle against the three.js
renderer first would mean building each of them twice.

Phase 1's construction maths is unaffected by that revision: `intersect`,
`centres`, `lines`, `solveTriangle`, `derive` and `objects` import nothing but
`Vec2` and the angle-mode config, so they already serve either renderer. Only
`sceneObjects.ts` and part of `buildConstructions.ts` are renderer-facing, and
those gain an SVG sibling rather than being replaced — the three.js path stays,
because constructions still render in graph mode.

Measure labels and the unit circle both sit after the circle vocabulary and
**both depend on exact values landing at step 3**. Neither can be built before
that contract exists: a measure label that prints `0.524` for `π/6`, or a unit
circle labelled in decimals, fails at the only job it has.

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
| Double integrals | `region:` (type I/II, shaded) and `volume: under z = f over region` (not `solid:`, which is the solid-figure statement) |
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
- Occlusion between solids beyond the glass rule and opaque coaxial stacking.
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
