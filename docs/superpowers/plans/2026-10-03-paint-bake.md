# The Baked Painting: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** With the key light fixed in the world, paint the whole figure once, in world space, in the worker. Every frame, including every frame of an orbit, then only selects, sizes, projects and draws the baked strokes on the main thread in a few milliseconds. Ben: "precompile the full painting, then when I move around it's instant".

**Architecture.**
- The per-frame model (`space/paint/model/`) analyses a G-buffer each frame. The bake (`space/paint/bake/`) does the same painter's analysis on the meshes themselves:
  - a refined surface per mesh;
  - a CPU shadow caster and occlusion;
  - the value plan per vertex;
  - world planes and edges;
  - strokes walked on the surface;
  - the underpainting per vertex.
- `FrameFromBake` turns the bake into an ordinary `StrokeBatch` per view.
- The renderer gains:
  - a surface pass for the baked underpainting;
  - a hidden-dashed pass for data lines.
- The lab engine bakes in the worker and frames on the main thread.
- The per-frame model stays exactly as it is. It still serves the camera-relative light (`light.worldFixed` = 0) and the debug views.

**Tech stack.** TypeScript, hand-written WebGL2 (no three.js), vitest, Vite (review server). Colour is OKLab/OKLCH. Randomness is seeded with `randomFor` (`graph-engine/src/style/random.ts`).

**Spec.** `docs/superpowers/specs/2026-10-02-painted-figures-design.md` §14, which builds on §3 (the model), §12 (the value plan) and §13 (live orbit).

**Contract.** `graph-engine/src/space/paint/bake/types.ts` and `StrokeBatch.hidden` in `space/paint/types.ts` (the contract commits on `milestone-a/paint-bake`). Read it before any task. It holds the sizing, sides, mix levels and the per-mark refined surfaces.

**Digest of the current model.** `C:\Users\benif\AppData\Local\Temp\claude\C--Users-benif-Osmosis\62922336-0adb-4fad-84cc-c1ecb60fcb27\scratchpad\bake-plan\model-digest.md` lists:
- what each step of the per-frame model reads;
- which steps are already view-free;
- which steps need world inputs;
- which steps must be redesigned.

Read it with the code. Line numbers are as of 8b6b022.

## Global Constraints

**Determinism**
- Same scene, particles, params, light and reference scale give a byte-identical bake.
- Same bake and view give a byte-identical frame.
- Every random number goes through `randomFor`. Never use `Math.random`, `Date` or `performance.now` in model or bake code.

**Isolation**
- Only `space/gl/` and `space/paint/gl/` touch WebGL. `space/boundary.test.ts` holds this.
- The bake runs without a DOM or GL (it runs in a worker, and in Node for tests).
- No new runtime dependencies.

**The per-frame model is unchanged**
- `paintFrame`, `recolourFrame` and `buildParticles` give byte-identical results to before. The one exception is that `buildParticles` gains the two new arrays (Task 1).
- Pure functions may be shared or exported; their behaviour must not move.
- A frame-hash guard test (Task 1) pins this for three fixtures.

**Ben's painter rules hold in the bake as they hold per frame** (spec §3, §12):
- Every shadow-family stroke or underpainting colour is darker than the family bound. The light family is lighter than its own bound: `holdLightness` at the family bound, as `packStrokes` does.
- A shadow's hue stays within `curve.shiftMax` + 3° of the local hue before the brush-load mix. Mix offsets and plane steps sit outside the cap by design.
- Edges get the lost/soft/firm/hard classes by the hardness rules.
- The brush-load mix is spatial (by surface cell) for surface roles.
- **Reuse, don't copy.** Call the model's own pure functions so a fix there reaches the bake: `planSample`, `lightWeight`, `effectiveValues`, `curveFor`, `colourOfDraft`, `holdOf`, `holdLightness`, `LoadMixer`, `edgeHardness`, `edgeClassOf`, `smoothClasses`, `behaviourOf`, `brush.ts`, `stepValue`'s formula, `veilOf`, `groundMarks` and `meshArea`.

**Units**
- Every px parameter (role lengths and widths, `occlusionRadiusPx`, `planeMinPx`, `edgeReachPx`, `dabMinPx`, `scumbleMinPx`, `loadBreakPx`, `LINE_MAX_PX`, edge step 2 px) becomes world units in the bake as px × `referenceWorldPerPx`.
- `referenceWorldPerPx` is the world size of one CSS px at the authored framing (`PaintView.zoom` 1). Tests use `1/300` unless stated.

