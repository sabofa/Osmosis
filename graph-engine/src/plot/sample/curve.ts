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
//      at the right limit; a jump break; an endpoint mark at each limit, filled or open
//      (below), and a filled value mark when the curve's own value there is neither limit.
//    - hole: both facing ends are anchored at the same limit and the chain is NOT lifted, so
//      the sink carries it through (tc, limit). The pieces meet at exactly tc, which the core
//      never sees as interior: left whole, a removable hole is split by the core with a 1/16 px
//      gap and a jump break (next to it the twin's enclosure is unbounded, so the last floor
//      interval is uncertified). The core draws the stretch that ends at an anchor, if what
//      the samples show certifies it (adaptive.ts), which is what lets the chain run through.
//    - edge: the defined side's end is anchored at the limit when it converged (sqrt, an
//      arc's tip: the core alone stops a floor short of it), else FREE (a limit that
//      diverges, ln x at 0, or one that did not converge): the core samples to the edge itself,
//      refines it on definedness to the last finite point and the sink cuts the curve at the clip
//      box, so ln x dives out of the picture and not a floor's width from the edge, and a sample
//      cannot extend the curve past where it is defined as an anchor could. The core records an
//      edge break where it finds one, which is the same edge as the classified one (within the
//      locator's tolerance), so the classified one is kept and that one dropped. The undefined side's
//      end is singular, so it culls itself or draws nothing. An edge break; and an endpoint
//      mark only when the edge is a SEAM, the author's own condition (a natural sqrt or ln
//      edge is not marked).
//    - FILLED OR OPEN. An end is filled when the curve takes its value there. Where the zero
//      is some comparisons' (Zero.cmps) that is theirs to say, and the curve's own value at
//      the spot is not asked: no sample can tell x^2 < 2 from x^2 <= 2 at an irrational seam.
//      Each comparison holds on one side of the zero. With an inclusive operator (<=, >=) that
//      side owns the zero; with a strict one (<, >) the comparison is false AT the zero, so the
//      piecewise falls through to the branch that carries on from the other side, and that side
//      owns it. When the comparisons all give the same owner (<, >= of one a - b; < of x^2 - 2
//      with > of 2 - x^2) the zero has it: a jump fills the owner's end and opens the other, and
//      a seam edge is filled when the defined side is the owner. = and != hold at a point and not
//      on a side: both ends are open, and the curve's own value at the spot, if it has one, is a
//      filled value mark. Where the comparisons disagree (< with <=), or a - b is exactly 0 at
//      the spot (an exact double: the curve's own value is its real one, and may be undefined),
//      or has no sign off it, or no comparison made the zero, the curve's own value at the spot
//      decides: filled where it equals the limit on screen. (A zero that a natural spot has too, at an
//      irrational seam, is the comparison's all the same: see the known limit in curve.test.ts.)
//    - THE VALUE AT A ZERO that is not an exact double is not the scalar's: a denominator or a built-in's pole
//      vanishes at the real zero, and the double beside it only rounds (pointAt). The twin is asked about the
//      curve there, and unless it says continuous and bounded the classifier is told the point is undefined:
//      sin(x)/sin(x) has a hole at every k pi, not a regular point.
// 5. SAMPLING. The pieces go, in order, into ONE ChainSink, which continues a chain only where
//    one piece ends at exactly the parameter and point the next begins at. It is lifted
//    between pieces at a pole, jump or edge, never at a hole. For an explicit curve (the only
//    kind with an axis to oscillate along) they also share ONE BandSink, which collects the
//    pixel columns where the curve oscillates faster than a pixel (band.ts, adaptive.ts): a band
//    runs on across the seam between two pieces as a chain does, and is no break.
//    BUDGETS. Locating and classifying are counted on one counter and the core's sampling on another, so that
//    one cannot spend the other's budget: the core is checked against what it spends itself (tuning.budget), the
//    locator against LOCATE.pointsTotal and LOCATE.intervalsTotal, and the classifier is bounded by the number
//    of zeros the locator reports (LOCATE.maxZeros). `stats` is the total of them all. A curve is never blank
//    because finding its trouble spots was dear (sqrt(sin(350 x)) was: 105000 points, then nothing drawn).
// 6. OUTPUT. The curve (the sink's chains, its breaks: the classified ones and the core's own,
//    sorted by parameter; a run of the core's jump breaks a floor apart or less with nothing drawn
//    between is one: mergeCoreJumps), its bands (`band.<k>`, in parameter order, the curve's colour), its
//    marks in parameter order, then its asymptote guides. Marks
//    are exact: they are read from limits, not from samples. A jump's side and an edge's
//    limit are read once more close in to the spot (CURVE.settleTols), because limits.ts
//    stops at 6e-9, and for an explicit curve the independent coordinate of a limit is the
//    located parameter itself, not the sample the limit was read at. `tested` and `defined`
//    are read off a start grid (startGrid), drawn or not: over the VISIBLE range of an explicit curve's
//    independent axis (not the overscan), over the given range of a polar or parametric one. `blankInView`
//    says nothing of the curve is drawn in the picture though the grid has a point of it there (the caller
//    says why: the budget, steepness, or that nothing could be certified), and `drawnInView` that something
//    is. A curve that is defined only at isolated points (`{x = 1: 5}`: undefined either side of a point
//    that is defined) is those points, each a filled value mark, and is defined and drawn.
import { integrandEvaluations } from '../../math/binders'
import { type CompiledFn, compileScalar } from '../../math/compile'
import { call, mul, variable } from '../../math/expr'
import { compileInterval, CONTINUOUS, iv, type Verdict } from '../../math/interval'
import { type ComparisonOp, piecewise } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Bounds, Break, Chain, SceneObject, Vec2 } from '../../scene/types'
import { chordMeets, sampleRange } from './adaptive'
import { BandSink } from './band'
import { classify, type Classification } from './limits'
import type { AxisScale } from '../frame/scale'
import { locateZeros, type Zero } from './locate'
import { ChainSink } from './sink'
import { type Generator, joinGenerators, troubleGenerators } from './structure'
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
  // absent = linear; the samplers measure through these from subtask 4.2 on
  xScale?: AxisScale
  yScale?: AxisScale
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
  // A chain or a band of the curve, or one of its isolated points, is in the view (the picture, not the overscan: some
  // vertex of it inside the view, or a segment across it).
  drawnInView: boolean
  // Nothing of the curve is drawn in view (`drawnInView` is false), and the start grid has a finite point of it inside the
  // view: the curve is missing, and it is not because it is not there. The cause is the caller's to say: `capped` (the
  // budget ran out), `tooSteep`, or else that nothing the sampler could certify is there (a staircase of a thousand
  // steps a unit, whose treads are a hundredth of a pixel wide). A curve that is wholly off screen (a capped integral's
  // twin cannot say so, so it is refined as if it were not), or drawn only in the overscan with no grid point in view,
  // is not this.
  blankInView: boolean
  // Somewhere IN VIEW the curve is smooth and too steep for the sampler to certify (a floor interval was lifted because
  // its sub-intervals of 1/1024 px were still a pixel high and their gaps were still halving, by steepShrink: past about
  // 1024:1 on screen), so it is broken there and not drawn, though nothing else is wrong with it. A jump the walk did
  // not find is not this (its gap does not shrink, or not by as much), nor is a steep stretch that is only in the
  // overscan. Decided in the core when the place is recorded (adaptive.ts steepInView), not from a list afterwards.
  tooSteep: boolean
  stats: { points: number; intervals: number }
  // some start-grid sample lay inside the domain
  tested: boolean
  // some start-grid sample inside the domain was finite, whether or not it is visible: a curve
  // wholly off screen (y = x + 100 in a view of [-10, 10]) is defined, with no chains
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
  // the points the curve is defined at and nowhere near (each has a filled value mark)
  isolated: Vec2[]
  poles: number[]
  // the parameters of the edges the walk classified (their breaks are made from this, not through the sink)
  edges: number[]
  // the parameters of the jumps the walk classified (typed, with their marks: mergeCoreJumps leaves them be)
  jumps: number[]
  pt: Float64Array
  // what reading a comparison's side needs: the curve's parameter and scope, and the compiled
  // a - b of each comparison generator (one compile per generator, not per zero)
  param: string
  scope: MathScope
  differences: Map<Expr, CompiledFn>
  // what the twin's enclosure of the curve at a zero is written into (pointAt)
  box: Box
}

