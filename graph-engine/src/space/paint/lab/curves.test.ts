import { describe, expect, it } from 'vitest'
import type { CurvePoints } from '../curves'
import {
  addPoint, canRemove, curveX, curveY, MIN_GAP, movePoint, nudgePoint, plotX, plotY, removePoint,
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
