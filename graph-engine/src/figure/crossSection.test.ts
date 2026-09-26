import { describe, expect, it } from 'vitest'
import { inPlane, liftOffset, sectionOf, trueShape, type SectionPlane } from './crossSection'
import { placementAlong } from './silhouette'
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
    expect(sortedVertices(shape(PRISM, { kind: 'axis', axis: 'y', at: 1 }))).toEqual([
      [-4, -3],
      [-4, 3],
      [4, -3],
      [4, 3],
    ])
    const inSpace = section(PRISM, { kind: 'axis', axis: 'y', at: 1 })
    if (inSpace.kind !== 'polygon') throw new Error('expected a polygon')
    for (const p of inSpace.points) expect(p.y).toBeCloseTo(1, 12)
  })

  it('cuts the same prism vertically in a 5-by-6 rectangle', () => {
    // x = 2 fixes the width, leaving (y, z) — 5 tall and 6 deep.
    expect(sortedVertices(shape(PRISM, { kind: 'axis', axis: 'x', at: 2 }))).toEqual([
      [-2.5, -3],
      [-2.5, 3],
      [2.5, -3],
      [2.5, 3],
    ])
  })

  it('winds the section so consecutive vertices are adjacent, not crossed', () => {
    const s = shape(PRISM, { kind: 'axis', axis: 'y', at: 0 })
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
    expect(sortedVertices(shape({ kind: 'pyramid', base: 6, height: 9 }, { kind: 'axis', axis: 'y', at: 0 }))).toEqual([
      [-1.5, -1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [1.5, 1.5],
    ])
  })

  it('cuts a tetrahedron through its base in the base triangle itself', () => {
    const edge = 5
    const s = shape({ kind: 'tetrahedron', edge }, { kind: 'axis', axis: 'y', at: -(edge * Math.sqrt(2 / 3)) / 2 })
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    expect(s.vertices).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      const p = s.vertices[i]
      const q = s.vertices[(i + 1) % 3]
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(edge, 9)
    }
  })

  it('fails legibly when the plane misses the solid', () => {
    expect(() => section(PRISM, { kind: 'axis', axis: 'y', at: 9 })).toThrow(/does not cut "S" — it misses the solid entirely/)
  })
})

describe('a plane through a curved primitive', () => {
  it('cuts a cylinder square to its axis in a circle of the cylinder radius', () => {
    const s = shape({ kind: 'cylinder', radius: 3, height: 8 }, { kind: 'axis', axis: 'y', at: 1 })
    expect(s.kind).toBe('circle')
    if (s.kind !== 'circle') return
    expect(s.radius).toBeCloseTo(3, 12)
    // Square to the axis the radius does NOT taper — a cylinder is not a cone,
    // and a test that only checked "it is a circle" would not notice if it did.
    const other = shape({ kind: 'cylinder', radius: 3, height: 8 }, { kind: 'axis', axis: 'y', at: -3.5 })
    if (other.kind !== 'circle') throw new Error('expected a circle')
    expect(other.radius).toBeCloseTo(3, 12)
  })

  it('cuts a cylinder parallel to its axis in the rectangle of the chord', () => {
    // At x = 3 through a radius-5 cylinder the chord half-length is 4, so the
    // rectangle is 8 across and as tall as the cylinder.
    const s = shape({ kind: 'cylinder', radius: 5, height: 10 }, { kind: 'axis', axis: 'x', at: 3 })
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
      const s = shape(cone, { kind: 'axis', axis: 'y', at })
      if (s.kind !== 'circle') throw new Error('expected a circle')
      expect(s.radius).toBeCloseTo(radius, 12)
    }
  })

  it('cuts a cone through its axis in its own triangle', () => {
    const s = shape({ kind: 'cone', radius: 6, height: 12 }, { kind: 'axis', axis: 'z', at: 0 })
    expect(sortedVertices(s)).toEqual([
      [-6, -6],
      [0, 6],
      [6, -6],
    ])
  })

  it('refuses the hyperbola rather than drawing something plausible', () => {
    expect(() => section({ kind: 'cone', radius: 6, height: 12 }, { kind: 'axis', axis: 'z', at: 2 })).toThrow(/HYPERBOLA/)
  })

  it('refuses a plane that meets a cone only at its apex', () => {
    expect(() => section({ kind: 'cone', radius: 6, height: 12 }, { kind: 'axis', axis: 'y', at: 6 })).toThrow(/only at its apex/)
  })

  it('cuts a sphere in the circle of the right radius, by Pythagoras', () => {
    const s = shape({ kind: 'sphere', radius: 5 }, { kind: 'axis', axis: 'z', at: 3 })
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.radius).toBeCloseTo(4, 12)
  })

  it('fails legibly when the plane misses a sphere', () => {
    expect(() => section({ kind: 'sphere', radius: 5 }, { kind: 'axis', axis: 'z', at: 5 })).toThrow(/misses the solid entirely/)
  })
})

