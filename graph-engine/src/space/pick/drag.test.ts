import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { cameraMatrices, project } from '../camera/projection'
import { worldMap } from '../camera/world'
import { createSpaceKernel } from '../kernel/index'
import type { Box3, PointMark, Vec3 } from '../scene/types'
import { screenJacobian, solveDrag } from './drag'

function kernelOf(spec: string) {
  const parsed = parseSpec(spec)
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

function points(spec: string): PointMark[] {
  return kernelOf(spec)
    .scene()
    .marks.filter((m): m is PointMark => m.kind === 'points')
}

const BINDINGS = '@param a = 0 range [-3, 3]\n@param b = 0 range [-3, 3]\n@param c = 0 range [-3, 3]\n'

describe('the drag descriptor (kernel)', () => {
  it('P = (a, b, a^2 + b^2) drags a and b; its position and Jacobian are exact at any values', () => {
    const kernel = kernelOf(`${BINDINGS}P = (a, b, a^2 + b^2)`)
    const p = kernel.scene().marks.find((m): m is PointMark => m.kind === 'points')!
    expect(p.drag?.params).toEqual(['a', 'b'])
    const at = Float64Array.from([1, 2])
    expect(p.drag!.position(at)).toEqual([1, 2, 5])
    // d(x, y, z)/d(a, b) = [[1, 0], [0, 1], [2a, 2b]] = [[1, 0], [0, 1], [2, 4]].
    expect(Array.from(p.drag!.jacobian(at))).toEqual([1, 0, 0, 1, 2, 4])
    // The live values are untouched: the kernel still has a = b = 0.
    expect([kernel.values().get('a'), kernel.values().get('b')]).toEqual([0, 0])
    expect(Array.from(p.positions)).toEqual([0, 0, 0])
    expect(p.drag!.position(Float64Array.from([0, 0]))).toEqual([0, 0, 0])
  })

  it('follows a binding through a user function: f(x, y) = x^2 + y^2, P = (a, b, f(a, b))', () => {
    const [p] = points(`${BINDINGS}f(x, y) = x^2 + y^2\nP = (a, b, f(a, b))`)
    expect(p.drag?.params).toEqual(['a', 'b'])
    expect(Array.from(p.drag!.jacobian(Float64Array.from([1, -1])))).toEqual([1, 0, 0, 1, 2, -2])
  })

  it('gives A = (1, 2, 3) no drag, and none to a point reading three bindings', () => {
    const [fixed, three, one] = points(`${BINDINGS}A = (1, 2, 3)\nQ = (a, b, c)\nR = (a, 0, 0)`)
    expect(fixed.drag).toBeUndefined()
    expect(three.drag).toBeUndefined()
    expect(one.drag?.params).toEqual(['a'])
  })
})

describe('solveDrag', () => {
  const box: Box3 = { x: { min: -3, max: 3 }, y: { min: -3, max: 3 }, z: { min: 0, max: 10 } }
  const world = worldMap(box, [1, 1, 0.7])
  const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
  const [p] = points(`${BINDINGS}P = (a, b, a^2 + b^2)`)
  const target: Vec3 = [1, 2, 5]
  const cursor = project(camera, world.toWorld(target))

  it('matches project() and its derivative (checked against a central difference in a test)', () => {
    const q: Vec3 = [0.5, -1, 3]
    const s = screenJacobian(camera, world, q)
    const at = project(camera, world.toWorld(q))
    expect(s.x).toBeCloseTo(at.x, 9)
    expect(s.y).toBeCloseTo(at.y, 9)
    const h = 1e-6
    for (let j = 0; j < 3; j++) {
      const plus = [...q] as [number, number, number]
      const minus = [...q] as [number, number, number]
      plus[j] += h
      minus[j] -= h
      const a = project(camera, world.toWorld(plus))
      const b = project(camera, world.toWorld(minus))
      expect(s.d[j]).toBeCloseTo((a.x - b.x) / (2 * h), 4)
      expect(s.d[3 + j]).toBeCloseTo((a.y - b.y) / (2 * h), 4)
    }
  })

  it('in the default orthographic view, takes (0.5, 1.5) to a = 1, b = 2 within 1e-6 in at most 8 iterations', () => {
    // The line of sight through (1, 2, 5)'s pixel meets the bowl twice: at
    // (1, 2, 5), in front, and at (1 + s u, 2 + s v) behind it, where (u, v, w)
    // is the eye direction in author units and s = (w - 2u - 4v)/(u^2 + v^2).
    // The plan's start, (0, 0), is the bowl's bottom, hidden behind its front
    // rim at this view: the solver starts from the current values (a drag is
    // continuous), so from there the nearer answer is the one behind. (0.5,
    // 1.5) is on the visible side, like a point a reader can grab.
    const d = camera.direction
    const [u, v, w] = [0, 1, 2].map((i) => d[i] / world.scale[i])
    const s = (w - 2 * u - 4 * v) / (u * u + v * v)
    expect(s).toBeLessThan(0)
    const ranges = [
      { min: -3, max: 3 },
      { min: -3, max: 3 },
    ]
    const solution = solveDrag(p.drag!, [0.5, 1.5], cursor, camera, world, ranges)
    expect(solution.iterations).toBeLessThanOrEqual(8)
    expect(Math.abs(solution.values[0] - 1)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(solution.values[1] - 2)).toBeLessThanOrEqual(1e-6)
    expect(solution.residual).toBeLessThan(1e-6)
  })

  it('clamps to the ranges when the cursor is beyond them: b stops at 1.5', () => {
    const ranges = [
      { min: 0, max: 1.5 },
      { min: 0, max: 1.5 },
    ]
    const solution = solveDrag(p.drag!, [0.5, 1.4], cursor, camera, world, ranges)
    for (let i = 0; i < 2; i++) {
      expect(solution.values[i]).toBeGreaterThanOrEqual(0)
      expect(solution.values[i]).toBeLessThanOrEqual(1.5)
    }
    expect(solution.values[1]).toBe(1.5)
  })

  it('moves a one-parameter point along its curve: R = (a, 0, 0) toward the projection of (2, 0, 0)', () => {
    const [, one] = points(`${BINDINGS}A = (1, 2, 3)\nR = (a, 0, 0)`)
    const c = project(camera, world.toWorld([2, 0, 0]))
    const solution = solveDrag(one.drag!, [0], c, camera, world, [{ min: -3, max: 3 }])
    expect(solution.values[0]).toBeCloseTo(2, 6)
  })
})
