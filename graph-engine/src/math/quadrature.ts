// Adaptive Gauss-Kronrod 7-15 quadrature, nested for iterated integrals (K4).
// Every result carries `error`, an estimate of |value - true value|; a display
// prints only the digits it supports, prefixed "≈". An exact form is never
// inferred from the float.
//
// A panel's error is |K15 - G7|, the error of the 7-point Gauss rule, which
// is a deliberately conservative bound on the 15-point Kronrod value the panel
// reports. The panel with the largest error is split in half until the sum is
// within its target or the panel limit is reached; either way the reported
// error is the honest sum. A level's target is the larger of its absolute
// tolerance, QUAD_REL of its own value, and rounding (QUAD_ROUNDING), so an
// inner level chases digits its value has, never an absolute 1e-12.
//
// Nested integrals (integrate2, integrate3) are guarded, and fail with a
// QuadratureError that says why and where, per level:
// - 'diverges': the integrand (or a bound) is infinite at a node, or a panel
//   has narrowed to rounding width while its value never shrank on the way
//   (1/x at 0: every halving leaves the same value; an integrable 1/sqrt(x)
//   shrinks by sqrt 2 each time and is not divergence);
// - 'undefined': the integrand is not a number (NaN) at a node;
// - 'bound': a bound of an inner level is not a number at an outer node;
// - 'budget': one shared budget of evaluations (QUAD_BUDGET), or a level's
//   panels, ran out first. That is "did not settle", never divergence.
// integrate1 is guarded only when given a budget.

import {
  QUAD_BUDGET,
  QUAD_DIVERGE_KEEP,
  QUAD_DIVERGE_NEAR_REL,
  QUAD_DIVERGE_RUN,
  QUAD_INNER_FRACTION,
  QUAD_INNER_MAX_PANELS,
  QUAD_MAX_PANELS,
  QUAD_NARROW_REL,
  QUAD_REL,
  QUAD_ROUNDING,
  QUAD_ROUNDING_WIDTH,
  QUAD_TOL,
  QUAD_UNSETTLED_REL,
} from './tolerance'

export interface QuadResult {
  value: number
  error: number
}

export type QuadFailure = 'diverges' | 'undefined' | 'bound' | 'budget'

