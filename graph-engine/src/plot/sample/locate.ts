// Isolating the zeros of the trouble-spot generators in the sampled range
// (calc P2; spec "Singularities from the expression's structure"), in two phases.
//
// PHASE 1, the twin. Interval branch and bound: a box whose enclosure excludes zero
// (lo > 0, hi < 0, or empty: valid under any verdict, per the twin's contract)
// holds no zero; the rest bisect, down to a COARSE width, a fraction of the range.
// Adjacent surviving boxes form clusters. The twin is only asked to say where zeros
// are not. Asked to pin down a hard zero it fails: near a zero of 1 - cos(x) the
// enclosure cannot exclude zero until the box is 1e-8 away (cos rounds to 1 there),
// and an expanded square like x^2 - 2x + 1 keeps a band round its double root that
// is about sqrt(2 w) wide for boxes of width w (the enclosure repeats x): bisecting
// those to the tolerance takes every evaluation there is, and a search that stopped
// there dropped every zero after it. So the boxes stop at a sub-pixel width, and when
// a budget (one generator's, or the call's) or the cap on clusters ends the search
// anyway, nothing is dropped: every box still waiting becomes a cluster too, and the
// result says the search was cut.
//
// PHASE 2, the scalar. Each cluster is sampled at 16 points, ends included, and
// the samples say what is in it:
//  - exact zeros: a flat spot of them wider than the coarse width is a stretch where
//    the generator is zero (floor(x) on [0, 1)), reported by its two ends, each
//    found by bisecting where g stops being exactly 0; a narrower one is one zero,
//    at its middle (the plateau of exact zeros 1 - cos(x) has around its zero, 1e-8
//    wide, is sub-pixel: one pole, not two);
//  - sign changes between neighbouring samples: each is bisected on the sign to
//    adjacent doubles (odd zeros, poles: tan, 1/x);
//  - neither: an even zero, if any (x^2), found as the minimum of |g| by golden-
//    section search over the two intervals next to the lowest sample, and kept if
//    the twin, asked again about a box of a few tolerances there, still cannot
//    exclude zero (a cluster's ragged edge, where the enclosure is only loose, has
//    no zero: g there is small, not zero). A double zero of a flat function is only
//    as exact as the function is: about the square root of the epsilon for
//    1 - cos(x), and exact for a pure square.
// Phase 2 also says when a cluster is too crowded for 16 samples to count its zeros
// (several boxes wide, with two sign changes or more), and the result is then cut.
//
// A stretch is reached in phase 1 without bisecting it. A box whose enclosure is the
// point zero holds nothing but zeros (or NaN) if the scalar agrees, so then it stops
// as a leaf of any width: bisecting [0, 1) to the coarse width would take a million
// boxes. Its neighbours still bisect, so the stretch's ends are found. The scalar is
// asked (at the box's ends and middle) because the enclosure alone cannot be trusted
// that small: 1/(exp(-700) (x - 0.5)) has an enclosure of 1e-304 everywhere, and a
// pole at 0.5.
import { compileScalar } from '../../math/compile'
import { type CompiledInterval, compileInterval, isEmpty, iv } from '../../math/interval'
import type { ComparisonOp } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Generator, Origin } from './structure'
import { LOCATE } from './tuning'
import type { EvalCounter } from './types'

// `cmp` and `cmpExpr`, together or neither: the comparison this zero is the boundary of, and its
// a - b (the generator's expression), so the side where the comparison holds can be read from
// the sign of a - b either side of t. Present only for a zero that came from exactly ONE
// comparison generator: a zero two generators share has neither.
export interface Zero { t: number; origin: Origin; why: string; cmp?: ComparisonOp; cmpExpr?: Expr }
// `truncated`: the result may be missing zeros, and not by a known amount. A budget
// or a cap ended the search before it was done; or a cluster was too crowded for its
// samples to count (cos(1/x) near 0); or there are more zeros than maxZeros and the
// ones farthest from the centre of the range are left out.
// What is reported is a place where the scalar is exactly 0 or changes sign (a pole
// counts), the two ends of a stretch of zeros, or an even zero (a minimum of |g|)
// at which the twin, asked at the tolerance, cannot exclude zero, or g is 0.
export interface LocateResult { zeros: Zero[]; truncated: boolean }

