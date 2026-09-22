import { describe, expect, it } from 'vitest'
import { intersect } from './intersect'
import { circle, infiniteLine, point, ray, segment } from './objects'

// Two lines crossing at exactly (2, 3), neither of them axis-aligned and
// neither defined by a pair that contains the answer:
//   L1 through (-1,-1) and (5,7)  — direction (6,8), passes (2,3) at t = 1/2
//   L2 through (0,4)  and (8,0)   — direction (8,-4), passes (2,3) at t = 1/4
const L1 = infiniteLine({ x: -1, y: -1 }, { x: 5, y: 7 })
const L2 = infiniteLine({ x: 0, y: 4 }, { x: 8, y: 0 })

// The circle of radius 5 about the origin, and the line through two points
// that happen to lie on it — so the two intersections are exactly the
// defining points, with no rounding to argue about.
const O = circle({ x: 0, y: 0 }, 5)
const CHORD = infiniteLine({ x: -3, y: 4 }, { x: 4, y: 3 })

describe('intersect — line x line', () => {
  it('finds the crossing point of two non-axis-aligned lines', () => {
    const hits = intersect(L1, L2)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(2, 12)
    expect(hits[0].y).toBeCloseTo(3, 12)
  })

  it('returns nothing for parallel lines', () => {
    const parallel = infiniteLine({ x: 0, y: 0 }, { x: 3, y: 4 })
    expect(intersect(L1, parallel)).toEqual([])
  })

  it('rejects two lines that are the same line rather than returning infinite solutions', () => {
    const same = infiniteLine({ x: -1, y: -1 }, { x: 2, y: 3 })
    expect(() => intersect(L1, same)).toThrow(/same line|overlap/i)
  })

  it('rejects two overlapping collinear segments, but not two disjoint ones', () => {
    const left = segment({ x: -1, y: -1 }, { x: 2, y: 3 })
    const overlapping = segment({ x: 0.5, y: 1 }, { x: 5, y: 7 })
    const disjoint = segment({ x: 5, y: 7 }, { x: 8, y: 11 })
    expect(() => intersect(left, overlapping)).toThrow(/same line|overlap/i)
    expect(intersect(left, disjoint)).toEqual([])
  })

  it('returns the single touching point when two collinear segments meet end to end', () => {
    const left = segment({ x: -1, y: -1 }, { x: 2, y: 3 })
    const right = segment({ x: 2, y: 3 }, { x: 5, y: 7 })
    const hits = intersect(left, right)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(2, 12)
    expect(hits[0].y).toBeCloseTo(3, 12)
  })

  it('excludes a crossing that lies past a segment end', () => {
    // Stops well short of (2, 3): from (-1,-1) toward (5,7), it ends at t = 1/4.
    const short = segment({ x: -1, y: -1 }, { x: 0.5, y: 1 })
    expect(intersect(short, L2)).toEqual([])
    // ...but the same span extended to a ray does reach it.
    const onward = ray({ x: -1, y: -1 }, { x: 0.5, y: 1 })
    expect(intersect(onward, L2)).toHaveLength(1)
  })

  it('excludes a crossing that lies behind a ray origin', () => {
    const away = ray({ x: 5, y: 7 }, { x: 8, y: 11 }) // (2,3) is behind the origin
    expect(intersect(away, L2)).toEqual([])
    const toward = ray({ x: 5, y: 7 }, { x: -1, y: -1 })
    expect(intersect(toward, L2)).toHaveLength(1)
  })
})

