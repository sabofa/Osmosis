import { describe, expect, it } from 'vitest'
import { centroid, circumcenter, circumcircle, incenter, incircle, incircleTangentPoints, orthocenter } from './centres'
import { distanceToLine, isPointOnLine, segment } from './objects'

// A fully general scalene triangle — no side axis-aligned, no two sides
// equal. An equilateral triangle would hide every centre error there is,
// because all four centres coincide at the middle of it.
//
//   A = (1,1)  B = (9,3)  C = (4,8)
//
// Hand-worked: shoelace area = |(8,2) x (3,7)| / 2 = |56 - 6| / 2 = 25.
// Sides: a = |BC| = 5*sqrt(2), b = |CA| = sqrt(58), c = |AB| = sqrt(68).
const A = { x: 1, y: 1 }
const B = { x: 9, y: 3 }
const C = { x: 4, y: 8 }
const AREA = 25
const SIDE_A = 5 * Math.SQRT2
const SIDE_B = Math.sqrt(58)
const SIDE_C = Math.sqrt(68)
const S = (SIDE_A + SIDE_B + SIDE_C) / 2

// A scalene right triangle, where every centre has an exact textbook value.
const RA = { x: 0, y: 0 }
const RB = { x: 4, y: 0 }
const RC = { x: 0, y: 3 }

describe('centroid', () => {
  it('averages the three vertices', () => {
    const g = centroid(A, B, C)
    expect(g.x).toBeCloseTo(14 / 3, 12)
    expect(g.y).toBeCloseTo(4, 12)
  })
})

describe('circumcenter', () => {
  it('matches the hand-solved perpendicular-bisector intersection', () => {
    // 2(B-A).P = |B|^2 - |A|^2  ->  4x +  y = 22
    // 2(C-A).P = |C|^2 - |A|^2  ->  3x + 7y = 39   ->  (4.6, 3.6)
    const o = circumcenter(A, B, C)
    expect(o.x).toBeCloseTo(4.6, 12)
    expect(o.y).toBeCloseTo(3.6, 12)
  })

  it('sits at the hypotenuse midpoint of a right triangle', () => {
    const o = circumcenter(RA, RB, RC)
    expect(o.x).toBeCloseTo(2, 12)
    expect(o.y).toBeCloseTo(1.5, 12)
  })

  it('is rejected for three collinear points', () => {
    expect(() => circumcenter({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 5 })).toThrow(/collinear/i)
  })
})

describe('orthocenter', () => {
  it('matches the hand-solved altitude intersection', () => {
    // BC has direction (-5,5), so the altitude from A=(1,1) is y = x;
    // the altitude from B=(9,3) is perpendicular to CA=(3,7). They meet at (4.8, 4.8).
    const h = orthocenter(A, B, C)
    expect(h.x).toBeCloseTo(4.8, 12)
    expect(h.y).toBeCloseTo(4.8, 12)
  })

  it('lands on the right-angle vertex of a right triangle', () => {
    const h = orthocenter(RA, RB, RC)
    expect(h.x).toBeCloseTo(0, 12)
    expect(h.y).toBeCloseTo(0, 12)
  })

  it('is rejected for three collinear points', () => {
    expect(() => orthocenter({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 5 })).toThrow(/collinear/i)
  })
})

describe('the Euler line', () => {
  it('puts centroid, circumcentre and orthocentre collinear, with the centroid 2:1 from the orthocentre', () => {
    const g = centroid(A, B, C)
    const o = circumcenter(A, B, C)
    const h = orthocenter(A, B, C)

    // Collinear: the cross product of (G-H) and (O-H) vanishes.
    const cross = (g.x - h.x) * (o.y - h.y) - (g.y - h.y) * (o.x - h.x)
    expect(cross).toBeCloseTo(0, 10)

    // ...and G is two thirds of the way from H to O.
    expect(g.x).toBeCloseTo(h.x + (2 / 3) * (o.x - h.x), 12)
    expect(g.y).toBeCloseTo(h.y + (2 / 3) * (o.y - h.y), 12)

    // The three are genuinely distinct here, so the collinearity above is a
    // real constraint rather than three copies of one point.
    expect(Math.hypot(g.x - o.x, g.y - o.y)).toBeGreaterThan(0.1)
    expect(Math.hypot(g.x - h.x, g.y - h.y)).toBeGreaterThan(0.1)
  })
})