describe('a plane through a frustum (P2)', () => {
  // Radius 6, top 3, height 4: base at y = -2, top at y = +2.
  const FRUSTUM: SolidSpec = { kind: 'frustum', radius: 6, top: 3, height: 4 }

  it('cuts it square to its axis at mid-height in a circle of radius (6 + 3) / 2', () => {
    const s = shape(FRUSTUM, { kind: 'axis', axis: 'y', at: 0 })
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.radius).toBeCloseTo(4.5, 12)
  })

  it('cuts it through its axis in an isosceles trapezoid with parallel sides 12 and 6', () => {
    const s = shape(FRUSTUM, { kind: 'axis', axis: 'z', at: 0 })
    expect(sortedVertices(s)).toEqual([
      [-6, -2],
      [-3, 2],
      [3, 2],
      [6, -2],
    ])
    if (s.kind !== 'polygon') return
    const bottom = s.vertices.filter((p) => Math.abs(p.y + 2) < 1e-12)
    const top = s.vertices.filter((p) => Math.abs(p.y - 2) < 1e-12)
    expect(Math.abs(bottom[0].x - bottom[1].x)).toBeCloseTo(12, 12)
    expect(Math.abs(top[0].x - top[1].x)).toBeCloseTo(6, 12)
  })

  it('refuses the hyperbola off the axis, like a cone', () => {
    expect(() => section(FRUSTUM, { kind: 'axis', axis: 'x', at: 1 })).toThrow(/parallel to a frustum's axis but off it .* HYPERBOLA/)
  })
})

describe('sections of a placed round solid (P7)', () => {
  it("refuses a tilted solid's section until oblique planes arrive", () => {
    const tilted = buildSolid({ kind: 'cylinder', radius: 3, height: 8 }, placementAlong({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }))
    expect(() => sectionOf(tilted, { kind: 'axis', axis: 'y', at: 1 }, 'C')).toThrow(
      /"C" is a tilted cylinder: sections of a tilted cylinder arrive with oblique planes \(build step 8\)/
    )
  })

  it('cuts a vertical solid off the origin where it actually is, the offset measured in the world', () => {
    // A cylinder of radius 3 and height 8 centred at internal (2, 3, 1): it
    // spans y in [-1, 7]. The world plane y = 5 is 2 above its centre.
    const placed = buildSolid({ kind: 'cylinder', radius: 3, height: 8 }, placementAlong({ x: 2, y: 3, z: 1 }, { x: 0, y: 1, z: 0 }))
    const s = sectionOf(placed, { kind: 'axis', axis: 'y', at: 5 }, 'C')
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.center).toEqual({ x: 2, y: 5, z: 1 })
    expect(s.radius).toBeCloseTo(3, 12)
    // At world x = 4, 2 from its axis: the chord half-length is sqrt(5),
    // across z about 1, and the rectangle as tall as the cylinder.
    const chord = sectionOf(placed, { kind: 'axis', axis: 'x', at: 4 }, 'C')
    if (chord.kind !== 'polygon') throw new Error('expected a polygon')
    const zs = chord.points.map((p) => p.z).sort((a, b) => a - b)
    expect(zs[0]).toBeCloseTo(1 - Math.sqrt(5), 12)
    expect(zs[3]).toBeCloseTo(1 + Math.sqrt(5), 12)
    for (const p of chord.points) expect(p.x).toBeCloseTo(4, 12)
    // World y = 8 is above it, and the message names the plane the author
    // wrote (internal y is author z).
    expect(() => sectionOf(placed, { kind: 'axis', axis: 'y', at: 8 }, 'C')).toThrow(/The plane z = 8 does not cut "C"/)
  })

  it('cuts a frustum wider at the top, reversed, with its wide rim on top in the world', () => {
    // Radius 3 at the base, 6 at the top: a quarter of the way up (y = -1)
    // the section is 3 + 3/4 = 3.75, not 6 - 3/4.
    const wide = buildSolid({ kind: 'frustum', radius: 3, top: 6, height: 4 })
    const s = sectionOf(wide, { kind: 'axis', axis: 'y', at: -1 }, 'F')
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.radius).toBeCloseTo(3.75, 12)
    expect(s.center.y).toBeCloseTo(-1, 12)
  })
})

describe("the plane's own frame", () => {
  it('drops the axis the plane fixes and keeps the other two in x, y, z order', () => {
    const p = { x: 1, y: 2, z: 3 }
    expect(inPlane({ kind: 'axis', axis: 'x', at: 1 }, p)).toEqual({ x: 2, y: 3 })
    expect(inPlane({ kind: 'axis', axis: 'y', at: 2 }, p)).toEqual({ x: 1, y: 3 })
    expect(inPlane({ kind: 'axis', axis: 'z', at: 3 }, p)).toEqual({ x: 1, y: 2 })
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
