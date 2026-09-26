import { describe, expect, it } from 'vitest'
import { inPlane, liftOffset, sectionOf, trueShape, type SectionPlane } from './crossSection'
import { placementAlong } from './silhouette'
import { buildSolid, type SolidSpec } from './solids'
import { authorToWorld, worldToAuthor } from './authorFrame'
import { length3, planeThrough, scale3, sub3 } from './construct3d'
import { hullOf } from './hull'
import { canonicalPlane } from './plane'
import type { Vec3 } from './project3d'

// Hand-computed vertices throughout. A section that returns four points is
// still wrong if they are the wrong four, and a count would not notice.

function section(spec: SolidSpec, plane: SectionPlane) {
  return sectionOf(buildSolid(spec), plane, 'S')
}

function shape(spec: SolidSpec, plane: SectionPlane) {
  return trueShape(section(spec, plane), plane)
}

function sortedVertices(s: { kind: 'polygon'; vertices: { x: number; y: number }[] } | { kind: 'circle' } | { kind: 'region' }) {
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

  it('fails legibly when the plane misses a sphere, and says so when it only touches it (Q4)', () => {
    expect(() => section({ kind: 'sphere', radius: 5 }, { kind: 'axis', axis: 'z', at: 6 })).toThrow(/misses the solid entirely/)
    // Phase 8: tangent is not "misses" — the plane touches the sphere at one point.
    expect(() => section({ kind: 'sphere', radius: 5 }, { kind: 'axis', axis: 'z', at: 5 })).toThrow(
      'The plane x = 5 touches "S" at one point — it does not cut through it'
    )
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

// ---------------------------------------------------------------------------
// Phase 8, Task 2 — oblique sections of polyhedra (Q3)
// ---------------------------------------------------------------------------

describe('oblique sections of a polyhedron (Q3)', () => {
  // The unit cube by points, A-D the floor counter-clockwise from the origin
  // and E-H above them, in the AUTHOR frame.
  const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  const AUTHOR: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: 0, y: 1, z: 1 },
  ]
  const at = (name: string) => authorToWorld(AUTHOR[NAMES.indexOf(name)])
  const cube = buildSolid({ kind: 'hull', shape: 'hull', polyhedron: hullOf(AUTHOR.map(authorToWorld), NAMES) })

  // The plane through the centre O perpendicular to the diagonal A-G:
  // x + y + z = 3/2.
  const O = authorToWorld({ x: 0.5, y: 0.5, z: 0.5 })
  const diagonal = sub3(at('G'), at('A'))
  const HEXAGON = canonicalPlane({ point: O, normal: scale3(diagonal, 1 / length3(diagonal)) }, 'through O perpendicular to A-G')

  function authorPoints(s: ReturnType<typeof sectionOf>): Vec3[] {
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    return s.points.map(worldToAuthor)
  }

  it('cuts the cube through its centre, square to A-G, in the six edge midpoints', () => {
    // By hand: the edges not touching A or G, each at its midpoint, where
    // the one free coordinate is 1/2.
    const points = authorPoints(sectionOf(cube, HEXAGON, 'C'))
    expect(points).toHaveLength(6)
    const key = (p: Vec3) => [p.x, p.y, p.z].map((c) => Math.round(c * 1e9) / 1e9).join(',')
    expect(points.map(key).sort()).toEqual(['0,0.5,1', '0,1,0.5', '0.5,0,1', '0.5,1,0', '1,0,0.5', '1,0.5,0'].sort())
  })

  it('winds the hexagon by angle about its centroid, starting from the vertex at 9 o’clock', () => {
    // Q1's frame for x + y + z = 3/2: v = (-1, -1, 2)/sqrt 6 (author Z in the
    // plane), u = v x n = (-1, 1, 0)/sqrt 2. The midpoint of BF, (1, 0, 1/2),
    // sits at u = -sqrt(2)/2, v = 0 from the centre: straight left, angle pi,
    // which the rule takes as -pi — the FIRST vertex, whatever side of zero
    // the rounding puts its v. Then counter-clockwise: (1, 1/2, 0) at -120
    // degrees, (1/2, 1, 0) at -60, (0, 1, 1/2) at 0, (0, 1/2, 1) at 60,
    // (1/2, 0, 1) at 120.
    const points = authorPoints(sectionOf(cube, HEXAGON, 'C'))
    const expected = [
      { x: 1, y: 0, z: 0.5 },
      { x: 1, y: 0.5, z: 0 },
      { x: 0.5, y: 1, z: 0 },
      { x: 0, y: 1, z: 0.5 },
      { x: 0, y: 0.5, z: 1 },
      { x: 0.5, y: 0, z: 1 },
    ]
    points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 12)
      expect(p.y).toBeCloseTo(expected[i].y, 12)
      expect(p.z).toBeCloseTo(expected[i].z, 12)
    })
    // Lifted, P is the leftmost vertex, level with the centre.
    const shape = trueShape(sectionOf(cube, HEXAGON, 'C'), HEXAGON)
    if (shape.kind !== 'polygon') throw new Error('expected a polygon')
    const [p] = shape.vertices
    const centre = { x: shape.vertices.reduce((s, q) => s + q.x, 0) / 6, y: shape.vertices.reduce((s, q) => s + q.y, 0) / 6 }
    expect(p.x - centre.x).toBeCloseTo(-Math.SQRT1_2, 12)
    expect(p.y - centre.y).toBeCloseTo(0, 12)
  })

  it('returns the face itself when the plane contains one (an oblique face of a tetrahedron)', () => {
    const tetra = buildSolid({ kind: 'tetrahedron', edge: 6 })
    const v = tetra.polyhedron!.vertices
    // A face of the regular tetrahedron: base vertex 0, base vertex 1, apex.
    const plane = canonicalPlane(planeThrough(v[0], v[1], v[3]), 'A-B-D')
    expect(plane.kind).toBe('general')
    const s = sectionOf(tetra, plane, 'T')
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    expect(s.points).toHaveLength(3)
    for (const corner of [v[0], v[1], v[3]]) {
      expect(s.points.some((p) => length3(sub3(p, corner)) < 1e-12)).toBe(true)
    }
  })

  it('refuses a plane that only touches a vertex', () => {
    // x + y + z = 3 meets the cube only at G = (1, 1, 1).
    const touch = canonicalPlane({ point: at('G'), normal: scale3(diagonal, 1 / length3(diagonal)) }, 'through G perpendicular to A-G')
    expect(() => sectionOf(cube, touch, 'C')).toThrow(
      'The plane through G perpendicular to A-G meets "C" only at the vertex (1, 1, 1) — it does not cut through it'
    )
  })

  it('refuses a plane that only touches an edge', () => {
    // x + z = 2 meets the cube only along F-G, from (1, 0, 1) to (1, 1, 1).
    const n = authorToWorld({ x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 })
    const touch = canonicalPlane({ point: at('F'), normal: n }, 'x + z = 2')
    expect(() => sectionOf(cube, touch, 'C')).toThrow(
      'The plane x + z = 2 meets "C" only along the edge (1, 0, 1)-(1, 1, 1) — it does not cut through it'
    )
  })

  it('refuses an axis plane that only touches the apex, too', () => {
    // A pyramid 9 tall: the apex is at internal y = 4.5, author z = 4.5.
    expect(() => section({ kind: 'pyramid', base: 6, height: 9 }, { kind: 'axis', axis: 'y', at: 4.5 })).toThrow(
      'The plane z = 4.5 meets "S" only at the vertex (0, 0, 4.5) — it does not cut through it'
    )
  })
})

