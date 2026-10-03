// One-sided limits (calc P2; spec "Singularities from the expression's structure"):
// what a located trouble spot is, read from the curve's values just to the left and
// right of it. The zero locator says WHERE a generator vanishes; this says what the
// curve does there, so the sampler can break at a pole, break and mark a jump, put an
// open mark on a hole and end a curve at an edge. Pure and deterministic.
//
// THE RULE
//
// Offsets: h_k = h0 / shrink^k for k = 0 … steps, stopped early once
// h_k < minRel * max(1, |tc|): below that, cancellation noise (in (x^2 - 1)/(x - 1),
// say) climbs towards a tenth of a pixel and reads as structure. h0 is the parameter
// step worth 4 px.
//
// A side's samples are P_k = point(tc + side * h_k), compared in screen px (x * px.x,
// y * px.y). The side is
//  - undefined: the last `undefinedRun` samples are all NaN in either coordinate;
//  - converge, when either test passes (the tests look at the finite samples):
//      window: the last `window` finite samples lie within `convergePx` of each other,
//        so a shrinking oscillation like x sin(1/x) converges. The limit is the last
//        sample;
//      geometric: the last 3 successive differences shrink, each at most `convergeRatio`
//        times the one before, and the tail estimate d r / (1 - r) (d the last
//        difference, r its ratio to the one before) is under `convergePx`. The limit is
//        the last sample plus that tail along the last difference;
//      and then CONFIRMED, or the side is unknown: two more samples, off the lattice of
//        offsets, at each of `confirmFactors` times the offset of the last finite sample,
//        must BOTH lie within (the distance of the previous finite sample from the limit)
//        + `convergePx` of the limit. Without them sin(pi/x), periodic in 1/x, reads as a
//        hole at 0: every offset lands on a whole number of periods; and with only one,
//        cos(pi/x) (a maximum on the lattice) still does on some views;
//      A tail that converges and is refuted by those samples ends the search: unknown;
//  - diverge: over the last `divergeRun` steps the screen distance from the first
//    sample grows monotonically, each step's growth at least `divergeRatio` times the
//    previous, and STEADILY: the largest ratio of one step's growth to the one before
//    is at most `divergeSpread` times the smallest. That catches ln(x) (constant steps)
//    as well as 1/x (growing ones), and not cancellation noise that jumps. The sign is
//    the sign of the last y minus the first. Noise can also be steady (a rounding error
//    of a few ulps at every offset, over x^2, is exactly c/x^2), so a divergence is
//    given up if a shorter tail (the retry below, up to `noiseDrop` samples dropped)
//    converges and confirms: the side is unknown;
//  - otherwise the convergence tests are retried on the sequence with its last 1, then
//    2, … up to `noiseDrop` finite samples dropped, and the first that converges (limit
//    confirmed as above) wins. Cancellation noise (x - sin x over x^3: eps/h^2, which
//    the minRel floor does not cover) lives at the smallest offsets, and what converged
//    before it is a limit. A retried tail that the off-lattice sample refutes moves on
//    to the next drop;
//  - unknown: otherwise. A sample that overflows to an infinity is not finite and is
//    not NaN, so a side that overflows is unknown, never misread.
//
// classify: L = oneSided(-1), R = oneSided(+1), v = point(tc). The point is defined
// when both coordinates are finite; "equal" means within `convergePx` on screen, except
// that when either side's limit came from a retried tail, two limits (and a limit and
// the point's value) are equal within `retriedEqualFactor` times that: each such limit
// carries noise of about convergePx.
//  - both diverge → pole;
//  - one undefined, the other converges → edge, with that limit;
//  - one undefined, the other diverges → edge, limit null;
//  - both converge, not equal → jump (value: v when defined, else null);
//  - both converge, equal, v undefined → hole (value null);
//  - both converge, equal, v defined but not equal → hole, value v;
//  - both converge, equal, v equal → regular;
//  - anything else → unknown (an honest "cannot tell": x^0.1 and sin(1/x) at 0).
//
// A hole's limit is the middle of the two sides' limits. Both sides sample the same
// offsets, so their first-order errors are opposite and cancel in the middle: for
// y = f(x) the limit's x comes out as tc to rounding, not tc off by the last offset.
// A limit read from a retried tail is the last sample that tail kept, and carries the
// noise that is still under convergePx: it is right to about convergePx on screen,
// not to the digits (the brief's clean cases are, because their samples are).
import type { Vec2 } from '../../scene/types'
import { LIMITS } from './tuning'
import type { EvalCounter, PointFn, PxScale } from './types'

