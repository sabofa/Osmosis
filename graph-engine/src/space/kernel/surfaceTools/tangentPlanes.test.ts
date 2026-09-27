import { describe, expect, it } from 'vitest'
import { arrowsOf, expectClose, expectParallel, kernelOf, labelOf, lineOf, meshOf, pointsOf, sceneOf, vertices } from './testing'

// f = x^2 - y^2 at (1, 2): f = -3, f_x = 2, f_y = -4, so
// L(x, y) = -3 + 2(x - 1) - 4(y - 2) (spec SP10).
const F = 'f(x, y) = x^2 - y^2'
const L = (x: number, y: number) => -3 + 2 * (x - 1) - 4 * (y - 2)

describe('tangent-plane: f at (1, 2)', () => {
  const scene = sceneOf(`${F}
tangent-plane: f at (1, 2)`)

  it('draws L over the square of half-side 0.2 x 10 = 2 about (1, 2), at opacity 0.5', () => {
    expect(scene.errors).toEqual([])
    const mesh = meshOf(scene, 's2')
    expect(mesh.style.opacity).toBe(0.5)
    const points = vertices(mesh.positions)
    expect(points.map(([x, y]) => [x, y])).toEqual([
      [-1, 0],
      [3, 0],
      [3, 4],
      [-1, 4],
    ])
    for (const [x, y, z] of points) expect(Math.abs(z - L(x, y))).toBeLessThanOrEqual(1e-12)
    expectParallel(Array.from(mesh.normals.subarray(0, 3)), [-2, 4, 1])
  })

  it('outlines it, and marks the point (1, 2, -3)', () => {
    // A closed polyline: the four corners and the first again.
    const outline = vertices(lineOf(scene, 's2.outline').positions)
    expect(outline).toEqual([...vertices(meshOf(scene, 's2').positions), vertices(meshOf(scene, 's2').positions)[0]])
    expectClose(Array.from(pointsOf(scene, 's2.point').positions), [1, 2, -3])
  })

  it('reads out L with its signs folded in, at the corner nearest the default camera', () => {
    const readout = labelOf(scene, 's2.readout')
    expect(readout.text).toBe('L(x, y) = −3 + 2(x − 1) − 4(y − 2)')
    // the greatest x + y: (3, 4), where L = -3 + 4 - 8 = -7
    expectClose([...readout.position], [3, 4, -7])
  })

  it('draws no normal unless asked', () => {
    expect(scene.marks.some((m) => m.source.object === 's2.normal')).toBe(false)
  })
})

describe('tangent-plane: f at (1, 2) normal', () => {
  it('adds the arrow along (-f_x, -f_y, 1) = (-2, 4, 1), 0.18 x the largest box span (50) = 9 long', () => {
    const arrow = arrowsOf(sceneOf(`${F}
tangent-plane: f at (1, 2) normal`), 's2.normal')
    expectClose(Array.from(arrow.tails), [1, 2, -3])
    const v = Array.from(arrow.vectors)
    expectParallel(v, [-2, 4, 1])
    expect(v[2]).toBeGreaterThan(0)
    expect(Math.abs(Math.hypot(...v) - 9)).toBeLessThanOrEqual(1e-12)
  })
})

describe('the patch is clipped to the box', () => {
  it('under @bounds3d z [-10, 10] the corner (-1, 4), where L = -15, is cut off: a pentagon, still on L', () => {
    const mesh = meshOf(sceneOf(`@bounds3d: z [-10, 10]
${F}
tangent-plane: f at (1, 2)`), 's3')
    const points = vertices(mesh.positions)
    expect(points).toHaveLength(5)
    expect(mesh.indices.length / 3).toBe(3)
    for (const [x, y, z] of points) {
      expect(Math.abs(z - L(x, y))).toBeLessThanOrEqual(1e-12)
      expect(z).toBeGreaterThanOrEqual(-10 - 1e-12)
    }
    expect(points.filter(([, , z]) => Math.abs(z + 10) <= 1e-12)).toHaveLength(2)
  })
})