describe('intersect — line x circle', () => {
  it('finds both crossings of a non-axis-aligned chord, ordered by x', () => {
    const hits = intersect(CHORD, O)
    expect(hits).toHaveLength(2)
    expect(hits[0].x).toBeCloseTo(-3, 12)
    expect(hits[0].y).toBeCloseTo(4, 12)
    expect(hits[1].x).toBeCloseTo(4, 12)
    expect(hits[1].y).toBeCloseTo(3, 12)
  })

  it('gives the same answer with the arguments the other way round', () => {
    expect(intersect(O, CHORD)).toEqual(intersect(CHORD, O))
  })

  it('yields exactly one point at the correct place for a tangent line', () => {
    // Through (3,4) with direction (-4,3): perpendicular to the radius there,
    // so it touches the circle at (3,4) and nowhere else.
    const tangent = infiniteLine({ x: 3, y: 4 }, { x: -1, y: 7 })
    const hits = intersect(tangent, O)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(3, 9)
    expect(hits[0].y).toBeCloseTo(4, 9)
  })

  it('yields nothing for a line that misses the circle', () => {
    // Distance from the origin to x + y = 8 is 8/sqrt(2) ~ 5.657 > 5.
    const miss = infiniteLine({ x: 0, y: 8 }, { x: 8, y: 0 })
    expect(intersect(miss, O)).toEqual([])
  })

  it('drops the crossing that lies outside a segment', () => {
    // Along the same chord, but stopping before (4, 3).
    const short = segment({ x: -3, y: 4 }, { x: 0.5, y: 3.5 })
    const hits = intersect(short, O)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(-3, 12)
    expect(hits[0].y).toBeCloseTo(4, 12)
  })

  it('orders two solutions that share an x by y ascending (D3)', () => {
    // Circle about (1,2) of radius 5, cut by the vertical line x = 4:
    // (4-1)^2 + (y-2)^2 = 25 -> y - 2 = +/-4 -> y = -2 and y = 6.
    const c = circle({ x: 1, y: 2 }, 5)
    const vertical = infiniteLine({ x: 4, y: 0 }, { x: 4, y: 10 })
    const hits = intersect(vertical, c)
    expect(hits).toHaveLength(2)
    expect(hits[0].x).toBeCloseTo(4, 12)
    expect(hits[0].y).toBeCloseTo(-2, 12)
    expect(hits[1].x).toBeCloseTo(4, 12)
    expect(hits[1].y).toBeCloseTo(6, 12)
  })
})

describe('intersect — circle x circle', () => {
  it('finds both crossings, ordered by x ascending', () => {
    // |C1C2| = 5 with r1 = r2 = 5. Along the unit vector (0.6, 0.8) the
    // radical line sits at a = 2.5, so the midpoint is (1.5, 2) and the
    // half-chord is h = sqrt(25 - 6.25) = 2.5*sqrt(3), offset along the
    // perpendicular (-0.8, 0.6):
    //   (1.5 - 2*sqrt(3), 2 + 1.5*sqrt(3)) and (1.5 + 2*sqrt(3), 2 - 1.5*sqrt(3))
    const hits = intersect(O, circle({ x: 3, y: 4 }, 5))
    const s = Math.sqrt(3)
    expect(hits).toHaveLength(2)
    expect(hits[0].x).toBeCloseTo(1.5 - 2 * s, 10)
    expect(hits[0].y).toBeCloseTo(2 + 1.5 * s, 10)
    expect(hits[1].x).toBeCloseTo(1.5 + 2 * s, 10)
    expect(hits[1].y).toBeCloseTo(2 - 1.5 * s, 10)
  })

  it('yields exactly one point at the correct place when externally tangent', () => {
    // Centres 10 apart along (0.6, 0.8), radii 5 and 5 — they touch at (3, 4).
    const hits = intersect(O, circle({ x: 6, y: 8 }, 5))
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(3, 9)
    expect(hits[0].y).toBeCloseTo(4, 9)
  })

  it('yields exactly one point at the correct place when internally tangent', () => {
    // r = 10 about the origin, r = 5 about (3,4): centres 5 apart, so the
    // small circle touches the big one from inside at (6, 8).
    const hits = intersect(circle({ x: 0, y: 0 }, 10), circle({ x: 3, y: 4 }, 5))
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(6, 9)
    expect(hits[0].y).toBeCloseTo(8, 9)
  })

  it('yields nothing for concentric circles', () => {
    expect(intersect(circle({ x: 1, y: 2 }, 3), circle({ x: 1, y: 2 }, 5))).toEqual([])
  })

  it('yields nothing for circles that are too far apart, or nested', () => {
    expect(intersect(O, circle({ x: 20, y: 15 }, 5))).toEqual([])
    expect(intersect(circle({ x: 0, y: 0 }, 10), circle({ x: 1, y: 1 }, 2))).toEqual([])
  })

  it('rejects two identical circles rather than returning infinite solutions', () => {
    expect(() => intersect(circle({ x: 1, y: 2 }, 3), circle({ x: 1, y: 2 }, 3))).toThrow(/same circle|identical/i)
  })
})

describe('intersect — unsupported pairs', () => {
  it('rejects a point operand, naming what it got', () => {
    expect(() => intersect(point({ x: 1, y: 1 }), L1)).toThrow(/point/i)
    expect(() => intersect(L1, point({ x: 1, y: 1 }))).toThrow(/point/i)
  })
})