describe('the AIME square pyramid (Q3)', () => {
  it('cuts the pyramid of eight edges 4, through the midpoints of AE, BC and CD, in a pentagon on its edges', () => {
    // AIME 2007 I #13: all eight edges 4, so the height is 4/sqrt 2 = 2 sqrt 2.
    const pyramid = buildSolid({ kind: 'pyramid', base: 4, height: 2 * Math.SQRT2 })
    const v = pyramid.polyhedron!.vertices
    const [A, B, C, D, E] = pyramid.labelOrder.map((i) => v[i])
    const mid = (p: Vec3, q: Vec3): Vec3 => scale3({ x: p.x + q.x, y: p.y + q.y, z: p.z + q.z }, 0.5)
    const plane = canonicalPlane(planeThrough(mid(A, E), mid(B, C), mid(C, D)), 'M-N-K')
    expect(plane.kind).toBe('general')
    const s = sectionOf(pyramid, plane, 'P')
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    expect(s.points).toHaveLength(5)
    // Every vertex lies on an edge of the pyramid, within its two ends.
    const edges: [Vec3, Vec3][] = [
      [A, B], [B, C], [C, D], [D, A],
      [A, E], [B, E], [C, E], [D, E],
    ]
    for (const p of s.points) {
      const onEdge = edges.some(([a, b]) => {
        const d = sub3(b, a)
        const t = (sub3(p, a).x * d.x + sub3(p, a).y * d.y + sub3(p, a).z * d.z) / (length3(d) * length3(d))
        const foot = { x: a.x + t * d.x, y: a.y + t * d.y, z: a.z + t * d.z }
        return t >= -1e-12 && t <= 1 + 1e-12 && length3(sub3(p, foot)) < 1e-9
      })
      expect(onEdge).toBe(true)
    }
    // And its area is the AIME answer, sqrt 80, by the shoelace formula on the
    // lifted true shape.
    const shape = trueShape(s, plane)
    if (shape.kind !== 'polygon') throw new Error('expected a polygon')
    let twice = 0
    shape.vertices.forEach((p, i) => {
      const q = shape.vertices[(i + 1) % shape.vertices.length]
      twice += p.x * q.y - q.x * p.y
    })
    expect(Math.abs(twice) / 2).toBeCloseTo(Math.sqrt(80), 10)
  })
})

