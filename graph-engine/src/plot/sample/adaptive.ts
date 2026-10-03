// The adaptive core (calc P2; spec "The curve sampler"): one parameter range of one
// curve, subdivided in screen space into chains.
//
// THE RULE: nothing is connected unless certified. Two points are joined across an
// interval only when the interval twin proves the curve defined and continuous there
// (verdict CONTINUOUS), or when the pixel-scale jump test shows the gap between them
// closing. Everything else is bisected until it is resolved or is narrower than the
// sub-pixel floor, and then the chain is lifted: a break, never a bridge. A sampler that
// connects on a hunch draws the chord across a pole, and that is the defect this core
// exists to not have. Steepness is not a reason to break, though: a CONTINUOUS curve is
// connected at the floor however steep it is.
//
// 1. START
//  - The whole range is enclosed once, first. An enclosure that is empty, or does not meet
//    the clip box, ends the call with nothing drawn: a curve wholly off screen costs one
//    evaluation. (Valid under any verdict: the enclosure holds every value there is.)
//  - Otherwise the start grid has n = max(8, ceil(range px / startPx)) intervals. An
//    `anchor` end uses its point and is not evaluated; a `singular` end is replaced by the
//    parameter a floor's width (floorPx / pxPerT) inside it, so the pole or the edge itself
//    is never evaluated.
//  - The start grid, its points and the enclosure of each interval, is ALWAYS evaluated: it
//    is the coarse floor under every curve. The budget governs refinement only.
//
// 2. EACH INTERVAL [ta, tb], with its end points Pa and Pb, depth first in parameter order
//  - Budget: once the counter has reached either limit, refinement stops. The interval is
//    connected only if it (below the start grid: its parent) was certified CONTINUOUS and
//    both points are finite; otherwise the chain is lifted. The call says it was capped.
//  - Cull: enclose [ta, tb]. Empty, or not meeting the clip box: nothing visible is here, so
//    lift and stop. This is valid under any verdict.
//  - Certified (CONTINUOUS and both points finite): sample the midpoint Pm. Accept Pa -> Pb
//    when Pm is within flatPx of the chord (of the chord's midpoint, which is stricter: see
//    isFlat), the chord is at most maxSegPx long, and (the spike test) the enclosure is no
//    taller or wider than spikeFactor times the span the samples cover, plus spikeSlackPx: a
//    spike narrower than the sample spacing is in the enclosure and not in the samples.
//    Otherwise, at the floor, accept anyway; else bisect.
//  - Both ends undefined: at the floor lift; else bisect, which finds defined stretches inside.
//  - One end undefined: at the floor, refine the edge (bisect on whether the point is finite,
//    between the defined end and the undefined one), draw to the last defined point, record
//    an `edge` break and lift; else bisect.
//  - Both finite, not certified: if the screen gap is under gapPx and the jump test passes,
//    connect. Otherwise at the floor lift and record a `jump` break; else bisect. The jump
//    test halves the interval `halvings` times, always keeping the half with the larger gap,
//    and each gap must be at most halvingShrink times the one before: a continuous seam
//    halves its gap, a jump keeps it. At the floor, an interval that ends at an `anchor` is
//    drawn instead (see the comment there): the anchor is a limit the structure walk has read.
//
// 3. A sample that is not finite is undefined here: an infinity is never certified flat.
//
// 4. BANDS (a curve whose fns have an oscillation axis, and a call that was given a BandSink)
//  - An interval at most BAND.columnPx wide that is still unresolved is tried as a column of a
//    band. That is decided at the two points above that leave an interval unresolved: a certified
//    interval that is not flat (before it is accepted at the floor or bisected), and an interval the
//    twin cannot certify (before anything else is asked of it).
//  - BAND.samples values of the oscillation coordinate are taken over the interval, evenly spaced,
//    the ends included (they are already known, so they cost nothing). If they turn at least
//    BAND.minTurns times, the interval is a column: its extent is the least and greatest finite
//    sample, clamped into the twin's enclosure of the interval (a band never says more than the
//    enclosure does), and the chain is lifted. The column stops the refinement: it is the picture.
//    No break is recorded; a band is not a mathematical interruption.
//  - If they do not, nothing has happened but the evaluations, and the interval is dealt with as
//    before: a steep monotone stretch is refined to the floor and connected.
//  - Trying a column costs BAND.samples - 2 evaluations, and most of the intervals that get this far
//    are steep stretches, not oscillations, so bandColumn spares itself where it can tell: an interval
//    the twin shows to be a stroke is not tried, and one that is tried once is not tried again at the
//    halves it is bisected into. See bandColumn.
import { CONTINUOUS, PARTIAL, UNKNOWN } from '../../math/interval'
import type { Bounds } from '../../scene/types'
import { type BandSink, oscillates } from './band'
import type { ChainSink } from './sink'
import { BAND, CORE, type Tuning } from './tuning'
import type { Box, CurveFns, End, EvalCounter, Screen } from './types'

