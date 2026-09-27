import { describe, expect, it } from 'vitest'
import { expectClose, kernelOf, labelOf, lineOf, pointsOf, sceneOf, vertices } from './testing'

// f = xy / (x^2 + y^2) has no limit at the origin: 1/2 along y = x, 0 along
// y = 0 (OpenStax 4.2).
const F = 'x*y/(x^2 + y^2)'

describe('path: on xy/(x^2 + y^2) along (t, t) for t in [0, 1] toward (0, 0)', () => {
  const scene = sceneOf(`path: on ${F} along (t, t) for t in [0, 1] toward (0, 0)`)

  it('lifts the curve onto the surface: every vertex is (t, t, 1/2)', () => {
    expect(scene.errors).toEqual([])
    const curve = lineOf(scene, 's1')
    const points = vertices(curve.positions)
    // t = 0 is 0/0, dropped: 512 segments leave 512 vertices.
    expect(points).toHaveLength(512)
    for (const [i, [x, y, z]] of points.entries()) {
      expect(x).toBe(curve.params![i])
      expect(y).toBe(x)
      expect(Math.abs(z - 0.5)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('carries a pick with r and its symbolic derivative', () => {
    const pick = lineOf(scene, 's1').pick!
    expect(pick.param).toBe('t')
    expectClose(pick.r(0.5), [0.5, 0.5, 0.5])
    // d/dt (t, t, t^2 / (2 t^2)) = (1, 1, 0)
    expectClose(pick.dr(0.5), [1, 1, 0])
  })

  it('shadows it on the box floor, dashed: the range [-1/2, 1/2] rounds out to itself (step 0.1), so z = -1/2', () => {
    const shadow = lineOf(scene, 's1.shadow')
    expect(shadow.style.dash).not.toBeNull()
    for (const [x, y, z] of vertices(shadow.positions)) {
      expect(y).toBe(x)
      expect(z).toBe(-0.5)
    }
  })

  it('marks (0, 0) on the floor, and rings where the path is heading: f → ≈ 0.5', () => {
    expectClose(Array.from(pointsOf(scene, 's1.toward').positions), [0, 0, -0.5])
    const ring = pointsOf(scene, 's1.limit')
    expect(ring.style.shape).toBe('ring')
    expectClose(Array.from(ring.positions), [0, 0, 0.5])
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0.5')
  })
})

describe('the same surface along (t, 0)', () => {
  it('heads to 0, which is where the two paths disagree', () => {
    const scene = sceneOf(`path: on ${F} along (t, 0) for t in [0, 1] toward (0, 0)`)
    for (const [, , z] of vertices(lineOf(scene, 's1').positions)) expect(z).toBe(0)
    expectClose(Array.from(pointsOf(scene, 's1.limit').positions), [0, 0, 0])
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0')
  })

  it('approaches whichever end is nearer the target: x + y along (t, t), t in [0, 1], toward (1, 1) heads to 2, not to 0', () => {
    // The last approach is t = 1 - 1e-8, where x + y = 2 - 2e-8.
    const scene = sceneOf(`path: on x + y along (t, t) for t in [0, 1] toward (1, 1)`)
    expectClose(Array.from(pointsOf(scene, 's1.limit').positions), [1, 1, 2], 1e-7)
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 2')
  })
})

describe('path: on a defined f, with a parameter', () => {
  it('reads f(x, y), and rebuilds when the parameter moves', () => {
    const kernel = kernelOf(`@param k = 1 range [0, 2]
f(x, y) = x*y
path: on f along (t, k*t) for t in [0, 1]`)
    const at = (scene: ReturnType<typeof kernel.scene>) => vertices(lineOf(scene, 's3').positions)
    for (const [x, , z] of at(kernel.scene())) expect(Math.abs(z - x * x)).toBeLessThanOrEqual(1e-15)
    const moved = kernel.setValue('k', 2)
    expect(moved.errors).toEqual([])
    for (const [x, y, z] of at(moved)) {
      expect(y).toBe(2 * x)
      expect(Math.abs(z - 2 * x * x)).toBeLessThanOrEqual(1e-15)
    }
  })
})

describe('path: refusals', () => {
  it('refuses a target of three variables, on its line', () => {
    const scene = sceneOf(`z = x
path: on x*y*z along (t, t) for t in [0, 1]`)
    expect(scene.errors).toEqual([{ line: 2, message: 'path: needs a function of x and y, and this one reads z' }])
  })

  it('refuses a one-variable function by name', () => {
    const scene = sceneOf(`g(x) = x^2
path: on g along (t, t) for t in [0, 1]`)
    expect(scene.errors.map((e) => e.message)).toEqual(['"g" is a function of one variable — path: needs a function of x and y, e.g. "g(x, y) = …"'])
  })
})
