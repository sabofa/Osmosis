import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../examples'
import { compileScalar } from '../../math/compile'
import type { MathScope } from '../../math/scope'
import { parseSpec } from '../../parser/parseSpec'
import type { Statement } from '../../parser/types'
import { buildScene } from '../../scene/buildScene'
import { chainPoints } from '../../scene/chains'
import type { Break, BreakKind, Chain, Scene, SceneObject, Vec2 } from '../../scene/types'
import { FULL } from '../sample/tuning'
import { buildPlotScope } from '../scope'
import { CORPUS, type CorpusCase, type CorpusView } from './corpus'

// The torture corpus, run (see corpus.ts). For every case: the scene it builds says what the case says and no
// more, the curve is on the curve, the breaks and marks are where the mathematics puts them, a pan sequence
// does not flicker, the work done is under its pinned ceiling, and a second build is the same bytes.
//
// A case's builds are made once and shared by its tests. Several are integrals (the twin certifies nothing, and
// a point costs a quadrature), which is most of the runtime: the file takes under half a minute.

type CurveObject = Extract<SceneObject, { kind: 'curve' }>
type MarkObject = Extract<SceneObject, { kind: 'mark' }>
type LineObject = Extract<SceneObject, { kind: 'line' }>

// Breaks and marks are positions in the world: within a billionth of the view's span in x, and a ten-millionth in y
// (a hole's height is a one-sided limit read at an offset of 6e-9, which for x sin(1/x) is -2.8e-9, and an end's or a
// pole's coordinate on the independent axis is the located zero, which is exact to the locator's 1e-12).
const TOL_X = 1e-9
const TOL_Y = 1e-7
// A vertex is on the curve to within half a pixel (the spec's bound), and a chord to within a pixel.
const VERTEX_PX = 0.5
const CHORD_PX = 1
// A chord is checked at the golden fraction of its way, which is not where the sampler looks (it tests the midpoint,
// so an alias that is resonant with its own samples would be taken for the curve there and not here). The point of
// the chord is compared with the true curve over the chord's parameters, as a polyline of CHORD_STEPS pieces: the
// distance to the curve, not to the point of it at the same parameter, which on a steep stretch (ln x at its edge,
// a cube root at 0) is far off along the chord whatever the chord is, and is a decision the sampler makes on purpose
// (steepness never breaks a curve).
const CHORD_AT = (3 - Math.sqrt(5)) / 2
const CHORD_STEPS = 8
// What counts as drawn, in pixels.
const DRAWN_PX = 1

const span = (v: CorpusView) => ({ x: v.bounds.xMax - v.bounds.xMin, y: v.bounds.yMax - v.bounds.yMin })
const pxPerUnit = (v: CorpusView) => ({ x: v.widthPx / (v.bounds.xMax - v.bounds.xMin), y: v.heightPx / (v.bounds.yMax - v.bounds.yMin) })

interface Prepared {
  parsed: ReturnType<typeof parseSpec>
  scope: MathScope
  scenes: () => Scene[]
  again: () => Scene
}

function build(c: CorpusCase, parsed: ReturnType<typeof parseSpec>, v: CorpusView): Scene {
  return buildScene(parsed.statements, v.bounds, parsed.config, undefined, parsed.statementLines, { widthPx: v.widthPx, heightPx: v.heightPx, quality: c.quality ?? 'full', budget: c.budget })
}

// Parsed once, built lazily and once per view.
function prepare(c: CorpusCase): Prepared {
  const parsed = parseSpec(c.spec)
  const scope = buildPlotScope(parsed.statements, parsed.config, parsed.statementLines).scope
  let scenes: Scene[] | undefined
  return { parsed, scope, scenes: () => (scenes ??= c.views.map((v) => build(c, parsed, v))), again: () => build(c, parsed, c.views[0]) }
}