// An interval is a column to try when it is at most this wide (px): the width the tuning says, to
// rounding. The start grid's intervals are halved, so a 4 px one comes to a pixel with an error of 1e-14
// or so, and a view 800 px wide with its overscan (1200) is a whole number of them: a column a pixel
// and a hair wide would be bisected to half a pixel, where there is a period to show and not two, and
// the samples often miss the second turn (sin(500x) came to 24 bands and the budget, not to one band).
const COLUMN_PX = BAND.columnPx * (1 + BAND.columnSlack)

// One call's working state. The scratch box and point are shared by every interval of the
// call: an interval reads what it needs out of them before it recurses.
interface Core {
  fns: CurveFns
  screen: Screen
  tune: Tuning
  counter: EvalCounter
  sink: ChainSink
  box: Box
  pt: Float64Array
  capped: boolean
  // The parameters at which the range ends in an anchor (NaN: it does not), compared exactly
  // against an interval's ends: bisecting hands the end's own double down to the interval that
  // touches it.
  anchorLo: number
  anchorHi: number
  // What the columns of a band need, or undefined where there are none to be had: a call that was
  // not given a sink, or a curve with no axis to oscillate along (polar, parametric).
  bands: BandState | undefined
}

interface BandState {
  sink: BandSink
  axis: 'y' | 'x'
  // the scratch a column's values are taken into
  samples: Float64Array
  // The interval last tried as a column and found not to oscillate: the halves it is bisected into
  // are not tried again (the refinement of an interval comes straight after it, depth first)
  notLo: number
  notHi: number
  // where the last column that was a band's ended (NaN: none yet)
  lastEnd: number
}

