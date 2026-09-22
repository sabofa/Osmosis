import { describe, expect, it } from 'vitest'
import { solveTriangle, type TriangleSpec } from './solveTriangle'
import { distance, dot, sub } from './objects'

function spec(sides: TriangleSpec['sides'], angles: TriangleSpec['angles']): TriangleSpec {
  return { names: ['A', 'B', 'C'], sides, angles }
}

// D5: the first named vertex at the origin, the second on the positive
// x-axis, the third in the upper half-plane. Asserted on every case below,
// because without it "deterministic" is not achievable — the constraints fix
// a triangle's shape but neither its position nor its orientation.
function expectD5Placement(vertices: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]): void {
  const [v1, v2, v3] = vertices
  expect(v1).toEqual({ x: 0, y: 0 })
  expect(v2.y).toBeCloseTo(0, 12)
  expect(v2.x).toBeGreaterThan(0)
  expect(v3.y).toBeGreaterThan(0)
}

describe('SSS', () => {
  it('places a 3-4-5 triangle with the right angle where it belongs', () => {
    // a = |BC| = 5, b = |CA| = 4, c = |AB| = 3, so the right angle is at A.
    const solved = solveTriangle(spec({ a: 5, b: 4, c: 3 }, {}), 'degrees')
    expect(solved.kind).toBe('SSS')
    expectD5Placement(solved.vertices)
    const [a, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(3, 12)
    expect(c.x).toBeCloseTo(0, 12)
    expect(c.y).toBeCloseTo(4, 12)
    // The right angle, checked rather than assumed.
    expect(dot(sub(b, a), sub(c, a))).toBeCloseTo(0, 12)
    expect(distance(b, c)).toBeCloseTo(5, 12)
  })

  it('places a scalene 5-6-7 triangle at its hand-computed vertices', () => {
    // c = 3rd side = 5 puts B at (5,0). C.x = (b^2 + c^2 - a^2)/(2c)
    //   = (36 + 25 - 49)/10 = 1.2, and C.y = sqrt(36 - 1.44) = sqrt(34.56).
    const solved = solveTriangle(spec({ a: 7, b: 6, c: 5 }, {}), 'degrees')
    const [, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(5, 12)
    expect(c.x).toBeCloseTo(1.2, 12)
    expect(c.y).toBeCloseTo(Math.sqrt(34.56), 12)
  })

  it('rejects sides that violate the triangle inequality, naming them', () => {
    expect(() => solveTriangle(spec({ a: 1, b: 2, c: 10 }, {}), 'degrees')).toThrow(/triangle inequality/i)
  })
})

describe('SAS', () => {
  it("places the spec's own example: angle A = 90, AB = 6, AC = 8", () => {
    // AB = c = 6, AC = b = 8, included angle at A.
    const solved = solveTriangle(spec({ b: 8, c: 6 }, { a: 90 }), 'degrees')
    expect(solved.kind).toBe('SAS')
    expectD5Placement(solved.vertices)
    const [a, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(6, 12)
    expect(c.x).toBeCloseTo(0, 12)
    expect(c.y).toBeCloseTo(8, 12)
    expect(distance(b, c)).toBeCloseTo(10, 12)
    expect(dot(sub(b, a), sub(c, a))).toBeCloseTo(0, 12)
  })

  it('handles an included angle that is not at the first vertex', () => {
    // a = 8, c = 5 meet at B, with angle B = 60. Law of cosines:
    //   b^2 = 64 + 25 - 2*8*5*cos60 = 49, so b = 7.
    // Then C.x = (49 + 25 - 64)/10 = 1 and C.y = sqrt(49 - 1) = 4*sqrt(3).
    const solved = solveTriangle(spec({ a: 8, c: 5 }, { b: 60 }), 'degrees')
    expect(solved.kind).toBe('SAS')
    const [, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(5, 12)
    expect(c.x).toBeCloseTo(1, 12)
    expect(c.y).toBeCloseTo(4 * Math.sqrt(3), 12)
  })

  it('reads the included angle in radians when the config says radians', () => {
    const solved = solveTriangle(spec({ b: 8, c: 6 }, { a: Math.PI / 2 }), 'radians')
    const [, , c] = solved.vertices
    expect(c.x).toBeCloseTo(0, 12)
    expect(c.y).toBeCloseTo(8, 12)
    // The same number is a different triangle in each mode — 1 radian is a
    // wide angle, 1 degree is nearly a straight edge — which is what makes
    // the mode load-bearing rather than cosmetic.
    const asRadians = solveTriangle(spec({ b: 8, c: 6 }, { a: 1 }), 'radians')
    const asDegrees = solveTriangle(spec({ b: 8, c: 6 }, { a: 1 }), 'degrees')
    expect(asRadians.vertices[2].y).toBeCloseTo(8 * Math.sin(1), 10)
    expect(asDegrees.vertices[2].y).toBeCloseTo(8 * Math.sin(Math.PI / 180), 10)
    expect(asRadians.vertices[2].y - asDegrees.vertices[2].y).toBeGreaterThan(6)
  })
})

describe('ASA and AAS', () => {
  // A = 30, B = 60, so C = 90. With c = |AB| = 10: a = 5, b = 5*sqrt(3).
  // C.x = (75 + 100 - 25)/20 = 7.5 and C.y = sqrt(75 - 56.25) = sqrt(18.75).
  const EXPECTED_C = { x: 7.5, y: Math.sqrt(18.75) }

  it('solves ASA — the given side lies between the two given angles', () => {
    const solved = solveTriangle(spec({ c: 10 }, { a: 30, b: 60 }), 'degrees')
    expect(solved.kind).toBe('ASA')
    expectD5Placement(solved.vertices)
    const [, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(10, 12)
    expect(c.x).toBeCloseTo(EXPECTED_C.x, 10)
    expect(c.y).toBeCloseTo(EXPECTED_C.y, 10)
  })

  it('solves AAS — the given side is not between the two given angles', () => {
    // Same triangle, specified by a = 5 (opposite A) instead of c.
    const solved = solveTriangle(spec({ a: 5 }, { a: 30, b: 60 }), 'degrees')
    expect(solved.kind).toBe('AAS')
    expectD5Placement(solved.vertices)
    const [, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(10, 10)
    expect(c.x).toBeCloseTo(EXPECTED_C.x, 10)
    expect(c.y).toBeCloseTo(EXPECTED_C.y, 10)
  })

  it('rejects two angles that already sum to 180 or more', () => {
    expect(() => solveTriangle(spec({ c: 5 }, { a: 120, b: 60 }), 'degrees')).toThrow(/180/)
    expect(() => solveTriangle(spec({ c: 5 }, { a: 100, b: 90 }), 'degrees')).toThrow(/180/)
  })

  it('rejects three angles, which fix a shape but not a size', () => {
    expect(() => solveTriangle(spec({}, { a: 60, b: 60, c: 60 }), 'degrees')).toThrow(/size|AAA/i)
  })
})

describe('RHS', () => {
  it('solves right-angle, hypotenuse and one leg', () => {
    // Right angle at A, hypotenuse a = 10, leg b = 8, so the other leg c = 6.
    const solved = solveTriangle(spec({ a: 10, b: 8 }, { a: 90 }), 'degrees')
    expect(solved.kind).toBe('RHS')
    expectD5Placement(solved.vertices)
    const [a, b, c] = solved.vertices
    expect(b.x).toBeCloseTo(6, 12)
    expect(c.x).toBeCloseTo(0, 12)
    expect(c.y).toBeCloseTo(8, 12)
    expect(dot(sub(b, a), sub(c, a))).toBeCloseTo(0, 12)
  })

  it('rejects a hypotenuse shorter than the leg it is given with', () => {
    expect(() => solveTriangle(spec({ a: 5, b: 8 }, { a: 90 }), 'degrees')).toThrow(/hypotenuse/i)
  })
})

describe('SSA', () => {
  it('is rejected, and the message teaches the circle-intersection alternative', () => {
    let message = ''
    try {
      solveTriangle(spec({ a: 8, b: 10 }, { a: 40 }), 'degrees')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/ambiguous/i)
    expect(message).toMatch(/SSA/)
    // Not merely a refusal: it must point at intersecting a circle with a ray,
    // which is the construction that draws *both* triangles — the picture that
    // answers "why can't this be determined?".
    expect(message).toMatch(/circle/i)
    expect(message).toMatch(/intersect/i)
  })
})

describe('under- and over-specified triangles', () => {
  it('rejects fewer than three constraints, saying how many it got', () => {
    expect(() => solveTriangle(spec({ a: 5, b: 6 }, {}), 'degrees')).toThrow(/2/)
  })

  it('rejects more than three constraints', () => {
    expect(() => solveTriangle(spec({ a: 5, b: 6, c: 7 }, { a: 44 }), 'degrees')).toThrow(/4/)
  })

  it('rejects a non-positive side length and an out-of-range angle', () => {
    expect(() => solveTriangle(spec({ a: 5, b: 6, c: 0 }, {}), 'degrees')).toThrow(/positive/i)
    expect(() => solveTriangle(spec({ b: 8, c: 6 }, { a: 180 }), 'degrees')).toThrow(/between 0 and 180/i)
  })
})