// Which side of a zero owns it, by the author's comparison: the side whose end is filled. null
// for = and !=, which hold at a point and not on a side: neither side's end is.
interface Ownership {
  owner: 'left' | 'right' | null
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
  const screen: Screen = { px, view: bounds, clip }
  // Two counters, because there are two budgets. `counter` is what locating the trouble spots and reading them cost
  // (locate.ts and limits.ts, each with a limit of its own) and `spent` is the core's, which the core's budget
  // (tuning.budget) is checked against. When they were one, a locator that burned the budget left the core with none
  // and a curve that drew nothing (sqrt(sin(350 x)): 105000 points before the core began).
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const spent: EvalCounter = { points: 0, intervals: 0 }
  const co = coordinatesOf(spec, view, px, tuning)
  const fns = compileCurve(co, scope)

  // A range or a scale that is not a number draws nothing (a view of no extent, say).
  if (!(co.to > co.from) || !Number.isFinite(co.from) || !Number.isFinite(co.to) || !(co.pxPerT > 0) || !Number.isFinite(co.pxPerT) || !(px.x > 0) || !(px.y > 0)) {
    return { objects: [curveObject(options, [], [])], capped: false, drawnInView: false, blankInView: false, tooSteep: false, stats: { points: 0, intervals: 0 }, tested: true, defined: false }
  }

