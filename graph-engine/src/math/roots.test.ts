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