const curvesOf = (scene: Scene): CurveObject[] => scene.objects.filter((o): o is CurveObject => o.kind === 'curve' && o.id.object === 'curve')
const marksOf = (scene: Scene, role: MarkObject['role']): MarkObject[] => scene.objects.filter((o): o is MarkObject => o.kind === 'mark' && o.role === role)
const guidesOf = (scene: Scene): LineObject[] => scene.objects.filter((o): o is LineObject => o.kind === 'line' && o.role === 'asymptote')

// ---- what the true curve is -------------------------------------------------------------------------------

// The curve a statement draws, as a point at a parameter, compiled here from the statement and not taken from the
// sampler: explicit and parametric curves by the kernel, a polar curve by its radius at the angle in the
// document's unit.
function truthOf(statement: Statement, scope: MathScope, angle: 'degrees' | 'radians'): ((t: number) => Vec2) | null {
  if (statement.kind === 'explicit') {
    const f = compileScalar(statement.body, [statement.independent], scope)
    return statement.independent === 'x' ? (t) => ({ x: t, y: f(t) }) : (t) => ({ x: f(t), y: t })
  }
  if (statement.kind === 'polar') {
    const r = compileScalar(statement.body, ['theta'], scope)
    const unit = angle === 'degrees' ? Math.PI / 180 : 1
    return (t) => {
      const radius = r(t)
      return { x: radius * Math.cos(t * unit), y: radius * Math.sin(t * unit) }
    }
  }
  if (statement.kind === 'parametric') {
    const fx = compileScalar(statement.fx, [statement.param], scope)
    const fy = compileScalar(statement.fy, [statement.param], scope)
    return (t) => ({ x: fx(t), y: fy(t) })
  }
  return null
}

// The parameters a curve is anchored at: where it has a typed break, and for an explicit curve the independent
// coordinate of each of its marks. A vertex there is a limit the structure walk read (a jump's side, a hole's
// limit, an edge's), which is not where the expression takes its value.
function anchorsOf(curve: CurveObject, scene: Scene, statement: Statement): number[] {
  const at = curve.breaks.map((b) => b.at)
  if (statement.kind === 'explicit') {
    for (const o of scene.objects) if (o.kind === 'mark' && o.id.statement === curve.id.statement) at.push(statement.independent === 'x' ? o.at.x : o.at.y)
  }
  return at
}

const isAnchor = (anchors: readonly number[], t: number) => anchors.some((a) => Math.abs(a - t) <= 1e-9 * Math.max(1, Math.abs(t)))

// How far, in pixels, the worst vertex of the chains is from the true curve (at its own parameter), and the worst
// chord. Vertices at an anchor, and the chords that end at one, are not asked; nor are vertices on the clip box,
// where the sink cut the curve: their parameter is interpolated along the segment it cut, and is not meant to be on
// the curve (ln x, dived out of the picture, has the cut at the bottom of the box, with a parameter that is nowhere).
function deviation(curve: CurveObject, scene: Scene, truth: (t: number) => Vec2, statement: Statement, v: CorpusView): { vertex: number; chord: number } {
  const px = pxPerUnit(v)
  const anchors = anchorsOf(curve, scene, statement)
  const toPx = (p: Vec2): Vec2 => ({ x: p.x * px.x, y: p.y * px.y })
  const s = span(v)
  const box = { xMin: v.bounds.xMin - FULL.overscan * s.x, xMax: v.bounds.xMax + FULL.overscan * s.x, yMin: v.bounds.yMin - FULL.overscan * s.y, yMax: v.bounds.yMax + FULL.overscan * s.y }
  const onBox = (p: Vec2) => [p.x - box.xMin, p.x - box.xMax].some((d) => Math.abs(d) <= 1e-9 * s.x) || [p.y - box.yMin, p.y - box.yMax].some((d) => Math.abs(d) <= 1e-9 * s.y)
  // a curve that is not a number where the sampler drew a vertex is as far off as can be
  const far = (d: number) => (Number.isNaN(d) ? Number.POSITIVE_INFINITY : d)
  let vertex = 0
  let chord = 0
  for (const chain of curve.chains) {
    const n = chain.param.length
    for (let i = 0; i < n; i++) {
      const t = chain.param[i]
      const here = { x: chain.xy[2 * i], y: chain.xy[2 * i + 1] }
      if (!isAnchor(anchors, t) && !onBox(here)) {
        const on = toPx(truth(t))
        vertex = Math.max(vertex, far(Math.hypot(here.x * px.x - on.x, here.y * px.y - on.y)))
      }
      if (i + 1 >= n) continue
      const tb = chain.param[i + 1]
      const next = { x: chain.xy[2 * i + 2], y: chain.xy[2 * i + 3] }
      if (isAnchor(anchors, t) || isAnchor(anchors, tb) || onBox(here) || onBox(next)) continue
      const along = toPx({ x: here.x + CHORD_AT * (next.x - here.x), y: here.y + CHORD_AT * (next.y - here.y) })
      let nearest = Number.POSITIVE_INFINITY
      let prev = toPx(truth(t))
      for (let k = 1; k <= CHORD_STEPS; k++) {
        const cur = toPx(truth(t + ((tb - t) * k) / CHORD_STEPS))
        const d = segmentDistance(along, prev, cur)
        // (the true curve is undefined, or not finite, inside this chord)
        if (Number.isNaN(d)) {
          nearest = Number.POSITIVE_INFINITY
          break
        }
        nearest = Math.min(nearest, d)
        prev = cur
      }
      chord = Math.max(chord, nearest)
    }
  }
  return { vertex, chord }
}