  // (`located.truncated`, that zeros were left out, is not said to the author: what is left out is the nearest the edges of the
  // range, typed no more than what the core finds on its own, and no note is true of it. LOCATE.maxZeros says what is guarded.)
  const located = locateZeros(generatorsOf(co, scope), co.param, scope, co.from, co.to, counter)
  const h0 = tuning.startPx / co.pxPerT
  const sink = new ChainSink(clip)
  // one sink for every piece: the pieces are walked in parameter order, and a band goes on across the
  // seam between two of them as a chain does
  const bandSink = co.oscillationAxis === null ? undefined : new BandSink(co.oscillationAxis, clip)
  const walk: Walk = {
    fns,
    px,
    counter,
    sink,
    independent: spec.kind === 'explicit' ? spec.independent : null,
    marks: [],
    isolated: [],
    poles: [],
    edges: [],
    jumps: [],
    pt: new Float64Array(2),
    param: co.param,
    scope,
    differences: new Map(),
    box: { xLo: 0, xHi: 0, yLo: 0, yHi: 0 },
  }
  let capped = false
  // whether the core lifted a smooth curve IN VIEW for being too steep for its leaves to resolve (adaptive.ts steepInView)
  let tooSteep = false
  const piece = (ta: number, tb: number, left: End, right: End) => {
    if (!(tb > ta)) return
    const done = sampleRange(fns, ta, tb, { left, right }, screen, tuning, spent, sink, bandSink)
    if (done.capped) capped = true
    if (done.steepInView) tooSteep = true
  }

  let from = co.from
  let leftEnd: End = FREE
  for (const zero of located.zeros) {
    const meeting = meet(walk, classify(pointAt(walk, zero), zero.t, h0, px, counter), zero)
    if (meeting === null) continue
    piece(from, zero.t, leftEnd, meeting.before)
    if (meeting.lift) sink.lift()
    from = zero.t
    leftEnd = meeting.after
  }
  piece(from, co.to, leftEnd, FREE)

  const chains = sink.chains()
  // An edge the core found itself (refineEdge, at a free end) where the walk classified one is that edge: it is
  // recorded once, as the walk placed it.
  const breaks: Break[] = [...mergeCoreJumps(sink.breaks(), walk.jumps, tuning.uncertifiedFloorPx / co.pxPerT, chains).filter((b) => b.kind !== 'edge' || !walk.edges.some((tc) => Math.abs(b.at - tc) <= offsetAt(tc))), ...walk.edges.map((at): Break => ({ at, kind: 'edge' }))].sort((a, b) => a.at - b.at)
  const bands = bandObjects(bandSink, options)
  const objects: SceneObject[] = [curveObject(options, chains, breaks), ...bands, ...marksOf(walk.marks, options), ...(spec.kind === 'explicit' && options.asymptotes ? guidesOf(walk.poles, spec.independent, options) : [])]
  // Drawn, for `defined`: a chain or band that reaches the visible range (an explicit curve drawn only in the overscan is not defined in view)
  const [visibleFrom, visibleTo] = visibleRange(spec, co, bounds)
  // (a curve that is a point, or points, is defined)
  const drawn = (spec.kind === 'explicit' ? reaches(chains, visibleFrom, visibleTo) || bands.some((b) => b.kind === 'band' && reaches(b.outline, visibleFrom, visibleTo)) : chains.length > 0 || bands.length > 0) || walk.isolated.length > 0
  // In the picture: the view, not the range the sampler looked over. The curve's own points count, and a jump's ends and a hole's
  // ring do not (they say what the curve does at a spot, and floor(1000 x) has them in view and is not drawn).
  const drawnInView = walk.isolated.some((p) => p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax) || meetsView(chains, bounds) || bands.some((b) => b.kind === 'band' && meetsView(b.outline, bounds))
  const grid = startGrid(spec, co, fns, scope, tuning, bounds, counter, drawn, !drawnInView)
  // the stats are the total of what the call evaluated: locating, classifying and sampling
  return { objects, capped, drawnInView, blankInView: !drawnInView && grid.seen, tooSteep, stats: { points: counter.points + spent.points, intervals: counter.intervals + spent.intervals }, tested: grid.tested, defined: grid.defined }
}

