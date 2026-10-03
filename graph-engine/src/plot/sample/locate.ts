// Isolating the zeros of the trouble-spot generators in the sampled range
// (calc P2; spec "Singularities from the expression's structure"). Interval
// branch and bound with the twin: a box whose enclosure excludes zero (lo > 0,
// hi < 0, or empty — valid under any verdict, per the twin's contract) holds no
// zero; the rest bisect to a width of tolRel·max(1, |t|). Adjacent surviving
// leaves form clusters. A narrow cluster is one zero: bisected on the sign of the
// scalar to adjacent doubles when the sign changes across it (odd zeros), else
// its midpoint (even zeros, like x^2). A cluster still wide is a stretch where the
// generator is zero (floor(x) on [0, 1)): both its ends are zeros.
//
// A stretch is reached without bisecting it. A box whose enclosure is the point
// zero holds nothing but zeros (or NaN), so it stops there as a leaf of any
// width: bisecting [0, 1) to a tolerance of 1e-12 would take 2^40 boxes, spend the
// whole budget on the left end of it and report the wrong right end. Its
// neighbours, whose enclosures straddle zero, still bisect to the tolerance, so
// the cluster's ends are as exact as any zero.
import { compileScalar } from '../../math/compile'
import { compileInterval, isEmpty, iv } from '../../math/interval'
import type { MathScope } from '../../math/scope'
import type { Generator, Origin } from './structure'
import { LOCATE } from './tuning'
import type { EvalCounter } from './types'

export interface Zero { t: number; origin: Origin; why: string }
export interface LocateResult { zeros: Zero[]; truncated: boolean }

// How close to 0 an enclosure's bounds are to be the point zero. The twin widens
// every bound outward, an exact 0 by the smallest double (floor(x) - 3 over
// [3.2, 3.4] is [-5e-324, 5e-324], and each operation after adds its own), so an
// exact test misses it. No curve a plot can show has values this small over a box
// as wide as the tolerance.
const ZERO_BAND = 1e-300

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
      const zeroBox = out.lo >= -ZERO_BAND && out.hi <= ZERO_BAND
      if (zeroBox || hi - lo <= LOCATE.tolRel * Math.max(1, Math.abs(mid)) || mid <= lo || mid >= hi) {
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

// Leaves (in order) whose ends touch, as one [lo, hi] each.
function clusters(leaves: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = []
  for (const [lo, hi] of leaves) {
    const last = out[out.length - 1]
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi)
    else out.push([lo, hi])
  }
  return out
}

// The zero inside a narrow cluster [lo, hi]. When g changes sign across it, a
// bisection on the sign closes in on the change to adjacent doubles (or 64 steps);
// a zero the scalar hits exactly is returned as it is found. Otherwise the zero is
// even (or the sign is NaN) and the midpoint is as good as any.
function refine(g: (t: number) => number, lo: number, hi: number, counter: EvalCounter): number {
  let glo = g(lo)
  let ghi = g(hi)
  counter.points += 2
  if (glo === 0) return lo
  if (ghi === 0) return hi
  if (glo * ghi < 0) {
    for (let step = 0; step < 64; step++) {
      const mid = lo + (hi - lo) / 2
      if (mid <= lo || mid >= hi) break
      const gm = g(mid)
      counter.points++
      if (gm === 0) return mid
      if (gm * glo > 0) {
        lo = mid
        glo = gm
      } else if (gm * ghi > 0) {
        hi = mid
        ghi = gm
      } else break // NaN: no side to take
    }
  }
  return lo + (hi - lo) / 2
}

// Sorts the zeros, drops those the range does not hold (outside it, or within 4
// tolerances of an end: the sampler handles the ends itself), joins those within 4
// tolerances of each other (a seam wins; the reasons are kept, joined with "+"),
// and caps the count.
function merge(all: Zero[], t0: number, t1: number, truncated: boolean): LocateResult {
  const tolAt = (t: number) => 4 * LOCATE.tolRel * Math.max(1, Math.abs(t))
  const out: Zero[] = []
  for (const z of [...all].sort((a, b) => a.t - b.t)) {
    if (!(z.t - t0 > tolAt(z.t) && t1 - z.t > tolAt(z.t))) continue
    const last = out[out.length - 1]
    if (last && z.t - last.t <= tolAt(z.t)) {
      if (z.origin === 'seam') last.origin = 'seam'
      if (!last.why.split('+').includes(z.why)) last.why += `+${z.why}`
      continue
    }
    out.push({ ...z })
  }
  if (out.length > LOCATE.maxZeros) {
    out.length = LOCATE.maxZeros
    truncated = true
  }
  return { zeros: out, truncated }
}
