# Calc P3 — Implicit Curves and Regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 140×140 marching-squares grid in the 2D plot path with an interval quadtree. Implicit curves come out as certified chains; regions come out as exact even-odd outlines whose boundary curves are the same geometry. Then, with every 2D plot object overscanned, let a gesture transform the last picture instead of resampling it.

**Architecture:** A new directory, `plot/implicit/`:
- `quadtree.ts` subdivides cells the twin cannot clear, down to leaves.
- `contour.ts` finds crossings at each leaf by bisection, keyed by edge, rejects poles, pairs saddles with the asymptotic decider, and recognises crossings and touch points.
- `chains.ts` joins leaf pieces into chains.
- `region.ts` runs the three-valued condition per cell, clips leaves, and assembles the outline by cancelling edges.
- `implicit.ts` (`sampleImplicit`) and `regions.ts` (`sampleRegion`) are the statement-level entry points, like P2's `sampleCurve`.

`scene/buildScene.ts` sends `implicit`, `region` and `regionChain` statements to them. The renderer gains outline triangulation with holes and dashed chains. The viewer gains transform-during-gesture.

**Tech Stack:** TypeScript 6, Vitest, three.js (renderer only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`:
- "Implicit curves and regions (P3)", including "Decided before P3";
- "The scene contract";
- "The interaction budget";
- "As built (P2)";
- "Testing and verification".

P2 is complete on this branch. Its ledger, `.superpowers/sdd/2026-10-03-calc-p2-adaptive-sampler/progress.md`, holds the parked minors and the rulings P3 inherits. Read its `Ruling:` lines once.

## Global Constraints

**Where you may work**
- **Working tree:** `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, branch `milestone-a/calc`. Run commands from `graph-engine/`.
- **Never edit** `graph-engine/src/space/`, `graph-engine/src/figure/`, `scene/buildScene3d.ts`, `render/SceneRenderer3D.ts`, `server/` or `web/`. Space imports `render/marchingSquares.ts`, so that file stays, unchanged.
- **`math/` is read-only** (P2 already added its one counter).
- **Shared files are edited additively:** `parser/*`, `examples.ts` and its test, `GraphViewer.tsx`, the handoff, and `GRAPH-DSL-REFERENCE.md` (repo root).

**The rules that don't bend** (spec):
1. Nothing is connected unless certified. A crossing joins a chain only through a bisected crossing shared by edge key, never across a pole or an undefined cell.
2. Errors are never silent, and notes are true.
3. Deterministic: no `Math.random`, `Date` or `performance.now` in `math/` or `plot/`, tests included.
4. Generic marks with identity.
5. Nothing else moves: the figure goldens, space, and existing tests stay green, except those that pinned v1's marching-squares defects, each replaced with a note.

**The twin's consumer contract** (`math/interval/index.ts` header) binds:
- the discard rule `lo > 0 || hi < 0 || lo > hi`;
- empty = NaN everywhere;
- pass both the x and the y box;
- never one evaluation inside another.

**Numbers.** Leaves are about 1 px at FULL and 4 px at COARSE, with 25 % overscan. Every tuned number lives in `plot/implicit/tuning.ts`, and the corpus pins the costs.

**Checks** after every task, all of them:
- `npx vitest run --maxWorkers=2` (Ben's PC is shared; never more workers);
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`;
- `npx oxlint src`;
- `npx tsx .sweep/scenes.mts`, which must print `identical 49; differ 0`;
- the contact sheet script (`npx vite-node graph-engine/scripts/calc-contact-sheet.ts <dir>`, from the repo root), which must exit 0.

**Working rules**
- Commits use explicit `git add`; never `git stash`. Each message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use the Edit/Write tools for repo files: no heredocs, no sed.
- No browser tools; the controller takes headless screenshots. Don't start servers.

---

### Task 1: The region contract and the renderer

Region outlines and dashed chains, drawn, with the old path still working.

**Files:**
- `scene/types.ts`
- `render/renderItems.ts` (+ test)
- `render/geometryGroup.ts` (+ test)
- `render/SceneRenderer.ts` (only if needed)
- `scene/buildScene.ts`: rename only

**Interfaces:**
- `SceneObject` gains the spec's region: `{ kind: 'region'; id: MarkId; outline: Chain[]; boundary: MarkId[]; color?: string | null }`.
- The legacy triangle region is renamed `{ kind: 'triangles'; triangles: Vec2[]; color? }`. It is emitted by the old marching-squares path only, until Task 5 removes it.
- `toRenderItems`:
  - **Region outlines:** triangulated with holes. Classify rings by containment depth: even depth is an outer ring, odd depth is a hole of its nearest even-depth parent. Then call `THREE.ShapeUtils.triangulateShape(outer, holes)` per outer ring.
  - **Dashed chains:** a `curve` with `dashed: true` becomes a dashed ribbon item. Add `dashed` to the `curve` `GeometryItem` and implement dashing in `geometryGroup`, the way segments already dash.

**Tests:**
- an annulus (two rings) triangulates to area 3π within 1e-9 relative;
- nested rings (a ring in a hole in a ring) triangulate correctly by area;
- a dashed curve produces the dashed geometry;
- the legacy `triangles` kind renders as before;
- every existing render test still passes.

---

### Task 2: The quadtree

`plot/implicit/quadtree.ts`, `plot/implicit/tuning.ts`, `plot/implicit/types.ts` (+ tests).

**Interfaces:**
- `subdivide(H: CompiledInterval, box: Bounds, leafPx: { x: number; y: number }, counter: EvalCounter, budget): { leaves: Leaf[]; capped: boolean }`, where `Leaf` is `{ x0, x1, y0, y1, verdict }`.
- The root is the view plus 25 % overscan on each side.
- A cell whose enclosure satisfies the discard rule is dropped. Otherwise it splits into four, until both sides are at most `leafPx`.
- Order is deterministic: depth-first, quadrants in a fixed order.
- Leaves keep their twin verdict.

**Budget and cost:**
- Interval evaluations are counted. At the cap, the remaining cells are returned as leaves at their current size, and `capped` is set.
- Cost follows curve length: test that `x^2 + y^2 = 25` uses roughly linear-in-perimeter evaluations (at most 20× the perimeter in px), not area.

**Tests:**
- leaves cover every true zero of H for circles, lines, `xy = 1` and `sin(x) = cos(y)` (sample the true curve densely; every sample lies in some leaf);
- `x^2 + y^2 = -1` gives no leaves;
- determinism;
- the cap.

---

### Task 3: Contouring a leaf and building chains

`plot/implicit/contour.ts`, `plot/implicit/chains.ts` (+ tests).

**Rules** (spec "Implicit curves" and "Decided before P3"):
- **Crossings.** Corner values come from the scalar H. A sign change along an edge is located by bisection on H, about 12 steps from a 1 px leaf, never by linear interpolation. Key each crossing by its edge (the edge's exact endpoint coordinates as a string key) so neighbours share it exactly. Cache crossings per edge key.
- **Poles.** Bisect the twin along the edge: a sign change whose sub-edge stays PARTIAL with an infinite bound down to machine width is a pole, and is rejected.
- **Saddles.** Two crossings on each of the four edges are paired by the asymptotic decider: the bilinear interpolant's value at the saddle point.
- **Crossings at an X.** When the saddle value is near zero relative to the corner values (threshold `crossRel` in tuning), emit an X through the saddle point: four segments meeting there.
- **Touch points.** A leaf the twin cannot clear, with no sign change at the minimum size, gets a few steps of local minimisation of |H| from the leaf centre, using the gradient from `math/diff.ts` `gradient` compiled with `compileScalar`. If `|H|/|∇H|` is under ½ px, it is a touch point. Adjacent touch points chain into a curve; an isolated one becomes a filled `mark` (role `'value'`).
- **Chains.** Leaf segments join by shared edge keys into open or closed chains. Orientation and the arc-length `param` follow "Decided before P3". Leaf pieces are clipped to the overscan box; vertices stay finite.

**Tests:**
- `x^2 - y^2 = 1` and `y^2 = x^3 - x`: every branch and component, every vertex within ½ px of the zero set (`|H| / |∇H|`);
- `(x^2+y^2)^2 = 2(x^2-y^2)`, `xy = 0`, `y^2 = x^2`: an X at the origin, with four arms meeting there;
- `(x-y)^2 = 0` gives the line; `x^2 + y^2 = 0` gives one filled point;
- `sin(x) = cos(y)`: the lattice, with saddles paired correctly (no arcs crossing over);
- `y - tan(x) = 0`: no segment within 1e-9 of a pole x;
- `x^y = y^x`: the line y = x and the curve crossing it near (e, e);
- `abs(x) + abs(y) = 1`: sharp corners (a vertex within ½ px of each of (±1, 0), (0, ±1));
- chains closed where the curve is closed (a circle is one closed chain);
- determinism.

---

### Task 4: Regions

`plot/implicit/region.ts`, `plot/implicit/regions.ts`, `plot/implicit/implicit.ts` (+ tests).

**Interfaces:**
- `sampleImplicit(left, right, where, view, scope, options): { objects; capped; stats; tested; defined }`.
- `sampleRegion(condition: Expr, comparisons: Comparison[], view, scope, options)` returns the same shape. Here `condition` is the whole condition (the comparison or chain, `and`/`or`, and the `if` clause), and `comparisons` lists each comparison's `H = a − b` and its operator, for crossings and dashing.

**Rules:**
- **Three-valued cells.** The twin evaluates `condition` per cell: proven true, proven false, or ambiguous (anything possibly undefined is ambiguous). Proven-inside cells are kept whole, proven-outside cells dropped, ambiguous cells subdivided to leaves.
- **Leaf clipping.** A leaf polygon is clipped against each comparison in turn (Sutherland–Hodgman), using the shared bisected edge crossings from Task 3's cache. Undefined points are outside.
- **The outline.**
  - Whole cells' edges are split at leaf resolution.
  - Every kept piece emits its directed boundary edges (counter-clockwise).
  - Shared edges cancel by exact vertex keys.
  - The remaining edges link into rings.
  - An edge produced by a comparison remembers its index.
- **Boundary curves** are the outline edges on comparison zero sets, chained per comparison, `dashed` when that operator is strict. They are emitted as `curve` objects (ids `boundary.<k>`) and listed in `region.boundary`.
- **The `if` clause of an implicit curve** clips its chains: a segment is kept where the clause is proven true, or where its leaf clips it in. No centroid rule.

**Tests:**
- `1 < x^2+y^2 < 4`: the outline's even-odd area is 3π within 0.5 % at the default view, and both boundaries are dashed;
- `x^2+y^2 < 4 and y > 0`: area 2π, the arc dashed, the diameter dashed;
- `y < ln(x)`: no outline area at x ≤ 0;
- `xy > 1`: two components, dashed;
- `y >= x^2`: a solid boundary;
- fill and boundary agree: every boundary vertex lies on an outline edge;
- `x^2 + y^2 < 1 if x > 0` (a region with an `if`): the half-disk;
- an implicit curve with an `if`, `x^2 + y^2 = 4 if y > 0`: the upper arc only, ending at (±2, 0);
- determinism.

---

### Task 5: Into the engine

**Files:**
- `scene/buildScene.ts` (+ test)
- the viewer's quality wiring (`GraphViewer.tsx`, `SceneRenderer.ts`)
- tests pinned to marching squares: replace each, with a note

**Changes:**
- `traceImplicit`, `buildRegion` and `buildRegionChain` become calls to `sampleImplicit` / `sampleRegion`:
  - build the condition `Expr` from `op`/chain plus `where`, with `math/reserved.ts` `compare`/`and`;
  - pass `quality` and the pixel size as P2 does;
  - keep P2's notes ("undefined everywhere in view", "drawn coarsely", "not drawn").
- Remove `traceImplicitCurve`/`traceImplicitRegion` from `buildScene.ts`, along with the `resolution` parameter's use and `DRAG_RESOLUTION`. Keep the parameter in the signature, ignored and documented, so callers compile. Remove the legacy `triangles` kind and its renderer path.
- The slope field (`buildField`) samples over the overscan box, so it pans with the rest.
- `Scene.stats` includes these statements.

**Tests:**
- every spec acceptance row through `buildScene`;
- an `and` region from the existing buildScene tests, retargeted;
- strict versus non-strict dashing per side of a chain (`-2 <= x < 5`);
- examples still draw without errors.

---

### Task 6: Transform during a gesture

**Files:** `render/interaction.ts` (+ test), `render/SceneRenderer.ts`, `GraphViewer.tsx`.

**The rule** (spec "Decided before P3"):
- During a gesture, while the current view lies inside the overscan of the last build and its scale is within 1.5× of that build's (either way), the viewer does NOT rebuild: the camera transforms the last picture.
- Otherwise it rebuilds at COARSE.
- At settle, it rebuilds at FULL, as now.
- Ribbon widths that depend on zoom may lag until settle; that is accepted.

**Tests** (with the pure helper and a fake clock):
- a small pan inside the overscan triggers no rebuild;
- a pan beyond it triggers a COARSE rebuild;
- a 2× zoom triggers a rebuild;
- the settle rebuild is FULL;
- resize behaves as now.

Report the rebuild counts for a scripted pan sequence before and after.

---

### Task 7: Corpus, property test, contact sheet, docs

**Files:**
- `plot/testing/corpus.ts` (+ test)
- `plot/testing/conics.test.ts`
- `plot/testing/svgScene.ts` (regions with holes, dashed chains)
- `scripts/calc-contact-sheet.ts`
- `examples.ts`
- `GRAPH-DSL-REFERENCE.md` (repo root)
- the handoff

**Corpus:**
- every P3 acceptance row as cases, with pinned ceilings (about 1.5× measured, comments with the numbers);
- region areas, through the outline's even-odd area;
- no fill where undefined;
- a pan sequence for `y - tan(x) = 0` (no vertical lines in any view);
- known limits pinned as such, if any appear.

**The property test:** seeded random conics (circles, ellipses, hyperbolas, parabolas, degenerate pairs of lines) against their analytic shape:
- component count;
- the enclosed area for ellipses (via a region `<` statement);
- every vertex within ½ px of the zero set;
- runtime modest.

**Examples:** a "Curves and regions" subgroup in Calculus: the lemniscate, `sin(x) = cos(y)`, the annulus, `y < ln(x)` and a feasible region of a small system.

**Docs:** the reference describes implicit curves and regions as drawn now (crossings, touch points, dashed strict boundaries, undefined areas unshaded); the handoff gets a P3 paragraph.

---

## Self-review notes (for the executor)

- **Spec coverage:**
  - quadtree → T2;
  - bisected crossings, pole rejection, saddles, crossings, touch points → T3;
  - chains and param → T3;
  - three-valued regions, clipping, outline, boundary dashing → T4;
  - renderer outlines with holes and dashed chains → T1;
  - integration and the overscanned field → T5;
  - transform during a gesture → T6;
  - corpus and property test → T7.
- **Inherited from P2's ledger:** P3 keeps rule 1's every-half thinking (no connection without a bisected, shared crossing) and P2's truthful notes and counted budgets.
- **Coordination:** space still imports `render/marchingSquares.ts`, which stays unchanged. Whether space adopts the quadtree is space's choice; offer it at P3 close.
