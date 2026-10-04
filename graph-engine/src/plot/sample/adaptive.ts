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
//  - An interval the twin does not certify stops being bisected at tuning.uncertifiedFloorPx (the
//    floor for FULL, 1/2 px for COARSE: all that cannot be certified is decided by bisecting to
//    the floor and testing there, which is where a drag's cost goes). Below, "the floor" means that.
//  - An interval the twin said NOTHING about (verdict UNKNOWN: no bounds, so the enclosure culls
//    nothing) whose ends and midpoint are all beyond the same side of the clip box is culled: lifted,
//    not refined (farOff). Most of an integral is off screen, and steep.
//  - Both ends undefined: at the floor lift; else bisect, which finds defined stretches inside.
//  - One end undefined: at the floor, refine the edge (bisect on whether the point is finite,
//    between the defined end and the undefined one), draw to the last defined point, record
//    an `edge` break and lift; else bisect.
//  - Both finite, not certified: if the screen gap is under gapPx and the jump test passes,
//    connect. Otherwise, at the floor, an interval with a gap of a pixel or more is bisected BELOW the floor
//    (floorTest: every sub-interval whose gap is still a pixel, down to CORE.subFloorPx, and each leaf
//    of under a pixel passes the old test): a smooth curve steeper than 16:1 on screen has a gap over a pixel
//    at a 1/16 px interval, and was broken there at every one. Failing that, lift and record a `jump` break
//    (at the leaf that failed; one that failed only at the last level, its gaps still halving by steepShrink,
//    is a smooth curve too steep for the leaves, and is reported to the caller if it is in the visible
//    view: steepInView); above the floor, bisect. The jump test halves the interval `halvings` times,
//    always keeping the half with the larger gap, and each gap must be at most halvingShrink times the one
//    before: a continuous seam halves its gap, a jump keeps it. Both forms need the verdict UNKNOWN or a
//    bounded enclosure: an infinite bound is where a pole may sit. At the floor, an interval that ends at
//    an `anchor` is drawn instead (see the comment there): the anchor is a limit the structure walk has read.
//
// 3. A sample that is not finite is undefined here: an infinity is never certified flat.
//
// 4. BANDS (a curve whose fns have an oscillation axis, and a call that was given a BandSink)
//  - An interval at most BAND.columnPx wide that is still unresolved is tried as a column of a
//    band. That is decided at the two points above that leave an interval unresolved: a certified
//    interval that is not flat (before it is accepted at the floor or bisected), and an interval the
//    twin cannot certify (before anything else is asked of it).
//  - tuning.bandSamples (BAND.samples, fewer at COARSE) values of the oscillation coordinate are taken
//    over the interval, the ends included (they are already known, so they cost nothing) and the
//    others spread evenly but for a jitter (BAND.jitter: equal spacing is resonant with some
//    oscillations and sees no turn in them). If they turn at least BAND.minTurns times (BAND.joinTurns
//    beside a band), the interval is a column: its extent is the least and greatest finite sample,
//    clamped into the twin's enclosure of the interval (a band never says more than the enclosure
//    does), and the chain is lifted. The column stops the refinement: it is the picture. No break is
//    recorded; a band is not a mathematical interruption. At an interval the twin could not certify,
//    the turns are counted with the largest step between samples read as a stall: one jump or pole is
//    one step, and a band over it would hide the break the jump test would have drawn. If the samples
//    either side of that step have no value in common, it is a jump inside the oscillation, and the
//    column is two, a jump break between them.
//  - If they do not turn, a certified interval is drawn as its samples joined (about a fifteenth of a
//    pixel apart at FULL, a seventh at COARSE, and the twin says the curve is continuous), with the
//    samples that a flat chord covers left out, if they are not an alias of something faster; any
//    other is dealt with as before, and a steep monotone stretch is refined to the floor and
//    connected.
//  - Trying a column costs bandSamples - 2 evaluations, so bandColumn spares itself where it can tell:
//    an uncertified interval the twin shows to be a stroke is not tried, and one that is tried and
//    refined is not tried again at the halves it is bisected into. See bandColumn.
import { CONTINUOUS, PARTIAL, UNKNOWN } from '../../math/interval'
import type { Bounds } from '../../scene/types'
import { type BandSink, largestStep, oscillates } from './band'
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
  // Whether a floor interval IN THE VISIBLE VIEW was lifted only because the depth limit was reached while its gaps were
  // still halving: the curve is smooth there and too steep for the leaves to resolve (a jump's gap does not shrink).
  // Decided where the failure is recorded, against screen.view, so a steep stretch in the overscan (which fills any list
  // of places before the curve reaches the view) is never in the way and never announced.
  steepInView: boolean
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
  // the scratch a column's samples are taken into: both coordinates and the parameter of each
  xs: Float64Array
  ys: Float64Array
  ts: Float64Array
  // where the sample i is taken, as a number of spacings along the column (i, jittered: BAND.jitter)
  at: Float64Array
  // The interval last tried as a column and found not to oscillate: the halves it is bisected into
  // are not tried again (the refinement of an interval comes straight after it, depth first)
  notLo: number
  notHi: number
  // where the last column that was a band's ended (NaN: none yet)
  lastEnd: number
}

