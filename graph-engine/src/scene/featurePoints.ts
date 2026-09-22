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

// Below this, a stationary point's second derivative is too close to zero to
// call it a maximum or a minimum — it is a saddle or a higher-order flat spot,
// and claiming either would be a guess.
const CURVATURE_EPSILON = 1e-6

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
      if (Math.abs(curvature) < CURVATURE_EPSILON) continue
      const kind: FeatureKind = curvature > 0 ? 'local-min' : 'local-max'
      if (!wanted.has(kind)) continue
      const y = f(x)
      if (Number.isFinite(y)) out.push({ position: { x, y }, kind, exact: true })
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
