import { describe, expect, it } from 'vitest'
import { inPlane, liftOffset, sectionOf, trueShape, type SectionPlane } from './crossSection'
import { buildSolid, type SolidSpec } from './solids'

// Hand-computed vertices throughout. A section that returns four points is
// still wrong if they are the wrong four, and a count would not notice.

function section(spec: SolidSpec, plane: SectionPlane) {
  return sectionOf(buildSolid(spec), plane, 'S')
}

function shape(spec: SolidSpec, plane: SectionPlane) {
  return trueShape(section(spec, plane), plane)
}

function sortedVertices(s: { kind: 'polygon'; vertices: { x: number; y: number }[] } | { kind: 'circle' }) {
  if (s.kind !== 'polygon') throw new Error('expected a polygon')
  return [...s.vertices].sort((a, b) => a.x - b.x || a.y - b.y).map((p) => [round(p.x), round(p.y)])
}

function round(n: number): number {
  return Math.round(n * 1e9) / 1e9
}

describe('a plane through a polyhedron', () => {
  const PRISM: SolidSpec = { kind: 'prism', width: 8, height: 5, depth: 6 }

  it('cuts a prism in the rectangle its own dimensions give', () => {
    // Horizontally through an 8-by-5-by-6 prism: an 8-by-6 rectangle, at the
    // height asked for. The true shape drops y and keeps (x, z) — the two
    // coordinates the plane does not fix, in their own order, so 8 stays the
    // width and 6 the depth rather than the pair coming out transposed.
    expect(sortedVertices(shape(PRISM, { axis: 'y', at: 1 }))).toEqual([
      [-4, -3],
      [-4, 3],
      [4, -3],
      [4, 3],
    ])
    const inSpace = section(PRISM, { axis: 'y', at: 1 })
    if (inSpace.kind !== 'polygon') throw new Error('expected a polygon')
    for (const p of inSpace.points) expect(p.y).toBeCloseTo(1, 12)
  })

  it('cuts the same prism vertically in a 5-by-6 rectangle', () => {
    // x = 2 fixes the width, leaving (y, z) — 5 tall and 6 deep.
    expect(sortedVertices(shape(PRISM, { axis: 'x', at: 2 }))).toEqual([
      [-2.5, -3],
      [-2.5, 3],
      [2.5, -3],
      [2.5, 3],
    ])
  })

  it('winds the section so consecutive vertices are adjacent, not crossed', () => {
    const s = shape(PRISM, { axis: 'y', at: 0 })
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    // A rectangle wound correctly has four sides of two distinct lengths; one
    // wound as a bowtie has two diagonals among them.
    const sides = s.vertices.map((p, i) => {
      const q = s.vertices[(i + 1) % s.vertices.length]
      return round(Math.hypot(q.x - p.x, q.y - p.y))
    })
    expect(new Set(sides)).toEqual(new Set([8, 6]))
  })

  it('cuts a square pyramid halfway up in a square of half the base', () => {
    // A pyramid on a 6 base, 9 tall, cut at y = 0 — halfway between the base
    // at -4.5 and the apex at 4.5 — gives a 3-by-3 square.
    expect(sortedVertices(shape({ kind: 'pyramid', base: 6, height: 9 }, { axis: 'y', at: 0 }))).toEqual([
      [-1.5, -1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [1.5, 1.5],
    ])
  })

  it('cuts a tetrahedron through its base in the base triangle itself', () => {
    const edge = 5
    const s = shape({ kind: 'tetrahedron', edge }, { axis: 'y', at: -(edge * Math.sqrt(2 / 3)) / 2 })
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    expect(s.vertices).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      const p = s.vertices[i]
      const q = s.vertices[(i + 1) % 3]
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(edge, 9)
    }
  })

  it('fails legibly when the plane misses the solid', () => {
    expect(() => section(PRISM, { axis: 'y', at: 9 })).toThrow(/does not cut "S" — it misses the solid entirely/)
  })
})

