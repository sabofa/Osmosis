import { describe, expect, it } from 'vitest'
import type { FeatureKind } from '../parser/config'
import { explicitFeatures, intersectionFeatures } from './featurePoints'

const ALL = new Set<FeatureKind>(['x-intercept', 'y-intercept', 'local-max', 'local-min', 'inflection'])

function kinds(features: { kind: FeatureKind }[]): FeatureKind[] {
  return features.map((f) => f.kind).sort()
}

describe('explicitFeatures', () => {
  it('finds the vertex of a parabola as a local minimum, not a generic point', () => {
    // y = x^2 - 2x - 1 has its vertex at (1, -2).
    const features = explicitFeatures((x) => x * x - 2 * x - 1, -10, 10, new Set(['local-min']))
    expect(features).toHaveLength(1)
    expect(features[0].kind).toBe('local-min')
    expect(features[0].position.x).toBeCloseTo(1, 5)
    expect(features[0].position.y).toBeCloseTo(-2, 5)
  })

  it('distinguishes a local maximum from a local minimum', () => {
    // y = x^3 - 3x: max at x=-1, min at x=1.
    const features = explicitFeatures((x) => x ** 3 - 3 * x, -5, 5, new Set(['local-max', 'local-min']))
    const max = features.find((f) => f.kind === 'local-max')
    const min = features.find((f) => f.kind === 'local-min')
    expect(max?.position.x).toBeCloseTo(-1, 4)
    expect(min?.position.x).toBeCloseTo(1, 4)
  })

  it('finds x-intercepts and the y-intercept as separate kinds', () => {
    const features = explicitFeatures((x) => x * x - 4, -10, 10, new Set(['x-intercept', 'y-intercept']))
    expect(kinds(features)).toEqual(['x-intercept', 'x-intercept', 'y-intercept'])
    const y = features.find((f) => f.kind === 'y-intercept')
    expect(y?.position.x).toBe(0)
    expect(y?.position.y).toBeCloseTo(-4, 6)
  })

  it('finds an inflection point', () => {
    const features = explicitFeatures((x) => x ** 3, -5, 5, new Set(['inflection']))
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 3)
  })

  // The inflection counterpart of "reports no extrema for a straight line",
  // and the worse half of the same defect: a sign change of the *second*
  // difference was accepted with no validation at all, so on any function
  // whose true f'' is zero or negligible next to |f| the quotient
  // (f(x+h) - 2f(x) + f(x-h)) / h^2 is cancellation noise that flips sign at
  // nearly every sample. Each of these reported 750-800 inflections before
  // the noise guard; a straight line covered in square markers is the most
  // ordinary statement in a school graph, so this is the case that matters
  // most. See INFLECTION_NOISE_FACTOR in featurePoints.ts.
  it('reports no inflections for a straight line', () => {
    expect(explicitFeatures((x) => 2 * x + 1, -10, 10, new Set(['inflection']))).toEqual([])
  })

  it('reports no inflections for a constant function', () => {
    expect(explicitFeatures(() => 5, -10, 10, new Set(['inflection']))).toEqual([])
  })

  // abs(x) has a corner, not an inflection: f'' is exactly zero on both arms
  // and undefined at the origin.
  it('reports no inflections for abs(x)', () => {
    expect(explicitFeatures((x) => Math.abs(x), -10, 10, new Set(['inflection']))).toEqual([])
  })

  // Curvature of 2e-9 sitting on an offset of 1e6: the true second
  // difference is ~2e-15, four decades below one ulp of 1e6, so f'' here is
  // not resolvable in double precision at all. Reporting nothing is the
  // honest answer; reporting 750 inflections was not.
  it('reports no inflections when the curvature is below the noise floor of a large offset', () => {
    expect(explicitFeatures((x) => 1e6 + 1e-9 * x * x, -10, 10, new Set(['inflection']))).toEqual([])
  })

  // The other half of the guard: it must not buy quiet by killing real
  // inflections. f'' = 6x is unambiguous at the probe points either side.
  it('still finds the inflection of x^3', () => {
    const features = explicitFeatures((x) => x ** 3, -10, 10, new Set(['inflection']))
    expect(features).toHaveLength(1)
    expect(features[0].kind).toBe('inflection')
    expect(features[0].position.x).toBeCloseTo(0, 3)
  })

  it('still finds the inflection of x^3 - 3x', () => {
    const features = explicitFeatures((x) => x ** 3 - 3 * x, -10, 10, new Set(['inflection']))
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 3)
  })

  // sin has inflections at every multiple of pi; [-3, 3] contains only x = 0.
  it('still finds the inflection of sin(x) at the origin', () => {
    const features = explicitFeatures((x) => Math.sin(x), -3, 3, new Set(['inflection']))
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 3)
  })

  // Pins INFLECTION_NOISE_FACTOR's actual magnitude, not just its sign.
  // Every other inflection test here is satisfied by any positive factor
  // (even one far too small to reject noise), because none of them sits
  // near the gate's threshold — so none of them would catch a regression
  // that weakens the constant, only one that flips it non-positive.
  //
  // y = 10000 + sin(x) does sit right at that threshold: measured directly
  // against this codebase, INFLECTION_NOISE_FACTOR = 1e5 (the current,
  // shipped value) rejects all 8 of its genuine inflections over [-10, 10]
  // as noise, while INFLECTION_NOISE_FACTOR = 1e4 — a change of one order
  // of magnitude — finds all 8, and INFLECTION_NOISE_FACTOR = 4 (a value
  // already known to be too small to suppress cancellation noise, see the
  // comment above the constant) also finds all 8. So this asserts today's
  // actual, on-the-record behavior at the shipped factor; it fails the
  // moment the constant drops enough to cross that threshold, which a bare
  // "is it positive" check never would.
  it('still suppresses the offset-dominated sin(x) inflections at the current noise factor', () => {
    expect(explicitFeatures((x) => 10000 + Math.sin(x), -10, 10, new Set(['inflection']))).toEqual([])
  })

  it('returns nothing when nothing is wanted', () => {
    expect(explicitFeatures((x) => x * x, -5, 5, new Set())).toEqual([])
  })

  it('omits the y-intercept when x=0 is outside the range', () => {
    const features = explicitFeatures((x) => x, 1, 5, new Set(['y-intercept']))
    expect(features).toEqual([])
  })

  // The exact defect that made v1's modes indistinguishable: a flat line has
  // no extrema, but comparing consecutive samples on a noisy flat stretch
  // reports them anyway.
  it('reports no extrema for a straight line', () => {
    const features = explicitFeatures((x) => 2 * x + 1, -10, 10, new Set(['local-max', 'local-min']))
    expect(features).toEqual([])
  })

  it('marks everything it finds as exact', () => {
    const features = explicitFeatures((x) => x * x - 4, -10, 10, ALL)
    expect(features.every((f) => f.exact)).toBe(true)
  })

  it('classifies an extremum of a small-magnitude function', () => {
    // curvature here is 2/5e6 = 4e-7, below a bare 1e-6 threshold, so a
    // non-relative epsilon would misreport this unambiguous minimum as
    // neither a maximum nor a minimum. (A divisor of 1e6, as one might first
    // reach for, gives curvature 2e-6 — already above 1e-6 even without a
    // relative fix, so it would not actually exercise this check; 5e6 is
    // chosen so the case is genuinely below the bare threshold.)
    const features = explicitFeatures((x) => (x * x - 2 * x) / 5e6, -10, 10, new Set(['local-min']))
    expect(features).toHaveLength(1)
    expect(features[0].kind).toBe('local-min')
    expect(features[0].position.x).toBeCloseTo(1, 4)
  })
})

describe('intersectionFeatures', () => {
  it('finds where a line crosses a parabola', () => {
    // x^2 = x + 2 at x = -1 and x = 2.
    const features = intersectionFeatures([(x) => x * x, (x) => x + 2], -10, 10)
    expect(features).toHaveLength(2)
    expect(features[0].kind).toBe('intersection')
    expect(features[0].position.x).toBeCloseTo(-1, 5)
    expect(features[0].position.y).toBeCloseTo(1, 5)
    expect(features[1].position.x).toBeCloseTo(2, 5)
    expect(features[1].position.y).toBeCloseTo(4, 5)
  })

  it('checks every pair when given three curves', () => {
    // y=0, y=x, y=-x all meet at the origin; pairwise that is three hits at
    // the same place, which de-duplication collapses to one.
    const features = intersectionFeatures([() => 0, (x) => x, (x) => -x], -5, 5)
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 6)
  })

  it('finds nothing for parallel lines', () => {
    expect(intersectionFeatures([(x) => x + 1, (x) => x + 3], -10, 10)).toEqual([])
  })

  it('needs at least two curves', () => {
    expect(intersectionFeatures([(x) => x], -10, 10)).toEqual([])
    expect(intersectionFeatures([], -10, 10)).toEqual([])
  })
})
