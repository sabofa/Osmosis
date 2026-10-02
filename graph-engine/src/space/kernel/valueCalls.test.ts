// Item 3 of space's side of the calc track's math and parser extensions: a value
// name followed by a parenthesis is a product, x(x + 1) = x * (x + 1) (calc P1).
// Compile reads it so while the name is still bound, but space renames its
// variables ($0, $1) and substitutes polar and other coordinates before it
// compiles, and those passes leave a call's name alone: x(x + 1) became
// $0($0 + 1), "Unknown function". Every site is exercised here, each with a
// value worked by hand.

import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../parser/parseExpr'
import { makeScope } from '../../math/scope'
import type { ArrowMark, LineMark, MeshMark, PointMark } from '../scene/types'
import { markAt, vertices as vertexList } from '../testing/kernel'
import { compileField } from './geometry/implicit'
import { approx, markNamed, readout, readoutFull, sceneOf } from './integrals/testing'

const lineOf = (spec: string, object = 's1'): LineMark => {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  return markNamed(scene, object, 'lines') as LineMark
}

const meshOf = (spec: string, object = 's1'): MeshMark => {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  return markNamed(scene, object, 'mesh') as MeshMark
}

describe('curves: a value call is a product before the bound variable is renamed', () => {
  it('a lifted y = x(x + 1) draws: (1, 2, 0), with the slope 2x + 1 = 3', () => {
    const line = lineOf('y = x(x + 1)')
    // x runs over the box's [-5, 5] in 512 steps: the first vertex is x = -5,
    // y = (-5)(-4) = 20
    expect([...line.positions.slice(0, 3)]).toEqual([-5, 20, 0])
    for (let i = 0; i < line.positions.length / 3; i++) {
      const [x, y, z] = [line.positions[3 * i], line.positions[3 * i + 1], line.positions[3 * i + 2]]
      expect(y).toBeCloseTo(x * (x + 1), 10)
      expect(z).toBe(0)
    }
    expect(line.pick!.r(1)).toEqual([1, 2, 0])
    expect(line.pick!.dr(1)).toEqual([1, 3, 0])
  })

  it('a lifted x = y(y + 1) draws the same way: (2, 1, 0) at y = 1', () => {
    const line = lineOf('x = y(y + 1)')
    expect([...line.positions.slice(0, 3)]).toEqual([20, -5, 0])
    expect(line.pick!.r(1)).toEqual([2, 1, 0])
  })

  it('a polar curve r = theta(theta + 1): (2 cos 1, 2 sin 1, 0) at theta = 1', () => {
    const line = lineOf('r = theta(theta + 1) for theta in [0, 2]')
    const [x, y, z] = line.pick!.r(1)
    expect(x).toBeCloseTo(2 * Math.cos(1), 12)
    expect(y).toBeCloseTo(2 * Math.sin(1), 12)
    expect(z).toBe(0)
  })

  it('a parametric curve (t(t + 1), t, 0): r(1) = (2, 1, 0), r\'(1) = (3, 1, 0)', () => {
    const line = lineOf('(t(t + 1), t, 0) for t in [0, 2]')
    expect(line.pick!.r(1)).toEqual([2, 1, 0])
    expect(line.pick!.dr(1)).toEqual([3, 1, 0])
  })

  it('a named vector function r(t) = <t(t + 1), t, 0> is a curve in frame:', () => {
    const scene = sceneOf('r(t) = <t(t + 1), t, 0>\nframe: r at t = 1')
    expect(scene.errors).toEqual([])
    // the point r(1) = (2, 1, 0); T = r'/|r'| = (3, 1, 0)/sqrt 10
    expect([...(markAt(scene, 's2.point') as PointMark).positions]).toEqual([2, 1, 0])
    const [T] = vertexList((markAt(scene, 's2') as ArrowMark).vectors)
    expect(T[2]).toBe(0)
    expect(T[0] / T[1]).toBeCloseTo(3, 12)
  })

  it('an inline curve in frame: with its own parameter, <s(s + 1), s, 0> at s = 1', () => {
    const scene = sceneOf('frame: <s(s + 1), s, 0> at s = 1')
    expect(scene.errors).toEqual([])
    expect([...(markAt(scene, 's1.point') as PointMark).positions]).toEqual([2, 1, 0])
  })

  it('a vector function evaluated at a point, F(a) = <a(a + 1), 0, 0> at F(2): (6, 0, 0)', () => {
    // 2 * 3 = 6; (6, 0, 0) x (0, 1, 0) = (0, 0, 6)
    const scene = sceneOf('F(a) = <a(a + 1), 0, 0>\ncross: F(2) x <0, 1, 0>')
    expect(scene.errors).toEqual([])
    expect(vertexList((markNamed(scene, 's2', 'arrows') as ArrowMark).vectors)).toEqual([[0, 0, 6]])
  })

  it('a value that is not a bound name is still the document\'s: with @param k, k(t + 1) is k * (t + 1)', () => {
    const line = lineOf('@param k = 3 range [0, 5]\n(k(t + 1), 0, 0) for t in [0, 2]', 's2')
    // 3 * (1 + 1) = 6 at t = 1
    expect(line.pick!.r(1)).toEqual([6, 0, 0])
    expect(line.pick!.dr(1)).toEqual([3, 0, 0])
  })

  it('a user function of one parameter stays a call: f(x) = x^2 and y = f(x + 1) is (x + 1)^2', () => {
    const line = lineOf('f(x) = x^2\ny = f(x + 1)', 's2')
    // (1 + 1)^2 = 4 at x = 1
    expect(line.pick!.r(1)).toEqual([1, 4, 0])
  })
})

