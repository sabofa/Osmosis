import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import type { Statement } from '../../parser/types'
import type { ArrowMark, LineMark, Mark, MeshMark, PointMark, SpaceScene } from '../scene/types'
import { createSpaceKernel } from './index'

function kernelOf(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

function sceneOf(spec: string): SpaceScene {
  return kernelOf(spec).scene()
}

function only<K extends Mark['kind']>(scene: SpaceScene, kind: K): Extract<Mark, { kind: K }> {
  const marks = scene.marks.filter((m) => m.kind === kind)
  expect(marks).toHaveLength(1)
  return marks[0] as Extract<Mark, { kind: K }>
}

function vertex(p: Float64Array, i: number): [number, number, number] {
  return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
}

function vertexCount(mesh: MeshMark): number {
  return mesh.positions.length / 3
}

// Twice the signed area of triangle t projected onto xy.
function xyArea2(mesh: MeshMark, t: number): number {
  const [a, b, c] = [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]]
  const p = mesh.positions
  return (p[3 * b] - p[3 * a]) * (p[3 * c + 1] - p[3 * a + 1]) - (p[3 * c] - p[3 * a]) * (p[3 * b + 1] - p[3 * a + 1])
}

function projectedArea(mesh: MeshMark): number {
  let sum = 0
  for (let t = 0; t < mesh.indices.length / 3; t++) sum += Math.abs(xyArea2(mesh, t)) / 2
  return sum
}

describe('a rectangle surface: z = x + y for x in [0, 1], y in [0, 2] at res 4', () => {
  const scene = sceneOf('z = x + y for x in [0, 1], y in [0, 2] res: 4')
  const mesh = only(scene, 'mesh')

  it('has 25 vertices and 32 triangles', () => {
    expect(scene.errors).toEqual([])
    expect(vertexCount(mesh)).toBe(25)
    expect(mesh.indices.length / 3).toBe(32)
  })

  it('puts vertex (i = 1, j = 2) at (0.25, 1.0, 1.25)', () => {
    // x = 0 + 1 * 1/4, y = 0 + 2 * 2/4, z = x + y; row-major, x fastest
    expect(vertex(mesh.positions, 2 * 5 + 1)).toEqual([0.25, 1, 1.25])
  })

  it('has the analytic normal (-1, -1, 1)/sqrt 3 everywhere', () => {
    const s = 1 / Math.sqrt(3)
    for (let i = 0; i < vertexCount(mesh); i++) {
      const [nx, ny, nz] = vertex(mesh.normals, i)
      expect(nx).toBeCloseTo(-s, 15)
      expect(ny).toBeCloseTo(-s, 15)
      expect(nz).toBeCloseTo(s, 15)
    }
  })

  it('colours by height: scalars = z, one scale over [0, 3] in viridis', () => {
    for (let i = 0; i < vertexCount(mesh); i++) expect(mesh.scalars![i]).toBe(mesh.positions[3 * i + 2])
    expect(scene.colorScales).toHaveLength(1)
    expect(scene.colorScales[0]).toMatchObject({ id: 0, title: 'height', map: 'viridis', domain: { min: 0, max: 3 }, diverging: false })
    expect(mesh.style.colorScale).toBe(0)
  })

  it('draws mesh lines at the nice x and y steps from 0', () => {
    // niceStep(1, 8) = 0.1 and niceStep(2, 8) = 0.2
    expect(mesh.style.meshLines).toEqual({ u0: 0, du: 0.1, v0: 0, dv: 0.2 })
  })

  it('carries (u, v) = (x, y), and its source', () => {
    expect([mesh.uv![22], mesh.uv![23]]).toEqual([0.25, 1])
    expect(mesh.source).toEqual({ line: 1, statement: null, object: 's1' })
  })

  it('picks the true function', () => {
    expect(mesh.pick?.kind).toBe('graph')
    if (mesh.pick?.kind !== 'graph') throw new Error('unreachable')
    expect(mesh.pick.f(0.3, 0.4)).toBeCloseTo(0.7, 15)
  })
})

