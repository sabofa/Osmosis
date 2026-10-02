import { describe, expect, it } from 'vitest'
import {
  add3,
  angle3,
  centroid3,
  commonPerpendicular3,
  cross3,
  dihedral3,
  distance3,
  divide3,
  dot3,
  footToLine3,
  footToPlane,
  length3,
  lineAngle3,
  lineLineDistance,
  lineMeetsPlane,
  linePlaneAngle3,
  midpoint3,
  planeThrough,
  pointLineDistance,
  pointPlaneDistance,
  scale3,
  sub3,
} from './construct3d'
import type { Vec3 } from './project3d'

// Construction maths for solid figures, each against a hand-computed value.
// Frame-agnostic: every function here commutes with a rotation, so these
// tests hold in the author frame and the internal frame alike.

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

function expectClose(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

describe('the Vec3 toolkit', () => {
  it('adds, subtracts, scales, dots and crosses', () => {
    expect(add3(v(1, 2, 3), v(4, 5, 6))).toEqual(v(5, 7, 9))
    expect(sub3(v(4, 5, 6), v(1, 2, 3))).toEqual(v(3, 3, 3))
    expect(scale3(v(1, -2, 3), 2)).toEqual(v(2, -4, 6))
    expect(dot3(v(1, 2, 3), v(4, 5, 6))).toBe(32)
    // x cross y is z: the right-hand rule, which is what makes a normal point
    // the way a face's winding says it does.
    expect(cross3(v(1, 0, 0), v(0, 1, 0))).toEqual(v(0, 0, 1))
    expect(length3(v(2, 3, 6))).toBe(7)
  })

  it("measures the unit cube's space diagonal as sqrt(3)", () => {
    expect(distance3(v(0, 0, 0), v(1, 1, 1))).toBeCloseTo(Math.sqrt(3), 14)
  })
})

describe('derived points', () => {
  it('finds the midpoint of (0,0,0)-(2,4,6) at (1,2,3)', () => {
    expect(midpoint3(v(0, 0, 0), v(2, 4, 6))).toEqual(v(1, 2, 3))
  })

  it('divides at 1:3 a quarter of the way from the first point', () => {
    expect(divide3(v(0, 0, 0), v(2, 4, 6), 1, 3)).toEqual(v(0.5, 1, 1.5))
    // m:n is FROM the first point, as the 2D divide is.
    expect(divide3(v(2, 4, 6), v(0, 0, 0), 1, 3)).toEqual(v(1.5, 3, 4.5))
  })

  it('refuses a ratio that names no point', () => {
    expect(() => divide3(v(0, 0, 0), v(1, 1, 1), 1, -1)).toThrow(/ratio/)
  })

  it("puts a regular tetrahedron's centroid at its centre", () => {
    // The regular tetrahedron on alternate corners of a cube centred on
    // (2, 3, 5), so the answer is not the origin by accident.
    const c = v(2, 3, 5)
    const corners = [v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)].map((p) => add3(p, c))
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expect(distance3(corners[i], corners[j])).toBeCloseTo(2 * Math.SQRT2, 12)
    }
    expectClose(centroid3(corners), c)
  })

  it('takes the centroid of a triangle in space too', () => {
    expectClose(centroid3([v(3, 0, 0), v(0, 3, 0), v(0, 0, 3)]), v(1, 1, 1))
  })
})