function bandState(sink: BandSink, axis: 'y' | 'x', samples: number): BandState {
  // the ends stay where they are, each of the others moves by a fraction of a spacing, and the fractions
  // never repeat: the golden ratio's multiples, kept in [-1/4, 1/4) of a spacing by the default spread
  const at = new Float64Array(samples)
  for (let i = 0; i < samples; i++) at[i] = i === 0 || i === samples - 1 ? i : i + (((i * BAND.jitter) % 1) - 0.5) * BAND.jitterSpread
  return { sink, axis, xs: new Float64Array(samples), ys: new Float64Array(samples), ts: new Float64Array(samples), at, notLo: Number.NaN, notHi: Number.NaN, lastEnd: Number.NaN }
}

export function sampleRange(fns: CurveFns, t0: number, t1: number, ends: { left: End; right: End }, screen: Screen, tuning: Tuning, counter: EvalCounter, sink: ChainSink, bands?: BandSink): { capped: boolean; steepInView: boolean } {
  // a singular end is a floor's width inside, whatever the end is
  const nudge = tuning.floorPx / fns.pxPerT
  const a = ends.left.kind === 'singular' ? t0 + nudge : t0
  const b = ends.right.kind === 'singular' ? t1 - nudge : t1
  if (!(b > a)) return { capped: false, steepInView: false }
  const c: Core = {
    fns,
    screen,
    tune: tuning,
    counter,
    sink,
    box: { xLo: 0, xHi: 0, yLo: 0, yHi: 0 },
    pt: new Float64Array(2),
    capped: false,
    steepInView: false,
    anchorLo: ends.left.kind === 'anchor' ? a : Number.NaN,
    anchorHi: ends.right.kind === 'anchor' ? b : Number.NaN,
    bands: bands === undefined || fns.oscillationAxis === null ? undefined : bandState(bands, fns.oscillationAxis, tuning.bandSamples),
  }

  counter.intervals++
  fns.enclose(a, b, c.box)
  if (offScreen(c.box, screen.clip)) return { capped: false, steepInView: false }

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
  return { capped: c.capped, steepInView: c.steepInView }
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
  const midpointHolds = tm > ta && tm < tb
  // At the floor, or too narrow for the doubles to hold a midpoint: bisecting is over.
  const atFloor = widthPx <= c.tune.floorPx || !midpointHolds
  // An interval the twin does not certify stops at uncertifiedFloorPx, which a drag makes coarser than the floor.
  const atUncertifiedFloor = widthPx <= c.tune.uncertifiedFloorPx || !midpointHolds
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
    if (widthPx <= COLUMN_PX && bandColumn(c, ta, tb, xa, ya, xb, yb, true)) return
    if (atFloor) {
      // steepness never breaks a curve
      c.sink.segment(xa, ya, ta, xb, yb, tb)
      return
    }
    bisect(c, ta, tm, tb, xa, ya, xm, ym, xb, yb, continuous)
    return
  }

  if (verdict === UNKNOWN && midpointHolds && farOff(c, tm, xa, ya, xb, yb)) {
    c.sink.lift()
    return
  }

  if (widthPx <= COLUMN_PX && bandColumn(c, ta, tb, xa, ya, xb, yb, false)) return
  const aFinite = isFinite2(xa, ya)
  const bFinite = isFinite2(xb, yb)

  if (!aFinite && !bFinite) {
    if (atUncertifiedFloor) c.sink.lift()
    else bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
    return
  }
  if (aFinite !== bFinite) {
    if (atUncertifiedFloor) refineEdge(c, ta, xa, ya, tb, xb, yb, aFinite)
    else bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
    return
  }

  // Both finite, and the twin cannot say the curve is continuous between them. Closing gaps
  // is the jump test's to show, but not across a stretch the twin could not bound: an
  // enclosure with an infinite bound is where a pole may sit, and three samples that happen to
  // shrink are no certificate against that. (UNKNOWN has no bounds at all, by construction.)
  const bounded = verdict === UNKNOWN || isBounded(c.box)
  const gap = pxDistance(c, xa, ya, xb, yb)
  if (bounded && gap < c.tune.gapPx && gapCloses(c, ta, tb, xa, ya, xb, yb)) {
    c.sink.segment(xa, ya, ta, xb, yb, tb)
    return
  }
  if (atUncertifiedFloor) {
    // THE FLOOR TEST. Where bisecting stops and the gap is over a pixel (a smooth curve steeper than 16:1 on
    // screen has one at a 1/16 px interval, and the old precondition refused every such interval, breaking the
    // curve at each), the interval is bisected further, below the floor: EVERY sub-interval whose gap is still
    // a pixel or more, down to CORE.subFloorPx (a width, 1/1024 px, at both qualities), and then each leaf (a
    // gap under gapPx) must pass the old test, gap under gapPx AND closing. A jump of a pixel or more keeps
    // its sub-interval's gap over a pixel at every level (or, set against the slope, leaves a gap that
    // cancels and then opens when halved), so it is never a leaf that passes: any jump the test bridges is
    // under a pixel. The bound on the enclosure is still asked, as above: an enclosure the twin left
    // unbounded is where a pole may sit. `bad` is where it failed, which is where the jump is; `steep` is
    // whether it failed only at the last level, with the gaps still halving (by steepShrink: a jump
    // that rides a slope halves its gap too, if less): a smooth curve too steep for the leaves, which the
    // caller is told (steepInView, when the interval is in the visible view) because nothing else will say
    // why it is not drawn.
    let bad = ta + (tb - ta) / 2
    let steep = false
    if (bounded && gap >= c.tune.gapPx) {
      const failed = floorTest(c, ta, tb, xa, ya, xb, yb, Number.POSITIVE_INFINITY)
      if (failed === null) {
        c.sink.segment(xa, ya, ta, xb, yb, tb)
        return
      }
      bad = failed.at
      steep = failed.steep
    }
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
    c.sink.addBreak(bad, 'jump')
    // Visible NOW, where the failure is recorded: the chord of the floor interval against the visible view.
    if (steep && !c.steepInView && chordMeets(c.screen.view, xa, ya, xb, yb)) c.steepInView = true
    return
  }
  bisectAtMid(c, ta, tm, tb, xa, ya, xb, yb, continuous)
}

