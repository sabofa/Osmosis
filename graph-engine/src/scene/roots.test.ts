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
  //
  // With these particular bounds and the default 800 samples, sample index
  // 400 lands on exactly x=0, so f(0) is Infinity, safeEval returns null,
  // and the prevY/y null guard skips both adjacent brackets before the
  // bisect-then-validate discriminator ever runs. This test only proves the
  // non-finite-sample skip works, not that the discriminator itself rejects
  // a pole — see the next test for that.
  it('does not report a pole as a root', () => {
    expect(findRoots((x) => 1 / x, -5, 5)).toEqual([])
  })

  // Same discrimination, but with bounds chosen so no sample lands exactly on
  // the pole at x=0 (verified: -5.0001 + (10/800)*i is never exactly 0 for
  // integer i). That forces a genuine sign-change bracket around x=0 with two
  // finite, non-null samples, so bisect() actually runs and the
  // |f(root)| <= scale * ROOT_TOLERANCE check is what rejects it.
  it('rejects a pole even when no sample lands exactly on it', () => {
    expect(findRoots((x) => 1 / x, -5.0001, 4.9999)).toEqual([])
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

  // For f(x) = x on [-1, 1], x=0 lands exactly on a sample: the y===0 branch
  // pushes once, and prevY=0 fails the `< 0` sign-flip check for the next
  // pair (0 is not < 0), so the adjacent bracket never triggers a second
  // push. found[] only ever holds one entry when push() runs, so the dedup
  // comparison inside push() never actually executes — DEDUPE_EPSILON is
  // untested here.
  it('de-duplicates roots found from adjacent brackets', () => {
    const roots = findRoots((x) => x, -1, 1)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0, 8)
  })

  // f(x) = -x on [-1, 1] forces the dedup comparison to actually run: the
  // y===0 branch pushes at x=0 (found = [0]), then the next pair has
  // prevY = -0 and y < 0, which IS a sign flip (-0 < 0 is false, 0 < 0 is
  // false... concretely: JS evaluates `-0 < 0 !== nextY < 0`, and bisection
  // lands a second candidate at ~1e-21), so push() is called again with
  // found already non-empty and must reject the near-duplicate via
  // DEDUPE_EPSILON. Verified by tracing a standalone copy of the scan/push
  // logic: it logs a second push attempt of ~1.08e-21 that is rejected
  // because |0 - 1.08e-21| < 1e-7, leaving found = [0].
  it('de-duplicates a root found both exactly and from the adjacent bracket', () => {
    const roots = findRoots((x) => -x, -1, 1)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0, 8)
  })

  // Guards against the dedup fix going too far: two roots that are close
  // relative to the sample spacing but far outside DEDUPE_EPSILON (1e-7)
  // must both survive. x^2 - 1e-8 has roots at +/-1e-4, 2e-4 apart; with the
  // default 800 samples over this 2e-3-wide interval the step is 2.5e-6, so
  // the two roots fall in separate brackets roughly 80 samples apart, not
  // the same one.
  it('keeps two distinct roots that are close but well outside the dedupe epsilon', () => {
    const roots = findRoots((x) => x * x - 1e-8, -1e-3, 1e-3)
    expect(roots).toHaveLength(2)
    expect(roots[0]).toBeCloseTo(-1e-4, 8)
    expect(roots[1]).toBeCloseTo(1e-4, 8)
  })
})
