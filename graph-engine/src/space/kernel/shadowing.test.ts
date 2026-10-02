// Item 2 of space's side of the calc track's math and parser extensions: a
// built-in function's name may be a document's own @param, constant or user
// function, and shadows the built-in everywhere in that document (ruling agreed
// with calc, 2026-10-02). The collision text comes from math/compile.ts, not
// from space.

import { describe, expect, it } from 'vitest'
import type { ArrowMark, MeshMark, PointMark } from '../scene/types'
import { vertices } from '../testing/kernel'
import { kernelOf, markNamed, sceneOf } from './integrals/testing'

// A PointMark's position, for the shadowing tests below.
function pointOf(scene: ReturnType<typeof sceneOf>): [number, number, number] {
  const mark = scene.marks.find((m): m is PointMark => m.kind === 'points')
  if (!mark) throw new Error('no point drawn')
  return [mark.positions[0], mark.positions[1], mark.positions[2]]
}

// The z of the mesh vertex nearest (x, y).
function heightAt(mesh: MeshMark, x: number, y: number): number {
  let best = Infinity
  let z = NaN
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const d = Math.hypot(mesh.positions[3 * i] - x, mesh.positions[3 * i + 1] - y)
    if (d < best) {
      best = d
      z = mesh.positions[3 * i + 2]
    }
  }
  expect(best).toBeLessThan(1e-9)
  return z
}

describe('a built-in function name may be a document\'s own, and shadows the built-in (item 2)', () => {
  it('@param gamma = 2 range [1, 5] with z = gamma * x * y builds with no errors, z = 2xy', () => {
    const scene = sceneOf('@param gamma = 2 range [1, 5]\nz = gamma * x * y for x in [0, 1], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([])
    const mesh = markNamed(scene, 's2', 'mesh') as MeshMark
    // (0.5, 0.75): z = 2 * 0.5 * 0.75 = 0.75
    expect(heightAt(mesh, 0.5, 0.75)).toBe(0.75)
  })

  it('the @param still drives the surface: gamma = 4 gives z = 4xy', () => {
    const kernel = kernelOf('@param gamma = 2 range [1, 5]\nz = gamma * x * y for x in [0, 1], y in [0, 1] res: 4')
    const scene = kernel.setValue('gamma', 4)
    expect(scene.errors).toEqual([])
    // (0.5, 0.75): z = 4 * 0.5 * 0.75 = 1.5
    expect(heightAt(markNamed(scene, 's2', 'mesh') as MeshMark, 0.5, 0.75)).toBe(1.5)
  })

  it('@param gamma = 2 with gamma(x) is a line error with the compile text, and the document\'s gamma is not called', () => {
    const scene = sceneOf('@param gamma = 2 range [1, 5]\nz = gamma(x) for x in [0, 1], y in [0, 1]')
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].line).toBe(2)
    expect(scene.errors[0].message).toContain('"gamma" is a parameter in this document; rename it to use the built-in gamma function')
    expect(scene.marks).toEqual([])
  })

  it('a constant named gamma is the document\'s: gamma * x builds, gamma(x) names the constant', () => {
    const built = sceneOf('gamma = 3\nz = gamma * x for x in [0, 1], y in [0, 1] res: 4')
    expect(built.errors).toEqual([])
    // (0.5, 0.25): z = 3 * 0.5 = 1.5
    expect(heightAt(markNamed(built, 's2', 'mesh') as MeshMark, 0.5, 0.25)).toBe(1.5)
    const called = sceneOf('gamma = 3\nz = gamma(x) for x in [0, 1], y in [0, 1]')
    expect(called.errors).toHaveLength(1)
    expect(called.errors[0].message).toContain('"gamma" is a constant in this document; rename it to use the built-in gamma function')
  })

  it('a user function step(x) = x^2 shadows the built-in step in a surface', () => {
    const scene = sceneOf('step(x) = x^2\nz = step(x) + y for x in [0, 2], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([])
    const mesh = markNamed(scene, 's2', 'mesh') as MeshMark
    // the built-in step(1.5) is 1; the document's is 1.5^2 = 2.25, and + y = 0.5 gives 2.75
    expect(heightAt(mesh, 1.5, 0.5)).toBe(2.75)
    // and at x = 0.5: the built-in step(0.5) is 1, the document's 0.25 (+ 0.25)
    expect(heightAt(mesh, 0.5, 0.25)).toBe(0.5)
  })

  it('a user function named after a classic built-in shadows it too: sin(x) = x^2 gives sin(pi/2) = (pi/2)^2', () => {
    const scene = sceneOf('sin(x) = x^2\nA = (sin(pi/2), 1, 0)')
    expect(scene.errors).toEqual([])
    expect(pointOf(scene)[0]).toBe((Math.PI / 2) ** 2)
  })

  it('a 3-parameter definition whose parameters are not all coordinates may take a built-in name: gcd(a, b) = a*b', () => {
    const scene = sceneOf('gcd(a, b) = a*b\nA = (gcd(2, 3), 0, 0)')
    expect(scene.errors).toEqual([])
    expect(pointOf(scene)[0]).toBe(6)
  })

  it('a vector constant may take a built-in name too: step = <1, 0, 0> is the vector in cross: step x <0, 1, 0>', () => {
    const scene = sceneOf('step = <1, 0, 0>\ncross: step x <0, 1, 0>')
    expect(scene.errors).toEqual([])
    // (1, 0, 0) x (0, 1, 0) = (0, 0, 1)
    expect(vertices((markNamed(scene, 's2', 'arrows') as ArrowMark).vectors)).toEqual([[0, 0, 1]])
  })

  it('a vector function with a built-in name takes its parameter: sin(t) = <t, 0, 0>', () => {
    const scene = sceneOf('sin(t) = <t, 0, 0>\ncross: sin(2) x <0, 1, 0>')
    expect(scene.errors).toEqual([])
    // (2, 0, 0) x (0, 1, 0) = (0, 0, 2)
    expect(vertices((markNamed(scene, 's2', 'arrows') as ArrowMark).vectors)).toEqual([[0, 0, 2]])
  })

  it('pi and e stay refused, and pi stays pi', () => {
    const scene = sceneOf('pi = 3\nA = (pi, 0, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/"pi"/) }])
    expect(pointOf(scene)[0]).toBe(Math.PI)
  })

  it('a named region or volume may take a built-in name: step = region x in [0, 1], y in [0, x]', () => {
    const scene = sceneOf('step = region x in [0, 1], y in [0, x]\nz = 1 over step res: 4')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => m.kind)).toEqual(['mesh'])
  })
})