export function sampleRange(fns: CurveFns, t0: number, t1: number, ends: { left: End; right: End }, screen: Screen, tuning: Tuning, counter: EvalCounter, sink: ChainSink, bands?: BandSink): { capped: boolean } {
  // a singular end is a floor's width inside, whatever the end is
  const nudge = tuning.floorPx / fns.pxPerT
  const a = ends.left.kind === 'singular' ? t0 + nudge : t0
  const b = ends.right.kind === 'singular' ? t1 - nudge : t1
  if (!(b > a)) return { capped: false }
  const c: Core = {
    fns,
    screen,
    tune: tuning,
    counter,
    sink,
    box: { xLo: 0, xHi: 0, yLo: 0, yHi: 0 },
    pt: new Float64Array(2),
    capped: false,
    anchorLo: ends.left.kind === 'anchor' ? a : Number.NaN,
    anchorHi: ends.right.kind === 'anchor' ? b : Number.NaN,
    bands: bands === undefined || fns.oscillationAxis === null ? undefined : { sink: bands, axis: fns.oscillationAxis, samples: new Float64Array(BAND.samples), notLo: Number.NaN, notHi: Number.NaN, lastEnd: Number.NaN },
  }

  counter.intervals++
  fns.enclose(a, b, c.box)
  if (offScreen(c.box, screen.clip)) return { capped: false }

  let n = Math.ceil(((b - a) * fns.pxPerT) / tuning.startPx)
  if (!(n >= CORE.minStartIntervals)) n = CORE.minStartIntervals
  // The grid is always drawn, so it must not be able to outgrow the budget it is part of.
  n = Math.max(1, Math.min(n, Math.floor(tuning.budget.points)))
  const ts = new Float64Array(n + 1)
  const xs = new Float64Array(n + 1)
  const ys = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const t = i === 0 ? a : i === n ? b : a + ((b - a) * i) / n
    ts[i] = t
    const end = i === 0 ? ends.left : i === n ? ends.right : null
    if (end !== null && end.kind === 'anchor') {
      xs[i] = end.at.x
      ys[i] = end.at.y
    } else {
      evalAt(c, t)
      xs[i] = c.pt[0]
      ys[i] = c.pt[1]
    }
  }
  for (let i = 0; i < n; i++) visit(c, ts[i], ts[i + 1], xs[i], ys[i], xs[i + 1], ys[i + 1], false, true)
  return { capped: c.capped }
}

// One interval. `inherited`: its parent was enclosed and came out CONTINUOUS. `grid`: it is
// an interval of the start grid, which is enclosed whatever the budget says.
function visit(c: Core, ta: number, tb: number, xa: number, ya: number, xb: number, yb: number, inherited: boolean, grid: boolean): void {
  const spent = c.counter.points >= c.tune.budget.points || c.counter.intervals >= c.tune.budget.intervals
  if (spent && !grid) {
    c.capped = true
    if (inherited && isFinite2(xa, ya) && isFinite2(xb, yb)) c.sink.segment(xa, ya, ta, xb, yb, tb)
    else c.sink.lift()
    return
  }

  c.counter.intervals++
  const verdict = c.fns.enclose(ta, tb, c.box)
  if (offScreen(c.box, c.screen.clip)) {
    c.sink.lift()
    return
  }
  const certified = verdict === CONTINUOUS && isFinite2(xa, ya) && isFinite2(xb, yb)
  if (spent) {
    // a start-grid interval past the budget: it is drawn as it stands, if the twin vouches for it
    c.capped = true
    if (certified) c.sink.segment(xa, ya, ta, xb, yb, tb)
    else c.sink.lift()
    return
  }

  const widthPx = (tb - ta) * c.fns.pxPerT
  const tm = ta + (tb - ta) / 2
  // At the floor, or too narrow for the doubles to hold a midpoint: bisecting is over.
  const atFloor = widthPx <= c.tune.floorPx || !(tm > ta && tm < tb)
  const continuous = verdict === CONTINUOUS

  if (certified) {
    if (!(tm > ta && tm < tb)) {
      c.sink.segment(xa, ya, ta, xb, yb, tb)
      return
    }
    const encW = (c.box.xHi - c.box.xLo) * c.screen.px.x
    const encH = (c.box.yHi - c.box.yLo) * c.screen.px.y
    evalAt(c, tm)
    const xm = c.pt[0]
    const ym = c.pt[1]
    if (isFinite2(xm, ym) && isFlat(c, xa, ya, xm, ym, xb, yb, encW, encH)) {
      c.sink.segment(xa, ya, ta, xb, yb, tb)
      return
    }
    if (widthPx <= COLUMN_PX && bandColumn(c, ta, tb, xa, ya, xb, yb)) return
    if (atFloor) {
      // steepness never breaks a curve
      c.sink.segment(xa, ya, ta, xb, yb, tb)
      return
    }
    bisect(c, ta, tm, tb, xa, ya, xm, ym, xb, yb, continuous)
    return
  }

  if (widthPx <= COLUMN_PX && bandColumn(c, ta, tb, xa, ya, xb, yb)) return
  const aFinite = isFinite2(xa, ya)
  const bFinite = isFinite2(xb, yb)

  if (!aFinite && !bFinite) {
    if (atFloor) c.sink.lift()
    else bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
    return
  }
  if (aFinite !== bFinite) {
    if (atFloor) refineEdge(c, ta, xa, ya, tb, xb, yb, aFinite)
    else bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
    return
  }

  // Both finite, and the twin cannot say the curve is continuous between them. Closing gaps
  // is the jump test's to show, but not across a stretch the twin could not bound: an
  // enclosure with an infinite bound is where a pole may sit, and three samples that happen to
  // shrink are no certificate against that. (UNKNOWN has no bounds at all, by construction.)
  const bounded = verdict === UNKNOWN || isBounded(c.box)
  if (bounded && pxDistance(c, xa, ya, xb, yb) < c.tune.gapPx && gapCloses(c, ta, tb, xa, ya, xb, yb)) {
    c.sink.segment(xa, ya, ta, xb, yb, tb)
    return
  }
  if (atFloor) {
    // An interval that ends at an anchor is the last stretch to a limit the structure walk has
    // read (limits.ts: a hole's, a jump's side, a domain edge's), and the anchor is where the
    // curve is known to arrive. The twin cannot say so (next to a hole its enclosure is
    // unbounded; at an arc's tip it dips under the domain), so the stretch is certified the way
    // any uncertified one is, by what the samples show, minus the two preconditions the jump test
    // has for a stretch about which nothing is known (a gap under gapPx, a bounded enclosure): the
    // ends are within flatPx, or the gaps close (anchorShrink, looser: it is a tip). A singularity
    // the walk never located (a built-in with no rule, a sum whose bound is a @param, a zero the
    // classifier called unknown) between the sample and the anchor opens the gap instead, and
    // then the stretch is lifted with its jump break like any other.
    if ((ta === c.anchorLo || tb === c.anchorHi) && (pxDistance(c, xa, ya, xb, yb) <= c.tune.flatPx || gapCloses(c, ta, tb, xa, ya, xb, yb, c.tune.anchorShrink))) {
      c.sink.segment(xa, ya, ta, xb, yb, tb)
      return
    }
    c.sink.lift()
    c.sink.addBreak(ta + (tb - ta) / 2, 'jump')
    return
  }
  bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
}

