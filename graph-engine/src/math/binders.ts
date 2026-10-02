// The integral behind __integral (calc P1): space's adaptive Gauss–Kronrod
// (math/quadrature.ts), with infinite bounds mapped onto finite ones. A
// divergent or failed integral is NaN — undefined, never a wrong number.

import { integrate1, QuadratureError, quadBudget, type QuadResult } from './quadrature'
import { QUAD_TOL } from './tolerance'

// Evaluations one integral may spend. Every sample of a plotted F(x) is one
// integral, so this is per sample, far below a whole-scene budget.
export const INTEGRAL_BUDGET = 100_000

// An error estimate above this fraction of max(1, |value|) means the
// quadrature never settled.
const UNSETTLED = 1e-6

export function integrateValue(g: (t: number) => number, a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  if (a === b) return 0
  if (a > b) return -integrateValue(g, b, a)
  try {
    const budget = quadBudget(INTEGRAL_BUDGET)
    let result: QuadResult
    if (a === -Infinity && b === Infinity) {
      // t = s / (1 - s²), dt = (1 + s²) / (1 - s²)² ds, s in (-1, 1)
      result = integrate1(
        (s) => {
          const d = 1 - s * s
          return (g(s / d) * (1 + s * s)) / (d * d)
        },
        -1,
        1,
        QUAD_TOL,
        budget
      )
    } else if (b === Infinity) {
      // t = a + s / (1 - s), dt = ds / (1 - s)², s in [0, 1)
      result = integrate1(
        (s) => {
          const d = 1 - s
          return g(a + s / d) / (d * d)
        },
        0,
        1,
        QUAD_TOL,
        budget
      )
    } else if (a === -Infinity) {
      // t = b - s / (1 - s)
      result = integrate1(
        (s) => {
          const d = 1 - s
          return g(b - s / d) / (d * d)
        },
        0,
        1,
        QUAD_TOL,
        budget
      )
    } else {
      result = integrate1(g, a, b, QUAD_TOL, budget)
    }
    if (!Number.isFinite(result.value)) return Number.NaN
    // A settled result's error is within the quadrature's own target; one
    // far outside it never settled (a slowly divergent integrand, ∫ 1/t to
    // infinity) and is undefined, not a number to plot.
    if (!(result.error <= UNSETTLED * Math.max(1, Math.abs(result.value)))) return Number.NaN
    return result.value
  } catch (err) {
    if (err instanceof QuadratureError) return Number.NaN
    throw err
  }
}
