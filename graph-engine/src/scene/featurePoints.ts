import type { FeatureKind } from '../parser/config'
import { DEFAULT_SAMPLES, SECOND_DERIV_H, derivative, findRoots, secondDerivative } from './roots'
import type { Vec2 } from './types'

// A detected feature, carrying which kind it is so the renderer can mark an
// intercept differently from a maximum, and whether its position is exact
// (analytic or converged) rather than a sampled approximation.
export interface FeaturePoint {
  position: Vec2
  kind: FeatureKind
  exact: boolean
}

// Below this, a stationary point's second derivative is too small — relative
// to the function's own scale at that point — to call it a maximum or a
// minimum; it is a saddle or a higher-order flat spot, and claiming either
// would be a guess. This is applied as CURVATURE_EPSILON * scale, not as a
// bare number, mirroring how ROOT_TOLERANCE in roots.ts is applied relative
// to a bracket's own magnitude rather than as an absolute threshold: a
// stationary point of a small-magnitude function (e.g. y = (x^2 - 2x) / 1e6,
// whose curvature is proportionally as small as its own values) has a
// curvature that would never clear a bare 1e-6 and would be misreported as
// neither a maximum nor a minimum, even though the shape is unambiguous.
// CURVATURE_SCALE_FLOOR keeps the check from collapsing to "accept
// everything" when the extremum's value lands exactly on zero (e.g. x^4 at
// its flat stationary point at the origin, where |f(x)| = 0). It only needs
// to be small enough that it does not itself become a second absolute
// threshold for genuinely small-but-nonzero function values — a floor of 1
// would do exactly that, since it forces the same 1e-6 bar for every
// function whose value at the extremum is under 1.
const CURVATURE_EPSILON = 1e-6
const CURVATURE_SCALE_FLOOR = 1e-9

// An inflection candidate cannot be validated the way an extremum above is.
// At a genuine inflection f'' is zero by definition, so "is |f''| large
// enough *here*" would reject every real one. What has to be established
// instead is that the sign change in f'' is genuinely *resolvable* — that
// f'' is meaningfully nonzero on both sides of the candidate — rather than
// the central second difference (f(x+h) - 2f(x) + f(x-h)) / h^2 being pure
// floating-point cancellation. On a straight line the true f'' is zero
// everywhere, so that quotient is noise of order eps * |f| / h^2, and with
// h = 1e-3 it flips sign at nearly every sample: unguarded, "y = 2x + 1"
// over +-10 came back wearing ~800 inflection markers.
//
// So the candidate is probed one root-scan sample step out on each side —
// DEFAULT_SAMPLES is the finest spacing findRoots itself can resolve, so
// probing any closer would ask a question the scan could not have answered —
// and both readings must disagree in sign and clear the second difference's
// cancellation noise floor, eps * scale / h^2, where scale is the largest of
// the three f values the difference actually cancels.
//
// INFLECTION_NOISE_FACTOR is that floor's safety margin. The naive bound is
// about 4 (four rounded terms), but the cancellation inside f is not bounded
// by |f| itself: y = 1e6x + 1e6 near x = -1 cancels against ~1e6 while |f|
// is only ~1e4, so its noise reads far larger than |f| alone predicts. The
// margin is therefore set from measurement rather than from the bound.
// Across a sweep of straight lines (slopes 1e-12..1e15, offsets to 1e12,
// several ranges) the worst noise reading was ~3e2 * eps * scale / h^2,
// while the weakest genuine inflection probed (x*e^-x, sin, tanh, x^3/5e6,
// exp(-x^2), x^5) read at least 3e7. 1e5 sits in the middle of that
// five-decade gap, so the exact value is not delicate. What it does cost is
// a function whose curvature is below roughly 2e-5 of its own magnitude,
// e.g. y = 1e6 + 1e-9x^2 — but that curvature is not resolvable in double
// precision at this step size in the first place, and reporting nothing is
// the honest answer rather than reporting hundreds of invented points.
const INFLECTION_NOISE_FACTOR = 1e5

