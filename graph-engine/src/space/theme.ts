// Space's colours (plan G8). Pure.
//
// Colours resolve to floats in 0..1 for the shaders. They are the sRGB
// values themselves, not linearised: the shaders do no gamma, and the default
// framebuffer is displayed as sRGB, so drawing the sRGB values as-is shows
// exactly the hex the palette names. (Lighting therefore happens in sRGB
// space, which is the conventional, slightly flatter look of chart software.)

import { isValidColor, resolveColor } from '../parser/colors'
import type { Palette } from '../render/palette'
import type { ColorSpec } from './scene/types'

export type Rgb = readonly [number, number, number]

// The categorical series for slots 1-7, one per theme: distinguishable from
// each other and from the accent (slot 0, palette.curve) on the palette's
// backgrounds. Slots past 7 cycle through 1-7.
export const SPACE_SERIES: Record<'light' | 'dark', readonly number[]> = {
  light: [0x2f6f9f, 0x4c7a4a, 0x8a4fa3, 0xb8860b, 0x1f8a8a, 0xa34b3f, 0x5b5b52],
  dark: [0x6fa8d6, 0x6fa06c, 0xb98ad0, 0xe0b64a, 0x4fc1c1, 0xc76a5c, 0xa8a597],
}

export function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

export function slotHex(slot: number, palette: Palette, theme: 'light' | 'dark'): number {
  if (!(slot >= 1)) return palette.curve
  const series = SPACE_SERIES[theme]
  return series[(Math.floor(slot) - 1) % series.length]
}

// An author colour (a name or #rrggbb, through parser/colors.ts) wins;
// otherwise the slot picks from the series. An author value the parser does
// not know falls back to the slot rather than to a grey.
export function resolveSpaceColor(spec: ColorSpec, palette: Palette, theme: 'light' | 'dark'): Rgb {
  if (spec.author && isValidColor(spec.author)) return hexToRgb(resolveColor(spec.author))
  return hexToRgb(slotHex(spec.slot, palette, theme))
}

// The resolved palette the GL layer draws with: the frame's colours, the
// clear colour, and what marks resolve against.
export interface SpaceColors {
  palette: Palette
  theme: 'light' | 'dark'
  background: Rgb
  axis: Rgb
  grid: Rgb
  gridStrong: Rgb
}

export function spaceColors(palette: Palette, theme: 'light' | 'dark'): SpaceColors {
  return {
    palette,
    theme,
    background: hexToRgb(palette.background),
    axis: hexToRgb(palette.axis),
    grid: hexToRgb(palette.grid),
    gridStrong: hexToRgb(palette.gridStrong),
  }
}

export function cssRgb(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}