type Scalar = (t: number) => number
type Cluster = [number, number]

// How close to 0 an enclosure's bounds are to be the point zero. The twin widens
// every bound outward, an exact 0 by the smallest double (floor(x) - 3 over
// [3.2, 3.4] is [-5e-324, 5e-324], and each operation after adds its own), so an
// exact test misses it.
const ZERO_BAND = 1e-300
// The most steps of a bisection (adjacent doubles are reached in fewer) and of a
// golden-section search (a range of 1e6 to 1e-12 takes about 70).
const MAX_BISECTIONS = 64
const MAX_GOLDEN_STEPS = 200

export function locateZeros(gens: readonly Generator[], param: string, scope: MathScope, t0: number, t1: number, counter: EvalCounter): LocateResult {
  const all: Zero[] = []
  let truncated = false
  let spent = 0
  const coarse = (t1 - t0) * LOCATE.coarseRel
  for (const gen of gens) {
    const g: Scalar = compileScalar(gen.expr, [param], scope)
    const gi = compileInterval(gen.expr, [param], scope)
    const budget = Math.min(LOCATE.intervalsPerGenerator, LOCATE.intervalsTotal - spent)
    const found = isolate(g, gi, t0, t1, budget, counter)
    spent += found.spent
    if (found.cut) truncated = true
    // Whether the twin, asked about a box of a few tolerances round t, still cannot
    // exclude zero. Out of budget it is not asked, and the candidate stands only if
    // g is exactly 0 there: a minimum of |g| that is not zero must not become one.
    const probe = iv()
    const confirm = (t: number): boolean => {
      if (spent >= LOCATE.intervalsTotal) {
        counter.points++
        return g(t) === 0
      }
      const h = 4 * LOCATE.tolRel * Math.max(1, Math.abs(t))
      gi(probe, t - h, t + h)
      spent++
      counter.intervals++
      return !(isEmpty(probe) || probe.lo > 0 || probe.hi < 0)
    }
    for (const [lo, hi] of found.clusters) {
      const here = resolve(g, confirm, lo, hi, coarse, counter)
      if (here.unresolved) truncated = true
      for (const t of here.zeros) all.push(gen.cmp ? { t, origin: gen.origin, why: gen.why, cmp: gen.cmp, cmpExpr: gen.expr } : { t, origin: gen.origin, why: gen.why })
    }
  }
  return merge(all, t0, t1, truncated)
}

// Phase 1: the clusters of boxes over [t0, t1] on which the twin cannot exclude a
// zero of g, in order, and whether the search was cut. `budget` is the most twin
// evaluations to spend.
function isolate(g: Scalar, gi: CompiledInterval, t0: number, t1: number, budget: number, counter: EvalCounter) {
  const out = iv()
  const clusters: Cluster[] = []
  const add = (lo: number, hi: number) => {
    const last = clusters[clusters.length - 1]
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi)
    else clusters.push([lo, hi])
  }
  // The coarse width is reached by depth, not by comparing widths: a box halved k times
  // is range / 2^k only up to rounding, which on a window a few ulps wide could leave
  // a box at the coarse width one halving short of it and double the work.
  const depthLimit = Math.ceil(-Math.log2(LOCATE.coarseRel))
  const stack: [number, number, number][] = [[t0, t1, 0]]
  let spent = 0
  let cut = false
  while (stack.length > 0) {
    if (spent >= budget || clusters.length > LOCATE.maxZeros * 8) {
      // What is left was not looked at, and may hold zeros: it is popped left to right
      // (the stack's order), and kept whole.
      cut = true
      while (stack.length > 0) {
        const [lo, hi] = stack.pop()!
        add(lo, hi)
      }
      break
    }
    const [lo, hi, depth] = stack.pop()!
    gi(out, lo, hi)
    spent++
    counter.intervals++
    if (isEmpty(out) || out.lo > 0 || out.hi < 0) continue
    const mid = lo + (hi - lo) / 2
    const small = depth >= depthLimit || hi - lo <= LOCATE.tolRel * Math.max(1, Math.abs(mid)) || mid <= lo || mid >= hi
    if (small || (out.lo >= -ZERO_BAND && out.hi <= ZERO_BAND && zeroAt(g, [lo, mid, hi], counter))) {
      add(lo, hi)
      continue
    }
    stack.push([mid, hi, depth + 1], [lo, mid, depth + 1]) // left first off the stack: clusters come out in order
  }
  return { clusters, cut, spent }
}

