import { describe, expect, it } from 'vitest'
import { evalCurve } from './curves'
import { CURVE_SCHEMA, DEFAULT_PAINT_PARAMS, resolvePaintParams } from './params'

describe('editable curves', () => {
  it('the identity curve returns x', () => {
    for (const x of [0, 0.13, 0.5, 0.87, 1]) expect(evalCurve([[0, 0], [1, 1]], x)).toBeCloseTo(x, 12)
  })

  it('passes through every control point and clamps outside them', () => {
    const c: [number, number][] = [[0.1, 0.2], [0.4, 0.3], [0.9, 0.95]]
    expect(evalCurve(c, 0.1)).toBeCloseTo(0.2, 12)
    expect(evalCurve(c, 0.4)).toBeCloseTo(0.3, 12)
    expect(evalCurve(c, 0.9)).toBeCloseTo(0.95, 12)
    expect(evalCurve(c, 0)).toBe(0.2)
    expect(evalCurve(c, 1)).toBe(0.95)
  })

  it('is monotone between rising points (no overshoot)', () => {
    const c: [number, number][] = [[0, 0], [0.2, 0.05], [0.25, 0.9], [1, 1]]
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const y = evalCurve(c, i / 200)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12)
      expect(y).toBeLessThanOrEqual(1 + 1e-12)
      prev = y
    }
  })

  it('a flat run stays flat (a plateau, not a bump)', () => {
    const c: [number, number][] = [[0, 0], [0.3, 0.5], [0.6, 0.5], [1, 1]]
    for (let i = 0; i <= 30; i++) expect(evalCurve(c, 0.3 + (0.3 * i) / 30)).toBeCloseTo(0.5, 12)
  })

  it('the default curves are identity or flat, so the spec formulas stay the look', () => {
    const c = DEFAULT_PAINT_PARAMS.curves
    for (const x of [0, 0.3, 0.7, 1]) {
      expect(evalCurve(c.lightResponse, x)).toBeCloseTo(x, 12)
      expect(evalCurve(c.value, x)).toBeCloseTo(x, 12)
      expect(evalCurve(c.lAdjust, x)).toBe(0)
      expect(evalCurve(c.cAdjust, x)).toBe(1)
      expect(evalCurve(c.hAdjust, x)).toBe(0)
      expect(evalCurve(c.mixAmount, x)).toBe(1)
    }
  })

  it('a curve override replaces the whole curve; an invalid one is ignored', () => {
    const p = resolvePaintParams({ curves: { value: [[0, 0], [0.5, 0.7], [1, 1]], lAdjust: [[0, 1]], cAdjust: [[0.5, 1], [0.2, 1]] } })
    expect(p.curves.value).toEqual([[0, 0], [0.5, 0.7], [1, 1]])
    expect(p.curves.lAdjust).toEqual(DEFAULT_PAINT_PARAMS.curves.lAdjust)
    expect(p.curves.cAdjust).toEqual(DEFAULT_PAINT_PARAMS.curves.cAdjust)
  })

  it('every curve editor addresses a curve with default points inside its y range', () => {
    for (const spec of CURVE_SCHEMA) {
      const key = spec.path.split('.')[1] as keyof typeof DEFAULT_PAINT_PARAMS.curves
      const pts = DEFAULT_PAINT_PARAMS.curves[key]
      expect(Array.isArray(pts), spec.path).toBe(true)
      for (const [, y] of pts) {
        expect(y).toBeGreaterThanOrEqual(spec.yMin)
        expect(y).toBeLessThanOrEqual(spec.yMax)
      }
    }
  })
})