// ---------------------------------------------------------------------------
// Phase 8, Task 3 — sections of round solids by any plane (Q4, Q5)
// ---------------------------------------------------------------------------
//
// Every expected value below is computed by hand in the AUTHOR frame (z up),
// never read back from the code under test.

type Piece3 = { kind: 'segment'; a: Vec3; b: Vec3 } | { kind: 'arc'; center: Vec3; u: Vec3; v: Vec3; from: number; to: number }

function pieceStart(piece: Piece3): Vec3 {
  if (piece.kind === 'segment') return piece.a
  return {
    x: piece.center.x + piece.u.x * Math.cos(piece.from) + piece.v.x * Math.sin(piece.from),
    y: piece.center.y + piece.u.y * Math.cos(piece.from) + piece.v.y * Math.sin(piece.from),
    z: piece.center.z + piece.u.z * Math.cos(piece.from) + piece.v.z * Math.sin(piece.from),
  }
}

function pieceEnd(piece: Piece3): Vec3 {
  if (piece.kind === 'segment') return piece.b
  return pieceStart({ ...piece, from: piece.to })
}

// A plane from an author normal (need not be unit) and an author point on it.
function authorPlane3(normal: Vec3, point: Vec3, source = 'the plane') {
  const n = authorToWorld(normal)
  return canonicalPlane({ point: authorToWorld(point), normal: scale3(n, 1 / length3(n)) }, source)
}

// The semi-axes of the ellipse an arc lies on, from its conjugate
// semi-diameters — independently of the code under test: for conjugate u, v
// the semi-axes are the square roots of the eigenvalues of the Gram matrix
// [[u.u, u.v], [u.v, v.v]].
function semiAxes(u: Vec3, v: Vec3): [number, number] {
  const a = u.x * u.x + u.y * u.y + u.z * u.z
  const c = v.x * v.x + v.y * v.y + v.z * v.z
  const b = u.x * v.x + u.y * v.y + u.z * v.z
  const mid = (a + c) / 2
  const root = Math.sqrt(((a - c) / 2) ** 2 + b * b)
  return [Math.sqrt(mid - root), Math.sqrt(mid + root)]
}

type Region = Extract<ReturnType<typeof sectionOf>, { kind: 'region' }>

function region(s: ReturnType<typeof sectionOf>): Region {
  if (s.kind !== 'region') throw new Error(`expected a region, got a ${s.kind}`)
  return s
}

const arcsOf = (r: Region) => r.boundary.filter((p) => p.kind === 'arc')
const chordsOf = (r: Region) => r.boundary.filter((p) => p.kind === 'segment')
const chordLengths = (r: Region) =>
  chordsOf(r)
    .map((c) => (c.kind === 'segment' ? length3(sub3(c.b, c.a)) : 0))
    .sort((a, b) => a - b)