// Where the floor test failed, and whether that was the steepness of a smooth curve (see floorTest).
interface FloorFailure {
  at: number
  steep: boolean
}

// The floor test below the floor (see visit): the interval [ta, tb] with a gap of a pixel or more is halved, down to
// CORE.subFloorPx, and every half is looked at, the one with the smaller gap too (the jump of a curve set against its
// own slope makes its half's gap the smaller). A half whose gap is under gapPx is a leaf and must pass the old test
// (closing over `halvings` halvings); a half at the last level whose gap is still a pixel or more fails, and so does
// a midpoint that is not a point. Returns null when every leaf passed, else the parameter of the middle of the
// interval that did not: where the jump is. Every evaluation is counted; the leaves are under a pixel of the curve's
// climb each, so a floor interval costs what the climb across it costs (the budget is checked again at the next one).
//
// `steep`: the failure was the depth limit with the gaps still halving, a leaf whose gap is at most steepShrink times
// its parent's (`parentGap`). A smooth curve is that, however steep (at a leaf of 1/1024 px its gap halves to within
// rounding), and a jump is not: its gap keeps its size. A jump that rides a slope halves its gap too, but less, to
// (J + a) / (J + 2a) of its parent's for a jump of J px on a slope that climbs a px in the leaf: 0.55 is where a jump
// of J > a / 4.5 stops being called steepness. A leaf that fails the closing test, or a midpoint that is not a
// point, is never steepness.
function floorTest(c: Core, ta: number, tb: number, xa: number, ya: number, xb: number, yb: number, parentGap: number): FloorFailure | null {
  const tm = ta + (tb - ta) / 2
  if (!(tm > ta && tm < tb)) return { at: tm, steep: false }
  const gap = pxDistance(c, xa, ya, xb, yb)
  if (gap < c.tune.gapPx) return gapCloses(c, ta, tb, xa, ya, xb, yb) ? null : { at: tm, steep: false }
  // (the widths are halved from the floor's, so a width is its target to rounding only)
  if ((tb - ta) * c.fns.pxPerT <= CORE.subFloorPx * (1 + 1e-9)) return { at: tm, steep: gap <= c.tune.steepShrink * parentGap }
  evalAt(c, tm)
  const xm = c.pt[0]
  const ym = c.pt[1]
  if (!isFinite2(xm, ym)) return { at: tm, steep: false }
  const left = floorTest(c, ta, tm, xa, ya, xm, ym, gap)
  if (left !== null) return left
  return floorTest(c, tm, tb, xm, ym, xb, yb, gap)
}