describe('a type I domain: z = 1 over x in [0, 1], y in [x^2, x]', () => {
  it('keeps every vertex between the bounding curves, exactly on them at the edges', () => {
    const mesh = only(sceneOf('z = 1 over x in [0, 1], y in [x^2, x] res: 8'), 'mesh')
    for (let i = 0; i < vertexCount(mesh); i++) {
      const [x, y] = vertex(mesh.positions, i)
      expect(y).toBeGreaterThanOrEqual(x * x - 1e-12)
      expect(y).toBeLessThanOrEqual(x + 1e-12)
    }
    // at s = 0.5 the column's ends are (0.5, 0.25) and (0.5, 0.5), exactly
    const column: number[] = []
    for (let i = 0; i < vertexCount(mesh); i++) if (mesh.positions[3 * i] === 0.5) column.push(mesh.positions[3 * i + 1])
    expect(Math.min(...column)).toBe(0.25)
    expect(Math.max(...column)).toBe(0.5)
  })

  it('drops the triangles collapsed where the bounds meet, at x = 0 and x = 1', () => {
    const mesh = only(sceneOf('z = 1 over x in [0, 1], y in [x^2, x] res: 8'), 'mesh')
    // 8 * 8 * 2 = 128, less 8 collapsed at each end
    expect(mesh.indices.length / 3).toBe(112)
    for (let t = 0; t < mesh.indices.length / 3; t++) expect(Math.abs(xyArea2(mesh, t))).toBeGreaterThan(0)
  })

  it('has area within 2% of 1/6 at res 32', () => {
    const mesh = only(sceneOf('z = 1 over x in [0, 1], y in [x^2, x] res: 32'), 'mesh')
    expect(Math.abs(projectedArea(mesh) - 1 / 6) / (1 / 6)).toBeLessThan(0.02)
  })

  it('winds every triangle counter-clockwise seen from above, as its normal points', () => {
    const mesh = only(sceneOf('z = 1 over y in [0, 2], x in [0, y/2] res: 6'), 'mesh')
    for (let t = 0; t < mesh.indices.length / 3; t++) expect(xyArea2(mesh, t)).toBeGreaterThan(0)
  })
})

describe('a polar domain: z = 0 over r in [0, 1], theta in [0, 2*pi]', () => {
  it('stays inside the unit disk, and its area tends to pi', () => {
    const mesh = only(sceneOf('z = 0 over r in [0, 1], theta in [0, 2*pi] res: 48'), 'mesh')
    for (let i = 0; i < vertexCount(mesh); i++) {
      const [x, y] = vertex(mesh.positions, i)
      expect(x * x + y * y).toBeLessThanOrEqual(1 + 1e-12)
    }
    expect(Math.abs(projectedArea(mesh) - Math.PI) / Math.PI).toBeLessThan(0.01)
  })

  it('reads r and theta in the body', () => {
    // z = r at the rim is 1 everywhere
    const mesh = only(sceneOf('z = r over r in [0, 1], theta in [0, pi] res: 8'), 'mesh')
    for (let i = 0; i < vertexCount(mesh); i++) {
      const [x, y, z] = vertex(mesh.positions, i)
      expect(z).toBeCloseTo(Math.hypot(x, y), 14)
    }
  })
})

