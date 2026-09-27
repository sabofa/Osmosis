import { describe, expect, it } from 'vitest'
import { integrate1, integrate2, integrate3, quadBudget, QuadratureError, type QuadBudget, type QuadResult } from './quadrature'
import { QUAD_BUDGET } from './tolerance'

describe('integrate1 (adaptive Gauss-Kronrod 7-15)', () => {
  it('integrates a constant to the interval’s length', () => {
    expect(integrate1(() => 1, 0, 1).value).toBeCloseTo(1, 15)
  })

  it('x^2 on [0, 1] is 1/3, with an error estimate at most 1e-10', () => {
    const r = integrate1((x) => x * x, 0, 1)
    expect(Math.abs(r.value - 1 / 3)).toBeLessThanOrEqual(1e-12)
    expect(r.error).toBeLessThanOrEqual(1e-10)
  })

  it('sqrt(x) on [0, 1] is 2/3 despite the infinite slope at 0', () => {
    const r = integrate1(Math.sqrt, 0, 1)
    expect(Math.abs(r.value - 2 / 3)).toBeLessThanOrEqual(1e-8)
    // the estimate is honest: it bounds the true error
    expect(Math.abs(r.value - 2 / 3)).toBeLessThanOrEqual(r.error + 1e-15)
  })

  it('reversed limits negate', () => {
    expect(integrate1((x) => x, 1, 0).value).toBeCloseTo(-0.5, 15)
  })

  it('an integrand that is not finite gives a non-finite result, not a number', () => {
    const r = integrate1((x) => 1 / (x - 0.5), 0, 1)
    expect(Number.isFinite(r.value) && Number.isFinite(r.error)).toBe(false)
  })
})

describe('iterated integrals', () => {
  it('integrate2 of xy over [0, 1]^2 is 1/4', () => {
    const r = integrate2(
      (x, y) => x * y,
      0,
      1,
      () => 0,
      () => 1
    )
    expect(r.value).toBeCloseTo(0.25, 12)
  })

  it('type I: the integral of 1 over x in [0, 1], y in [x^2, x] is 1/6', () => {
    // integral of (x - x^2) from 0 to 1 = 1/2 - 1/3
    const r = integrate2(
      () => 1,
      0,
      1,
      (x) => x * x,
      (x) => x
    )
    expect(r.value).toBeCloseTo(1 / 6, 12)
  })

  it('integrate3 of 1 over the tetrahedron x, y, z >= 0, x + y + z <= 1 is 1/6', () => {
    const r = integrate3(
      () => 1,
      0,
      1,
      () => 0,
      (x) => 1 - x,
      () => 0,
      (x, y) => 1 - x - y
    )
    expect(r.value).toBeCloseTo(1 / 6, 12)
  })

  it('the unit ball in spherical coordinates is 4pi/3', () => {
    // theta in [0, 2pi], phi in [0, pi], rho in [0, 1]: rho^2 sin(phi)
    const r = integrate3(
      (_theta, phi, rho) => rho * rho * Math.sin(phi),
      0,
      2 * Math.PI,
      () => 0,
      () => Math.PI,
      () => 0,
      () => 1
    )
    expect(Math.abs(r.value - (4 * Math.PI) / 3)).toBeLessThanOrEqual(1e-9)
    expect(r.error).toBeLessThanOrEqual(1e-8)
  })
})