// Which sides of the clip box a point is beyond, as bits: 1 left, 2 right, 4 below, 8 above (0: inside, or not finite).
function beyondOf(c: Core, x: number, y: number): number {
  if (!isFinite2(x, y)) return 0
  const { xMin, xMax, yMin, yMax } = c.screen.clip
  return (x < xMin ? 1 : 0) | (x > xMax ? 2 : 0) | (y < yMin ? 4 : 0) | (y > yMax ? 8 : 0)
}

// Whether an interval the twin said NOTHING about (UNKNOWN: no bounds, so nothing culls it) is far off screen: both ends
// and the midpoint beyond the same side of the clip box. Where the twin has an enclosure it culls what is off screen
// (offScreen); where it has none the samples are all there is, and an interval whose three are on the same side out
// is not refined to the floor and tested there: that costs a hundred evaluations a start interval, and the part of an
// integral that is off screen is most of it (40 sin(x) is in a view of +-10 for a sixth of its range, and steep over most
// of the rest). It is a cull and never a connection, and it is no more than the start grid already is, which cannot see a
// feature narrower than its spacing either. The midpoint costs one evaluation, and is not reused (it is taken only
// where the ends already agree).
function farOff(c: Core, tm: number, xa: number, ya: number, xb: number, yb: number): boolean {
  const ends = beyondOf(c, xa, ya) & beyondOf(c, xb, yb)
  if (ends === 0) return false
  evalAt(c, tm)
  return (ends & beyondOf(c, c.pt[0], c.pt[1])) !== 0
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
// tuning.bandSamples - 2 evaluations, all counted, whatever comes of it.
//  - A band's column: the samples turn BAND.minTurns times (BAND.joinTurns when the column starts where
//    a band's last one ended). At an uncertified interval they must turn that often with their largest
//    step read as a stall: a jump or a pole the structure walk did not locate, against the slope, is
//    up, down, up, and a band over it would show a bar where the curve is not, with no break (the
//    jump test has not been asked, and would not have connected it). A jump inside an oscillation, whose
//    two sides have no value in common, splits the column (splitAtJump).
//  - A certified column whose samples do not turn is drawn as the samples, joined (drawSamples). The
//    twin says the curve is continuous across it and the samples are about a fifteenth of a pixel apart
//    (a seventh at COARSE), so what the core would do for it (refine to the floor, a sixteenth of a
//    pixel) is done, for the same evaluations and no twin enclosures: sin(50x) was 18901 enclosures and
//    is 2101. Only if the samples are not an alias of an oscillation (isDrawable). It is not done at an
//    uncertified column, which the twin has not shown to be continuous, and the jump test (the core's)
//    decides.
//  - Otherwise the core goes on as it would have, and the interval is not tried again at the halves it
//    is bisected into, which follow it at once: the question was asked there.
// And an uncertified interval is not tried at all when it is a STROKE: its enclosure on the oscillation
// axis is no taller than the span of its two ends (and BAND.strokeSlackPx), so nothing lies between them
// for a band to show, and it is a steep stretch or a step that the core refines as it always has. That
// is where the test earns its keep: a certified one is drawn from its samples at the same cost, and a
// step is what a staircase is made of (round(5 sin(20x)) is capped at FULL without it, 57526 points
// with it). The ends of a column of an oscillation can sit at its extremes, and then it is taken for a
// stroke and left out of a band; beside a band that once cut sin(363x) into 115 bands, when the test
// applied to certified columns too, and an exemption there was needed. For uncertified ones, sqrt(sin(wx))
// and floor(3 sin(wx)) over w = 300 to 1100, it changes nothing, so there is none.
function bandColumn(c: Core, ta: number, tb: number, xa: number, ya: number, xb: number, yb: number, certified: boolean): boolean {
  const bands = c.bands
  if (bands === undefined) return false
  if (ta >= bands.notLo && tb <= bands.notHi) return false
  const alongY = bands.axis === 'y'
  const enclosureLo = alongY ? c.box.yLo : c.box.xLo
  const enclosureHi = alongY ? c.box.yHi : c.box.xHi
  const beside = ta === bands.lastEnd
  if (!certified && isStroke(c, enclosureLo, enclosureHi, alongY ? ya : xa, alongY ? yb : xb, alongY)) return false

  const { xs, ys, ts } = bands
  const n = ts.length
  xs[0] = xa
  ys[0] = ya
  ts[0] = ta
  xs[n - 1] = xb
  ys[n - 1] = yb
  ts[n - 1] = tb
  for (let i = 1; i < n - 1; i++) {
    ts[i] = ta + ((tb - ta) * bands.at[i]) / (n - 1)
    evalAt(c, ts[i])
    xs[i] = c.pt[0]
    ys[i] = c.pt[1]
  }
  const v = alongY ? ys : xs
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(v[i])) continue
    if (v[i] < lo) lo = v[i]
    if (v[i] > hi) hi = v[i]
  }
  const spanLo = lo
  const spanHi = hi
  // never beyond the twin's enclosure of this interval (a bound that is NaN clamps nothing)
  if (enclosureLo > lo) lo = enclosureLo
  if (enclosureHi < hi) hi = enclosureHi
  // (and if the enclosure does not hold the samples at all, the twin and the scalar disagree about
  // this interval, and neither is trusted with a band or a polyline)
  if (lo <= hi) {
    if (oscillates(v, n, beside ? BAND.joinTurns : BAND.minTurns, !certified)) {
      if (certified || !splitAtJump(c, bands, v, enclosureLo, enclosureHi)) bands.sink.column(ta, tb, lo, hi)
      bands.lastEnd = tb
      c.sink.lift()
      return true
    }
    if (certified && isDrawable(c, bands, enclosureLo, enclosureHi, spanLo, spanHi, alongY, ta, tb)) {
      drawSamples(c, bands)
      return true
    }
  }
  bands.notLo = ta
  bands.notHi = tb
  return false
}

