// Assembling one curve (calc P2; spec "The curve sampler", "Singularities from the
// expression's structure", "The scene contract"): the stages of the sampler put together
// for one statement. It decides nothing about drawing a smooth stretch (adaptive.ts does)
// or what a trouble spot is (limits.ts does); it finds the spots, splits the range at
// them, tells each piece what it meets at its ends, and writes down what the pieces
// cannot: the marks, the typed breaks and the asymptote guides.
//
// 1. COORDINATES AS EXPRESSIONS, each compiled twice (compileScalar for points,
//    compileInterval for the twin's enclosures). A CompileError propagates: the caller
//    reports it on the statement's line.
//    - y = f(x): the parameter is x, x(t) = t and y(t) = f, or piecewise([[domain, f]],
//      null) when there is a domain. The domain becomes a piecewise so that its seams are
//      condition generators and the points outside it are NaN.
//    - x = f(y): the same with the axes swapped.
//    - polar: the parameter is theta, x = body cos(theta), y = body sin(theta). The scope's
//      angle unit applies inside cos and sin, as it does in the scalar path.
//    - parametric: fx and fy over the parameter.
// 2. THE RANGE. Explicit: the view's span on the independent axis, widened by the overscan
//    on each side. Polar and parametric: [from, to]. pxPerT is the view's px per unit for an
//    explicit curve; for the others it is startPx per initial step, the initial step being
//    (to - from) / max(8, ceil(1.5 widthPx / startPx)).
// 3. TROUBLE SPOTS. The generators come from the expression that varies (y(t), x(t), the
//    polar body, fx and fy), locate.ts finds their zeros in the range, and limits.ts
//    classifies each one with h0 the parameter step worth startPx.
// 4. SPLITTING. The range is cut at every spot that is something, and each piece is told
//    what is at its ends. A `regular` or `unknown` spot is not a cut: the core's twin
//    certification and the jump test still guard it.
//    - pole: both ends are singular (the core never evaluates at them), a pole break, and
//      for an explicit curve a guide line.
//    - jump: the left piece ends anchored at the left limit and the right begins anchored
//      at the right limit; a jump break; an endpoint mark at each limit.
//    - hole: both facing ends are anchored at the same limit and the chain is NOT lifted, so
//      the sink carries it through (tc, limit). The pieces meet at exactly tc, which the core
//      never sees as interior: left whole, a removable hole is split by the core with a 1/16 px
//      gap and a jump break (next to it the twin's enclosure is unbounded, so the last floor
//      interval is uncertified). The core draws the stretch that ends at an anchor, which is
//      what lets the chain run through.
//    - edge: the defined side's end is anchored at the limit when it converged (sqrt, an
//      arc's tip: the core alone stops a floor short of it), else singular (a limit that
//      diverges, or one that did not converge, is never reached for); the undefined side's
//      end is singular, so it culls itself or draws nothing. An edge break; and an endpoint
//      mark only when the edge is a SEAM, the author's own condition (a natural sqrt or ln
//      edge is not marked).
// 5. SAMPLING. The pieces go, in order, into ONE ChainSink, which continues a chain only where
//    one piece ends at exactly the parameter and point the next begins at. It is lifted
//    between pieces at a pole, jump or edge, never at a hole.
// 6. OUTPUT. The curve (the sink's chains, its breaks: the classified ones and the core's own,
//    sorted by parameter), its marks in parameter order, then its asymptote guides. Marks
//    are exact: they are read from limits, not from samples. A jump's side and an edge's
//    limit are read once more close in to the spot (CURVE.settleTols), because limits.ts
//    stops at 6e-9, and for an explicit curve the independent coordinate of a limit is the
//    located parameter itself, not the sample the limit was read at.
import { compileScalar } from '../../math/compile'
import { call, mul, variable } from '../../math/expr'
import { compileInterval, CONTINUOUS, iv, type Verdict } from '../../math/interval'
import { piecewise } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Bounds, Break, Chain, SceneObject, Vec2 } from '../../scene/types'
import { sampleRange } from './adaptive'
import { classify, type Classification } from './limits'
import { locateZeros } from './locate'
import { ChainSink } from './sink'
import { type Generator, type Origin, troubleGenerators } from './structure'
import { COARSE, CORE, CURVE, FULL, LIMITS, LOCATE, type Tuning } from './tuning'
import type { Box, CurveFns, End, EvalCounter, PointFn, PxScale, Screen } from './types'