**Load on Ben's PC**
- Use `npx vitest run --maxWorkers=2`. Run focused files while iterating and the full suite once at the end.
- Every headless Edge run has a timeout and kills its process tree.
- No browser tools and no in-app browser pane.
- Never use port 5182 (Ben's pinned view). Dev servers use 5189 and up.

**Typecheck**
- In `graph-engine/`: `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`. Bare `npx tsc --noEmit` checks nothing.
- The scene sweep stays 49/49 identical. The sweep script is `C:\Users\benif\AppData\Local\Temp\claude\C--Users-benif-Osmosis\62922336-0adb-4fad-84cc-c1ecb60fcb27\scratchpad\verify-main\scenes.mts`; run it with `npx tsx`.

**Git**
- Stage with explicit paths. Never use `-A` or `.`.
- Never use bare `git stash`.
- Don't touch `cli/bin/osmosis.js` (a line-ending artefact, not ours).
- Don't push or merge.

**Performance targets**
- `BakePainting` on the lab's showcase scenes: report the times. The target is ≤ 3 s per scene in Node.
- `FrameFromBake` at about 50k strokes: ≤ 5 ms median, measured by a bench script, never a wall-clock assert in a test.
- Use operation counts if a test must bound work.

---

## File structure

Everything new is under `graph-engine/src/space/paint/bake/`:

| file | responsibility | task |
|---|---|---|
| `types.ts` | contract (exists) | 0 |
| `surface.ts` | refined surface per mesh mark: conforming longest-edge bisection, canonical vertex ids, triangle adjacency, closed flag, a BVH, `locate` | 1 |
| `shadow.ts` | CPU shadow caster: visibility and occluder distance toward the world light, from the opaque meshes | 1 |
| `occlusion.ts` | world ambient occlusion per point | 1 |
| `plan.ts` | the value plan per refined vertex per side (`planSample`), adaptive refinement at family boundaries, sampling at a surface point | 1 |
| `planes.ts` | world planes: triangle clusters by world normal cell × zone, merged within a family by world area | 2 |
| `edges.ts` | world edge runs (terminator, cast shadow, plane boundaries, creases, borders), hardness and classes, `adjHard`, the edge field per vertex | 2 |
| `walk.ts` | the surface walk on a refined surface (world units, the model's stop rules) | 3 |
| `strokes.ts` | particle strokes per role and side, scumble mask, dabs, colours at each mix level | 3 |
| `edgeStrokes.ts` | strokes along the world edge runs | 3 |
| `lines.ts` | data-mark strokes (lines, arrow shafts, box edges) in world pieces | 3 |
| `underpaint.ts` | the underpainting per refined vertex per side | 3 |
| `index.ts` | `bakePainting`, `recolourBake`, the bake key | 3 |
| `frame.ts` | `frameFromBake`: selection, sub-arc, sizing, sides, order, data-mark shapes | 4 |
| `silhouettes.ts` | the per-frame silhouette strokes from the bake | 4 |
| `parity.ts` | (test support) the parity metrics against `paintFrame` | 4 |

Modified:
- `space/paint/types.ts`: `ParticleSet` gains `tri?` and `bary?`; `StrokeBatch` gains `hidden?`.
- `model/particles.ts`: fills `tri` and `bary`.
- `model/contours.ts`: exports `staticLines` and `silhouetteLines`' geometry part, behaviour unchanged.
- `space/paint/gl/*`: Task 5.
- `space/paint/session.ts`, the worker, `review/src/paintLabEngine.ts` and the lab UI: Task 6.

## Order and parallelism

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 6
                  Task 5 (gl, own worktree milestone-a-paint-bake-gl, from the contract) — any time after Task 1
```

- No more than two heavy agents at once.
- Task 5 merges into `milestone-a/paint-bake` before Task 6.
- Before Task 6 the controller merges `milestone-a/paint` (live orbit, `light.worldFixed`, values round 4) into `milestone-a/paint-bake`.

---

### Task 1: Refined surfaces, CPU shadows and occlusion, the world value plan

**Files**
- Modify: `graph-engine/src/space/paint/types.ts`. `ParticleSet` gets:
  - `tri?: Uint32Array`: the source triangle index into the mark's `indices / 3`;
  - `bary?: Float32Array`: 2 per particle, the weights b1 and b2 of the triangle's second and third vertices, as `TriangleHit` in `space/pick/bvh.ts`.
- Modify: `graph-engine/src/space/paint/model/particles.ts`. Fill `tri` and `bary` from the private `Draft`. No other change.
- Create: `bake/surface.ts`, `bake/shadow.ts`, `bake/occlusion.ts`, `bake/plan.ts`.
- Test: `bake/surface.test.ts`, `bake/shadow.test.ts`, `bake/plan.test.ts`, and `model/frameHash.test.ts` (the guard).

**Interfaces it produces** (later tasks rely on these names):
```ts
// surface.ts
export interface RefinedSurface {
  mark: number
  positions: Float64Array      // 3 per vertex, world, exactly on the source mesh's triangles
  normals: Float64Array        // 3 per vertex, unit (linear interpolation of the source vertex normals, renormalised; face normal where the source normal is zero)
  scalars: Float64Array | null // per vertex, linear (colormap)
  indices: Uint32Array
  canon: Uint32Array           // canonical vertex id per vertex (coincident positions merged at 1e-5 of the bbox diagonal, as contours.ts canonOf)
  adj: Int32Array              // 3 per triangle: the triangle across edge (v0v1, v1v2, v2v0), -1 on a border
  closed: boolean              // no border edges
  area: Float64Array           // per triangle, world
  bvh: Bvh                     // space/pick/bvh.ts buildBvh over positions and indices
}
export function refineSurface(mesh: MeshMark, mark: number, maxEdge: number, maxTriangles: number): RefinedSurface
export function refineWhere(s: RefinedSurface, needs: (tri: number) => boolean, minEdge: number, maxTriangles: number): RefinedSurface // conforming
export interface SurfacePoint { tri: number; b1: number; b2: number }
export function locate(s: RefinedSurface, x: number, y: number, z: number, nx: number, ny: number, nz: number, reach: number, out: SurfacePoint): boolean
export function pointOf(s: RefinedSurface, p: SurfacePoint, out: Float64Array | number[]): void
export function normalOf(s: RefinedSurface, p: SurfacePoint, side: 1 | -1, out: Float64Array | number[]): void

// shadow.ts
export interface ShadowCaster { visibility(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: { vis: number; dist: number }): void }
export function makeShadowCaster(scene: SpaceScene, lightDir: readonly number[]): ShadowCaster

// occlusion.ts
export function occlusionAt(scene: SpaceScene, caster: ShadowCaster /* for its BVHs */, x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, rng: () => number): number

// plan.ts
export interface SidePlan {        // per refined vertex, for one side
  nl: Float32Array; shadow: Uint8Array; vis: Float32Array; shadowDist: Float32Array; ao: Float32Array
  u: Float32Array; value: Float32Array; zone: Uint8Array; fam: Uint8Array; trans: Float32Array; lift: Float32Array
  key: Float32Array; lightW: Float32Array; shadowW: Float32Array; reflW: Float32Array
  grad: Float32Array               // per TRIANGLE: |∇u| per CSS px at the reference scale (|∇u|_world · referenceWorldPerPx)
}
export interface WorldPlan {
  surfaces: (RefinedSurface | null)[]          // per scene mark: opaque meshes and veils (null for non-meshes)
  front: (SidePlan | null)[]                   // side +1
  back: (SidePlan | null)[]                    // side -1 (null for closed meshes)
  ground: Uint8Array                           // per mark (view.ts groundMarks)
  veil: Uint8Array                             // per mark (opacity < 1)
  capU: number; floorU: number; uCanvas: number // as PlanMap
  curves: CompiledCurves
  lightDir: [number, number, number]
  referenceWorldPerPx: number
}
export function buildWorldPlan(scene: SpaceScene, lightDir: [number, number, number], params: PaintParams, referenceWorldPerPx: number): WorldPlan
export interface PlanAt { u: number; value: number; zone: number; fam: number; trans: number; lift: number; key: number; nl: number; lightW: number; shadowW: number; reflW: number; shadowDist: number; ao: number }
export function planAt(plan: WorldPlan, mark: number, side: 1 | -1, p: SurfacePoint, out: PlanAt): PlanAt // barycentric interpolation; zone and fam from the nearest vertex
export function familyBoundAt(plan: WorldPlan, at: PlanAt): number   // as value.ts familyBound with the point's u and fam
export function holdFamilyAt(plan: WorldPlan, at: PlanAt, u: number): number
```

**Rules and constants**
- **Source normal and side.**
  - Side +1 uses the vertex normal as given. Side −1 uses its negation.
  - Every plan quantity is computed per side with that side's normal, as the per-frame model does with the viewer-facing normal. That covers N·L, the shadow test origin offset, the sky and bounce terms of `planSample`, and AO.
  - A closed surface has only side +1.
- **Refinement.**
  - `refineSurface` bisects the longest edge, conformingly: when an edge is split, every triangle sharing it is split on it. This gives no T-junctions.
  - It refines until every edge is ≤ `maxEdge`. `maxEdge` = `UNDERPAINT_CELL_PX` (12) × `referenceWorldPerPx`.
  - New vertex attributes are linear in position, normal and scalars. The normal is then renormalised.
  - Above `maxTriangles` (`BAKE_MAX_TRIANGLES` = 400_000 over the whole scene, shared by area), it stops at the coarser level and records it in the plan's stats.
- **Adaptive refinement at family boundaries** (`refineWhere`).
  - After the first plan, refine every triangle whose vertices differ in `fam`, in `shadow`, or in band membership (|nl| < ts/2). Stop when its edges are ≤ `RING_PX` (3) × `referenceWorldPerPx`.
  - Recompute the plan at the new vertices.
  - Repeat until no triangle needs it, at most 6 passes.
  - This keeps the per-vertex underpainting from blending the two families across more than about 3 px at the reference scale. That is the same width as the per-frame underpainting's ring.
- **Shadow caster.**
  - Casters are the opaque meshes (`style.opacity >= 1`), including tables (as `gl/meshes.ts` `isDrawableMesh`), using `bvhOf(mark)` from `space/pick/bvh.ts`.
  - It uses 5 rays toward L:
    - The centre ray, plus 4 offset by ±1 shadow texel along two axes perpendicular to L.
    - The texel is (2 × the scene's bounding-sphere radius × 1.02) / 1024, matching `gl/shadow.ts` `SHADOW_FIT` and `SHADOW_SIZE`.
    - Each origin is lifted along the side normal by texel × (1.2 + 1.6·slope), with `slope = min(sinθ/max(cosθ, 0.1), 6)`, mirroring the G-buffer shader's bias.
  - `vis` = the fraction of rays not hit. `dist` = the mean hit distance of the hit rays (Infinity when none).
  - The shadow flag is `nl <= 0 || vis < 0.5`, exactly the G-buffer's.
- **Occlusion.**
  - 8 cosine-weighted hemisphere rays about the side normal, from `randomFor('paint/bake/ao/' + mark, params.seed)`, drawn in vertex order.
  - Radius R = `environment.occlusionRadiusPx` × `referenceWorldPerPx`.
  - ao = mean over rays of `hit ? (1 - smooth(R, 2R, hitDist)) : 0`.
  - Calibrate against `computeOcclusion` on the sphere-on-table fixture: report both at the contact ring and on open table; they should be the same order of magnitude.
- **Plan per vertex.**
  - `planSample(params, curves, nl, shadow, nx, ny, nz, ao, out)`, with the side normal.
  - Bare lit table vertices get `canvasValue(params)`, exactly as `buildPlanMap` does (value.ts, around :437–449).
  - `key`, `lightW`, `shadowW`, `reflW` and `fam` are as `buildPlanMap` defines them. `capU` and `floorU` are as well.
- **Veils** (opacity < 1):
  - They get a refined surface and a two-sided plan with `shadow = false` and `ao = 0`, exactly as `roles.ts` `whereOf` does.
  - They don't cast.
- **Particles.** A particle's plan is `planAt` at its location on its mark's refined surface. Find it with `locate(position, normal)`; it is exact, because refined surfaces lie on the source triangles. `tri` and `bary` are kept for Task 3's colormap and diagnostics.

**Tests**
- [ ] `model/frameHash.test.ts` (write it FIRST, at the base commit, before any change). For three fixtures (`sphereGBuffer`, `planeGBuffer` and `valueFinalFixture`'s default frame), pin an FNV hash of `paintFrame`'s stroke batch arrays and underpainting. Pin the `ParticleSet` arrays of a sphere-and-torus scene too. These must stay green through Tasks 1–4.
- [ ] Particles. For every particle of a sphere scene, `P(tri, bary)` is within 1e-5 of `position`. Every pre-existing particle array is byte-identical to the pinned hash.
- [ ] Surface, quad. Refining a 2-triangle 4×4 quad at `maxEdge` 0.5:
  - every edge is ≤ 0.5;
  - every interior edge is shared by exactly 2 triangles and every border edge by 1 (no T-junctions);
  - the total area is 16 within 1e-9;
  - `closed` is false.
- [ ] Surface, UV sphere. A UV-sphere mesh with a pole and a seam gives `closed` = true after canonical merging.
- [ ] Shadow. A sphere (r 1, centre (0,0,1.5)) over a table at z = 0, light straight down:
  - the table vertex under the centre is shadowed, with `dist` ≈ 0.5 within a texel;
  - a table vertex at (3,0,0) is lit;
  - the sphere top is lit; the sphere bottom has nl < 0.
  - Against `valueFinalFixture`'s analytic `occluded`, at least 98% of table vertices outside a one-texel band agree.
- [ ] Occlusion. A table vertex at the contact ring has ao > 0.2. The open table and the sphere top have ao = 0.
- [ ] Plan. Every vertex's `u` equals `planSample` at its own inputs bit for bit (it is the same function). After adaptive refinement, no triangle with mixed `fam` has an edge longer than `RING_PX × referenceWorldPerPx × 1.01`, unless the budget was hit and the stats say so.
- [ ] Two sides. A single flat sheet at z = 1, light from above: side +1 (normal up) is lit and side −1 is in the shadow family.
- [ ] Determinism. Two `buildWorldPlan` calls give byte-identical arrays.
- [ ] Bench, not a test. Report the `buildWorldPlan` time for the lab's showcase scenes: sphere, torus, saddle, tangent plane, helix and the level-curve hill. They are listed in `review/src/paintLabShowcase*.ts`; build their scenes as the lab does.

**Steps**
- [ ] Write the frame-hash guard at the base and commit it.
- [ ] Add `tri` and `bary` with a test, then run the guard.
- [ ] Write `surface.ts` with its tests.
- [ ] Write `shadow.ts` and `occlusion.ts` with their tests.
- [ ] Write `plan.ts` with its tests, including adaptive refinement.
- [ ] Run the bench and record it in the report.
- [ ] Run the full suite (`--maxWorkers=2`), both tsc commands and the sweep. Commit with explicit paths.

---

### Task 2: World planes and world edges

**Files**
- Create: `bake/planes.ts`, `bake/edges.ts`.
- Modify: `model/contours.ts`, to export `staticLines(mesh)` unchanged.
- Test: `bake/planes.test.ts`, `bake/edges.test.ts`.

**Interfaces it consumes:** Task 1's `WorldPlan`, `RefinedSurface`, `planAt`, `locate`, `SurfacePoint`.

**Interfaces it produces:**
```ts
// planes.ts
export interface WorldPlane {
  id: number; mark: number; side: 1 | -1 | 0; area: number; zone: number; fam: number
  u: number                      // area-weighted mean plan value
  nx: number; ny: number; nz: number // area-weighted mean side normal, unit
  cx: number; cy: number; cz: number // area-weighted centroid
  ground: boolean; cast: boolean // table plane; ≥ 50% of its area in Z_CAST
  hOff: number; cOff: number     // curve.planeStep(mean normal)
  colour: [number, number, number] // mean local colour (OKLab) of the particles on the plane; the mark's colour if none
}
export interface WorldPlanes {
  planeOf: (Int32Array | null)[][]  // [mark][side index 0 = +1, 1 = -1]: plane id per refined triangle
  planes: WorldPlane[]
}
export function buildWorldPlanes(plan: WorldPlan, particles: ParticleSet, colours: SceneColours, curve: Curve, params: PaintParams): WorldPlanes
export function stepValueWorld(planes: WorldPlanes, planeId: number, u: number, planeGradient: number): number // = model/planes.ts stepValue's formula

// edges.ts
export type WorldEdgeType = 'terminator' | 'shadow' | 'plane' | 'crease' | 'border'
export interface WorldEdgeRun {
  type: WorldEdgeType; mark: number; side: 1 | -1 | 0
  kind: 0 | 1 | 2               // index into the edge weight arrays: 0 internal, 1 silhouette, 2 shadow
  pts: Float64Array             // 3 per sample, world, on the surface, every EDGE_STEP_PX × referenceWorldPerPx
  nrm: Float32Array             // 3 per sample, the side normal
  across: Float32Array          // 3 per sample, unit tangent-plane direction from side A to side B
  keys: Uint32Array             // position hash per sample (as the model's edge keys)
  planeA: Int32Array; planeB: Int32Array // plane id each side (-1 none)
  uA: Float32Array; uB: Float32Array     // plan value each side (probe at ±probe px × referenceWorldPerPx along `across`)
  h: Float32Array; cls: Uint8Array       // hardness and smoothed class per sample
  contrast: number                       // mean |uA - uB|
}
export interface WorldEdges {
  runs: WorldEdgeRun[]
  adjHard(a: number, b: number): number       // mean hardness of the samples between planes a and b; 0 when none
  // The edge field per refined vertex per side: distance (world) to the nearest edge sample with
  // contrast ≥ detect.edgeMinContrast within edgeReachPx × referenceWorldPerPx, and that sample's h and cls;
  // dist = Infinity, cls = 255 beyond reach.
  field: { dist: Float32Array; hard: Float32Array; cls: Uint8Array }[][] // [mark][side index]
  focal: Float64Array                          // up to 2 per figure mark: x, y, z, R (world)
}
export function buildWorldEdges(plan: WorldPlan, planes: WorldPlanes, params: PaintParams): WorldEdges
export function edgeClassAlong(edges: WorldEdges, plan: WorldPlan, mark: number, side: 1 | -1, pts: SurfacePoint[], light: number, shadow: number): number // as model strokeEdgeClass, from the field; interior fallback identical
```

**Planes**
- **The key per refined triangle and side.**
  - Ground: `(cast, band)`, where `cast` = the triangle's majority zone is Z_CAST. For cast triangles, the band is the occluder distance in px at the reference scale (mean `shadowDist` / `referenceWorldPerPx`), thresholded at 26 and 64. These are the model's band thresholds, now measured from the occluder rather than the figure's screen silhouette.
  - Figure: the side normal at the centroid gives:
    - `lat = asin(nz)`, `lon = atan2(ny, nx)` (WORLD axes, z up);
    - `cell = planeCellDeg·π/180`, `latI = floor((lat + π/2)/cell)`;
    - `step = cell / max(0.35, cos lat)`, `lonI = floor((lon + π)/step)`.
  - Key = (mark, side, latI, lonI, zone). The zone is the triangle's majority vertex zone; on a tie, take the zone of the vertex with the median u.
- **Connected components** over `adj` (same mark, same side, equal key).
- **Merge.** A component with world area < `planeMinPx × referenceWorldPerPx²` that is not ground joins its same-mark, same-side, same-family neighbour with the longest shared border (world length), preferring the same zone. One with no same-family neighbour is kept. This is the model's merge rule (`model/planes.ts`, around :179–226) in world units.
- **Plane stats** as listed in `WorldPlane`. The mean colour is over ALL particles on the plane (a particle's plane is that of the refined triangle it locates on, on each side).

**Edges**
- **Terminator and figure cast boundary.**
  - Marching triangles on the per-vertex field `lw = lightWeight(ts, nl, false) × smooth(0.25, 0.75, vis)` at the iso 0.5, on non-ground figure surfaces, per side.
  - Each iso segment is typed `'terminator'` when |Δ(lightWeight term)| ≥ |Δ(vis term)| across its triangle, else `'shadow'` with kind 0. A cast boundary on the figure itself is an internal edge, as in the model.
- **Table cast boundary.** The iso 0.5 of `vis` on ground surfaces, with type `'shadow'` and kind 2.
- **Plane boundaries.**
  - Chains of shared triangle edges between different planes of the SAME family on the same mark and side. Between families the iso lines above are the edge, so plane chains never duplicate them.
  - Smooth the chains with 2 Chaikin passes.
  - Type `'plane'`, kind 0.
- **Creases and borders.** `staticLines(sourceMesh)` from `contours.ts`. Type `'crease'` or `'border'`, kind 1 (in the model these contour runs are typed silhouette). On open meshes, emit one run per side.
- **Chaining and samples.**
  - Chain segments into polylines through canonical vertex ids or iso-crossing keys.
  - Resample at `EDGE_STEP_PX` (2) × `referenceWorldPerPx`. Drop runs shorter than 8 samples, as the model does.
  - `keys` uses the model's position hash.
- **Hardness per sample.** `edgeHardness(kindType, terms, params)` with:
  - **c:** from `|uA − uB|`, with the model's smooth ranges (internal (0.06, 0.60); others (0.04, 0.34)).
  - **k:**
    - internal: `acos(nA·nB) / (2·probe in px) · 0.875` through `smooth(0.01, 0.06)`, the normals read at the probes;
    - kind 1: 0.55;
    - kind 2: 0.3.
  - **f:**
    - The focal points are the top 2 vertices by `key` over each figure mark's side +1 (or both sides for open meshes).
    - R = 0.55·√(mark area/π).
    - f = max exp(−(dist/R)²).
  - **s:** `smooth(0.28, 0.8, (uA + uB)/2)`.
  - **d = 0.** Ruling: `edges.wDepth` has no effect under the bake. Task 6 labels the slider.
  - **x (kind 2 only):** `1 − smooth(8, 110, shadowDist_px)`, the occluder distance in px at the reference scale (spec §14).
  - **Noise:** the model's `valueNoise3` at the world sample point.
  - **tScale:** `terminatorEdgeScale(ts)` on terminator runs. On plane runs it applies only when the model's `isTerminatorPair` holds for the two planes' zones.
  - The model's `lost if con < 0.03` rule.
  - Classes via `edgeClassOf`, then `smoothClasses`.
- **Edge field per vertex.** A multi-source Dijkstra over the refined surface's edge graph, from each run sample with contrast ≥ `edgeMinContrast`. Seed the nearest vertices of its triangle with their exact distance. Cut off at `edgeReachPx × referenceWorldPerPx`.
- **`adjHard(a, b)`** is the mean `h` over samples with {planeA, planeB} = {a, b}, symmetric.

**Tests**
- [ ] Sphere under the default world light:
  - 5 to 60 planes on the sphere;
  - every plane is single-family;
  - plane boundaries never join two families;
  - one terminator run forms a closed loop with every sample's |nl| ≤ ts/2 + 0.03.
- [ ] Softness. At ts = 1.0 every terminator sample's class is soft or lost. At the default ts the terminator has firm or hard samples.
- [ ] Table cast. A sphere on the table, light at elevation 40°:
  - a `'shadow'` run exists on the table;
  - every sample is within 2 refined cells of the analytic shadow outline.
  - With a tall thin box occluder, the mean hardness of samples whose occluder distance is in the top third is < the mean of the bottom third (the x term).
- [ ] The light matters. Two light directions give different terminator runs. The plan and edges take no view input; check the signatures.
- [ ] Determinism. Byte-identical runs, planes and field.
- [ ] `adjHard` is symmetric and 0 for planes that never meet.
- [ ] Run the full suite, both tsc commands and the sweep. Commit with explicit paths.

---

### Task 3: The baked strokes, the underpainting, `bakePainting` and `recolourBake`

**Files**
- Create: `bake/walk.ts`, `bake/strokes.ts`, `bake/edgeStrokes.ts`, `bake/lines.ts`, `bake/underpaint.ts`, `bake/index.ts`.
- Test: `bake/walk.test.ts`, `bake/strokes.test.ts`, `bake/underpaint.test.ts`, `bake/index.test.ts`.

**Interfaces it consumes:** Tasks 1 and 2. The contract `BakedPainting`, `BakedSurface`, `BAKE_PATH_POINTS`, `BAKE_ZOOM_MIN`, `BAKE_MIX_LEVELS`, `SIZING_*` and `HIDDEN_*`.

**Interfaces it produces:**
```ts
// index.ts
export const bakePainting: BakePainting
export const recolourBake: RecolourBake
export function bakeKey(scene: SpaceScene, lightDir: readonly number[], params: PaintParams, referenceWorldPerPx: number): string
export interface BakeProgress { phase: 'plan' | 'planes' | 'edges' | 'strokes' | 'underpaint' | 'pack'; done: number } // done 0..1
export function bakePaintingWithProgress(scene: SpaceScene, particles: ParticleSet, colours: SceneColours, lightDir: [number, number, number], params: PaintParams, referenceWorldPerPx: number, progress?: (p: BakeProgress) => void): BakedPainting
// Fill the contract's BakedPainting.focal (from Task 2's WorldEdges.focal) and BakedPainting.dataColour (3 per
// mark, linear sRGB, the line recipe's colour before the mix; 0 for marks without lines); both fields already exist.
```

**Particle strokes** (`strokes.ts`)
- **Role selection.** For each particle and each side it has (closed: side 0, using side +1's plan; open: +1 and −1), read the plan with `planAt`. Apply the conditions of `model/roles.ts` `particleStrokes`, in the model's order:
  - veil: glaze, plus the border pass;
  - block: everywhere except lit bare table;
  - ground only: glaze;
  - form: `shadowW < 0.85 && |nl| <= detect.formBandNL`;
  - scumble: the world mask, below;
  - glaze;
  - reflected: with `nz` the side normal's world z.
- **Density.** Emit a stroke for each role the particle qualifies for, with no density test. The frame thins by rank. Store `rank` = `roleRank(set.rank[i], role)` and `particle` = i.
- **Value and colour.** As the model's `strokeColour`:
  - `u = clamp(holdFamilyAt(stepValueWorld(plane, at.u + curve.devU(p), planeGradient) + du), 0.02, 0.99)`;
  - `nz`, bounce, `ambientShare`, the plane's mean normal, colormapped flag, seeded jitters g0..g2, `holdOf` → `uBound`/`lBound`;
  - the role offsets `du` (glaze −0.07, scumble ±0.1).
  - Whatever rule values round 4 lands in `roles.ts` (a stroke inside the terminator band follows the plan's own value) applies here too. Call the same helper. If round 4 has not merged when you start, write it as a single function in `strokes.ts`, so the controller's merge changes one place.
- **Mix.**
  - Spatial `LoadMixer` with `loadCellOf(set, i, loadCell, level)` for level = 0..`BAKE_MIX_LEVELS`−1, then `holdLightness` at the family bound, then `oklabToLinear`.
  - Write the 4 colours at `colour[3·(4i + level)]`.
  - Keep the recipe (DraftColour, fam, uBound, holdColour, cell per level, jitters, colormapped, role, seed) for `recolourBake`, in a WeakMap keyed by the returned `BakedPainting`.
- **Size.** `basePx = [lengthPx, widthPx]`, exactly as `buildParticleStroke` computes them before `big`:
  - role size × vLen/vWid × the light/shadow factor `ls`;
  - ground block 1.25/2.3;
  - veils ×2.
- **Walk** (`walk.ts`).
  - World length: `basePx[0] × referenceWorldPerPx × max(1/BAKE_ZOOM_MIN, sizedLength(1, bigMax(params)))`. This is the longest any view the bake serves can ask for.
  - Walk both halves from the particle in the model's direction field:
    - veil: ±t or n×t by seed parity;
    - ground block: fixed −L.xy;
    - iso (block, scumble, glaze): n×L when |n×L| > 0.12, else the tangent;
    - form/reflected: whichever of t and n×t the light crosses more, rotated by `rot`;
    - bend as the model.
  - Steps: `BAKE_PATH_POINTS/2` per half.
  - Each step moves in the tangent plane, then snaps with `locate` (reach = 4 × step). The next normal is `normalOf` at the hit, for the stroke's side.
  - **Stops**, as the model minus the view-dependent ones:
    - leaving the mark (no hit, or a border);
    - `castOnly` outside Z_CAST;
    - `stopBelow` against the plan value (`terminatorValue`, computed from the world plan the way roles.ts :281 does from the PlanMap);
    - a plane boundary with `adjHard ≥ stopAt` stops, `≥ bleedAt` bleeds for 0.6 of the steps left.
    - No limb or occlusion stop: the frame's |n·v| fade and the renderer's depth pre-pass do that.
  - Resample the walked points to `BAKE_PATH_POINTS` at equal world arc length. `pathLength` = the arc length. `anchor` = the particle's arc fraction.
  - **Loaded end.** For a `'light'` start, reverse when u at the far end > u at the near end, as the model does, and set `handStart = 0`. For `'hand'`, set `handStart = 1`; the frame decides by screen x.
- **Behaviour.**
  - `edgeClassAlong` over 9 points of the reference-length sub-arc around the anchor gives the class.
  - `behaviourOf(cls)` gives alpha, load, endSoft, impasto, bristles and dry/wet, as `buildParticleStroke` does.
  - Glaze, veil and border alphas as the model.
- **Scumble mask, world.**
  - Per refined vertex and side: `ok = !ground && trans > 0.16 && triangle grad < scumbleGradient` (a vertex takes the max grad of its incident triangles).
  - Then the graph distance from the not-ok vertices must be ≥ `scumbleMinPx/2 × referenceWorldPerPx` (multi-source Dijkstra).
  - A particle is ok when the vertex of its located triangle nearest to it is ok.
- **Dabs, world.**
  - Per figure mark and side: vertices with `value ≥ 0.8` that are a strict maximum of `value + 0.01·key` over the graph neighbourhood within `dabMinPx × referenceWorldPerPx`.
  - Keep the top `dabTopFraction` of the candidates, at least `dabMinPx × referenceWorldPerPx` apart (greedy, by score).
  - Direction n×L, or the world x axis projected into the tangent plane when |n×L| is small.
  - Colour from the nearest particle of the same mark (a spatial hash).
  - Walk, size and colour as the model's `dabStrokes` otherwise.

**Edge strokes** (`edgeStrokes.ts`)
- Port `model/contours.ts` `edgeStrokes` onto `WorldEdgeRun`:
  - skip runs with contrast < `edgeMinContrast`;
  - `segmentRun` by class, `maxSamples` and position keys (the RNG is `paint/edge/${keys[mid]}/${runIndex}` in bake order);
  - per class:
    - firm/hard: a crisp loaded stroke along the run, darker than the darker side;
    - soft: a 2.6× wide drag plus scumbled pulls every ~34 px, from the lighter side into the darker;
    - lost: bridges every ~42 px across the run.
- Lengths and spacings are px × `referenceWorldPerPx`.
- Pulls and bridges walk ACROSS the run on the surface (`walk.ts` with a fixed direction `±across`).
- The along-run strokes' paths are the run's own samples (exactly on the surface).
- Colours: `sideRecipe` with each side's plane colour and u, with family holds as the model.
- `sizing = SIZING_FIXED`. `side` = the run's side. `particle = 0xffffffff`.
- **Mix:** the SEQUENTIAL mixer in bake order (runs in a fixed order, strokes along each run). A load breaks when the next stroke's mid point is more than `loadBreakPx × referenceWorldPerPx` away (world) or the run changes. The colour is the same at every level (repeat it 4 times).

**Data marks** (`lines.ts`)
- Port `model/lines.ts` geometry to world pieces for line polylines, arrow shafts and box edges:
  - the style dash pattern in px × `referenceWorldPerPx`;
  - corners at a WORLD turn > 30°;
  - split at `LINE_MAX_PX × referenceWorldPerPx`;
  - `polylinePath` resampling to `BAKE_PATH_POINTS`.
- No hidden test: `hidden = HIDDEN_DASHED` when the style's hidden is `'dashed'`, else `HIDDEN_NONE`.
- The colour recipe is `recipeOf` (u 0.6, lScale 0.55, seeded jitters with tag `l${polyline}.${piece}`). The sequential mix runs in polyline order.
- `sizing = SIZING_FIXED`, `side = 0`, `layer` as the model.
- Points and arrowheads are not baked (Task 4). Store the per-mark `dataColour`.

**Underpainting** (`underpaint.ts`)
- **Per refined vertex and side** of every opaque mesh (veils get alpha 0):
  - local colour: the mark's colour, or the colormap at the vertex scalar;
  - u = `holdFamily(stepValueWorld(the vertex's plane, u + devU(p), planeGradient))`. The vertex's plane is that of its incident triangles in its own family with the largest summed area;
  - a band vertex (|nl| < ts/2) uses its own plan value, no plane step, as the per-frame band code;
  - nz, bounce, `ambientShare` and the plane mean normal;
  - cell at level 0;
  - `colourOfRecipe`, then `LoadMixer` at `UNDERPAINT_MIX` (0.5), role block, jitter 0, then `holdLightness` at the family bound, then linear sRGB.
- **Alpha** is 0 for lit bare table (ground, not Z_CAST), else 1.
- **Also store** `u`, `fam` and `local` per vertex per side. Fill `BakedSurface`, with Float32 copies of positions, normals and indices.

**Assembly** (`index.ts`)
- Order by layer, then by a seeded key (FNV of mark, particle or run, role, side, piece). Pack into the SoA arrays. Compute `areaPerParticle` (`meshArea / count` of the mark's particles).
- `key = bakeKey(...)`:
  - an FNV fingerprint of the scene (mark count; per mesh its vertex and index counts plus a hash of its positions);
  - the light direction to 1e-6;
  - `referenceWorldPerPx`;
  - JSON of params with the colour-only, render-only and view-only paths removed (reuse `index.ts`'s `COLOUR_ONLY` and `RENDER_ONLY` lists).
- `recolourBake(baked, params)`:
  - Look up the retained recipes, or return null.
  - Recompute every stroke's 4 colours (recipe → `colourOfDraft` → mix per level → hold → linear) and every surface's underpainting colours.
  - Return a new `BakedPainting` sharing every non-colour array with `baked`. Keep the recipes for the new object too.

**Tests**
- [ ] Walk. Every baked path point of every surface stroke is within 1e-5 × the scene size of the refined surface (`locate` it back). Paths never cross from one mark to another. A form stroke on the sphere never crosses the terminator when `stopBelow` applies.
- [ ] Value rule, per family, using the model's valueFinal tolerances (copy the bound from `model/valueFinal.test.ts`):
  - every shadow-family stroke colour's OKLab L at every level is ≤ its bound;
  - every light-family stroke's L is ≥ its bound;
  - the same holds for the underpainting per vertex.
- [ ] Hue rule. Pre-mix shadow-family colours of a terracotta sphere (and of a 0.03-chroma muted one) stay within `shiftMax + 3°` of the local hue.
- [ ] Sides. On an open saddle lit from above, side +1 and side −1 strokes both exist, with opposite `worldNormal`s. On a closed sphere every stroke has side 0.
- [ ] Recolour. For 3 colour-only changes (curve warm hue, mix strength, environment absorption), `recolourBake` equals a fresh `bakePainting` bit for bit in every colour array and every surface's underpainting arrays. Every other array is shared by identity.
- [ ] Determinism. Two bakes give byte-identical arrays and equal keys. Changing a non-colour param changes the key; a colour-only change does not.
- [ ] Softness reaches the strokes. At ts = 1.0 the stroke value step across N·L 0 on the sphere is within 1.5× the plan's step (mirrors values round 4).
- [ ] Bench, not a test. Report the bake times and stroke counts for the showcase scenes.
- [ ] Run the full suite, both tsc commands and the sweep. Commit with explicit paths.

---

### Task 4: `frameFromBake`, the per-frame silhouettes, parity and the bench

**Files**
- Create: `bake/frame.ts`, `bake/silhouettes.ts`, `bake/parity.ts`, and `bake/bench.mts` (a script, not a test).
- Modify: `model/contours.ts`, to export the geometry of `silhouetteLines` as a function of (mesh, eye, ortho, viewDir) without a `PaintCtx`, behaviour unchanged (the frame-hash guard).
- Modify: `model/view.ts`. If needed, export pure forms of `drawChance`, `zoomGrow` and `zoomSizeScale` that take (view, params, pxArea, role) instead of a `FrameCtx`. The old functions call the new ones; the frame-hash guard holds.
- Test: `bake/frame.test.ts`, `bake/silhouettes.test.ts`, `bake/parity.test.ts`.

**Interfaces it consumes:** `BakedPainting` from Task 3, `model/brush.ts`, `model/view.ts`, `reproject.ts`'s projection conventions, and `StrokeBatch`.

**Interfaces it produces:** `export const frameFromBake: FrameFromBake`. The result fills `StrokeBatch.hidden` (already in the contract, `space/paint/types.ts`; the per-frame model leaves it undefined).

**Per baked stroke** (a single pass over arrays, with no per-stroke allocation):
1. **Side.**
   - Take the anchor's normal (the `worldNormal` at the anchor point, interpolated) and `toEye` (per point for perspective, `−viewDir` for ortho).
   - side ≠ 0: drop when n·toEye ≤ 0.
   - side 0: drop when n·toEye < −0.05; the depth pre-pass handles the rest.
2. **Fade.** `facing = |n·toEye|`. `fade = smooth(fadeLo, fadeHi, facing)`; veil marks use the model's veil variant. Drop when < 0.02. Data marks and edges: fade 1, and edge strokes still use step 1's side test.
3. **Density** (surface strokes).
   - `ppu` = px per world unit at the anchor (`view.ts` `pxPerUnit` maths).
   - `pxArea = areaPerParticle[mark]·ppu²·facing`.
   - `chance = drawChance(view, params, pxArea, role)`, which includes the drag density.
   - Draw when `rank < chance`. The fade is the model's `drawFade` ramp.
4. **Size.** `big = min(zoomGrow(pxArea, role)·zoomSizeScale(view, params), bigMax(params))`.
   - Surface strokes:
     - The needed world length is `sizedLength(basePx[0], big)/ppu`.
     - The sub-arc is centred on `anchor·pathLength`, clipped to [0, pathLength], with no rebalancing (as the model's walk).
     - Resample to `PATH_POINTS` world points by linear interpolation along the baked polyline, then project.
     - Widths per point: `sizedWidth(basePx[1], big)·PRESSURE[q]·fore`, where `fore` = the projected length of the lateral world direction (n × path tangent) / ppu. Then `reshapeWidths(width, big)`.
     - `bristles = sizedBristles(...)` and `bristleVar = sizedVariance(...)`.
   - SIZING_FIXED: the whole baked path resampled to `PATH_POINTS` and projected. The width is a constant `basePx[1]`, with the profile the model's `polylinePath` gives edges and lines.
5. **Loaded end.** With `handStart`, reverse when the projected x of the end < the start.
6. **Colour.** Level `min(loadCellLevel(view.zoom), BAKE_MIX_LEVELS − 1)`.
7. **Alpha.** `alpha × fade × drawFade`.
8. **Behind veil.** A line stroke behind a flat veil (`behindVeil` with the eye) goes to `BEHIND_VEIL_LAYER`.

**Per-frame additions**
- **Points and arrowheads,** from the scene's data marks with `dataColour`: port `model/lines.ts`'s screen shapes. A point is a dab of `max(3, size)` px. Arrowhead barbs are `max(6, headSize)` px at ±26°, anchored in world with the anchor repeated.
- **Silhouettes** (`silhouettes.ts`).
  - Silhouette polylines of each opaque non-ground mesh, from the exported geometry.
  - Resample every 2 px; the world step is 2/ppu.
  - At each sample:
    - uA = the baked `u` of the side facing the eye, at the nearest refined vertex (a spatial hash per `BakedSurface`, cached in a WeakMap by the bake);
    - local colour from `local`;
    - uB = the canvas value. If `gbuffer` is non-null and the pixel 3 px outside the outline holds another mark, use that pixel's G-buffer `value` through `curves.value(curves.lightResponse(v))` instead.
  - Hardness of kind 1:
    - c from uA and uB;
    - k = 0.55;
    - f from `BakedPainting.focal`;
    - s, noise;
    - d = 0;
    - the model's silhouette-in-shadow-family raise.
  - Classes are smoothed, then strokes are built per class as Task 3's edge strokes, with colours made on the main thread by the same recipe functions. Points are exactly on the silhouette polyline.
  - Seeds come from position keys. The sequential mix runs along each polyline.
- **Order.** Within each layer, order far to near by the anchor's view depth: a counting sort over 4096 depth buckets, stable on bake order.
- **Output.** A `StrokeBatch` with `worldPath` (the `PATH_POINTS` world points used) and `worldNormal` (the anchor normal of the drawn side), so `reproject.ts` still works on it.

**Parity** (`parity.ts`, used by the test)
- At the authored view of the `valueFinalFixture` scene (sphere and table, with shadows), run both:
  - `paintFrame` (its G-buffer from the fixture);
  - `frameFromBake(bakePainting(...))`.
- Metrics:
  1. Role agreement: over particles drawn by both, the fraction with the same set of roles.
  2. Mean OKLab ΔE between the two colours of each particle-role pair drawn by both.
  3. The stroke-count ratio.
  4. The mean ΔE of the underpainting at the fixture's pixels: the baked surface colours rasterised with the fixture's software rasteriser (`testing.ts` `meshGBuffer` style) against `underpaintImage`.
- The test asserts only gross bounds:
  - role agreement ≥ 0.6;
  - stroke mean ΔE ≤ 0.08;
  - count ratio in [0.5, 2];
  - underpainting ΔE ≤ 0.08.
- The report states the real numbers. Spec §14 accepts look differences from world planes.

**Tests**
- [ ] Determinism. The same bake and view give a byte-identical batch.
- [ ] No boiling. For two views 1° apart (orbit), ≥ 90% of the surface strokes drawn in both have the same seed, colour and role, and their world sub-arcs differ by < 1e-6 when big is equal.
- [ ] Zoom. At zoom 0.5, 1, 2 and 4:
  - every surface stroke's world sub-arc lies on its baked path;
  - its screen length is within 2% of `sizedLength(basePx[0], big)` unless clipped by the path end;
  - the mix level follows `loadCellLevel`.
- [ ] Sides. An open saddle viewed from below draws only side −1 strokes on the part seen from below.
- [ ] Hidden. Data strokes carry `hidden`. Surface and edge strokes have `HIDDEN_NA`.
- [ ] Parity, as above.
- [ ] The frame-hash guard is still green.
- [ ] `bench.mts`. Report the median and p95 `frameFromBake` time over 60 orbit views at about 50k baked strokes (the target is ≤ 5 ms on Ben's PC), and allocations per frame.
- [ ] Run the full suite, both tsc commands and the sweep. Commit with explicit paths.

---

### Task 5: Renderer: the baked underpainting pass and the hidden-dashed line pass

This task runs in its own worktree, `milestone-a-paint-bake-gl`, on `milestone-a/paint-bake-gl`, branched from `milestone-a/paint-bake` after Task 1. It is built against the contract.

**Files**
- Modify: `graph-engine/src/space/paint/gl/PaintRenderer.ts`.
- Create: `gl/bakedSurfaces.ts` and `gl/shaders/bakedUnderpaint.ts`.
- Modify: `gl/shaders/stroke.ts`, adding the hidden pass.
- Test: the existing `space/paint/gl` test pattern (follow it exactly; read the current gl tests first).

**Interfaces it produces:**
```ts
// PaintRenderer
setBakedSurfaces(surfaces: (BakedSurface | null)[] | null): void  // upload VBOs once per bake; null returns to the image path
updateBakedColours(surfaces: (BakedSurface | null)[]): void        // bufferSubData of underFront/underBack/alpha only (recolour)
// paint(frame, view, ...) as today; when baked surfaces are set and frame.underpaint is null, the underpainting
// comes from the surface pass instead of the image upload.
```

**Rules**
- **The surface pass.**
  - Draw each baked surface (alpha > 0 anywhere) into the SAME underpainting texture the image path fills, at G-buffer resolution, with the same RGB+coverage encoding (NaN or none becomes coverage 0). So the composite (the brushy coverage mask, streaks, opacity) is unchanged.
  - Depth-test against the opaque G-buffer depth so hidden parts don't show.
  - Two-sided: the fragment picks front or back colour and alpha by `sign(dot(normal, toEye))` from the interpolated normal, with toEye per fragment for perspective. A closed surface uses the front only.
  - Veils have alpha 0 and are skipped.
- **The hidden pass.**
  - After the normal line strokes, draw the strokes with `hidden[i] === HIDDEN_DASHED` again, with the per-point depth test inverted: draw only where a surface is nearer, using the same depth bias as `DECAL_SLOPE`.
  - Apply a dash mask by screen arc length, 5 px on and 4 px off (`HIDDEN_DASH`).
  - The normal pass already discards hidden points.
- **Unchanged without a bake.** With no baked surfaces set and no `hidden` array, the renderer's output is identical to today. Test it the way the existing gl tests pin output.
- `space/boundary.test.ts` stays green.

**Tests**
- [ ] Upload and recolour: buffer sizes, and only colour buffers updated on recolour.
- [ ] The two-sided choice in the shader logic (unit-test the pure part).
- [ ] The dash mask pure function.
- [ ] Identical output without a bake.
- [ ] Headless Edge shot, with a timeout and a kill, using the lab's gl test page or a minimal page on port 5190: a baked plane seen from both sides and a dashed hidden line behind a sphere. Save the shots to the report folder.
- [ ] Run the full suite and both tsc commands. Commit with explicit paths.

---

### Task 6: Wiring in the lab: bake in the worker, frame on the main thread

This task starts after the controller merges `milestone-a/paint` (live orbit, `light.worldFixed`, values round 4) and `milestone-a/paint-bake-gl` into `milestone-a/paint-bake`.

**Files**
- Modify: `graph-engine/src/space/paint/session.ts`, the paint worker, `review/src/paintLabEngine.ts`, `review/src/paintLabCamera.ts` (`referenceWorldPerPx`), and the lab UI (progress, a label for the inert slider).
- Test: `session.test.ts` and engine tests in the existing pattern.

**Rules**
- **`light.worldFixed ≥ 0.5`:**
  - The worker builds particles, then `bakePaintingWithProgress`, then posts the bake (transferable arrays) with progress messages.
  - The main thread keeps the current bake. EVERY frame, at rest and while dragging, is `frameFromBake(bake, scene, view, params, latestGBufferOrNull)`, then `renderer.paint(...)` with the baked surfaces set.
  - No model requests are made while dragging.
  - The G-buffer readback stays async and only feeds the silhouettes.
- **Re-bake.**
  - A change of light direction or a 'full' param change re-bakes, debounced 150 ms.
  - The previous bake stays on screen.
  - The lab shows "Painting… NN%" from the progress messages and clears it on arrival.
  - A stale bake (key mismatch) is ignored.
- **Colour change.** `classifyChange` gives 'colour': the worker runs `recolourBake` and posts only the colour arrays (strokes' `colour`, and surfaces' under/alpha). The main thread swaps them in and calls `updateBakedColours`. 'render': repaint only.
- **`light.worldFixed < 0.5`:** the live-orbit path of §13 exactly as today. A test pins that the per-frame path is chosen and the bake is not built.
- **Debug views.** When one is selected, the lab runs the per-frame model for the settled view (as today). The baked frame shows while dragging.
- **`referenceWorldPerPx`** = 1 / `pxPerUnit` at the scene's centre under the authored view at zoom 1 (`paintLabCamera.ts`).
- **The inert slider.** `edges.wDepth`'s slider is labelled "(no effect while the light is fixed in the world)" when `worldFixed` is on.
- **Context loss.** On restore, re-upload the baked surfaces. The live-orbit agent fixed a blank-on-loss bug, so follow its pattern.

**Verification**
- Headless Edge shots, each with a timeout and a kill, on a dev server on port 5189 (never 5182):
  - the authored view, per-frame against baked, for 4 showcase figures;
  - a 3-view orbit with the bake;
  - a zoom ×3.
- Save the shots and the lab's frame timing (frame build ms, paint ms) to `.superpowers/sdd/2026-10-03-paint-bake/shots/`.
- [ ] Run the full suite, both tsc commands and the sweep. Commit with explicit paths.

---

## Rulings made in this plan

Each ruling is "what was decided, why, and what it costs if wrong".

1. **Bake both sides of open meshes.** The model paints the side it sees, and a single per-point colour can't be both. If wrong, it doubles the open-sheet strokes, about 1.6× memory on a scene of open surfaces.
2. **Sizes stay in CSS px. The path is baked long enough for `BAKE_ZOOM_MIN` 0.5, and the frame takes a sub-arc.** This keeps the per-frame look at every zoom, with the strokes on the surface. If wrong, strokes are shorter on screen than today below zoom 0.5.
3. **Four mix levels.** The per-frame mix cell follows zoom up to level 6. If wrong, close-ups beyond about 8× keep level 3's cell size.
4. **Underpainting per vertex of a refined surface,** adaptive to about 3 px at family boundaries. This replaces the per-pixel lattice and band code. If wrong, the band blend is wider in px when zoomed far in.
5. **`edges.wDepth` is inert under the bake.** The spec's world hardness has no view depth. If wrong, one slider does nothing in world-light mode, and it is labelled.
6. **Data marks are split in world at the reference scale. Hidden dashes come from a renderer pass instead of a G-buffer test.** No readback is needed while dragging. If wrong, line pieces are longer on screen when zoomed in.
7. **Silhouettes read the latest G-buffer (it may be a frame old), or the canvas when there is none.** Only the tint beyond the outline depends on it. If wrong, a one-frame lag in that tint while dragging.
8. **Debug views use the per-frame model.** They are analysis views, not the painting. If wrong, the debug views don't show the bake's own planes; a later task can add them.