export function explicitFeatures(
  f: (x: number) => number,
  lo: number,
  hi: number,
  wanted: Set<FeatureKind>
): FeaturePoint[] {
  if (wanted.size === 0) return []
  const out: FeaturePoint[] = []

  if (wanted.has('x-intercept')) {
    for (const x of findRoots(f, lo, hi)) {
      out.push({ position: { x, y: 0 }, kind: 'x-intercept', exact: true })
    }
  }

  if (wanted.has('y-intercept') && lo <= 0 && 0 <= hi) {
    try {
      const y = f(0)
      if (Number.isFinite(y)) out.push({ position: { x: 0, y }, kind: 'y-intercept', exact: true })
    } catch {
      // undefined at zero — no y-intercept to report
    }
  }

  if (wanted.has('local-max') || wanted.has('local-min')) {
    // An extremum is a root of f', and its kind is the sign of f'' there.
    // Nothing about this depends on how densely the curve was sampled for
    // drawing, which is the whole point.
    for (const x of findRoots((t) => derivative(f, t), lo, hi)) {
      const curvature = secondDerivative(f, x)
      const y = f(x)
      if (!Number.isFinite(y)) continue
      const scale = Math.max(Math.abs(y), CURVATURE_SCALE_FLOOR)
      if (Math.abs(curvature) < CURVATURE_EPSILON * scale) continue
      const kind: FeatureKind = curvature > 0 ? 'local-min' : 'local-max'
      if (!wanted.has(kind)) continue
      out.push({ position: { x, y }, kind, exact: true })
    }
  }

  if (wanted.has('inflection')) {
    const probe = (hi - lo) / DEFAULT_SAMPLES
    for (const x of findRoots((t) => secondDerivative(f, t), lo, hi)) {
      const y = f(x)
      if (!Number.isFinite(y)) continue
      if (!resolvableInflection(f, x, probe)) continue
      out.push({ position: { x, y }, kind: 'inflection', exact: true })
    }
  }

  return out
}

// Whether f'' actually changes sign across [x - probe, x + probe] by more
// than the second difference's own cancellation noise — see
// INFLECTION_NOISE_FACTOR above for why a candidate needs this and why it
// cannot simply be "is |f''| large here".
function resolvableInflection(f: (x: number) => number, x: number, probe: number): boolean {
  const before = curvatureReading(f, x - probe)
  const after = curvatureReading(f, x + probe)
  if (before === null || after === null) return false
  // Noise flips sign at random, so agreeing signs a full sample step apart
  // means the crossing in between was not a real one.
  if (before.value < 0 === after.value < 0) return false
  // Strictly greater, so a function whose second difference is exactly zero
  // (a line, a constant, the flat arms of abs(x)) never qualifies even when
  // the noise floor is itself zero.
  return Math.abs(before.value) > before.floor && Math.abs(after.value) > after.floor
}

// f'' at t, paired with how large a reading there has to be to mean anything.
function curvatureReading(f: (x: number) => number, t: number): { value: number; floor: number } | null {
  try {
    const value = secondDerivative(f, t)
    // The same three evaluations the second difference cancels; their
    // magnitude, not the quotient's, is what sets the rounding error.
    const a = f(t - SECOND_DERIV_H)
    const b = f(t)
    const c = f(t + SECOND_DERIV_H)
    if (!Number.isFinite(value) || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
    return { value, floor: (INFLECTION_NOISE_FACTOR * Number.EPSILON * scale) / (SECOND_DERIV_H * SECOND_DERIV_H) }
  } catch {
    // Undefined anywhere in the probe — nothing to establish the sign change
    // with, so the candidate stays unconfirmed.
    return null
  }
}

// Two curves meeting at the same place, found from different pairs, are one
// intersection as far as a reader is concerned.
const SAME_POINT_EPSILON = 1e-5

// Every crossing between every pair of the given curves. An intersection of
// f and g is a root of f - g, so this reuses the same solver as everything
// else rather than introducing a second notion of "where does this happen".
export function intersectionFeatures(
  fs: ((x: number) => number)[],
  lo: number,
  hi: number
): FeaturePoint[] {
  const out: FeaturePoint[] = []
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const f = fs[i]
      const g = fs[j]
      for (const x of findRoots((t) => f(t) - g(t), lo, hi)) {
        const y = f(x)
        if (!Number.isFinite(y)) continue
        if (out.some((p) => Math.hypot(p.position.x - x, p.position.y - y) < SAME_POINT_EPSILON)) continue
        out.push({ position: { x, y }, kind: 'intersection', exact: true })
      }
    }
  }
  out.sort((a, b) => a.position.x - b.position.x)
  return out
}
