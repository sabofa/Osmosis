import type { FeatureKind } from '../parser/config'
import { derivative, findRoots, secondDerivative } from './roots'
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
    for (const x of findRoots((t) => secondDerivative(f, t), lo, hi)) {
      const y = f(x)
      if (Number.isFinite(y)) out.push({ position: { x, y }, kind: 'inflection', exact: true })
    }
  }

  return out
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
