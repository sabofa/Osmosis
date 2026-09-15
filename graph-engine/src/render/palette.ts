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