describe('sections of a sphere by any plane (Q4)', () => {
  const SPHERE = buildSolid({ kind: 'sphere', radius: 5 })

  it('cuts in a circle centred at the foot of the centre, radius sqrt(r^2 - d^2)', () => {
    // n = (1, 2, 2)/3, distance 3: the foot is (1, 2, 2), the radius 4.
    const s = sectionOf(SPHERE, authorPlane3({ x: 1, y: 2, z: 2 }, { x: 1, y: 2, z: 2 }), 'S')
    if (s.kind !== 'circle') throw new Error('expected a circle')
    expect(s.radius).toBeCloseTo(4, 12)
    const c = worldToAuthor(s.center)
    expect(c.x).toBeCloseTo(1, 12)
    expect(c.y).toBeCloseTo(2, 12)
    expect(c.z).toBeCloseTo(2, 12)
  })

  it('refuses a tangent plane: it touches the sphere at one point', () => {
    expect(() => sectionOf(SPHERE, authorPlane3({ x: 3, y: 0, z: 4 }, { x: 3, y: 0, z: 4 }, '3x + 4z = 25'), 'S')).toThrow(
      'The plane 3x + 4z = 25 touches "S" at one point — it does not cut through it'
    )
  })
})

describe('sections of a cylinder by any plane (Q4; radius 3, height 10, axis author Z)', () => {
  const CYLINDER = buildSolid({ kind: 'cylinder', radius: 3, height: 10 })

  it('cuts at 45 degrees through its centre in a whole ellipse, semi-axes 3 and 3 sqrt 2', () => {
    // Normal (1, 0, 1): the plane's reach along the axis is +-3 tan 45 = +-3,
    // inside the half-height 5, so nothing trims it.
    const r = region(sectionOf(CYLINDER, authorPlane3({ x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }), 'C'))
    expect(chordsOf(r)).toHaveLength(0)
    expect(arcsOf(r)).toHaveLength(1)
    const [arc] = arcsOf(r)
    if (arc.kind !== 'arc') return
    expect(Math.abs(arc.to - arc.from)).toBeCloseTo(2 * Math.PI, 12)
    const [minor, major] = semiAxes(arc.u, arc.v)
    expect(minor).toBeCloseTo(3, 12)
    expect(major).toBeCloseTo(3 * Math.SQRT2, 12)
  })

  it('cuts at 60 degrees from the axis through its centre in two arcs and two cap chords', () => {
    // Reach +-3 tan 60 = +-5.196 > 5: both caps trim. On the cap z = 5 the
    // plane sqrt(3)/2 x + z/2 = 0 is the line x = -5/sqrt 3, 5/sqrt 3 from the
    // axis, so each chord is 2 sqrt(9 - 25/3) = 2 sqrt(2/3) = 2 sqrt(6)/3.
    const r = region(sectionOf(CYLINDER, authorPlane3({ x: Math.sqrt(3) / 2, y: 0, z: 0.5 }, { x: 0, y: 0, z: 0 }), 'C'))
    expect(arcsOf(r)).toHaveLength(2)
    expect(chordsOf(r)).toHaveLength(2)
    for (const length of chordLengths(r)) expect(length).toBeCloseTo((2 * Math.sqrt(6)) / 3, 12)
    // The pieces chain end to end, closed.
    r.boundary.forEach((piece, i) => {
      const next = r.boundary[(i + 1) % r.boundary.length]
      expect(length3(sub3(pieceEnd(piece), pieceStart(next)))).toBeLessThan(1e-9)
    })
  })

  it('cuts the log wedge: 45 degrees through a diameter of the base, half an ellipse', () => {
    // x - z = 5 contains the base diameter along Y at z = -5. On the side the
    // height is -5 + 3 sin(theta) >= -5 for exactly half a turn.
    const r = region(sectionOf(CYLINDER, authorPlane3({ x: 1, y: 0, z: -1 }, { x: 0, y: 0, z: -5 }), 'C'))
    expect(arcsOf(r)).toHaveLength(1)
    const [arc] = arcsOf(r)
    if (arc.kind !== 'arc') return
    expect(Math.abs(arc.to - arc.from)).toBeCloseTo(Math.PI, 12)
    expect(chordLengths(r)).toHaveLength(1)
    expect(chordLengths(r)[0]).toBeCloseTo(6, 12)
  })

  it('cuts parallel to its axis at distance 2 in a rectangle 2 sqrt 5 by 10', () => {
    // An oblique vertical plane, x + y = 2 sqrt 2, 2 from the axis.
    const s = sectionOf(CYLINDER, authorPlane3({ x: 1, y: 1, z: 0 }, { x: Math.SQRT2, y: Math.SQRT2, z: 0 }), 'C')
    if (s.kind !== 'polygon') throw new Error('expected a polygon')
    expect(s.points).toHaveLength(4)
    const sides = s.points.map((p, i) => length3(sub3(s.points[(i + 1) % 4], p))).sort((a, b) => a - b)
    expect(sides[0]).toBeCloseTo(2 * Math.sqrt(5), 12)
    expect(sides[1]).toBeCloseTo(2 * Math.sqrt(5), 12)
    expect(sides[2]).toBeCloseTo(10, 12)
    expect(sides[3]).toBeCloseTo(10, 12)
  })
})

