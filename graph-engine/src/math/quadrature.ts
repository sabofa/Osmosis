// Adaptive Gauss-Kronrod 7-15 quadrature, nested for iterated integrals (K4).
// Every result carries `error`, an estimate of |value - true value|; a display
// prints only the digits it supports, prefixed "≈". An exact form is never
// inferred from the float.
//
// A panel's error is |K15 - G7|, the error of the 7-point Gauss rule, which
// is a deliberately conservative bound on the 15-point Kronrod value the panel
// reports. The panel with the largest error is split in half until the sum is
// within the target or the panel budget is spent; either way the reported
// error is the honest sum.
//
// Nested integrals (integrate2, integrate3) share ONE evaluation budget across
// every level (QUAD_BUDGET), so no integral runs away: one that diverges is
// refused with a QuadratureError saying where it was refining, and an
// integrand that is not a finite number at a node is refused at that point,
// never summed into "∞". integrate1 is budgeted only when given one.

import {
  QUAD_BUDGET,
  QUAD_INNER_FRACTION,
  QUAD_INNER_MAX_PANELS,
  QUAD_MAX_PANELS,
  QUAD_NARROW_REL,
  QUAD_ROUNDING,
  QUAD_TOL,
  QUAD_UNSETTLED_REL,
} from './tolerance'

export interface QuadResult {
  value: number
  error: number
}

// Why an integral has no value, and where, per level (outer first):
// - 'undefined': the integrand, or a bound, was not a finite number at `at`;
// - 'budget': the evaluations ran out before the error target was met; `at`
//   holds, for each level whose refinement had narrowed to a small panel,
//   where (a limit exactly, when the panel ends there), else null.
export class QuadratureError extends Error {
  readonly reason: 'undefined' | 'budget'
  readonly at: (number | null | undefined)[] = []
  constructor(reason: 'undefined' | 'budget') {
    super(reason === 'undefined' ? 'the integrand is not a finite number at a node' : 'the integral did not settle within its evaluation budget')
    this.name = 'QuadratureError'
    this.reason = reason
  }
}

// Evaluations left, shared by every level of one nested integral.
export interface QuadBudget {
  left: number
}

export function quadBudget(evaluations: number = QUAD_BUDGET): QuadBudget {
  return { left: evaluations }
}

// Kronrod nodes on [-1, 1] (non-negative half, largest first), and the
// Kronrod and Gauss weights (QUADPACK's qk15, each written as the shortest
// decimal of the double nearest QUADPACK's 33-digit value). The Gauss nodes
// are the odd-indexed Kronrod nodes and the centre.
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945,
  0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0,
]
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592,
  0.1690047266392679, 0.19035057806478542, 0.20443294007529889, 0.20948214108472782,
]
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694]

interface Panel {
  a: number
  b: number
  value: number
  error: number
}

// With a budget, f is guarded: each node spends one evaluation, a value that
// is not finite is refused at its node, and a refusal from an inner level
// learns this level's coordinate on its way out.
function guarded(f: (x: number) => number, level: number, budget: QuadBudget): (x: number) => number {
  return (x) => {
    if (--budget.left < 0) throw new QuadratureError('budget')
    let v: number
    try {
      v = f(x)
    } catch (err) {
      if (err instanceof QuadratureError && err.reason === 'undefined' && err.at[level] === undefined) err.at[level] = x
      throw err
    }
    if (!Number.isFinite(v)) {
      const err = new QuadratureError('undefined')
      err.at[level] = x
      throw err
    }
    return v
  }
}

function kronrod(f: (x: number) => number, a: number, b: number): Panel {
  const centre = (a + b) / 2
  const half = (b - a) / 2
  const fc = f(centre)
  let k = WGK[7] * fc
  let g = WG[3] * fc
  for (let i = 0; i < 7; i++) {
    const dx = half * XGK[i]
    const sum = f(centre - dx) + f(centre + dx)
    k += WGK[i] * sum
    // XGK[1], XGK[3], XGK[5] are the Gauss nodes.
    if (i % 2 === 1) g += WG[(i - 1) / 2] * sum
  }
  const value = k * half
  return { a, b, value, error: Math.abs((k - g) * half) }
}