function bisect(c: Core, ta: number, tm: number, tb: number, xa: number, ya: number, xm: number, ym: number, xb: number, yb: number, continuous: boolean): void {
  visit(c, ta, tm, xa, ya, xm, ym, continuous, false)
  visit(c, tm, tb, xm, ym, xb, yb, continuous, false)
}

// Bisecting when the midpoint has not been sampled yet.
function bisectAtMid(c: Core, ta: number, tm: number, tb: number, xa: number, ya: number, xb: number, yb: number, continuous: boolean): void {
  evalAt(c, tm)
  bisect(c, ta, tm, tb, xa, ya, c.pt[0], c.pt[1], xb, yb, continuous)
}

// Flat: Pm on the chord to within flatPx, the chord short, and the enclosure no wider than
// the samples say (the spike test).
function isFlat(c: Core, xa: number, ya: number, xm: number, ym: number, xb: number, yb: number, encW: number, encH: number): boolean {
  const px = c.screen.px
  const ax = xa * px.x
  const ay = ya * px.y
  const mx = xm * px.x
  const my = ym * px.y
  const bx = xb * px.x
  const by = yb * px.y
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  // (every comparison is written so that a NaN or an overflow fails it)
  if (!(len2 <= c.tune.maxSegPx * c.tune.maxSegPx)) return false
  // Pm against the chord's own midpoint, the point the polyline draws at the parameter
  // midpoint. That is within flatPx of the chord, and stricter than the distance to the
  // chord: the error ALONG the chord counts, which for y = f(x) is the vertical error. The
  // perpendicular distance alone lets a steep chord (screen slope s) sit up to
  // flatPx * sqrt(1 + s^2) above or below the curve: 1.9 px of sin(50x) at s = 7.7.
  const ex = mx - (ax + bx) / 2
  const ey = my - (ay + by) / 2
  if (!(Math.sqrt(ex * ex + ey * ey) <= c.tune.flatPx)) return false
  const spanX = Math.max(ax, mx, bx) - Math.min(ax, mx, bx)
  const spanY = Math.max(ay, my, by) - Math.min(ay, my, by)
  return encW <= c.tune.spikeFactor * spanX + c.tune.spikeSlackPx && encH <= c.tune.spikeFactor * spanY + c.tune.spikeSlackPx
}

