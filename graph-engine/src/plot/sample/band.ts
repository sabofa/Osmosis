// Bands (calc P2; spec "Oscillation faster than a pixel"): where a curve turns round more than
// once inside a pixel, a polyline through its samples is an aliased zig-zag that looks different at
// every zoom. What a careful hand plot draws there is the extent the curve sweeps, so the sampler
// draws that: for each pixel-wide column of the oscillation, the least and the greatest value, joined
// into a filled outline.
//
// This file is the two pieces that know nothing of the core. `oscillates` decides whether the samples
// of one column are an oscillation or a steep stretch, and `BandSink` collects the columns the core
// accepts into outlines, as ChainSink collects segments into chains. The core (adaptive.ts) decides
// WHICH columns, with the interval twin, and clamps each column into the twin's enclosure so that a
// band never says more than the enclosure does.
//
// A band is not a mathematical break. The core lifts its chain where a band starts and ends, and
// records nothing: the curve is not interrupted there, it is too dense to be drawn as a line.
import type { Bounds, Chain } from '../../scene/types'

// Whether the finite values, in order, change direction at least `minTurns` times: up then down, or
// down then up, is one turn. Values that are not finite are skipped (a column of sqrt(sin(500x)) is
// defined on half of it), and a stall (equal neighbours) is neither a turn nor the end of a direction,
// so a plateau cannot hide one. One turn is a peak, which a polyline draws well; two or more are what
// a pixel cannot hold.
//
// `largestStepIsAStall` reads the single largest step between neighbours (the first, on a tie) as a
// stall as well. It is for a column the twin could not certify: one jump or pole in it, against the
// slope, is up, a step down, up again, which is two turns that no oscillation made. A discontinuity
// is one step, so without it the column turns once at most; an oscillation is many steps and keeps
// its turns.
export function oscillates(values: Float64Array, count: number, minTurns: number, largestStepIsAStall = false): boolean {
  // the step read as a stall is the one that ends at this sample; -1: none
  const skip = largestStepIsAStall ? largestStep(values, count) : -1
  let turns = 0
  let prev = Number.NaN
  // the last direction that was not a stall: 1 up, -1 down, 0 none yet
  let dir = 0
  for (let i = 0; i < count; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    if (prev === prev) {
      const way = i === skip ? 0 : v > prev ? 1 : v < prev ? -1 : 0
      if (way !== 0) {
        if (dir !== 0 && way !== dir) turns++
        dir = way
      }
    }
    prev = v
  }
  return turns >= minTurns
}

// The largest step between neighbouring finite values (the first, on a tie), as the index of the value
// it ends at; -1 where there is no step, or the values are all the same.
export function largestStep(values: Float64Array, count: number): number {
  let last = Number.NaN
  let largest = 0
  let at = -1
  for (let i = 0; i < count; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    if (last === last && Math.abs(v - last) > largest) {
      largest = Math.abs(v - last)
      at = i
    }
    last = v
  }
  return at
}

// The columns of one band, in order: each is [t0, t1] of the parameter and the extent [lo, hi] on the
// oscillation axis.
interface Run {
  t0: number[]
  t1: number[]
  lo: number[]
  hi: number[]
}

export class BandSink {
  // true for y = f(x): the parameter is x and the oscillation is along y; false for x = f(y)
  private readonly paramIsX: boolean
  // the clip box, as the parameter's range and as the oscillation's
  private readonly tMin: number
  private readonly tMax: number
  private readonly vMin: number
  private readonly vMax: number
  private readonly runs: Run[] = []

  // `axis` is the coordinate the curve oscillates along: y for y = f(x), x for x = f(y). The other is
  // the parameter itself. The clip box is the view widened by the overscan, as the ChainSink's is.
  constructor(axis: 'y' | 'x', clip: Bounds) {
    this.paramIsX = axis === 'y'
    this.tMin = this.paramIsX ? clip.xMin : clip.yMin
    this.tMax = this.paramIsX ? clip.xMax : clip.yMax
    this.vMin = this.paramIsX ? clip.yMin : clip.xMin
    this.vMax = this.paramIsX ? clip.yMax : clip.xMax
  }

  // One pixel column: the curve over [t0, t1] sweeps [lo, hi] on the oscillation axis. A column that
  // starts where the last one ended is the next column of the same band; any other starts a band.
  // The column is cut at the clip box (as the chains are), and one with nothing inside it, with no
  // width or no height, or that is not a number, is not a column: it is not drawn, and the next one
  // starts a band of its own.
  column(t0: number, t1: number, lo: number, hi: number): void {
    if (!(Number.isFinite(t0) && Number.isFinite(t1))) return
    const a = clamp(t0, this.tMin, this.tMax)
    const b = clamp(t1, this.tMin, this.tMax)
    const l = clamp(lo, this.vMin, this.vMax)
    const h = clamp(hi, this.vMin, this.vMax)
    // (written so that a NaN fails it)
    if (!(b > a && h > l)) return
    const last = this.runs[this.runs.length - 1]
    if (last !== undefined && last.t1[last.t1.length - 1] === a) {
      last.t0.push(a)
      last.t1.push(b)
      last.lo.push(l)
      last.hi.push(h)
    } else {
      this.runs.push({ t0: [a], t1: [b], lo: [l], hi: [h] })
    }
  }

  // Each band's outline, in the order the bands were found: one closed chain, along the top (the
  // greatest values) in increasing t and back along the bottom, the parameter at each vertex. It is a
  // staircase, a column being the extent over its whole width and not a point on a line. Reading does
  // not end the band that is open.
  bands(): Chain[][] {
    return this.runs.map((r) => [this.outline(r)])
  }

  private outline(r: Run): Chain {
    const xy: number[] = []
    const param: number[] = []
    const paramIsX = this.paramIsX
    // a vertex the outline already ends with is not repeated: neighbours as high as each other make a straight run
    const add = (t: number, v: number) => {
      const n = param.length
      if (n > 0 && param[n - 1] === t && xy[2 * n - 2 + (paramIsX ? 1 : 0)] === v) return
      param.push(t)
      xy.push(paramIsX ? t : v, paramIsX ? v : t)
    }
    const n = r.t0.length
    for (let k = 0; k < n; k++) {
      add(r.t0[k], r.hi[k])
      add(r.t1[k], r.hi[k])
    }
    for (let k = n - 1; k >= 0; k--) {
      add(r.t1[k], r.lo[k])
      add(r.t0[k], r.lo[k])
    }
    return { xy: Float64Array.from(xy), param: Float64Array.from(param), closed: true }
  }
}

// (a NaN passes through, and fails the comparisons made of it)
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