// Whether the enclosure [lo, hi] of an interval on the oscillation axis is within the span of the
// two ends there and BAND.strokeSlackPx (px of that axis). An end that is not finite has no span.
function isStroke(c: Core, lo: number, hi: number, endA: number, endB: number, alongY: boolean): boolean {
  if (!(Number.isFinite(endA) && Number.isFinite(endB))) return false
  const slack = BAND.strokeSlackPx / (alongY ? c.screen.px.y : c.screen.px.x)
  // (written so that a NaN bound fails it)
  return lo >= Math.min(endA, endB) - slack && hi <= Math.max(endA, endB) + slack
}

// A column of an oscillation at an interval the twin could not certify, with a jump in it: the samples
// either side of their largest step have no value in common (a jump against the oscillation's own
// size, which oscillates() has read past as one step), the step is between two neighbouring samples
// (an undefined stretch between them is an edge, which sqrt(sin(500x)) is full of), and the twin does
// not certify the stretch between those two samples (a steep curve between them, a root's edge, is
// CONTINUOUS: a jump or a pole is not). One band column over it is a bar that bridges the jump, with no
// break; instead the column is two, one over the samples before the step and one over those after,
// with a jump break between them, as the core would have left a jump the walk did not find. Returns
// whether it did. (A jump no larger than the oscillation shares values with it, and stays in one
// column.) Each side is held in the twin's enclosure of the whole interval as the column would have
// been; the samples are values the curve takes, so they are inside the enclosure over their own side
// too. Reads c.box over the stretch, which the caller no longer needs.
function splitAtJump(c: Core, bands: BandState, v: Float64Array, enclosureLo: number, enclosureHi: number): boolean {
  const n = v.length
  const to = largestStep(v, n)
  if (to < 1 || !Number.isFinite(v[to - 1])) return false
  const from = to - 1
  let loL = Number.POSITIVE_INFINITY
  let hiL = Number.NEGATIVE_INFINITY
  let loR = Number.POSITIVE_INFINITY
  let hiR = Number.NEGATIVE_INFINITY
  let nL = 0
  let nR = 0
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(v[i])) continue
    if (i <= from) {
      nL++
      if (v[i] < loL) loL = v[i]
      if (v[i] > hiL) hiL = v[i]
    } else {
      nR++
      if (v[i] < loR) loR = v[i]
      if (v[i] > hiR) hiR = v[i]
    }
  }
  // (a side of one sample has no range to be apart from: the first sample of a curve that starts in the
  // column, at the edge of its domain, is not a jump)
  if (nL < 2 || nR < 2 || !(hiL < loR || hiR < loL)) return false
  const { ts } = bands
  c.counter.intervals++
  if (c.fns.enclose(ts[from], ts[to], c.box) === CONTINUOUS) return false
  bands.sink.column(ts[0], ts[from], Math.max(loL, enclosureLo), Math.min(hiL, enclosureHi))
  bands.sink.column(ts[to], ts[n - 1], Math.max(loR, enclosureLo), Math.min(hiR, enclosureHi))
  c.sink.addBreak(ts[from] + (ts[to] - ts[from]) / 2, 'jump')
  return true
}