// ---- what is drawn ----------------------------------------------------------------------------------------

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy))
}

// The distance in pixels from a world point to what the scene draws of its curves: the polylines of the chains, and
// the outline of each band (0 inside it).
function distanceToDrawn(scene: Scene, v: CorpusView, world: Vec2): number {
  const px = pxPerUnit(v)
  const p = { x: world.x * px.x, y: world.y * px.y }
  const screen = (chain: Chain): Vec2[] => chainPoints(chain).map((q) => ({ x: q.x * px.x, y: q.y * px.y }))
  let best = Number.POSITIVE_INFINITY
  for (const o of scene.objects) {
    if (o.kind === 'curve') {
      for (const chain of o.chains) {
        const pts = screen(chain)
        if (pts.length === 1) best = Math.min(best, Math.hypot(p.x - pts[0].x, p.y - pts[0].y))
        for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segmentDistance(p, pts[i], pts[i + 1]))
      }
    } else if (o.kind === 'band') {
      for (const chain of o.outline) {
        const pts = screen(chain)
        let inside = false
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside
          best = Math.min(best, segmentDistance(p, pts[j], pts[i]))
        }
        if (inside) best = 0
      }
    }
  }
  return best
}

const drewSomething = (scene: Scene) => scene.objects.some((o) => (o.kind === 'curve' && o.chains.length > 0) || o.kind === 'band')

// ---- typed breaks and marks -------------------------------------------------------------------------------

// The parameter range an explicit curve's breaks are asked over: the view's, on its independent axis.
function inView(statement: Statement, v: CorpusView, at: number): boolean {
  if (statement.kind !== 'explicit') return true
  const [lo, hi] = statement.independent === 'x' ? [v.bounds.xMin, v.bounds.xMax] : [v.bounds.yMin, v.bounds.yMax]
  const tol = TOL_X * (hi - lo)
  return at >= lo - tol && at <= hi + tol
}

function breaksOf(scene: Scene, parsed: ReturnType<typeof parseSpec>, v: CorpusView, kind: BreakKind): number[] {
  const out: number[] = []
  for (const curve of curvesOf(scene)) {
    const statement = parsed.statements[curve.id.statement]
    for (const b of curve.breaks) if (b.kind === kind && inView(statement, v, b.at)) out.push(b.at)
  }
  return out.sort((a, b) => a - b)
}

function markIn(v: CorpusView, m: MarkObject): boolean {
  const s = span(v)
  const { xMin, xMax, yMin, yMax } = v.bounds
  return m.at.x >= xMin - TOL_X * s.x && m.at.x <= xMax + TOL_X * s.x && m.at.y >= yMin - TOL_Y * s.y && m.at.y <= yMax + TOL_Y * s.y
}

