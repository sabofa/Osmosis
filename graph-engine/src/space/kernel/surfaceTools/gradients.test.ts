import { describe, expect, it } from 'vitest'
import { arrowsOf, expectClose, expectParallel, kernelOf, labelOf, lineOf, pointsOf, sceneOf, vertices } from './testing'

// f = x^2 - y^2 at (1, 2): ∇f = (2, -4), |∇f| = √20 = 4.472, f = -3. Over
// [-5, 5]^2 the box floor is z = -25.

// The distance from p to the nearest segment of a polyline in the plane.
function distanceToPolyline(p: readonly number[], points: readonly (readonly number[])[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]))
  }
  return best
}

describe('gradient: x^2 - y^2 at (1, 2)', () => {
  const scene = sceneOf('gradient: x^2 - y^2 at (1, 2)')

  it('draws ∇f = (2, -4, 0) at true length from (1, 2) on the floor', () => {
    expect(scene.errors).toEqual([])
    const arrow = arrowsOf(scene, 's1')
    expect(Array.from(arrow.tails)).toEqual([1, 2, -25])
    expect(Array.from(arrow.vectors)).toEqual([2, -4, 0])
  })

  it('draws the level curve through (1, 2) on the floor: x^2 - y^2 = -3', () => {
    const level = lineOf(scene, 's1.level')
    const points = vertices(level.positions)
    for (const [x, y, z] of points) {
      expect(z).toBe(-25)
      expect(Math.abs(x * x - y * y + 3)).toBeLessThanOrEqual(1e-8)
    }
    // The branch through (1, 2) is one polyline; (1, 2) is on it to the
    // chord error of a 1/16 grid.
    let nearest = Infinity
    for (let k = 0; k < level.starts.length; k++) {
      const end = k + 1 < level.starts.length ? level.starts[k + 1] : points.length
      nearest = Math.min(nearest, distanceToPolyline([1, 2], points.slice(level.starts[k], end)))
    }
    expect(nearest).toBeLessThan(1e-3)
  })

  it('marks the right angle where they meet: sides of 0.04 x 10 = 0.4 along the level curve and along ∇f', () => {
    const [t, corner, g] = vertices(lineOf(scene, 's1.square').positions)
    for (const v of [t, corner, g]) expect(v[2]).toBe(-25)
    const along = [t[0] - 1, t[1] - 2]
    const up = [g[0] - 1, g[1] - 2]
    expectParallel(up, [2, -4])
    expect(up[0] * 2 + up[1] * -4).toBeGreaterThan(0)
    expect(Math.abs(along[0] * 2 + along[1] * -4)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(Math.hypot(...along) - 0.4)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(Math.hypot(...up) - 0.4)).toBeLessThanOrEqual(1e-12)
    expectClose([corner[0] - t[0], corner[1] - t[1]], up)
  })

  it('reads out ∇f, |∇f| = √20 and the direction of steepest ascent, atan2(-4, 2)', () => {
    expect(labelOf(scene, 's1.readout').text).toBe('∇f = (2, −4), |∇f| = 4.472, steepest ascent at θ = −1.107 rad')
  })

  it('gives the angle in degrees under @angle: degrees', () => {
    expect(labelOf(sceneOf('@angle: degrees\ngradient: x^2 - y^2 at (1, 2)'), 's2.readout').text).toBe(
      '∇f = (2, −4), |∇f| = 4.472, steepest ascent at θ = −63.43°'
    )
  })
})

describe('gradient: … lifted', () => {
  it('puts the arrow and the level curve in the plane z = f(1, 2) = -3', () => {
    const scene = sceneOf('gradient: x^2 - y^2 at (1, 2) lifted')
    expect(Array.from(arrowsOf(scene, 's1').tails)).toEqual([1, 2, -3])
    for (const [, , z] of vertices(lineOf(scene, 's1.level').positions)) expect(z).toBe(-3)
  })
})

describe('gradient of a function of three variables', () => {
  it('gradient: xyz at (1, 2, 3) is the arrow (yz, xz, xy) = (6, 3, 2) from the point, |∇F| = 7', () => {
    const scene = sceneOf('gradient: x*y*z at (1, 2, 3)')
    expect(scene.errors).toEqual([])
    const arrow = arrowsOf(scene, 's1')
    expect(Array.from(arrow.tails)).toEqual([1, 2, 3])
    expect(Array.from(arrow.vectors)).toEqual([6, 3, 2])
    expect(labelOf(scene, 's1.readout').text).toBe('∇F = (6, 3, 2), |∇F| = 7')
  })

  it('"surface" is an error on its line until S4a’s marching tetrahedra merge; the arrow still draws', () => {
    const scene = sceneOf('gradient: x*y*z at (1, 2, 3) surface')
    expect(scene.errors).toEqual([{ line: 1, message: 'gradient: … surface — the level surface arrives with phase S4a (marching tetrahedra)' }])
    expect(Array.from(arrowsOf(scene, 's1').vectors)).toEqual([6, 3, 2])
  })
})

describe('gradient: points outside, and parameters', () => {
  it('refuses a point outside the domain, or the box (M2)', () => {
    expect(sceneOf('gradient: x^2 - y^2 at (7, 0)').errors).toEqual([{ line: 1, message: 'gradient: (7, 0) is outside the domain' }])
    expect(sceneOf('gradient: x*y*z at (1, 2, 9)').errors).toEqual([{ line: 1, message: 'gradient: (1, 2, 9) is outside the box' }])
  })

  it('rebuilds when the point reads a parameter (M3): a = 1/2 moves the arrow to (1/2, 2), ∇f = (1, -4)', () => {
    const kernel = kernelOf(`@param a = 1 range [-2, 2]
gradient: x^2 - y^2 at (a, 2)`)
    const scene = kernel.setValue('a', 0.5)
    const arrow = arrowsOf(scene, 's2')
    expect(Array.from(arrow.tails)).toEqual([0.5, 2, -25])
    expect(Array.from(arrow.vectors)).toEqual([1, -4, 0])
  })
})

describe('a zero gradient', () => {
  it('draws the point and the readout "∇f = 0 (a critical point)", and no arrow', () => {
    // x^2 + y^2 on [-5, 5]^2 ranges over [0, 50]: the floor is 0.
    const scene = sceneOf('gradient: x^2 + y^2 at (0, 0)')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.point'])
    expect(Array.from(pointsOf(scene, 's1.point').positions)).toEqual([0, 0, 0])
    expect(labelOf(scene, 's1.readout').text).toBe('∇f = 0 (a critical point)')
  })
})
