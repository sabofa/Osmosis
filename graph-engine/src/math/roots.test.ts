import { describe, expect, it } from 'vitest'
import { newton, seededRoots } from './roots'

describe('newton', () => {
  it('solves x^2 + y^2 = 4, x = y from (1, 0.5): (sqrt 2, sqrt 2)', () => {
    const F = (v: Float64Array) => [v[0] * v[0] + v[1] * v[1] - 4, v[0] - v[1]]
    const J = (v: Float64Array) => [
      [2 * v[0], 2 * v[1]],
      [1, -1],
    ]
    const result = newton(F, J, [1, 0.5])
    expect(result.converged).toBe(true)
    expect(result.x[0]).toBeCloseTo(Math.SQRT2, 12)
    expect(result.x[1]).toBeCloseTo(Math.SQRT2, 12)
    expect(result.iterations).toBeGreaterThan(0)
  })

  it('in one dimension: x^3 = 8 from 1 is 2', () => {
    const result = newton(
      (v) => [v[0] ** 3 - 8],
      (v) => [[3 * v[0] ** 2]],
      [1]
    )
    expect(result.converged).toBe(true)
    expect(result.x[0]).toBeCloseTo(2, 12)
  })

  it('in three dimensions: a linear system in one step', () => {
    // x + y = 3, y + z = 5, x + z = 4 -> (1, 2, 3)
    const result = newton(
      (v) => [v[0] + v[1] - 3, v[1] + v[2] - 5, v[0] + v[2] - 4],
      () => [
        [1, 1, 0],
        [0, 1, 1],
        [1, 0, 1],
      ],
      [0, 0, 0]
    )
    expect(result.converged).toBe(true)
    expect([...result.x].map((c) => Math.round(c * 1e12) / 1e12)).toEqual([1, 2, 3])
  })

  it('reports failure rather than a wrong root: x^2 + 1 = 0 has none', () => {
    const result = newton(
      (v) => [v[0] * v[0] + 1],
      (v) => [[2 * v[0]]],
      [0.5]
    )
    expect(result.converged).toBe(false)
  })
})

describe('seededRoots', () => {
  it('finds exactly the critical points of x^3 - 3x + y^2 on [-3, 3]^2, deduplicated and ordered', () => {
    // grad = (3x^2 - 3, 2y) vanishes at (-1, 0) and (1, 0)
    const F = (v: Float64Array) => [3 * v[0] * v[0] - 3, 2 * v[1]]
    const J = (v: Float64Array) => [
      [6 * v[0], 0],
      [0, 2],
    ]
    const roots = seededRoots(F, J, { min: [-3, -3], max: [3, 3] }, 6)
    expect(roots).toHaveLength(2)
    expect(roots[0][0]).toBeCloseTo(-1, 12)
    expect(roots[0][1]).toBeCloseTo(0, 12)
    expect(roots[1][0]).toBeCloseTo(1, 12)
    expect(roots[1][1]).toBeCloseTo(0, 12)
  })

  it('keeps only roots inside the box', () => {
    // x^2 = 4 on [-1, 3], seeds -0.6, 0.2, 1, 1.8, 2.6. Newton's map is
    // x -> (x^2 + 4) / 2x, so the seed -0.6 goes to -3.63 and on to -2,
    // outside the box: only 2 is kept.
    const roots = seededRoots(
      (v) => [v[0] * v[0] - 4],
      (v) => [[2 * v[0]]],
      { min: [-1], max: [3] },
      5
    )
    expect(roots.map((r) => Math.round(r[0] * 1e9) / 1e9)).toEqual([2])
  })

  it('orders the roots lexicographically, not in the order the seeds found them', () => {
    // y^3 - y on [-1, 1], seeds -0.5 and 0.5. One Newton step from -0.5 is
    // -0.5 - (-0.125 + 0.5) / (0.75 - 1) = 1, and from 0.5 it is -1: the
    // seeds find 1 first, then -1.
    const roots = seededRoots(
      (v) => [v[0] ** 3 - v[0]],
      (v) => [[3 * v[0] ** 2 - 1]],
      { min: [-1], max: [1] },
      2
    )
    expect(roots.map((r) => r[0])).toEqual([-1, 1])
  })

  it('is deterministic', () => {
    const F = (v: Float64Array) => [Math.sin(v[0]), Math.cos(v[1])]
    const J = (v: Float64Array) => [
      [Math.cos(v[0]), 0],
      [0, -Math.sin(v[1])],
    ]
    const a = seededRoots(F, J, { min: [-4, -4], max: [4, 4] }, 7)
    const b = seededRoots(F, J, { min: [-4, -4], max: [4, 4] }, 7)
    expect(a).toEqual(b)
    // sin x = 0 at -pi, 0, pi; cos y = 0 at -pi/2, pi/2: 3 * 2 roots
    expect(a).toHaveLength(6)
  })
})

