import { describe, expect, it } from 'vitest'
import type { LineMark, MeshMark } from '../../scene/types'
import { kernelOf, marksOf, sceneOf, vertexOf, vertices } from '../../testing/kernel'
import { clipLine } from './lines'
import { planeBoxPolygon } from './planes'

const CUBE2 = '@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]'
const CUBE1 = '@bounds3d: x [-1, 1], y [-1, 1], z [-1, 1]'
const POSITIVE2 = '@bounds3d: x [0, 2], y [0, 2], z [0, 2]'

function onlyLine(spec: string): LineMark {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  const lines = marksOf(scene, 'lines')
  expect(lines).toHaveLength(1)
  return lines[0]
}

function plane(spec: string): { mesh: MeshMark; outline: LineMark } {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  const meshes = marksOf(scene, 'mesh')
  const lines = marksOf(scene, 'lines')
  expect(meshes).toHaveLength(1)
  expect(lines).toHaveLength(1)
  return { mesh: meshes[0], outline: lines[0] }
}

const key = (p: readonly number[]) => p.map((c) => (Object.is(c, -0) ? 0 : c)).join(',')

describe('line:', () => {
  it('through (0,0,0) direction <1,1,1> in [-2, 2]^3 runs from (-2,-2,-2) to (2,2,2) exactly', () => {
    const line = onlyLine(`${CUBE2}\nline: through (0,0,0) direction <1,1,1>`)
    expect([...line.positions]).toEqual([-2, -2, -2, 2, 2, 2])
    expect([...line.starts]).toEqual([0])
    expect([...line.params!]).toEqual([-2, 2])
    expect(line.source.object).toBe('s2')
    expect(line.style).toEqual({ color: { author: null, slot: 0 }, width: 2, dash: null, hidden: 'dashed' })
    expect(line.pick!.param).toBe('t')
    expect(line.pick!.r(0.5)).toEqual([0.5, 0.5, 0.5])
    expect(line.pick!.dr(0.5)).toEqual([1, 1, 1])
  })

  it('through P and Q (named points) is clipped to the box, each end exactly on a face', () => {
    // P + t (Q - P) with P = (1, 2, 3), Q - P = (-1, -2, -2): the slabs of
    // [-5, 5]^3 give x: [-4, 6], y: [-1.5, 3.5], z: [-1, 4], so t runs over
    // [-1, 3.5]. The box is authored: since the box pass (J1) the drawn P and
    // Q would otherwise size it to [0, 1] x [0, 2] x [1, 3], where the line is
    // the segment P-Q.
    const line = onlyLine('@bounds3d: x [-5, 5], y [-5, 5], z [-5, 5]\nP = (1, 2, 3)\nQ = (0, 0, 1)\nline: through P and Q')
    expect(vertices(line.positions)).toEqual([
      [2, 4, 5],
      [-2.5, -5, -4],
    ])
    expect([...line.params!]).toEqual([-1, 3.5])
  })

  it('puts each end exactly on the face that bounds it, even when P + t d rounds', () => {
    // Unsnapped, P + t d lands at -0.9999999999999999 and 0.9999999999999999.
    for (const [p, d] of [
      ['(-0.1, 0.2, 0.1)', '<0.3, -0.1, 0.3>'],
      ['(-0.1, -0.7, 0.1)', '<0.3, -0.1, 0.3>'],
    ]) {
      const line = onlyLine(`${CUBE1}
line: through ${p} direction ${d}`)
      for (const end of vertices(line.positions)) expect(end.some((c) => c === 1 || c === -1)).toBe(true)
    }
  })

  it('through two tuples; width: and dashed apply', () => {
    const line = onlyLine(`${CUBE2}\nline: through (1, 0, 0) and (1, 1, 0) width: 3 dashed`)
    expect(vertices(line.positions)).toEqual([
      [1, -2, 0],
      [1, 2, 0],
    ])
    expect(line.style).toMatchObject({ width: 3, dash: [6, 4] })
  })

  it('takes a named vector and a vector function at a point as its direction', () => {
    const u = onlyLine(`${CUBE2}\nu = <1, 0, 0>\nline: through (0, 1, 1) direction u`)
    expect(vertices(u.positions)).toEqual([
      [-2, 1, 1],
      [2, 1, 1],
    ])
    // F(1, 0, 2) = <y, z, x> at (1, 0, 2) = (0, 2, 1)
    const F = onlyLine(`${CUBE2}\nF(x, y, z) = <y, z, x>\nline: through (0, 0, 0) direction F(1, 0, 2)`)
    expect(vertices(F.positions)).toEqual([
      [0, -2, -1],
      [0, 2, 1],
    ])
  })

  it('refuses in its own words: a line that misses the box, a zero direction, one point twice, an unknown name', () => {
    const miss = sceneOf(`${CUBE2}\nline: through (0, 5, 0) direction <1,0,0>`)
    expect(miss.errors).toEqual([{ line: 2, message: 'The line through (0, 5, 0) direction <1,0,0> does not meet the box — widen @bounds3d' }])
    expect(miss.marks).toEqual([])
    expect(sceneOf('line: through (0, 0, 0) direction <0, 0, 0>').errors[0].message).toMatch(/direction <0, 0, 0> is zero/)
    expect(sceneOf('P = (1, 1, 1)\nline: through P and P').errors[0].message).toMatch(/P and P are the same point/)
    expect(sceneOf('line: through P and (1, 2, 3)').errors).toEqual([{ line: 1, message: '"P" is not a point — define it first, e.g. "P = (1, 2, 3)"' }])
    expect(sceneOf('u = 3\nline: through (0, 0, 0) direction u').errors[0].message).toMatch(/"u" is not a vector/)
  })
})

