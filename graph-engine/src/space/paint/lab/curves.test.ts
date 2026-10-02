import { describe, expect, it } from 'vitest'
import type { CurvePoints } from '../curves'
import {
  addPoint, addPointBeside, canRemove, curveX, curveY, MIN_GAP, movePoint, nudgePoint, plotX, plotY, removePoint,
} from '../../../../../review/src/paintLabCurves'

// The point maths behind the curve editors: pure, so every constraint is a hand
// value. The curve is x in 0..1; the first and last points are its endpoints.

const P = (): CurvePoints => [[0, 0], [0.3, 0.4], [0.7, 0.6], [1, 1]]
const UNIT = { yMin: 0, yMax: 1 }

describe('movePoint', () => {
  it('moves an interior point to the pointer', () => {
    expect(movePoint(P(), 1, 0.5, 0.5, UNIT)).toEqual([[0, 0], [0.5, 0.5], [0.7, 0.6], [1, 1]])
  })

  it(`keeps x strictly between its neighbours, ${MIN_GAP} off each`, () => {
    expect(movePoint(P(), 1, 0.9, 0.5, UNIT)[1]).toEqual([0.69, 0.5]) // 0.7 - 0.01
    expect(movePoint(P(), 1, -0.2, 0.5, UNIT)[1]).toEqual([0.01, 0.5]) // 0 + 0.01
    expect(movePoint(P(), 2, 0.1, 0.5, UNIT)[2]).toEqual([0.31, 0.5]) // 0.3 + 0.01
    expect(movePoint(P(), 2, 5, 0.5, UNIT)[2]).toEqual([0.99, 0.5]) // 1 - 0.01
  })

  it('keeps y inside the editor\'s range', () => {
    expect(movePoint(P(), 1, 0.4, 2, UNIT)[1][1]).toBe(1)
    expect(movePoint(P(), 1, 0.4, -3, UNIT)[1][1]).toBe(0)
    expect(movePoint(P(), 1, 0.4, 90, { yMin: -60, yMax: 60 })[1][1]).toBe(60)
    expect(movePoint(P(), 1, 0.4, -90, { yMin: -60, yMax: 60 })[1][1]).toBe(-60)
  })

  it('moves an endpoint in y only', () => {
    expect(movePoint(P(), 0, 0.5, 0.2, UNIT)[0]).toEqual([0, 0.2])
    expect(movePoint(P(), 3, 0.2, 0.9, UNIT)[3]).toEqual([1, 0.9])
  })

  it('rounds to four decimals, so a drag leaves no float noise in the JSON', () => {
    expect(movePoint(P(), 1, 0.123456789, 0.987654321, UNIT)[1]).toEqual([0.1235, 0.9877])
  })

  it('returns a new array and leaves the old one alone', () => {
    const old = P()
    const next = movePoint(old, 1, 0.5, 0.5, UNIT)
    expect(next).not.toBe(old)
    expect(old).toEqual(P())
  })

  it('changes nothing for an index it does not have, or a pointer that is not a number', () => {
    const old = P()
    expect(movePoint(old, 4, 0.5, 0.5, UNIT)).toBe(old)
    expect(movePoint(old, -1, 0.5, 0.5, UNIT)).toBe(old)
    expect(movePoint(old, 1, Number.NaN, 0.5, UNIT)).toBe(old)
    expect(movePoint(old, 1, 0.5, Number.POSITIVE_INFINITY, UNIT)).toBe(old)
  })
})

describe('nudgePoint', () => {
  it('moves a point by a step, under the same constraints', () => {
    expect(nudgePoint(P(), 1, 0.01, -0.05, UNIT)[1]).toEqual([0.31, 0.35])
    expect(nudgePoint(P(), 1, 1, 0, UNIT)[1]).toEqual([0.69, 0.4])
    expect(nudgePoint(P(), 0, 0.5, 0.1, UNIT)[0]).toEqual([0, 0.1])
  })
})

describe('addPoint', () => {
  it('inserts a point in x order and says where', () => {
    const result = addPoint(P(), 0.5, 0.55, UNIT)
    expect(result.points).toEqual([[0, 0], [0.3, 0.4], [0.5, 0.55], [0.7, 0.6], [1, 1]])
    expect(result.index).toBe(2)
  })

  it('puts a point before the others when the click is near the start', () => {
    const result = addPoint(P(), 0.1, 0.1, UNIT)
    expect(result.points.map((p) => p[0])).toEqual([0, 0.1, 0.3, 0.7, 1])
    expect(result.index).toBe(1)
  })

  it('refuses a point on top of another, or outside the endpoints (index -1, the same points)', () => {
    const old = P()
    for (const x of [0.305, 0.295, 0.005, 0.995, 0, 1, -0.1, 1.2]) {
      const result = addPoint(old, x, 0.5, UNIT)
      expect(result.index, String(x)).toBe(-1)
      expect(result.points, String(x)).toBe(old)
    }
  })

  it('keeps the new point\'s y inside the range', () => {
    expect(addPoint(P(), 0.5, 5, UNIT).points[2]).toEqual([0.5, 1])
  })
})