describe('Newton convergence is scale-aware (fix round 1, M7)', () => {
  it('grad(1e6 (x^2 + y^2)) = (2e6 x, 2e6 y) converges at the origin', () => {
    const r = newton(
      (v) => [2e6 * v[0], 2e6 * v[1]],
      () => [
        [2e6, 0],
        [0, 2e6],
      ],
      [0.3, -0.7]
    )
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0])).toBeLessThan(1e-12)
    expect(Math.abs(r.x[1])).toBeLessThan(1e-12)
  })

  it('large coefficients: 1e8 (x^2 - 2) converges to sqrt 2 (the residual floor is ~4e-8, above any absolute 1e-12)', () => {
    const r = newton(
      (v) => [1e8 * (v[0] * v[0] - 2)],
      (v) => [[2e8 * v[0]]],
      [1]
    )
    expect(r.converged).toBe(true)
    expect(r.x[0]).toBeCloseTo(Math.SQRT2, 12)
  })

  it('small coefficients: 1e-8 (x^2 - 2) is not declared converged early', () => {
    // An absolute 1e-12 is met at x = 1.4142157 (F = 6e-14), 2e-6 from the root.
    const r = newton(
      (v) => [1e-8 * (v[0] * v[0] - 2)],
      (v) => [[2e-8 * v[0]]],
      [1]
    )
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0] - Math.SQRT2)).toBeLessThan(1e-12)
  })

  it('seeded roots of grad(1e8 (x^3/3 - 2x + y^2/2)) are (-sqrt 2, 0) and (sqrt 2, 0)', () => {
    const roots = seededRoots(
      (v) => [1e8 * (v[0] * v[0] - 2), 1e8 * v[1]],
      (v) => [
        [2e8 * v[0], 0],
        [0, 1e8],
      ],
      { min: [-3, -3], max: [3, 3] },
      6
    )
    expect(roots).toHaveLength(2)
    expect(roots[0][0]).toBeCloseTo(-Math.SQRT2, 12)
    expect(roots[1][0]).toBeCloseTo(Math.SQRT2, 12)
    expect(roots[0][1]).toBeCloseTo(0, 12)
  })

  it('a triple root still converges (x^3 = 0 from 0.5)', () => {
    const r = newton(
      (v) => [v[0] ** 3],
      (v) => [[3 * v[0] ** 2]],
      [0.5]
    )
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0])).toBeLessThan(1e-4)
  })
})

describe('Newton never declares a non-root converged (fix round 2)', () => {
  // grad exp(x^2 + y^2) = 2 e^(x^2+y^2) (x, y): its one root is the origin.
  const E = (v: Float64Array) => Math.exp(v[0] * v[0] + v[1] * v[1])
  const F = (v: Float64Array) => [2 * v[0] * E(v), 2 * v[1] * E(v)]
  const J = (v: Float64Array) => {
    const e = E(v)
    return [
      [e * (2 + 4 * v[0] * v[0]), 4 * v[0] * v[1] * e],
      [4 * v[0] * v[1] * e, e * (2 + 4 * v[1] * v[1])],
    ]
  }

  it('grad exp(x^2 + y^2) from (4.5, 4.5) reaches the origin, not (2.49, 2.49)', () => {
    const r = newton(F, J, [4.5, 4.5])
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0])).toBeLessThan(1e-9)
    expect(Math.abs(r.x[1])).toBeLessThan(1e-9)
  })

  it('seeded roots of the same on [-5, 5]^2 with 6 per axis: only the origin', () => {
    const roots = seededRoots(F, J, { min: [-5, -5], max: [5, 5] }, 6)
    expect(roots).toHaveLength(1)
    expect(Math.abs(roots[0][0]) + Math.abs(roots[0][1])).toBeLessThan(1e-9)
  })

  it('x^2 + 1 from 3e6 has no real root and is not declared converged', () => {
    const r = newton(
      (v) => [v[0] * v[0] + 1],
      (v) => [[2 * v[0]]],
      [3e6]
    )
    expect(r.converged).toBe(false)
  })

  it('x e^x from 30 converges to 0', () => {
    const r = newton(
      (v) => [v[0] * Math.exp(v[0])],
      (v) => [[(1 + v[0]) * Math.exp(v[0])]],
      [30]
    )
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0])).toBeLessThan(1e-9)
  })
})