const byPosition = (tol: Vec2) => (a: Vec2, b: Vec2) => (Math.abs(a.x - b.x) > tol.x ? a.x - b.x : a.y - b.y)

function expectPositions(label: string, got: readonly number[], want: readonly number[], v: CorpusView, tolerance?: number) {
  const tol = tolerance ?? TOL_X * Math.max(span(v).x, span(v).y)
  expect(got, `${label}: ${got.join(', ')}`).toHaveLength(want.length)
  want.forEach((w, i) => expect(Math.abs(got[i] - w), `${label} ${i}: ${got[i]} for ${w}`).toBeLessThanOrEqual(tol))
}

function expectPoints(label: string, got: readonly Vec2[], want: readonly Vec2[], v: CorpusView) {
  const s = span(v)
  const tol = { x: TOL_X * s.x, y: TOL_Y * s.y }
  const g = [...got].sort(byPosition(tol))
  const w = [...want].sort(byPosition(tol))
  expect(g, `${label}: ${g.map((p) => `(${p.x}, ${p.y})`).join(' ')}`).toHaveLength(w.length)
  w.forEach((p, i) => {
    expect(Math.abs(g[i].x - p.x), `${label} ${i} x: ${g[i].x} for ${p.x}`).toBeLessThanOrEqual(tol.x)
    expect(Math.abs(g[i].y - p.y), `${label} ${i} y: ${g[i].y} for ${p.y}`).toBeLessThanOrEqual(tol.y)
  })
}

// No chain has vertices on both sides of a pole: the pole's parameter is not inside the range of a chain's.
function expectNoChordAcrossPoles(scene: Scene, label: string) {
  for (const curve of curvesOf(scene)) {
    const poles = curve.breaks.filter((b: Break) => b.kind === 'pole').map((b) => b.at)
    for (const chain of curve.chains) {
      const lo = Math.min(...chain.param)
      const hi = Math.max(...chain.param)
      for (const p of poles) expect(lo < p - 1e-9 && hi > p + 1e-9, `${label}: a chain from ${lo} to ${hi} crosses the pole at ${p}`).toBe(false)
    }
  }
}

// ---- the pan sequence ---------------------------------------------------------------------------------------

// The positions of the poles of a scene's curves, and of its guides (the dashed lines through the poles of an
// explicit y = f(x)), sorted. The pan sequences are along x, over y = f(x) curves.
function polesOf(scene: Scene): number[] {
  return curvesOf(scene).flatMap((c) => c.breaks.filter((b) => b.kind === 'pole').map((b) => b.at)).sort((a, b) => a - b)
}
const guideXs = (scene: Scene): number[] => guidesOf(scene).map((g) => g.through.x).sort((a, b) => a - b)

// Each pole of an explicit curve has a guide (guides default on): a line through it, across the view, along the axis
// the curve is drawn against, and nothing else has one. (Polar and parametric poles have none yet.)
function expectGuides(scene: Scene, parsed: ReturnType<typeof parseSpec>, label: string) {
  parsed.statements.forEach((statement, index) => {
    if (statement.kind !== 'explicit') return
    const curve = curvesOf(scene).find((c) => c.id.statement === index)!
    const poles = curve.breaks.filter((b) => b.kind === 'pole').map((b) => b.at).sort((a, b) => a - b)
    const mine = guidesOf(scene).filter((g) => g.id?.statement === index)
    const vertical = statement.independent === 'x'
    for (const g of mine) expect(vertical ? g.direction.x === 0 : g.direction.y === 0, `${label}: a guide runs the wrong way`).toBe(true)
    const guides = mine.map((g) => (vertical ? g.through.x : g.through.y)).sort((a, b) => a - b)
    expect(guides, `${label}: a guide for each pole`).toHaveLength(poles.length)
    poles.forEach((p, k) => expect(Math.abs(guides[k] - p), `${label}: guide ${k}`).toBeLessThanOrEqual(1e-9))
  })
}

