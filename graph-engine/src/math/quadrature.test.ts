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

describe('the evaluation budget and refusals (S5 fix round 1)', () => {
  const timed = <T>(run: () => T): { ms: number; value?: T; error?: unknown } => {
    const start = performance.now()
    try {
      const value = run()
      return { ms: performance.now() - start, value }
    } catch (error) {
      return { ms: performance.now() - start, error }
    }
  }

  it('integrate2 of 1/x over [0, 1]^2 diverges: refused within the budget, in well under a second, near x = 0', () => {
    const r = timed(() => integrate2((x) => 1 / x, 0, 1, () => 0, () => 1))
    expect(r.ms).toBeLessThan(1000)
    expect(r.error).toBeInstanceOf(QuadratureError)
    const e = r.error as QuadratureError
    expect(e.reason).toBe('budget')
    expect(e.at[0]).toBe(0)
  })

  it('integrate3 with an unbounded inner bound, z in [0, 1/x], is refused near x = 0', () => {
    const r = timed(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, (x) => 1 / x))
    expect(r.ms).toBeLessThan(1000)
    const e = r.error as QuadratureError
    expect(e.reason).toBe('budget')
    expect(e.at[0]).toBe(0)
  })

  it('an integrand undefined at a node is refused there, not summed to "∞": 1/x over [-1, 1] at x = 0', () => {
    const r = timed(() => integrate2((x) => 1 / x, -1, 1, () => 0, () => 1))
    const e = r.error as QuadratureError
    expect(e.reason).toBe('undefined')
    expect(e.at[0]).toBe(0)
    expect(typeof e.at[1]).toBe('number')
  })

  it('a singular inner integral is located at its own level: 1/y over [0, 1]^2 near y = 0', () => {
    const e = timed(() => integrate2((_x, y) => 1 / y, 0, 1, () => 0, () => 1)).error as QuadratureError
    expect(e.reason).toBe('budget')
    expect(e.at[1]).toBe(0)
  })

  it('an integrable singularity still converges inside the budget: 1/sqrt(x) over [0, 1]^2 is 2', () => {
    const r = integrate2((x) => 1 / Math.sqrt(x), 0, 1, () => 0, () => 1)
    expect(Math.abs(r.value - 2)).toBeLessThan(1e-8)
  })

  it('a budget is shared by every level: a small one is spent by one smooth triple integral', () => {
    expect(() => integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, quadBudget(100))).toThrow(QuadratureError)
    expect(integrate3(() => 1, 0, 1, () => 0, () => 1, () => 0, () => 1, undefined, quadBudget(4000)).value).toBeCloseTo(1, 12)
  })

  it('coarse2 and coarse3 give a fixed-cost scale: exact for low-degree polynomials', () => {
    expect(coarse2((x, y) => x * y, 0, 1, () => 0, (x) => x)).toBeCloseTo(1 / 8, 12)
    expect(coarse3(() => 1, 0, 1, () => 0, (x) => 1 - x, () => 0, (x, y) => 1 - x - y)).toBeCloseTo(1 / 6, 12)
  })
})