// Where a level was refining when its budget ran out: the panel it was
// splitting, when narrow — a limit exactly when the panel ends there.
function locate(pa: number, pb: number, a: number, b: number): number | null {
  if (Math.abs(pb - pa) > QUAD_NARROW_REL * Math.abs(b - a)) return null
  if (pa === a || pa === b) return pa
  if (pb === a || pb === b) return pb
  return (pa + pb) / 2
}

function adapt(f: (x: number) => number, a: number, b: number, tol: number, maxPanels: number, level = 0, budget?: QuadBudget): QuadResult {
  const at = budget ? guarded(f, level, budget) : f
  let splitting: [number, number] = [a, b]
  try {
    const panels: Panel[] = [kronrod(at, a, b)]
    let error = panels[0].error
    let magnitude = Math.abs(panels[0].value)
    while (error > Math.max(tol, QUAD_ROUNDING * magnitude) && panels.length < maxPanels) {
      let worst = 0
      for (let i = 1; i < panels.length; i++) if (panels[i].error > panels[worst].error) worst = i
      const { a: pa, b: pb } = panels[worst]
      splitting = [pa, pb]
      const mid = (pa + pb) / 2
      const left = kronrod(at, pa, mid)
      const right = kronrod(at, mid, pb)
      panels.splice(worst, 1, left, right)
      error = 0
      magnitude = 0
      for (const panel of panels) {
        error += panel.error
        magnitude += Math.abs(panel.value)
      }
      if (!Number.isFinite(error)) break
    }
    const result = sum(panels)
    if (budget && panels.length >= maxPanels && result.error > Math.max(tol, QUAD_UNSETTLED_REL * Math.abs(result.value))) {
      let worst = 0
      for (let i = 1; i < panels.length; i++) if (panels[i].error > panels[worst].error) worst = i
      splitting = [panels[worst].a, panels[worst].b]
      throw new QuadratureError('budget')
    }
    return result
  } catch (err) {
    if (err instanceof QuadratureError && err.reason === 'budget' && err.at[level] === undefined) err.at[level] = locate(splitting[0], splitting[1], a, b)
    throw err
  }
}

function sum(panels: readonly Panel[]): QuadResult {
  // Panels stay in interval order, so the sum's order is deterministic.
  let value = 0
  let error = 0
  for (const panel of panels) {
    value += panel.value
    error += panel.error
  }
  return { value, error }
}

// The integral of f from a to b, to an absolute error target `tol`. With a
// budget it is refused as a nested integral is; without, an integrand that is
// not finite gives a result that is not finite.
export function integrate1(f: (x: number) => number, a: number, b: number, tol: number = QUAD_TOL, budget?: QuadBudget): QuadResult {
  if (a === b) return { value: 0, error: 0 }
  return adapt(f, a, b, tol, QUAD_MAX_PANELS, 0, budget)
}

// A bound of an inner level at an outer node: refused when it is not finite.
function bound(v: number): number {
  if (!Number.isFinite(v)) throw new QuadratureError('undefined')
  return v
}

// The target an inner integral is held to, so the noise it feeds the outer
// integrand stays below the outer target.
function innerTolerance(tol: number, a: number, b: number): number {
  return (QUAD_INNER_FRACTION * tol) / Math.max(Math.abs(b - a), 1e-300)
}

