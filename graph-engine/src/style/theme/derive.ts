// What a theme leaves unsaid, derived in OKLCH from what it does say.
//
// Pure functions of colours. Nothing here reads a Palette, CSS or the mode of
// the app: the adapter hands in resolved colours. In particular `deriveBoards`
// takes no mode at all, which is how the boards come out identical in light
// and in dark.

import { fromOklch, toOklch } from '../color'
import { hashString } from '../random'
import { MIN_SERIES_CONTRAST, contrastRatio, fitLightness } from './contrast'
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from './defaults'
import { BOARD_NAMES, SERIES_COUNT, type BoardName, type Hex, type ThemeInput } from './types'

// The golden angle, in degrees: hue steps that never repeat and spread evenly.
export const GOLDEN_ANGLE = 137.508

// How far a board's hue goes toward the accent's, as a fraction of the angle
// (the angle itself is first limited to +-BOARD_TILT_LIMIT degrees).
export const BOARD_TILT = 0.5
const BOARD_TILT_LIMIT = 40

// Where the accent sits (nearly) opposite a board's hue, "toward" has no side:
// a degree either way flips the tilt. So the tilt fades to nothing over the last
// BOARD_OPPOSITE_FADE degrees before the opposite hue.
const BOARD_OPPOSITE_FADE = 40

// An accent with next to no chroma has no hue to speak of (a grey reads whatever
// float residue says). The tilt fades in over this chroma range, smoothly.
const BOARD_TILT_CHROMA_FROM = 0.02
const BOARD_TILT_CHROMA_TO = 0.04

// Below this accent chroma the series does not start from the accent's hue
// either: it starts from the default theme's accent hue.
const ACCENT_MIN_CHROMA = 0.02

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

// 0 below `from`, 1 above `to`, a smooth S between.
function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}

// The shortest signed angle from `from` to `to`, in degrees, in [-180, 180).
export function shortestAngle(from: number, to: number): number {
  return (((to - from + 540) % 360) + 360) % 360 - 180
}

// A colour part of the way to another, mixed in OKLab (straight lines in
// lightness, a and b: no hue detour). 0 is `from`, 1 is `to`.
export function mixOklab(from: Hex, to: Hex, amount: number): Hex {
  const lab = (hex: Hex) => {
    const { l, c, h } = toOklch(hex)
    const angle = (h * Math.PI) / 180
    return [l, c * Math.cos(angle), c * Math.sin(angle)] as const
  }
  const [l1, a1, b1] = lab(from)
  const [l2, a2, b2] = lab(to)
  const l = l1 + (l2 - l1) * amount
  const a = a1 + (a2 - a1) * amount
  const b = b1 + (b2 - b1) * amount
  return fromOklch({ l, c: Math.hypot(a, b), h: wrapHue((Math.atan2(b, a) * 180) / Math.PI) })
}

// The accent's soft tint: the accent 85% of the way to the surface.
export const ACCENT_WASH_MIX = 0.85
export function deriveAccentWash(accent: Hex, surface: Hex): Hex {
  return mixOklab(accent, surface, ACCENT_WASH_MIX)
}

export interface SeriesInput {
  accent: Hex
  surface: Hex
  mode: 'light' | 'dark'
  // The theme's good and bad. Each takes the slot whose hue is nearest (bad the
  // next nearest when good has it). A colour that already keeps 3:1 with the
  // surface takes the slot as given; one that does not has its lightness fitted
  // like every other slot (hue and chroma kept). The theme's own good and bad
  // stay as they are in its colours: only the series slot is fitted.
  good?: Hex
  bad?: Hex
}

