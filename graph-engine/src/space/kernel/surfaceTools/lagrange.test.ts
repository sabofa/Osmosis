import { describe, expect, it } from 'vitest'
import { choose, crossingSeeds, evenly } from './lagrange'
import { arrowsOf, expectClose, expectParallel, labelOf, lineOf, pointsOf, sceneOf, vertices } from './testing'

// max x + y on x^2 + y^2 = 1: ∇f = (1, 1) = λ(2x, 2y), so x = y = 1/(2λ) and
// 2/(4λ^2) = 1: λ = √2/2 at (√2/2, √2/2), where f = √2. The min is the
// opposite point, with λ = -√2/2.
const H = Math.SQRT1_2
const R2 = Math.SQRT2

describe('lagrange: max x + y subject to x^2 + y^2 = 1', () => {
  const scene = sceneOf('lagrange: max x + y subject to x^2 + y^2 = 1')

  it('finds (√2/2, √2/2), f = √2, λ = √2/2 — once', () => {
    expect(scene.errors).toEqual([])
    const lifted = vertices(pointsOf(scene, 's1.points').positions)
    expect(lifted).toHaveLength(1)
    expectClose([...lifted[0]], [H, H, R2], 1e-12)
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (0.7071, 0.7071), f ≈ 1.414, λ ≈ 0.7071')
  })

  it('draws the constraint on the floor, and lifted onto z = f', () => {
    // x + y on [-5, 5]^2 ranges over [-10, 10]: the floor is -10.
    for (const [x, y, z] of vertices(lineOf(scene, 's1.constraint').positions)) {
      expect(z).toBe(-10)
      expect(Math.abs(x * x + y * y - 1)).toBeLessThanOrEqual(1e-8)
    }
    for (const [x, y, z] of vertices(lineOf(scene, 's1').positions)) expect(Math.abs(z - (x + y))).toBeLessThanOrEqual(1e-15)
  })

  it("draws f's level curve through the point, x + y = √2, on the floor", () => {
    for (const [x, y, z] of vertices(lineOf(scene, 's1.level0').positions)) {
      expect(z).toBe(-10)
      expect(Math.abs(x + y - R2)).toBeLessThanOrEqual(1e-8)
    }
  })

  it('marks the point on the floor with ∇f (0.15 x 20 = 3 long) and ∇g (0.6 x 3 = 1.8), parallel', () => {
    expectClose(Array.from(pointsOf(scene, 's1.floorPoints').positions), [H, H, -10], 1e-12)
    for (const [object, length] of [
      ['s1.gradf0', 3],
      ['s1.gradg0', 1.8],
    ] as const) {
      const arrow = arrowsOf(scene, object)
      expectClose(Array.from(arrow.tails), [H, H, -10], 1e-12)
      const v = Array.from(arrow.vectors)
      expectParallel(v, [1, 1, 0], 1e-12)
      expect(v[0]).toBeGreaterThan(0)
      expect(Math.abs(Math.hypot(...v) - length)).toBeLessThanOrEqual(1e-12)
    }
    expect([labelOf(scene, 's1.gradf0.label').text, labelOf(scene, 's1.gradg0.label').text]).toEqual(['∇f', '∇g'])
  })
})

describe('lagrange: min and extrema', () => {
  it('min finds (-√2/2, -√2/2), f = -√2, λ = -√2/2', () => {
    const scene = sceneOf('lagrange: min x + y subject to x^2 + y^2 = 1')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2], 1e-12)
    expect(scene.labels.filter((l) => l.kind === 'annotation').map((l) => l.text)).toEqual(['min ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071'])
  })

  it('extrema finds both, in lexicographic order', () => {
    const scene = sceneOf('lagrange: extrema x + y subject to x^2 + y^2 = 1')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2, H, H, R2], 1e-12)
    expect(scene.labels.filter((l) => l.kind === 'annotation').map((l) => l.text)).toEqual([
      'min ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071',
      'max ≈ (0.7071, 0.7071), f ≈ 1.414, λ ≈ 0.7071',
    ])
  })
})