describe('surfaces: a value call is a product before the variables are renamed and substituted', () => {
  it('z = x(x + 1) over a rectangle: z = 6 at the vertex (2, 1), f(1, 0.5) = 2, f_x = 3', () => {
    const mesh = meshOf('z = x(x + 1) for x in [0, 2], y in [0, 1] res: 4')
    // vertex (x, y) = (2, 1) is the last: z = 2 * 3 = 6
    const n = mesh.positions.length / 3
    expect([...mesh.positions.slice(3 * (n - 1), 3 * n)]).toEqual([2, 1, 6])
    if (mesh.pick?.kind !== 'graph') throw new Error('expected a graph pick')
    expect(mesh.pick.f(1, 0.5)).toBe(2)
    // z_x = 2x + 1 = 3 at x = 1
    expect(mesh.pick.fx(1, 0.5)).toBe(3)
  })

  it('a polar surface z = r(r + 1) over r in [0, 2], theta in [0, 2 pi]: z = 6 at r = 2', () => {
    const mesh = meshOf('z = r(r + 1) over r in [0, 2], theta in [0, 2*pi] res: 8')
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const r = Math.hypot(mesh.positions[3 * i], mesh.positions[3 * i + 1])
      expect(mesh.positions[3 * i + 2]).toBeCloseTo(r * (r + 1), 9)
    }
    if (mesh.pick?.kind !== 'parametric') throw new Error('expected a parametric pick (the body reads r)')
    // (r, theta) = (2, 0): (2, 0, 6)
    expect(mesh.pick.r(2, 0)).toEqual([2, 0, 6])
  })

  it('a polar surface in x: z = x(x + 1) over r in [0, 1], theta in [0, 2 pi] is z = x(x + 1) at the vertex (1, 0)', () => {
    const mesh = meshOf('z = x(x + 1) over r in [0, 1], theta in [0, 2*pi] res: 8')
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const x = mesh.positions[3 * i]
      expect(mesh.positions[3 * i + 2]).toBeCloseTo(x * (x + 1), 9)
    }
    // the vertex at r = 1, theta = 0 is (1, 0, 2)
    let found = false
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      if (Math.abs(mesh.positions[3 * i] - 1) < 1e-12 && Math.abs(mesh.positions[3 * i + 1]) < 1e-12) {
        expect(mesh.positions[3 * i + 2]).toBeCloseTo(2, 12)
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('a polar body whose only value call is r(1) (no r variable read) is a product too: z = r(1) is z = r', () => {
    const mesh = meshOf('z = r(1) over r in [0, 2], theta in [0, 2*pi] res: 8')
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      expect(mesh.positions[3 * i + 2]).toBeCloseTo(Math.hypot(mesh.positions[3 * i], mesh.positions[3 * i + 1]), 9)
    }
  })

  it('a parametric surface (u(u + 1), v, 0): r(1, 0.5) = (2, 0.5, 0)', () => {
    const mesh = meshOf('(u(u + 1), v, 0) for u in [0, 1], v in [0, 1] res: 4')
    if (mesh.pick?.kind !== 'parametric') throw new Error('expected a parametric pick')
    expect(mesh.pick.r(1, 0.5)).toEqual([2, 0.5, 0])
    // r_u = (2u + 1, 0, 0) = (3, 0, 0) at u = 1
    expect(mesh.pick.ru?.(1, 0.5)).toEqual([3, 0, 0])
  })

  it('a coordinate surface r = z(z + 1) (cylindrical): the radius at z = 1 is 2', () => {
    const scene = sceneOf('cylindrical: r = z(z + 1) for theta in [0, 2*pi], z in [0, 1] res: 8')
    expect(scene.errors).toEqual([])
    const mesh = markNamed(scene, 's1', 'mesh') as MeshMark
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const [x, y, z] = [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]
      expect(Math.hypot(x, y)).toBeCloseTo(z * (z + 1), 9)
    }
  })
})

