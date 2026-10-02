import { describe, expect, it } from 'vitest'
import {
  fitLab,
  fitLch,
  hueArc,
  labToLch,
  lchInGamut,
  lchToLab,
  linearToOklab,
  linearToSrgb,
  oklabToLinear,
  oklabToLinearRaw,
  oklabToSrgb,
  srgbToLinear,
  srgbToOklab,
} from './colour'

describe('paint colour', () => {
  it('maps the known sRGB primaries to their OKLab values (CSS Color 4 reference)', () => {
    // white and black have no chroma; L is 1 and 0.
    const white = srgbToOklab(1, 1, 1)
    expect(white[0]).toBeCloseTo(1, 6)
    expect(white[1]).toBeCloseTo(0, 6)
    expect(white[2]).toBeCloseTo(0, 6)
    expect(srgbToOklab(0, 0, 0)).toEqual([0, 0, 0])
    // the primaries, to the five places the specification prints
    const red = srgbToOklab(1, 0, 0)
    expect(red[0]).toBeCloseTo(0.62796, 5)
    expect(red[1]).toBeCloseTo(0.22486, 5)
    expect(red[2]).toBeCloseTo(0.12585, 5)
    const green = srgbToOklab(0, 1, 0)
    expect(green[0]).toBeCloseTo(0.86644, 5)
    expect(green[1]).toBeCloseTo(-0.23389, 5)
    expect(green[2]).toBeCloseTo(0.1795, 5)
    const blue = srgbToOklab(0, 0, 1)
    expect(blue[0]).toBeCloseTo(0.45201, 5)
    expect(blue[1]).toBeCloseTo(-0.03246, 5)
    expect(blue[2]).toBeCloseTo(-0.31153, 5)
  })

  it('puts sRGB mid grey 0.5 at L 0.5982 with no chroma', () => {
    // ((0.5 + 0.055) / 1.055)^2.4 = 0.214041; its cube root is 0.59818. (The
    // plan's "0.7016" is the cube root of linear 0.3454, which is sRGB 0.6.)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6)
    const grey = srgbToOklab(0.5, 0.5, 0.5)
    expect(grey[0]).toBeCloseTo(0.59818, 5)
    expect(grey[1]).toBeCloseTo(0, 6)
    expect(grey[2]).toBeCloseTo(0, 6)
  })

  it('round-trips sRGB through OKLab', () => {
    for (const c of [[0.2, 0.4, 0.8], [0.9, 0.3, 0.1], [0.5, 0.5, 0.5], [0.05, 0.95, 0.4]] as const) {
      const back = oklabToSrgb(srgbToOklab(c[0], c[1], c[2]))
      // the matrices are printed to ten places, so the round trip holds to ~1e-6
      expect(back[0]).toBeCloseTo(c[0], 5)
      expect(back[1]).toBeCloseTo(c[1], 5)
      expect(back[2]).toBeCloseTo(c[2], 5)
    }
    // and the transfer function pair on its own
    expect(linearToSrgb(srgbToLinear(0.73))).toBeCloseTo(0.73, 9)
    // linear in, OKLab, linear out
    const lin = oklabToLinearRaw(...linearToOklab(0.3, 0.2, 0.1))
    expect(lin[0]).toBeCloseTo(0.3, 6)
    expect(lin[1]).toBeCloseTo(0.2, 6)
    expect(lin[2]).toBeCloseTo(0.1, 6)
  })

  it('converts OKLab and OKLCH both ways', () => {
    // C = 5, h = 53.13° is a 3-4-5 triangle: a = 3, b = 4
    const lab = lchToLab(0.5, 5, (Math.atan2(4, 3) * 180) / Math.PI)
    expect(lab[1]).toBeCloseTo(3, 9)
    expect(lab[2]).toBeCloseTo(4, 9)
    const lch = labToLch([0.4, -1, 0])
    expect(lch[1]).toBeCloseTo(1, 9)
    expect(lch[2]).toBeCloseTo(180, 9)
    // a negative b reads as a hue in 180..360
    expect(labToLch([0.4, 0, -2])[2]).toBeCloseTo(270, 9)
  })

  it('takes the shortest signed arc between two hues', () => {
    expect(hueArc(38, 75)).toBeCloseTo(37, 9)
    expect(hueArc(350, 10)).toBeCloseTo(20, 9)
    expect(hueArc(10, 350)).toBeCloseTo(-20, 9)
    expect(hueArc(100, 280)).toBeCloseTo(-180, 9)
  })

  it('fits an out-of-gamut colour by giving up chroma, not lightness or hue', () => {
    const hue = 140
    expect(lchInGamut(0.85, 0.3, hue)).toBe(false)
    const fit = fitLch([0.85, 0.3, hue])
    const lch = labToLch(fit)
    expect(lch[0]).toBeCloseTo(0.85, 9)
    expect(lch[2]).toBeCloseTo(hue, 5)
    expect(lch[1]).toBeLessThan(0.3)
    expect(lch[1]).toBeGreaterThan(0.05)
    expect(lchInGamut(lch[0], lch[1], lch[2])).toBe(true)
    // an in-gamut colour passes through unchanged
    const same = fitLab([0.6, 0.05, 0.03])
    expect(same[0]).toBeCloseTo(0.6, 9)
    expect(same[1]).toBeCloseTo(0.05, 9)
    expect(same[2]).toBeCloseTo(0.03, 9)
    // lightness is held inside 0.03..0.985
    expect(fitLch([1.4, 0, 0])[0]).toBeCloseTo(0.985, 9)
    expect(fitLch([-0.2, 0, 0])[0]).toBeCloseTo(0.03, 9)
  })

  it('hands the renderer linear-light sRGB in 0..1', () => {
    // lightness is held inside 0.03..0.985, and a grey's linear value is L³,
    // so even white comes out at 0.985³ = 0.955672
    const white = oklabToLinear([1, 0, 0])
    expect(white[0]).toBeCloseTo(0.955672, 5)
    expect(white[1]).toBeCloseTo(0.955672, 5)
    expect(white[2]).toBeCloseTo(0.955672, 5)
    // an impossible colour is fitted first, then every channel lies in 0..1
    for (const c of oklabToLinear([0.9, 0.35, 0.3])) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
    // linear grey 0.2140411 is sRGB 0.5, whose OKLab L is 0.59818
    const g = oklabToLinear([0.59818, 0, 0])
    expect(g[0]).toBeCloseTo(0.214041, 4)
  })

  it('keeps the lightness of a dark, saturated colour: what is fitted is what is drawn (value hold, ±0.012)', () => {
    // the gamut test once let a linear channel through at -0.002, and the clamp of the renderer's conversion then
    // moved a dark saturated colour's lightness by up to 0.09 (L 0.15, C 0.2, h 265 arrived as L 0.167)
    let worst = 0
    let count = 0
    for (let L = 0.14; L <= 0.3001; L += 0.01) {
      for (let h = 0; h < 360; h += 7.5) {
        for (const C of [0.12, 0.2, 0.3]) {
          const fitted = fitLch([L, C, h])
          const drawn = oklabToLinear(fitted)
          const back = linearToOklab(drawn[0], drawn[1], drawn[2])
          worst = Math.max(worst, Math.abs(back[0] - L))
          count++
        }
      }
    }
    expect(count).toBeGreaterThan(2000)
    expect(worst).toBeLessThanOrEqual(0.012)
    // in fact the fit is exact: no tolerance to be clamped away
    expect(worst).toBeLessThan(1e-6)
    expect(oklabToLinear(lchToLab(0.15, 0.2, 265))[2]).toBeLessThanOrEqual(1)
    const dark = linearToOklab(...oklabToLinear(fitLch([0.15, 0.2, 265])))
    expect(dark[0]).toBeCloseTo(0.15, 6)
    // and the colour on the edge of the gamut is still in it, with every channel inside 0..1 untouched by the clamp
    for (const c of oklabToLinear(fitLch([0.2, 0.4, 265]))) expect(c).toBeGreaterThanOrEqual(0)
  })
})
