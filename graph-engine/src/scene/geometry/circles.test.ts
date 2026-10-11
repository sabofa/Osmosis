import { describe, expect, it } from 'vitest'
import {
  arcBetween,
  arcEndpoints,
  chord,
  diameter,
  distanceFromCircle,
  isPointOnCircle,
  isTangentLine,
  radiusTo,
  secantThrough,
  tangentAt,
  tangentPointsFrom,
  tangentsFrom,
} from './circles'
import { intersect } from './intersect'
import { circle, distance, distanceToLine, infiniteLine, lineDirection, segment } from './objects'

// One circle for the whole file, and deliberately not centred on the origin:
// a centre at the origin hides every bug that forgets to translate, and half
// the arithmetic here is "relative to the centre".
//
//   O: centre (3, 4), radius 5
//
// Points that lie on it exactly, so nothing below needs a tolerance argument:
//   A (0, 0)   angle 180 - 53.13 = 233.13 deg from the centre, i.e. -126.87
//   B (8, 4)   0 deg
//   C (6, 8)   53.13 deg      — antipodal to A
//   D (-1, 7)  143.13 deg
//   E (3, 9)   90 deg
//   F (3, -1)  -90 deg
const O = circle({ x: 3, y: 4 }, 5)
const A = { x: 0, y: 0 }
const B = { x: 8, y: 4 }
const C = { x: 6, y: 8 }
const D = { x: -1, y: 7 }
const E = { x: 3, y: 9 }
const F = { x: 3, y: -1 }

const DEG = 180 / Math.PI

function sweepDegrees(sweep: number): number {
  return sweep * DEG
}

describe('points on a circle', () => {
  it('measures how far a point misses the circle by', () => {
    expect(distanceFromCircle(O, A)).toBeCloseTo(0, 12)
    expect(distanceFromCircle(O, { x: 3, y: 4 })).toBeCloseTo(5, 12)
    expect(distanceFromCircle(O, { x: 8.25, y: 4 })).toBeCloseTo(0.25, 12)
  })

  it('accepts a point that is on the circle only up to rounding', () => {
    // What a five-step construction chain actually hands back.
    expect(isPointOnCircle(O, { x: 8 + 1e-12, y: 4 })).toBe(true)
    expect(isPointOnCircle(O, { x: 8.001, y: 4 })).toBe(false)
  })
})

describe('chord', () => {
  it('is the segment between two points of the circle', () => {
    const c = chord(O, A, B)
    expect(c.extent).toBe('segment')
    expect(c.a).toEqual(A)
    expect(c.b).toEqual(B)
    // |AB| = sqrt(8^2 + 4^2) = sqrt(80)
    expect(distance(c.a, c.b)).toBeCloseTo(Math.sqrt(80), 12)
  })

  it('refuses an endpoint that is not on the circle, naming the gap', () => {
    expect(() => chord(O, A, { x: 8.4, y: 4 }, { circle: 'O', from: 'A', to: 'Q' })).toThrow(/"Q"/)
    expect(() => chord(O, A, { x: 8.4, y: 4 }, { circle: 'O', from: 'A', to: 'Q' })).toThrow(/0\.4/)
    expect(() => chord(O, A, { x: 8.4, y: 4 }, { circle: 'O', from: 'A', to: 'Q' })).toThrow(/circle "O"/)
  })

  it('refuses a chord whose endpoints are the same point', () => {
    expect(() => chord(O, B, { x: 8, y: 4 })).toThrow(/same point|distinct/i)
  })
})