// Whether g is exactly 0, or NaN, at every one of `ts`.
function zeroAt(g: Scalar, ts: readonly number[], counter: EvalCounter): boolean {
  counter.points += ts.length
  return ts.every((t) => {
    const y = g(t)
    return y === 0 || y !== y
  })
}

// Phase 2: the zeros of g inside one cluster [lo, hi], and whether the cluster is
// too crowded for its samples to count them. `coarse` is phase 1's width (or the
// tolerance, if that is wider): a flat spot of exact zeros no wider than it is one
// zero, not a stretch.
function resolve(g: Scalar, confirm: (t: number) => boolean, lo: number, hi: number, coarse: number, counter: EvalCounter): { zeros: number[]; unresolved: boolean } {
  const leaf = Math.max(coarse, LOCATE.tolRel * Math.max(1, Math.abs(lo), Math.abs(hi)))
  const n = LOCATE.clusterSamples
  const s: number[] = []
  const v: number[] = []
  for (let i = 0; i < n; i++) {
    s.push(i === 0 ? lo : i === n - 1 ? hi : Math.min(hi, lo + ((hi - lo) * i) / (n - 1)))
    v.push(g(s[i]))
  }
  counter.points += n
  const zeros: number[] = []

  // Exact zeros. A run of them has an edge on each side, unless it reaches the
  // cluster's end (which is the range's end: any box beside the cluster that held a
  // zero would be in it).
  for (let i = 0; i < n; i++) {
    if (v[i] !== 0) continue
    let j = i
    while (j + 1 < n && v[j + 1] === 0) j++
    const left = i === 0 ? s[0] : edge(g, s[i], s[i - 1], counter)
    const right = j === n - 1 ? s[n - 1] : edge(g, s[j], s[j + 1], counter)
    if (right - left > leaf) zeros.push(left, right)
    else zeros.push(left + (right - left) / 2)
    i = j
  }

  // Sign changes between neighbours (a zero sample next to them belongs to its run).
  // crossing[i] says the pair (i, i + 1) is one.
  const crossing: boolean[] = []
  let changes = 0
  for (let i = 0; i + 1 < n; i++) {
    crossing.push(signed(v[i]) && signed(v[i + 1]) && (v[i] < 0) !== (v[i + 1] < 0))
    if (crossing[i]) {
      zeros.push(bisectSign(g, s[i], s[i + 1], v[i], counter))
      changes++
    }
  }
  // Two sign changes or more in a cluster the twin could not take apart over several
  // boxes: zeros crowded closer than the samples, as cos(1/x) near 0 has, and the
  // bisections only count the sign changes the samples happen to see.
  const unresolved = changes >= 2 && hi - lo > LOCATE.unresolvedLeaves * leaf

  // Even zeros, where g touches 0 and turns back. A cluster can hold any number of
  // them next to anything else (the twin's band round an expanded double root is wide,
  // so on a wide range it meets a simple root, or another double one), so every sample
  // that is a local minimum of |g| gets a search, whatever else was found. |g| is
  // searched over the two intervals around the sample by golden section. The twin
  // could not exclude zero over the whole box, which holds when g only comes near
  // zero (the ragged edge of the band, where the enclosure of an expanded square is
  // wide), so a minimum is a zero if the twin cannot exclude one round it either, at
  // the tolerance, where it has no such slack. A minimum next to a sign change is the
  // change itself, already found.
  for (let i = 0; i < n; i++) {
    const m = magnitude(v[i])
    if (!Number.isFinite(m) || m === 0) continue
    if ((i > 0 && !(m < magnitude(v[i - 1]))) || (i < n - 1 && !(m <= magnitude(v[i + 1])))) continue
    if (crossing[i - 1] || crossing[i]) continue
    const t = golden(g, s[Math.max(0, i - 1)], s[Math.min(n - 1, i + 1)], counter)
    if (confirm(t)) zeros.push(t)
  }
  return { zeros, unresolved }
}

// |y|, with NaN as infinitely large: a sample that is not a number is never a minimum.
const magnitude = (y: number) => (y === y ? Math.abs(y) : Infinity)