describe('an inequality domain: z = 0 over x^2 + y^2 <= 4 on the default [-5, 5]^2', () => {
  const mesh = only(sceneOf('z = 0 over x^2 + y^2 <= 4'), 'mesh')
  const r2 = (i: number) => mesh.positions[3 * i] ** 2 + mesh.positions[3 * i + 1] ** 2
  const onCircle = (i: number) => Math.abs(r2(i) - 4) <= 1e-8

  // How many triangles use each undirected edge.
  const uses = new Map<string, number>()
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[3 * t + k]
      const b = mesh.indices[3 * t + ((k + 1) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }

  it('keeps every vertex inside', () => {
    for (let i = 0; i < vertexCount(mesh); i++) expect(r2(i)).toBeLessThanOrEqual(4 + 1e-9)
  })

  it('puts every vertex of a boundary edge on the circle, to 1e-8', () => {
    let boundaryEdges = 0
    for (const [key, count] of uses) {
      if (count !== 1) continue
      boundaryEdges++
      const [a, b] = key.split(',').map(Number)
      expect(Math.abs(r2(a) - 4)).toBeLessThanOrEqual(1e-8)
      expect(Math.abs(r2(b) - 4)).toBeLessThanOrEqual(1e-8)
    }
    expect(boundaryEdges).toBeGreaterThan(100)
  })

  it('has no cracks: an edge on the circle is used once, every other edge twice', () => {
    for (const [key, count] of uses) {
      const [a, b] = key.split(',').map(Number)
      expect(count).toBe(onCircle(a) && onCircle(b) ? 1 : 2)
    }
  })

  it('has area within 1.5% of 4pi', () => {
    expect(Math.abs(projectedArea(mesh) - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.015)
  })

  it('clips against each condition of a conjunction in turn', () => {
    const half = only(sceneOf('z = 0 over x^2 + y^2 <= 4 and y >= 0'), 'mesh')
    for (let i = 0; i < vertexCount(half); i++) expect(half.positions[3 * i + 1]).toBeGreaterThanOrEqual(-1e-9)
    expect(Math.abs(projectedArea(half) - 2 * Math.PI) / (2 * Math.PI)).toBeLessThan(0.015)
  })
})

describe('refusals and holes', () => {
  it('refuses inner bounds that cross, naming where', () => {
    // y in [x, 1] on x in [0, 2]: 1 - x changes sign at x = 1
    const scene = sceneOf('z = 1 over x in [0, 2], y in [x, 1]')
    expect(scene.marks).toEqual([])
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].line).toBe(1)
    expect(scene.errors[0].message).toMatch(/the inner bounds cross near x = 1(?![\d.])/)
  })

  it('leaves an honest hole where z is not finite: 1/x on a column at x = 0', () => {
    // res 4 on [-1, 1]: columns at x = -1, -0.5, 0, 0.5, 1. The 16 triangles
    // touching x = 0 go; the 16 in the outer columns stay.
    const scene = sceneOf('z = 1/x for x in [-1, 1], y in [-1, 1] res: 4')
    const mesh = only(scene, 'mesh')
    expect(scene.errors).toEqual([])
    expect(mesh.indices.length / 3).toBe(16)
    for (let t = 0; t < 16; t++) {
      for (let k = 0; k < 3; k++) {
        const [x, y, z] = vertex(mesh.positions, mesh.indices[3 * t + k])
        expect(Math.abs(x)).toBeGreaterThanOrEqual(0.5)
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
      }
    }
  })
})

describe('normals', () => {
  it('are analytic for z = f: at (1, 2) on x^2 - y^2, normalise(-2, 4, 1)', () => {
    // grid 0.5 apart in x, 1 apart in y: (1, 2) is vertex i = 2, j = 2
    const mesh = only(sceneOf('z = x^2 - y^2 for x in [0, 2], y in [0, 4] res: 4'), 'mesh')
    const i = 2 * 5 + 2
    expect(vertex(mesh.positions, i)).toEqual([1, 2, -3])
    const len = Math.sqrt(4 + 16 + 1)
    const [nx, ny, nz] = vertex(mesh.normals, i)
    expect(nx).toBeCloseTo(-2 / len, 15)
    expect(ny).toBeCloseTo(4 / len, 15)
    expect(nz).toBeCloseTo(1 / len, 15)
    if (mesh.pick?.kind !== 'graph') throw new Error('expected a graph pick')
    // f = 1 - 4, f_x = 2x, f_y = -2y
    expect(mesh.pick.f(1, 2)).toBe(-3)
    expect(mesh.pick.fx(1, 2)).toBe(2)
    expect(mesh.pick.fy(1, 2)).toBe(-4)
  })

  it('fall back to the incident faces at a sphere’s pole, never zero', () => {
    const mesh = only(sceneOf('(cos(u) sin(v), sin(u) sin(v), cos(v)) for u in [0, 2*pi], v in [0, pi]'), 'mesh')
    let poles = 0
    for (let i = 0; i < vertexCount(mesh); i++) {
      const [x, y, z] = vertex(mesh.positions, i)
      if (Math.abs(x) > 1e-12 || Math.abs(y) > 1e-12 || Math.abs(z - 1) > 1e-12) continue
      poles++
      const [nx, ny, nz] = vertex(mesh.normals, i)
      expect(Math.abs(nx)).toBeLessThan(1e-6)
      expect(Math.abs(ny)).toBeLessThan(1e-6)
      expect(Math.abs(Math.abs(nz) - 1)).toBeLessThan(1e-6)
    }
    expect(poles).toBeGreaterThan(0)
  })

  it('are r_u x r_v on a parametric surface, with a parametric pick', () => {
    // the plane (u, v, 0): r_u x r_v = (1,0,0) x (0,1,0) = (0, 0, 1)
    const mesh = only(sceneOf('(u, v, 0) for u in [0, 1], v in [0, 1]'), 'mesh')
    expect(vertex(mesh.normals, 7)).toEqual([0, 0, 1])
    if (mesh.pick?.kind !== 'parametric') throw new Error('expected a parametric pick')
    expect(mesh.pick.param).toEqual(['u', 'v'])
    expect(mesh.pick.r(0.25, 0.5)).toEqual([0.25, 0.5, 0])
    // flat colour by default, mesh lines on the u/v spans at target 12
    expect(mesh.style.colorScale).toBeNull()
    expect(mesh.style.meshLines).toEqual({ u0: 0, du: 0.1, v0: 0, dv: 0.1 })
  })
})

