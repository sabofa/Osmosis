import { describe, expect, it } from 'vitest'
import { derivative, findRoots, secondDerivative } from './roots'

describe('derivative', () => {
  it('matches the analytic derivative of a polynomial', () => {
    const f = (x: number) => x * x * x - 3 * x
    expect(derivative(f, 2)).toBeCloseTo(9, 4) // 3x^2 - 3 at x=2
    expect(derivative(f, 0)).toBeCloseTo(-3, 4)
  })

  it('matches the analytic derivative of sin', () => {
    expect(derivative(Math.sin, 0)).toBeCloseTo(1, 5)
    expect(derivative(Math.sin, Math.PI / 2)).toBeCloseTo(0, 5)
  })
})

describe('secondDerivative', () => {
  it('matches the analytic second derivative', () => {
    const f = (x: number) => x * x * x
    expect(secondDerivative(f, 2)).toBeCloseTo(12, 2) // 6x at x=2
  })

  it('is zero at an inflection', () => {
    const f = (x: number) => x * x * x
    expect(Math.abs(secondDerivative(f, 0))).toBeLessThan(1e-3)
  })
})

describe('findRoots', () => {
  it('finds both roots of a quadratic', () => {
    const roots = findRoots((x) => x * x - 4, -10, 10)
    expect(roots).toHaveLength(2)
    expect(roots[0]).toBeCloseTo(-2, 6)
    expect(roots[1]).toBeCloseTo(2, 6)
  })

  it('finds roots to far better precision than the sample spacing', () => {
    // 200 samples over [-10, 10] is a spacing of 0.1; the root is nowhere near
    // a sample point, so a sample-scanning approach would report ~0.1 off.
    const roots = findRoots((x) => x - Math.SQRT2, -10, 10, 200)
    expect(roots[0]).toBeCloseTo(Math.SQRT2, 8)
  })

  it('finds the three roots of a cubic', () => {
    const roots = findRoots((x) => x * x * x - x, -5, 5)
    expect(roots).toHaveLength(3)
    expect(roots[0]).toBeCloseTo(-1, 6)
    expect(roots[1]).toBeCloseTo(0, 6)
    expect(roots[2]).toBeCloseTo(1, 6)
  })

  it('returns nothing when the function never crosses zero', () => {
    expect(findRoots((x) => x * x + 1, -10, 10)).toEqual([])
  })

  // A pole is a sign change without a root. Reporting x=0 as a root of 1/x
  // would put a marker on a vertical asymptote.
  it('does not report a pole as a root', () => {
    expect(findRoots((x) => 1 / x, -5, 5)).toEqual([])
  })

  // The other half of that discrimination, and the easy one to get wrong: a
  // steep line has a genuine root with large values on both sides of it. A
  // pole test that judges by endpoint magnitude alone throws this away.
  it('finds the root of a steep line despite large values on both sides', () => {
    const roots = findRoots((x) => 100 * x - 50, -10, 10)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0.5, 6)
  })

  it('skips intervals where the function is undefined', () => {
    const f = (x: number) => (x < 0 ? NaN : x - 1)
    const roots = findRoots(f, -5, 5)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(1, 6)
  })

  it('de-duplicates roots found from adjacent brackets', () => {
    const roots = findRoots((x) => x, -1, 1)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0, 8)
  })
})