// The jump test: do the gaps between samples close as the interval is halved? Each gap must be at
// most `shrink` times the one before.
function gapCloses(c: Core, ta0: number, tb0: number, xa0: number, ya0: number, xb0: number, yb0: number, shrink: number = c.tune.halvingShrink): boolean {
  let ta = ta0
  let tb = tb0
  let xa = xa0
  let ya = ya0
  let xb = xb0
  let yb = yb0
  let gap = pxDistance(c, xa, ya, xb, yb)
  for (let k = 0; k < c.tune.halvings; k++) {
    const tm = ta + (tb - ta) / 2
    if (!(tm > ta && tm < tb)) return false
    evalAt(c, tm)
    const xm = c.pt[0]
    const ym = c.pt[1]
    if (!isFinite2(xm, ym)) return false
    const left = pxDistance(c, xa, ya, xm, ym)
    const right = pxDistance(c, xm, ym, xb, yb)
    const next = left >= right ? left : right
    // (written so that a NaN fails it)
    if (!(next <= shrink * gap)) return false
    if (left >= right) {
      tb = tm
      xb = xm
      yb = ym
    } else {
      ta = tm
      xa = xm
      ya = ym
    }
    gap = next
  }
  return true
}

// One end of an interval at the floor is defined and the other is not: where does the
// curve stop? Bisect on whether the point is finite, towards the undefined end. The chain
// is then drawn up to the last defined point, so a curve that dives (ln x) or ends (sqrt x)
// reaches its edge, and the edge is recorded. Drawn in parameter order, and lifted after
// only when the defined stretch is the left one: when the undefined end is the left, the chain
// starts at the edge and carries on into the next interval.
//
// The stretch itself is certified first. The bisection knows that its two ends are finite and
// nothing about what lies between, and a step with a closed edge (floor(x - c + 1) for x <= c),
// or a pole within a floor's width of the edge, would be drawn as a stroke across it. So the twin
// is asked about the stretch, and it is drawn whole only when it is CONTINUOUS.
//
// PARTIAL with bounds is the verdict at the tip of a semicircle: the domain ends inside the stretch
// (the rounding at its edge), but nothing blows up. It is also what a sqrt-type edge turns a step
// into: PARTIAL hides the DEFINED that floor(x - c + 1) + sqrt(c - x) would have said. So that
// verdict is not trusted whole. The stretch is split a 1024th of the way in from the last defined
// point: the body, from the defined end to there, is drawn only if the twin says CONTINUOUS of it
// (a step in it would say DEFINED), and the sliver that is left only if its ends are under a gap
// apart and the jump test shows them closing, as for any interval the twin cannot certify.
//
// Anything else lifts the chain, and the edge is recorded in every case.
function refineEdge(c: Core, ta: number, xa: number, ya: number, tb: number, xb: number, yb: number, aDefined: boolean): void {
  let td = aDefined ? ta : tb
  let xd = aDefined ? xa : xb
  let yd = aDefined ? ya : yb
  let tu = aDefined ? tb : ta
  for (let i = 0; i < CORE.edgeSteps; i++) {
    const tm = td + (tu - td) / 2
    if (tm === td || tm === tu) break
    evalAt(c, tm)
    if (isFinite2(c.pt[0], c.pt[1])) {
      td = tm
      xd = c.pt[0]
      yd = c.pt[1]
    } else {
      tu = tm
    }
  }
  const tEnd = aDefined ? ta : tb
  // (a stretch of no extent has nothing between its ends to certify)
  let verdict = CONTINUOUS
  let bounded = true
  if (td !== tEnd) {
    c.counter.intervals++
    verdict = c.fns.enclose(aDefined ? ta : td, aDefined ? td : tb, c.box)
    bounded = isBounded(c.box)
  }
  if (verdict === CONTINUOUS) {
    if (aDefined) {
      c.sink.segment(xa, ya, ta, xd, yd, td)
      c.sink.lift()
    } else {
      c.sink.segment(xd, yd, td, xb, yb, tb)
    }
  } else if (verdict === PARTIAL && bounded) {
    drawEdgeSplit(c, ta, xa, ya, tb, xb, yb, aDefined, td, xd, yd)
  } else {
    c.sink.lift()
  }
  c.sink.addBreak(td, 'edge')
}

