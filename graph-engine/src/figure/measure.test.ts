import { describe, expect, it } from 'vitest'
import { arcBetween } from '../scene/geometry/circles'
import { circle } from '../scene/geometry/objects'
import {
  angleMeasure,
  arcMeasure,
  checkMeasure,
  formatAngleMeasure,
  formatMeasure,
  segmentLength,
} from './measure'

describe('segmentLength', () => {
  it('measures a segment that is not axis aligned', () => {
    // (1,2) -> (4,6): a 3-4-5 triangle laid on the diagonal.
    expect(segmentLength({ x: 1, y: 2 }, { x: 4, y: 6 })).toBeCloseTo(5, 12)
  })

  it('measures a segment whose endpoints are both negative', () => {
    expect(segmentLength({ x: -7, y: -3 }, { x: -2, y: -15 })).toBeCloseTo(13, 12)
  })

  it('is zero for coincident endpoints', () => {
    expect(segmentLength({ x: 2.5, y: -1 }, { x: 2.5, y: -1 })).toBe(0)
  })
})

describe('angleMeasure', () => {
  // Vertex at (1,1), one leg along (3,4) and one along (5,0): the classic
  // 3-4-5 direction against the horizontal, so the answer is
  // atan(4/3) = 53.13010235415598 degrees and nothing about it is a right
  // angle or a multiple of 45.
  const vertex = { x: 1, y: 1 }
  const from = { x: 4, y: 5 }
  const to = { x: 6, y: 1 }

  it('measures in degrees under @angle: degrees', () => {
    expect(angleMeasure(vertex, from, to, 'degrees')).toBeCloseTo(53.13010235415598, 10)
  })

  it('measures in radians under @angle: radians', () => {
    expect(angleMeasure(vertex, from, to, 'radians')).toBeCloseTo(0.9272952180016122, 12)
  })

  it('does not depend on how long the legs are', () => {
    const near = angleMeasure(vertex, { x: 1.3, y: 1.4 }, { x: 1.5, y: 1 }, 'degrees')
    const far = angleMeasure(vertex, { x: 301, y: 401 }, { x: 501, y: 1 }, 'degrees')
    expect(near).toBeCloseTo(far, 10)
    expect(near).toBeCloseTo(53.13010235415598, 10)
  })

  it('measures the non-reflex angle, so the two arms commute', () => {
    expect(angleMeasure(vertex, to, from, 'degrees')).toBeCloseTo(angleMeasure(vertex, from, to, 'degrees'), 12)
  })

  it('measures an obtuse angle as itself rather than as its supplement', () => {
    // Legs along (1,0) and (-1,1): 135 degrees.
    expect(angleMeasure({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: -3, y: 3 }, 'degrees')).toBeCloseTo(135, 10)
  })

  it('is zero when an arm is degenerate rather than NaN', () => {
    expect(angleMeasure({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 'degrees')).toBe(0)
  })
})

describe('formatMeasure', () => {
  // F2 — every number a measure label prints goes through this one function,
  // so that exact/symbolic display becomes a change here rather than a sweep.
  it('prints a whole number without a decimal point', () => {
    expect(formatMeasure(8)).toBe('8')
  })

  it('keeps a short decimal as written', () => {
    expect(formatMeasure(5.5)).toBe('5.5')
  })

  it('rounds to three decimals', () => {
    expect(formatMeasure(Math.sqrt(50))).toBe('7.071')
    expect(formatMeasure(1 / 3)).toBe('0.333')
  })

  it('drops trailing zeros left by rounding', () => {
    expect(formatMeasure(2.5001)).toBe('2.5')
    expect(formatMeasure(4.0004)).toBe('4')
  })

  it('never prints a negative zero', () => {
    expect(formatMeasure(-0.00001)).toBe('0')
    expect(formatMeasure(-0)).toBe('0')
  })

  it('keeps a genuine negative', () => {
    expect(formatMeasure(-3.25)).toBe('-3.25')
  })

  it('refuses a non-finite value rather than printing "NaN" into the figure', () => {
    expect(() => formatMeasure(Number.NaN)).toThrow(/finite/)
    expect(() => formatMeasure(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })
})

describe('formatAngleMeasure', () => {
  it('carries the degree sign in degrees mode', () => {
    expect(formatAngleMeasure(30, 'degrees')).toBe('30°')
  })

  it('carries no unit in radians mode', () => {
    // Decimals until exact values land (F2) — "0.524", not "π/6".
    expect(formatAngleMeasure(Math.PI / 6, 'radians')).toBe('0.524')
  })

  it('routes through the same rounding as every other measure', () => {
    expect(formatAngleMeasure(53.13010235415598, 'degrees')).toBe('53.13°')
  })
})

describe('checkMeasure', () => {
  // F1 — the asserting form. `label: AB = 8` prints 8 *and* fails when the
  // computed length is not 8, because a figure whose labels contradict its
  // own geometry is a wrong figure.
  it('passes when the stated value matches the computed one', () => {
    expect(checkMeasure('AB', 8, 8, { toScale: true })).toBeNull()
  })

  it('passes through floating-point noise from a construction chain', () => {
    expect(checkMeasure('AB', 8, 8 + 4e-13, { toScale: true })).toBeNull()
  })

  it('fails when the stated value contradicts the figure, naming both values', () => {
    const message = checkMeasure('AB', 99, 8, { toScale: true })
    expect(message).not.toBeNull()
    // Both numbers must be in the message: a failure that says only "does
    // not match" leaves the author to recompute the figure by hand.
    expect(message).toContain('99')
    expect(message).toContain('8')
    expect(message).toContain('AB')
  })

  it('fails on a difference far larger than the tolerance but small in absolute terms', () => {
    expect(checkMeasure('AB', 8, 8.01, { toScale: true })).not.toBeNull()
  })

  it('names the subject as the author wrote it, angles included', () => {
    const message = checkMeasure('angle ABC', 30, 53.13010235415598, { toScale: true })
    expect(message).toContain('angle ABC')
    expect(message).toContain('30')
    expect(message).toContain('53.13')
  })

  it('is suppressed by the not-to-scale flag', () => {
    // @scale: false exists precisely to permit the disagreement.
    expect(checkMeasure('AB', 99, 8, { toScale: false })).toBeNull()
  })

  it('scales its tolerance with the magnitude of the values', () => {
    // GEOM_EPS is relative, as it is everywhere else in the geometry layer:
    // a residual of 1e-7 on a length of 1e6 is rounding, not disagreement.
    expect(checkMeasure('AB', 1e6, 1e6 + 1e-7, { toScale: true })).toBeNull()
    // ...while the same absolute residual on a unit length is a real one.
    expect(checkMeasure('AB', 1, 1 + 1e-7, { toScale: true })).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// G2 — an arc's measure and its central angle are the same number
// ---------------------------------------------------------------------------

describe('arcMeasure', () => {
  // The same circle the construction tests use: centre (3, 4), radius 5.
  //   B (8, 4)   at 0 degrees
  //   D (-1, 7)  at atan2(3, -4) = 143.13010235415598 degrees
  //   E (3, 9)   at 90 degrees
  const O = circle({ x: 3, y: 4 }, 5)
  const B = { x: 8, y: 4 }
  const D = { x: -1, y: 7 }
  const E = { x: 3, y: 9 }

  it('measures a minor arc in degrees', () => {
    expect(arcMeasure(arcBetween(O, B, D, 'minor'), 'degrees')).toBeCloseTo(143.13010235415598, 10)
  })

  it('measures the same arc in radians', () => {
    expect(arcMeasure(arcBetween(O, B, D, 'minor'), 'radians')).toBeCloseTo(2.498091544796509, 12)
  })

  it('measures a major arc as more than a straight angle', () => {
    const major = arcMeasure(arcBetween(O, B, D, 'major'), 'degrees')
    expect(major).toBeGreaterThan(180)
    expect(major).toBeCloseTo(360 - 143.13010235415598, 10)
  })

  it('measures the way round, not the shorter way — a clockwise quarter is 90, its reverse 270', () => {
    expect(arcMeasure(arcBetween(O, B, E, 'ccw'), 'degrees')).toBeCloseTo(90, 10)
    expect(arcMeasure(arcBetween(O, B, E, 'cw'), 'degrees')).toBeCloseTo(270, 10)
  })

  it('measures a full circle as one whole turn', () => {
    const full = { center: O.center, radius: O.radius, start: 0, sweep: 2 * Math.PI }
    expect(arcMeasure(full, 'degrees')).toBeCloseTo(360, 10)
    expect(arcMeasure(full, 'radians')).toBeCloseTo(2 * Math.PI, 12)
  })

  it('agrees with the angle at the centre, which is what a central angle mark draws', () => {
    // An independent route to the same number: angleMeasure knows nothing
    // about arcs and measures the non-reflex angle between two rays. For a
    // minor arc the two must agree exactly; for a major one, the arc is the
    // rest of the turn, which is why a major arc cannot be drawn by measuring
    // the angle at the centre and printing it.
    const minor = arcBetween(O, B, D, 'minor')
    expect(arcMeasure(minor, 'degrees')).toBeCloseTo(angleMeasure(O.center, B, D, 'degrees'), 10)
    const major = arcBetween(O, B, D, 'major')
    expect(arcMeasure(major, 'degrees')).toBeCloseTo(360 - angleMeasure(O.center, B, D, 'degrees'), 10)
  })

  it('prints through the one formatter, so radians stay decimals until exact values land', () => {
    const arc = arcBetween(O, B, E, 'ccw')
    expect(formatAngleMeasure(arcMeasure(arc, 'degrees'), 'degrees')).toBe('90°')
    expect(formatAngleMeasure(arcMeasure(arc, 'radians'), 'radians')).toBe('1.571')
  })
})