describe('planes', () => {
  it('builds a plane through three points with a unit normal', () => {
    const plane = planeThrough(v(1, 0, 0), v(0, 1, 0), v(0, 0, 1))
    expect(length3(plane.normal)).toBeCloseTo(1, 14)
    const k = 1 / Math.sqrt(3)
    expectClose(plane.normal, v(k, k, k))
  })

  it('refuses three collinear points, saying they are collinear', () => {
    expect(() => planeThrough(v(0, 0, 0), v(1, 1, 1), v(2, 2, 2))).toThrow(/collinear/)
  })

  it('drops the foot from (1,1,1) to the plane z = 0 at (1,1,0)', () => {
    const plane = planeThrough(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0))
    expectClose(footToPlane(v(1, 1, 1), plane), v(1, 1, 0))
  })

  it('drops the foot from the origin to x + y + z = 3 at (1,1,1)', () => {
    const plane = planeThrough(v(3, 0, 0), v(0, 3, 0), v(0, 0, 3))
    expectClose(footToPlane(v(0, 0, 0), plane), v(1, 1, 1))
  })

  it('meets the line (0,0,-1)-(0,0,1) with the plane z = 0.5 at (0,0,0.5)', () => {
    const plane = planeThrough(v(0, 0, 0.5), v(1, 0, 0.5), v(0, 1, 0.5))
    expectClose(lineMeetsPlane(v(0, 0, -1), v(0, 0, 1), plane), v(0, 0, 0.5))
  })

  it('meets the line beyond its two points, since the line is infinite', () => {
    const plane = planeThrough(v(0, 0, 5), v(1, 0, 5), v(0, 1, 5))
    expectClose(lineMeetsPlane(v(1, 1, 0), v(1, 1, 1), plane), v(1, 1, 5))
  })

  it('refuses a line parallel to the plane', () => {
    const plane = planeThrough(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0))
    expect(() => lineMeetsPlane(v(0, 0, 1), v(1, 2, 1), plane)).toThrow(/parallel/)
  })

  it('measures an unsigned point-plane distance', () => {
    const plane = planeThrough(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0))
    expect(pointPlaneDistance(v(4, -2, 3), plane)).toBeCloseTo(3, 14)
    expect(pointPlaneDistance(v(4, -2, -3), plane)).toBeCloseTo(3, 14)
  })
})

describe('lines', () => {
  it('drops the foot to an infinite line, past its defining points', () => {
    expectClose(footToLine3(v(5, 2, 0), v(0, 0, 0), v(1, 0, 0)), v(5, 0, 0))
  })

  it('refuses a line whose two points coincide', () => {
    expect(() => footToLine3(v(1, 1, 1), v(2, 2, 2), v(2, 2, 2))).toThrow(/coincide/)
    expect(() => lineMeetsPlane(v(2, 2, 2), v(2, 2, 2), planeThrough(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)))).toThrow(/coincide/)
  })

  it('measures a point-line distance', () => {
    expect(pointLineDistance(v(0, 3, 4), v(0, 0, 0), v(1, 0, 0))).toBeCloseTo(5, 14)
  })

  it('measures the x-axis and the line through (0,1,0) along z as 1 apart', () => {
    expect(lineLineDistance(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(0, 1, 1))).toBeCloseTo(1, 14)
  })

  it('measures two parallel lines 2 apart as 2 apart', () => {
    // Exactly parallel: the cross product of the directions is exactly zero,
    // so the skew formula is 0/0. The parallel branch is what answers.
    const d = lineLineDistance(v(0, 0, 0), v(1, 1, 0), v(0, 0, 2), v(3, 3, 2))
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeCloseTo(2, 14)
  })
})

describe('angles', () => {
  it("measures 60 degrees between two face diagonals at a cube's vertex", () => {
    expect(angle3(v(0, 0, 0), v(1, 1, 0), v(0, 1, 1))).toBeCloseTo(Math.PI / 3, 14)
  })

  it('measures a right angle and a straight angle', () => {
    expect(angle3(v(1, 1, 1), v(2, 1, 1), v(1, 1, 5))).toBeCloseTo(Math.PI / 2, 14)
    expect(angle3(v(0, 0, 0), v(1, 2, 3), v(-2, -4, -6))).toBeCloseTo(Math.PI, 14)
  })

  it('stays precise near zero, where acos would not', () => {
    // 1e-9 radians apart. acos of the normalised dot returns 0 here (the dot
    // rounds to 1); the atan2 form keeps the angle.
    const tiny = angle3(v(0, 0, 0), v(1, 0, 0), v(1, 1e-9, 0))
    expect(tiny).toBeGreaterThan(0.9e-9)
    expect(tiny).toBeLessThan(1.1e-9)
  })

  it('refuses an arm of zero length', () => {
    expect(() => angle3(v(1, 2, 3), v(1, 2, 3), v(0, 0, 0))).toThrow(/coincide/)
  })
})

