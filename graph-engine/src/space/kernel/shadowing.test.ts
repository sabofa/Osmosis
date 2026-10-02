// Item 2 of space's side of the calc track's math and parser extensions, as
// narrowed after review: only calc's ten new built-in names (gamma, erf, erfc,
// cbrt, step, choose, perm, gcd, lcm, root) may be a spec's own @param,
// constant or function, and shadow the built-in wherever the spec uses it.
// Every classic built-in stays refused, because space's own coordinate maps
// and calc's derivatives call them by name. The collision text comes from
// math/compile.ts, not from space.

import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import type { ArrowMark, LineMark, MeshMark, PointMark } from '../scene/types'
import { vertices } from '../testing/kernel'
import { approx, kernelOf, markNamed, readoutFull, sceneOf } from './integrals/testing'

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

// The kinds of the statements a spec parses to ("space:function" for a space form).
function kindsOf(spec: string): string[] {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return parsed.statements.map((s) => (s.kind === 'space' ? `space:${s.form.form}` : s.kind))
}

const BUILTIN_REFUSAL = (name: string) => `"${name}" is a built-in function — a definition cannot take its name`

describe("one of calc's ten new built-in names may be a spec's own, and shadows the built-in", () => {
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

  it('a scalar definition that reads every parameter may take the name: gcd(a, b) = a*b and root(x, n) = x^(1/n)', () => {
    const scene = sceneOf('gcd(a, b) = a*b\nroot(x, n) = x^(1/n)\nA = (gcd(2, 3), root(8, 3), 0)')
    expect(scene.errors).toEqual([])
    const [x, y] = pointOf(scene)
    expect(x).toBe(6)
    expect(y).toBeCloseTo(2, 12)
  })

  it('a vector constant and a vector function may take the name: step = <1, 0, 0> and gamma(t) = <t, 0, 0>', () => {
    const constant = sceneOf('step = <1, 0, 0>\ncross: step x <0, 1, 0>')
    expect(constant.errors).toEqual([])
    // (1, 0, 0) x (0, 1, 0) = (0, 0, 1)
    expect(vertices((markNamed(constant, 's2', 'arrows') as ArrowMark).vectors)).toEqual([[0, 0, 1]])
    const fn = sceneOf('gamma(t) = <t, 0, 0>\ncross: gamma(2) x <0, 1, 0>')
    expect(fn.errors).toEqual([])
    // (2, 0, 0) x (0, 1, 0) = (0, 0, 2)
    expect(vertices((markNamed(fn, 's2', 'arrows') as ArrowMark).vectors)).toEqual([[0, 0, 2]])
  })

  it('a named region or volume may take the name: step = region x in [0, 1], y in [0, x]', () => {
    const scene = sceneOf('step = region x in [0, 1], y in [0, x]\nz = 1 over step res: 4')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => m.kind)).toEqual(['mesh'])
  })

  it('pi and e stay refused, and pi stays pi', () => {
    const scene = sceneOf('pi = 3\nA = (pi, 0, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/"pi"/) }])
    expect(pointOf(scene)[0]).toBe(Math.PI)
  })
})

