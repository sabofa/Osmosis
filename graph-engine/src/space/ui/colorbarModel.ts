// The colorbar's content (plan E5), pure: the DOM in ui/colorbar.ts only
// applies it.
//
// - The strip is a CSS linear-gradient of 16 stops sampled from the map's
//   own table (the one the shader samples), bottom to top: stop k is entry
//   round(255 k / 15), so the first stop is entry 0 and the last entry 255.
// - Ticks come from frame/ticks.ts over the scale's domain, aiming for 5
//   intervals, labelled by formatTick; each sits at its normalised position.
// - A diverging scale marks its zero tick (`zero`), which the colorbar draws
//   as a tick of its own. Zero is a multiple of every step, so a domain
//   that contains it always has it as a tick.

import { normalise, tableEntry, TABLE_SIZE } from '../colormaps'
import { niceStep } from '../frame/nice'
import { formatTick, ticks } from '../frame/ticks'
import type { ColorScale } from '../scene/types'
import { cssRgb } from '../theme'

export const COLORBAR_STOPS = 16
export const COLORBAR_TICK_TARGET = 5

export interface ColorbarTick {
  value: number
  text: string
  // 0 at the bottom of the strip, 1 at the top.
  position: number
  // The zero of a diverging scale.
  zero: boolean
}

export interface ColorbarModel {
  title: string
  // CSS colours, bottom (t = 0) to top (t = 1).
  stops: string[]
  // The strip's background.
  gradient: string
  ticks: ColorbarTick[]
}

// Which table entry stop k of n samples.
export function stopEntry(k: number, n: number = COLORBAR_STOPS): number {
  return Math.round(((TABLE_SIZE - 1) * k) / (n - 1))
}

export function colorbarModel(scale: ColorScale, table: Uint8Array): ColorbarModel {
  const stops = Array.from({ length: COLORBAR_STOPS }, (_, k) => cssRgb(tableEntry(table, stopEntry(k))))
  const gradient = `linear-gradient(to top, ${stops.map((c, k) => `${c} ${((100 * k) / (COLORBAR_STOPS - 1)).toFixed(2)}%`).join(', ')})`
  const { domain } = scale
  const step = niceStep(domain.max - domain.min, COLORBAR_TICK_TARGET)
  const values = ticks(domain, step, 'linear')
  const out: ColorbarTick[] = values.map((value) => ({
    value,
    text: formatTick(value, null, step),
    position: normalise(value, scale) ?? 0,
    zero: scale.diverging && Math.abs(value) < step * 1e-9,
  }))
  return { title: scale.title, stops, gradient, ticks: out }
}