describe('curves', () => {
  it('a space curve samples 512 segments, with t and a symbolic derivative', () => {
    const scene = sceneOf('r(t) = <cos(t), sin(t), t>\n(cos(t), sin(t), t) for t in [0, 2*pi]')
    expect(scene.errors).toEqual([])
    const line = only(scene, 'lines')
    expect(line.positions.length / 3).toBe(513)
    expect(line.params![0]).toBe(0)
    expect(line.params![512]).toBe(2 * Math.PI)
    expect([...line.starts]).toEqual([0])
    expect(line.style.width).toBe(2.5)
    // r' = (-sin t, cos t, 1): (0, 1, 1) at t = 0
    const dr = line.pick!.dr(0)
    expect(dr[0]).toBeCloseTo(0, 15)
    expect(dr[1]).toBe(1)
    expect(dr[2]).toBe(1)
    expect(line.source.object).toBe('s2')
  })

  it('differentiates without capturing a parameter that shares the bound variable’s name', () => {
    // The curve binds s; f reads the @param s = 2. The curve's x is
    // f(s) = s + 2, so x' = 1. Inlining f's body into the curve without
    // renaming the curve's s would read "s + s" and give 2.
    const line = only(sceneOf('@param s = 2 range [0, 5]\nf(x) = x + s\n(f(s), 0, s) for s in [0, 1]'), 'lines')
    expect(line.pick!.r(0.5)).toEqual([2.5, 0, 0.5])
    expect(line.pick!.dr(0)).toEqual([1, 0, 1])
  })

  it('a space curve takes width, dashed and res', () => {
    const line = only(sceneOf('(t, t^2, t^3) for t in [0, 1] width: 4 dashed res: 10'), 'lines')
    expect(line.positions.length / 3).toBe(11)
    expect(line.style.width).toBe(4)
    expect(line.style.dash).not.toBeNull()
  })

  it('lifts y = x^2 onto z = 0', () => {
    const line = only(sceneOf('y = x^2'), 'lines')
    expect(line.positions.length).toBeGreaterThan(0)
    for (let i = 0; i < line.positions.length / 3; i++) {
      expect(line.positions[3 * i + 2]).toBe(0)
      expect(line.positions[3 * i + 1]).toBeCloseTo(line.positions[3 * i] ** 2, 12)
    }
  })

  it('lifts x^2 + y^2 = 1 as polylines on the unit circle', () => {
    const line = only(sceneOf('x^2 + y^2 = 1'), 'lines')
    expect(line.positions.length / 3).toBeGreaterThan(20)
    for (let i = 0; i < line.positions.length / 3; i++) {
      const [x, y, z] = vertex(line.positions, i)
      expect(z).toBe(0)
      // the tracer interpolates linearly along 0.05-wide cells
      expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(1e-3)
    }
  })
})