export type CurveSpec =
  | { kind: 'explicit'; independent: 'x' | 'y'; body: Expr; domain: Expr | null } // domain: a condition Expr (where clause or converted old condition)
  | { kind: 'polar'; body: Expr; from: number; to: number }
  | { kind: 'parametric'; param: string; fx: Expr; fy: Expr; from: number; to: number }

export interface View {
  bounds: Bounds
  widthPx: number
  heightPx: number
}

export interface CurveOptions {
  statement: number
  color: string | null
  asymptotes: boolean
  quality: 'full' | 'coarse'
  // overrides the tuning's, for tests
  budget?: { points: number; intervals: number }
}

export interface SampledCurve {
  // the curve first, then its marks in parameter order, then its asymptote lines
  objects: SceneObject[]
  capped: boolean
  stats: { points: number; intervals: number }
  // some start sample lay inside the domain
  tested: boolean
  // some vertex was drawn
  defined: boolean
}

type MarkObject = Extract<SceneObject, { kind: 'mark' }>

// A mark before it has an identity: ids count per role in parameter order, and that order
// is only known as the spots are walked.
interface PendingMark {
  at: Vec2
  role: MarkObject['role']
  fill: MarkObject['fill']
}

const FREE: End = { kind: 'free' }
const SINGULAR: End = { kind: 'singular' }
const ID_PREFIX: Record<MarkObject['role'], string> = { hole: 'hole', endpoint: 'end', value: 'value' }

// What a spec comes to once its coordinates are expressions: the parameter, the two
// coordinate expressions (null for the independent coordinate of an explicit curve, which
// is the parameter itself), the expressions whose zeros are trouble spots, and the range.
interface Coordinates {
  param: string
  x: Expr | null
  y: Expr | null
  varying: Expr[]
  from: number
  to: number
  pxPerT: number
  oscillationAxis: 'x' | 'y' | null
}

// What the walk over the spots shares: what it reads the curve with, and what it writes down.
interface Walk {
  fns: CurveFns
  px: PxScale
  counter: EvalCounter
  sink: ChainSink
  // an explicit curve's independent axis: the coordinate of a limit that is the parameter
  independent: 'x' | 'y' | null
  marks: PendingMark[]
  poles: number[]
  pt: Float64Array
}

// What the pieces on either side of a spot meet there: the piece before it ends in `before`,
// the one after begins in `after`, and the pen lifts between them unless the spot is a hole.
interface Meeting {
  before: End
  after: End
  lift: boolean
}

