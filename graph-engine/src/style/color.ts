// Saturation, through OKLCH.
//
// A style's `saturation` (0 to 1.5) scales the CHROMA of every colour a
// figure uses — ink, fills, accents, an author's own "color:" — in OKLCH, the
// perceptual space where lightness and hue are held while chroma moves. So
// 0 gives a grey of the same perceived lightness, 1 is the identity, and 1.5
// is more vivid without drifting in hue. Pushed out of the sRGB gamut, the
// chroma is reduced (not the channels clipped) until the colour fits, which is
// what keeps hue and lightness honest at the vivid end.
//
// The matrices are Björn Ottosson's OKLab reference.

export interface Oklch {
  l: number
  c: number
  // Degrees, [0, 360).
  h: number
}

function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function fromLinear(value: number): number {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return c * 255
}

function parseHex(hex: string): [number, number, number] {
  const text = hex.replace(/^#/, '')
  const full = text.length === 3 ? text.replace(/./g, (c) => c + c) : text
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export function toOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

// Linear sRGB channels of an OKLCH colour, possibly out of [0, 1].
function linearOf(colour: Oklch): [number, number, number] {
  const hue = (colour.h * Math.PI) / 180
  const A = colour.c * Math.cos(hue)
  const B = colour.c * Math.sin(hue)
  const l = (colour.l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (colour.l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (colour.l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (channels: readonly number[]) => channels.every((c) => c >= -1e-6 && c <= 1 + 1e-6)

export function fromOklch(colour: Oklch): string {
  let fitted = colour
  if (!inGamut(linearOf(colour))) {
    // Bisect the chroma down until the colour fits; hue and lightness stay.
    let lo = 0
    let hi = colour.c
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(linearOf({ ...colour, c: mid }))) lo = mid
      else hi = mid
    }
    fitted = { ...colour, c: lo }
  }
  return (
    '#' +
    linearOf(fitted)
      .map((c) => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, c)))))).toString(16).padStart(2, '0'))
      .join('')
  )
}

// A colour made deeper: its OKLCH lightness scaled by `factor` (below 1 is
// darker), hue and chroma held. Shading drawn in LINES uses it, since a
// hatch line in the region's own tint is far fainter than the same tint laid
// as an area.
export function deepen(colour: string, factor: number): string {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) return colour
  const oklch = toOklch(colour.toLowerCase())
  return fromOklch({ ...oklch, l: oklch.l * factor })
}

// A colour's chroma scaled by `saturation`. "#rgb" and "#rrggbb" in, always
// "#rrggbb" out; anything else (a pattern reference, "none") passes through.
export function saturate(colour: string, saturation: number): string {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) return colour
  const oklch = toOklch(colour.toLowerCase())
  return fromOklch({ ...oklch, c: oklch.c * saturation })
}
