// WCAG 2 contrast, and fitting an OKLCH lightness to it.
//
// Relative luminance is computed from sRGB exactly as WCAG 2 defines it (the
// sRGB transfer curve, then 0.2126 R + 0.7152 G + 0.0722 B), and contrast is
// (lighter + 0.05) / (darker + 0.05). The sRGB curve's break is 0.04045 (the
// standard's own); WCAG's text says 0.03928, and no 8-bit channel falls
// between the two, so the results are identical.

import { fromOklch, toOklch, type Oklch } from '../color'
import type { Hex } from './types'

// The least contrast a series colour keeps against its surface.
export const MIN_SERIES_CONTRAST = 3

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

// '#rgb' or '#rrggbb' in any case -> '#rrggbb' lower case; anything else -> null.
export function normaliseHex(value: unknown): Hex | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!HEX_PATTERN.test(text)) return null
  const body = text.slice(1).toLowerCase()
  return '#' + (body.length === 3 ? body.replace(/./g, (c) => c + c) : body)
}

function channels(hex: Hex): [number, number, number] {
  const hex6 = normaliseHex(hex)
  if (hex6 === null) throw new Error(`not a hex colour: ${String(hex)}`)
  return [1, 3, 5].map((i) => parseInt(hex6.slice(i, i + 2), 16)) as [number, number, number]
}

export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// A colour laid over a surface at an opacity, as ONE stroke of it is drawn: each 8-bit sRGB
// channel is opacity x colour + (1 - opacity) x surface, rounded (the way a canvas or SVG
// composites a translucent stroke). Opacity 1 (or more) is the colour itself; 0 (or less) the surface.
export function blendOver(hex: Hex, surface: Hex, opacity = 1): Hex {
  const colour = channels(hex)
  const behind = channels(surface)
  const t = Math.min(1, Math.max(0, opacity))
  const mixed = colour.map((channel, i) => Math.round(t * channel + (1 - t) * behind[i]))
  return '#' + mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')
}

// The contrast of a stroke of `hex` at `opacity` against its surface, as drawn: the blended
// colour against the surface (a WCAG ratio on what is actually on the screen).
export function drawnContrast(hex: Hex, surface: Hex, opacity = 1): number {
  return contrastRatio(blendOver(hex, surface, opacity), surface)
}

export interface FitOptions {
  // The contrast to reach. Default 3:1.
  target?: number
  // The lightness step. Default 0.01. Must be greater than 0 (a RangeError otherwise).
  step?: number
  // The opacity one stroke of the colour is drawn at, above 0 and up to 1 (default 1; a RangeError
  // otherwise). The contrast is then that of the colour blended over the surface at it (see
  // `drawnContrast`), so the floor holds for what is seen, not for the solid colour. What
  // comes back is the colour itself, not the blend.
  opacity?: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

// `colour` with its OKLCH lightness moved, in steps of 0.01, AWAY from the
// surface until its WCAG contrast with the surface reaches the target. Hue and
// chroma are held (chroma is reduced only where the sRGB gamut forces it), and
// contrast is measured on the real, 8-bit hex that comes out.
//
// "Away" is the sign of (colour.l - surface.l). If that run reaches L = 0 or
// L = 1 without meeting the target, the other direction is tried before giving
// up (a start just above a light-mid surface cannot get there by going up, but
// can by going down). If neither direction meets the target, the best contrast
// seen is returned: an unreachable target never throws, and the walk always ends
// (at most about 200 steps at the default step).
export function fitLightness(colour: Oklch, surface: Hex, options: FitOptions = {}): Hex {
  const target = options.target ?? MIN_SERIES_CONTRAST
  const step = options.step ?? 0.01
  const opacity = options.opacity ?? 1
  if (!(step > 0)) throw new RangeError('fitLightness: step must be greater than 0, got ' + String(step))
  if (!(opacity > 0 && opacity <= 1)) throw new RangeError('fitLightness: opacity must be above 0 and at most 1, got ' + String(opacity))
  const start = clamp01(colour.l)
  const away = start >= toOklch(surface).l ? 1 : -1
  let best = fromOklch({ ...colour, l: start })
  let bestRatio = -Infinity
  // Both directions: a start just above a light-mid surface can only reach the target by going darker.
  for (const direction of [away, -away]) {
    // Steps to the edge of the lightness range, the last one landing on it.
    const room = direction > 0 ? 1 - start : start
    const steps = Math.ceil(room / step - 1e-9)
    for (let k = 0; k <= steps; k++) {
      const hex = fromOklch({ ...colour, l: clamp01(start + direction * k * step) })
      const ratio = drawnContrast(hex, surface, opacity)
      if (ratio >= target) return hex
      if (ratio > bestRatio) {
        best = hex
        bestRatio = ratio
      }
    }
  }
  return best
}