// The samples of a certified column that did not turn, drawn as a polyline. Samples are dropped where a
// flat chord covers them: from the one kept, the chord runs on to the furthest sample such that every
// sample between is within flatPx of it (at its own parameter, as isFlat measures: the error along the
// chord counts) and the chord is no longer than maxSegPx, the core's two tests of a segment. A segment
// is not shorter than the spacing of the samples, and needs not be: a line, which the core draws in
// chords of maxSegPx, is drawn in them (10x is 241 vertices without bands, was 1801 with every sample,
// and is 241), and a curve in about the segments the core made of it (sin(50x) 9601, 18001, 8250).
// No evaluations.
function drawSamples(c: Core, bands: BandState): void {
  const { xs, ys, ts } = bands
  const n = ts.length
  let a = 0
  while (a < n - 1) {
    let b = a + 1
    while (b + 1 < n && chordHolds(c, bands, a, b + 1)) b++
    c.sink.segment(xs[a], ys[a], ts[a], xs[b], ys[b], ts[b])
    a = b
  }
}

// Whether the chord from sample a to sample b is a segment the core would accept: every sample
// between within flatPx of it, at its own parameter, and no longer than maxSegPx.
function chordHolds(c: Core, bands: BandState, a: number, b: number): boolean {
  const { xs, ys, ts } = bands
  const px = c.screen.px
  const dx = (xs[b] - xs[a]) * px.x
  const dy = (ys[b] - ys[a]) * px.y
  // (written so that a NaN fails it)
  if (!(dx * dx + dy * dy <= c.tune.maxSegPx * c.tune.maxSegPx)) return false
  for (let k = a + 1; k < b; k++) {
    const u = (ts[k] - ts[a]) / (ts[b] - ts[a])
    const ex = (xs[k] - (xs[a] + u * (xs[b] - xs[a]))) * px.x
    const ey = (ys[k] - (ys[a] + u * (ys[b] - ys[a]))) * px.y
    if (!(Math.sqrt(ex * ex + ey * ey) <= c.tune.flatPx)) return false
  }
  return true
}