describe('points, segments, rays and vectors', () => {
  it('a point in space is a dot and a label', () => {
    const scene = sceneOf('A = (1, 2, 3)')
    const point: PointMark = only(scene, 'points')
    expect([...point.positions]).toEqual([1, 2, 3])
    expect(point.style.size).toBe(8)
    expect(scene.labels).toEqual([{ source: { line: 1, statement: null, object: 's1.label' }, position: [1, 2, 3], text: 'A', kind: 'point' }])
  })

  it('a vector is an arrow with its magnitude, as 2D labels it', () => {
    const scene = sceneOf('vector: (0,0,0) -> (1,2,2)')
    const arrow: ArrowMark = only(scene, 'arrows')
    expect([...arrow.tails]).toEqual([0, 0, 0])
    expect([...arrow.vectors]).toEqual([1, 2, 2])
    // |(1, 2, 2)| = sqrt(1 + 4 + 4) = 3
    expect(scene.labels.map((l) => l.text)).toEqual(['|v| = 3'])
  })

  it('a segment is a two-vertex line, a ray an arrow', () => {
    const scene = sceneOf('(0,0,0) -- (3,3,0)\n(0,0,0) -> (0,0,4)')
    const segment: LineMark = only(scene, 'lines')
    expect([...segment.positions]).toEqual([0, 0, 0, 3, 3, 0])
    expect(segment.style.width).toBe(2)
    expect([...only(scene, 'arrows').vectors]).toEqual([0, 0, 4])
  })
})

describe('colour slots', () => {
  it('go in source order to drawing statements, and color: sets the author colour', () => {
    const scene = sceneOf('f(x, y) = x\nz = x for x in [0, 1], y in [0, 1] color: purple\nz = y for x in [0, 1], y in [0, 1]')
    const [first, second] = scene.marks as MeshMark[]
    expect(first.style.color).toEqual({ author: 'purple', slot: 0 })
    expect(second.style.color).toEqual({ author: null, slot: 1 })
    // color: turns the default height colormap off
    expect(first.style.colorScale).toBeNull()
    expect(second.style.colorScale).toBe(0)
  })
})

describe('errors are returned with their line, never thrown', () => {
  it('names what space does not draw, and keeps the rest', () => {
    const scene = sceneOf('z = x for x in [0, 1], y in [0, 1]\n\n# a comment\ncircle: (0,0), 1')
    expect(scene.errors).toEqual([{ line: 4, message: expect.stringMatching(/not drawn in space/) }])
    expect(scene.marks.filter((m) => m.kind === 'mesh')).toHaveLength(1)
  })

  it('an unknown name is a compile error on its line', () => {
    const scene = sceneOf('A = (1, 2, 3)\nz = w*x for x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"w"/) }])
    expect(scene.marks).toHaveLength(1)
  })

  it('an implicit surface is drawn (phase S4a; kernel/geometry/implicit.test.ts)', () => {
    const scene = sceneOf('x^2 + y^2 + z^2 = 4 res: 8')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => m.kind)).toEqual(['mesh'])
  })

  it('a named region arrives with region: in phase S5', () => {
    const scene = sceneOf('z = x over R')
    expect(scene.errors[0].message).toMatch(/named regions arrive with region: \(phase S5\)/)
  })

  it('a hidden statement draws nothing but still defines', () => {
    const scene = sceneOf('@hide: g, s\ng(x, y) = x + y name: g\nz = g(x, y) for x in [0, 1], y in [0, 1] name: s\nA = (g(1, 2), 0, 0)')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => m.kind)).toEqual(['points'])
    expect([...(scene.marks[0] as PointMark).positions]).toEqual([3, 0, 0])
  })
})