export type Side =
  | { kind: 'undefined' }
  | { kind: 'converge'; at: Vec2 }
  | { kind: 'diverge'; sign: 1 | -1 }
  | { kind: 'unknown' }

export type Classification =
  | { kind: 'regular' }
  | { kind: 'pole' }
  | { kind: 'jump'; left: Vec2; right: Vec2; value: Vec2 | null }
  | { kind: 'hole'; limit: Vec2; value: Vec2 | null } // value: the point's own value when defined and different
  | { kind: 'edge'; defined: 'left' | 'right'; limit: Vec2 | null } // limit null when the defined side diverges
  | { kind: 'unknown' }

const UNKNOWN: Side = { kind: 'unknown' }

// Scratch, allocated once: the call's PointFn output and the samples of the side
// being read (world coordinates, so a limit is not scaled and unscaled), with the
// indices of the finite ones. A side is read to the end before the next starts.
const out = new Float64Array(2)
const CAPACITY = LIMITS.steps + 1
const wx = new Float64Array(CAPACITY)
const wy = new Float64Array(CAPACITY)
const finite = new Int32Array(CAPACITY)

// hypot, not sqrt(a * a + b * b): the square of a distance past 1e154 px is Infinity,
// and 1/x^30 at the last offsets is 1e247 px out. A pole is still a pole there.
function screenDist(dx: number, dy: number, px: PxScale): number {
  return Math.hypot(dx * px.x, dy * px.y)
}

// The screen distance between samples i and j.
function between(i: number, j: number, px: PxScale): number {
  return screenDist(wx[i] - wx[j], wy[i] - wy[j], px)
}

// The last `window` finite samples within convergePx of each other.
function windowConverges(nf: number, px: PxScale): boolean {
  if (nf < LIMITS.window) return false
  for (let a = nf - LIMITS.window; a < nf; a++) {
    for (let b = a + 1; b < nf; b++) {
      if (!(between(finite[a], finite[b], px) <= LIMITS.convergePx)) return false
    }
  }
  return true
}

// The last 3 differences shrinking geometrically with a tail under convergePx: the
// limit past the last sample, or null.
function geometricLimit(nf: number, px: PxScale): Vec2 | null {
  if (nf < 4) return null
  const a = finite[nf - 4]
  const b = finite[nf - 3]
  const c = finite[nf - 2]
  const e = finite[nf - 1]
  const d1 = between(b, a, px)
  const d2 = between(c, b, px)
  const d3 = between(e, c, px)
  if (!(d2 <= LIMITS.convergeRatio * d1) || !(d3 <= LIMITS.convergeRatio * d2)) return null
  // d2 is 0 only when d3 is: a flat tail, the window's case, the limit is the sample.
  const r = d2 > 0 ? d3 / d2 : 0
  // The sum of the differences still to come, in units of the last: r + r^2 + … = r / (1 - r).
  const f = r / (1 - r)
  if (!(d3 * f < LIMITS.convergePx)) return null
  return { x: wx[e] + (wx[e] - wx[c]) * f, y: wy[e] + (wy[e] - wy[c]) * f }
}

// The sign of the divergence if the last divergeRun steps grow monotonically and
// steadily, or 0. Steadily: the ratios of one step's growth to the one before stay
// within a factor of divergeSpread of each other. A pole's are all alike (4 for 1/x,
// 16 for 1/x^2, 1 for ln); cancellation noise that blows up at the last offsets has
// ratios that jump (x - sin x, over x^3: 18, 4.4, 80, 1.2).
function divergence(nf: number, px: PxScale): 1 | -1 | 0 {
  const run = LIMITS.divergeRun
  if (nf < run + 1) return 0
  const first = finite[nf - run - 1]
  let prevDist = 0
  let prevGrowth = 0
  let lowest = Infinity
  let highest = 0
  for (let j = nf - run; j < nf; j++) {
    const dist = between(finite[j], first, px)
    const growth = dist - prevDist
    if (!(growth > 0)) return 0
    if (prevGrowth > 0) {
      const ratio = growth / prevGrowth
      // A ratio that is not finite is not steady (and one of 0 is under divergeRatio).
      if (!(ratio >= LIMITS.divergeRatio) || !Number.isFinite(ratio)) return 0
      lowest = Math.min(lowest, ratio)
      highest = Math.max(highest, ratio)
    }
    prevDist = dist
    prevGrowth = growth
  }
  if (!(highest <= LIMITS.divergeSpread * lowest)) return 0
  const last = finite[nf - 1]
  const dy = wy[last] - wy[first]
  // A curve that runs off along x with y fixed has no y to sign it with.
  if (dy !== 0) return dy > 0 ? 1 : -1
  return wx[last] - wx[first] > 0 ? 1 : -1
}