// Whether the samples of a certified column, joined, are the curve there. Their spacing is about the
// floor's (a fifteenth of a pixel at FULL, a seventh at COARSE: the drag preview is coarser than its
// floor), so a segment is no coarser than what the core accepts at the floor, flat or not, and what is
// asked is that they are not an alias:
//  - all are finite;
//  - the twin's enclosure on the oscillation axis is no taller than spikeFactor times the span the
//    samples cover plus spikeSlackPx (isFlat's spike test: an oscillation that the samples step over is
//    in the enclosure and not in them);
//  - one more sample, at BAND.probeAt of the way along (an irrational fraction, so that it is off any
//    lattice the samples could be resonant with), is within BAND.probePx of the polyline there. Samples that
//    step over an oscillation by a whole number of periods read as a slow wave with an enclosure to
//    match, and the polyline is that wave: with the samples evenly spaced and without this sin(w x)
//    near w = 3770 at 40 px per unit (the 16 samples 1/15 px apart), and 1759 at COARSE (8 samples),
//    were drawn as a line, 5 to 7 % of the frequencies above 1800. Jittering the samples (BAND.jitter)
//    removes the lattice itself, and in sweeps of sin(w x) nothing is left for this to catch; it stays
//    for what a sweep of one function cannot try. It costs one evaluation, and only for a column that
//    passed the rest.
function isDrawable(c: Core, bands: BandState, enclosureLo: number, enclosureHi: number, spanLo: number, spanHi: number, alongY: boolean, ta: number, tb: number): boolean {
  const { xs, ys, ts } = bands
  const n = ts.length
  for (let i = 0; i < n; i++) if (!isFinite2(xs[i], ys[i])) return false
  const px = alongY ? c.screen.px.y : c.screen.px.x
  // (written so that a NaN or an infinity fails it)
  if (!((enclosureHi - enclosureLo) * px <= c.tune.spikeFactor * (spanHi - spanLo) * px + c.tune.spikeSlackPx)) return false
  const at = ta + (tb - ta) * BAND.probeAt
  let i = 0
  while (i < n - 2 && ts[i + 1] < at) i++
  const u = ts[i + 1] > ts[i] ? (at - ts[i]) / (ts[i + 1] - ts[i]) : 0
  evalAt(c, at)
  return pxDistance(c, c.pt[0], c.pt[1], xs[i] + u * (xs[i + 1] - xs[i]), ys[i] + u * (ys[i + 1] - ys[i])) <= BAND.probePx
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

// Whether the chord between two finite points meets a box (slab test; written so that a NaN fails it, which says nothing).
function chordMeets(box: Bounds, xa: number, ya: number, xb: number, yb: number): boolean {
  let lo = 0
  let hi = 1
  const slab = (p: number, d: number, min: number, max: number): boolean => {
    if (d === 0) return p >= min && p <= max
    const t1 = (min - p) / d
    const t2 = (max - p) / d
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
    return lo <= hi
  }
  return slab(xa, xb - xa, box.xMin, box.xMax) && slab(ya, yb - ya, box.yMin, box.yMax)
}

// Empty, or not meeting the clip box. (A NaN bound fails every comparison, so it culls nothing.)
function offScreen(b: Box, clip: Bounds): boolean {
  return b.xLo > b.xHi || b.yLo > b.yHi || b.xHi < clip.xMin || b.xLo > clip.xMax || b.yHi < clip.yMin || b.yLo > clip.yMax
}