// The iterated integral of f(x, y) for x from a to b and y from c(x) to d(x).
export function integrate2(
  f: (x: number, y: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  tol: number = QUAD_TOL,
  budget: QuadBudget = quadBudget()
): QuadResult {
  if (a === b) return { value: 0, error: 0 }
  const inner = innerTolerance(tol, a, b)
  let innerError = 0
  const outer = adapt(
    (x) => {
      const lo = bound(c(x))
      const hi = bound(d(x))
      if (lo === hi) return 0
      const r = adapt((y) => f(x, y), lo, hi, inner, QUAD_INNER_MAX_PANELS, 1, budget)
      innerError = Math.max(innerError, r.error)
      return r.value
    },
    a,
    b,
    tol,
    QUAD_MAX_PANELS,
    0,
    budget
  )
  return { value: outer.value, error: outer.error + Math.abs(b - a) * innerError }
}

// The iterated integral of f(x, y, z) for x from a to b, y from c(x) to d(x),
// and z from e(x, y) to g(x, y).
export function integrate3(
  f: (x: number, y: number, z: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  e: (x: number, y: number) => number,
  g: (x: number, y: number) => number,
  tol: number = QUAD_TOL,
  budget: QuadBudget = quadBudget()
): QuadResult {
  if (a === b) return { value: 0, error: 0 }
  const middle = innerTolerance(tol, a, b)
  let middleError = 0
  const outer = adapt(
    (x) => {
      const r = integrate2Inner((y, z) => f(x, y, z), bound(c(x)), bound(d(x)), (y) => e(x, y), (y) => g(x, y), middle, budget)
      middleError = Math.max(middleError, r.error)
      return r.value
    },
    a,
    b,
    tol,
    QUAD_MAX_PANELS,
    0,
    budget
  )
  return { value: outer.value, error: outer.error + Math.abs(b - a) * middleError }
}

// integrate2 with the inner panel budget, for the middle level of integrate3.
function integrate2Inner(
  f: (y: number, z: number) => number,
  c: number,
  d: number,
  e: (y: number) => number,
  g: (y: number) => number,
  tol: number,
  budget: QuadBudget
): QuadResult {
  if (c === d) return { value: 0, error: 0 }
  const inner = innerTolerance(tol, c, d)
  let innerError = 0
  const middle = adapt(
    (y) => {
      const lo = bound(e(y))
      const hi = bound(g(y))
      if (lo === hi) return 0
      const r = adapt((z) => f(y, z), lo, hi, inner, QUAD_INNER_MAX_PANELS, 2, budget)
      innerError = Math.max(innerError, r.error)
      return r.value
    },
    c,
    d,
    tol,
    QUAD_INNER_MAX_PANELS,
    1,
    budget
  )
  return { value: middle.value, error: middle.error + Math.abs(d - c) * innerError }
}

// The 7-point Gauss rule on [-1, 1]: nodes and weights.
const G7_NODES = [-XGK[1], -XGK[3], -XGK[5], 0, XGK[5], XGK[3], XGK[1]]
const G7_WEIGHTS = [WG[0], WG[1], WG[2], WG[3], WG[2], WG[1], WG[0]]

// The 7-point Gauss rule on [a, b]: exact for polynomials of degree 13.
export function gaussLegendre7(f: (x: number) => number, a: number, b: number): number {
  const centre = (a + b) / 2
  const half = (b - a) / 2
  let s = 0
  for (let i = 0; i < 7; i++) s += G7_WEIGHTS[i] * f(centre + half * G7_NODES[i])
  return s * half
}

// A coarse, fixed-cost estimate of an iterated integral: the 7-point Gauss
// rule at every level (49 or 343 evaluations), exact for polynomials of
// degree 13. For scales (an error floor), never for a value shown.
export function coarse2(f: (x: number, y: number) => number, a: number, b: number, c: (x: number) => number, d: (x: number) => number): number {
  return gaussLegendre7((x) => gaussLegendre7((y) => f(x, y), c(x), d(x)), a, b)
}

export function coarse3(
  f: (x: number, y: number, z: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  e: (x: number, y: number) => number,
  g: (x: number, y: number) => number
): number {
  return gaussLegendre7((x) => gaussLegendre7((y) => gaussLegendre7((z) => f(x, y, z), e(x, y), g(x, y)), c(x), d(x)), a, b)
}