// Whether any of the chains has a vertex inside the box, or a segment across it.
function meetsView(chains: readonly Chain[], box: Bounds): boolean {
  for (const chain of chains) {
    const { xy } = chain
    for (let i = 0; 2 * i < xy.length; i++) {
      if (xy[2 * i] >= box.xMin && xy[2 * i] <= box.xMax && xy[2 * i + 1] >= box.yMin && xy[2 * i + 1] <= box.yMax) return true
      if (i > 0 && chordMeets(box, xy[2 * i - 2], xy[2 * i - 1], xy[2 * i], xy[2 * i + 1])) return true
    }
  }
  return false
}

// What the curve is AT a zero, as the classifier reads it (limits.ts classify takes the point's own value from this).
// The scalar's value there is the curve's only where tc is the zero itself, and a zero that is not an exact double
// is not: sin(x) at the double nearest 3 pi is 1.2e-16, so sin(x)/sin(x) is 1 THERE, "defined", and equal to its limit,
// and the hole was classified regular (no ring, and an untyped jump a sixteenth of a pixel wide for the core to find);
// (x - pi)/sin(x) took the rounding for a value and had a filled dot at (pi, 0); sin(x)/abs(sin(x)) filled an end at
// every k pi. A denominator vanishes at the real zero whatever the double says (and so does a built-in's own, the
// cosine under a tan: structure.ts names those "... pole"), so there the twin is asked about the curve over a few
// locator tolerances round tc: unless it says CONTINUOUS and bounded (a pole's and a quotient's enclosure over a box
// that holds the zero is neither), the point is undefined, and the classifier is told so. Not asked where the scalar
// already says undefined (an exact zero: 0/0 is NaN), nor at a seam: the author's condition may be there to keep the
// zero out ({x != pi: sin(x - pi)/sin(x), -1} is -1 AT pi), and the enclosure of a piecewise over a seam is not
// continuous whatever its branches are. (A negative power base divides too, but the walk gives it the reason of a
// root's base, which does not: x^(2/3) is defined at 0. It is not asked.)
function pointAt(w: Walk, zero: Zero): PointFn {
  if (zero.origin === 'seam' || !divides(zero)) return w.fns.point
  const tc = zero.t
  w.fns.point(tc, w.pt)
  w.counter.points++
  if (!Number.isFinite(w.pt[0]) || !Number.isFinite(w.pt[1])) return w.fns.point
  const d = offsetAt(tc)
  w.counter.intervals++
  const verdict = w.fns.enclose(tc - d, tc + d, w.box)
  const { xLo, xHi, yLo, yHi } = w.box
  if (verdict === CONTINUOUS && Number.isFinite(xLo) && Number.isFinite(xHi) && Number.isFinite(yLo) && Number.isFinite(yHi)) return w.fns.point
  return (t, out) => {
    if (t === tc) {
      out[0] = Number.NaN
      out[1] = Number.NaN
    } else {
      w.fns.point(t, out)
    }
  }
}

// Whether some generator that has this zero is one the curve divides by (a zero's reasons are joined with "+").
const divides = (zero: Zero): boolean => zero.why.split('+').some((why) => why === 'denominator' || why.endsWith(' pole'))