// The eight categorical colours. Slot n has the accent's OKLCH hue plus n
// golden angles. Lightness starts at 0.55 (light) or 0.75 (dark), chroma at
// the accent's held to [0.08, 0.16], and lightness is then moved away from the
// surface until the colour keeps 3:1 contrast with it.
export function deriveSeries(input: SeriesInput): Hex[] {
  const accent = toOklch(input.accent)
  const l = input.mode === 'dark' ? 0.75 : 0.55
  const c = Math.min(0.16, Math.max(0.08, accent.c))
  // A grey accent has no hue: start from the default theme's accent instead.
  const startHue = accent.c < ACCENT_MIN_CHROMA ? toOklch((input.mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS)['--accent']).h : accent.h
  const hues = Array.from({ length: SERIES_COUNT }, (_, n) => wrapHue(startHue + n * GOLDEN_ANGLE))
  const series = hues.map((h) => fitLightness({ l, c, h }, input.surface))

  const taken = new Set<number>()
  // A bad that is the same colour as good has its slot already: skip it, so the slots stay unique.
  for (const given of input.bad === input.good ? [input.good] : [input.good, input.bad]) {
    if (given === undefined) continue
    const hue = toOklch(given).h
    let slot = -1
    let nearest = Infinity
    hues.forEach((slotHue, n) => {
      const distance = Math.abs(shortestAngle(hue, slotHue))
      if (!taken.has(n) && distance < nearest) {
        slot = n
        nearest = distance
      }
    })
    series[slot] = contrastRatio(given, input.surface) >= MIN_SERIES_CONTRAST ? given : fitLightness(toOklch(given), input.surface)
    taken.add(slot)
  }
  return series
}

// Fixed board bases, in OKLCH, with the most chroma the accent may add to each.
// Frozen, and exported for the settings registry, which reads each board's `maxChroma` as `board.<name>.chromaCap`.
type BoardBase = Readonly<{ l: number; c: number; h: number; maxChroma: number }>
export const BOARD_BASES: Readonly<Record<BoardName, BoardBase>> = Object.freeze({
  blackboard: Object.freeze({ l: 0.27, c: 0.012, h: 230, maxChroma: 0.03 }),
  greenboard: Object.freeze({ l: 0.33, c: 0.05, h: 160, maxChroma: 0.07 }),
  whiteboard: Object.freeze({ l: 0.97, c: 0.004, h: 250, maxChroma: 0.012 }),
})

// How much chroma a fully coloured accent adds, and the accent chroma that counts as fully coloured.
const BOARD_CHROMA_BOOST = 0.012
const BOARD_FULL_ACCENT_CHROMA = 0.15

// Slate, green and white boards, tilted a little toward the accent's hue (in
// hue only, chroma staying low). Depends on the accent and nothing else: no
// mode, no surface. They are the same in light and in dark.
//
// The tilt is half the (limited) angle toward the accent, faded out as the
// accent nears the board's opposite hue (where the side flips) and faded in with
// the accent's chroma (a grey has no hue). Both fades are continuous, so a
// small change of accent never makes a visible jump in a board.
export function deriveBoards(accent: Hex): Record<BoardName, Hex> {
  const { c: accentChroma, h: accentHue } = toOklch(accent)
  const boost = BOARD_CHROMA_BOOST * Math.min(1, accentChroma / BOARD_FULL_ACCENT_CHROMA)
  const hasHue = smoothstep(BOARD_TILT_CHROMA_FROM, BOARD_TILT_CHROMA_TO, accentChroma)
  const boards = {} as Record<BoardName, Hex>
  for (const name of BOARD_NAMES) {
    const base = BOARD_BASES[name]
    const angle = shortestAngle(base.h, accentHue)
    const toward = clamp(angle, -BOARD_TILT_LIMIT, BOARD_TILT_LIMIT) * BOARD_TILT
    const notOpposite = clamp((180 - Math.abs(angle)) / BOARD_OPPOSITE_FADE, 0, 1)
    const tilt = toward * notOpposite * hasHue
    boards[name] = fromOklch({ l: base.l, c: Math.min(base.maxChroma, base.c + boost), h: wrapHue(base.h + tilt) })
  }
  return boards
}

// JSON with object keys sorted and undefined left out, so two themes that say
// the same thing give the same text whatever order they said it in.
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && typeof record[key] !== 'function')
      .sort()
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}'
  }
  return 'null'
}

// The theme's identity: 32-bit FNV-1a (the engine's own hashString) over the
// canonical JSON of every resolved field, the mode and the styles included.
export function themeKey(theme: Omit<ThemeInput, 'key'>): string {
  const { mode, colours, boardColours, boards, media, styles, lettering } = theme
  return hashString(canonicalJson({ mode, colours, boardColours, boards, media, styles, lettering })).toString(16).padStart(8, '0')
}
