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
//  - diverge: over the last `divergeRun` steps the screen distance from the first
//    sample grows monotonically, each step's growth at least `divergeRatio` times the
//    previous. That catches ln(x) (constant steps) as well as 1/x (growing ones). The
//    sign is the sign of the last y minus the first;
//  - unknown: otherwise. A sample that overflows to an infinity is not finite and is
//    not NaN, so a side that overflows is unknown, never misread.
//
// classify: L = oneSided(-1), R = oneSided(+1), v = point(tc). The point is defined
// when both coordinates are finite; "equal" means within `convergePx` on screen.
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

function screenDist(dx: number, dy: number, px: PxScale): number {
  const a = dx * px.x
  const b = dy * px.y
  return Math.sqrt(a * a + b * b)
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

// The sign of the divergence if the last divergeRun steps grow monotonically, or 0.
function divergence(nf: number, px: PxScale): 1 | -1 | 0 {
  const run = LIMITS.divergeRun
  if (nf < run + 1) return 0
  const first = finite[nf - run - 1]
  let prevDist = 0
  let prevGrowth = 0
  for (let j = nf - run; j < nf; j++) {
    const dist = between(finite[j], first, px)
    const growth = dist - prevDist
    if (!(growth > 0)) return 0
    if (prevGrowth > 0 && !(growth >= LIMITS.divergeRatio * prevGrowth)) return 0
    prevDist = dist
    prevGrowth = growth
  }
  const last = finite[nf - 1]
  const dy = wy[last] - wy[first]
  // A curve that runs off along x with y fixed has no y to sign it with.
  if (dy !== 0) return dy > 0 ? 1 : -1
  return wx[last] - wx[first] > 0 ? 1 : -1
}

// What the curve does on one side of tc, from h0 (the parameter step worth 4 px)
// inwards. Every evaluation is counted in counter.points.
export function oneSided(point: PointFn, tc: number, side: -1 | 1, h0: number, px: PxScale, counter: EvalCounter): Side {
  if (!(h0 > 0) || !Number.isFinite(h0) || !(px.x > 0) || !(px.y > 0)) return UNKNOWN
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
    if (allNaN) return { kind: 'undefined' }
  }
  if (windowConverges(nf, px)) return { kind: 'converge', at: { x: wx[finite[nf - 1]], y: wy[finite[nf - 1]] } }
  const geometric = geometricLimit(nf, px)
  if (geometric) return { kind: 'converge', at: geometric }
  const sign = divergence(nf, px)
  if (sign !== 0) return { kind: 'diverge', sign }
  return UNKNOWN
}

// What the point at tc is, from both sides and its own value.
export function classify(point: PointFn, tc: number, h0: number, px: PxScale, counter: EvalCounter): Classification {
  const left = oneSided(point, tc, -1, h0, px, counter)
  const right = oneSided(point, tc, 1, h0, px, counter)
  point(tc, out)
  counter.points++
  const value: Vec2 | null = Number.isFinite(out[0]) && Number.isFinite(out[1]) ? { x: out[0], y: out[1] } : null
  const same = (a: Vec2, b: Vec2) => screenDist(a.x - b.x, a.y - b.y, px) <= LIMITS.convergePx

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
