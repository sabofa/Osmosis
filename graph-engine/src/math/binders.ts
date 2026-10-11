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

// The integrand evaluations every integral has made, ever (a count that only goes up). An integral costs as much as its
// integrand is evaluated, and a caller that spends a budget on evaluations of an expression (the curve sampler,
// plot/sample) reads this before and after one to learn what it cost: y = integral(t = 0 to x, 5000 cos(100t)) is
// thousands of integrand evaluations a point, and a budget that counts points alone does not see it. Reading it does
// not change anything, and neither does the counting: it is the quadrature's own budget, taken after the fact.
let integrandCount = 0
export function integrandEvaluations(): number {
  return integrandCount
}

export function integrateValue(g: (t: number) => number, a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  if (a === b) return 0
  if (a > b) return -integrateValue(g, b, a)
  const budget = quadBudget(INTEGRAL_BUDGET)
  try {
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
  } finally {
    // (a budget that ran out is one past empty)
    integrandCount += Math.min(INTEGRAL_BUDGET, INTEGRAL_BUDGET - budget.left)
  }
}