describe('parameters', () => {
  const SPEC = '@param a = 1 range [0, 3]\nz = a*x for x in [0, 1], y in [0, 1]\nA = (0, 0, 1)'
  const maxZ = (mesh: MeshMark) => Math.max(...Array.from({ length: vertexCount(mesh) }, (_, i) => mesh.positions[3 * i + 2]))

  it('setValue rebuilds what reads the parameter and keeps the rest by identity', () => {
    const kernel = kernelOf(SPEC)
    const before = kernel.scene()
    expect(kernel.bindings().map((b) => b.name)).toEqual(['a'])
    // a x on [0, 1]: max 1, then 2
    expect(maxZ(before.marks[0] as MeshMark)).toBe(1)
    const after = kernel.setValue('a', 2)
    expect(maxZ(after.marks[0] as MeshMark)).toBe(2)
    expect(after.marks[0]).not.toBe(before.marks[0])
    expect(after.marks[1]).toBe(before.marks[1])
    expect(kernel.scene()).toBe(after)
    expect(kernel.values().get('a')).toBe(2)
  })

  it('clamps to the range', () => {
    const kernel = kernelOf(SPEC)
    kernel.setValue('a', 9)
    expect(kernel.values().get('a')).toBe(3)
    kernel.setValue('a', -1)
    expect(kernel.values().get('a')).toBe(0)
  })

  it('rounds an integer binding', () => {
    const kernel = kernelOf('@param n = 1 range [0, 5] integer\nA = (n, 0, 0)')
    kernel.setValue('n', 2.6)
    expect(kernel.values().get('n')).toBe(3)
    expect([...(kernel.scene().marks[0] as PointMark).positions]).toEqual([3, 0, 0])
  })

  it('leaves the scene unchanged for an unknown name', () => {
    const kernel = kernelOf(SPEC)
    const before = kernel.scene()
    expect(kernel.setValue('nope', 1)).toBe(before)
    expect([...kernel.values()]).toEqual([['a', 1]])
  })

  it('follows the dependency through a user function', () => {
    const kernel = kernelOf('@param a = 1 range [0, 3]\nf(x, y) = a*x\nz = f(x, y) for x in [0, 1], y in [0, 1]\nA = (0, 0, 1)')
    const before = kernel.scene()
    const after = kernel.setValue('a', 2)
    expect(maxZ(after.marks[0] as MeshMark)).toBe(2)
    expect(after.marks[1]).toBe(before.marks[1])
  })

  it('refuses a parameter that clashes with a definition, naming it', () => {
    const scene = sceneOf('@param a = 1 range [0, 3]\na = 5\nA = (a, 0, 0)')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"a"/) }])
  })

  it('keeps colour slots and scale ids stable across setValue', () => {
    const kernel = kernelOf('@param a = 1 range [0, 3]\nz = a*x for x in [0, 1], y in [0, 1]\nz = x for x in [0, 1], y in [0, 1]')
    const before = kernel.scene().marks as MeshMark[]
    const after = kernel.setValue('a', 3).marks as MeshMark[]
    expect(after.map((m) => [m.style.color.slot, m.style.colorScale])).toEqual(before.map((m) => [m.style.color.slot, m.style.colorScale]))
  })
})

describe('extent', () => {
  it('cuts a pole off z by the percentile rule', () => {
    const scene = sceneOf('z = 1/(x^2 + y^2) for x in [-1, 1], y in [-1, 1] res: 96')
    const mesh = only(scene, 'mesh')
    let largest = 0
    for (let i = 0; i < vertexCount(mesh); i++) largest = Math.max(largest, mesh.positions[3 * i + 2])
    expect(scene.extent!.z.max).toBeLessThan(0.2 * largest)
  })

  it('keeps the full z range when there is no pole', () => {
    expect(sceneOf('z = x for x in [0, 1], y in [0, 1]').extent).toEqual({ x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, z: { min: 0, max: 1 } })
  })

  it('an explicit @bounds3d z sets the height colour domain', () => {
    const scene = sceneOf('@bounds3d: z [-2, 2]\nz = x for x in [0, 1], y in [0, 1]')
    expect(scene.colorScales[0].domain).toEqual({ min: -2, max: 2 })
  })
})

describe('the triangle budget', () => {
  it('accepts res 400 on a parametric surface (320,000 triangles)', () => {
    const scene = sceneOf('(u, v, u*v) for u in [0, 1], v in [0, 1] res: 400')
    expect(scene.errors).toEqual([])
    expect(only(scene, 'mesh').indices.length / 3).toBe(320000)
  })

  it('refuses a form over 1,000,000 triangles, naming the resolution', () => {
    // The grammar caps res: at 400, so the statement is built by hand.
    const parsed = parseSpec('z = x*y res: 40')
    const statement = parsed.statements[0] as Statement & { kind: 'space' }
    if (statement.form.form !== 'surface') throw new Error('unreachable')
    const big: Statement = { ...statement, form: { ...statement.form, style: { ...statement.form.style, res: 1000 } } }
    const scene = createSpaceKernel([big], parsed.config, [1]).scene()
    expect(scene.marks).toEqual([])
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].message).toMatch(/1000/)
  })
})