describe('measures between lines and planes (phase 10, M5)', () => {
  it('takes the acute angle between two lines, skew or not, either way round', () => {
    // (1,1,0) against (0,1,1): 60 degrees; reversing one line does not make it 120.
    expect(lineAngle3(v(0, 0, 0), v(1, 1, 0), v(1, 0, 0), v(1, 1, 1))).toBeCloseTo(Math.PI / 3, 14)
    expect(lineAngle3(v(1, 1, 0), v(0, 0, 0), v(1, 0, 0), v(1, 1, 1))).toBeCloseTo(Math.PI / 3, 14)
    expect(() => lineAngle3(v(1, 1, 1), v(1, 1, 1), v(0, 0, 0), v(1, 0, 0), 'line A-B')).toThrow(/line A-B coincide/)
  })

  it('takes a line–plane angle in [0, 90]: 0 along the plane, 90 along its normal', () => {
    const base = planeThrough(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0))
    expect(linePlaneAngle3(v(0, 0, 0), v(1, 1, 1), base)).toBeCloseTo(Math.asin(1 / Math.sqrt(3)), 14)
    expect(linePlaneAngle3(v(0, 0, 5), v(3, 1, 5), base)).toBe(0)
    expect(linePlaneAngle3(v(2, 3, 0), v(2, 3, -4), base)).toBeCloseTo(Math.PI / 2, 14)
  })
})

describe('the dihedral angle (phase 10, M3)', () => {
  const names = { from: 'C', a: 'A', b: 'B', to: 'D' }

  it('uses the components square to the edge, not the raw offsets', () => {
    // Edge A-B along x; C in the xy-plane, D in the xz-plane: 90 degrees.
    // The raw offsets from the midpoint (2,1,0) and (-2,0,1) meet at
    // arccos(-4/5), which is what dropping the perpendicular step gives.
    const d = dihedral3(v(3, 1, 0), v(0, 0, 0), v(2, 0, 0), v(-1, 0, 1), names)
    expect(d.angle).toBeCloseTo(Math.PI / 2, 14)
    expect(d.mid).toEqual(v(1, 0, 0))
    expectClose(d.u, v(0, 1, 0))
    expectClose(d.v, v(0, 0, 1))
  })

  it('reads 180 for two half-planes that make one plane, and 0 for one half-plane', () => {
    expect(dihedral3(v(0, 1, 0), v(0, 0, 0), v(1, 0, 0), v(0, -1, 0), names).angle).toBeCloseTo(Math.PI, 14)
    expect(dihedral3(v(0, 1, 0), v(0, 0, 0), v(1, 0, 0), v(5, 3, 0), names).angle).toBe(0)
  })

  it('refuses an edge of one point and an end on the edge line, by name', () => {
    expect(() => dihedral3(v(0, 1, 0), v(1, 1, 1), v(1, 1, 1), v(0, 0, 1), names)).toThrow('A and B are the same point')
    expect(() => dihedral3(v(3, 0, 0), v(0, 0, 0), v(1, 0, 0), v(0, 0, 1), names)).toThrow('C lies on the line A-B')
  })
})

describe('the common perpendicular (phase 10, M6)', () => {
  it('finds the feet of two skew lines, closed form', () => {
    // The x-axis and the line through (0,1,2) along (0,1,1): minimising
    // |(s, -1 - t, -2 - t)| gives s = 0, t = -3/2, so the feet are the
    // origin and (0, -1/2, 1/2).
    const found = commonPerpendicular3(v(0, 0, 0), v(1, 0, 0), v(0, 1, 2), v(0, 2, 3))
    if (found.kind !== 'feet') throw new Error(`expected feet, got ${found.kind}`)
    expectClose(found.p, v(0, 0, 0))
    expectClose(found.q, v(0, -0.5, 0.5))
    const pq = sub3(found.q, found.p)
    expect(dot3(pq, v(1, 0, 0))).toBeCloseTo(0, 14)
    expect(dot3(pq, v(0, 1, 1))).toBeCloseTo(0, 14)
  })

  it('reports parallel lines and lines that meet, without throwing', () => {
    expect(commonPerpendicular3(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(3, 1, 0)).kind).toBe('parallel')
    const meet = commonPerpendicular3(v(0, 0, 0), v(2, 0, 0), v(1, -1, 0), v(1, 1, 0))
    expect(meet).toEqual({ kind: 'meet', at: v(1, 0, 0) })
  })
})