describe('circumcircle', () => {
  it('carries the radius R = abc/(4*Area) and passes through all three vertices', () => {
    const circumscribed = circumcircle(A, B, C)
    expect(circumscribed.radius).toBeCloseTo((SIDE_A * SIDE_B * SIDE_C) / (4 * AREA), 10)
    for (const v of [A, B, C]) {
      expect(Math.hypot(v.x - circumscribed.center.x, v.y - circumscribed.center.y)).toBeCloseTo(circumscribed.radius, 10)
    }
  })

  it('has radius 2.5 on a 3-4-5 right triangle', () => {
    expect(circumcircle(RA, RB, RC).radius).toBeCloseTo(2.5, 12)
  })
})

describe('incenter and incircle', () => {
  it('sits at (1,1) with radius 1 on a 3-4-5 right triangle', () => {
    const i = incenter(RA, RB, RC)
    expect(i.x).toBeCloseTo(1, 12)
    expect(i.y).toBeCloseTo(1, 12)
    expect(incircle(RA, RB, RC).radius).toBeCloseTo(1, 12)
  })

  it('carries the radius r = Area/s', () => {
    expect(incircle(A, B, C).radius).toBeCloseTo(AREA / S, 10)
  })

  it('is equidistant from all three sides, at exactly that radius', () => {
    const inscribed = incircle(A, B, C)
    const sides = [segment(B, C), segment(C, A), segment(A, B)]
    for (const side of sides) {
      expect(distanceToLine(inscribed.center, side)).toBeCloseTo(inscribed.radius, 10)
    }
  })

  it('touches each side at the foot of the perpendicular, the tangent-length s-a from each vertex', () => {
    const inscribed = incircle(A, B, C)
    const [onBC, onCA, onAB] = incircleTangentPoints(A, B, C)

    // Each tangent point is on its own side (not merely on that side's line)
    // and exactly one radius from the centre.
    for (const [t, side] of [
      [onBC, segment(B, C)],
      [onCA, segment(C, A)],
      [onAB, segment(A, B)],
    ] as const) {
      expect(isPointOnLine(t, side)).toBe(true)
      expect(Math.hypot(t.x - inscribed.center.x, t.y - inscribed.center.y)).toBeCloseTo(inscribed.radius, 10)
    }

    // The classic tangent-length identity: from A to either of its two
    // tangent points is s - a. This pins the positions along the sides,
    // which "distance to the centre is r" on its own does not.
    expect(Math.hypot(onAB.x - A.x, onAB.y - A.y)).toBeCloseTo(S - SIDE_A, 10)
    expect(Math.hypot(onCA.x - A.x, onCA.y - A.y)).toBeCloseTo(S - SIDE_A, 10)
    expect(Math.hypot(onAB.x - B.x, onAB.y - B.y)).toBeCloseTo(S - SIDE_B, 10)
    expect(Math.hypot(onBC.x - C.x, onBC.y - C.y)).toBeCloseTo(S - SIDE_C, 10)
  })

  it('is rejected for three collinear points', () => {
    expect(() => incircle({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 5 })).toThrow(/collinear/i)
    expect(() => incenter({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 5 })).toThrow(/collinear/i)
  })
})

describe('centroid on a degenerate triangle', () => {
  it('is rejected too, so every centre agrees on what a triangle is', () => {
    expect(() => centroid({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 5 })).toThrow(/collinear/i)
  })
})