describe('lagrange in three variables', () => {
  // ∇f = (1, 2, 2) = λ(2x, 2y, 2z): x = 1/(2λ), y = z = 1/λ, and
  // (1/4 + 2)/λ^2 = 9 gives λ = 1/2 at (1, 2, 2), f = 1 + 4 + 4 = 9.
  const scene = sceneOf('lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9')

  it('finds (1, 2, 2), f = 9, λ = 1/2', () => {
    expect(scene.errors).toEqual([])
    expectClose(Array.from(pointsOf(scene, 's1').positions), [1, 2, 2], 1e-12)
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (1, 2, 2), f ≈ 9, λ ≈ 0.5')
  })

  it('marks it with ∇f (0.15 x 10 = 1.5 long) and ∇g (0.9), both along (1, 2, 2)', () => {
    for (const [object, length] of [
      ['s1.gradf0', 1.5],
      ['s1.gradg0', 0.9],
    ] as const) {
      const v = Array.from(arrowsOf(scene, object).vectors)
      expectParallel(v, [1, 2, 2], 1e-12)
      expect(v[0]).toBeGreaterThan(0)
      expect(Math.abs(Math.hypot(...v) - length)).toBeLessThanOrEqual(1e-12)
    }
  })
})

describe('lagrange over a domain', () => {
  it('keeps only the solutions inside it: with x <= 0.2, Newton from the arc’s end reaches (√2/2, √2/2), which is dropped', () => {
    const scene = sceneOf('lagrange: extrema x + y subject to x^2 + y^2 = 1 over x in [-1, 0.2], y in [-1, 1]')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2], 1e-12)
    // the one solution left is the greatest and the least found at once
    expect(labelOf(scene, 's1.p0').text).toBe('extremum ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071')
  })
})

describe('lagrange: refusals', () => {
  it('an infeasible constraint is an error on its line', () => {
    expect(sceneOf('lagrange: max x + y subject to x^2 + y^2 = -1').errors).toEqual([
      { line: 1, message: 'lagrange: no constrained extremum found; try a tighter @bounds3d' },
    ])
  })
})

describe('lagrange helpers', () => {
  it('evenly takes up to n items spread through the list', () => {
    expect(evenly([0, 1, 2, 3, 4, 5, 6, 7], 4)).toEqual([0, 2, 4, 6])
    expect(evenly([0, 1], 4)).toEqual([0, 1])
  })

  it('choose keeps a tie within 1e-9 of the best, and nothing else', () => {
    const s = (f: number) => ({ at: [f], lambda: 0, f })
    expect(choose([s(1), s(1 + 1e-12), s(0.5)], 'max').map((k) => k.s.f)).toEqual([1, 1 + 1e-12])
    expect(choose([s(1), s(0.5), s(0.5)], 'min').map((k) => k.s.f)).toEqual([0.5, 0.5])
    expect(choose([s(1), s(0.7), s(0.5)], 'extrema').map((k) => k.kind)).toEqual(['max', 'min'])
    expect(choose([s(0.7)], 'extrema').map((k) => k.kind)).toEqual(['extremum'])
    expect(choose([s(0.7)], 'max').map((k) => k.kind)).toEqual(['max'])
  })

  it('crossingSeeds finds a plane where the grid edges cross it', () => {
    // x = 0.3 in [-1, 1]^3 on a 4-cube grid: one crossing on each of the
    // 5 x 5 x-edges between x = 0 and x = 0.5.
    const seeds = crossingSeeds((x) => x - 0.3, { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }, 4)
    expect(seeds).toHaveLength(25)
    for (const [x] of seeds) expect(Math.abs(x - 0.3)).toBeLessThanOrEqual(1e-15)
  })
})