// The stretch of an edge that the twin calls PARTIAL with bounds (see refineEdge): its body, from
// the defined end to a point 1/1024 of the way in from the last defined point td, if that is
// CONTINUOUS; then the sliver from there to td, if the jump test closes it. Drawn in parameter
// order, lifted at the end only when the defined end is the left one, as refineEdge does.
function drawEdgeSplit(c: Core, ta: number, xa: number, ya: number, tb: number, xb: number, yb: number, aDefined: boolean, td: number, xd: number, yd: number): void {
  const tEnd = aDefined ? ta : tb
  const tIn = td + (tEnd - td) / 1024
  let bodyOk = false
  let sliverOk = false
  let xi = 0
  let yi = 0
  if (tIn !== td && tIn !== tEnd) {
    evalAt(c, tIn)
    xi = c.pt[0]
    yi = c.pt[1]
    c.counter.intervals++
    const inner = c.fns.enclose(aDefined ? ta : tIn, aDefined ? tIn : tb, c.box)
    bodyOk = inner === CONTINUOUS && isFinite2(xi, yi)
    sliverOk = bodyOk && pxDistance(c, xi, yi, xd, yd) < c.tune.gapPx && (aDefined ? gapCloses(c, tIn, td, xi, yi, xd, yd) : gapCloses(c, td, tIn, xd, yd, xi, yi))
  }
  if (aDefined) {
    if (bodyOk) c.sink.segment(xa, ya, ta, xi, yi, tIn)
    if (sliverOk) c.sink.segment(xi, yi, tIn, xd, yd, td)
    c.sink.lift()
  } else {
    c.sink.lift()
    if (sliverOk) c.sink.segment(xd, yd, td, xi, yi, tIn)
    if (bodyOk) c.sink.segment(xi, yi, tIn, xb, yb, tb)
  }
}