describe('level fields: a value call is a product before x, y and z are renamed', () => {
  it('F = x(x + 1) + y^2 reads 2 at (1, 0, 0), with the gradient (2x + 1, 2y, 0) = (3, 4, 0) at (1, 2, 0)', () => {
    const field = compileField(parseExprString('x(x + 1) + y^2'), makeScope())
    expect(field.f(1, 0, 0)).toBe(2)
    const g = new Float64Array(3)
    field.grad(g, 1, 2, 0)
    expect([...g]).toEqual([3, 4, 0])
  })

  it('an implicit surface x(x + 1) + y^2 + z^2 = 2 builds, and every vertex is on it', () => {
    const mesh = meshOf('x(x + 1) + y^2 + z^2 = 2 res: 16')
    expect(mesh.positions.length).toBeGreaterThan(0)
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const [x, y, z] = [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]
      expect(Math.abs(x * (x + 1) + y * y + z * z - 2)).toBeLessThan(0.2)
    }
  })
})

describe('surface tools: a value call is a product in a target', () => {
  it('gradient: x(x + 1) - y^2 at (1, 2) is (3, -4)', () => {
    const scene = sceneOf('gradient: x(x + 1) - y^2 at (1, 2)')
    expect(scene.errors).toEqual([])
    // f_x = 2x + 1 = 3, f_y = -2y = -4
    expect([...(markNamed(scene, 's1', 'arrows') as ArrowMark).vectors]).toEqual([3, -4, 0])
  })

  it('a path over f(x, y) = x(x + 1) + y along (t(t + 1), t): (2, 1, 7) at t = 1', () => {
    const scene = sceneOf('f(x, y) = x(x + 1) + y\npath: on f along (t(t + 1), t) for t in [0, 1]')
    expect(scene.errors).toEqual([])
    const line = markNamed(scene, 's2', 'lines') as LineMark
    // at t = 1: (2, 1, f(2, 1) = 2 * 3 + 1 = 7)
    expect(line.pick!.r(1)).toEqual([2, 1, 7])
  })
})

describe('integrals: a value call is a product in the integrand and in the bounds', () => {
  it('volume: under x(x + 1) over x in [0, 1], y in [0, 1] reads 5/6 (the integral of x^2 + x is 1/3 + 1/2)', () => {
    const scene = sceneOf('volume: under x(x + 1) over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dA') - 5 / 6)).toBeLessThan(1e-9)
    expect(readout(scene, 1).text.startsWith('∬_R (x(x + 1)) dA ≈ ')).toBe(true)
  })

  it('over a polar region x is r cos(theta): volume: under x(x + 1) over r in [0, 1], theta in [0, 2 pi] reads pi/4', () => {
    // the integral of (r^2 cos^2 + r cos) r dr dtheta = pi * 1/4 + 0
    const scene = sceneOf('volume: under x(x + 1) over r in [0, 1], theta in [0, 2*pi]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dA') - Math.PI / 4)).toBeLessThan(1e-8)
  })

  it('and r(r + 1), which compile binds itself: volume: under r(r + 1) over r in [0, 1], theta in [0, 2 pi] reads 7 pi / 6', () => {
    // the integral of (r^2 + r) r dr dtheta = 2 pi (1/4 + 1/3) = 7 pi / 6
    const scene = sceneOf('volume: under r(r + 1) over r in [0, 1], theta in [0, 2*pi]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dA') - (7 * Math.PI) / 6)).toBeLessThan(1e-8)
  })

  it('a Riemann sum of x(x + 1) over [0, 2] x [0, 1] has the integral 14/3 (x^3/3 + x^2/2 at 2 is 8/3 + 2)', () => {
    const scene = sceneOf('riemann: under x(x + 1) over x in [0, 2], y in [0, 1], n = 4')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dA') - 14 / 3)).toBeLessThan(1e-9)
  })

  it('a bound that writes the outer variable as a factor, y in [0, x(1 - x)], is a product: the volume is 1/6', () => {
    // the integral of x(1 - x) dx over [0, 1] is 1/2 - 1/3 = 1/6 (z is [0, 1])
    const scene = sceneOf('volume: x in [0, 1], y in [0, x(1 - x)], z in [0, 1]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dV') - 1 / 6)).toBeLessThan(1e-9)
  })

  it('a cylindrical integrand x(x + 1) over the unit cylinder reads pi/4', () => {
    // the integral of (r^2 cos^2 + r cos) r dr dtheta dz = pi/4
    const scene = sceneOf('volume: r in [0, 1], theta in [0, 2*pi], z in [0, 1] cylindrical integrand x(x + 1)')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 1), 'dV') - Math.PI / 4)).toBeLessThan(1e-8)
  })

  it('a centroid with density x(x + 1) over a polar region has mass pi/4', () => {
    const scene = sceneOf('D = region r in [0, 1], theta in [0, 2*pi]\ncentroid: D density x(x + 1)')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readoutFull(scene, 2), 'M') - Math.PI / 4)).toBeLessThan(1e-8)
  })
})