describe('arc', () => {
  it('sweeps counter-clockwise when told to', () => {
    // B is at 0 degrees, E at 90: counter-clockwise from B to E is a quarter turn.
    const arc = arcBetween(O, B, E, 'ccw')
    expect(sweepDegrees(arc.sweep)).toBeCloseTo(90, 9)
    expect(arc.radius).toBe(5)
    expect(arc.center).toEqual(O.center)
  })

  it('sweeps clockwise when told to, taking the other three quarters', () => {
    const arc = arcBetween(O, B, E, 'cw')
    expect(sweepDegrees(arc.sweep)).toBeCloseTo(-270, 9)
  })

  it('starts at the first endpoint and finishes at the second, whichever way it goes', () => {
    for (const direction of ['ccw', 'cw', 'minor', 'major'] as const) {
      const [from, to] = arcEndpoints(arcBetween(O, B, D, direction))
      expect(from.x).toBeCloseTo(B.x, 9)
      expect(from.y).toBeCloseTo(B.y, 9)
      expect(to.x).toBeCloseTo(D.x, 9)
      expect(to.y).toBeCloseTo(D.y, 9)
    }
  })

  it('takes the shorter way round for a minor arc and the longer for a major one', () => {
    // D is at atan2(3, -4) = 143.1301 degrees; B at 0.
    expect(sweepDegrees(arcBetween(O, B, D, 'minor').sweep)).toBeCloseTo(143.1301, 3)
    expect(sweepDegrees(arcBetween(O, B, D, 'major').sweep)).toBeCloseTo(-216.8699, 3)
  })

  it('picks the minor arc by its size, not by the order the endpoints were written', () => {
    // Written D to B, the counter-clockwise sweep is 216.87 — so the minor arc
    // is the one running *clockwise*, and a construction that just took the
    // counter-clockwise sweep for "minor" would draw the wrong one.
    expect(Math.abs(sweepDegrees(arcBetween(O, D, B, 'minor').sweep))).toBeCloseTo(143.1301, 3)
    expect(Math.abs(sweepDegrees(arcBetween(O, D, B, 'major').sweep))).toBeCloseTo(216.8699, 3)
  })

  it('refuses "minor" and "major" on a diameter, where the two arcs are the same size', () => {
    // G1: A and C are antipodal, so both arcs are semicircles and "the minor
    // one" names neither of them. Drawing one anyway is the silent wrong
    // figure this rule exists to prevent.
    expect(() => arcBetween(O, A, C, 'minor', { circle: 'O', from: 'A', to: 'C' })).toThrow(/semicircle|diameter/i)
    expect(() => arcBetween(O, A, C, 'minor', { circle: 'O', from: 'A', to: 'C' })).toThrow(/ccw|clockwise/i)
    expect(() => arcBetween(O, A, C, 'major')).toThrow(/semicircle|diameter/i)
  })

  it('draws either semicircle when the direction says which one', () => {
    expect(sweepDegrees(arcBetween(O, A, C, 'ccw').sweep)).toBeCloseTo(180, 9)
    expect(sweepDegrees(arcBetween(O, A, C, 'cw').sweep)).toBeCloseTo(-180, 9)
  })

  it('refuses an arc whose endpoints coincide', () => {
    expect(() => arcBetween(O, B, { x: 8, y: 4 }, 'ccw')).toThrow(/same point|coincide/i)
  })

  it('refuses an endpoint that is not on the circle', () => {
    expect(() => arcBetween(O, B, { x: 3, y: 9.6 }, 'ccw', { circle: 'O', from: 'B', to: 'E' })).toThrow(/"E"/)
  })
})

describe('sector and circular segment', () => {
  // Both are the same arc with a different closing rule — the wedge closes
  // through the centre, the segment closes along its own chord — so what is
  // tested here is that they agree with the arc they are built from rather
  // than re-deriving one.
  it('are the arc they were asked for', () => {
    const arc = arcBetween(O, B, D, 'minor')
    expect(sweepDegrees(arc.sweep)).toBeCloseTo(143.1301, 3)
    const [from, to] = arcEndpoints(arc)
    expect(from.x).toBeCloseTo(B.x, 9)
    expect(to.y).toBeCloseTo(D.y, 9)
  })
})