describe('sections of a cone by any plane (Q4; radius 3, height 4: base z = -2, apex z = 2)', () => {
  const CONE = buildSolid({ kind: 'cone', radius: 3, height: 4 })

  it('cuts in an ellipse when the plane is less steep than the generators', () => {
    // z = -1 + x/4. In the meridian y = 0 the generators z = 2 -+ 4x/3 meet it
    // at (36/19, 0, -10/19) and (-36/13, 0, -22/13), both above the base: the
    // major axis, 2a = 288 sqrt 17 / 247. At the centre (-108/247, 0,
    // -274/247) the cone's radius is 576/247, 108/247 from the axis, so
    // b = sqrt(576^2 - 108^2)/247 = 36/sqrt 247.
    const r = region(sectionOf(CONE, authorPlane3({ x: -1, y: 0, z: 4 }, { x: 0, y: 0, z: -1 }), 'K'))
    expect(chordsOf(r)).toHaveLength(0)
    const [arc] = arcsOf(r)
    if (arc.kind !== 'arc') return
    const [minor, major] = semiAxes(arc.u, arc.v)
    expect(major).toBeCloseTo((144 * Math.sqrt(17)) / 247, 12)
    expect(minor).toBeCloseTo(36 / Math.sqrt(247), 12)
    const centre = worldToAuthor(arc.center)
    expect(centre.x).toBeCloseTo(-108 / 247, 12)
    expect(centre.y).toBeCloseTo(0, 12)
    expect(centre.z).toBeCloseTo(-274 / 247, 12)
    // An independent parametric solve: where the plane meets the generators
    // at other angles, the point is on the drawn ellipse. u and v are its
    // principal semi-axes (perpendicular), so ((p - c).u/|u|^2)^2 +
    // ((p - c).v/|v|^2)^2 = 1.
    expect(Math.abs(arc.u.x * arc.v.x + arc.u.y * arc.v.y + arc.u.z * arc.v.z)).toBeLessThan(1e-9)
    for (const theta of [0.3, 1.1, 2.5, 4.0]) {
      // The generator from the apex (0, 0, 2) toward the rim at theta:
      // (0, 0, 2) + t (3 cos, 3 sin, -4). On z = -1 + x/4:
      // 2 - 4t = -1 + 3t cos(theta)/4, so t = 3 / (4 + 3 cos(theta)/4).
      const t = 3 / (4 + (3 * Math.cos(theta)) / 4)
      const p = authorToWorld({ x: 3 * t * Math.cos(theta), y: 3 * t * Math.sin(theta), z: 2 - 4 * t })
      const d = sub3(p, arc.center)
      const along = (w: Vec3) => (d.x * w.x + d.y * w.y + d.z * w.z) / (w.x * w.x + w.y * w.y + w.z * w.z)
      expect(along(arc.u) ** 2 + along(arc.v) ** 2).toBeCloseTo(1, 10)
    }
  })

  it('refuses a plane parallel to a generator as a parabola', () => {
    // 4x + 3z = 0 contains the direction (3, 0, -4) of a generator, and cuts
    // the cone (the apex is on one side, the base centre on the other).
    expect(() => sectionOf(CONE, authorPlane3({ x: 4, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, '4x + 3z = 0'), 'K')).toThrow(
      'The plane 4x + 3z = 0 cuts "K" in a parabola, which is not drawn — only circles and ellipses are'
    )
  })

  it('refuses a plane steeper than the generators, off the apex, as a hyperbola', () => {
    expect(() => sectionOf(CONE, authorPlane3({ x: 1, y: 0, z: 0.1 }, { x: 1, y: 0, z: 0 }, 'x + 0.1z = 1'), 'K')).toThrow(
      'The plane x + 0.1z = 1 cuts "K" in a hyperbola, which is not drawn — only circles and ellipses are'
    )
    // The axis-parallel plane on a cone at the origin keeps phase 5's wording.
    expect(() => sectionOf(CONE, { kind: 'axis', axis: 'z', at: 1 }, 'K')).toThrow(/HYPERBOLA/)
  })

  it('cuts a plane through the apex that crosses the base in the triangle apex-chord', () => {
    // x + 0.2 z = 0.4 passes through the apex (0, 0, 2); at the base z = -2 it
    // is x = 0.8, a chord from (0.8, -sqrt 8.36, -2) to (0.8, sqrt 8.36, -2).
    const s = sectionOf(CONE, authorPlane3({ x: 1, y: 0, z: 0.2 }, { x: 0, y: 0, z: 2 }), 'K')
    if (s.kind !== 'polygon') throw new Error(`expected a polygon, got a ${s.kind}`)
    const key = (p: Vec3) => [p.x, p.y, p.z].map((c) => Math.round(c * 1e9) / 1e9 + 0).join(',')
    const half = Math.round(Math.sqrt(8.36) * 1e9) / 1e9
    expect(s.points.map((p) => key(worldToAuthor(p))).sort()).toEqual(['0,0,2', `0.8,${half},-2`, `0.8,-${half},-2`].sort())
  })

  it('refuses a plane through the apex only, and one along a single generator, specifically', () => {
    expect(() => sectionOf(CONE, authorPlane3({ x: 0.1, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }, 'A'), 'K')).toThrow(
      'The plane A meets "K" only at its apex — it does not cut through it'
    )
    expect(() => sectionOf(CONE, authorPlane3({ x: 4, y: 0, z: 3 }, { x: 0, y: 0, z: 2 }, 'B'), 'K')).toThrow(
      'The plane B meets "K" only along one generator — it does not cut through it'
    )
  })
})

describe('sections of a frustum by any plane (Q4; radius 6, top 3, height 4)', () => {
  it('cuts in two arcs and two cap chords when the plane reaches both caps', () => {
    // x = z: on the top z = 2 it is x = 2 across a rim of radius 3, a chord
    // 2 sqrt 5; on the base z = -2 it is x = -2 across a rim of radius 6, a
    // chord 2 sqrt 32 = 8 sqrt 2. (The extended cone's apex is 8 above the
    // base, so its generators rise at 4/3, steeper than the plane's 1: an
    // ellipse.)
    const frustum = buildSolid({ kind: 'frustum', radius: 6, top: 3, height: 4 })
    const r = region(sectionOf(frustum, authorPlane3({ x: 1, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }), 'F'))
    expect(arcsOf(r)).toHaveLength(2)
    expect(chordsOf(r)).toHaveLength(2)
    const [short, long] = chordLengths(r)
    expect(short).toBeCloseTo(2 * Math.sqrt(5), 12)
    expect(long).toBeCloseTo(8 * Math.SQRT2, 12)
  })
})

describe('a tilted round solid, cut in its own frame (Q4)', () => {
  it('cuts a cylinder along author X by plane x = 0 in a circle of its radius (the old P7 refusal)', () => {
    const tilted = buildSolid({ kind: 'cylinder', radius: 2, height: 6 }, placementAlong({ x: 0, y: 0, z: 0 }, authorToWorld({ x: 1, y: 0, z: 0 })))
    // Author x = 0 is internal z = 0.
    const s = sectionOf(tilted, { kind: 'axis', axis: 'z', at: 0 }, 'C')
    if (s.kind !== 'circle') throw new Error(`expected a circle, got a ${s.kind}`)
    expect(s.radius).toBeCloseTo(2, 12)
    expect(length3(s.center)).toBeCloseTo(0, 12)
  })
})

describe('the lifted true shape of a region (Q5)', () => {
  it('keeps the log wedge a half ellipse at true size in its plane: semi-axes 3 and 3 sqrt 2, chord 6', () => {
    const CYLINDER = buildSolid({ kind: 'cylinder', radius: 3, height: 10 })
    const plane = authorPlane3({ x: 1, y: 0, z: -1 }, { x: 0, y: 0, z: -5 })
    const shape = trueShape(sectionOf(CYLINDER, plane, 'C'), plane)
    if (shape.kind !== 'region') throw new Error('expected a region')
    const arc = shape.boundary.find((p) => p.kind === 'arc')
    const chord = shape.boundary.find((p) => p.kind === 'segment')
    if (!arc || arc.kind !== 'arc' || !chord || chord.kind !== 'segment') throw new Error('expected an arc and a chord')
    const [minor, major] = semiAxes({ ...arc.u, z: 0 }, { ...arc.v, z: 0 })
    expect(minor).toBeCloseTo(3, 12)
    expect(major).toBeCloseTo(3 * Math.SQRT2, 12)
    expect(Math.hypot(chord.b.x - chord.a.x, chord.b.y - chord.a.y)).toBeCloseTo(6, 12)
  })
})
