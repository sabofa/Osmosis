import { describe, expect, it } from 'vitest'
import { dilate, divide, foot, midpoint, reflect, rotate, translate } from './derive'
import { infiniteLine, segment } from './objects'

// A non-axis-aligned line for everything that needs one: through (1,1) and
// (4,5), direction (3,4)/5. Axis-aligned lines would let a swapped sign in a
// normal or a projection pass unnoticed.
const L = infiniteLine({ x: 1, y: 1 }, { x: 4, y: 5 })

describe('midpoint', () => {
  it('halves a non-axis-aligned segment', () => {
    expect(midpoint({ x: 1, y: 2 }, { x: 6, y: 12 })).toEqual({ x: 3.5, y: 7 })
  })
})

describe('divide', () => {
  it('divides in a 2:3 ratio, measured from the first point', () => {
    // A=(1,2), B=(6,12): 2/(2+3) of the way is (1,2) + 0.4*(5,10) = (3, 6).
    const p = divide({ x: 1, y: 2 }, { x: 6, y: 12 }, 2, 3)
    expect(p.x).toBeCloseTo(3, 12)
    expect(p.y).toBeCloseTo(6, 12)
  })

  it('is not symmetric in the ratio — 3:2 is the other point', () => {
    // 3/(3+2) of the way: (1,2) + 0.6*(5,10) = (4, 8).
    const p = divide({ x: 1, y: 2 }, { x: 6, y: 12 }, 3, 2)
    expect(p.x).toBeCloseTo(4, 12)
    expect(p.y).toBeCloseTo(8, 12)
  })

  it('agrees with midpoint at 1:1', () => {
    const a = { x: 1, y: 2 }
    const b = { x: 6, y: 12 }
    expect(divide(a, b, 1, 1)).toEqual(midpoint(a, b))
  })

  it('rejects a degenerate or negative ratio', () => {
    expect(() => divide({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, 0)).toThrow(/ratio/i)
    expect(() => divide({ x: 0, y: 0 }, { x: 1, y: 1 }, -1, 3)).toThrow(/ratio/i)
  })
})

describe('foot', () => {
  it('drops the perpendicular onto a non-axis-aligned line', () => {
    const f = foot({ x: 5, y: 1 }, L)
    expect(f.x).toBeCloseTo(2.44, 12)
    expect(f.y).toBeCloseTo(2.92, 12)
  })
})

describe('reflect', () => {
  it('mirrors a point across a non-axis-aligned line', () => {
    // The foot from (5,1) is (2.44, 2.92), so the mirror is 2*foot - P.
    const r = reflect({ x: 5, y: 1 }, L)
    expect(r.x).toBeCloseTo(-0.12, 12)
    expect(r.y).toBeCloseTo(4.84, 12)
  })

  it('leaves a point on the line where it is', () => {
    const r = reflect({ x: 4, y: 5 }, L)
    expect(r.x).toBeCloseTo(4, 12)
    expect(r.y).toBeCloseTo(5, 12)
  })

  it('is its own inverse', () => {
    const p = { x: -3, y: 7 }
    const back = reflect(reflect(p, L), L)
    expect(back.x).toBeCloseTo(p.x, 12)
    expect(back.y).toBeCloseTo(p.y, 12)
  })

  it('mirrors across the underlying line even when given a segment', () => {
    // The foot lands far past the segment's end; reflection is a property of
    // the line, so that must not clamp anything.
    const r = reflect({ x: 5, y: 1 }, segment({ x: 1, y: 1 }, { x: 1.6, y: 1.8 }))
    expect(r.x).toBeCloseTo(-0.12, 12)
    expect(r.y).toBeCloseTo(4.84, 12)
  })
})

describe('rotate', () => {
  it('turns counter-clockwise by a quarter turn in degrees', () => {
    // (3,1) about (1,2): the offset (2,-1) rotates to (1,2), giving (2,4).
    const r = rotate({ x: 3, y: 1 }, { x: 1, y: 2 }, 90, 'degrees')
    expect(r.x).toBeCloseTo(2, 12)
    expect(r.y).toBeCloseTo(4, 12)
  })

  it('reads the same angle as radians when the config says radians', () => {
    const inRadians = rotate({ x: 3, y: 1 }, { x: 1, y: 2 }, Math.PI / 2, 'radians')
    expect(inRadians.x).toBeCloseTo(2, 12)
    expect(inRadians.y).toBeCloseTo(4, 12)
    // The same number means something different in each mode — 90 radians is
    // nowhere near a quarter turn, which is what makes the mode load-bearing.
    const ninetyRadians = rotate({ x: 3, y: 1 }, { x: 1, y: 2 }, 90, 'radians')
    expect(Math.hypot(ninetyRadians.x - 2, ninetyRadians.y - 4)).toBeGreaterThan(0.5)
  })

  it('handles an angle that is not a multiple of 90 degrees', () => {
    const r = rotate({ x: 1, y: 0 }, { x: 0, y: 0 }, 30, 'degrees')
    expect(r.x).toBeCloseTo(Math.sqrt(3) / 2, 12)
    expect(r.y).toBeCloseTo(0.5, 12)
  })

  it('is the identity at a full turn, in both modes', () => {
    const p = { x: -3, y: 7 }
    const c = { x: 1, y: 2 }
    const deg = rotate(p, c, 360, 'degrees')
    expect(deg.x).toBeCloseTo(p.x, 12)
    expect(deg.y).toBeCloseTo(p.y, 12)
    const rad = rotate(p, c, 2 * Math.PI, 'radians')
    expect(rad.x).toBeCloseTo(p.x, 12)
    expect(rad.y).toBeCloseTo(p.y, 12)
  })
})

describe('translate', () => {
  it('shifts by a vector', () => {
    expect(translate({ x: 1, y: 2 }, { x: 3, y: -4 })).toEqual({ x: 4, y: -2 })
  })
})

describe('dilate', () => {
  it('scales away from a centre that is not the origin', () => {
    const d = dilate({ x: 5, y: 10 }, { x: 1, y: 2 }, 1.5)
    expect(d.x).toBeCloseTo(7, 12)
    expect(d.y).toBeCloseTo(14, 12)
  })

  it('takes a negative factor as a point reflection through the centre', () => {
    const d = dilate({ x: 5, y: 10 }, { x: 1, y: 2 }, -1)
    expect(d.x).toBeCloseTo(-3, 12)
    expect(d.y).toBeCloseTo(-6, 12)
  })
})
