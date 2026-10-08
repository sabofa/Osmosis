// OKLCH colour maths. Pure TS: no DOM, no node APIs.

export interface Oklch { l: number; c: number; h: number; a: number }

type Rgb = [number, number, number]

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RESIDUE = 0.002

export function isHex(s: string): boolean {
  return HEX_RE.test(s)
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const norm360 = (h: number): number => ((h % 360) + 360) % 360

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function fromOklab(L: number, a: number, b: number, alpha: number): Oklch {
  const c = Math.hypot(a, b)
  if (c < 1e-6) return { l: L, c: 0, h: 0, a: alpha }
  return { l: L, c, h: norm360((Math.atan2(b, a) * 180) / Math.PI), a: alpha }
}

function toOklab(c: Oklch): [number, number, number] {
  const hr = (c.h * Math.PI) / 180
  return [c.l, c.c * Math.cos(hr), c.c * Math.sin(hr)]
}

const rawLinear = (c: Oklch, chroma: number): Rgb => {
  const hr = (c.h * Math.PI) / 180
  return oklabToLinear(c.l, chroma * Math.cos(hr), chroma * Math.sin(hr))
}

const inGamut = (rgb: Rgb, tol: number): boolean => rgb.every((v) => v >= -tol && v <= 1 + tol)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Linear sRGB, in gamut: chroma bisected down if needed, residue clamped. */
function gamutLinear(c: Oklch): Rgb {
  let rgb = rawLinear(c, c.c)
  if (!inGamut(rgb, RESIDUE)) {
    let lo = 0
    let hi = c.c
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(rawLinear(c, mid), RESIDUE)) lo = mid
      else hi = mid
    }
    rgb = rawLinear(c, lo)
  }
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])]
}

export function parseColour(s: string): Oklch {
  const str = s.trim()
  if (isHex(str)) {
    let h = str.slice(1)
    if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch)
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255
    const [L, a, b] = linearToOklab(toLinear(n(0)), toLinear(n(2)), toLinear(n(4)))
    return fromOklab(L, a, b, h.length === 8 ? n(6) : 1)
  }
  const m = /^oklch\(\s*([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)\s*(?:\/\s*([^\s)]+)\s*)?\)$/i.exec(str)
  if (!m) throw new Error(`parseColour: cannot parse "${s}"`)
  const num = (t: string, pctScale: number): number => {
    const pct = t.endsWith('%')
    const body = pct ? t.slice(0, -1) : t.replace(/deg$/i, '')
    const v = body.trim() === '' ? NaN : Number(body)
    if (!Number.isFinite(v)) throw new Error(`parseColour: cannot parse "${s}"`)
    return pct ? (v / 100) * pctScale : v
  }
  const l = Math.min(1, Math.max(0, num(m[1]!, 1)))
  const c = Math.max(0, num(m[2]!, 0.4))
  const h = norm360(num(m[3]!, 360))
  const a = m[4] === undefined ? 1 : Math.min(1, Math.max(0, num(m[4], 1)))
  return { l, c, h, a }
}

export function hexToOklch(h: string): Oklch {
  return parseColour(h)
}

export function toHex(c: Oklch): string {
  const alphaSuffix = c.a < 1 ? Math.round(clamp01(c.a) * 255).toString(16).padStart(2, '0') : ''
  if (c.l <= 0) return `#000000${alphaSuffix}`
  if (c.l >= 1) return `#ffffff${alphaSuffix}`
  const rgb = gamutLinear(c)
  const byte = (v: number): string =>
    Math.round(clamp01(fromLinear(v)) * 255).toString(16).padStart(2, '0')
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}${alphaSuffix}`
}

export function mix(a: Oklch, b: Oklch, t: number): Oklch {
  const [l1, a1, b1] = toOklab(a)
  const [l2, a2, b2] = toOklab(b)
  const k = (x: number, y: number): number => x + (y - x) * t
  return fromOklab(k(l1, l2), k(a1, a2), k(b1, b2), k(a.a, b.a))
}

export const withL = (c: Oklch, l: number): Oklch => ({ ...c, l })
export const withC = (c: Oklch, k: (c: number) => number): Oklch => ({ ...c, c: Math.max(0, k(c.c)) })
export const withH = (c: Oklch, h: number): Oklch => ({ ...c, h: norm360(h) })
export const withA = (c: Oklch, a: number): Oklch => ({ ...c, a })

export function luminance(c: Oklch): number {
  const [r, g, b] = gamutLinear(c)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: Oklch, b: Oklch): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function fitLightness(c: Oklch, against: Oklch, min: number): Oklch {
  if (contrast(c, against) >= min) return c
  const extreme = luminance(against) > 0.18 ? 0 : 1
  if (contrast(withL(c, extreme), against) < min) return withL(c, extreme)
  let fail = c.l
  let pass = extreme
  for (let i = 0; i < 40; i++) {
    const mid = (fail + pass) / 2
    if (contrast(withL(c, mid), against) >= min) pass = mid
    else fail = mid
  }
  return withL(c, pass)
}