describe('plane:', () => {
  it('x + y + z = 1 in [0, 2]^3 is the triangle (1,0,0), (0,1,0), (0,0,1)', () => {
    const { mesh, outline } = plane(`${POSITIVE2}\nplane: x + y + z = 1`)
    expect(vertices(mesh.positions).map(key).sort()).toEqual(['0,0,1', '0,1,0', '1,0,0'])
    expect([...mesh.indices]).toHaveLength(3)
    const s = 1 / Math.sqrt(3)
    for (const n of vertices(mesh.normals)) {
      expect(n[0]).toBeCloseTo(s, 15)
      expect(n[1]).toBeCloseTo(s, 15)
      expect(n[2]).toBeCloseTo(s, 15)
    }
    expect(mesh.style).toEqual({ color: { author: null, slot: 0 }, opacity: 0.35, colorScale: null, meshLines: null })
    expect(mesh.pick).toBeNull()
    expect(mesh.source.object).toBe('s2')
    // The outline closes on its first vertex, 1.5 px, in the plane's colour.
    expect(outline.source.object).toBe('s2.outline')
    expect(outline.positions.length / 3).toBe(4)
    expect(vertexOf(outline.positions, 3)).toEqual(vertexOf(outline.positions, 0))
    expect(outline.style).toMatchObject({ width: 1.5, dash: null, color: { author: null, slot: 0 } })
  })

  it('x + y + z = 0 in [-1, 1]^3 is the regular hexagon on the permutations of (1, -1, 0), fanned without folding', () => {
    const { mesh } = plane(`${CUBE1}\nplane: x + y + z = 0`)
    const expected = ['1,-1,0', '1,0,-1', '-1,1,0', '0,1,-1', '-1,0,1', '0,-1,1'].sort()
    expect(vertices(mesh.positions).map(key).sort()).toEqual(expected)
    for (const p of vertices(mesh.positions)) expect(Math.hypot(...p)).toBeCloseTo(Math.SQRT2, 15)
    // Every fan triangle is wound counter-clockwise about the normal (1,1,1):
    // with the vertices out of angular order, some fold back.
    expect(mesh.indices.length / 3).toBe(4)
    for (let t = 0; t < 4; t++) {
      const [a, b, c] = [0, 1, 2].map((i) => vertexOf(mesh.positions, mesh.indices[3 * t + i]))
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      expect(n[0] + n[1] + n[2]).toBeGreaterThan(0)
    }
  })

  it('through three points equals the equation', () => {
    const { mesh } = plane(`${POSITIVE2}\nplane: through (1,0,0), (0,1,0), (0,0,1)`)
    expect(vertices(mesh.positions).map(key).sort()).toEqual(['0,0,1', '0,1,0', '1,0,0'])
    const named = plane(`${POSITIVE2}\nP = (1, 0, 0)\nQ = (0, 1, 0)\nR = (0, 0, 1)\nplane: through P, Q, R`)
    expect(vertices(named.mesh.positions).map(key).sort()).toEqual(['0,0,1', '0,1,0', '1,0,0'])
  })

  it('through a point with a normal; z = 1 is the square across the box; opacity: applies', () => {
    const { mesh } = plane('@bounds3d: x [0, 4], y [0, 4], z [0, 4]\nplane: through (1, 2, 3) normal <1, 1, 1>')
    for (const [x, y, z] of vertices(mesh.positions)) expect(x + y + z).toBeCloseTo(6, 12)
    const square = plane(`${CUBE2}\nplane: z = 1 opacity: 0.5`)
    expect(vertices(square.mesh.positions).map(key).sort()).toEqual(['-2,-2,1', '-2,2,1', '2,-2,1', '2,2,1'])
    expect(square.mesh.style.opacity).toBe(0.5)
  })

  it('follows a parameter', () => {
    const kernel = kernelOf(`${CUBE2}\n@param a = 1 range [-1, 1]\nplane: z = a`)
    expect((kernel.scene().marks[0] as MeshMark).positions[2]).toBe(1)
    kernel.setValue('a', -0.5)
    expect((kernel.scene().marks[0] as MeshMark).positions[2]).toBe(-0.5)
  })

  it('refuses in its own words: collinear points, a non-linear equation, a zero normal, a plane that misses the box', () => {
    expect(sceneOf('plane: through (1,0,0), (2,0,0), (3,0,0)').errors[0].message).toMatch(/\(1,0,0\), \(2,0,0\) and \(3,0,0\) are collinear/)
    expect(sceneOf('plane: x^2 + y = 1').errors[0].message).toMatch(/x\^2 \+ y = 1 is not linear in x, y, z/)
    expect(sceneOf('plane: 0x = 1').errors[0].message).toMatch(/0x = 1 has no x, y or z term — its normal is zero/)
    expect(sceneOf('plane: through (0,0,0) normal <0,0,0>').errors[0].message).toMatch(/normal <0,0,0> is zero/)
    expect(sceneOf(`${CUBE2}\nplane: z = 10`).errors).toEqual([{ line: 2, message: 'The plane z = 10 does not meet the box — widen @bounds3d' }])
  })
})

describe('clipLine and planeBoxPolygon', () => {
  const box = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }

  it('clipLine: slab bounds, null for a line that misses or only grazes', () => {
    expect(clipLine([0, 0, 0], [1, 0, 0], box)).toEqual([-1, 1])
    expect(clipLine([0, 2, 0], [1, 0, 0], box)).toBeNull()
    // touches the edge x = 1, y = 1 only
    expect(clipLine([1, 1, 0], [1, -1, 0], box)).toBeNull()
  })

  it('planeBoxPolygon: a plane through a face diagonal is a rectangle of box corners', () => {
    const poly = planeBoxPolygon([1, -1, 0], 0, box)
    expect(poly.map(key).sort()).toEqual(['-1,-1,-1', '-1,-1,1', '1,1,-1', '1,1,1'])
  })

  it('planeBoxPolygon: a plane touching one edge meets the box in no polygon', () => {
    expect(planeBoxPolygon([1, 1, 0], 2, box)).toEqual([])
  })
})