// Over a pan sequence the poles and the guides over the part of the x axis two views both show are the same.
function expectStableAcrossPans(scenes: readonly Scene[], views: readonly CorpusView[]) {
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const lo = Math.max(views[i].bounds.xMin, views[j].bounds.xMin)
      const hi = Math.min(views[i].bounds.xMax, views[j].bounds.xMax)
      if (!(hi > lo)) continue
      const within = (xs: number[]) => xs.filter((x) => x >= lo && x <= hi)
      for (const [what, left, right] of [
        ['poles', within(polesOf(scenes[i])), within(polesOf(scenes[j]))],
        ['guides', within(guideXs(scenes[i])), within(guideXs(scenes[j]))],
      ] as const) {
        expect(right, `views ${i} and ${j}: the ${what} over [${lo}, ${hi}]`).toHaveLength(left.length)
        left.forEach((x, k) => expect(Math.abs(x - right[k]), `views ${i} and ${j}: ${what} ${k}`).toBeLessThanOrEqual(1e-9 * (hi - lo)))
      }
    }
  }
}

// ---- the tests ----------------------------------------------------------------------------------------------

const json = (scene: Scene) => JSON.stringify(scene, (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value))

// the budgets of the heaviest cases (an integral costs a quadrature a point) are generous, so a loaded machine does not fail them
const TIMEOUT = 60_000