export function sampleCurve(spec: CurveSpec, view: View, scope: MathScope, options: CurveOptions): SampledCurve {
  const base = options.quality === 'coarse' ? COARSE : FULL
  const tuning: Tuning = options.budget ? { ...base, budget: options.budget } : base
  const { bounds } = view
  const spanX = bounds.xMax - bounds.xMin
  const spanY = bounds.yMax - bounds.yMin
  const px = { x: view.widthPx / spanX, y: view.heightPx / spanY }
  const clip: Bounds = {
    xMin: bounds.xMin - tuning.overscan * spanX,
    xMax: bounds.xMax + tuning.overscan * spanX,
    yMin: bounds.yMin - tuning.overscan * spanY,
    yMax: bounds.yMax + tuning.overscan * spanY,
  }
  const screen: Screen = { px, clip }
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const co = coordinatesOf(spec, view, px, tuning)
  const fns = compileCurve(co, scope)

  // A range or a scale that is not a number draws nothing (a view of no extent, say).
  if (!(co.to > co.from) || !Number.isFinite(co.from) || !Number.isFinite(co.to) || !(co.pxPerT > 0) || !Number.isFinite(co.pxPerT) || !(px.x > 0) || !(px.y > 0)) {
    return { objects: [curveObject(options, [], [])], capped: false, stats: { points: 0, intervals: 0 }, tested: true, defined: false }
  }

  const located = locateZeros(generatorsOf(co, scope), co.param, scope, co.from, co.to, counter)
  const h0 = tuning.startPx / co.pxPerT
  const sink = new ChainSink(clip)
  const walk: Walk = { fns, px, counter, sink, independent: spec.kind === 'explicit' ? spec.independent : null, marks: [], poles: [], pt: new Float64Array(2) }
  let capped = false
  const piece = (ta: number, tb: number, left: End, right: End) => {
    if (!(tb > ta)) return
    if (sampleRange(fns, ta, tb, { left, right }, screen, tuning, counter, sink).capped) capped = true
  }

  let from = co.from
  let leftEnd: End = FREE
  for (const zero of located.zeros) {
    const meeting = meet(walk, classify(fns.point, zero.t, h0, px, counter), zero.t, zero.origin)
    if (meeting === null) continue
    piece(from, zero.t, leftEnd, meeting.before)
    if (meeting.lift) sink.lift()
    from = zero.t
    leftEnd = meeting.after
  }
  piece(from, co.to, leftEnd, FREE)

  const chains = sink.chains()
  const breaks: Break[] = sink.breaks().sort((a, b) => a.at - b.at)
  const objects: SceneObject[] = [curveObject(options, chains, breaks), ...marksOf(walk.marks, options), ...(spec.kind === 'explicit' && options.asymptotes ? guidesOf(walk.poles, spec.independent, options) : [])]
  const tested = spec.kind === 'explicit' && spec.domain !== null ? domainTested(spec.domain, co, scope, tuning, counter) : true
  return { objects, capped, stats: { points: counter.points, intervals: counter.intervals }, tested, defined: chains.length > 0 }
}

// What one classified spot is to the pieces beside it (step 4 of the header), and the typed
// breaks and marks it leaves. Null for a spot that is not a cut.
function meet(w: Walk, c: Classification, tc: number, origin: Origin): Meeting | null {
  switch (c.kind) {
    case 'regular':
    case 'unknown':
      return null
    case 'pole':
      w.sink.addBreak(tc, 'pole')
      w.poles.push(tc)
      return { before: SINGULAR, after: SINGULAR, lift: true }
    case 'jump': {
      const left = onAxis(w, settle(w, c.left, tc, -1), tc)
      const right = onAxis(w, settle(w, c.right, tc, 1), tc)
      w.sink.addBreak(tc, 'jump')
      w.marks.push({ at: left, role: 'endpoint', fill: fillOf(w, left, c.value) }, { at: right, role: 'endpoint', fill: fillOf(w, right, c.value) })
      // a value that is neither limit is a point of its own
      if (c.value !== null && !same(w, left, c.value) && !same(w, right, c.value)) w.marks.push({ at: c.value, role: 'value', fill: 'filled' })
      return { before: { kind: 'anchor', at: left }, after: { kind: 'anchor', at: right }, lift: true }
    }
    case 'hole': {
      const limit = onAxis(w, c.limit, tc)
      w.marks.push({ at: limit, role: 'hole', fill: 'open' })
      if (c.value !== null) w.marks.push({ at: c.value, role: 'value', fill: 'filled' })
      const through: End = { kind: 'anchor', at: limit }
      return { before: through, after: through, lift: false }
    }
    case 'edge': {
      // a limit that diverges is never reached for: that end is singular, with nothing marked
      const limit = c.limit === null ? null : onAxis(w, settle(w, c.limit, tc, c.defined === 'left' ? -1 : 1), tc)
      const reach: End = limit === null ? SINGULAR : { kind: 'anchor', at: limit }
      w.sink.addBreak(tc, 'edge')
      // only an edge the author wrote is marked, and only with a limit to mark
      if (limit !== null && origin === 'seam') w.marks.push({ at: limit, role: 'endpoint', fill: fillOf(w, limit, valueAt(w, tc)) })
      return { before: c.defined === 'left' ? reach : SINGULAR, after: c.defined === 'right' ? reach : SINGULAR, lift: true }
    }
  }
}

