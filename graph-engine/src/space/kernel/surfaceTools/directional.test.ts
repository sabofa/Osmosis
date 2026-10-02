import { describe, expect, it } from 'vitest'
import { arrowsOf, expectClose, expectParallel, kernelOf, labelOf, lineOf, meshOf, pointsOf, sceneOf, vertices } from './testing'

// f = x^2 - y^2 at (1, 2) toward <3, 4>: u = (0.6, 0.8), ∇f = (2, -4),
// D_u f = 2(0.6) + (-4)(0.8) = -2. The tool is drawn beside its surface,
// which sizes the box (the box pass, J1): z = x^2 - y^2 over [-5, 5]^2,
// written after the tool, makes it [-5, 5]^2 x [-25, 25].
const SPEC = 'directional: x^2 - y^2 at (1, 2) toward <3, 4>'
const SADDLE = '\nz = x^2 - y^2'

describe(SPEC, () => {
  const scene = sceneOf(SPEC + SADDLE)

  it('reads out D_u f = -2 with the unit u and ∇f', () => {
    expect(scene.errors).toEqual([])
    expect(labelOf(scene, 's1.readout').text).toBe('D_u f = −2, u = (0.6, 0.8), ∇f = (2, −4)')
  })

  it('draws the unit arrow u on the floor from (1, 2)', () => {
    const u = arrowsOf(scene, 's1.u')
    expect(Array.from(u.tails)).toEqual([1, 2, -25])
    expectClose(Array.from(u.vectors), [0.6, 0.8, 0])
  })

  it('draws the trace along u through (1, 2, -3), on the surface and in the vertical plane', () => {
    const curve = lineOf(scene, 's1')
    expectClose([...curve.pick!.r(0)], [1, 2, -3])
    for (const [x, y, z] of vertices(curve.positions)) {
      expect(Math.abs((x - 1) * 0.8 - (y - 2) * 0.6)).toBeLessThanOrEqual(1e-12)
      expect(Math.abs(z - (x * x - y * y))).toBeLessThanOrEqual(1e-12)
    }
    // Along u the slope at s = 0 is D_u f.
    expectClose([...curve.pick!.dr(0)], [0.6, 0.8, -2])
    // It spans the domain: s from -8.75 (y = -5) to 3.75 (y = 5).
    expectClose([curve.params![0], curve.params![curve.params!.length - 1]], [-8.75, 3.75])
  })

  it('draws the tangent at (1, 2, -3) with slope -2 along u', () => {
    const [a, b] = vertices(lineOf(scene, 's1.tangent').positions)
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    expectParallel(d, [0.6, 0.8, -2])
    expect(Math.abs(d[2] / Math.hypot(d[0], d[1]) + 2)).toBeLessThanOrEqual(1e-12)
    expectParallel([a[0] - 1, a[1] - 2, a[2] + 3], [0.6, 0.8, -2])
    expectClose(Array.from(pointsOf(scene, 's1.point').positions), [1, 2, -3])
  })

  it('draws the vertical plane through (1, 2) along u across the box, at opacity 0.2', () => {
    const plane = meshOf(scene, 's1.plane')
    expect(plane.style.opacity).toBe(0.2)
    const corners = vertices(plane.positions)
    expect(corners.map((c) => c[2])).toEqual([-25, -25, 25, 25])
    for (const [x, y] of corners) expect(Math.abs((x - 1) * 0.8 - (y - 2) * 0.6)).toBeLessThanOrEqual(1e-12)
    // (1, 2) + s (0.6, 0.8) leaves [-5, 5]^2 at y = -5 (s = -8.75) and y = 5
    // (s = 3.75).
    expectClose([corners[0][0], corners[0][1]], [1 - 8.75 * 0.6, -5])
    expectClose([corners[1][0], corners[1][1]], [1 + 3.75 * 0.6, 5])
  })
})

describe('the directional trace is cut to the box', () => {
  it('under @bounds3d z [0, 2], x^2 + y^2 along y = 0 from (1, 0) keeps to z <= 2, entering and leaving at x = ±√2', () => {
    const curve = lineOf(sceneOf('@bounds3d: z [0, 2]\ndirectional: x^2 + y^2 at (1, 0) toward <1, 0>'), 's2')
    const points = vertices(curve.positions)
    for (const [, , z] of points) expect(z).toBeLessThanOrEqual(2 + 1e-12)
    expectClose([points[0][0], points[points.length - 1][0]], [-Math.SQRT2, Math.SQRT2], 1e-3)
  })
})

describe('directional: refusals and parameters', () => {
  it('refuses a point outside the domain, on its line (M2)', () => {
    expect(sceneOf('directional: x^2 - y^2 at (7, 0) toward <1, 0>').errors).toEqual([{ line: 1, message: 'directional: (7, 0) is outside the domain' }])
  })

  it('refuses a zero u, on its line', () => {
    expect(sceneOf('directional: x^2 - y^2 at (1, 2) toward <0, 0>').errors).toEqual([
      { line: 1, message: 'directional: the direction ⟨0, 0⟩ has no length — give a nonzero u' },
    ])
  })

  it('reads u from a parameter: k = 0 is refused, and k = 2 draws u = (1, 0)', () => {
    const kernel = kernelOf(`@param k = 1 range [0, 5]
directional: x^2 - y^2 at (1, 2) toward <k, 0>`)
    expect(kernel.setValue('k', 0).errors.map((e) => e.line)).toEqual([2])
    const scene = kernel.setValue('k', 2)
    expect(scene.errors).toEqual([])
    expect(labelOf(scene, 's2.readout').text).toBe('D_u f = 2, u = (1, 0), ∇f = (2, −4)')
  })

  it('refuses a function of three variables', () => {
    expect(sceneOf('directional: x*y*z at (1, 2) toward <1, 0>').errors.map((e) => e.message)).toEqual([
      'directional: needs a function of x and y, and this one reads z',
    ])
  })
})

// Fix round 1 on the box pass (Important 1): over x in [0, 2], y in [0, 2]
// the vertical plane, the trace and the tangent span that rectangle, not the
// scene's [-5, 5].
describe('directional over a rectangle', () => {
  it('directional: x^2 - y^2 at (1, 1) toward <1, 0> over x in [0, 2], y in [0, 2] spans x in [0, 2]', () => {
    const scene = sceneOf('directional: x^2 - y^2 at (1, 1) toward <1, 0> over x in [0, 2], y in [0, 2]')
    expect(scene.errors).toEqual([])
    const xs = (object: string) => {
      const mark = scene.marks.find((m) => m.source.object === object)
      if (!mark || (mark.kind !== 'lines' && mark.kind !== 'mesh')) throw new Error('no line or mesh ' + object)
      return vertices(mark.positions).map((p) => p[0])
    }
    for (const object of ['s1.plane', 's1', 's1.tangent']) {
      const x = xs(object)
      expect([Math.min(...x), Math.max(...x)]).toEqual([0, 2])
    }
  })
})