describe('the torture corpus', () => {
  it('has a unique name for every case, a main view, and a ceiling', () => {
    expect(new Set(CORPUS.map((c) => c.name)).size).toBe(CORPUS.length)
    for (const c of CORPUS) {
      expect(c.views.length, c.name).toBeGreaterThan(0)
      expect(c.ceiling.points, c.name).toBeGreaterThan(0)
      expect(c.ceiling.intervals, c.name).toBeGreaterThan(0)
    }
  })

  it("holds the example 'Accumulation: the sine integral' as written", () => {
    expect(CORPUS.find((c) => c.name === 'the sine integral')!.spec).toBe(EXAMPLES.find((e) => e.label === 'Accumulation: the sine integral')!.spec)
  })

  for (const c of CORPUS) {
    describe(c.name, () => {
      const run = prepare(c)
      const want = c.expect

      it('parses with no errors', () => {
        expect(run.parsed.errors).toEqual([])
      })

      it('says what the case expects and no more', () => {
        const notes = run.scenes()[0].errors.map((e) => e.message)
        const expected = want.notes ?? []
        expect(notes, notes.join(' | ')).toHaveLength(expected.length)
        expected.forEach((prefix, i) => expect(notes[i].startsWith(prefix), `${notes[i]} should start with ${prefix}`).toBe(true))
      }, TIMEOUT)

      it('stays within its evaluation ceiling in every view', () => {
        run.scenes().forEach((scene, i) => {
          expect(scene.stats!.points, `view ${i} points`).toBeLessThanOrEqual(c.ceiling.points)
          expect(scene.stats!.intervals, `view ${i} intervals`).toBeLessThanOrEqual(c.ceiling.intervals)
        })
      }, TIMEOUT)

      it('holds only finite numbers', () => {
        run.scenes().forEach((scene, i) => {
          for (const o of scene.objects) {
            if (o.kind === 'curve') for (const chain of o.chains) expect(chain.xy.every(Number.isFinite) && chain.param.every(Number.isFinite), `view ${i}`).toBe(true)
            if (o.kind === 'band') for (const chain of o.outline) expect(chain.xy.every(Number.isFinite), `view ${i}`).toBe(true)
            if (o.kind === 'mark') expect(Number.isFinite(o.at.x) && Number.isFinite(o.at.y), `view ${i}`).toBe(true)
          }
        })
      }, TIMEOUT)

      if (want.onCurve !== false) {
        it('is on the curve: vertices within half a pixel, chords within a pixel', () => {
          run.scenes().forEach((scene, i) => {
            for (const curve of curvesOf(scene)) {
              const statement = run.parsed.statements[curve.id.statement]
              const truth = truthOf(statement, run.scope, run.parsed.config.angle)
              if (truth === null) continue
              const d = deviation(curve, scene, truth, statement, c.views[i])
              expect(d.vertex, `view ${i}: the worst vertex is ${d.vertex} px off`).toBeLessThanOrEqual(VERTEX_PX)
              expect(d.chord, `view ${i}: the worst chord is ${d.chord} px off`).toBeLessThanOrEqual(CHORD_PX)
            }
          })
        }, TIMEOUT)
      }

      it('types its breaks and marks where the mathematics puts them', () => {
        const scene = run.scenes()[0]
        const v = c.views[0]
        if (want.poles) expectPositions('poles', breaksOf(scene, run.parsed, v, 'pole'), want.poles, v)
        if (want.jumps) expectPositions('jumps', breaksOf(scene, run.parsed, v, 'jump'), want.jumps, v)
        // (the jump test records the middle of the floor interval it lifted at: 1/16 px of the independent axis, here x)
        if (want.jumpsFound) expectPositions('jumps found by the jump test', breaksOf(scene, run.parsed, v, 'jump'), want.jumpsFound, v, FULL.floorPx / pxPerUnit(v).x)
        if (want.edges) expectPositions('edges', breaksOf(scene, run.parsed, v, 'edge'), want.edges, v)
        if (want.holes) expectPoints('holes', marksOf(scene, 'hole').filter((m) => markIn(v, m)).map((m) => m.at), want.holes, v)
        if (want.values) expectPoints('values', marksOf(scene, 'value').filter((m) => markIn(v, m)).map((m) => m.at), want.values, v)
        if (want.holes || want.values) for (const m of [...marksOf(scene, 'hole'), ...marksOf(scene, 'value')]) expect(m.fill).toBe(m.role === 'hole' ? 'open' : 'filled')
        if (want.ends) {
          const ends = marksOf(scene, 'endpoint').filter((m) => markIn(v, m))
          expectPoints('ends', ends.map((m) => m.at), want.ends.map((e) => e.at), v)
          // each wanted end has the fill the condition gives it
          const s = span(v)
          for (const e of want.ends) {
            const found = ends.find((m) => Math.abs(m.at.x - e.at.x) <= TOL_X * s.x && Math.abs(m.at.y - e.at.y) <= TOL_Y * s.y)
            expect(found?.fill, `the end at (${e.at.x}, ${e.at.y})`).toBe(e.fill)
          }
        }
        if (want.bands !== undefined) expect(scene.objects.some((o) => o.kind === 'band'), 'a band').toBe(want.bands)
        if (want.blank !== undefined) expect(drewSomething(scene), 'something is drawn').toBe(!want.blank)
      }, TIMEOUT)

      if (want.drawn || want.undrawn) {
        it('draws what it should, and not what a known limit loses', () => {
          const scene = run.scenes()[0]
          for (const p of want.drawn ?? []) expect(distanceToDrawn(scene, c.views[0], p), `(${p.x}, ${p.y}) is drawn`).toBeLessThanOrEqual(DRAWN_PX)
          for (const p of want.undrawn ?? []) expect(distanceToDrawn(scene, c.views[0], p), `(${p.x}, ${p.y}) is not drawn`).toBeGreaterThan(DRAWN_PX)
        }, TIMEOUT)
      }

      it('has no chain that crosses a pole, and a guide through each pole of an explicit curve', () => {
        run.scenes().forEach((scene, i) => {
          expectNoChordAcrossPoles(scene, `view ${i}`)
          expectGuides(scene, run.parsed, `view ${i}`)
        })
      }, TIMEOUT)

      if (c.views.length > 1 && want.panStable) {
        it('does not flicker over its pan sequence: the poles and guides in common are the same', () => {
          expectStableAcrossPans(run.scenes(), c.views)
        }, TIMEOUT)
      }

      it('is deterministic: a second build is the same scene', () => {
        expect(json(run.again())).toBe(json(run.scenes()[0]))
      }, TIMEOUT)
    })
  }
})
