# Calc P2 — The Adaptive Curve Sampler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D engine's 400 uniform samples with an adaptive sampler that the interval twin certifies. It must never connect across a pole or a jump. It finds holes, jumps, poles and domain edges from the expression's structure, shows oscillation faster than a pixel as a band, and emits the chain/mark/band scene contract that the renderer and goal 2 build on.

**Architecture:** A new directory, `plot/sample/`:
- `structure.ts` walks an `Expr` for trouble-spot *generators*: expressions whose zeros are the candidate singular points.
- `locate.ts` isolates those zeros in the sampled range with the interval twin.
- `limits.ts` classifies each zero by one-sided limits as a pole, jump, hole or edge.
- `sink.ts` builds chains and clips them to the overscan box.
- `adaptive.ts` subdivides in screen space. An interval is connected only when the twin certifies it, or when the pixel-scale jump test shows its gap closing.
- `band.ts` turns sub-pixel oscillation into filled bands.
- `curve.ts` assembles one statement's curve, marks, breaks and asymptote lines.

`scene/buildScene.ts` sends `y = f(x)`, `x = f(y)`, polar and parametric statements to `sampleCurve`. The scene contract in `scene/types.ts` gains `MarkId`, `Chain` and `Break`, plus the new curve, mark, band and line shapes. The three.js renderer turns these into its existing ribbon, region and point primitives through one pure module, `render/renderItems.ts`.