// Why a nested integral has no value, and where: `at[level]` is the
// coordinate of that level (outer first) where it happened, null where the
// level cannot say, undefined where it never learned.
export class QuadratureError extends Error {
  readonly reason: QuadFailure
  readonly at: (number | null | undefined)[] = []
  // 'bound': the level whose range it is, and which end.
  bound: { level: number; side: 'lower' | 'upper' } | null = null
  constructor(reason: QuadFailure) {
    super(`quadrature: ${reason}`)
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

const GOLDEN = (Math.sqrt(5) - 1) / 2

interface Panel {
  a: number
  b: number
  value: number
  error: number
  // Consecutive halvings, down this panel's line, that left the value no
  // smaller: the signature of a singularity that is not integrable.
  run: number
}

// One level of a guarded integral: its index, its range, the shared budget.
interface Level {
  index: number
  a: number
  b: number
  budget: QuadBudget
  // Past its first panels: an infinity now is this level's own.
  refining?: boolean
}

// Where a level diverges, near x: the nearer limit when x is within
// QUAD_DIVERGE_NEAR_REL of the range from it (1/x at 0, exp(1/x) overflowing
// at 0.0011), else x itself (an interior pole).
function divergentAt(x: number, level: Level): number {
  const limit = Math.abs(x - level.a) <= Math.abs(x - level.b) ? level.a : level.b
  return Math.abs(x - limit) <= QUAD_DIVERGE_NEAR_REL * Math.abs(level.b - level.a) ? limit : x
}

function fail(reason: QuadFailure, index: number, at: number | null): QuadratureError {
  const err = new QuadratureError(reason)
  err.at[index] = at
  return err
}

// f at a node of a guarded level: one evaluation spent; NaN refused as
// undefined and an infinity as divergence, at this node; a failure from an
// inner level learns this level's coordinate on its way out.
function evaluate(f: (x: number) => number, x: number, level: Level): number {
  if (--level.budget.left < 0) throw new QuadratureError('budget')
  let v: number
  try {
    v = f(x)
  } catch (err) {
    if (err instanceof QuadratureError && err.at[level.index] === undefined) {
      if (err.reason === 'undefined' || err.reason === 'bound') err.at[level.index] = x
      else if (err.reason === 'diverges') {
        // An inner level that located it owns the place; else this one does.
        const inner = err.at.some((p, i) => i > level.index && typeof p === 'number')
        err.at[level.index] = inner ? null : divergentAt(x, level)
      }
    }
    throw err
  }
  if (Number.isNaN(v)) throw fail('undefined', level.index, x)
  // An infinity in an inner level's first panels may be the outer's (exp(1/x)
  // is infinite at every y): the outer places it, unless this level had
  // already been refining.
  if (!Number.isFinite(v)) throw fail('diverges', level.index, level.index > 0 && !level.refining ? null : divergentAt(x, level))
  return v
}

function kronrod(f: (x: number) => number, a: number, b: number, level: Level | null, run = 0): Panel {
  const at = level ? (x: number) => evaluate(f, x, level) : f
  const centre = (a + b) / 2
  const half = (b - a) / 2
  const fc = at(centre)
  let k = WGK[7] * fc
  let g = WG[3] * fc
  for (let i = 0; i < 7; i++) {
    const dx = half * XGK[i]
    const sum = at(centre - dx) + at(centre + dx)
    k += WGK[i] * sum
    // XGK[1], XGK[3], XGK[5] are the Gauss nodes.
    if (i % 2 === 1) g += WG[(i - 1) / 2] * sum
  }
  const value = k * half
  return { a, b, value, error: Math.abs((k - g) * half), run }
}

// Where a level was refining when it stopped: the panel it was splitting,
// when narrow — a limit exactly when the panel ends there.
function locate(pa: number, pb: number, a: number, b: number): number | null {
  if (Math.abs(pb - pa) > QUAD_NARROW_REL * Math.abs(b - a)) return null
  if (pa === a || pa === b) return pa
  if (pb === a || pb === b) return pb
  return (pa + pb) / 2
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

function adapt(f: (x: number) => number, a: number, b: number, tol: number, maxPanels: number, level: Level | null): QuadResult {
  let splitting: [number, number] = [a, b]
  // Rounding width at this range's magnitude: no panel narrower means much.
  const floorWidth = QUAD_ROUNDING_WIDTH * Math.max(Math.abs(a), Math.abs(b), Math.abs(b - a))
  try {
    // An inner level starts from two panels split at the golden section, so
    // its nodes never fall on an outer level's dyadic nodes: |x - y| with x
    // an outer node puts its kink on the inner node x, where the 7- and
    // 15-point rules can agree while both are wrong (1.8e-5 at x = 0.5,
    // reported as 1e-11).
    const panels: Panel[] =
      level && level.index > 0 ? [kronrod(f, a, a + (b - a) * GOLDEN, level), kronrod(f, a + (b - a) * GOLDEN, b, level)] : [kronrod(f, a, b, level)]
    let error = 0
    let value = 0
    let magnitude = 0
    for (const panel of panels) {
      error += panel.error
      value += panel.value
      magnitude += Math.abs(panel.value)
    }
    if (level) level.refining = true
    while (error > Math.max(tol, QUAD_REL * Math.abs(value), QUAD_ROUNDING * magnitude) && panels.length < maxPanels) {
      let worst = 0
      for (let i = 1; i < panels.length; i++) if (panels[i].error > panels[worst].error) worst = i
      const parent = panels[worst]
      const { a: pa, b: pb } = parent
      splitting = [pa, pb]
      const mid = (pa + pb) / 2
      const left = kronrod(f, pa, mid, level)
      const right = kronrod(f, mid, pb, level)
      for (const child of [left, right]) child.run = Math.abs(child.value) >= QUAD_DIVERGE_KEEP * Math.abs(parent.value) && parent.value !== 0 ? parent.run + 1 : 0
      if (level && Math.abs(pb - pa) <= floorWidth && Math.max(left.run, right.run) >= QUAD_DIVERGE_RUN) {
        throw fail('diverges', level.index, divergentAt(mid, level))
      }
      panels.splice(worst, 1, left, right)
      error = 0
      value = 0
      magnitude = 0
      for (const panel of panels) {
        error += panel.error
        value += panel.value
        magnitude += Math.abs(panel.value)
      }
      if (!Number.isFinite(error)) break
    }
    const result = sum(panels)
    if (level && panels.length >= maxPanels && result.error > Math.max(tol, QUAD_UNSETTLED_REL * Math.abs(result.value))) {
      let worst = 0
      for (let i = 1; i < panels.length; i++) if (panels[i].error > panels[worst].error) worst = i
      splitting = [panels[worst].a, panels[worst].b]
      throw new QuadratureError('budget')
    }
    return result
  } catch (err) {
    if (err instanceof QuadratureError && err.reason === 'budget' && level && err.at[level.index] === undefined) {
      err.at[level.index] = locate(splitting[0], splitting[1], a, b)
    }
    throw err
  }
}

// The integral of f from a to b, to an absolute error target `tol` (or
// QUAD_REL of its value). With a budget it is guarded as a nested integral
// is; without, an integrand that is not finite gives a result that is not.
export function integrate1(f: (x: number) => number, a: number, b: number, tol: number = QUAD_TOL, budget?: QuadBudget): QuadResult {
  if (a === b) return { value: 0, error: 0 }
  return adapt(f, a, b, tol, QUAD_MAX_PANELS, budget ? { index: 0, a, b, budget } : null)
}

// The target an inner integral is held to, absolutely: its share of the
// outer target (a relative QUAD_REL of its own value also applies).
function innerTolerance(tol: number, a: number, b: number): number {
  return (QUAD_INNER_FRACTION * tol) / Math.max(Math.abs(b - a), 1e-300)
}

// An inner level's range at an outer node: a bound that is not a number is
// the bound's fault; an infinite one is divergence.
function range(lo: number, hi: number, level: number): [number, number] {
  for (const [v, side] of [
    [lo, 'lower'],
    [hi, 'upper'],
  ] as const) {
    if (Number.isNaN(v)) {
      const err = new QuadratureError('bound')
      err.bound = { level, side }
      throw err
    }
    if (!Number.isFinite(v)) throw new QuadratureError('diverges')
  }
  return [lo, hi]
}

function outerRange(a: number, b: number): void {
  range(a, b, 0)
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
  outerRange(a, b)
  if (a === b) return { value: 0, error: 0 }
  const inner = innerTolerance(tol, a, b)
  let innerError = 0
  const outer = adapt(
    (x) => {
      const [lo, hi] = range(c(x), d(x), 1)
      if (lo === hi) return 0
      const r = adapt((y) => f(x, y), lo, hi, inner, QUAD_INNER_MAX_PANELS, { index: 1, a: lo, b: hi, budget })
      innerError = Math.max(innerError, r.error)
      return r.value
    },
    a,
    b,
    tol,
    QUAD_MAX_PANELS,
    { index: 0, a, b, budget }
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
  outerRange(a, b)
  if (a === b) return { value: 0, error: 0 }
  const middle = innerTolerance(tol, a, b)
  let middleError = 0
  const outer = adapt(
    (x) => {
      const [lo, hi] = range(c(x), d(x), 1)
      if (lo === hi) return 0
      const inner = innerTolerance(middle, lo, hi)
      let innerError = 0
      const r = adapt(
        (y) => {
          const [zlo, zhi] = range(e(x, y), g(x, y), 2)
          if (zlo === zhi) return 0
          const q = adapt((z) => f(x, y, z), zlo, zhi, inner, QUAD_INNER_MAX_PANELS, { index: 2, a: zlo, b: zhi, budget })
          innerError = Math.max(innerError, q.error)
          return q.value
        },
        lo,
        hi,
        middle,
        QUAD_INNER_MAX_PANELS,
        { index: 1, a: lo, b: hi, budget }
      )
      middleError = Math.max(middleError, r.error + Math.abs(hi - lo) * innerError)
      return r.value
    },
    a,
    b,
    tol,
    QUAD_MAX_PANELS,
    { index: 0, a, b, budget }
  )
  return { value: outer.value, error: outer.error + Math.abs(b - a) * middleError }
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
