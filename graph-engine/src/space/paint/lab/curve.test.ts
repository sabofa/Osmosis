import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { baseCurve, curveSeries, labToLch } from '../../../../../review/src/paintLabCurve'

// The chart in the "Lighting curve" group draws the base curve of §3.4 for a
// local colour: L, C and H against value, without the seeded deviation, the
// plane steps, the accent and the tints (those belong to the model). Hand values
// are for terracotta, L 0.56, C 0.14, h 38 deg, at the default curve.

const C = DEFAULT_PAINT_PARAMS.curve
const TERRACOTTA = { L: 0.56, C: 0.14, h: 38 }

describe('labToLch', () => {
  it('is (L, hypot(a, b), atan2(b, a) in degrees, in 0..360)', () => {
    const a = 0.14 * Math.cos((38 * Math.PI) / 180)
    const b = 0.14 * Math.sin((38 * Math.PI) / 180)
    const lch = labToLch([0.56, a, b])
    expect(lch.L).toBeCloseTo(0.56, 12)
    expect(lch.C).toBeCloseTo(0.14, 12)
    expect(lch.h).toBeCloseTo(38, 9)
    expect(labToLch([0.5, 0, -0.1]).h).toBeCloseTo(270, 9)
  })
})

describe('baseCurve', () => {
  it('at the pivot u = 0.62: L is the local L; C = 0.14 (0.42 + 0.88 e^-0.2304) = 0.15665; H = 38 + 0.4 (0.3) 37 = 42.44', () => {
    const p = baseCurve(C, TERRACOTTA, 0.62)
    expect(p.L).toBeCloseTo(0.56, 12)
    expect(p.C).toBeCloseTo(0.15665, 4)
    expect(p.H).toBeCloseTo(42.44, 9)
  })

  it('at u = 0.5, the middle: L = 0.56 - 0.8 (0.12) = 0.464, C = 0.14 (0.42 + 0.88) = 0.182, H unmoved', () => {
    const p = baseCurve(C, TERRACOTTA, 0.5)
    expect(p.L).toBeCloseTo(0.464, 12)
    expect(p.C).toBeCloseTo(0.182, 12)
    expect(p.H).toBeCloseTo(38, 12)
  })

  it('in the shadow u = 0.24: L = 0.256, C = 0.14 (0.42 + 0.88 e^-1.0816) = 0.10057, H swings 0.46 (0.65) of the way (-118) to cool = 2.718', () => {
    const p = baseCurve(C, TERRACOTTA, 0.24)
    expect(p.L).toBeCloseTo(0.256, 12)
    expect(p.C).toBeCloseTo(0.10057, 4)
    expect(p.H).toBeCloseTo(2.718, 9)
  })

  it('in the light u = 0.9: L = 0.784, C = 0.14 (0.42 + 0.88 e^-2.56) = 0.068324, H = 38 + 0.4 (37) = 52.8', () => {
    const p = baseCurve(C, TERRACOTTA, 0.9)
    expect(p.L).toBeCloseTo(0.784, 12)
    expect(p.C).toBeCloseTo(0.068324, 5)
    expect(p.H).toBeCloseTo(52.8, 9)
  })

  it('a colormapped surface keeps a third of the hue swing: 38 + 14.8 / 3 = 42.9333 at u = 0.9', () => {
    expect(baseCurve(C, TERRACOTTA, 0.9, C.colormapHue).H).toBeCloseTo(42.9333, 4)
  })

  it('takes the short way round the hue wheel and returns H in 0..360: 350 deg warms to 350 + 0.4 (85) = 24', () => {
    expect(baseCurve(C, { L: 0.5, C: 0.1, h: 350 }, 0.9).H).toBeCloseTo(24, 9)
  })

  it('applies the lightness, chroma and hue adjustment curves over value (§11)', () => {
    const flat = (y: number): [number, number][] => [[0, y], [1, y]]
    // u = 0.5: L 0.464, C 0.182, H 38. +0.1 L, x1.5 C and +20 deg H give 0.564, 0.273 and 58.
    const p = baseCurve(C, TERRACOTTA, 0.5, 1, { lAdjust: flat(0.1), cAdjust: flat(1.5), hAdjust: flat(20) })
    expect(p.L).toBeCloseTo(0.564, 12)
    expect(p.C).toBeCloseTo(0.273, 12)
    expect(p.H).toBeCloseTo(58, 9)
  })

  it('reads an adjustment at the value: a ramp 0 to 0.2 of L reads +0.1 at u = 0.5 and +0.18 at u = 0.9', () => {
    const adjust = { lAdjust: [[0, 0], [1, 0.2]] as [number, number][], cAdjust: [[0, 1], [1, 1]] as [number, number][], hAdjust: [[0, 0], [1, 0]] as [number, number][] }
    expect(baseCurve(C, TERRACOTTA, 0.5, 1, adjust).L).toBeCloseTo(0.464 + 0.1, 9)
    expect(baseCurve(C, TERRACOTTA, 0.9, 1, adjust).L).toBeCloseTo(0.784 + 0.18, 9)
  })

  it('keeps chroma from going negative, and the hue in 0..360 after an adjustment', () => {
    const p = baseCurve(C, TERRACOTTA, 0.5, 1, { lAdjust: [[0, 0], [1, 0]], cAdjust: [[0, -1], [1, -1]], hAdjust: [[0, -60], [1, -60]] })
    expect(p.C).toBe(0)
    expect(p.H).toBeCloseTo(338, 9) // 38 - 60 = -22 -> 338
  })

  it('follows the sliders: the pivot, the slope and the peak', () => {
    const p = baseCurve({ ...C, lPivot: 0.5, lSlope: 1, cBase: 0.5, cPeak: 0 }, TERRACOTTA, 0.7)
    expect(p.L).toBeCloseTo(0.56 + 0.2, 12)
    expect(p.C).toBeCloseTo(0.14 * 0.5, 12)
  })
})

describe('curveSeries with adjustments', () => {
  it('draws the adjusted curve: a flat +0.1 of L lifts every sample by 0.1 and leaves chroma alone', () => {
    const base = curveSeries(C, TERRACOTTA, 5)
    const lifted = curveSeries(C, TERRACOTTA, 5, 1, { lAdjust: [[0, 0.1], [1, 0.1]], cAdjust: [[0, 1], [1, 1]], hAdjust: [[0, 0], [1, 0]] })
    lifted.L.forEach((v, i) => expect(v).toBeCloseTo(base.L[i] + 0.1, 12))
    lifted.C.forEach((v, i) => expect(v).toBeCloseTo(base.C[i], 12))
  })
})

describe('curveSeries', () => {
  it('samples u = 0..1 evenly and unwraps the hue so the line never jumps', () => {
    const s = curveSeries(C, { L: 0.56, C: 0.14, h: 350 }, 41)
    expect(s.u).toHaveLength(41)
    expect(s.u[0]).toBe(0)
    expect(s.u[40]).toBe(1)
    expect(s.u[20]).toBeCloseTo(0.5, 12)
    expect(s.L[20]).toBeCloseTo(0.56 + 0.8 * (0.5 - 0.62), 12)
    for (let i = 1; i < s.H.length; i++) expect(Math.abs(s.H[i] - s.H[i - 1])).toBeLessThan(30)
  })
})