// Wall-clock bounds are only a generous guard (a loaded machine is slow: an
// integral of 6 million evaluations takes 1 s alone, 5 s beside the rest of
// the suite); what an integral costs is asserted in evaluations, from its
// budget.
const GUARD_MS = 15000
// A test running several heavy integrals may take longer than vitest's 5 s on a loaded machine.
const HEAVY_MS = 60000
const timed = <T>(run: () => T): { ms: number; value?: T; error?: unknown } => {
  const start = performance.now()
  try {
    const value = run()
    return { ms: performance.now() - start, value }
  } catch (error) {
    return { ms: performance.now() - start, error }
  }
}
const failure = (run: () => unknown) => {
  const r = timed(run)
  expect(r.ms).toBeLessThan(GUARD_MS)
  expect(r.error).toBeInstanceOf(QuadratureError)
  return r.error as QuadratureError
}
// A value whose error bounds its distance from `exact`, with at least
// `digits` significant digits supported; returns what it cost.
const honest = (run: (b: QuadBudget) => QuadResult, exact: number, digits: number): number => {
  const budget = quadBudget()
  const r = timed(() => run(budget))
  expect(r.ms).toBeLessThan(GUARD_MS)
  expect(r.error).toBeUndefined()
  const { value, error } = r.value as QuadResult
  expect(Math.abs(value - exact)).toBeLessThanOrEqual(error)
  expect(error).toBeLessThanOrEqual(Math.abs(exact) * 10 ** -digits)
  return QUAD_BUDGET - budget.left
}
const s = (v: number) => Math.sqrt(Math.max(v, 0))
const ballY = [(x: number) => -s(1 - x * x), (x: number) => s(1 - x * x)] as const
const ballZ = [(x: number, y: number) => -s(1 - x * x - y * y), (x: number, y: number) => s(1 - x * x - y * y)] as const

describe('divergence, refusals and the budget (S5 fix rounds 1 and 2)', () => {
  it('1/x over [0, 1]^2 diverges, found directly (its value never shrinks as its panel halves), at x = 0', () => {
    const e = failure(() => integrate2((x) => 1 / x, 0, 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
  })

  it('z in [0, 1/x] diverges at x = 0', () => {
    const e = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => 1 / x))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
  })

  it('an infinity at a node is divergence there: 1/x over [-1, 1] at x = 0 (not "≈ ∞", not "undefined"), the inner level silent', () => {
    const e = failure(() => integrate2((x) => 1 / x, -1, 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
    expect(typeof e.at[1]).not.toBe('number')
  })

  it('overflow is divergence at the nearer limit: 1/x^3 and exp(1/x) near x = 0', () => {
    for (const f of [(x: number) => 1 / x ** 3, (x: number) => Math.exp(1 / x)]) {
      const e = failure(() => integrate2(f, 0, 1, () => 0, () => 1))
      expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
    }
  })

  it('a pole inside the range is placed where it is: 1/(x - 0.3)^2 near x = 0.3', () => {
    const e = failure(() => integrate2((x) => 1 / (x - 0.3) ** 2, 0, 1, () => 0, () => 1))
    expect(e.reason).toBe('diverges')
    expect(e.at[0]).toBeCloseTo(0.3, 9)
  })

  it('a singular inner integral is located at its own level: 1/y over [0, 1]^2 near y = 0, the outer level silent', () => {
    const e = failure(() => integrate2((_x, y) => 1 / y, 0, 1, () => 0, () => 1))
    expect([e.reason, e.at[0], e.at[1]]).toEqual(['diverges', null, 0])
  })

  it('NaN in the integrand is "undefined" at its node; NaN in a bound is the bound’s, level and side named', () => {
    const e = failure(() => integrate2((x) => Math.sqrt(x), -1, 1, () => 0, () => 1))
    expect(e.reason).toBe('undefined')
    expect(e.at[0]).toBeLessThan(0)
    const b = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => Math.sqrt(x - 0.5)))
    expect([b.reason, b.bound]).toEqual(['bound', { level: 2, side: 'upper' }])
    expect(b.at[0]).toBeLessThan(0.5)
    expect(typeof b.at[1]).toBe('number')
  })

  it('integrable singularities converge: 1/sqrt(x) over [0, 1]^2 is 2', () => {
    honest((b) => integrate2((x) => 1 / Math.sqrt(x), 0, 1, () => 0, () => 1, undefined, b), 2, 8)
  })

  it('textbook integrals the base computed are not refused: the rectangular ball, the cone, 1/sqrt(z), |x - y|', () => {
    honest((b) => integrate3(() => 1, -1, 1, ...ballY, ...ballZ, undefined, b), (4 * Math.PI) / 3, 8)
    // the cone's lower bound meets the top at the rim with a kink: the second rung's digits
    honest((b) => integrate3(() => 1, -1, 1, ...ballY, (x, y) => s(x * x + y * y), () => 1, undefined, b), Math.PI / 3, 4)
    honest((b) => integrate3((_x, _y, z) => 1 / Math.sqrt(z), 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, b), 2, 8)
    honest((b) => integrate2((x, y) => Math.abs(x - y), 0, 1, () => 0, () => 1, undefined, b), 1 / 3, 8)
  }, HEAVY_MS)

  it('an inner integral whose kink falls on an outer node is not fooled: |x - y| at x = 0.5 is right', () => {
    // with x an outer node, a one-panel inner integral puts the kink on its own centre node,
    // where the 7- and 15-point rules agree while both are wrong
    const r = integrate2((x, y) => Math.abs(x - y), 0, 1, () => 0, () => 1)
    expect(Math.abs(r.value - 1 / 3)).toBeLessThanOrEqual(r.error)
  })

  it('1/(x^2 + y^2 + z^2) over the unit cube converges: a value or, at worst, "did not settle" — never divergence', () => {
    const r = timed(() => integrate3((x, y, z) => 1 / (x * x + y * y + z * z), 0, 1, () => 0, () => 1, () => 0, () => 1))
    expect(r.ms).toBeLessThan(GUARD_MS)
    if (r.error) expect((r.error as QuadratureError).reason).toBe('budget')
  }, HEAVY_MS)

  it('a budget is shared by every level, pass and rung: a small one is spent by one smooth triple integral, as "budget"', () => {
    const e = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, quadBudget(100)))
    expect(e.reason).toBe('budget')
    const budget = quadBudget(100000)
    expect(integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, budget).value).toBeCloseTo(1, 12)
    // every level's evaluations count: in the golden pass each level has two panels (30 nodes)
    // and 3 end samples, so 33 outer, 33^2 middle, 33^3 inner; the one-panel cross-check, 17 each
    expect(100000 - budget.left).toBe(33 + 33 ** 2 + 33 ** 3 + 17 + 17 ** 2 + 17 ** 3)
  })
})

