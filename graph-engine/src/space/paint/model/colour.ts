// Colour for the paint model: OKLab and OKLCH (Björn Ottosson, 2020), linear
// and gamma-encoded sRGB, and a gamut fit that keeps lightness and hue and
// gives up chroma. Pure.
//
// Ported from the approved mockup (paint-math.js, oil.js, figures.js lchFit).
// Every stroke colour is built in OKLCH, tinted in OKLab, then fitted and
// handed to the renderer as linear-light sRGB (StrokeBatch.colour).

import type { Oklab } from '../types'
import { clamp, D2R, type V3 } from './math'

export type Oklch = [number, number, number] // L, C, h in degrees 0..360

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

// OKLab to linear sRGB, unclamped (a colour outside the gamut gives values
// outside 0..1).
export function oklabToLinearRaw(L: number, a: number, b: number): V3 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

// Linear sRGB to OKLab.
export function linearToOklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// Gamma-encoded sRGB (each 0..1) to OKLab.
export function srgbToOklab(r: number, g: number, b: number): Oklab {
  return linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))
}

// OKLab to gamma-encoded sRGB, each channel clamped to 0..1.
export function oklabToSrgb(lab: readonly number[]): V3 {
  const lin = oklabToLinearRaw(lab[0], lab[1], lab[2])
  return [
    linearToSrgb(clamp(lin[0], 0, 1)),
    linearToSrgb(clamp(lin[1], 0, 1)),
    linearToSrgb(clamp(lin[2], 0, 1)),
  ]
}

export function lchToLab(L: number, C: number, h: number): Oklab {
  const r = h * D2R
  return [L, C * Math.cos(r), C * Math.sin(r)]
}

export function labToLch(lab: readonly number[]): Oklch {
  let h = Math.atan2(lab[2], lab[1]) / D2R
  if (h < 0) h += 360
  return [lab[0], Math.hypot(lab[1], lab[2]), h]
}

// The signed shortest arc from hue h to hue t, in degrees (-180..180].
export const hueArc = (h: number, t: number): number => ((t - h + 540) % 360) - 180

export function lchInGamut(L: number, C: number, h: number): boolean {
  const lab = lchToLab(L, C, h)
  const lin = oklabToLinearRaw(lab[0], lab[1], lab[2])
  return (
    lin[0] >= -0.002 && lin[0] <= 1.002 &&
    lin[1] >= -0.002 && lin[1] <= 1.002 &&
    lin[2] >= -0.002 && lin[2] <= 1.002
  )
}

// Lightness is kept (inside 0.03..0.985), and so is hue: chroma shrinks until
// the colour fits sRGB.
export function fitLch(lch: readonly number[]): Oklab {
  const L = clamp(lch[0], 0.03, 0.985)
  const h = lch[2]
  let C = Math.max(0, lch[1])
  if (!lchInGamut(L, C, h)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      if (lchInGamut(L, mid, h)) lo = mid
      else hi = mid
    }
    C = lo
  }
  return lchToLab(L, C, h)
}

export function fitLab(lab: readonly number[]): Oklab {
  return fitLch(labToLch(lab))
}

// The renderer's colour: an OKLab colour fitted to the gamut and converted to
// linear-light sRGB, each channel in 0..1.
export function oklabToLinear(lab: readonly number[]): V3 {
  const f = fitLab(lab)
  const lin = oklabToLinearRaw(f[0], f[1], f[2])
  return [clamp(lin[0], 0, 1), clamp(lin[1], 0, 1), clamp(lin[2], 0, 1)]
}

// A straight mix of two OKLab colours.
export function mixLab(a: readonly number[], b: readonly number[], t: number): Oklab {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