// The jump breaks the core found, a run of them a floor or less apart made one. The core lifts the curve at every interval it will
// not connect and records the middle of it, so a stretch it cannot decide, where a cancelling form is noise (the sign of
// (x - 1)/sqrt(x^2 - 2x + 1), a unit step with rounding about its jump) is a break at every floor interval and then at every
// bisection below it: hundreds of breaks within a hair of 1, for one place. They are one break at the middle of the run, if nothing
// is drawn between them: a core break is only as exact as the floor interval it is the middle of, and two jumps a pixel or so
// apart (x - floor(x) across +-500) have a chain between them and are two. A jump the walk typed (`typed`: a mark has its
// parameter) is the run's own, and the core's breaks beside it are dropped. Sorted by parameter, as the sink's are not, and
// the other kinds as they were.
function mergeCoreJumps(breaks: readonly Break[], typed: readonly number[], width: number, chains: readonly Chain[]): Break[] {
  const out: Break[] = []
  const sorted = [...breaks].sort((a, b) => a.at - b.at)
  const drawn = Float64Array.from(chains.flatMap((chain) => Array.from(chain.param))).sort()
  // whether a vertex of the drawn curve lies strictly between two parameters
  const drawnBetween = (lo: number, hi: number): boolean => {
    let a = 0
    let b = drawn.length
    while (a < b) {
      const m = (a + b) >> 1
      if (drawn[m] <= lo) a = m + 1
      else b = m
    }
    return a < drawn.length && drawn[a] < hi
  }
  let run: Break[] = []
  const close = () => {
    if (run.length === 0) return
    const own = run.filter((b) => typed.includes(b.at))
    if (own.length > 0) out.push(...own)
    else out.push({ at: (run[0].at + run[run.length - 1].at) / 2, kind: 'jump' })
    run = []
  }
  for (const b of sorted) {
    if (b.kind !== 'jump') {
      out.push(b)
      continue
    }
    if (run.length > 0 && (!(b.at - run[run.length - 1].at <= width * (1 + 1e-6)) || drawnBetween(run[run.length - 1].at, b.at))) close()
    run.push(b)
  }
  close()
  return out
}