**Tech Stack:** TypeScript 6, Vitest, three.js (renderer only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`. The relevant sections:
- "The rules that don't bend";
- "Architecture": "The scene contract" and "The interaction budget";
- "The curve sampler (P2)";
- "Testing and verification";
- the twin's consumer contract under "The interval twin" (also the header of `graph-engine/src/math/interval/index.ts`).

P1 and P1b are complete on this branch.

## Global Constraints

**Where and what may change**
- **Working tree:** `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, branch `milestone-a/calc`. Run commands from `graph-engine/`.
- **Never edit** anything under `graph-engine/src/space/` or `graph-engine/src/figure/`, nor `scene/buildScene3d.ts` or `render/SceneRenderer3D.ts`. Do not edit `server/` or `web/`.
- **`math/` is read-only in P2.** Use `compileScalar`, `compileInterval`, `expandPrime`, `freeVariablesDeep` and the rest as they are. If a task finds it needs a `math/` change, stop and report NEEDS_CONTEXT.
- **Shared files are edited additively:**
  - `parser/types.ts`, `parser/parseStatement.ts`
  - `examples.ts` and its test
  - `GraphViewer.tsx`
  - `docs/HANDOFF-2026-10-01-calc-track-4.md`, `graph-engine/GRAPH-DSL-REFERENCE.md`

**The rules that don't bend** (spec, verbatim in substance)
1. Nothing is connected unless certified. A curve is joined across an interval only when:
   - the twin proves it defined and continuous there, or
   - the pixel-scale jump test shows the gap closing.
2. Errors are never silent: a spec that draws nothing says why.
3. Deterministic: the same spec and view give the same scene. There is no `Math.random`, `Date` or `performance.now` in `math/` or `plot/`, tests included.
4. Generic marks only, each with an identity.
5. Nothing else moves:
   - figure renders stay byte-identical (the clean-golden hashes);
   - space's output is untouched;
   - every existing test stays green, except tests that pinned the defects P2 removes (400 uniform samples, the window-relative jump rule). Each of those is replaced, with a note saying why.

**The twin's consumer contract binds every use** (`math/interval/index.ts` header)
- CONTINUOUS does not mean bounded. Never call a stretch flat when a bound or a sample is infinite.
- An empty result (`lo > hi`) is NaN on the whole box: skip it, don't bisect it.
- PARTIAL does not mean a pole.
- `lo > 0 || hi < 0 || lo > hi` validly discards a box, even under PARTIAL.
- Pass every variable's box.
- The loop budget is module-level: never start one twin evaluation from inside another.

**Numbers**
- **Initial values** (spec): one sample per 4 px; 25 % overscan on each side; flat means the midpoint is within ¼ px of the chord; segments at most 8 px; a sub-pixel floor of 1/16 px; 16 samples per band column.
- P2 may tune them against the corpus, and the corpus pins whatever it settles on. Every tuned number lives in `plot/sample/tuning.ts`; nowhere else hard-codes one.

**Checks** (after every task: the suite green, both typechecks clean, oxlint clean, and space's sweep identical)
- **Typecheck:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`. The bare `npx tsc --noEmit` checks nothing here.
- **Tests:** `npx vitest run <path>`. Run the full suite on its own with `npx vitest run --maxWorkers=2`; Ben's PC is in use, so never use more workers, and rerun once on an RPC timeout.
- **Lint:** `npx oxlint src`.
- **Space's scene sweep:** `npx tsx .sweep/scenes.mts` must print `identical 49; differ 0`.

**Working rules**
- **Commits:** explicit `git add <paths>`, never `git stash`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Other agents** work in other worktrees. Leave their branches, worktrees and stash entries alone.
- **No browser tools.** The controller takes headless Edge screenshots. Write regexes with the Edit/Write tools, never in Bash heredocs.

---

### Task 1: The scene contract and the renderer

Change the scene's plot shapes to the spec's contract, keeping the drawing the same: the uniform sampler stays for now and emits chains. Teach the three.js renderer and hover to draw the new kinds.

**Files:**
- Modify: `graph-engine/src/scene/types.ts`
- Create: `graph-engine/src/scene/chains.ts`, `graph-engine/src/scene/chains.test.ts`
- Modify: `graph-engine/src/scene/buildScene.ts`
- Modify: `graph-engine/src/scene/geometry/sceneObjects.ts`, `graph-engine/src/scene/geometry/buildConstructions.ts` (thread a statement index through to `circleCurve`)
- Create: `graph-engine/src/render/renderItems.ts`, `graph-engine/src/render/renderItems.test.ts`
- Modify: `graph-engine/src/render/geometryGroup.ts`, `graph-engine/src/render/SceneRenderer.ts`, `graph-engine/src/render/hover.ts`
- Modify tests: `scene/buildScene.test.ts`, `render/geometryGroup.test.ts`, `render/hover.test.ts`, and any other test that builds a `'curve'` object (let `tsc` find them)

**Interfaces:**
- Produces (`scene/types.ts`):
  ```ts
  export interface Bounds { xMin: number; xMax: number; yMin: number; yMax: number }
  export interface MarkId { statement: number; object: string }
  export interface Chain { xy: Float64Array; param: Float64Array; closed: boolean }
  export type BreakKind = 'pole' | 'jump' | 'edge'
  export interface Break { at: number; kind: BreakKind }      // `at` in the curve's parameter
  export type MarkRole = 'hole' | 'endpoint' | 'value'          // P5 adds 'feature'
  // SceneObject: the old { kind: 'curve'; points } is REPLACED by
  | { kind: 'curve'; id: MarkId; chains: Chain[]; breaks: Break[]; dashed?: boolean; color?: string | null }
  | { kind: 'mark'; id: MarkId; at: Vec2; role: MarkRole; fill: 'open' | 'filled'; exact: boolean; color?: string | null }
  | { kind: 'band'; id: MarkId; outline: Chain[]; color?: string | null }
  // 'line' gains two optional fields:
  | { kind: 'line'; id?: MarkId; through: Vec2; direction: Vec2; extent: 'infinite' | 'ray'; role?: 'asymptote'; color?: string | null }
  // Scene gains:
  stats?: { points: number; intervals: number }
  ```
- Produces (`scene/chains.ts`): `markKey(id): string` (`"<statement>/<object>"`), `chainOf(points: readonly Vec2[], params: readonly number[], closed = false): Chain`, `chainPoints(chain): Vec2[]`, `vertexCount(chain): number`.
- Produces (`render/renderItems.ts`): `type GeometryItem` and `toRenderItems(objects, bounds): { geometry: GeometryItem[]; misc: SceneObject[] }`. Signatures are below.

- [ ] **Step 1: Write `scene/chains.test.ts` and `render/renderItems.test.ts` (failing)**

```ts
// scene/chains.test.ts
import { describe, expect, it } from 'vitest'
import { chainOf, chainPoints, markKey, vertexCount } from './chains'

describe('chains', () => {
  it('round-trips points and parameters', () => {
    const c = chainOf([{ x: 0, y: 1 }, { x: 2, y: 3 }], [0, 2])
    expect(c.xy).toEqual(Float64Array.from([0, 1, 2, 3]))
    expect(c.param).toEqual(Float64Array.from([0, 2]))
    expect(c.closed).toBe(false)
    expect(chainPoints(c)).toEqual([{ x: 0, y: 1 }, { x: 2, y: 3 }])
    expect(vertexCount(c)).toBe(2)
  })
  it('keys a mark id as statement/object', () => {
    expect(markKey({ statement: 3, object: 'hole.0' })).toBe('3/hole.0')
  })
  it('refuses mismatched lengths', () => {
    expect(() => chainOf([{ x: 0, y: 0 }], [0, 1])).toThrow()
  })
})
```

```ts
// render/renderItems.test.ts
import { describe, expect, it } from 'vitest'
import { chainOf } from '../scene/chains'
import type { SceneObject } from '../scene/types'
import { toRenderItems } from './renderItems'

const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
const id = (object: string) => ({ statement: 0, object })

describe('toRenderItems', () => {
  it('draws each chain of a curve as its own ribbon, closing closed chains', () => {
    const curve: SceneObject = {
      kind: 'curve', id: id('curve'), breaks: [], color: null,
      chains: [
        chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1]),
        chainOf([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], [0, 1, 2], true),
      ],
    }
    const { geometry } = toRenderItems([curve], bounds)
    expect(geometry.map((g) => g.kind)).toEqual(['curve', 'curve'])
    if (geometry[1].kind !== 'curve') throw new Error('unreachable')
    expect(geometry[1].points).toHaveLength(4)
    expect(geometry[1].points[3]).toEqual({ x: 2, y: 0 })
  })
  it('skips a chain with fewer than two vertices', () => {
    const curve: SceneObject = { kind: 'curve', id: id('curve'), breaks: [], chains: [chainOf([{ x: 0, y: 0 }], [0])] }
    expect(toRenderItems([curve], bounds).geometry).toHaveLength(0)
  })
  it('clips an asymptote line to the view as a dashed segment', () => {
    const line: SceneObject = { kind: 'line', id: id('asymptote.0'), through: { x: 1, y: 0 }, direction: { x: 0, y: 1 }, extent: 'infinite', role: 'asymptote', color: 'gray' }
    const { geometry } = toRenderItems([line], bounds)
    expect(geometry).toHaveLength(1)
    const seg = geometry[0]
    if (seg.kind !== 'segment') throw new Error('expected a segment')
    expect(seg.dashed).toBe(true)
    expect(Math.min(seg.from.y, seg.to.y)).toBeCloseTo(-10)
    expect(Math.max(seg.from.y, seg.to.y)).toBeCloseTo(10)
  })
  it('keeps a plain construction line solid, and drops a line that misses the view', () => {
    const solid: SceneObject = { kind: 'line', through: { x: 0, y: 0 }, direction: { x: 1, y: 1 }, extent: 'infinite' }
    const missing: SceneObject = { kind: 'line', through: { x: 0, y: 50 }, direction: { x: 1, y: 0 }, extent: 'infinite' }
    const { geometry } = toRenderItems([solid, missing], bounds)
    expect(geometry).toHaveLength(1)
    expect(geometry[0].kind === 'segment' && !geometry[0].dashed).toBe(true)
  })
  it('fills a band as triangles covering its outline', () => {
    const band: SceneObject = {
      kind: 'band', id: id('band.0'),
      outline: [chainOf([{ x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [0, 1, 1, 0], true)],
    }
    const { geometry } = toRenderItems([band], bounds)
    expect(geometry).toHaveLength(1)
    if (geometry[0].kind !== 'region') throw new Error('expected a region')
    expect(geometry[0].triangles.length % 3).toBe(0)
    let area = 0
    const t = geometry[0].triangles
    for (let i = 0; i < t.length; i += 3) area += Math.abs((t[i + 1].x - t[i].x) * (t[i + 2].y - t[i].y) - (t[i + 2].x - t[i].x) * (t[i + 1].y - t[i].y)) / 2
    expect(area).toBeCloseTo(2, 10)
  })
  it('passes marks and points to the misc group untouched', () => {
    const mark: SceneObject = { kind: 'mark', id: id('hole.0'), at: { x: 1, y: 2 }, role: 'hole', fill: 'open', exact: true }
    const { geometry, misc } = toRenderItems([mark], bounds)
    expect(geometry).toHaveLength(0)
    expect(misc).toEqual([mark])
  })
})
```

- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/scene/chains.test.ts src/render/renderItems.test.ts` should fail with module not found.

- [ ] **Step 3: Write `scene/chains.ts`**

```ts
// Chains: the scene contract's runs of connected vertices (calc P2; spec "The
// scene contract"). Float64 world coordinates, with the curve's parameter at
// each vertex, so goal 2's pen can pin wobble to the mathematics and hover can
// report the parameter.
import type { Chain, MarkId, Vec2 } from './types'

export function markKey(id: MarkId): string {
  return `${id.statement}/${id.object}`
}

export function chainOf(points: readonly Vec2[], params: readonly number[], closed = false): Chain {
  if (points.length !== params.length) throw new Error(`chainOf: ${points.length} points but ${params.length} parameters`)
  const xy = new Float64Array(points.length * 2)
  points.forEach((p, i) => {
    xy[2 * i] = p.x
    xy[2 * i + 1] = p.y
  })
  return { xy, param: Float64Array.from(params), closed }
}

export function vertexCount(chain: Chain): number {
  return chain.param.length
}

export function chainPoints(chain: Chain): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < chain.param.length; i++) out.push({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] })
  return out
}
```

- [ ] **Step 4: Change `scene/types.ts`.** Add `Bounds`, `MarkId`, `Chain`, `BreakKind`, `Break` and `MarkRole`. Replace the curve kind, add `mark` and `band`, add `id?`/`role?` to `line`, and add `stats?` to `Scene`. All exactly as in Interfaces. Write a comment on each new kind in the file's existing style:
  - `curve` chains are float64 world coordinates; `breaks` are where the curve is mathematically interrupted;
  - a `mark` is a typed point: a hole or an endpoint, open or filled;
  - a `band` is a filled outline of the curve's extent where it oscillates faster than a pixel;
  - an asymptote `line` is a guide, dashed when drawn.

- [ ] **Step 5: Write `render/renderItems.ts`**

```ts
// From the scene contract to the three.js renderer's primitives (calc P2). The
// scene speaks in chains, bands, typed marks and unclipped lines; the renderer
// draws ribbons (one per chain), triangle regions and point-like marks. Pure, so
// it is tested without WebGL.
import * as THREE from 'three'
import { chainPoints } from '../scene/chains'
import type { Bounds, SceneObject, Vec2 } from '../scene/types'
import { clipLineToBounds } from './clipLine'

export type GeometryItem =
  | { kind: 'curve'; points: Vec2[]; color?: string | null }
  | { kind: 'segment'; from: Vec2; to: Vec2; dashed?: boolean; color?: string | null }
  | { kind: 'segments'; pairs: [Vec2, Vec2][]; dashed?: boolean; color?: string | null }
  | { kind: 'region'; triangles: Vec2[]; color?: string | null }

export function toRenderItems(objects: readonly SceneObject[], bounds: Bounds): { geometry: GeometryItem[]; misc: SceneObject[] } {
  const geometry: GeometryItem[] = []
  const misc: SceneObject[] = []
  for (const obj of objects) {
    switch (obj.kind) {
      case 'curve':
        for (const chain of obj.chains) {
          const points = chainPoints(chain)
          if (points.length < 2) continue
          if (chain.closed) points.push(points[0])
          geometry.push({ kind: 'curve', points, color: obj.color })
        }
        break
      case 'band': {
        const triangles: Vec2[] = []
        for (const chain of obj.outline) {
          const contour = chainPoints(chain).map((p) => new THREE.Vector2(p.x, p.y))
          if (contour.length < 3) continue
          for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
            triangles.push(
              { x: contour[a].x, y: contour[a].y },
              { x: contour[b].x, y: contour[b].y },
              { x: contour[c].x, y: contour[c].y }
            )
          }
        }
        if (triangles.length > 0) geometry.push({ kind: 'region', triangles, color: obj.color })
        break
      }
      case 'line': {
        const span = clipLineToBounds(obj.through, obj.direction, obj.extent, bounds)
        if (span) geometry.push({ kind: 'segment', from: span[0], to: span[1], dashed: obj.role === 'asymptote', color: obj.color })
        break
      }
      case 'segment':
      case 'segments':
      case 'region':
        geometry.push(obj)
        break
      default:
        misc.push(obj)
    }
  }
  return { geometry, misc }
}
```

- [ ] **Step 6: Point `render/geometryGroup.ts` at `GeometryItem`.**
  - Replace `type GeometrySceneObject = Extract<SceneObject, { kind: GeometryKind }>` with `GeometryItem` from `./renderItems`. `isGeometryKind` goes, since `toRenderItems` now decides.
  - The ribbon code is unchanged: a `'curve'` item still carries `points: Vec2[]`.
  - Update `geometryGroup.test.ts` to type its literals as `GeometryItem`.

- [ ] **Step 7: Route `SceneRenderer.setGraphScene` through `toRenderItems`, and draw `'mark'`.**
  - `setGraphScene` calls `toRenderItems(scene.objects, this.camera2d.getBounds())`. It passes `geometry` to `geometryGroupManager.update` and `misc` to `updateMiscGroup`. Delete `clipConstructionLines`; `toRenderItems` clips now.
  - Draw a `'mark'` in the misc group exactly as a point with no label: shape `'ring'` when `fill === 'open'` and `'dot'` when `'filled'`. The ring keeps its background disc, so an open hole hides the curve under its centre.
  - The colour is the mark's own, or the palette's **curve** colour when null, not the point colour: a mark belongs to its curve.
  - Give the mark a `contentKey`, or reuse the point path's in-place update, so a pan does not rebuild its buffers.

- [ ] **Step 8: Update `render/hover.ts`.**
  - In `'all'` mode a curve is scanned chain by chain: consecutive vertex pairs of each chain, never across chains.
  - A `'mark'` is considered like a point: `exact: obj.exact`, no feature kind, `showGuide: false`.
  - Update `hover.test.ts`'s curve literals to `chainOf(...)`.

- [ ] **Step 9: Move every curve producer to chains, with identities.**
  - **The uniform sampler in `buildScene.ts`** (`sampleExplicit`, `samplePolar`, `sampleParametric`) now returns **one** `curve` object per statement, `id: { statement: index, object: 'curve' }`. Each former segment becomes a chain whose `param` holds the sampled parameter (x, y, θ or t).
  - **Breaks, for now:** the window-rule split records `{ at: midpoint, kind: 'pole' }`; a NaN or out-of-domain split records `{ at, kind: 'edge' }`. P2 Task 7 replaces this sampler. Pass `statementIndex` into these functions.
  - **Asymptote guides** become one `line` per merged x: `{ kind: 'line', id: { statement, object: 'asymptote.<k>' }, through: { x, y: 0 }, direction: { x: 0, y: 1 }, extent: 'infinite', role: 'asymptote', color: statement.color ?? 'gray' }`. They replace the old dashed `segments`.
  - **`tangent:`** becomes a `line` through `(a, f(a))` with direction `(1, slope)`, id `'tangent'`, plus its point as before.
  - **A scatter's regression line** becomes a `line` through `(0, intercept)` with direction `(1, slope)`, id `'regression'`.
  - **Circles:** `circleCurve(center, radius, color, id)` returns `{ kind: 'curve', id, chains: [chainOf(points, angles, true)], breaks: [] }`. The chain holds the 96 samples **without** the repeated end point; the chain is closed.
    - `buildCircle` passes `{ statement: index, object: 'curve' }`.
    - `buildConstructions` passes `{ statement: <its loop index>, object: <the bound name or 'circle.<k>'> }` through `geometryObjectToScene`.
    - Do not change `geometryByStatement`: the figure renderer reads it.
  - **Update `buildScene.test.ts`.**
    - Tests that counted curve objects now count chains (for example, "a two-interval if domain does not bridge its gap" expects one curve with two chains).
    - Tests that read `curve.points` use `chainPoints(curve.chains[0])` or flatten all chains.
    - The asymptote tests look for `line` objects with `role: 'asymptote'`.
    - The tangent test reads the `line`.
    - A test that only reworded its access keeps its assertion. No assertion's meaning changes in this task.

- [ ] **Step 10: Run everything.**
  - `npx vitest run src/scene src/render`, then the full suite with `--maxWorkers=2`, both typechecks, `npx oxlint src` and the sweep. All must be green.
  - The figure golden-hash tests must pass unchanged: proof that the figure engine did not move.

- [ ] **Step 11: Commit.**

```bash
git add graph-engine/src/scene graph-engine/src/render
git commit -m "feat(scene): the plot contract — chains with parameters, typed breaks, marks, bands and identities; the renderer draws them through renderItems

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Trouble spots — the structure walk and the zero locator

Samples alone cannot find a hole no sample lands on. Walk the expression for the expressions whose zeros are its candidate trouble spots, then isolate those zeros in the sampled range with the interval twin.

**Files:**
- Create: `graph-engine/src/plot/sample/types.ts` (shared sampler types)
- Create: `graph-engine/src/plot/sample/structure.ts`, `graph-engine/src/plot/sample/structure.test.ts`
- Create: `graph-engine/src/plot/sample/locate.ts`, `graph-engine/src/plot/sample/locate.test.ts`
- Create: `graph-engine/src/plot/sample/tuning.ts` (this task adds `LOCATE`; later tasks add theirs)
- Create: `graph-engine/src/plot/sample/testkit.ts` (`expr(text)` parses with `parseExprString`; `scopeOf(defs?: string, angle?)` builds a `MathScope` from definition lines with `parseSpec` + `buildPlotScope`)

**Interfaces:**
- Produces (`types.ts`): `interface EvalCounter { points: number; intervals: number }` (counts **up**; sampler budgets compare against it).
- Produces (`structure.ts`):
  ```ts
  export type Origin = 'seam' | 'natural'   // seam: a piecewise or domain condition; natural: a function's own domain, pole or step
  export interface Generator { expr: Expr; origin: Origin; why: string }
  export function troubleGenerators(expr: Expr, param: string, scope: MathScope): Generator[]
  export const TROUBLE_BUILTINS: ReadonlySet<string>
  export const SMOOTH_BUILTINS: ReadonlySet<string>
  ```
- Produces (`locate.ts`):
  ```ts
  export interface Zero { t: number; origin: Origin; why: string }
  export interface LocateResult { zeros: Zero[]; truncated: boolean }
  export function locateZeros(gens: readonly Generator[], param: string, scope: MathScope, t0: number, t1: number, counter: EvalCounter): LocateResult
  ```
- Produces (`tuning.ts`): `export const LOCATE = { maxZeros: 64, intervalsPerGenerator: 6000, tolRel: 1e-12 }`.

**The generator rules.** These are the ones `structure.ts` implements. `k` is `Math.PI` under radians and `180` under degrees, so `sin(k·u)` is zero exactly at whole `u` in the user's own angle unit. Write generators as `Expr`s with `math/expr.ts`'s constructors. They compile in the user's scope, so `@param`s and user functions resolve.

| Node | Generators (each also walks its children) |
|---|---|
| `a / b` | `b` (natural, `'denominator'`) |
| `b ^ e` | `b` (natural, `'power base'`), unless `e` is a positive whole number literal |
| `sqrt(u)`, `ln(u)`, `log(u)` | `u` |
| `log(a, b)` | `a`, `b`, `b − 1` |
| `root(n, u)` | `u` |
| `asin(u)`, `acos(u)`, `atanh(u)` | `u − 1`, `u + 1` |
| `acosh(u)` | `u − 1` |
| `tan(u)`, `sec(u)` | `cos(u)` |
| `csc(u)`, `cot(u)` | `sin(u)` |
| `gamma(u)` | `sin(k·u)` |
| `__factorial(u)` | `sin(k·(u + 1))` |
| `floor(u)`, `ceil(u)` | `sin(k·u)` |
| `round(u)` | `cos(k·u)` |
| `sign(u)`, `step(u)` | `u` |
| `mod(a, b)` | `b`, `sin(k·a/b)` |
| `atan2(y, x)` | `y`, `x` |
| `__lt __le __gt __ge __eq __ne (a, b)` | `a − b` (**seam**, `'condition'`) |
| `__and __or __not __piecewise` | none of their own; walk every argument |
| `__sum __prod __integral (v, lo, hi, body)` | walk `lo` and `hi` only, never `body` (it binds `v`) |
| `__prime(f, k, …)` | walk `expandPrime(node, scope)` |
| a call to a user function | inline: substitute the call's arguments for the function's parameters with `math/expr.ts`'s `substitute` (binder-aware), then walk. Depth cap 32 |
| `choose perm gcd lcm` | none (the twin and the jump test cover them) |
| everything else | smooth: `sin cos atan sinh cosh tanh asinh exp abs min max hypot erf erfc cbrt` |

Drop a generator whose deep free variables (`freeVariablesDeep(gen, scope)`) do not include `param`. Deduplicate by `JSON.stringify(expr)`; when duplicates differ in origin, `seam` wins.

- [ ] **Step 1: Write the failing tests.** `structure.test.ts` checks coverage and categories. `locate.test.ts` checks the zeros (the behaviour that matters).

```ts
// structure.test.ts
import { describe, expect, it } from 'vitest'
import { BUILTIN_NAMES } from '../../math/compile'
import { expr, scopeOf } from './testkit'
import { SMOOTH_BUILTINS, TROUBLE_BUILTINS, troubleGenerators } from './structure'

describe('troubleGenerators', () => {
  it('classifies every built-in as troubled or smooth, never both', () => {
    for (const name of BUILTIN_NAMES) expect(TROUBLE_BUILTINS.has(name) !== SMOOTH_BUILTINS.has(name), name).toBe(true)
  })
  it('names a denominator, a log domain and a condition seam', () => {
    const whys = troubleGenerators(expr('{x < 1: ln(x), 1/(x - 2)}'), 'x', scopeOf()).map((g) => `${g.origin}:${g.why}`)
    expect(whys).toEqual(expect.arrayContaining(['seam:condition', 'natural:ln domain', 'natural:denominator']))
  })
  it('drops generators that do not depend on the parameter', () => {
    expect(troubleGenerators(expr('x / a'), 'x', scopeOf('@param a = 2'))).toEqual([])
  })
  it('sees through a user function and a derivative', () => {
    expect(troubleGenerators(expr('f(x)'), 'x', scopeOf('f(x) = 1/(x - 3)')).length).toBeGreaterThan(0)
    expect(troubleGenerators(expr("f'(x)"), 'x', scopeOf('f(x) = 1/x')).length).toBeGreaterThan(0)
  })
  it('never walks into a binder body', () => {
    expect(troubleGenerators(expr('sum(k = 1 to 5, 1/(x - k))'), 'x', scopeOf())).toEqual([])
  })
  it('leaves x^2 and x^3 alone but not x^-1 or x^(1/2)', () => {
    expect(troubleGenerators(expr('x^2 + x^3'), 'x', scopeOf())).toEqual([])
    expect(troubleGenerators(expr('x^(-1)'), 'x', scopeOf())).toHaveLength(1)
    expect(troubleGenerators(expr('x^(1/2)'), 'x', scopeOf())).toHaveLength(1)
  })
})
```

```ts
// locate.test.ts
import { describe, expect, it } from 'vitest'
import { locateZeros } from './locate'
import { troubleGenerators } from './structure'
import { expr, scopeOf } from './testkit'

function zerosOf(text: string, t0: number, t1: number, defs = '', angle: 'radians' | 'degrees' = 'radians') {
  const scope = scopeOf(defs, angle)
  const counter = { points: 0, intervals: 0 }
  return locateZeros(troubleGenerators(expr(text), 'x', scope), 'x', scope, t0, t1, counter)
}
const near = (zs: { t: number }[], want: number[], tol = 1e-11) => {
  expect(zs.map((z) => z.t)).toHaveLength(want.length)
  want.forEach((w, i) => expect(Math.abs(zs[i].t - w)).toBeLessThan(tol * Math.max(1, Math.abs(w))))
}

describe('locateZeros', () => {
  it('finds tan poles, in radians and in degrees', () => {
    near(zerosOf('tan(x)', -5, 5).zeros, [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2])
    near(zerosOf('tan(x)', -300, 300, '', 'degrees').zeros, [-270, -90, 90, 270])
  })
  it('finds an even zero no sign change shows (1/x^2)', () => near(zerosOf('1/x^2', -3, 3).zeros, [0]))
  it('finds the hole of (x^2 - 1)/(x - 1)', () => near(zerosOf('(x^2 - 1)/(x - 1)', -3, 3).zeros, [1]))
  it('finds floor steps, a log edge, a sqrt edge and the asin edges', () => {
    near(zerosOf('floor(x)', -2.5, 2.5).zeros, [-2, -1, 0, 1, 2])
    near(zerosOf('ln(x)', -2, 2).zeros, [0])
    near(zerosOf('sqrt(x - 2)', 0, 4).zeros, [2])
    near(zerosOf('asin(x)', -2, 2).zeros, [-1, 1])
  })
  it('finds the gamma poles in range', () => near(zerosOf('gamma(x)', -3.5, 0.5).zeros, [-3, -2, -1, 0]))
  it('marks piecewise and domain seams as seams', () => {
    const r = zerosOf('{0 < x <= 3: 2}', -1, 4)
    near(r.zeros, [0, 3])
    expect(r.zeros.every((z) => z.origin === 'seam')).toBe(true)
  })
  it('resolves parameters and user functions', () => {
    near(zerosOf('f(x)', -5, 5, 'f(x) = 1/(x - a)\n@param a = 2').zeros, [2])
  })
  it('gives both ends of a stretch where a generator is zero (1/floor(x))', () => {
    const ts = zerosOf('1/floor(x)', -0.5, 1.5).zeros.map((z) => z.t)
    expect(ts.some((t) => Math.abs(t) < 1e-9)).toBe(true)
    expect(ts.some((t) => Math.abs(t - 1) < 1e-9)).toBe(true)
  })
  it('stops at the cap where zeros accumulate (tan(1/x)) and says so', () => {
    const r = zerosOf('tan(1/x)', -1, 1)
    expect(r.truncated).toBe(true)
    expect(r.zeros.length).toBeLessThanOrEqual(64)
  })
  it('counts its evaluations and is deterministic', () => {
    const scope = scopeOf()
    const a = { points: 0, intervals: 0 }
    const b = { points: 0, intervals: 0 }
    const gens = troubleGenerators(expr('tan(x) + 1/(x - 1)'), 'x', scope)
    expect(locateZeros(gens, 'x', scope, -5, 5, a)).toEqual(locateZeros(gens, 'x', scope, -5, 5, b))
    expect(a).toEqual(b)
    expect(a.intervals).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run and see them fail** (`npx vitest run src/plot/sample`).

- [ ] **Step 3: Write `types.ts`, `tuning.ts`, `testkit.ts` and `structure.ts`.**
  - Implement the rules table.
  - `TROUBLE_BUILTINS` holds the built-ins with a rule: `sqrt ln log root asin acos atanh acosh tan sec csc cot gamma floor ceil round sign step mod atan2 choose perm gcd lcm`. `choose perm gcd lcm` are listed as troubled with an empty rule, so the coverage test stays honest.
  - `SMOOTH_BUILTINS` holds the rest of `BUILTIN_NAMES`.
  - Before you start, read `math/expr.ts` (`substitute`), `math/prime.ts` (`expandPrime`), `math/compile.ts` (`freeVariablesDeep`, `BUILTIN_NAMES`) and `math/reserved.ts` (the comparison names, `BINDERS`).
  - Value names (constants, `@param`s) stay as `var` nodes; the compile resolves them.
  - A user function with a vector body (`isVectorBody`) is not inlined.

- [ ] **Step 4: Write `locate.ts`**

```ts
// Isolating the zeros of the trouble-spot generators in the sampled range
// (calc P2; spec "Singularities from the expression's structure"). Interval
// branch and bound with the twin: a box whose enclosure excludes zero (lo > 0,
// hi < 0, or empty — valid under any verdict, per the twin's contract) holds no
// zero; the rest bisect to a width of tolRel·max(1, |t|). Adjacent surviving
// leaves form clusters. A narrow cluster is one zero: bisected on the sign of the
// scalar to adjacent doubles when the sign changes across it (odd zeros), else
// its midpoint (even zeros, like x^2). A cluster still wide when the budget runs
// out is a stretch where the generator is zero: both its ends are zeros.
import { compileScalar } from '../../math/compile'
import { compileInterval, isEmpty, iv } from '../../math/interval'
import type { MathScope } from '../../math/scope'
import type { Generator, Origin } from './structure'
import { LOCATE } from './tuning'
import type { EvalCounter } from './types'

export interface Zero { t: number; origin: Origin; why: string }
export interface LocateResult { zeros: Zero[]; truncated: boolean }

export function locateZeros(gens: readonly Generator[], param: string, scope: MathScope, t0: number, t1: number, counter: EvalCounter): LocateResult {
  const all: Zero[] = []
  let truncated = false
  for (const gen of gens) {
    const g = compileScalar(gen.expr, [param], scope)
    const gi = compileInterval(gen.expr, [param], scope)
    const out = iv()
    const leaves: [number, number][] = []
    const stack: [number, number][] = [[t0, t1]]
    let spent = 0
    while (stack.length > 0) {
      if (spent >= LOCATE.intervalsPerGenerator || leaves.length > LOCATE.maxZeros * 8) {
        truncated = true
        break
      }
      const [lo, hi] = stack.pop()!
      gi(out, lo, hi)
      spent++
      counter.intervals++
      if (isEmpty(out) || out.lo > 0 || out.hi < 0) continue
      const mid = lo + (hi - lo) / 2
      if (hi - lo <= LOCATE.tolRel * Math.max(1, Math.abs(mid)) || mid <= lo || mid >= hi) {
        leaves.push([lo, hi])
        continue
      }
      stack.push([mid, hi], [lo, mid]) // left first off the stack: leaves come out in order
    }
    for (const [lo, hi] of clusters(leaves)) {
      const tol = LOCATE.tolRel * Math.max(1, Math.abs(lo), Math.abs(hi))
      if (hi - lo > 64 * tol) {
        all.push({ t: lo, origin: gen.origin, why: gen.why }, { t: hi, origin: gen.origin, why: gen.why })
        continue
      }
      all.push({ t: refine(g, lo, hi, counter), origin: gen.origin, why: gen.why })
    }
  }
  return merge(all, t0, t1, truncated)
}
```
Write `clusters` (merges leaves whose ends touch, in order) and `refine` (bisect on the sign of `g` when `g(lo)` and `g(hi)` have opposite signs, to adjacent doubles or 64 steps, counting point evaluations; else the midpoint). Write `merge`:
- sort by `t`;
- drop zeros outside `(t0, t1)`, within `4·tol` of an end;
- merge zeros within `4·tol` of each other (`seam` wins; join the `why`s with `+`);
- cap at `LOCATE.maxZeros`, setting `truncated` when it cuts.

- [ ] **Step 5: Run the tests until green.** Then the full suite, typechecks, lint and sweep.

- [ ] **Step 6: Commit.**

```bash
git add graph-engine/src/plot/sample
git commit -m "feat(plot): trouble spots — generators from the expression's structure, zeros isolated with the interval twin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One-sided limits — pole, jump, hole or edge

Classify each located zero by evaluating the curve at a geometric sequence of offsets on each side.

**Files:**
- Create: `graph-engine/src/plot/sample/limits.ts`, `graph-engine/src/plot/sample/limits.test.ts`
- Modify: `graph-engine/src/plot/sample/tuning.ts` (add `LIMITS`), `graph-engine/src/plot/sample/types.ts` (add `PointFn`, `PxScale`)

**Interfaces:**
- Consumes: `EvalCounter`.
- Produces (`types.ts`): `type PointFn = (t: number, out: Float64Array) => void` writes `out[0] = x`, `out[1] = y` (NaN when undefined). `interface PxScale { x: number; y: number }` gives screen px per world unit on each axis.
- Produces (`limits.ts`):
  ```ts
  export type Side = { kind: 'undefined' } | { kind: 'converge'; at: Vec2 } | { kind: 'diverge'; sign: 1 | -1 } | { kind: 'unknown' }
  export type Classification =
    | { kind: 'regular' }
    | { kind: 'pole' }
    | { kind: 'jump'; left: Vec2; right: Vec2; value: Vec2 | null }
    | { kind: 'hole'; limit: Vec2; value: Vec2 | null }          // value: the point's own value when defined and different
    | { kind: 'edge'; defined: 'left' | 'right'; limit: Vec2 | null }  // limit null when the defined side diverges
    | { kind: 'unknown' }
  export function oneSided(point: PointFn, tc: number, side: -1 | 1, h0: number, px: PxScale, counter: EvalCounter): Side
  export function classify(point: PointFn, tc: number, h0: number, px: PxScale, counter: EvalCounter): Classification
  ```
- Produces (`tuning.ts`): `export const LIMITS = { steps: 12, shrink: 4, minRel: 1e-9, window: 4, convergePx: 0.05, convergeRatio: 0.9, divergeRatio: 0.95, divergeRun: 5, undefinedRun: 3 }`.

**The rule** (write it as the header comment of `limits.ts`):
- **Offsets:** `h_k = h0 / shrink^k` for `k = 0 … steps`. Stop early once `h_k < minRel·max(1, |tc|)`. Below that, cancellation noise in `(x² − 1)/(x − 1)` passes a tenth of a pixel. `h0` is the parameter step worth 4 px.
- **A side's samples** are `P_k = point(tc + side·h_k)`, compared in screen px (x·px.x, y·px.y). The side is:
  - **undefined:** the last `undefinedRun` samples are all NaN in either coordinate;
  - **converge** (either test passes):
    - *window:* the last `window` finite samples lie within `convergePx` of each other, so a shrinking oscillation like x·sin(1/x) converges. The limit is the last sample.
    - *geometric:* the last 3 successive differences shrink, each at most `convergeRatio` times the one before, and the tail estimate `d·r/(1 − r)` is under `convergePx`. The limit is the last sample plus that tail along the last difference.
  - **diverge:** over the last `divergeRun` steps the screen distance from the first sample grows monotonically, each step's difference at least `divergeRatio` times the previous. This catches `ln` (constant differences) as well as `1/x` (growing ones). The sign is the sign of the last y minus the first.
  - **unknown:** otherwise.
- **Classify:** compute `L = oneSided(−1)`, `R = oneSided(+1)` and `v = point(tc)`. The point is defined when both coordinates are finite. "Equal" means within `convergePx` on screen.
  - both diverge → `pole`;
  - one undefined and the other converges → `edge` with that limit;
  - one undefined and the other diverges → `edge` with `limit: null`;
  - both converge, not equal → `jump` (`value` is `v` when defined, else null);
  - both converge, equal, and `v` undefined → `hole` (`value: null`);
  - both converge, equal, and `v` defined but not equal → `hole` with `value: v`;
  - both converge, equal, and `v` equal → `regular`;
  - anything else → `unknown`.

- [ ] **Step 1: Write the failing tests.** Use `testkit.ts`'s `pointFnOf(text, param, scope)`. It compiles `y = f(x)` into `(t, out) => { out[0] = t; out[1] = f(t) }`; add it to the testkit in this task. Use `h0 = 0.1` and `px = { x: 40, y: 40 }`: a 20-unit view at 800 px.

```ts
import { describe, expect, it } from 'vitest'
import { classify } from './limits'
import { pointFnOf, scopeOf } from './testkit'

const c = (text: string, tc: number, defs = '', angle: 'radians' | 'degrees' = 'radians') =>
  classify(pointFnOf(text, 'x', scopeOf(defs, angle)), tc, 0.1, { x: 40, y: 40 }, { points: 0, intervals: 0 })

describe('classify', () => {
  it('poles', () => {
    expect(c('1/x', 0).kind).toBe('pole')
    expect(c('1/x^2', 0).kind).toBe('pole')
    expect(c('tan(x)', Math.PI / 2).kind).toBe('pole')
    expect(c('tan(x)', 90, '', 'degrees').kind).toBe('pole')
  })
  it('holes, with the limit', () => {
    for (const [text, at, limit] of [['(x^2 - 1)/(x - 1)', 1, 2], ['sin(x)/x', 0, 1], ['sin(x - pi)/(x - pi)', Math.PI, 1], ['x sin(1/x)', 0, 0]] as const) {
      const r = c(text, at)
      expect(r.kind, text).toBe('hole')
      if (r.kind === 'hole') {
        expect(r.limit.y).toBeCloseTo(limit, 6)
        expect(r.value).toBeNull()
      }
    }
  })
  it('a removable point with its own value', () => {
    const r = c('{x = 1: 5, x}', 1)
    expect(r).toMatchObject({ kind: 'hole', limit: { x: 1, y: expect.closeTo(1, 6) }, value: { x: 1, y: 5 } })
  })
  it('jumps, with the value at the seam', () => {
    expect(c('floor(x)', 1)).toMatchObject({ kind: 'jump', left: { y: expect.closeTo(0, 9) }, right: { y: expect.closeTo(1, 9) }, value: { y: 1 } })
    expect(c('{x < 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 1 } })
    expect(c('{x <= 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 0 } })
  })
  it('edges', () => {
    expect(c('sqrt(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(0, 3) } })
    expect(c('ln(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: null })
    expect(c('{0 < x <= 3: 2}', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(2, 9) } })
    expect(c('{0 < x <= 3: 2}', 3)).toMatchObject({ kind: 'edge', defined: 'left', limit: { y: expect.closeTo(2, 9) } })
  })
  it('regular points and the honest unknowns', () => {
    expect(c('{x < 1: x, x}', 1).kind).toBe('regular')
    expect(c('sin(1/x)', 0).kind).toBe('unknown')
    expect(c('x^0.1', 0).kind).toBe('unknown') // converges too slowly to call within the offsets; the sampler reaches the edge itself
  })
})
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `limits.ts`** to the rule. Reuse one module-level `Float64Array(2)` per call site; count every `point` call in `counter.points`.

- [ ] **Step 4: Green; then the full suite, typechecks, lint and sweep.**

- [ ] **Step 5: Commit.**

```bash
git add graph-engine/src/plot/sample
git commit -m "feat(plot): one-sided limits classify each trouble spot as a pole, jump, hole or edge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The adaptive core

Screen-space subdivision of one parameter range into chains. An interval is connected only when the twin certifies it continuous, or when the jump test shows its gap closing.

**Files:**
- Create: `graph-engine/src/plot/sample/sink.ts`, `graph-engine/src/plot/sample/sink.test.ts`
- Create: `graph-engine/src/plot/sample/adaptive.ts`, `graph-engine/src/plot/sample/adaptive.test.ts`
- Modify: `graph-engine/src/plot/sample/tuning.ts` (add `Tuning`, `FULL`, `COARSE`), `graph-engine/src/plot/sample/types.ts`, `graph-engine/src/plot/sample/testkit.ts` (add `fnsOf`)

**Interfaces:**
- Consumes: `Chain`, `Break`, `BreakKind`, `Bounds` from `scene/types.ts`; `compileInterval`, `iv`, `isEmpty`, `CONTINUOUS`; `PointFn`, `PxScale`, `EvalCounter`.
- Produces (`types.ts`):
  ```ts
  export interface Box { xLo: number; xHi: number; yLo: number; yHi: number }
  export interface CurveFns {
    point: PointFn
    enclose(tLo: number, tHi: number, out: Box): Verdict   // the twin of both coordinates; the worse verdict
    pxPerT: number                                         // screen px per parameter unit, for the sub-pixel floor and the start density
    oscillationAxis: 'y' | 'x' | null                      // explicit y = f(x): 'y'; x = f(y): 'x'; polar/parametric: null (no bands)
  }
  export interface Screen { px: PxScale; clip: Bounds }    // clip = the view with 25 % overscan on each side
  export type End = { kind: 'free' } | { kind: 'anchor'; at: Vec2 } | { kind: 'singular' }
  ```
- Produces (`tuning.ts`):
  ```ts
  export interface Tuning { startPx: number; flatPx: number; maxSegPx: number; floorPx: number; gapPx: number; halvings: number; halvingShrink: number; spikeFactor: number; spikeSlackPx: number; overscan: number; budget: { points: number; intervals: number } }
  export const FULL: Tuning = { startPx: 4, flatPx: 0.25, maxSegPx: 8, floorPx: 1 / 16, gapPx: 1, halvings: 3, halvingShrink: 0.75, spikeFactor: 8, spikeSlackPx: 2, overscan: 0.25, budget: { points: 60000, intervals: 30000 } }
  export const COARSE: Tuning = { ...FULL, startPx: 8, flatPx: 0.5, budget: { points: 15000, intervals: 7500 } }
  ```
- Produces (`sink.ts`): `class ChainSink { constructor(clip: Bounds); segment(xa, ya, ta, xb, yb, tb): void; lift(): void; addBreak(t: number, kind: BreakKind): void; chains(): Chain[]; breaks(): Break[] }`.
- Produces (`adaptive.ts`): `sampleRange(fns: CurveFns, t0: number, t1: number, ends: { left: End; right: End }, screen: Screen, tuning: Tuning, counter: EvalCounter, sink: ChainSink): { capped: boolean }`.

**The sink.** `segment` connects `a` to `b`, clipped to `clip` (Liang–Barsky). Behaviour:
- If the pen is not at `(xa, ya, ta)`, compared by exact `ta` equality and position, it starts a new chain.
- A segment that leaves the clip box ends the chain at the boundary. One that enters it starts a chain at the boundary.
- Clipped vertices carry an interpolated parameter.
- Leaving the overscan box records no break: it is not mathematics.
- `lift()` ends the current chain.
- Chains with fewer than 2 vertices are discarded.
- Coordinates in chains are therefore always finite and inside `clip`.

**The core**, written as the header comment of `adaptive.ts`:
1. **Start:** the initial grid has `n = max(8, ceil((t1 − t0)·pxPerT / startPx))` intervals. An `anchor` end uses its point instead of evaluating there. A `singular` end evaluates at `t ± floorPx/pxPerT`, nudged inward, never at the end itself.
2. **Each interval `[ta, tb]`**, with points `Pa` and `Pb`, is handled depth-first in parameter order:
   - **Budget:** if the counter has reached the budget, connect only when the parent interval was certified and both points are finite; otherwise `lift()`. Mark `capped`.
   - **Cull:** `enclose(ta, tb)` (count it). An empty enclosure, or one disjoint from `clip`, means nothing visible is here: `lift()` and return. This is valid under any verdict.
   - `widthPx = (tb − ta)·pxPerT`.
   - **Certified** (verdict CONTINUOUS and both points finite): evaluate the midpoint `Pm`. Accept, with `segment(Pa → Pb)`, when:
     - `Pm` is within `flatPx` of the chord on screen, and
     - the chord is at most `maxSegPx` long on screen, and
     - (the spike test) the enclosure's screen height and width are each at most `spikeFactor·(the samples' screen span on that axis) + spikeSlackPx`.

     Otherwise, if `widthPx ≤ floorPx`, accept anyway: **steepness never breaks a curve**. Otherwise bisect, reusing `Pm`.
   - **Both undefined:** at the floor, `lift()`. Otherwise bisect, which finds defined stretches inside.
   - **One undefined:** at the floor, **edge refine**: bisect on `isFinite(point)` between the defined and undefined ends, to adjacent doubles or 64 steps. Then `segment(defined end → last defined point)`, `addBreak(t, 'edge')` and `lift()`. Otherwise bisect.
   - **Both finite but not certified:** `gap` is their screen distance. If `gap < gapPx` and the **jump test** passes, connect. Otherwise:
     - at the floor: `lift()`, `addBreak((ta + tb)/2, 'jump')`;
     - else bisect.

     The jump test makes `halvings` successive halvings. Each evaluates the midpoint of the current interval and keeps the half with the larger gap; the gaps must each shrink to at most `halvingShrink` times the one before.
3. **Infinite samples are undefined** for these purposes (`!Number.isFinite`): never certify flat with an infinite sample.

The `oscillationAxis` hook is Task 6's. Leave a clearly named no-op call site, `bandColumn(...)`, at the "certified, not flat, `widthPx ≤ 1`" and "not certified, `widthPx ≤ 1`" points. Write it returning `false`.

- [ ] **Step 1: Write the failing tests.**
  - `testkit.fnsOf(text, scope)` builds `CurveFns` for `y = f(x)`:
    - point `(t, f(t))`;
    - `enclose`: x is `[tLo, tHi]` CONTINUOUS, y is the twin;
    - `pxPerT = 40`, `oscillationAxis: 'y'`.
  - `testkit.view` is `{ px: { x: 40, y: 40 }, clip: { xMin: -15, xMax: 15, yMin: -15, yMax: 15 } }`: the view [−10, 10]² at 800 px with 25 % overscan.
  - `testkit.run(text, opts?)` samples the range [−15, 15] with free ends, `FULL` tuning (or a given one) and a fresh sink, and returns `{ chains, breaks, capped, counter }`.

```ts
import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import { FULL } from './tuning'
import { run, scopeOf, trueY } from './testkit'

// every vertex within ½ px of the true curve, and every segment's midpoint within 1 px (no aliasing)
function onCurve(text: string, chains: ReturnType<typeof run>['chains']) {
  const f = trueY(text, scopeOf())
  for (const c of chains) {
    const p = chainPoints(c)
    for (let i = 0; i < p.length; i++) {
      if (Math.abs(p[i].y) < 14.99) expect(Math.abs(f(p[i].x) - p[i].y) * 40, `${text} vertex at ${p[i].x}`).toBeLessThanOrEqual(0.5)
      if (i > 0) {
        const mx = (p[i - 1].x + p[i].x) / 2
        const my = (p[i - 1].y + p[i].y) / 2
        if (Math.abs(my) < 10) expect(Math.abs(f(mx) - my) * 40, `${text} segment at ${mx}`).toBeLessThanOrEqual(1)
      }
    }
  }
}

describe('sampleRange', () => {
  it('draws x^2 as one chain, on the curve, segments at most 8 px', () => {
    const r = run('x^2')
    expect(r.chains).toHaveLength(1)
    onCurve('x^2', r.chains)
  })
  it('steepness never breaks a curve: y = 1000x crosses the view as one chain', () => {
    const r = run('1000x')
    expect(r.chains).toHaveLength(1)
    expect(chainPoints(r.chains[0]).some((p) => Math.abs(p.y) < 1)).toBe(true)
  })
  it('does not alias sin(50x)', () => onCurve('sin(50x)', run('sin(50x)').chains))
  it('without help from the structure walk, still never bridges the pole of 1/(x - 1)', () => {
    const r = run('1/(x - 1)')
    for (const c of r.chains) {
      const xs = chainPoints(c).map((p) => p.x)
      expect(xs.some((x) => x < 1) && xs.some((x) => x > 1)).toBe(false)
    }
  })
  it('reaches the sqrt edge to machine precision', () => {
    const r = run('sqrt(x)')
    expect(Math.min(...chainPoints(r.chains[0]).map((p) => p.x))).toBeLessThan(1e-12)
    expect(r.breaks.some((b) => b.kind === 'edge' && Math.abs(b.at) < 1e-12)).toBe(true)
  })
  it('lets ln x dive off the bottom of the overscan box', () => {
    const p = run('ln(x)').chains.flatMap(chainPoints)
    expect(Math.min(...p.map((q) => q.y))).toBeCloseTo(-15, 9)
    expect(p.every((q) => q.x > 0)).toBe(true)
  })
  it('finds a narrow spike the midpoint test alone would miss', () => {
    const p = run('1/(1 + 10^6 (x - 0.1234)^2)').chains.flatMap(chainPoints)
    expect(Math.max(...p.map((q) => q.y))).toBeGreaterThan(0.99)
  })
  it('connects a continuous seam the twin cannot certify, and breaks a real jump', () => {
    expect(run('{x < 1: x, 1}').chains).toHaveLength(1)
    const j = run('{x < 1: x, 2}')
    expect(j.chains).toHaveLength(2)
    expect(j.breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - 1) < 1e-3)).toBe(true)
  })
  it('culls a curve entirely off screen cheaply', () => {
    const r = run('x + 100')
    expect(r.chains).toHaveLength(0)
    expect(r.counter.intervals).toBeLessThan(200)
  })
  it('at the budget it coarsens, says so, and still never bridges a pole', () => {
    const r = run('1/(x - 1) + sin(30x)', { ...FULL, budget: { points: 300, intervals: 150 } })
    expect(r.capped).toBe(true)
    expect(r.chains.length).toBeGreaterThan(0)
    for (const c of r.chains) {
      const xs = chainPoints(c).map((p) => p.x)
      expect(xs.some((x) => x < 1) && xs.some((x) => x > 1)).toBe(false)
    }
  })
  it('is deterministic', () => {
    expect(JSON.stringify(run('tan(x) + x^3'))).toBe(JSON.stringify(run('tan(x) + x^3')))
  })
})
```
`sink.test.ts` covers:
- a segment crossing the clip box is clipped, with an interpolated parameter;
- a segment wholly outside adds nothing;
- `lift()` splits chains;
- continuing from the pen extends the chain;
- one-vertex chains are dropped;
- every vertex stays inside `clip`.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `sink.ts` and `adaptive.ts`** to the rule. Plain recursion is fine: depth is bounded by the floor plus 64 edge-refine steps. `trueY` in the testkit is the scalar compile of the text over `x`.

- [ ] **Step 4: Green; then the full suite, typechecks, lint and sweep.**

- [ ] **Step 5: Commit.**

```bash
git add graph-engine/src/plot/sample
git commit -m "feat(plot): the adaptive core — screen-space subdivision certified by the interval twin, the jump test, edges, culling and a counted budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Assembling a curve — breaks, marks, asymptotes; explicit, polar, parametric

Put the pieces together for one statement: locate and classify its trouble spots, split the range there, sample each piece, and emit the curve, its marks, its breaks and its asymptote guides.

**Files:**
- Create: `graph-engine/src/plot/sample/curve.ts`, `graph-engine/src/plot/sample/curve.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  ```ts
  export type CurveSpec =
    | { kind: 'explicit'; independent: 'x' | 'y'; body: Expr; domain: Expr | null }   // domain: a condition Expr (where clause or converted old condition)
    | { kind: 'polar'; body: Expr; from: number; to: number }
    | { kind: 'parametric'; param: string; fx: Expr; fy: Expr; from: number; to: number }
  export interface View { bounds: Bounds; widthPx: number; heightPx: number }
  export interface CurveOptions { statement: number; color: string | null; asymptotes: boolean; quality: 'full' | 'coarse' }
  export interface SampledCurve {
    objects: SceneObject[]        // the curve first, then its marks in parameter order, then its asymptote lines
    capped: boolean
    stats: { points: number; intervals: number }
    tested: boolean               // some start sample lay inside the domain
    defined: boolean              // some vertex was drawn
  }
  export function sampleCurve(spec: CurveSpec, view: View, scope: MathScope, options: CurveOptions): SampledCurve
  ```

**The assembly**, written as the header comment of `curve.ts`:
1. **Coordinates as expressions**, compiled with both `compileScalar` and `compileInterval`. A `CompileError` propagates, and the caller reports it on the statement's line.
   - **`y = f(x)`:** parameter `x`. `x(t) = t`; `y(t) = domain ? piecewise([[domain, body]], null) : body`. The domain becomes a piecewise, so its seams are condition generators and points outside it are NaN.
   - **`x = f(y)`:** the same with the axes swapped.
   - **Polar:** parameter `theta`. `x = body·cos(theta)`, `y = body·sin(theta)`. The scope's angle unit applies inside `cos`/`sin`, as in the scalar path.
   - **Parametric:** `fx`, `fy` over `param`.
2. **The range:**
   - explicit: the view's span on the independent axis, widened by `overscan` on each side;
   - polar and parametric: `[from, to]`.

   `pxPerT`:
   - explicit: `widthPx/(xMax − xMin)`, or `heightPx/(yMax − yMin)` for `x = f(y)`;
   - polar and parametric: `startPx` px per initial step, where the initial step is `(to − from)/max(8, ceil(1.5·widthPx/startPx))`.
3. **Trouble spots:** generators come from the expression that varies: `y(t)` (explicit x), `x(t)` (explicit y), `body` (polar), `fx` and `fy` (parametric). Locate them in the range, then classify each zero with `h0` = the parameter step worth `startPx`, using a point function that writes both coordinates.
4. **Splitting:**
   - `regular` and `unknown` zeros are ignored. The core and the jump test still guard them.
   - **pole:** split; the ends on both sides are `singular`; `addBreak(tc, 'pole')`. For explicit curves with `asymptotes` on, add the guide line `x = tc` (`y = tc` for `x = f(y)`), id `asymptote.<k>`, colour `color ?? 'gray'`.
   - **jump:** split; the left piece's right end is `anchor` at `left` and the right piece's left end is `anchor` at `right`; `addBreak(tc, 'jump')`. Marks: an `endpoint` at `left` and one at `right`, each `filled` when `value` equals it on screen, else `open`. When `value` is defined and equals neither, add a `value` mark, `filled`, at `value`.
   - **hole:** split, but **keep one chain**: both pieces' facing ends are `anchor` at `limit`, so the sink continues the chain through `(tc, limit)`. Add an open `hole` mark at `limit`, plus a filled `value` mark at `value` when it is set.
   - **edge:** split; the defined side's end is `anchor` at `limit` when it converged, else `singular`; `addBreak(tc, 'edge')`. When the zero's origin is `seam` and `limit` converged, add an `endpoint` mark at `limit`, `filled` if the point's own value equals it, else `open`. A natural edge (`sqrt`, `ln`) gets no mark.
   - The undefined side of an edge is still sampled. It culls itself or draws nothing.
5. **Sampling:** each piece goes, in order, into **one** `ChainSink`. `lift()` comes between pieces at a pole, jump or edge, never at a hole.
6. **Output:**
   - the curve object, `id { statement, object: 'curve' }`, with the sink's chains and breaks (the classified breaks plus the core's own), breaks sorted by `at`;
   - marks, ids `hole.<k>` / `end.<k>` / `value.<k>` counted per role in parameter order, `exact: true`, colour `color`;
   - asymptote lines;
   - `stats` from the counter.

   `tested`: for explicit curves with a domain, some start-grid parameter satisfied the domain (compile the domain alone with `compileScalar`). Otherwise true.

- [ ] **Step 1: Write the failing tests.** These are the spec's acceptance table at sampler level. Use the view [−10, 10]² at 800 × 800 px unless a case says otherwise, and full quality.

```ts
import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import type { SceneObject } from '../../scene/types'
import { sampleCurve, type CurveSpec } from './curve'
import { expr, scopeOf } from './testkit'

const view = { bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, widthPx: 800, heightPx: 800 }
const opts = { statement: 0, color: null, asymptotes: true, quality: 'full' as const }
const explicit = (body: string, domain: string | null = null): CurveSpec => ({ kind: 'explicit', independent: 'x', body: expr(body), domain: domain ? expr(domain) : null })
const run = (spec: CurveSpec, defs = '', angle: 'radians' | 'degrees' = 'radians', v = view) => sampleCurve(spec, v, scopeOf(defs, angle), opts)
const curveOf = (objs: SceneObject[]) => objs.find((o) => o.kind === 'curve') as Extract<SceneObject, { kind: 'curve' }>
const marksOf = (objs: SceneObject[]) => objs.filter((o) => o.kind === 'mark') as Extract<SceneObject, { kind: 'mark' }>[]
const guidesOf = (objs: SceneObject[]) => objs.filter((o) => o.kind === 'line' && o.role === 'asymptote') as Extract<SceneObject, { kind: 'line' }>[]
const noChainCrosses = (objs: SceneObject[], at: number) => {
  for (const c of curveOf(objs).chains) {
    const xs = chainPoints(c).map((p) => p.x)
    expect(xs.some((x) => x < at - 1e-9) && xs.some((x) => x > at + 1e-9), `a chain crosses ${at}`).toBe(false)
  }
}

describe('sampleCurve — poles', () => {
  it('tan x: four poles, typed breaks, four guides, no connectors', () => {
    const r = run(explicit('tan(x)'))
    const poles = curveOf(r.objects).breaks.filter((b) => b.kind === 'pole').map((b) => b.at)
    // the range includes the 25 % overscan: [-15, 15] holds ±π/2, ±3π/2, ±5π/2, ±7π/2, ±9π/2
    expect(poles).toHaveLength(10)
    for (const p of poles) noChainCrosses(r.objects, p)
    expect(guidesOf(r.objects)).toHaveLength(10)
  })
  it('1/x^2 and 1/(x - 1)', () => {
    for (const [body, at] of [['1/x^2', 0], ['1/(x - 1)', 1]] as const) {
      const r = run(explicit(body))
      expect(curveOf(r.objects).breaks).toContainEqual({ at: expect.closeTo(at, 12), kind: 'pole' })
      noChainCrosses(r.objects, at)
    }
  })
  it('poles in degrees, and through a parameter', () => {
    const d = run(explicit('tan(x)'), '', 'degrees', { ...view, bounds: { xMin: -200, xMax: 200, yMin: -10, yMax: 10 } })
    expect(curveOf(d.objects).breaks.filter((b) => b.kind === 'pole').map((b) => Math.round(b.at))).toEqual(expect.arrayContaining([-270, -90, 90, 270]))
    const p = run(explicit('f(x)'), 'f(x) = 1/(x - a)\n@param a = 2')
    expect(curveOf(p.objects).breaks).toContainEqual({ at: expect.closeTo(2, 12), kind: 'pole' })
  })
})

describe('sampleCurve — holes', () => {
  it.each([['(x^2 - 1)/(x - 1)', 1, 2], ['sin(x)/x', 0, 1], ['sin(x - pi)/(x - pi)', Math.PI, 1]])('%s has an open hole and one unbroken chain', (body, at, limit) => {
    const r = run(explicit(body))
    const holes = marksOf(r.objects).filter((m) => m.role === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ fill: 'open', at: { x: expect.closeTo(at, 12), y: expect.closeTo(limit, 6) } })
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })
})

describe('sampleCurve — jumps and ends', () => {
  it('floor(x): open on the left, filled on the right, at every integer in range', () => {
    const r = run(explicit('floor(x)'))
    const at1 = marksOf(r.objects).filter((m) => Math.abs(m.at.x - 1) < 1e-9)
    expect(at1).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'endpoint', fill: 'open', at: { x: expect.closeTo(1, 12), y: expect.closeTo(0, 9) } }),
      expect.objectContaining({ role: 'endpoint', fill: 'filled', at: { x: expect.closeTo(1, 12), y: expect.closeTo(1, 9) } }),
    ]))
  })
  it.each([['{x < 0: x^2, x + 1}', 'open', 'filled'], ['{x <= 0: x^2, x + 1}', 'filled', 'open']])('%s ends as its condition says', (body, left, right) => {
    const r = run(explicit(body))
    const at0 = marksOf(r.objects).filter((m) => Math.abs(m.at.x) < 1e-9)
    expect(at0.find((m) => Math.abs(m.at.y) < 1e-9)?.fill).toBe(left)
    expect(at0.find((m) => Math.abs(m.at.y - 1) < 1e-9)?.fill).toBe(right)
  })
  it('y = 2 if 0 < x <= 3: open at 0, filled at 3', () => {
    const r = run(explicit('2', '0 < x <= 3'))
    const ends = marksOf(r.objects).map((m) => [Math.round(m.at.x), m.fill])
    expect(ends).toEqual([[0, 'open'], [3, 'filled']])
  })
  it('ln x and sqrt x reach their edges with no mark', () => {
    for (const body of ['ln(x)', 'sqrt(x)']) {
      const r = run(explicit(body))
      expect(marksOf(r.objects)).toHaveLength(0)
      expect(curveOf(r.objects).breaks.some((b) => b.kind === 'edge' && Math.abs(b.at) < 1e-12)).toBe(true)
    }
    const s = chainPoints(curveOf(run(explicit('sqrt(x)')).objects).chains[0])
    expect(s[0]).toEqual({ x: expect.closeTo(0, 12), y: expect.closeTo(0, 3) })
  })
  it('both halves of the real roots', () => {
    for (const body of ['x^(1/3)', 'x^(2/3)']) {
      const xs = curveOf(run(explicit(body)).objects).chains.flatMap(chainPoints).map((p) => p.x)
      expect(Math.min(...xs)).toBeLessThan(-9)
      expect(Math.max(...xs)).toBeGreaterThan(9)
    }
  })
})

describe('sampleCurve — steep, polar, parametric', () => {
  it('y = 1000x and y = 1e6 (x - 3) draw', () => {
    for (const body of ['1000x', '1e6 (x - 3)']) expect(curveOf(run(explicit(body)).objects).chains.length).toBeGreaterThan(0)
  })
  it('r = 1/cos(theta) is a vertical line with no chord', () => {
    const r = run({ kind: 'polar', body: expr('1/cos(theta)'), from: 0, to: 2 * Math.PI })
    const c = curveOf(r.objects)
    expect(c.breaks.filter((b) => b.kind === 'pole').map((b) => b.at)).toEqual([expect.closeTo(Math.PI / 2, 12), expect.closeTo(3 * Math.PI / 2, 12)])
    for (const p of c.chains.flatMap(chainPoints)) expect(Math.abs(p.x - 1) * 40).toBeLessThanOrEqual(0.5)
  })
  it('a parametric curve with a pole breaks there', () => {
    const r = run({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('1/t'), from: -5, to: 5 })
    expect(curveOf(r.objects).breaks).toContainEqual({ at: expect.closeTo(0, 12), kind: 'pole' })
  })
  it('ids: the curve, marks by role in order, guides', () => {
    const r = run(explicit('floor(x) + 1/(x - 0.5)'))
    expect(curveOf(r.objects).id).toEqual({ statement: 0, object: 'curve' })
    expect(marksOf(r.objects)[0].id.object).toBe('end.0')
    expect(guidesOf(r.objects)[0].id).toEqual({ statement: 0, object: 'asymptote.0' })
  })
  it('a domain that excludes the whole view is not "tested"', () => {
    expect(run(explicit('x', 'x > 100')).tested).toBe(false)
  })
  it('is deterministic', () => {
    const a = run(explicit('tan(x) + floor(x) + sin(x)/x'))
    const b = run(explicit('tan(x) + floor(x) + sin(x)/x'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
```
`JSON.stringify` of a `Float64Array` gives an object keyed by index, which is fine for equality.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `curve.ts`** to the assembly. Build a domain piecewise with `math/reserved.ts`'s `piecewise`, and polar coordinates with `math/expr.ts`'s `mul` and `call`.

- [ ] **Step 4: Green; then the full suite, typechecks, lint and sweep.**

- [ ] **Step 5: Commit.**

```bash
git add graph-engine/src/plot/sample
git commit -m "feat(plot): sampleCurve — poles, jumps, holes and edges from the structure walk; open and filled ends; asymptote guides; explicit, polar and parametric

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Oscillation faster than a pixel — bands

When subdivision reaches pixel width without flattening because the curve really oscillates, draw the curve's vertical extent across those columns as a filled band, not an aliased zig-zag.

**Files:**
- Create: `graph-engine/src/plot/sample/band.ts`, `graph-engine/src/plot/sample/band.test.ts`
- Modify: `graph-engine/src/plot/sample/adaptive.ts` (the `bandColumn` hook), `graph-engine/src/plot/sample/curve.ts` (emit band objects), `graph-engine/src/plot/sample/tuning.ts` (`BAND = { samples: 16, columnPx: 1, minTurns: 2 }`)

**Interfaces:**
- Produces (`band.ts`):
  ```ts
  export class BandSink {
    constructor(axis: 'y' | 'x', clip: Bounds)
    column(t0: number, t1: number, lo: number, hi: number): void   // one pixel column; lo/hi on the oscillation axis
    bands(): Chain[][]                                                // each band's outline: one closed chain
  }
  export function oscillates(values: Float64Array, count: number, minTurns: number): boolean  // finite values change direction at least minTurns times
  ```
- `sampleRange` gains an optional last argument, `bands?: BandSink`. `sampleCurve` passes one when `oscillationAxis` is not null, and emits one `band` object per band (`id band.<k>`, colour `color`) after the curve.

**The rule:**
- At a column, an interval whose screen width is at most `columnPx` and which failed flatness (certified or not), take `samples` evenly spaced samples of the oscillation coordinate, ends included. Count the point evaluations.
- If `oscillates`, then:
  - the column's `lo`/`hi` are the min/max of the finite samples, clamped into the twin's enclosure of that interval (never exceeding it) and into the clip box;
  - `bands.column(...)`, then `lift()` the chain and return `true` (handled).
- Otherwise return `false`, and the core carries on: a steep monotone column refines to the floor and connects.
- Adjacent columns (`t0` equal to the previous `t1`) merge into one band. The outline runs along the top edge in increasing `t`, then back along the bottom edge, as one closed chain whose `param` carries `t`.
- Polar and parametric curves have no bands (`oscillationAxis: null`); they refine under their budget.

- [ ] **Step 1: Write the failing tests** (view [−1, 1] × [−1.5, 1.5] at 800 × 1200 px, unless stated):
  - `sin(1/x)` has a band around 0, spanning y within [−1, 1] and reaching close to both, and no chain vertex inside the band's t-range.
  - `x sin(1/x)`: every band column's height is at most `2·|t| + 2 px` worth (it shrinks toward 0).
  - `sin(50x)` over [−10, 10] at 800 px has **no** band; its period is about 5 px.
  - `sin(500x)` over [−10, 10] at 800 px is one band across the view with y in [−1, 1].
  - A Weierstrass partial sum, `sum(k = 0 to 12, 0.5^k cos(3^k pi x))` over [−1, 1]: every band column lies inside `compileInterval`'s enclosure over that column.
  - `oscillates` unit cases: monotone → false; one turn → false; two turns → true; NaNs are skipped.
  - Determinism.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement** `band.ts`, the hook in `adaptive.ts`, and the emission in `curve.ts`.

- [ ] **Step 4: Green;** Task 4's and Task 5's tests must still pass unchanged. Then the full suite, typechecks, lint and sweep.

- [ ] **Step 5: Commit.**

```bash
git add graph-engine/src/plot/sample
git commit -m "feat(plot): bands — oscillation faster than a pixel is drawn as the curve's extent per column, inside the twin's enclosure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Into the engine — buildScene, the viewer, settled resampling

Switch the 2D plot path to `sampleCurve` and give it the viewport's pixel size. Resample coarsely during a gesture and fully when it settles.

**Files:**
- Modify: `graph-engine/src/scene/buildScene.ts`, `graph-engine/src/scene/buildScene.test.ts`
- Modify: `graph-engine/src/parser/types.ts`, `graph-engine/src/parser/parseStatement.ts` (the polar `fullTurn` flag, additively), plus a parser test
- Modify: `graph-engine/src/render/SceneRenderer.ts` (`getViewportPx`, `isInteracting`, a settle rebuild), `graph-engine/src/GraphViewer.tsx`
- Modify: any other test pinned to the old sampler (let the suite find them)

**Interfaces:**
- `buildScene(statements, bounds, config, resolution?, lines?, options?: { widthPx?: number; heightPx?: number; quality?: 'full' | 'coarse' })`. It is additive.
  - Defaults: `widthPx = 800`, `heightPx = round(800·(yMax − yMin)/(xMax − xMin))`, `quality = 'full'`.
  - `Scene.stats` sums every sampled curve's `stats`.
- Polar statement: `{ kind: 'polar'; body; from; to; fullTurn?: boolean }`. The parser sets `fullTurn: true` only when it supplied the default range.
- `SceneRenderer.getViewportPx(): { width: number; height: number }` gives CSS px.
  - `isInteracting()` is true while dragging, or within `WHEEL_SETTLE_MS = 150` ms of the last wheel event.
  - When a drag ends (pointerup) or the wheel settles, it calls `onViewChange` once more, so the settled view rebuilds at full quality. Regions and implicit curves also return to full resolution after a gesture: today the last rebuild of a drag stays at `DRAG_RESOLUTION`.

**Steps:**
- [ ] **Step 1: Write the failing tests.**
  - **buildScene:**
    - `y = tan(x)` returns one curve with pole breaks and guide lines;
    - `y = (x^2-1)/(x-1)` has a hole mark;
    - `y = 2 if 0 < x <= 3` has open and filled end marks;
    - `scene.stats.points > 0`;
    - quality `'coarse'` uses fewer evaluations than `'full'` on `y = sin(1/x)`.
  - **Polar degrees:** `@angle: degrees` with `r = 1 + cos(theta)` closes on itself. The curve's last vertex is the first, within ½ px, and its parameter reaches 360.
  - **The budget note:** a curve that hits its cap still draws, and the scene carries an error on its line reading `"drawn coarsely: this curve needs more detail than its drawing budget allows"`. Force it with a test-only tiny budget via `options`: add `budget?: { points: number; intervals: number }` to the options, documented as for tests.
  - **The renderer** (JSDOM-free unit): extract the settle logic into a small pure helper, `render/interaction.ts` with `createInteraction(now: () => number)`, so it is testable with a fake clock. `SceneRenderer` uses it with `performance.now`, which is allowed in `render/`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Switch `buildScene`.**
  - `sampleExplicit`, `samplePolar` and `sampleParametric` become thin calls to `sampleCurve`.
  - An explicit statement's old-shape `condition` is converted to a condition `Expr`:
    - `compare` → `__lt/__le/__gt/__ge(x, value)`;
    - `range` → `__and(low op x, x op high)`.

    A `where` is used as is.
  - Keep both messages, raised when the sampled curve says so: `"this curve is undefined everywhere in view"` when `tested && !defined`; nothing at all when `!tested`.
  - Delete `SAMPLES`, `ASYMPTOTE_JUMP_FACTOR` and the old asymptote merging.
- [ ] **Step 4: Replace the tests that pinned v1's defects.** Each replacement gets a one-line note saying why, for example `// v1 split curves by a window-relative jump rule; P2 breaks only at certified poles and jumps (spec "What is wrong today")`. Where an old test checked something still true (a two-interval domain does not bridge its gap), keep it, retargeted to the new shapes.
- [ ] **Step 5: Wire the viewer.** `GraphViewer` passes `renderer2d.getViewportPx()` and `quality: renderer2d.isInteracting() ? 'coarse' : 'full'`. `DRAG_RESOLUTION` applies while interacting. The 3D path is untouched.
- [ ] **Step 6: Run everything.** Full suite, typechecks, lint, sweep. Then start the review server from the worktree on port 5183 (`npm run review -- --port 5183 --host 100.90.203.2`, from the repo root) and report which examples to look at. The controller takes the screenshots.
- [ ] **Step 7: Commit.**

```bash
git add graph-engine/src/scene graph-engine/src/parser graph-engine/src/render graph-engine/src/GraphViewer.tsx
git commit -m "feat(scene): 2D curves through the adaptive sampler — pixel-aware, coarse while a gesture runs and full when it settles; polar's default range is a full turn in the current unit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The torture corpus, the contact sheet, examples and docs

The corpus is P2's acceptance test and every later phase adds to it. The contact sheet is how the controller sees the results headlessly.

**Files:**
- Create: `graph-engine/src/plot/testing/corpus.ts`, `graph-engine/src/plot/testing/corpus.test.ts`
- Create: `graph-engine/src/plot/testing/svgScene.ts`, `graph-engine/src/plot/testing/svgScene.test.ts`
- Create: `graph-engine/scripts/calc-contact-sheet.ts`
- Modify: `graph-engine/src/examples.ts` (and `examples.test.ts` if it pins counts), `graph-engine/GRAPH-DSL-REFERENCE.md`, `docs/HANDOFF-2026-10-01-calc-track-4.md`

**Interfaces:**
- Produces (`corpus.ts`):
  ```ts
  export interface CorpusView { bounds: Bounds; widthPx: number; heightPx: number }
  export interface CorpusCase {
    name: string
    spec: string                       // a whole graph-engine spec, as an author writes it
    views: CorpusView[]                // the first view is the main one; more make a pan sequence
    expect: {
      poles?: number[]                 // explicit x positions of pole breaks in the main view (sorted)
      holes?: Vec2[]                   // open hole marks
      ends?: { at: Vec2; fill: 'open' | 'filled' }[]
      bands?: boolean                  // at least one band (true) or none (false)
      onCurve?: boolean                // default true: every chain vertex within ½ px of the true curve
      panStable?: boolean              // pole positions and guide counts equal in every view where the poles are visible
    }
    ceiling: { points: number; intervals: number }   // pinned: about 1.5× the measured count, rounded up
  }
  export const CORPUS: readonly CorpusCase[]
  ```
- Produces (`svgScene.ts`): `sceneToSvg(scene: Scene, view: CorpusView, options?: { theme?: 'light' | 'dark' }): string`. It draws axes, chains as polylines, bands as filled paths, marks as open or filled circles, and asymptote lines dashed and clipped. Points, segments and regions use their plain shapes.

**Steps:**
- [ ] **Step 1: Write `corpus.ts`.** It holds every row of the spec's P2 acceptance table as cases, plus these:
  - the narrow spike;
  - `x = f(y)` with a pole;
  - a parametric pole;
  - `y = {x != 1: x, 5}` (structurally caught: a hole at (1, 1) and a filled value at (1, 5)). This answers spec open question 1 for P2: the residue the structure walk cannot see is rare, and the jump test still connects across a single undefined point without a mark. The case documents it.
  - `y = integral(t = 0 to x, sin(t))` (UNKNOWN everywhere: drawn through the jump test, within its ceiling).

  Write each case's spec in the DSL, using `@angle: degrees` where it applies. The pan sequence for `tan x`, `1/x^2` and `1/(x - 1)` is 5 views shifted by 0.37 of the view width each.
- [ ] **Step 2: Write `corpus.test.ts`.** For each case it runs `parseSpec` and `buildScene` with the view's pixel size and checks:
  - errors: none, unless the case says so;
  - **on the curve:** each vertex against the scalar compile of the statement, in screen px. Explicit curves use `|f(x) − y|`. Polar and parametric compare the vertex with the point at its `param`. Vertices at anchors (whose `param` is a classified trouble spot) are skipped;
  - typed breaks, holes and ends, within 1e-9 of the view span;
  - **no segment crosses a pole:** for explicit curves, no chain has vertices on both sides of a pole x;
  - the pan sequence;
  - `scene.stats` within `ceiling`;
  - **determinism:** a second build gives an identical `JSON.stringify`.

  Measure the counts, then set the ceilings at about 1.5×. Write the measured numbers in a comment beside each ceiling.
- [ ] **Step 3: Write `svgScene.ts` and a small test.** The SVG holds no `NaN` or `Infinity`, has one `<polyline>` per chain, has one `<circle>` per mark with `fill="none"` for open, and dashes asymptotes.
- [ ] **Step 4: Write `scripts/calc-contact-sheet.ts`.** Follow `scripts/contact-sheet.ts`'s shape:
  - `npx vite-node graph-engine/scripts/calc-contact-sheet.ts <out dir>` writes `calc-sheet-<n>.html` pages. Each page is a grid of corpus cases (main view, 320 × 320 px cells, captions with the case name and the stats), at most about 6000 px tall.
  - It exits 1 if any case has errors or a NaN in its SVG.
  - Its header comment gives the PowerShell headless-Edge command, as `scripts/contact-sheet.ts` does.
- [ ] **Step 5: Examples and docs.**
  - Add to the `Calculus` group in `examples.ts`: "Holes, jumps and poles" (`y = (x^2-1)/(x-1)`, `y = floor(x)`, `y = tan(x)`), "Piecewise ends" (`{x < 0: x^2, x + 1}` and `y = 2 if 0 < x <= 3`), "Faster than a pixel" (`y = sin(1/x)`) and "A polar pole" (`r = 1/cos(theta)`).
  - `GRAPH-DSL-REFERENCE.md`: one short section saying how curves draw now:
    - certified joins;
    - holes as open circles;
    - jump ends open or filled by the condition;
    - asymptote guides under `@asymptotes`;
    - bands;
    - the coarse note.
  - The handoff: one P2 paragraph.
- [ ] **Step 6: Run everything.** Full suite, typechecks, lint, sweep, and the contact sheet script (it must exit 0). Report the sheet's output directory.
- [ ] **Step 7: Commit.**

```bash
git add graph-engine/src/plot/testing graph-engine/scripts/calc-contact-sheet.ts graph-engine/src/examples.ts graph-engine/src/examples.test.ts graph-engine/GRAPH-DSL-REFERENCE.md docs/HANDOFF-2026-10-01-calc-track-4.md
git commit -m "test(plot): the torture corpus with pinned evaluation ceilings, an SVG contact sheet, P2 examples and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes (for the executor)

- **Spec coverage:**
  - adaptive subdivision → T4;
  - structural singularities → T2 + T3 + T5;
  - the jump test → T4;
  - bands → T6;
  - polar and parametric → T5 (+ T7 for the degrees default);
  - the acceptance table → T5 + T8;
  - the scene contract and the renderer adapted → T1;
  - the interaction budget → T7 (coarse during a gesture, full at settle);
  - the torture corpus, budgets counted not timed, and determinism → T8;
  - contact sheet → T8.
- **Deliberate deviations, recorded as rulings:**
  - During a gesture the viewer rebuilds **coarsely** rather than transforming the last result. Regions and implicit curves still sample the bare view with no overscan until P3, so a transform-only pan would show their edges blank. P3 revisits this.
  - The **spike test** (the twin's enclosure height against the samples' span) is an addition to the spec's flatness rule. The midpoint alone misses features narrower than the start spacing.
  - Non-certified intervals bisect until their gap is under 1 px, then take the jump test, rather than always descending to 1/16 px. Same rule, far fewer evaluations for UNKNOWN expressions such as accumulation integrals.
  - The new `MarkRole` is `'value'`: a defined point whose value differs from its limits.
  - `id` is optional on `line` until P3 migrates the remaining kinds.
- **Left for later phases:**
  - float32 precision far from the origin (P4, deep zoom);
  - horizontal asymptotes and limits at infinity (V1);
  - guides for polar and parametric poles;
  - feature points as marks (P5).