// The offsets are a lattice: every sample sits at 1/h = shrink^k / h0. A function
// periodic in 1/x whose period divides that, sin(pi/x) at h0 = 0.1 from k = 2 on,
// reads the same at every sample, and the lattice alone would call its limit at 0 a
// hole. So a side that looks convergent takes two samples more, off the lattice, at
// h * each of confirmFactors (h the offset of the last finite sample), and both must
// agree: each has to lie within the distance the previous sample was from the limit,
// plus convergePx, of the limit. A real limit has those samples between the last two
// and passes; an aliased one lands elsewhere on its period, and the side is unknown. A
// function at a maximum on the lattice (cos(pi/x)) passes one sample one time in sixty,
// which on a dozen round views is enough to be wrong; passing two is not. The second
// is not evaluated if the first refuses.
function confirmed(point: PointFn, tc: number, side: -1 | 1, h0: number, nf: number, limit: Vec2, px: PxScale, counter: EvalCounter): boolean {
  // A sample's index is its k: the offsets run without gaps from k = 0.
  const lastOffset = h0 / LIMITS.shrink ** finite[nf - 1]
  const prev = finite[nf - 2]
  const reach = screenDist(wx[prev] - limit.x, wy[prev] - limit.y, px) + LIMITS.convergePx
  for (const factor of LIMITS.confirmFactors) {
    point(tc + side * lastOffset * factor, out)
    counter.points++
    if (!(Number.isFinite(out[0]) && Number.isFinite(out[1]))) return false
    if (!(screenDist(out[0] - limit.x, out[1] - limit.y, px) <= reach)) return false
  }
  return true
}

// The convergence of the first `nf` finite samples (window or geometric, then the
// off-lattice sample): their limit; null if they do not converge; false if they do and
// the off-lattice sample disagrees. Fewer than 4 samples converge to nothing; either
// test needs 4, so `confirmed` has a last and a previous one.
function convergence(point: PointFn, tc: number, side: -1 | 1, h0: number, nf: number, px: PxScale, counter: EvalCounter): Vec2 | null | false {
  const limit = windowConverges(nf, px) ? { x: wx[finite[nf - 1]], y: wy[finite[nf - 1]] } : geometricLimit(nf, px)
  if (!limit) return null
  return confirmed(point, tc, side, h0, nf, limit, px, counter) ? limit : false
}

// A side, and whether its limit was read from a tail with samples dropped (noise-
// limited, so two of them can be nearly twice convergePx apart). Kept apart from Side so
// that Side is the shape the sampler consumes.
interface Read {
  side: Side
  retried: boolean
}
const UNREAD: Read = { side: UNKNOWN, retried: false }

// What the curve does on one side of tc, from h0 (the parameter step worth 4 px)
// inwards. Every evaluation is counted in counter.points.
export function oneSided(point: PointFn, tc: number, side: -1 | 1, h0: number, px: PxScale, counter: EvalCounter): Side {
  return read(point, tc, side, h0, px, counter).side
}