describe('a plane through a curved primitive', () => {
  it('cuts a cylinder square to its axis in a circle of the cylinder radius', () => {
    const s = shape({ kind: 'cylinder', radius: 3, height: 8 }, { axis: 'y', at: 1 })
    expect(s.kind).toBe('circle')
    if (s.kind !== 'circle') return
    expect(s.radius).toBeCloseTo(3, 12)
    // Square to the axis the radius does NOT taper — a cylinder is not a cone,
    // and a test that only checked "it is a circle" would not notice if it did.
    const other = shape({ kind: 'cylinder', radius: 3, height: 8 }, { axis: 'y', at: -3.5 })
    if (other.kind !== 'circle') throw new Error('expected a circle')
    expect(other.radius).toBeCloseTo(3, 12)
  })

  it('cuts a cylinder parallel to its axis in the rectangle of the chord', () => {
    // At x = 3 through a radius-5 cylinder the chord half-length is 4, so the
    // rectangle is 8 across and as tall as the cylinder.
    const s = shape({ kind: 'cylinder', radius: 5, height: 10 }, { axis: 'x', at: 3 })
    expect(sortedVertices(s)).toEqual([
      [-5, -4],
      [-5, 4],
      [5, -4],
      [5, 4],
    ])
  })

  it('tapers a cone section linearly, which is what makes it a cone', () => {
    const cone: SolidSpec = { kind: 'cone', radius: 6, height: 12 }
    // Base at y = -6, apex at y = +6. At the base the radius is 6; halfway up
    // it is 3; three quarters up, 1.5.
    for (const [at, radius] of [
      [-6, 6],
      [0, 3],
      [3, 1.5],
    ] as const) {
      const s = shape(cone, { axis: 'y', at })
      if (s.kind !== 'circle') throw new Error('expected a circle')
      expect(s.radius).toBeCloseTo(radius, 12)
    }
  })

  it('cuts a cone through its axis in its own triangle', () => {
    const s = shape({ kind: 'cone', radius: 6, height: 12 }, { axis: 'z', at: 0 })
    expect(sortedVertices(s)).toEqual([
      [-6, -6],
      [0, 6],
      [6, -6],
    ])
  })

  it('refuses the hyperbola rather than drawing something plausible', () => {
    expect(() => section({ kind: 'cone', radius: 6, height: 12 }, { axis: 'z', at: 2 })).toThrow(/HYPERBOLA/)
  })

  it('refuses a plane that meets a cone only at its apex', () => {
    expect(() => section({ kind: 'cone', radius: 6, height: 12 }, { axis: 'y', at: 6 })).toThrow(/only at its apex/)
  })

  it('cuts a sphere in the circle of the right radius, by Pythagoras', () => {
    const s = shape({ kind: 'sphere', radius: 5 }, { axis: 'z', at: 3 })
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.radius).toBeCloseTo(4, 12)
  })

  it('fails legibly when the plane misses a sphere', () => {
    expect(() => section({ kind: 'sphere', radius: 5 }, { axis: 'z', at: 5 })).toThrow(/misses the solid entirely/)
  })
})

describe("the plane's own frame", () => {
  it('drops the axis the plane fixes and keeps the other two in x, y, z order', () => {
    const p = { x: 1, y: 2, z: 3 }
    expect(inPlane({ axis: 'x', at: 1 }, p)).toEqual({ x: 2, y: 3 })
    expect(inPlane({ axis: 'y', at: 2 }, p)).toEqual({ x: 1, y: 3 })
    expect(inPlane({ axis: 'z', at: 3 }, p)).toEqual({ x: 1, y: 2 })
  })
})

describe('where a lifted section is placed', () => {
  it('clears the solid to its right, by a quarter of the solid width', () => {
    const solid = { minX: -10, minY: -6, maxX: 10, maxY: 6 }
    const shapeBounds = { minX: -3, minY: -4, maxX: 3, maxY: 4 }
    const offset = liftOffset(solid, shapeBounds)
    // Left edge at 10 + 0.25 * 20 = 15, so the shape's own -3 moves to 15.
    expect(offset.x).toBeCloseTo(18, 12)
    // Vertical centres level: both are already centred on 0.
    expect(offset.y).toBeCloseTo(0, 12)
  })

  it('levels the centres rather than the tops', () => {
    const offset = liftOffset({ minX: 0, minY: 0, maxX: 4, maxY: 10 }, { minX: 0, minY: 0, maxX: 2, maxY: 2 })
    expect(offset.y).toBeCloseTo(4, 12)
  })
})