describe('tangent-plane of a function of three variables', () => {
  const scene = sceneOf('tangent-plane: x^2 + y^2 + z^2 at (1, 1, 1)')

  it('is the plane through the point with normal ∇F = (2, 2, 2) ∝ (1, 1, 1)', () => {
    expect(scene.errors).toEqual([])
    const mesh = meshOf(scene, 's1')
    const points = vertices(mesh.positions)
    expect(points).toHaveLength(4)
    for (const [x, y, z] of points) expect(Math.abs(x - 1 + (y - 1) + (z - 1))).toBeLessThanOrEqual(1e-12)
    expectParallel(Array.from(mesh.normals.subarray(0, 3)), [1, 1, 1])
    // The point is the centre of the square patch, so it is on it.
    const centre = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k], 0) / 4)
    expectClose(centre, [1, 1, 1])
    expectClose(Array.from(pointsOf(scene, 's1.point').positions), [1, 1, 1])
  })

  it('reads out the plane and F at the point', () => {
    expect(labelOf(scene, 's1.readout').text).toBe('2(x − 1) + 2(y − 1) + 2(z − 1) = 0, F(1, 1, 1) = 3')
  })

  it('refuses a point where ∇F = 0', () => {
    expect(sceneOf('tangent-plane: x^2 + y^2 + z^2 at (0, 0, 0)').errors).toEqual([
      { line: 1, message: 'tangent-plane: ∇F is zero at (0, 0, 0); the tangent plane is undefined' },
    ])
  })
})

describe('tangent-plane with parameters', () => {
  it('moves with setValue: a = 0 puts the point at (0, 2, -4)', () => {
    const kernel = kernelOf(`@param a = 1 range [0, 2]
${F}
tangent-plane: f at (a, 2)`)
    expectClose(Array.from(pointsOf(kernel.scene(), 's3.point').positions), [1, 2, -3])
    const scene = kernel.setValue('a', 0)
    expect(scene.errors).toEqual([])
    expectClose(Array.from(pointsOf(scene, 's3.point').positions), [0, 2, -4])
    // f_x(0, 2) = 0 drops out; the offset a = 0 prints as x alone
    expect(labelOf(scene, 's3.readout').text).toBe('L(x, y) = −4 − 4(y − 2)')
  })
})

describe('tangent-plane readouts drop rounding noise', () => {
  it('sin(x) at (π/2, 0): f_x = cos(π/2) is 6.1×10⁻¹⁷, not a term — L(x, y) = 1', () => {
    expect(labelOf(sceneOf('tangent-plane: sin(x) at (pi/2, 0)'), 's1.readout').text).toBe('L(x, y) = 1')
  })

  it('in three variables too: x^2 + y^2 + sin(z) at (1, 1, π/2) has no z term', () => {
    expect(labelOf(sceneOf('tangent-plane: x^2 + y^2 + sin(z) at (1, 1, pi/2)'), 's1.readout').text).toBe(
      '2(x − 1) + 2(y − 1) = 0, F(1, 1, 1.571) = 3'
    )
  })
})

describe('tangent-plane refusals', () => {
  it('refuses a point outside the domain, or the box (M2)', () => {
    expect(sceneOf('tangent-plane: x^2 - y^2 at (6, 0)').errors).toEqual([{ line: 1, message: 'tangent-plane: (6, 0) is outside the domain' }])
    expect(sceneOf('tangent-plane: x^2 + y^2 + z^2 at (1, 1, 9)').errors).toEqual([{ line: 1, message: 'tangent-plane: (1, 1, 9) is outside the box' }])
  })

  it('refuses a point with the wrong number of coordinates', () => {
    expect(
      sceneOf(`${F}
tangent-plane: f at (1, 2, 3)`).errors.map((e) => e.message)
    ).toEqual(['tangent-plane: a function of x and y takes a point (a, b), got 3 coordinates'])
  })
})
