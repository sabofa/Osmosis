import { describe, expect, it } from 'vitest'
import { coarse2, coarse3, integrate1, integrate2, integrate3, quadBudget, QuadratureError } from './quadrature'

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

describe('divergence, refusals and the budget (S5 fix rounds 1 and 2)', () => {
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
    expect(r.ms).toBeLessThan(1000)
    expect(r.error).toBeInstanceOf(QuadratureError)
    return r.error as QuadratureError
  }
  const s = Math.sqrt

  it('1/x over [0, 1]^2 diverges, found directly (its value never shrinks as its panel halves), at x = 0', () => {
    const e = failure(() => integrate2((x) => 1 / x, 0, 1, () => 0, () => 1))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
  })

  it('z in [0, 1/x] diverges at x = 0', () => {
    const e = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => 1 / x))
    expect([e.reason, e.at[0]]).toEqual(['diverges', 0])
  })

  it('an infinity at a node is divergence there: 1/x over [-1, 1] at x = 0 (not "≈ ∞", not "undefined")', () => {
    const e = failure(() => integrate2((x) => 1 / x, -1, 1, () => 0, () => 1))
    expect([e.reason, e.at[0], e.at[1]]).toEqual(['diverges', 0, null])
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
    const e = failure(() => integrate2((x) => s(x), -1, 1, () => 0, () => 1))
    expect(e.reason).toBe('undefined')
    expect(e.at[0]).toBeLessThan(0)
    const b = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => s(x - 0.5)))
    expect([b.reason, b.bound]).toEqual(['bound', { level: 2, side: 'upper' }])
    expect(b.at[0]).toBeLessThan(0.5)
    expect(typeof b.at[1]).toBe('number')
  })

  it('integrable singularities converge: 1/sqrt(x) over [0, 1]^2 is 2, and 1/(x + 1e-16) is not taken for 1/x', () => {
    expect(Math.abs(integrate2((x) => 1 / s(x), 0, 1, () => 0, () => 1).value - 2)).toBeLessThan(1e-8)
    // ln(1 + 1e16): each halving toward 0 keeps the value, as 1/x does, for about 38 halvings (a
    // run well past QUAD_DIVERGE_RUN), then it shrinks, before any panel is at rounding width
    const near = integrate2((x) => 1 / (x + 0.0000000000000001), 0, 1, () => 0, () => 1)
    expect(Math.abs(near.value - Math.log(1 + 1e16))).toBeLessThanOrEqual(near.error)
    expect(Math.abs(near.value / Math.log(1 + 1e16) - 1)).toBeLessThan(1e-9)
  })

  it('textbook integrals the base computed are not refused: the rectangular ball, the cone, 1/sqrt(z), |x - y|', () => {
    const cases: [() => { value: number }, number][] = [
      [() => integrate3(() => 1, -1, 1, (x) => -s(1 - x * x), (x) => s(1 - x * x), (x, y) => -s(1 - x * x - y * y), (x, y) => s(1 - x * x - y * y)), (4 * Math.PI) / 3],
      [() => integrate3(() => 1, -1, 1, (x) => -s(1 - x * x), (x) => s(1 - x * x), (x, y) => s(x * x + y * y), () => 1), Math.PI / 3],
      [() => integrate3((_x, _y, z) => 1 / s(z), 0, 1, () => 0, () => 1, () => 0, () => 1), 2],
      [() => integrate2((x, y) => Math.abs(x - y), 0, 1, () => 0, () => 1), 1 / 3],
    ]
    for (const [run, exact] of cases) {
      const r = timed(run)
      expect(r.ms).toBeLessThan(1000)
      expect(Math.abs((r.value as { value: number }).value - exact)).toBeLessThan(1e-8)
    }
  })

  it('an inner integral whose kink falls on an outer node is not fooled: |x - y| at x = 0.5 is right', () => {
    // with x an outer node, a one-panel inner integral puts the kink on its own centre node,
    // where the 7- and 15-point rules agree while both are wrong
    const r = integrate2((x, y) => Math.abs(x - y), 0, 1, () => 0, () => 1)
    expect(Math.abs(r.value - 1 / 3)).toBeLessThanOrEqual(r.error)
  })

  it('1/(x^2 + y^2 + z^2) over the unit cube converges: a value or, at worst, "did not settle" — never divergence', () => {
    const r = timed(() => integrate3((x, y, z) => 1 / (x * x + y * y + z * z), 0, 1, () => 0, () => 1, () => 0, () => 1))
    expect(r.ms).toBeLessThan(1000)
    if (r.error) expect((r.error as QuadratureError).reason).toBe('budget')
  })

  it('a budget is shared by every level: a small one is spent by one smooth triple integral, as "budget"', () => {
    const e = failure(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, quadBudget(100)))
    expect(e.reason).toBe('budget')
    expect(integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, quadBudget(20000)).value).toBeCloseTo(1, 12)
  })

  it('coarse2 and coarse3 give a fixed-cost scale: exact for low-degree polynomials', () => {
    expect(coarse2((x, y) => x * y, 0, 1, () => 0, (x) => x)).toBeCloseTo(1 / 8, 12)
    expect(coarse3(() => 1, 0, 1, () => 0, (x) => 1 - x, () => 0, (x, y) => 1 - x - y)).toBeCloseTo(1 / 6, 12)
  })
})