// What one classified spot is to the pieces beside it (step 4 of the header), and the typed
// breaks and marks it leaves. Null for a spot that is not a cut.
function meet(w: Walk, c: Classification, zero: Zero): Meeting | null {
  const tc = zero.t
  switch (c.kind) {
    case 'regular':
    case 'unknown':
      return null
    case 'isolated':
      // the curve is this point: nothing either side of it to draw, and no end or break to say (a point has no edge). Its mark
      // is a filled value, and the pieces beside it are singular (they are undefined, and cull themselves).
      w.marks.push({ at: c.value, role: 'value', fill: 'filled' })
      w.isolated.push(c.value)
      return { before: SINGULAR, after: SINGULAR, lift: true }
    case 'pole':
      w.sink.addBreak(tc, 'pole')
      w.poles.push(tc)
      return { before: SINGULAR, after: SINGULAR, lift: true }
    case 'jump': {
      const left = onAxis(w, settle(w, c.left, tc, -1), tc)
      const right = onAxis(w, settle(w, c.right, tc, 1), tc)
      w.sink.addBreak(tc, 'jump')
      w.jumps.push(tc)
      const own = ownerAt(w, zero)
      if (own) {
        // the comparison says which end the curve takes, and the value at the spot is not asked
        w.marks.push({ at: left, role: 'endpoint', fill: own.owner === 'left' ? 'filled' : 'open' }, { at: right, role: 'endpoint', fill: own.owner === 'right' ? 'filled' : 'open' })
        if (own.owner === null && c.value !== null) w.marks.push({ at: c.value, role: 'value', fill: 'filled' })
      } else {
        w.marks.push({ at: left, role: 'endpoint', fill: fillOf(w, left, c.value) }, { at: right, role: 'endpoint', fill: fillOf(w, right, c.value) })
        // a value that is neither limit is a point of its own
        if (c.value !== null && !same(w, left, c.value) && !same(w, right, c.value)) w.marks.push({ at: c.value, role: 'value', fill: 'filled' })
      }
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
      // a limit that diverges (or did not converge) is not an anchor: that end is free, and what the core samples
      // there is the curve, to the last point it is defined at, with nothing marked
      const limit = c.limit === null ? null : onAxis(w, settle(w, c.limit, tc, c.defined === 'left' ? -1 : 1), tc)
      const reach: End = limit === null ? FREE : { kind: 'anchor', at: limit }
      // (recorded with the others after the sampling, once the core's own edge breaks that repeat it are dropped)
      w.edges.push(tc)
      // only an edge the author wrote is marked, and only with a limit to mark
      if (limit !== null && zero.origin === 'seam') {
        const own = ownerAt(w, zero)
        // filled when the defined side owns the edge, if the comparison says; else by the value
        w.marks.push({ at: limit, role: 'endpoint', fill: own ? (own.owner === c.defined ? 'filled' : 'open') : fillOf(w, limit, valueAt(w, tc)) })
        if (own && own.owner === null) {
          const value = valueAt(w, tc)
          if (value !== null) w.marks.push({ at: value, role: 'value', fill: 'filled' })
        }
      }
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

// The offset from a spot at which a one-sided reading is on the side it is meant for.
function offsetAt(tc: number): number {
  return CURVE.settleTols * LOCATE.tolRel * Math.max(1, Math.abs(tc))
}

// A one-sided limit read again close in to the spot (CURVE.settleTols), if the new reading
// agrees with the old one to CURVE.settleAgreePx.
function settle(w: Walk, limit: Vec2, tc: number, side: -1 | 1): Vec2 {
  w.fns.point(tc + side * offsetAt(tc), w.pt)
  w.counter.points++
  const p = { x: w.pt[0], y: w.pt[1] }
  const agrees = Number.isFinite(p.x) && Number.isFinite(p.y) && distancePx(w, p, limit) <= CURVE.settleAgreePx
  return agrees ? p : limit
}

// Which side of the zero owns it by the author's comparisons, or null where they do not say.
// Each comparison of the zero (Zero.cmps) gives an owner of its own, and the zero is owned only
// if they all give the same one: {x^2 < 2: 0, x^2 >= 2: 1} is two comparisons of one a - b that
// agree (a - b > 0 owns it), and so is {x^2 < 2: 0, 1} + {2 - x^2 > 0: 0, 1}, two a - b that
// agree; < with <=, or < with >, disagree, and the curve's own value at the spot decides.
//  - A comparison holds on the side where its a - b has the sign its operator wants, read a
//    locator tolerance or so off the zero.
//  - An inclusive operator (<=, >=) is true at the zero, so the side it holds on owns it. A strict
//    one (<, >) is false at the zero, which then belongs to the other side: the piecewise falls
//    through to the branch that carries on from there.
//  - = holds at the point alone and != on both sides with the point out: neither side owns it.
//  - No answer (null, so the value rule): a - b is exactly 0 at the zero (it is an exact double,
//    the curve's own value there is its real one, and may be undefined: a filled end at a 0/0
//    would be drawn where there is no point), a - b has no sign off it (NaN or 0, or the same
//    sign both sides, as an even zero has), or no comparison made the zero.
function ownerAt(w: Walk, zero: Zero): Ownership | null {
  const { cmps } = zero
  if (!cmps || cmps.length === 0) return null
  let owner: 'left' | 'right' | 'neither' | null = null
  for (const { cmp, cmpExpr } of cmps) {
    const mine = comparisonOwner(w, cmp, cmpExpr, zero.t)
    if (mine === null) return null
    if (owner !== null && owner !== mine) return null
    owner = mine
  }
  return { owner: owner === 'neither' ? null : owner }
}

// One comparison's owner of the zero at tc (see ownerAt), or null for no answer.
function comparisonOwner(w: Walk, cmp: ComparisonOp, cmpExpr: Expr, tc: number): 'left' | 'right' | 'neither' | null {
  if (cmp === '=' || cmp === '!=') return 'neither'
  let g = w.differences.get(cmpExpr)
  if (!g) {
    g = compileScalar(cmpExpr, [w.param], w.scope)
    w.differences.set(cmpExpr, g)
  }
  const h = offsetAt(tc)
  const left = g(tc - h)
  const right = g(tc + h)
  const at = g(tc)
  w.counter.points += 3
  if (at === 0 || Number.isNaN(left) || Number.isNaN(right) || left === 0 || right === 0) return null
  const wantsPositive = cmp === '>' || cmp === '>='
  const holdsLeft = left > 0 === wantsPositive
  const holdsRight = right > 0 === wantsPositive
  if (holdsLeft === holdsRight) return null
  const holds = holdsLeft ? 'left' : 'right'
  const inclusive = cmp === '<=' || cmp === '>='
  return inclusive ? holds : holds === 'left' ? 'right' : 'left'
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

// The bands, one object each in the order they were found (parameter order), the curve's colour.
function bandObjects(bandSink: BandSink | undefined, options: CurveOptions): SceneObject[] {
  if (bandSink === undefined) return []
  return bandSink.bands().map((outline, k) => ({ kind: 'band', id: { statement: options.statement, object: `band.${k}` }, outline, color: options.color }))
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
    work: integrandEvaluations,
    pxPerT: co.pxPerT,
    oscillationAxis: co.oscillationAxis,
  }
}

// The generators of every varying expression, one of each: fx and fy often share a
// denominator, and a repeated generator is only repeated work. Joined as the walk joins them
// (a seam wins over a natural spot of the same expression; the comparison survives only if
// both are the one comparison).
function generatorsOf(co: Coordinates, scope: MathScope): Generator[] {
  const found = new Map<string, Generator>()
  for (const e of co.varying) {
    for (const g of troubleGenerators(e, co.param, scope)) {
      const key = JSON.stringify(g.expr)
      const known = found.get(key)
      found.set(key, known ? joinGenerators(known, g) : g)
    }
  }
  return [...found.values()]
}

// Whether any vertex of the chains has a parameter in [lo, hi].
function reaches(chains: readonly Chain[], lo: number, hi: number): boolean {
  for (const chain of chains) {
    for (let i = 0; i < chain.param.length; i++) if (chain.param[i] >= lo && chain.param[i] <= hi) return true
  }
  return false
}

// What the start grid says of the curve as a whole, for the caller's messages.
//  - tested: some parameter of the grid satisfies the domain (a condition holds where it is
//    neither 0 nor NaN), so the curve was tested against something. True with no domain.
//  - defined: some parameter of the grid gave a finite point, drawn or not. A curve that was
//    drawn is defined, and costs nothing to say so; one that was not may be wholly off screen
//    (culled by one enclosure, with no sample taken), so the grid is read for it. Outside a
//    domain the piecewise is NaN, so a finite point is one inside it.
//  - seen (only when asked for): some finite point of the grid lies inside the view.
// An explicit curve's grid is the VISIBLE range of its independent axis, not the sampled one:
// the overscan is where the sampler looks, not where the picture is, and y = sqrt(x - 12) has a
// stretch in the overscan of a view of +-10 and none in view, which is "undefined everywhere in
// view" (and a chain drawn only out there is not a curve defined in view: `drawn` is whether
// a chain or band reaches the visible range). Polar and parametric have no axis, so theirs is
// the range they were given.
// (The grid is laid as the core would lay it over that range: the pieces the structure walk cuts
// have grids of their own, and a domain narrower than the whole grid's spacing is "tested" by
// nothing, which says nothing: that is the safe way for the message to go.)
function startGrid(
  spec: CurveSpec,
  co: Coordinates,
  fns: CurveFns,
  scope: MathScope,
  tuning: Tuning,
  view: Bounds,
  counter: EvalCounter,
  drawn: boolean,
  wantSeen: boolean
): { tested: boolean; defined: boolean; seen: boolean } {
  const domain = spec.kind === 'explicit' ? spec.domain : null
  const holds = domain ? compileScalar(domain, [co.param], scope) : null
  let tested = holds === null
  let defined = drawn
  let seen = false
  if (tested && defined && !wantSeen) return { tested, defined, seen }
  const [from, to] = visibleRange(spec, co, view)
  let n = Math.max(CORE.minStartIntervals, Math.ceil(((to - from) * co.pxPerT) / tuning.startPx))
  n = Math.max(1, Math.min(n, Math.floor(tuning.budget.points)))
  const pt = new Float64Array(2)
  for (let i = 0; i <= n && !(tested && defined && (seen || !wantSeen)); i++) {
    const t = i === 0 ? from : i === n ? to : from + ((to - from) * i) / n
    if (holds && !tested) {
      const v = holds(t)
      counter.points++
      if (v === v && v !== 0) tested = true
    }
    if (!defined || (wantSeen && !seen)) {
      fns.point(t, pt)
      counter.points++
      if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        defined = true
        if (pt[0] >= view.xMin && pt[0] <= view.xMax && pt[1] >= view.yMin && pt[1] <= view.yMax) seen = true
      }
    }
  }
  return { tested, defined, seen }
}

// The range the start grid is laid over: an explicit curve's independent axis across the view (no
// overscan), the parameter range of the others.
function visibleRange(spec: CurveSpec, co: Coordinates, view: Bounds): [number, number] {
  if (spec.kind !== 'explicit') return [co.from, co.to]
  return spec.independent === 'x' ? [view.xMin, view.xMax] : [view.yMin, view.yMax]
}