describe('never a wrong confident number (S5 fix round 3)', () => {
  it('tan, sec and sec^2 to the float pi/2 do not converge — their pole is 6e-17 beyond the end, not 40 away', () => {
    for (const f of [Math.tan, (x: number) => 1 / Math.cos(x), (x: number) => 1 / Math.cos(x) ** 2]) {
      const e = failure(() => integrate2(f, 0, Math.PI / 2, () => 0, () => 1))
      expect([e.reason, e.at[0]]).toEqual(['diverges', Math.PI / 2])
    }
  })

  it('a pole within float resolution of the end is taken as on it: 1/(x + 1e-16) is refused as tan is (a ruling)', () => {
    const e = failure(() => integrate2((x) => 1 / (x + 1e-16), 0, 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
  })

  it('kinks: |x - y| over [0, 2]^2, [-1, 1]^2, [0, 3]^2 and max, min over [0, 2]^2 — every digit honest', () => {
    const square = (f: (x: number, y: number) => number, lo: number, hi: number) => (b: QuadBudget) => integrate2(f, lo, hi, () => lo, () => hi, undefined, b)
    const abs = (x: number, y: number) => Math.abs(x - y)
    expect(honest(square(abs, 0, 2), 8 / 3, 9)).toBeLessThan(50000)
    expect(honest(square(abs, -1, 1), 8 / 3, 9)).toBeLessThan(50000)
    expect(honest(square(abs, 0, 3), 9, 9)).toBeLessThan(50000)
    expect(honest(square(Math.max, 0, 2), 16 / 3, 9)).toBeLessThan(50000)
    expect(honest(square(Math.min, 0, 2), 8 / 3, 9)).toBeLessThan(50000)
  })

  it('x^(-2/3) over the cube is 3, as an integrand and as the bound z <= x^(-2/3) (the power rule with m = 3)', () => {
    expect(honest((b) => integrate3((x) => x ** (-2 / 3), 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, b), 3, 10)).toBeLessThan(1_000_000)
    expect(honest((b) => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => x ** (-2 / 3), undefined, b), 3, 10)).toBeLessThan(1_000_000)
  }, HEAVY_MS)

  it('convergent singular ends are valued: 1/sqrt(1 - x^2 - y^2) over the disc and in polar, 1/sqrt(1 - x^2), 1/sqrt(1 - x), y <= 1/sqrt(1 - x^2)', () => {
    expect(honest((b) => integrate2((x, y) => 1 / Math.sqrt(1 - x * x - y * y), -1, 1, ...ballY, undefined, b), 2 * Math.PI, 9)).toBeLessThan(50000)
    expect(honest((b) => integrate2((r) => r / Math.sqrt(1 - r * r), 0, 1, () => 0, () => 2 * Math.PI, undefined, b), 2 * Math.PI, 9)).toBeLessThan(50000)
    expect(honest((b) => integrate2((x) => 1 / Math.sqrt(1 - x * x), -1, 1, () => 0, () => 1, undefined, b), Math.PI, 9)).toBeLessThan(50000)
    expect(honest((b) => integrate2((x) => 1 / Math.sqrt(1 - x), 0, 1, () => 0, () => 1, undefined, b), 2, 9)).toBeLessThan(50000)
    expect(honest((b) => integrate2(() => 1, -1, 1, () => 0, (x) => 1 / Math.sqrt(1 - x * x), undefined, b), Math.PI, 9)).toBeLessThan(50000)
  })

  it('convergent singular points inside: 1/sqrt|x| and ln|x| over [-1, 1], y <= 1/sqrt|x|, 1/sqrt|x - y| and 1/r', () => {
    honest((b) => integrate2((x) => 1 / Math.sqrt(Math.abs(x)), -1, 1, () => 0, () => 1, undefined, b), 4, 9)
    honest((b) => integrate2((x) => Math.log(Math.abs(x)), -1, 1, () => 0, () => 1, undefined, b), -2, 9)
    honest((b) => integrate2(() => 1, -1, 1, () => 0, (x) => 1 / Math.sqrt(Math.abs(x)), undefined, b), 4, 9)
    // the singular line y = x, and the point 0: honest, to the digits their lineages' tails allow;
    // the inner integrals' errors are fixed beside the outer level's own, which stops there, so
    // the first rung settles it (chasing them, it runs out and the second rung gives 1e-5)
    const line = integrate2((x, y) => 1 / Math.sqrt(Math.abs(x - y)), 0, 1, () => 0, () => 1)
    expect(Math.abs(line.value - 8 / 3)).toBeLessThanOrEqual(line.error)
    expect(line.error).toBeLessThan(1e-5)
    honest((b) => integrate2((x, y) => 1 / Math.hypot(x, y), -1, 1, () => -1, () => 1, undefined, b), 8 * Math.asinh(1), 4)
  }, HEAVY_MS)

  it('slow singular ends are never called divergent: x^-0.99, x^-0.999 and 1/(x ln^2 x) — a value, or "did not settle" at 0', () => {
    const cases: [(x: number) => number, number, number][] = [
      [(x) => x ** -0.99, 1, 100],
      [(x) => x ** -0.999, 1, 1000],
      [(x) => 1 / (x * Math.log(x) ** 2), 0.5, 1 / Math.LN2],
    ]
    for (const [f, hi, exact] of cases) {
      const r = timed(() => integrate2(f, 0, hi, () => 0, () => 1))
      expect(r.ms).toBeLessThan(GUARD_MS)
      if (r.error) expect([(r.error as QuadratureError).reason, (r.error as QuadratureError).at[0]]).toEqual(['slow', 0])
      else expect(Math.abs((r.value as QuadResult).value - exact)).toBeLessThanOrEqual((r.value as QuadResult).error)
    }
  })

  it('an end that overflows while its shells still shrink did not settle — never divergence: 1e300 x^-0.99 overflows below 4e-9', () => {
    const e = failure(() => integrate2((x) => 1e300 * x ** -0.99, 0, 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['slow', 0])
  })

  it('any exponent at a region’s edge: (1 - x^2 - y^2)^-0.7 over the disc is π/0.3 (the power rule with m = 10/3, inner errors fixed)', () => {
    const g = (x: number, y: number) => (1 - x * x - y * y) ** -0.7
    // the first rung's digits: every inner integral ends in its float noise, which is kept, not chased
    expect(honest((b) => integrate2(g, -1, 1, ...ballY, undefined, b), Math.PI / 0.3, 7)).toBeLessThanOrEqual(QUAD_BUDGET)
  }, HEAVY_MS)

  it('divergence is placed where it is: exp(1/x) over the unit cube and 1/x over [-1, 1] x [0, 1]^2, near x = 0', () => {
    const e = failure(() => integrate3((x) => Math.exp(1 / x), 0, 1, () => 0, () => 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
    const f = failure(() => integrate3((x) => 1 / x, -1, 1, () => 0, () => 1, () => 0, () => 1))
    expect([f.reason, f.at[0]]).toEqual(['diverges', 0])
  })

  it('a removable point is not "undefined": sin(x)/x over [-1, 1] x [0, 1] is 2 Si(1), its NaN spanning every y at x = 0', () => {
    honest((b) => integrate2((x) => Math.sin(x) / x, -1, 1, () => 0, () => 1, undefined, b), 1.8921661407343662, 12)
  })

  it('the cross-check catches what one partition misses: a bump between every golden node, seen by the one-panel pass', () => {
    // 1 + 1000 exp(-((x - c)/w)^2): at c = 0.060123 the golden pass's nearest nodes are 7w
    // away (it reads 1, to 1e-14); the one-panel pass has a node 2.5w away, and refines to it
    const [c, w] = [0.060123, 0.003]
    const exact = 1 + 1000 * w * Math.sqrt(Math.PI)
    const r = integrate2((x) => 1 + 1000 * Math.exp(-(((x - c) / w) ** 2)), 0, 1, () => 0, () => 1)
    expect(Math.abs(r.value - exact)).toBeLessThanOrEqual(r.error)
  })

  // The D list — textbook triple integrals that ran out before — each in the evaluations it
  // costs, each its own test.
  const cube = (f: (x: number, y: number, z: number) => number) => (b: QuadBudget) => integrate3(f, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, b)
  it('D: |z| over the ball — a kink in z, the ball’s edges in y and x (the power rule, m = 2)', () => {
    expect(honest((b) => integrate3((_x, _y, z) => Math.abs(z), -1, 1, ...ballY, ...ballZ, undefined, b), Math.PI / 2, 10)).toBeLessThan(2_000_000)
  }, HEAVY_MS)
  it('D: the pyramid z <= 1 - max(|x|, |y|) — kinks at y = ±x and x = 0', () => {
    const pyramid = (x: number, y: number) => 1 - Math.max(Math.abs(x), Math.abs(y))
    expect(honest((b) => integrate3(() => 1, -1, 1, () => -1, () => 1, () => 0, pyramid, undefined, b), 4 / 3, 10)).toBeLessThan(2_000_000)
  }, HEAVY_MS)
  it('D: |y - z| and min(y, z) over the cube — a kink in z', () => {
    expect(honest(cube((_x, y, z) => Math.abs(y - z)), 1 / 3, 10)).toBeLessThan(1_000_000)
    expect(honest(cube((_x, y, z) => Math.min(y, z)), 1 / 3, 10)).toBeLessThan(1_000_000)
  }, HEAVY_MS)
  it('D: max(x, y, z) over the cube — two nested kinks run the first rung out; the second rung’s digits', () => {
    expect(honest(cube((x, y, z) => Math.max(x, y, z)), 3 / 4, 4)).toBeLessThanOrEqual(QUAD_BUDGET)
  }, HEAVY_MS)
  it('D: (x^2 + y^2)^6 over the ball, 4π/15 · 12!!/13!!', () => {
    const sixth = (x: number, y: number) => (x * x + y * y) ** 6
    expect(honest((b) => integrate3(sixth, -1, 1, ...ballY, ...ballZ, undefined, b), ((4 * Math.PI) / 15) * (46080 / 135135), 9)).toBeLessThan(2_000_000)
  }, HEAVY_MS)
  it('D: sqrt(x^2 + y^2) over the ball, π²/4 — a near-kink at y = 0 for small x; the second rung’s digits', () => {
    expect(honest((b) => integrate3((x, y) => Math.hypot(x, y), -1, 1, ...ballY, ...ballZ, undefined, b), Math.PI ** 2 / 4, 4)).toBeLessThanOrEqual(QUAD_BUDGET)
  }, HEAVY_MS)

  it('what does not settle says so, never a number: 1/rho over the ball in rectangular bounds', () => {
    const e = failure(() => integrate3((x, y, z) => 1 / Math.hypot(x, y, z), -1, 1, ...ballY, ...ballZ))
    expect(e.reason).toBe('budget')
  }, HEAVY_MS)
})
