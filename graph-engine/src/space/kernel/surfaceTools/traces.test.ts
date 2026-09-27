import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import { resolveBox } from '../../frame/bounds'
import { expectClose, expectParallel, kernelOf, labelOf, lineOf, meshOf, pointsOf, sceneOf, vertices } from './testing'

// f = x^2 - y^2 over the default [-5, 5]^2: its range [-25, 25] is already on
// multiples of niceStep(50, 8) = 5, so the box is [-5, 5]^2 x [-25, 25].
const F = 'f(x, y) = x^2 - y^2'

describe('trace: f at x = 1', () => {
  const scene = sceneOf(`${F}
trace: f at x = 1`)

  it('draws (1, y, 1 - y^2) over the whole y range, with y as its parameter', () => {
    expect(scene.errors).toEqual([])
    const curve = lineOf(scene, 's2')
    const points = vertices(curve.positions)
    expect(points).toHaveLength(513)
    expect([points[0][1], points[512][1]]).toEqual([-5, 5])
    for (const [i, [x, y, z]] of points.entries()) {
      expect(x).toBe(1)
      expect(y).toBe(curve.params![i])
      expect(Math.abs(z - (1 - y * y))).toBeLessThanOrEqual(1e-12)
    }
    expect(curve.pick!.param).toBe('y')
    expectClose(curve.pick!.dr(2), [0, 1, -4])
  })

  it('draws the slicing plane x = 1 across the box, at opacity 0.2', () => {
    const plane = meshOf(scene, 's2.plane')
    expect(plane.style.opacity).toBe(0.2)
    expect(vertices(plane.positions)).toEqual([
      [1, -5, -25],
      [1, 5, -25],
      [1, 5, 25],
      [1, -5, 25],
    ])
    expectClose(Array.from(plane.normals.subarray(0, 3)), [1, 0, 0])
  })

  it('copies the trace onto the back wall x = -5, dashed', () => {
    const wall = lineOf(scene, 's2.wall')
    expect(wall.style.dash).not.toBeNull()
    for (const [x, y, z] of vertices(wall.positions)) {
      expect(x).toBe(-5)
      expect(Math.abs(z - (1 - y * y))).toBeLessThanOrEqual(1e-12)
    }
  })

  it('draws no tangent unless asked', () => {
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s2', 's2.wall', 's2.plane'])
    expect(scene.labels).toEqual([])
  })
})

describe('trace: f at x = 1 tangent at y = 2', () => {
  const scene = sceneOf(`${F}
trace: f at x = 1 tangent at y = 2`)

  it('draws the tangent through (1, 2, -3) along (0, 1, -4), out to the box', () => {
    const [a, b] = vertices(lineOf(scene, 's2.tangent').positions)
    expectParallel([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 1, -4])
    expectParallel([a[0] - 1, a[1] - 2, a[2] + 3], [0, 1, -4])
    // (1, 2 + s, -3 - 4s) leaves the box at y = -5 (s = -7, z = 25) and at
    // y = 5 (s = 3, z = -15).
    expectClose([...a], [1, -5, 25])
    expectClose([...b], [1, 5, -15])
  })

  it('marks the point, and reads out the slope ∂f/∂y (1, 2) = −4', () => {
    expectClose(Array.from(pointsOf(scene, 's2.point').positions), [1, 2, -3])
    expect(labelOf(scene, 's2.slope').text).toBe('∂f/∂y (1, 2) = −4')
  })
})

describe('trace: f at y = 1 tangent at x = 2 (the roles swapped)', () => {
  const scene = sceneOf(`${F}
trace: f at y = 1 tangent at x = 2`)

  it('draws (x, 1, x^2 - 1), its copy on the wall y = -5, and the plane y = 1', () => {
    for (const [x, y, z] of vertices(lineOf(scene, 's2').positions)) {
      expect(y).toBe(1)
      expect(Math.abs(z - (x * x - 1))).toBeLessThanOrEqual(1e-12)
    }
    for (const [, y] of vertices(lineOf(scene, 's2.wall').positions)) expect(y).toBe(-5)
    for (const [, y] of vertices(meshOf(scene, 's2.plane').positions)) expect(y).toBe(1)
  })

  it('draws the tangent through (2, 1, 3) along (1, 0, 4), slope ∂f/∂x (2, 1) = 4', () => {
    const [a, b] = vertices(lineOf(scene, 's2.tangent').positions)
    expectParallel([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [1, 0, 4])
    expectParallel([a[0] - 2, a[1] - 1, a[2] - 3], [1, 0, 4])
    expect(labelOf(scene, 's2.slope').text).toBe('∂f/∂x (2, 1) = 4')
  })
})

describe('a trace through a pole (I3)', () => {
  it('leaves the frame as the surface alone makes it; the wall copy is sampled, carrying its parameter', () => {
    const surface = 'z = 1/(x^2 + y^2)'
    const spec = `${surface}
trace: 1/(x^2 + y^2) at x = 0`
    const frame = (text: string) => resolveBox(parseSpec(text).config.space, sceneOf(text).extent).z
    expect(frame(spec)).toEqual(frame(surface))
    const scene = sceneOf(spec)
    const wall = lineOf(scene, 's2.wall')
    expect(wall.params).not.toBeNull()
    expect(Array.from(wall.params!)).toEqual(Array.from(lineOf(scene, 's2').params!))
  })
})

describe('trace: refusals', () => {
  it('refuses a slice outside the domain, on its line', () => {
    expect(
      sceneOf(`${F}
trace: f at x = 7`).errors
    ).toEqual([{ line: 2, message: "trace: x = 7 is outside the domain's x range [−5, 5]" }])
  })

  it('reads the slice from a parameter, and follows it through setValue (M3)', () => {
    const kernel = kernelOf(`@param c = 3 range [0, 4]
${F}
trace: f at x = c over x in [0, 4], y in [-1, 1]`)
    for (const [x] of vertices(lineOf(kernel.scene(), 's3').positions)) expect(x).toBe(3)
    const moved = kernel.setValue('c', 1)
    expect(moved.errors).toEqual([])
    for (const [x, y, z] of vertices(lineOf(moved, 's3').positions)) {
      expect(x).toBe(1)
      expect(Math.abs(z - (1 - y * y))).toBeLessThanOrEqual(1e-12)
    }
  })

  it('refuses a tangent outside the domain, on its line (M2)', () => {
    expect(
      sceneOf(`${F}
trace: f at x = 1 tangent at y = 9`).errors
    ).toEqual([{ line: 2, message: "trace: tangent at y = 9 is outside the domain's y range [−5, 5]" }])
  })
})
