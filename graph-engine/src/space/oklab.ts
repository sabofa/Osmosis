// Oklab (Björn Ottosson, 2020), the perceptual space space's colormaps are
// interpolated in (plan E1). Pure.
//
// sRGB values are 0..1 and gamma-encoded (what a hex colour names); Oklab is
// computed from their linear values. L runs 0 (black) to 1 (white); a and b
// are the green-red and blue-yellow opponent axes.

import type { Rgb } from './theme'

export type Lab = readonly [number, number, number]

// The sRGB transfer function and its inverse (IEC 61966-2-1).
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

export function srgbToOklab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb[0])
  const g = srgbToLinear(rgb[1])
  const b = srgbToLinear(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// Out-of-gamut results are clamped to 0..1 per channel.
export function oklabToSrgb(lab: Lab): Rgb {
  const [L, a, b] = lab
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (c: number) => Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c)))))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function mixLab(p: Lab, q: Lab, t: number): Lab {
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
}
