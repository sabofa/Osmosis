import { resolveColor } from '../parser/colors'

export interface Palette {
  background: number
  curve: number
  segment: number
  point: number
  region: number
  axis: number
  grid: number
  gridStrong: number
  hover: number
}

// Colors pulled from Osmosis's own design language (see web/src/index.css)
// and the "Ink-Framed Ruled Grid" reference (warm paper background, bold ink
// axes, a two-tier ruled grid). curve/region use --accent, segment/ray/vector
// use --good, point uses --bad — preserves the original palette's functional
// distinction between object kinds while matching the reference's hues.
// hover uses --accent too, tying the interaction highlight to the same
// accent color CSS uses for it. These are the fallbacks; a host app that
// defines those custom properties gets them read live (resolvePalette).
export const LIGHT_PALETTE: Palette = {
  background: 0xfdf6ea,
  curve: 0xc65d22,
  segment: 0x4c7a4a,
  point: 0xa34b3f,
  region: 0xc65d22,
  axis: 0x17170f,
  grid: 0xe4e2d4,
  gridStrong: 0xc9c6b3,
  hover: 0xc65d22,
}

export const DARK_PALETTE: Palette = {
  background: 0x201e15,
  curve: 0xe2803f,
  segment: 0x6fa06c,
  point: 0xc76a5c,
  region: 0xe2803f,
  axis: 0xf2efe2,
  grid: 0x34311e,
  gridStrong: 0x4a4530,
  hover: 0xe2803f,
}

// Which CSS custom property feeds each palette slot. The names are the
// host app's (Osmosis) design tokens; a consumer that doesn't define them
// simply gets the built-in light/dark palette above.
const TOKEN_FOR: Record<keyof Palette, string> = {
  background: '--surface',
  curve: '--accent',
  region: '--accent',
  hover: '--accent',
  segment: '--good',
  point: '--bad',
  axis: '--ink',
  grid: '--line',
  gridStrong: '--line-strong',
}

function parseHex(value: string): number | null {
  const v = value.trim()
  const m = /^#([0-9a-fA-F]{6})$/.exec(v)
  if (m) return Number.parseInt(m[1], 16)
  const s = /^#([0-9a-fA-F]{3})$/.exec(v)
  if (s) {
    const [r, g, b] = s[1].split('')
    return Number.parseInt(r + r + g + g + b + b, 16)
  }
  return null
}

// The palette for a theme, with every slot overridden by the host's CSS
// custom property when `element` (or its ancestors) defines one as a hex
// colour. Read from computed style so inline overrides on <html> (how the
// app applies a theme preset) and media-query flips both count.
export function resolvePalette(theme: 'light' | 'dark', element?: Element | null): Palette {
  const base = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
  if (!element || typeof getComputedStyle !== 'function') return base
  const style = getComputedStyle(element)
  const out: Palette = { ...base }
  for (const slot of Object.keys(TOKEN_FOR) as (keyof Palette)[]) {
    const parsed = parseHex(style.getPropertyValue(TOKEN_FOR[slot]))
    if (parsed !== null) out[slot] = parsed
  }
  return out
}

// ---------------------------------------------------------------------------
// Themed statement colours. A spec's "color: orange" names a hue the author
// (and a question like "what colour is the curve?") relies on, so the hue is
// kept — but the fixed hex behind the name was tuned for the warm-paper
// palette and reads wrong on other themes. harmonize() re-fits lightness and
// saturation to the theme's background and nudges toward its accent, so the
// same spec looks native on every theme. Explicit "#rrggbb" stays exact: an
// author who typed a hex asked for that hex.
// ---------------------------------------------------------------------------

function toRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
}

function fromRgb(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

export function rgbToHsl(hex: number): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

export function hslToRgb(h: number, s: number, l: number): number {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return fromRgb(l * 255, l * 255, l * 255)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return fromRgb(f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255)
}

function relativeLuminance(hex: number): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = toRgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function mixRgb(a: number, b: number, t: number): number {
  const [ar, ag, ab] = toRgb(a)
  const [br, bg, bb] = toRgb(b)
  return fromRgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// How far a named colour is pulled toward the theme accent. Small on purpose:
// enough to sit in the same family, not enough to change what colour it is.
const ACCENT_PULL = 0.12

export function harmonize(hex: number, palette: Pick<Palette, 'background' | 'curve' | 'axis'>): number {
  const dark = relativeLuminance(palette.background) < 0.5
  const [h, s, l] = rgbToHsl(hex)
  // Achromatic names are roles, not hues: black is "ink", gray is muted ink.
  if (s < 0.12) {
    return l < 0.5 ? palette.axis : mixRgb(palette.axis, palette.background, 0.5)
  }
  const lightness = dark ? clamp(l, 0.58, 0.72) : clamp(l, 0.32, 0.48)
  const saturation = clamp(s, 0.45, 0.8)
  return mixRgb(hslToRgb(h, saturation, lightness), palette.curve, ACCENT_PULL)
}

// Resolve a statement's "color:" value for drawing: absent → the kind's
// palette default; "#rrggbb" → exactly that; a name → harmonized to the theme.
export function themedColor(value: string | null | undefined, fallback: number, palette: Pick<Palette, 'background' | 'curve' | 'axis'>): number {
  if (!value) return fallback
  if (value.startsWith('#')) return resolveColor(value)
  return harmonize(resolveColor(value), palette)
}