describe('compositions build (fix round 1, C1)', () => {
  it('z = k(k(x)) + y: the normal uses d/dx x^4 = 4x^3, 4 at x = 1', () => {
    const scene = sceneOf('k(x) = x^2\nz = k(k(x)) + y for x in [0, 1], y in [0, 1] res: 4')
    expect(scene.errors).toEqual([])
    const mesh = only(scene, 'mesh')
    if (mesh.pick?.kind !== 'graph') throw new Error('expected a graph pick')
    expect(mesh.pick.fx(1, 0)).toBe(4)
    expect(mesh.pick.fy(1, 0)).toBe(1)
  })

  it('a lifted y = k(k(x)) - 5 builds', () => {
    const scene = sceneOf('k(x) = x^2\ny = k(k(x)) - 5')
    expect(scene.errors).toEqual([])
    // y' = 4x^3: 32 at x = 2
    expect(only(scene, 'lines').pick!.dr(2)).toEqual([1, 32, 0])
  })

  it('a curve (k(k(t)), t, 0) builds, with r\'(1) = (4, 1, 0)', () => {
    const scene = sceneOf('k(x) = x^2\n(k(k(t)), t, 0) for t in [0, 1]')
    expect(scene.errors).toEqual([])
    expect(only(scene, 'lines').pick!.dr(1)).toEqual([4, 1, 0])
  })
})