function read(point: PointFn, tc: number, side: -1 | 1, h0: number, px: PxScale, counter: EvalCounter): Read {
  if (!(h0 > 0) || !Number.isFinite(h0) || !(px.x > 0) || !(px.y > 0)) return UNREAD
  const stop = LIMITS.minRel * Math.max(1, Math.abs(tc))
  let n = 0
  let nf = 0
  for (let k = 0; k <= LIMITS.steps; k++) {
    const h = h0 / LIMITS.shrink ** k
    if (h < stop) break
    point(tc + side * h, out)
    counter.points++
    wx[n] = out[0]
    wy[n] = out[1]
    if (Number.isFinite(out[0]) && Number.isFinite(out[1])) finite[nf++] = n
    n++
  }
  if (n >= LIMITS.undefinedRun) {
    let allNaN = true
    for (let i = n - LIMITS.undefinedRun; i < n; i++) if (!(Number.isNaN(wx[i]) || Number.isNaN(wy[i]))) allNaN = false
    if (allNaN) return { side: { kind: 'undefined' }, retried: false }
  }
  // A whole sequence whose tail converges and is then refuted by the off-lattice samples
  // is aliasing, not noise: a tight tail has nothing in it to drop. It ends the search,
  // or the retries below would shop for confirming samples that happen to agree (they
  // did: cos(pi/x), whose lattice value is a maximum, passes a given off-lattice sample
  // one time in sixty).
  const whole = convergence(point, tc, side, h0, nf, px, counter)
  if (whole) return { side: { kind: 'converge', at: whole }, retried: false }
  if (whole === false) return UNREAD
  const sign = divergence(nf, px)
  if (sign !== 0) {
    // Steady is not enough to be a pole. On the lattice the numerator's rounding error
    // of x - ln(1 + x), over x^2, is the same few ulps at every offset: exactly c/x^2,
    // ratios 14.6, 16, 16, 16. What it does not do is diverge all the way in: a shorter
    // tail converged. A real pole's never does, so if one does, and its samples confirm,
    // the divergence is noise and the side is unknown. (A pole too weak to show in the
    // view, 1e-6/x at 0.4 px, has such a tail too: unknown, the cost of the check.)
    for (let drop = 1; drop <= LIMITS.noiseDrop; drop++) {
      if (convergence(point, tc, side, h0, nf - drop, px, counter)) return UNREAD
    }
    return { side: { kind: 'diverge', sign }, retried: false }
  }
  // Neither on the whole sequence, and no tight tail. Cancellation noise lives at the
  // smallest offsets, so the convergence may be in the sequence without its last few
  // samples: look for it there, one more dropped each time, and take the first that
  // holds. A refusal here is noise in a confirming sample, and moves on.
  for (let drop = 1; drop <= LIMITS.noiseDrop; drop++) {
    const kept = convergence(point, tc, side, h0, nf - drop, px, counter)
    if (kept) return { side: { kind: 'converge', at: kept }, retried: true }
  }
  return UNREAD
}

// What the point at tc is, from both sides and its own value.
export function classify(point: PointFn, tc: number, h0: number, px: PxScale, counter: EvalCounter): Classification {
  const l = read(point, tc, -1, h0, px, counter)
  const r = read(point, tc, 1, h0, px, counter)
  const left = l.side
  const right = r.side
  point(tc, out)
  counter.points++
  const value: Vec2 | null = Number.isFinite(out[0]) && Number.isFinite(out[1]) ? { x: out[0], y: out[1] } : null
  // Limits, and a limit against the point's own value, are compared more loosely when
  // either side's limit came from a retried tail: each carries noise, up to a little
  // over convergePx (0.068 px, (tan(x) - x)/x^3 at 2500 px), so two of them differ by
  // nearly twice that and a limit differs from the true value by that.
  const equalPx = (l.retried || r.retried ? LIMITS.retriedEqualFactor : 1) * LIMITS.convergePx
  const same = (a: Vec2, b: Vec2) => screenDist(a.x - b.x, a.y - b.y, px) <= equalPx

  if (left.kind === 'diverge' && right.kind === 'diverge') return { kind: 'pole' }
  if (left.kind === 'undefined' || right.kind === 'undefined') {
    // The side that is there; when neither is (both undefined, or the other unknown)
    // there is nothing to end a curve at.
    const defined = left.kind === 'undefined' ? 'right' : 'left'
    const other = left.kind === 'undefined' ? right : left
    if (other.kind === 'converge') return { kind: 'edge', defined, limit: other.at }
    if (other.kind === 'diverge') return { kind: 'edge', defined, limit: null }
    return { kind: 'unknown' }
  }
  if (left.kind === 'converge' && right.kind === 'converge') {
    if (!same(left.at, right.at)) return { kind: 'jump', left: left.at, right: right.at, value }
    const limit = { x: (left.at.x + right.at.x) / 2, y: (left.at.y + right.at.y) / 2 }
    if (value === null) return { kind: 'hole', limit, value: null }
    return same(value, limit) ? { kind: 'regular' } : { kind: 'hole', limit, value }
  }
  return { kind: 'unknown' }
}
