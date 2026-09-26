# Handoff — Graph Engine v2, 2026-09-23

Written at a clean checkpoint for whoever picks this up next, including a
future me with none of this in context. It records the things that are **not**
recoverable from the code: why decisions went the way they did, what has
already been tried and failed, and which traps cost real time.

## Where things stand

**Branch `graph-engine-track-1`**, in the worktree
`.claude/worktrees/graph-track-1`. Working tree clean. **957 tests passing**,
`tsc -b graph-engine/tsconfig.json --noEmit` clean, `oxlint` clean.

*Last updated 2026-09-25, after geometry phase 5 (solids).*

Nothing is merged to `main`. Another agent works on `main` directly, which is
why this lives in a worktree — their commits were interleaving with mine and
breaking test runs mid-task.

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
- **Track 2 — geometry, phases 1–4.** Construction core (lines/points/circles
  as intersectable objects, derived points, triangle solvers, centres with
  their circles); the SVG figure renderer; measures, notation, navigation and
  panels; circle vocabulary and the givens table.

### Not started

Tracks 3 (3D/multivariable) and 4 (calc-proofing) — the bulk of Milestone A.
All of D1–D5. Track 2 beyond phase 5: **composite solids, nets, oblique
cross-sections**, shading and boolean regions, and the competition-specific
constructions (excircles, nine-point circle, radical axes, cevian concurrency).

### What each track-2 phase actually delivered

| Phase | Commits | What it means in practice |
|---|---|---|
| 1 | `b507767`..`c070b2d` | Constructions: a figure is *derived*, not hand-placed. `D = foot A to B-C` instead of computing the altitude's foot yourself |
| 2 | `06e16a3`..`7582783` | The SVG figure renderer. `@mode: figure` is a separate renderer, not axes switched off |
| 3 | `3781d6b`..`8f0eb54` | Measures (`label: AB` prints what the engine solved), notation (overbars, `∠`, `⊥`), pan/zoom, the givens panel, figure+table panels |
| 4 | `ff8580f`..`a98bdc7` | Circle vocabulary (chord, arc, sector, tangent at/from, secant, radius, diameter) and the givens **table** with sections |
| 5 | `5f09b6d`..`4977327` | Solids: the `solid:` statement, dimension labels, arcs in the edge type, analytic silhouettes, cross-sections |

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
`@view:` selects a named viewpoint; there is no free camera by design.

**The two decisions worth not re-litigating:**

*Curved primitives are not faceted.* `SolidBody.polyhedron` is `null` for them;
they emit an **analytic silhouette** instead — a cylinder as two lines plus a
front and a back elliptical arc. Faceting was considered and rejected: it goes
visibly polygonal under the figure view's zoom, generates spurious facet edges
to suppress, and discards the crispness that chose SVG. This is why
`ProjectedEdge` carries arcs as well as segments.

*Cross-sections hand back real 2D geometry*, which is the whole seam. The test
that pins it: a section of an 8×5×6 prism measures `PQ = 8` in its own plane,
while the projected edge is 8·cos30 = 6.93 — so a section returning projected
coordinates would silently assert the wrong number. Because the section is
genuinely 2D, it also picks up notation, tick marks and the givens table for
free.

**Hidden-line removal is convex-only**, and `SOLID_PRIMITIVES` is the only
route from a spec to a solid, so every solid reachable from the DSL is convex
by construction. The plan called for a runtime guard rejecting non-convex
solids; that would have been a branch no input can reach. The **invariant** is
pinned instead in `solids.test.ts` — every vertex on the inner side of every
face plane, with a deliberately dented cube alongside so the check cannot pass
vacuously. **If you add a non-convex primitive, that test fails and it is
telling you the visibility rule no longer holds.**

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
crossSection.ts plane ∩ solid, serving both `cut:` and `section:`
```

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
npm run test --workspace=graph-engine          # 807 tests, node-only, no DOM
npx tsc -b graph-engine/tsconfig.json --noEmit
npm run lint --workspace=graph-engine
npm run review -- --port 5181 --host 100.90.203.2   # from the worktree
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

### 5. The commit trailer is a fixed string

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
   declare-your-mode rule landed there; nothing else has.
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
7. **Solids beyond phase 5** — composite solids (the four constrained
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

8. **Solid vertex names are drawn but not measurable.** `S = solid prism
   8 by 6 by 10 vertices ABCDEFGH` labels the drawing, but `label: AB` then
   fails with *"Unknown point A"*, while `label: PQ` on a **lifted section's**
   vertices works. Plausibly deliberate — a solid's vertices are 3D, so the
   measure would be the true distance rather than the projected one, and the
   dimension form (`label: S width`) exists for that — but it is asymmetric
   and surprising immediately after naming them. Either register them with
   true-3D measures, or reject with a message that says why and points at the
   dimension form.
8. Minor, recorded: intersections have no secondary sort key;
   `conic-vertex`/`local-max` and `focus`/`intersection` share marker shapes
   (latent — nothing emits the conic kinds); `x = f(y)` gets no feature points;
   tangencies are not detected by intersection finding (sign-change based), and
   **track 7's "show me where these cross" will inherit that silent miss**.

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
