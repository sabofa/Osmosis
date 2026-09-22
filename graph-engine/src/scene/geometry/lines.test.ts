import { describe, expect, it } from 'vitest'
import { angleBisector, parallelThrough, perpendicularBisector, perpendicularThrough } from './lines'
import { intersect } from './intersect'
import { areParallel, distance, dot, infiniteLine, isPointOnLine, lineDirection, segment, sub } from './objects'

// Base line through (1,1) and (4,5): direction (3,4)/5. Nothing axis-aligned
// anywhere in this file — an axis-aligned base would let a swapped component
// in the normal pass as a correct perpendicular.
const L = infiniteLine({ x: 1, y: 1 }, { x: 4, y: 5 })
const P = { x: 5, y: 1 }

describe('parallelThrough', () => {
  it('is genuinely parallel, genuinely passes through P, and is not the original line', () => {
    const m = parallelThrough(P, L)
    expect(areParallel(m, L)).toBe(true)
    expect(isPointOnLine(P, m)).toBe(true)
    // A construction that just handed back L would satisfy "parallel" but not
    // "through P" — and one that handed back L when P happens to be near it
    // would be wrong in a way only this check catches.
    expect(isPointOnLine(P, L)).toBe(false)
  })

  it("carries the base line's direction, so a hand-computed second point lies on it", () => {
    // From (5,1) along (3,4): (8,5) must be on the parallel.
    const m = parallelThrough(P, L)
    expect(isPointOnLine({ x: 8, y: 5 }, m)).toBe(true)
    expect(isPointOnLine({ x: 2, y: -3 }, m)).toBe(true)
  })

  it('extends infinitely even when built from a segment', () => {
    const m = parallelThrough(P, segment({ x: 1, y: 1 }, { x: 4, y: 5 }))
    expect(m.extent).toBe('infinite')
  })
})

describe('perpendicularThrough', () => {
  it('meets the base line at a right angle and passes through P', () => {
    const n = perpendicularThrough(P, L)
    expect(dot(lineDirection(n), lineDirection(L))).toBeCloseTo(0, 12)
    expect(isPointOnLine(P, n)).toBe(true)
  })

  it('passes through the foot of the perpendicular from P', () => {
    // Independently hand-computed in objects.test.ts: (2.44, 2.92).
    const n = perpendicularThrough(P, L)
    expect(isPointOnLine({ x: 2.44, y: 2.92 }, n)).toBe(true)
    // ...and that is exactly where it crosses the base line.
    const hits = intersect(n, L)
    expect(hits).toHaveLength(1)
    expect(hits[0].x).toBeCloseTo(2.44, 10)
    expect(hits[0].y).toBeCloseTo(2.92, 10)
  })
})

describe('perpendicularBisector', () => {
  const A = { x: 1, y: 1 }
  const B = { x: 7, y: 9 }

  it('passes through the midpoint at a right angle to A-B', () => {
    const p = perpendicularBisector(A, B)
    expect(isPointOnLine({ x: 4, y: 5 }, p)).toBe(true)
    expect(dot(lineDirection(p), sub(B, A))).toBeCloseTo(0, 12)
  })

  it('is equidistant from both endpoints at more than one place on it', () => {
    const p = perpendicularBisector(A, B)
    // Two hand-picked points on it: the midpoint (4,5) offset by +/-(-4,3).
    for (const q of [
      { x: 4, y: 5 },
      { x: 0, y: 8 },
      { x: 8, y: 2 },
    ]) {
      expect(isPointOnLine(q, p)).toBe(true)
      expect(distance(q, A)).toBeCloseTo(distance(q, B), 10)
    }
  })

  it('rejects a bisector of a point with itself', () => {
    expect(() => perpendicularBisector(A, { x: 1, y: 1 })).toThrow(/same point|distinct/i)
  })
})

describe('angleBisector', () => {
  // Vertex at B=(1,1), with BA along (3,4)/5 and BC along (4,-3)/5 — a right
  // angle made of two non-axis-aligned arms, so the bisector direction is
  // (0.6,0.8) + (0.8,-0.6) = (1.4, 0.2), i.e. proportional to (7, 1).
  const A = { x: 4, y: 5 }
  const V = { x: 1, y: 1 }
  const C = { x: 5, y: -2 }

  it('starts at the vertex and runs along the hand-computed direction', () => {
    const b = angleBisector(A, V, C)
    expect(b.a).toEqual(V)
    const d = lineDirection(b)
    expect(d.x * 1 - d.y * 7).toBeCloseTo(0, 12) // parallel to (7,1)
    expect(d.x).toBeGreaterThan(0) // ...and pointing into the angle, not away
  })

  it('splits the angle into two equal halves', () => {
    const b = angleBisector(A, V, C)
    const d = lineDirection(b)
    const toA = sub(A, V)
    const toC = sub(C, V)
    const halfA = Math.acos(dot(d, toA) / Math.hypot(toA.x, toA.y))
    const halfC = Math.acos(dot(d, toC) / Math.hypot(toC.x, toC.y))
    expect(halfA).toBeCloseTo(halfC, 10)
    // A right angle at the vertex, so each half is 45 degrees. Without this
    // the test would also pass for a bisector that had collapsed onto one arm
    // (both halves 0) — which is exactly how a sign error would show up.
    expect(halfA).toBeCloseTo(Math.PI / 4, 10)
  })

  it('is a ray from the vertex, so it does not extend backwards out of the angle', () => {
    const b = angleBisector(A, V, C)
    expect(b.extent).toBe('ray')
    expect(isPointOnLine({ x: -6, y: 0 }, b)).toBe(false) // behind the vertex along (7,1)
    expect(isPointOnLine({ x: 8, y: 2 }, b)).toBe(true)
  })

  it('divides the opposite side in the ratio of the adjacent sides', () => {
    // The angle-bisector theorem, on the scalene triangle from centres.test.ts.
    // The bisector at B meets C-A at D with AD:DC = BA:BC.
    const ta = { x: 1, y: 1 }
    const tb = { x: 9, y: 3 }
    const tc = { x: 4, y: 8 }
    const hits = intersect(angleBisector(ta, tb, tc), segment(tc, ta))
    expect(hits).toHaveLength(1)
    const d = hits[0]
    expect(distance(ta, d) / distance(d, tc)).toBeCloseTo(distance(tb, ta) / distance(tb, tc), 10)
  })

  it('rejects a straight angle and a zero angle alike (D6)', () => {
    // A, B, C collinear with B between A and C: a straight angle.
    expect(() => angleBisector({ x: 1, y: 1 }, { x: 4, y: 5 }, { x: 7, y: 9 })).toThrow(/collinear/i)
    // A and C on the same side of B: a zero angle.
    expect(() => angleBisector({ x: 4, y: 5 }, { x: 1, y: 1 }, { x: 7, y: 9 })).toThrow(/collinear/i)
  })

  it('rejects an arm of zero length', () => {
    expect(() => angleBisector(V, V, C)).toThrow(/distinct|same point/i)
  })
})