describe('a definition named after a built-in is refused (fix round 1, I1)', () => {
  it('sin(x) = x^2 is an error on its line, and sin stays the built-in', () => {
    const scene = sceneOf('sin(x) = x^2\nA = (sin(0), 1, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/"sin" is a built-in/) }])
    // the built-in: sin(0) = 0, not 0^2 via the definition (which is also 0), so
    // check a point where they differ: sin(pi/2) = 1, (pi/2)^2 = 2.467
    const other = sceneOf('sin(x) = x^2\nA = (sin(pi/2), 1, 0)')
    expect([...(other.marks[0] as PointMark).positions]).toEqual([1, 1, 0])
  })

  it('pi = 3 is refused, and pi stays pi', () => {
    const scene = sceneOf('pi = 3\nA = (pi, 0, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/"pi"/) }])
    expect((scene.marks[0] as PointMark).positions[0]).toBe(Math.PI)
  })
})

describe('extent: sampled marks are robust, authored ones exact (fix round 1, R1)', () => {
  it('a pole does not clip an authored point: A = (0, 0, 100) keeps extent.z.max >= 100', () => {
    const scene = sceneOf('z = 1/(x^2 + y^2) for x in [-1, 1], y in [-1, 1] res: 96\nA = (0, 0, 100)')
    expect(scene.extent!.z.max).toBeGreaterThanOrEqual(100)
    // and the surface's own spike is still cut: its largest sample is 2304
    expect(scene.extent!.z.max).toBeLessThan(2304)
  })

  it('so does a point with no label: (0, 0, 100)', () => {
    // A = (…) is also kept by its label anchor; a bare point only by the mark rule.
    const scene = sceneOf('z = 1/(x^2 + y^2) for x in [-1, 1], y in [-1, 1] res: 96\n(0, 0, 100)')
    expect(scene.labels).toEqual([])
    expect(scene.extent!.z.max).toBeGreaterThanOrEqual(100)
  })

  it('a segment and an arrow extend it exactly', () => {
    // the surface's own robust range is about [0.5, 79.4]
    const scene = sceneOf('z = 1/(x^2 + y^2) for x in [-1, 1], y in [-1, 1]\n(0, 0, 0) -- (0, 0, -50)\n(0, 0, 0) -> (0, 0, 700)')
    expect(scene.extent!.z.min).toBe(-50)
    expect(scene.extent!.z.max).toBe(700)
  })
})

describe('colour scales are only those a mark references (fix round 1, R4)', () => {
  // The first surface's inner bounds cross when a > 2 (2 - a x changes sign
  // at x = 2/a), so setValue('a', 3) makes it fail and draw nothing.
  const SPEC = '@param a = 1 range [0, 3]\nz = x over x in [0, 1], y in [a*x - 1, 1]\nz = y for x in [0, 1], y in [0, 1]'
  const referenced = (scene: SpaceScene) => {
    const meshes = scene.marks.filter((m): m is MeshMark => m.kind === 'mesh')
    for (const m of meshes) {
      const i = m.style.colorScale!
      expect(scene.colorScales[i].id).toBe(i)
    }
    return meshes.map((m) => m.style.colorScale)
  }

  it('a failed rebuild leaves no orphan scale, and the others are renumbered', () => {
    const kernel = kernelOf(SPEC)
    expect(referenced(kernel.scene())).toEqual([0, 1])
    const failed = kernel.setValue('a', 3)
    expect(failed.errors.map((e) => e.line)).toEqual([2])
    expect(failed.colorScales).toHaveLength(1)
    expect(referenced(failed)).toEqual([0])
    // the remaining scale is the second surface's: height over [0, 1]
    expect(failed.colorScales[0].domain).toEqual({ min: 0, max: 1 })
    const back = kernel.setValue('a', 1)
    expect(back.colorScales).toHaveLength(2)
    expect(referenced(back)).toEqual([0, 1])
  })
})

describe('an explicit sequential map is kept (fix round 1, M1)', () => {
  it('colormap: x map viridis over x in [-1, 1] stays viridis, not diverging', () => {
    const scene = sceneOf('z = x for x in [-1, 1], y in [0, 1] colormap: x map viridis')
    expect(scene.colorScales[0]).toMatchObject({ map: 'viridis', diverging: false, domain: { min: -1, max: 1 } })
  })

  it('with no map named, a range across zero still diverges', () => {
    const scene = sceneOf('z = x for x in [-1, 2], y in [0, 1] colormap: x')
    expect(scene.colorScales[0]).toMatchObject({ map: 'balance', diverging: true, domain: { min: -2, max: 2 } })
  })
})

describe('parametric triangles wind with r_u x r_v (fix round 1, M2)', () => {
  // Every triangle's face normal (b - a) x (c - a) must point the way the
  // vertex normals do.
  const agrees = (mesh: MeshMark) => {
    const p = mesh.positions
    const n = mesh.normals
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
      const e1 = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]]
      const e2 = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]]
      const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const dot = face[0] * n[3 * a] + face[1] * n[3 * a + 1] + face[2] * n[3 * a + 2]
      if (!(dot > 0)) return false
    }
    return true
  }

  it('for increasing ranges', () => {
    expect(agrees(only(sceneOf('(u, v, 0) for u in [0, 1], v in [0, 1] res: 4'), 'mesh'))).toBe(true)
  })

  it('for a reversed range, u in [1, 0]', () => {
    // r_u x r_v = (1, 0, 0) x (0, 1, 0) = (0, 0, 1) still, but the grid now
    // runs the other way in u
    const mesh = only(sceneOf('(u, v, 0) for u in [1, 0], v in [0, 1] res: 4'), 'mesh')
    expect(vertex(mesh.normals, 0)).toEqual([0, 0, 1])
    expect(agrees(mesh)).toBe(true)
  })

  it('for both ranges reversed (orientation restored)', () => {
    expect(agrees(only(sceneOf('(u, v, 0) for u in [1, 0], v in [1, 0] res: 4'), 'mesh'))).toBe(true)
  })
})

describe('determinism', () => {
  it('the same spec gives the same scene, typed arrays included', () => {
    const spec = 'z = sin(x) cos(y) over x^2 + y^2 <= 9\n(cos(t), sin(t), t/4) for t in [0, 6]\nA = (1, 2, 3)'
    // Picks are compiled closures, new per kernel; everything else is data.
    const data = (scene: SpaceScene) => ({ ...scene, marks: scene.marks.map((m) => ({ ...m, pick: null })) })
    expect(data(sceneOf(spec))).toEqual(data(sceneOf(spec)))
  })
})