// A value with a sign to compare: not NaN, not 0.
const signed = (y: number) => y === y && y !== 0

// The change of sign of g between lo and hi, whose values there (`glo` at lo) have
// opposite signs: bisected to adjacent doubles, or 64 steps. A zero the scalar hits
// exactly is returned as found.
function bisectSign(g: Scalar, lo: number, hi: number, glo: number, counter: EvalCounter): number {
  for (let step = 0; step < MAX_BISECTIONS; step++) {
    const mid = lo + (hi - lo) / 2
    if (mid <= lo || mid >= hi) break
    const gm = g(mid)
    counter.points++
    if (gm === 0) return mid
    if (gm !== gm) break // NaN: no side to take
    if ((gm < 0) === (glo < 0)) {
      lo = mid
      glo = gm
    } else hi = mid
  }
  return lo + (hi - lo) / 2
}

// The edge of a stretch where g is exactly 0: g is 0 at `inside` and not at
// `outside`; the point between them where that stops, to adjacent doubles or 64 steps.
function edge(g: Scalar, inside: number, outside: number, counter: EvalCounter): number {
  let a = inside
  let b = outside
  for (let step = 0; step < MAX_BISECTIONS; step++) {
    const mid = a + (b - a) / 2
    if (mid === a || mid === b) break
    counter.points++
    if (g(mid) === 0) a = mid
    else b = mid
  }
  return a + (b - a) / 2
}

const GOLDEN = (Math.sqrt(5) - 1) / 2

// The minimum of |g| over [a, b], which holds one (g is not NaN there, or the NaNs
// count as infinitely high), by golden-section search, to the tolerance. A tie goes
// to the left, so a plateau of exact zeros is closed in on and not stepped over.
function golden(g: Scalar, a: number, b: number, counter: EvalCounter): number {
  const f = (t: number) => {
    const y = Math.abs(g(t))
    counter.points++
    return y === y ? y : Infinity
  }
  let c = b - GOLDEN * (b - a)
  let d = a + GOLDEN * (b - a)
  let fc = f(c)
  let fd = f(d)
  for (let step = 0; step < MAX_GOLDEN_STEPS && b - a > LOCATE.tolRel * Math.max(1, Math.abs(a), Math.abs(b)); step++) {
    if (fc <= fd) {
      b = d
      d = c
      fd = fc
      c = b - GOLDEN * (b - a)
      fc = f(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + GOLDEN * (b - a)
      fd = f(d)
    }
  }
  return a + (b - a) / 2
}

// Sorts the zeros, drops those the range does not hold (outside it, or within 4
// tolerances of an end: the sampler handles the ends itself), joins those within 4
// tolerances of each other (a seam wins; the reasons are kept, joined with "+"),
// and caps the count, keeping the zeros nearest the centre of the range: the
// ends of a range are what a pan brings in next, and the middle is what is on screen.
function merge(all: Zero[], t0: number, t1: number, truncated: boolean): LocateResult {
  const tolAt = (t: number) => 4 * LOCATE.tolRel * Math.max(1, Math.abs(t))
  let out: Zero[] = []
  for (const z of [...all].sort((a, b) => a.t - b.t)) {
    if (!(z.t - t0 > tolAt(z.t) && t1 - z.t > tolAt(z.t))) continue
    const last = out[out.length - 1]
    if (last && z.t - last.t <= tolAt(z.t)) {
      // two generators share the zero: it is no one comparison's (one generator finding it twice,
      // by a sign change and by a minimum, is still one)
      if (last.cmpExpr !== z.cmpExpr) {
        delete last.cmp
        delete last.cmpExpr
      }
      if (z.origin === 'seam') last.origin = 'seam'
      if (!last.why.split('+').includes(z.why)) last.why += `+${z.why}`
      continue
    }
    out.push({ ...z })
  }
  if (out.length > LOCATE.maxZeros) {
    const centre = t0 + (t1 - t0) / 2
    out = out.sort((a, b) => Math.abs(a.t - centre) - Math.abs(b.t - centre) || a.t - b.t).slice(0, LOCATE.maxZeros)
    out.sort((a, b) => a.t - b.t)
    truncated = true
  }
  return { zeros: out, truncated }
}