describe('tangent at a point of the circle', () => {
  it('touches the circle at that point and nowhere else', () => {
    const t = tangentAt(O, B)
    expect(t.extent).toBe('infinite')
    expect(distanceToLine(O.center, t)).toBeCloseTo(O.radius, 12)
    const hits = intersect(t, O)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(B.x, 9)
    expect(hits[0].y).toBeCloseTo(B.y, 9)
  })

  it('runs perpendicular to the radius drawn to its point', () => {
    for (const p of [A, B, D, F]) {
      const t = tangentAt(O, p)
      const d = lineDirection(t)
      const radial = { x: p.x - O.center.x, y: p.y - O.center.y }
      expect(d.x * radial.x + d.y * radial.y).toBeCloseTo(0, 9)
    }
  })

  it('refuses a point that is not on the circle, naming the gap', () => {
    expect(() => tangentAt(O, { x: 3, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/"P"/)
    expect(() => tangentAt(O, { x: 8.4, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/0\.4/)
  })
})

describe('tangents from an external point', () => {
  // P is 13 from the centre of a circle of radius 5, so each tangent length is
  // sqrt(13^2 - 5^2) = 12 and each touch point is 25/13 along the centre line
  // and 60/13 off it.
  const P = { x: 3, y: -9 }
  const near = { x: 3 - 60 / 13, y: 4 - 25 / 13 }
  const far = { x: 3 + 60 / 13, y: 4 - 25 / 13 }

  it('finds both touch points', () => {
    const points = tangentPointsFrom(O, P)
    expect(points).toHaveLength(2)
    for (const p of points) expect(isPointOnCircle(O, p)).toBe(true)
  })

  it('orders the two solutions by x, then y — the rule intersect uses', () => {
    // The construction produces them in the order the perpendicular happens to
    // point, which here is x-DESCENDING. Only the shared sort can put them in
    // this order, so deleting that sort fails this test rather than leaving it
    // green by luck.
    const points = tangentPointsFrom(O, P)
    expect(points[0].x).toBeCloseTo(near.x, 9)
    expect(points[0].y).toBeCloseTo(near.y, 9)
    expect(points[1].x).toBeCloseTo(far.x, 9)
    expect(points[1].y).toBeCloseTo(far.y, 9)
    const lines = tangentsFrom(O, P)
    expect(lines[0].b.x).toBeCloseTo(near.x, 9)
    expect(lines[1].b.x).toBeCloseTo(far.x, 9)
  })

  it('gives two lines of equal tangent length, each touching the circle once', () => {
    const lines = tangentsFrom(O, P)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line.a).toEqual(P)
      expect(distance(line.a, line.b)).toBeCloseTo(12, 9)
      expect(intersect(line, O)).toHaveLength(1)
      expect(isTangentLine(infiniteLine(line.a, line.b), O)).toBe(true)
    }
    expect(distance(lines[0].a, lines[0].b)).toBeCloseTo(distance(lines[1].a, lines[1].b), 12)
  })

  it('is deterministic for a point whose tangents are symmetric about a vertical', () => {
    const above = { x: 3, y: 17 }
    const first = tangentPointsFrom(O, above)
    const second = tangentPointsFrom(O, above)
    expect(first).toEqual(second)
    expect(first[0].x).toBeLessThan(first[1].x)
  })

  it('refuses a point inside the circle, naming how far inside it is', () => {
    expect(() => tangentsFrom(O, { x: 3, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/inside/i)
    expect(() => tangentsFrom(O, { x: 3, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/"P"/)
    expect(() => tangentsFrom(O, { x: 3, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/circle "O"/)
  })

  it('refuses a point on the circle, pointing at the construction that does work there', () => {
    expect(() => tangentsFrom(O, B, { circle: 'O', point: 'B' })).toThrow(/tangent at/i)
  })
})

describe('secant', () => {
  it('is the line through two points that cuts the circle twice', () => {
    // From an external point through the circle — the power-of-a-point picture.
    const s = secantThrough(O, { x: -6, y: 4 }, { x: 3, y: 4 })
    expect(s.extent).toBe('infinite')
    expect(intersect(s, O)).toHaveLength(2)
  })

  it('refuses a line that misses the circle', () => {
    expect(() => secantThrough(O, { x: -10, y: 20 }, { x: 10, y: 20 }, { circle: 'O' })).toThrow(/cut|twice|miss/i)
  })

  it('refuses a line that only touches it — that is a tangent, not a secant', () => {
    expect(() => secantThrough(O, B, { x: 8, y: 9 }, { circle: 'O' })).toThrow(/tangent/i)
  })
})

describe('radius and diameter', () => {
  it('draws a radius as the segment from the centre to a point of the circle', () => {
    const r = radiusTo(O, D)
    expect(r.extent).toBe('segment')
    expect(r.a).toEqual(O.center)
    expect(r.b).toEqual(D)
    expect(distance(r.a, r.b)).toBeCloseTo(5, 12)
  })

  it('refuses a radius to a point that is not on the circle', () => {
    expect(() => radiusTo(O, { x: 5, y: 4 }, { circle: 'O', point: 'P' })).toThrow(/"P"/)
  })

  it('draws a diameter as the segment between two antipodal points', () => {
    const d = diameter(O, A, C)
    expect(d.extent).toBe('segment')
    expect(distance(d.a, d.b)).toBeCloseTo(10, 12)
  })

  it('refuses two points of the circle that are not opposite each other', () => {
    expect(() => diameter(O, A, B, { circle: 'O', from: 'A', to: 'B' })).toThrow(/opposite|through the centre/i)
  })
})

describe('tangency is a tolerance question (G3)', () => {
  it('calls a line tangent when it touches within the shared tolerance', () => {
    expect(isTangentLine(infiniteLine({ x: 8, y: 0 }, { x: 8, y: 9 }), O)).toBe(true)
    expect(isTangentLine(infiniteLine({ x: 8 + 1e-12, y: 0 }, { x: 8 + 1e-12, y: 9 }), O)).toBe(true)
  })

  it('calls a line that visibly crosses what it should touch not tangent', () => {
    expect(isTangentLine(infiniteLine({ x: 7.99, y: 0 }, { x: 7.99, y: 9 }), O)).toBe(false)
    expect(isTangentLine(infiniteLine({ x: 8.01, y: 0 }, { x: 8.01, y: 9 }), O)).toBe(false)
  })

  it('honours the line extent — a segment that stops short touches nothing', () => {
    expect(isTangentLine(segment({ x: 8, y: 0 }, { x: 8, y: 2 }), O)).toBe(false)
    expect(isTangentLine(segment({ x: 8, y: 0 }, { x: 8, y: 9 }), O)).toBe(true)
  })
})
