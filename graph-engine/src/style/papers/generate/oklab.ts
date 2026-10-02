// OKLab <-> sRGB for per-texel paper work. style/color.ts converts hex strings
// (rounded to 8 bits, no OKLab out), which is wrong for texels and for the
// small linear sensitivities the structure is derived from, so the paper
// generator carries its own float versions. Matrices are Bjorn Ottosson's
// OKLab reference, the same as color.ts.

export type Vec3 = [number, number, number]

const toLinear = (c8: number): number => {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear8 = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

// sRGB channels 0..255 (not rounded; values past the range are allowed, so a
// brightness factor above 1 can be linearised) to OKLab.
export function srgb8ToOklab(r8: number, g8: number, b8: number): Vec3 {
  const r = toLinear(r8)
  const g = toLinear(g8)
  const b = toLinear(b8)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// OKLab to sRGB channels as floats clamped to 0..255 (not rounded).
export function oklabToSrgb8(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const enc = (v: number) => fromLinear8(Math.min(1, Math.max(0, v)))
  return [enc(r), enc(g), enc(bl)]
}