// Space draws polar, cylindrical and spherical coordinates as calls of sin, cos
// and sqrt, and calc's derivatives call cos, sec and the rest, all by name. A
// spec that owned one of those names would have every such call resolve to its
// own function and draw a wrong picture, without a word. These are the review's
// probes: each now gives a line error on the definition, and the picture is the
// right one.
describe('a classic built-in name stays refused, and the pictures stay right', () => {
  it('sin(t) = 0 is an error on its line, and r = 1 is still the unit circle (it drew a flat segment)', () => {
    const scene = sceneOf('sin(t) = 0\nr = 1')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('sin') }])
    const line = markNamed(scene, 's2', 'lines') as LineMark
    let tallest = 0
    for (let i = 0; i < line.positions.length / 3; i++) {
      expect(Math.hypot(line.positions[3 * i], line.positions[3 * i + 1])).toBeCloseTo(1, 12)
      tallest = Math.max(tallest, Math.abs(line.positions[3 * i + 1]))
    }
    expect(tallest).toBeGreaterThan(0.99)
  })

  it('abs(t) = 0 is an error on its line, and the unit cylinder has volume pi (it read about 0)', () => {
    const scene = sceneOf('abs(t) = 0\nvolume: r in [0, 1], theta in [0, 2*pi], z in [0, 1] cylindrical')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('abs') }])
    // the integral of r dr dtheta dz over r in [0, 1], theta in [0, 2 pi], z in [0, 1] is pi
    expect(Math.abs(approx(readoutFull(scene, 2), 'dV') - Math.PI)).toBeLessThan(1e-8)
  })

  it('cos(t) = 1 is an error on its line, and a polar volume under x^2 reads pi/4 (it read 1.5708)', () => {
    const scene = sceneOf('cos(t) = 1\nvolume: under x^2 over r in [0, 1], theta in [0, 2*pi]')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('cos') }])
    // the integral of r^2 cos^2(theta) r dr dtheta is pi * 1/4
    expect(Math.abs(approx(readoutFull(scene, 2), 'dA') - Math.PI / 4)).toBeLessThan(1e-8)
  })

  it('cos(t) = 5 is an error on its line, and z = sin(x) has f_x = cos(0) = 1 at the origin (it picked 5)', () => {
    const scene = sceneOf('cos(t) = 5\nz = sin(x) for x in [0, 1], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('cos') }])
    const mesh = markNamed(scene, 's2', 'mesh') as MeshMark
    if (mesh.pick?.kind !== 'graph') throw new Error('expected a graph pick')
    expect(mesh.pick.fx(0, 0)).toBe(1)
  })

  it('a coordinate surface is not redrawn by sin(t) = t: cylindrical r = 1 is a cylinder of radius 1', () => {
    const scene = sceneOf('sin(t) = t\ncylindrical: r = 1 for theta in [0, 2*pi], z in [0, 1] res: 4')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('sin') }])
    const mesh = markNamed(scene, 's2', 'mesh') as MeshMark
    for (let i = 0; i < mesh.positions.length / 3; i++) expect(Math.hypot(mesh.positions[3 * i], mesh.positions[3 * i + 1])).toBeCloseTo(1, 12)
  })

  it('a constant of a classic name is refused as well: cos = 5 leaves z = sin(x) with f_x = 1', () => {
    const scene = sceneOf('cos = 5\nz = sin(x) for x in [0, 1], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('cos') }])
    const mesh = markNamed(scene, 's2', 'mesh') as MeshMark
    if (mesh.pick?.kind !== 'graph') throw new Error('expected a graph pick')
    expect(mesh.pick.fx(0, 0)).toBe(1)
  })

  it('a vector function of a classic name is no definition, as before: sin(t) = <t, 0, 0> is not parsed as a space form', () => {
    const parsed = parseSpec('sin(t) = <t, 0, 0>')
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.statements).toEqual([])
  })

  it('a user function of a classic name is refused: sin(x) = x^2 leaves sin(pi/2) = 1', () => {
    const scene = sceneOf('sin(x) = x^2\nA = (sin(pi/2), 1, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: BUILTIN_REFUSAL('sin') }])
    expect(pointOf(scene)).toEqual([1, 1, 0])
  })

  it('every classic name is refused as a constant, and none of the ten is', () => {
    for (const name of ['sin', 'cos', 'tan', 'sqrt', 'abs', 'exp', 'ln', 'log', 'min', 'max', 'atan2', 'hypot', 'floor', 'sign', 'mod']) {
      expect(sceneOf(`${name} = 2`).errors, name).toEqual([{ line: 1, message: BUILTIN_REFUSAL(name) }])
    }
    for (const name of ['gamma', 'erf', 'erfc', 'cbrt', 'step', 'choose', 'perm', 'gcd', 'lcm', 'root']) {
      expect(sceneOf(`${name} = 2`).errors, name).toEqual([])
    }
  })
})