// An explicit curve's limit with its independent coordinate the parameter itself, whatever
// sample the limit was read at; the limit of any other curve is where it was read.
function onAxis(w: Walk, p: Vec2, tc: number): Vec2 {
  return w.independent === 'x' ? { x: tc, y: p.y } : w.independent === 'y' ? { x: p.x, y: tc } : p
}

function distancePx(w: Walk, a: Vec2, b: Vec2): number {
  return Math.hypot((a.x - b.x) * w.px.x, (a.y - b.y) * w.px.y)
}

// Equal on screen, as limits.ts means it.
function same(w: Walk, a: Vec2, b: Vec2): boolean {
  return distancePx(w, a, b) <= LIMITS.convergePx
}

// A limit is filled when the curve's own value at the spot is that point, open when it is not.
function fillOf(w: Walk, limit: Vec2, value: Vec2 | null): MarkObject['fill'] {
  return value !== null && same(w, limit, value) ? 'filled' : 'open'
}

// A one-sided limit read again close in to the spot (CURVE.settleTols), if the new reading
// agrees with the old one.
function settle(w: Walk, limit: Vec2, tc: number, side: -1 | 1): Vec2 {
  w.fns.point(tc + side * CURVE.settleTols * LOCATE.tolRel * Math.max(1, Math.abs(tc)), w.pt)
  w.counter.points++
  const p = { x: w.pt[0], y: w.pt[1] }
  // (a limit read from a retried tail carries noise of up to retriedEqualFactor times convergePx)
  const agrees = Number.isFinite(p.x) && Number.isFinite(p.y) && distancePx(w, p, limit) <= LIMITS.retriedEqualFactor * LIMITS.convergePx
  return agrees ? p : limit
}

// The curve's own value at the spot, or null where it is not defined there.
function valueAt(w: Walk, tc: number): Vec2 | null {
  w.fns.point(tc, w.pt)
  w.counter.points++
  return Number.isFinite(w.pt[0]) && Number.isFinite(w.pt[1]) ? { x: w.pt[0], y: w.pt[1] } : null
}

function curveObject(options: CurveOptions, chains: Chain[], breaks: Break[]): SceneObject {
  return { kind: 'curve', id: { statement: options.statement, object: 'curve' }, chains, breaks, color: options.color }
}

// The marks, with their ids counted per role in parameter order.
function marksOf(marks: readonly PendingMark[], options: CurveOptions): SceneObject[] {
  const counts: Record<string, number> = {}
  return marks.map((m) => {
    const prefix = ID_PREFIX[m.role]
    const k = counts[prefix] ?? 0
    counts[prefix] = k + 1
    return { kind: 'mark', id: { statement: options.statement, object: `${prefix}.${k}` }, at: m.at, role: m.role, fill: m.fill, exact: true, color: options.color }
  })
}

// A guide through each pole: x = tc for y = f(x), y = tc for x = f(y).
function guidesOf(poles: readonly number[], independent: 'x' | 'y', options: CurveOptions): SceneObject[] {
  const vertical = independent === 'x'
  return poles.map((tc, k) => ({
    kind: 'line',
    id: { statement: options.statement, object: `asymptote.${k}` },
    through: vertical ? { x: tc, y: 0 } : { x: 0, y: tc },
    direction: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    extent: 'infinite',
    role: 'asymptote',
    color: options.color ?? 'gray',
  }))
}