describe('addPointBeside (Insert or Enter on a focused point)', () => {
  it('puts a point midway to the next one, on the curve: the middle of a straight line stays on it', () => {
    const line: CurvePoints = [[0, 0], [1, 1]]
    expect(addPointBeside(line, 0, UNIT)).toEqual({ points: [[0, 0], [0.5, 0.5], [1, 1]], index: 1 })
    // from an interior point: between 0.3 and 0.7 is 0.5, and it keeps the order
    const added = addPointBeside(P(), 1, UNIT)
    expect(added.index).toBe(2)
    expect(added.points.map((p) => p[0])).toEqual([0, 0.3, 0.5, 0.7, 1])
    expect(added.points[2][1]).toBeGreaterThan(0.4) // between its neighbours' heights, as the curve is monotone there
    expect(added.points[2][1]).toBeLessThan(0.6)
    // the old points are untouched, and it is a new array
    expect(P()).toEqual([[0, 0], [0.3, 0.4], [0.7, 0.6], [1, 1]])
    expect(added.points).not.toBe(P())
  })

  it('goes toward the previous point from the last one: a last point has no next', () => {
    const line: CurvePoints = [[0, 0], [1, 1]]
    expect(addPointBeside(line, 1, UNIT)).toEqual({ points: [[0, 0], [0.5, 0.5], [1, 1]], index: 1 })
    const added = addPointBeside(P(), 3, UNIT)
    expect(added.points.map((p) => p[0])).toEqual([0, 0.3, 0.7, 0.85, 1])
    expect(added.index).toBe(3)
  })

  it('puts the new point on the curve where the line is not straight: its y is what evalCurve says there, to four decimals', () => {
    const bend: CurvePoints = [[0, 0], [0.5, 0.2], [1, 1]]
    const added = addPointBeside(bend, 1, UNIT)
    expect(added.points[2][0]).toBe(0.75)
    // the monotone cubic between (0.5, 0.2) and (1, 1) at 0.75, by hand: the secants are 0.4 and 1.6, so the tangent at
    // 0.5 is their mean, 1, and the end takes its secant, 1.6; h = 0.5, t = 0.5, so the Hermite weights are
    // h00 = 0.5, h10 = 0.125, h01 = 0.5, h11 = -0.125:
    //   y = 0.5 x 0.2 + 0.125 x 0.5 x 1 + 0.5 x 1 - 0.125 x 0.5 x 1.6 = 0.1 + 0.0625 + 0.5 - 0.1 = 0.5625
    expect(added.points[2][1]).toBeCloseTo(0.5625, 4)
  })

  it('refuses where there is no room (less than twice MIN_GAP apart), and for an index the curve does not have', () => {
    const close: CurvePoints = [[0, 0], [0.015, 0.5], [1, 1]]
    expect(addPointBeside(close, 0, UNIT)).toEqual({ points: close, index: -1 })
    expect(addPointBeside(close, 0, UNIT).points).toBe(close)
    expect(addPointBeside(P(), 4, UNIT).index).toBe(-1)
    expect(addPointBeside(P(), -1, UNIT).index).toBe(-1)
    expect(addPointBeside(P(), 1.5, UNIT).index).toBe(-1)
    expect(addPointBeside([[0, 0]], 0, UNIT).index).toBe(-1)
  })

  it('can be asked again of the new point, until the room runs out', () => {
    let points: CurvePoints = [[0, 0], [1, 1]]
    let index = 0
    for (let k = 0; k < 20; k++) {
      const next = addPointBeside(points, index, UNIT)
      if (next.index < 0) break
      points = next.points
      index = next.index - 1 // stay on the first point of the pair: the gap halves each time
    }
    // 1, 0.5, 0.25 ... until half a gap would sit within MIN_GAP (0.01) of a point: x = 0.0078125 is the last that fits
    expect(points.length).toBeGreaterThan(5)
    expect(points.length).toBeLessThan(12)
    for (let i = 1; i < points.length; i++) expect(points[i][0] - points[i - 1][0]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9)
  })
})

describe('removePoint', () => {
  it('drops an interior point', () => {
    expect(removePoint(P(), 1)).toEqual([[0, 0], [0.7, 0.6], [1, 1]])
    expect(canRemove(P(), 1)).toBe(true)
  })

  it('never drops an endpoint: it fixes the span, and nothing could put it back', () => {
    const old = P()
    expect(canRemove(old, 0)).toBe(false)
    expect(canRemove(old, 3)).toBe(false)
    expect(removePoint(old, 0)).toBe(old)
    expect(removePoint(old, 3)).toBe(old)
  })

  it('never goes below two points, and ignores an index it does not have', () => {
    const two: CurvePoints = [[0, 0], [1, 1]]
    expect(removePoint(two, 0)).toBe(two)
    expect(removePoint(two, 1)).toBe(two)
    const three: CurvePoints = [[0, 0], [0.5, 0.5], [1, 1]]
    expect(removePoint(three, 1)).toEqual(two)
    expect(canRemove(three, 7)).toBe(false)
    expect(removePoint(three, 7)).toBe(three)
  })
})

describe('the plot', () => {
  // A plot 240 x 120 SVG units at (40, 10), y from -0.2 (bottom) to 0.2 (top).
  const box = { left: 40, top: 10, width: 240, height: 120 }
  const range = { yMin: -0.2, yMax: 0.2 }

  it('maps a curve point to SVG units: x across, y up', () => {
    expect(plotX(box, 0.5)).toBe(160) // 40 + 0.5 x 240
    expect(plotX(box, 1)).toBe(280)
    expect(plotY(box, range, 0)).toBe(70) // 10 + 120 (0.2 - 0) / 0.4
    expect(plotY(box, range, 0.2)).toBe(10)
    expect(plotY(box, range, -0.2)).toBe(130)
  })

  it('maps back, so a pointer lands on the point it is over', () => {
    expect(curveX(box, 160)).toBeCloseTo(0.5, 12)
    expect(curveY(box, range, 70)).toBeCloseTo(0, 12)
    for (const [x, y] of [[0.13, -0.17], [0.9, 0.05]] as const) {
      expect(curveX(box, plotX(box, x))).toBeCloseTo(x, 12)
      expect(curveY(box, range, plotY(box, range, y))).toBeCloseTo(y, 12)
    }
  })
})
