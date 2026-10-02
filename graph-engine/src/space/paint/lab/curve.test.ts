import { describe, expect, it } from 'vitest'
import { lchToLab } from '../model/colour'
import { makeCurve } from '../model/curve'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, setParam } from '../params'
import { curveSeries, labToLch } from '../../../../../review/src/paintLabCurve'

// The chart in the "Lighting curve" group draws the MODEL'S curve (model/curve.ts)
// for a local colour: L, C and H against value, fitted to sRGB as the strokes'
// colours are. Hand values are for terracotta, L 0.56, C 0.14, h 38 deg.

const P = DEFAULT_PAINT_PARAMS
const TERRACOTTA = { L: 0.56, C: 0.14, h: 38 }
// the curve's own seeded wobble off, for the hand values
const SMOOTH = resolvePaintParams({ curve: { devL: 0, devC: 0, devH: 0 } })

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

describe('curveSeries (the model’s curve, as the strokes use it)', () => {
  it('samples u = 0..1 evenly', () => {
    const s = curveSeries(P, TERRACOTTA, 41)
    expect(s.u).toHaveLength(41)
    expect(s.L).toHaveLength(41)
    expect(s.u[0]).toBe(0)
    expect(s.u[40]).toBe(1)
    expect(s.u[20]).toBeCloseTo(0.5, 12)
  })

  it('is the model’s curve: every sample is makeCurve(params).lab at that u, fitted to sRGB', () => {
    const curve = makeCurve(P)
    const s = curveSeries(P, TERRACOTTA, 21)
    s.u.forEach((u, i) => {
      const lch = labToLch(curve.lab({ local: lchToLab(0.56, 0.14, 38), u }))
      expect(s.L[i]).toBeCloseTo(lch.L, 12)
      expect(s.C[i]).toBeCloseTo(lch.C, 12)
      expect((((s.H[i] - lch.h) % 360) + 360) % 360 < 1e-9 || (((s.H[i] - lch.h) % 360) + 360) % 360 > 360 - 1e-9).toBe(true)
    })
  })

  it('has the lightness line: at the pivot u = 0.62 L is the local L (0.56), at u = 0.5 it is 0.56 - 0.8 (0.12) = 0.464', () => {
    const s = curveSeries(SMOOTH, TERRACOTTA, 101)
    expect(s.L[62]).toBeCloseTo(0.56, 9)
    expect(s.L[50]).toBeCloseTo(0.464, 9)
  })

  it('includes the curve’s own seeded wobble (the strokes have it): a bigger deviation moves the lightness', () => {
    const calm = curveSeries(SMOOTH, TERRACOTTA, 41)
    const wobbly = curveSeries(setParam(SMOOTH, 'curve.devL', 0.05), TERRACOTTA, 41)
    let moved = 0
    wobbly.L.forEach((v, i) => {
      if (Math.abs(v - calm.L[i]) > 0.005) moved++
    })
    expect(moved).toBeGreaterThan(10)
  })

  it('applies the adjustment curves of §11: a flat +0.1 of L lifts the lightness by 0.1 where nothing clamps it, and x0.5 halves a small chroma', () => {
    const base = curveSeries(SMOOTH, TERRACOTTA, 101)
    const lifted = curveSeries(resolvePaintParams({ curve: { devL: 0, devC: 0, devH: 0 }, curves: { lAdjust: [[0, 0.1], [1, 0.1]] } }), TERRACOTTA, 101)
    // u = 0.5: L 0.464 + 0.1
    expect(lifted.L[50]).toBeCloseTo(base.L[50] + 0.1, 9)
    // a dull colour stays inside the gamut, so a chroma curve of 0.5 halves its chroma
    const dull = { L: 0.56, C: 0.04, h: 38 }
    const full = curveSeries(SMOOTH, dull, 101)
    const half = curveSeries(resolvePaintParams({ curve: { devL: 0, devC: 0, devH: 0 }, curves: { cAdjust: [[0, 0.5], [1, 0.5]] } }), dull, 101)
    // (at u = 0.5 the warm and cool tints, which add to chroma whatever it is, are zero)
    expect(half.C[50]).toBeCloseTo(full.C[50] * 0.5, 9)
    for (const i of [30, 70, 90]) expect(half.C[i]).toBeLessThan(full.C[i])
  })

  it('keeps a third of the hue swing on a colormapped colour', () => {
    const plain = curveSeries(SMOOTH, TERRACOTTA, 101)
    const mapped = curveSeries(SMOOTH, TERRACOTTA, 101, true)
    // the hue turned away from the local colour's 38 degrees, the short way round
    const swing = (s: typeof plain, i: number) => ((s.H[i] - 38 + 540) % 360) - 180
    expect(Math.abs(swing(plain, 90))).toBeGreaterThan(10)
    expect(swing(mapped, 90) / swing(plain, 90)).toBeGreaterThan(0.3)
    expect(swing(mapped, 90) / swing(plain, 90)).toBeLessThan(0.42)
  })

  it('unwraps the hue so the line never jumps, for a colour near the wheel’s seam', () => {
    const s = curveSeries(P, { L: 0.56, C: 0.14, h: 350 }, 41)
    for (let i = 1; i < s.H.length; i++) expect(Math.abs(s.H[i] - s.H[i - 1])).toBeLessThan(30)
  })
})