// At the two points where an interval at most a pixel wide is still unresolved (certified but not
// flat; not certified), a band may take the column instead (step 4 of the header). Returns whether
// it did, which stops the refinement of the interval.
//
// The interval's enclosure is still in c.box, as visit left it, and is read before anything else
// can touch it. The ends are the values the caller already holds, so a column that is tried costs
// BAND.samples - 2 evaluations, all counted, whether or not it is a band's. Most are not tried:
//  - A STROKE is not. When the twin's enclosure of the interval, along the oscillation axis, is no
//    taller than the span of the two ends (and spikeSlackPx), nothing lies between the ends for a band to
//    show: the interval is a steep stretch that the core refines to the floor and connects, as it
//    always has. Steep stretches are what most intervals that get this far are (sin(50x) is made of
//    them, a thousand a view), and trying each, at every level of its refinement, capped sin(50x) at
//    its budget (60012 points, 19201 without). Not so beside a band, though: the ends of a column of
//    an oscillation can sit at its extremes, and a column left out would cut the band in two
//    (sin(363x) came to 115 bands).
//  - A second try is not made. An interval that was tried and did not turn is not tried again at the
//    halves it is bisected into, which follow it at once: the question was asked there.
function bandColumn(c: Core, ta: number, tb: number, xa: number, ya: number, xb: number, yb: number): boolean {
  const bands = c.bands
  if (bands === undefined) return false
  if (ta >= bands.notLo && tb <= bands.notHi) return false
  const alongY = bands.axis === 'y'
  const enclosureLo = alongY ? c.box.yLo : c.box.xLo
  const enclosureHi = alongY ? c.box.yHi : c.box.xHi
  const endA = alongY ? ya : xa
  const endB = alongY ? yb : xb
  if (ta !== bands.lastEnd && isStroke(c, enclosureLo, enclosureHi, endA, endB, alongY)) return false

  const n = BAND.samples
  const v = bands.samples
  v[0] = endA
  v[n - 1] = endB
  for (let i = 1; i < n - 1; i++) {
    evalAt(c, ta + ((tb - ta) * i) / (n - 1))
    v[i] = alongY ? c.pt[1] : c.pt[0]
  }
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(v[i])) continue
    if (v[i] < lo) lo = v[i]
    if (v[i] > hi) hi = v[i]
  }
  // never beyond the twin's enclosure of this interval (a bound that is NaN clamps nothing)
  if (enclosureLo > lo) lo = enclosureLo
  if (enclosureHi < hi) hi = enclosureHi
  // And if the samples do not turn, or the enclosure does not hold them at all (the twin and the scalar
  // disagree about this interval, so neither is trusted with a band), the core goes on as it would have.
  if (!oscillates(v, n, BAND.minTurns) || lo > hi) {
    bands.notLo = ta
    bands.notHi = tb
    return false
  }

  bands.sink.column(ta, tb, lo, hi)
  bands.lastEnd = tb
  c.sink.lift()
  return true
}

// Whether the enclosure [lo, hi] of an interval on the oscillation axis is within the span of the
// two ends there and spikeSlackPx (px of that axis), which is what that is for: the twin's looseness
// over an interval (x + sin(20x) is a pixel looser than it is high). An end that is not finite has no
// span.
function isStroke(c: Core, lo: number, hi: number, endA: number, endB: number, alongY: boolean): boolean {
  if (!(Number.isFinite(endA) && Number.isFinite(endB))) return false
  const slack = c.tune.spikeSlackPx / (alongY ? c.screen.px.y : c.screen.px.x)
  // (written so that a NaN bound fails it)
  return lo >= Math.min(endA, endB) - slack && hi <= Math.max(endA, endB) + slack
}

function evalAt(c: Core, t: number): void {
  c.counter.points++
  c.fns.point(t, c.pt)
}

function isFinite2(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
}

// An enclosure with all four bounds finite: nothing in it blows up.
function isBounded(b: Box): boolean {
  return Number.isFinite(b.xLo) && Number.isFinite(b.xHi) && Number.isFinite(b.yLo) && Number.isFinite(b.yHi)
}

function pxDistance(c: Core, xa: number, ya: number, xb: number, yb: number): number {
  const dx = (xb - xa) * c.screen.px.x
  const dy = (yb - ya) * c.screen.px.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Empty, or not meeting the clip box. (A NaN bound fails every comparison, so it culls nothing.)
function offScreen(b: Box, clip: Bounds): boolean {
  return b.xLo > b.xHi || b.yLo > b.yHi || b.xHi < clip.xMin || b.xLo > clip.xMax || b.yHi < clip.yMin || b.yLo > clip.yMax
}