// A built-in's name followed by its arguments, "max(x, a) = 2", is an equation
// calling the built-in, and a document's own @param or constant (a) is no
// reason to read it as a definition of max. Of calc's ten, a scalar line is a
// definition only when its right side reads every parameter.
describe('a built-in-named line is a definition only when it must be one', () => {
  it('a classic name with a @param or constant argument stays an equation, and the built-in keeps its meaning', () => {
    expect(kindsOf('@param a = 1 range [0, 3]\nmax(x, a) = 2')).toEqual(['implicit'])
    expect(kindsOf('@param k = 1 range [0.5, 3]\natan2(y, k) = z')).toEqual(['space:implicitSurface'])
    expect(kindsOf('b = 2\nlog(x, b) = y')).toEqual(['constantDef', 'implicit'])
    expect(kindsOf('a = 1\nmin(x, a) = 1')).toEqual(['constantDef', 'implicit'])
    // and min is still min on another line: min(0.5, 0.75) = 0.5, where a definition "min(x, a) = 1" would have made it 1
    const scene = sceneOf('a = 1\nmin(x, a) = 1\nz = min(x, y) for x in [0, 1], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([])
    expect(heightAt(markNamed(scene, 's3', 'mesh') as MeshMark, 0.5, 0.75)).toBe(0.5)
  })

  it('of the ten, a scalar line whose right side leaves a parameter unread stays an equation', () => {
    expect(kindsOf('@param n = 2 range [1, 5]\nroot(x, n) = 1')).toEqual(['implicit'])
    expect(kindsOf('@param k = 1 range [0, 3]\nchoose(x, k) = 3')).toEqual(['implicit'])
    expect(kindsOf('@param k = 1 range [0, 3]\nchoose(x, k) = k')).toEqual(['implicit'])
    expect(kindsOf('gcd(a, b) = a')).toEqual(['implicit'])
  })

  it('and one that reads every parameter defines: gcd(a, b) = a*b, root(x, n) = x^(1/n)', () => {
    expect(kindsOf('gcd(a, b) = a*b')).toEqual(['space:function'])
    expect(kindsOf('root(x, n) = x^(1/n)')).toEqual(['space:function'])
    expect(kindsOf('choose(x, k) = x*k')).toEqual(['space:function'])
  })
})

describe("a @param's value, range and step may not call another @param's name (they compile with no scope)", () => {
  const NAMED = (called: string, by: string) => `@param ${by}: "${called}" is a parameter in this document; rename it to use the built-in ${called} function`

  it('@param k = gamma(3) with @param gamma is a line error naming it, not the built-in\'s 2', () => {
    const scene = sceneOf('@param gamma = 2 range [1, 5]\n@param k = gamma(3) range [0, 5]\nA = (k, 0, 0)')
    expect(scene.errors).toEqual([{ line: 2, message: NAMED('gamma', 'k') }])
  })

  it('whichever comes first, and in the range, the step or a nested call', () => {
    expect(sceneOf('@param k = 1 range [0, 5]\n@param k2 = 1 range [0, gamma(3) + 1]\n@param gamma = 2 range [1, 5]').errors).toEqual([{ line: 2, message: NAMED('gamma', 'k2') }])
    expect(sceneOf('@param gamma = 2 range [1, 5]\n@param k = 1 range [0, 5] step sqrt(gamma(1))').errors).toEqual([{ line: 2, message: NAMED('gamma', 'k') }])
    expect(sceneOf('@param gamma = 2 range [1, 5]\n@param k = 1 + 2*sqrt(gamma(1)) range [0, 9]').errors).toEqual([{ line: 2, message: NAMED('gamma', 'k') }])
  })

  it('a @param calling its own name is refused too', () => {
    expect(sceneOf('@param gamma = gamma(3) range [0, 5]').errors).toEqual([{ line: 1, message: NAMED('gamma', 'gamma') }])
  })

  it('a call of a name no @param owns is the built-in, with no error: @param k = gamma(3) alone is 2', () => {
    const scene = sceneOf('@param k = gamma(3) range [0, 5]\nA = (k, 0, 0)')
    expect(scene.errors).toEqual([])
    expect(pointOf(scene)[0]).toBe(2)
    // and a call of another built-in beside a @param gamma is fine
    expect(sceneOf('@param gamma = 2 range [1, 5]\n@param k = sqrt(4) range [0, 5]').errors).toEqual([])
  })
})