// The coordinates, range and scale of a spec (steps 1 and 2 of the header).
function coordinatesOf(spec: CurveSpec, view: View, px: PxScale, tuning: Tuning): Coordinates {
  const { bounds } = view
  if (spec.kind === 'explicit') {
    const f = spec.domain ? piecewise([[spec.domain, spec.body]], null) : spec.body
    const alongX = spec.independent === 'x'
    const lo = alongX ? bounds.xMin : bounds.yMin
    const hi = alongX ? bounds.xMax : bounds.yMax
    const pad = tuning.overscan * (hi - lo)
    return {
      param: spec.independent,
      x: alongX ? null : f,
      y: alongX ? f : null,
      varying: [f],
      from: lo - pad,
      to: hi + pad,
      pxPerT: alongX ? px.x : px.y,
      oscillationAxis: alongX ? 'y' : 'x',
    }
  }
  // polar and parametric have no axis to be single-valued along: the parameter's range is the
  // author's, and a step worth startPx on screen is what the start grid divides it into
  const { from, to } = spec
  const steps = Math.max(CORE.minStartIntervals, Math.ceil((CURVE.pathPerWidth * view.widthPx) / tuning.startPx))
  const pxPerT = (tuning.startPx * steps) / (to - from)
  if (spec.kind === 'polar') {
    const theta = variable('theta')
    return {
      param: 'theta',
      x: mul(spec.body, call('cos', theta)),
      y: mul(spec.body, call('sin', theta)),
      varying: [spec.body],
      from,
      to,
      pxPerT,
      oscillationAxis: null,
    }
  }
  return { param: spec.param, x: spec.fx, y: spec.fy, varying: [spec.fx, spec.fy], from, to, pxPerT, oscillationAxis: null }
}

// The point function and the twin of both coordinates. Compiled here, before anything walks
// the expressions, so that a refusal is the compile's own.
function compileCurve(co: Coordinates, scope: MathScope): CurveFns {
  const vars = [co.param]
  const fx = co.x ? compileScalar(co.x, vars, scope) : null
  const fy = co.y ? compileScalar(co.y, vars, scope) : null
  const tx = co.x ? compileInterval(co.x, vars, scope) : null
  const ty = co.y ? compileInterval(co.y, vars, scope) : null
  const point: PointFn = (t, out) => {
    out[0] = fx ? fx(t) : t
    out[1] = fy ? fy(t) : t
  }
  // One scratch for both coordinates: an enclosure is copied out at once, and twin
  // evaluations must not overlap (the loop budget is module-level).
  const scratch = iv()
  return {
    point,
    enclose(tLo: number, tHi: number, out: Box): Verdict {
      let verdict: Verdict = CONTINUOUS
      if (tx) {
        tx(scratch, tLo, tHi)
        out.xLo = scratch.lo
        out.xHi = scratch.hi
        verdict = scratch.v
      } else {
        out.xLo = tLo
        out.xHi = tHi
      }
      if (ty) {
        ty(scratch, tLo, tHi)
        out.yLo = scratch.lo
        out.yHi = scratch.hi
        if (scratch.v < verdict) verdict = scratch.v
      } else {
        out.yLo = tLo
        out.yHi = tHi
      }
      return verdict
    },
    pxPerT: co.pxPerT,
    oscillationAxis: co.oscillationAxis,
  }
}

// The generators of every varying expression, one of each: fx and fy often share a
// denominator, and a repeated generator is only repeated work. A seam wins over a natural
// spot of the same expression, as the walk itself has it.
function generatorsOf(co: Coordinates, scope: MathScope): Generator[] {
  const found = new Map<string, Generator>()
  for (const e of co.varying) {
    for (const g of troubleGenerators(e, co.param, scope)) {
      const key = JSON.stringify(g.expr)
      const known = found.get(key)
      if (!known || (known.origin !== 'seam' && g.origin === 'seam')) found.set(key, g)
    }
  }
  return [...found.values()]
}

// Whether some parameter of the start grid satisfies the domain, so the curve was tested
// against something. A condition holds where it is neither 0 nor NaN. (The grid is the
// whole range's, as the core would lay it: the pieces the structure walk cuts have grids
// of their own, and a domain narrower than the whole grid's spacing is "tested" by nothing.)
function domainTested(domain: Expr, co: Coordinates, scope: MathScope, tuning: Tuning, counter: EvalCounter): boolean {
  const holds = compileScalar(domain, [co.param], scope)
  let n = Math.max(CORE.minStartIntervals, Math.ceil(((co.to - co.from) * co.pxPerT) / tuning.startPx))
  n = Math.max(1, Math.min(n, Math.floor(tuning.budget.points)))
  for (let i = 0; i <= n; i++) {
    const t = i === 0 ? co.from : i === n ? co.to : co.from + ((co.to - co.from) * i) / n
    const v = holds(t)
    counter.points++
    if (v === v && v !== 0) return true
  }
  return false
}
