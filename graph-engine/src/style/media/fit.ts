// What the seven media share: finding a role's base colour, reading settings,
// and fitting an OKLCH colour to a range and to a surface.
//
// Every medium does the same three things with a role, in this order:
//   1. take its BASE colour (an author's own, a theme override, a series slot,
//      or the colour the role comes from), here;
//   2. set its chroma and clamp its lightness to the medium's own range;
//   3. fit the lightness to the medium's contrast floor against its surface.
// The media differ only in the numbers of steps 2 and 3, which sit in their own
// files. Nothing here reads `theme.mode`: a medium's colours follow the theme's
// colours, never the app's light or dark switch.

import { fromOklch, toOklch, type Oklch } from '../color'
import { contrastRatio, fitLightness, normaliseHex } from '../theme/contrast'
import type { Hex, MediumName, RoleKey, ThemeInput } from '../theme/types'
import type { GrainSpec, MediumSettings, MediumSettingSpec, Role } from './types'

export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

export function noGrain(): GrainSpec {
  return { skips: 0, speckle: 0, streaks: 0, softEdge: 0 }
}

// --- Settings -------------------------------------------------------------

// A setting's value: the one given if it is a number, clamped to the spec's range;
// the spec's default if it is missing or not a number. A key the medium has no spec
// for is a mistake in the medium, not in the caller, so it throws.
export function settingOf(specs: readonly MediumSettingSpec[], settings: MediumSettings, key: string): number {
  const spec = specs.find((candidate) => candidate.key === key)
  if (spec === undefined) throw new Error(`no such setting: ${key}`)
  const value = settings[key]
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, spec.min, spec.max) : spec.default
}

export function defaultsOf(specs: readonly MediumSettingSpec[]): MediumSettings {
  return Object.fromEntries(specs.map((spec) => [spec.key, spec.default]))
}

// --- The base colour of a role ---------------------------------------------

// Where a role's colour comes from when nothing says otherwise.
type Source = 'ink' | 'muted' | 'bad' | 'accent'
const ROLE_SOURCE: Record<RoleKey, Source> = {
  line: 'ink',
  hidden: 'ink',
  label: 'ink',
  measure: 'ink',
  caption: 'ink',
  givens: 'ink',
  auxiliary: 'muted',
  point: 'bad',
  highlight: 'accent',
  focus: 'accent',
  fill: 'accent',
  region: 'accent',
  shading: 'accent',
}

// The two neutrals a role can come from: the ink of structure and the muted of
// everything secondary. A paper medium takes the theme's (the page's own ink).
// A board medium takes its own, because the page's ink flips with the mode (dark
// on a light page, light on a dark one) and a board must look the same in both.
export interface Neutrals {
  ink: Hex
  muted: Hex
}

export function pageNeutrals(theme: ThemeInput): Neutrals {
  return { ink: theme.colours.ink, muted: theme.colours.muted }
}

// The colour a role starts from, before the medium fits it:
//   1. the author's own colour (`role.colour`). One that is not a hex is ignored,
//      as if not given: the caller turns a colour name into a hex first;
//   2. else the theme's override for this medium and role (`theme.media`);
//   3. else series[slot] when `slot` is given (past the last slot it wraps);
//   4. else the role's own source: line, hidden, label, measure, caption and givens
//      take the ink; auxiliary takes muted; point takes bad; highlight, focus,
//      fill, region and shading take the accent.
export function baseColour(theme: ThemeInput, medium: MediumName, role: Role, neutrals: Neutrals): Hex {
  const own = normaliseHex(role.colour)
  if (own !== null) return own
  const override = normaliseHex(theme.media[medium]?.[role.key])
  if (override !== null) return override
  const series = theme.colours.series
  if (role.slot !== undefined && Number.isFinite(role.slot) && series.length > 0) {
    const index = ((Math.floor(role.slot) % series.length) + series.length) % series.length
    const slot = normaliseHex(series[index])
    if (slot !== null) return slot
  }
  switch (ROLE_SOURCE[role.key]) {
    case 'muted':
      return neutrals.muted
    case 'bad':
      return theme.colours.bad
    case 'accent':
      return theme.colours.accent
    default:
      return neutrals.ink
  }
}

// --- Chroma ----------------------------------------------------------------

// A colour with next to no chroma has no hue to speak of (its hue is whatever the
// rounding left). A medium that LIFTS chroma to a floor (marker, whiteboard)
// must not invent a hue for it: a near-black ink would come out olive. So the lift
// fades in with the base's own chroma, from nothing at 0.02 to the full floor at
// 0.04 (the same band the theme adapter uses for a board's tilt).
const LIFT_FROM = 0.02
const LIFT_TO = 0.04

export function liftChroma(chroma: number, floor: number): number {
  const t = clamp((chroma - LIFT_FROM) / (LIFT_TO - LIFT_FROM), 0, 1)
  return Math.max(chroma, floor * t * t * (3 - 2 * t))
}

// --- Fitting ---------------------------------------------------------------

const STEP = 0.01

// `colour` with its lightness held to [lo, hi] and its contrast with `surface` at
// `target` or better.
//
// The lightness starts at the colour's own, clamped to the range. Inside the
// range, the nearest lightness (in steps of 0.01, away from the surface first,
// then the range's own edges) that meets the target is taken. If NOTHING inside
// the range meets it, the floor wins: Task 1's `fitLightness` carries the clamped
// start away from the surface until it does (and returns the best contrast there
// is where nothing can). Hue and chroma are held throughout, the chroma reduced
// only where the sRGB gamut forces it (through `fromOklch`), and contrast is
// measured on the real 8-bit hex that comes out.
export function fitWithin(colour: Oklch, surface: Hex, target: number, lo: number, hi: number): Hex {
  const start = clamp(colour.l, lo, hi)
  const away = start >= toOklch(surface).l ? 1 : -1
  const at = (l: number): Hex | null => {
    const hex = fromOklch({ l, c: colour.c, h: colour.h })
    return contrastRatio(hex, surface) >= target ? hex : null
  }
  const steps = Math.ceil((hi - lo) / STEP - 1e-9)
  for (let k = 0; k <= steps; k++) {
    for (const direction of k === 0 ? [0] : [away, -away]) {
      const l = start + direction * k * STEP
      if (l < lo - 1e-9 || l > hi + 1e-9) continue
      const hex = at(l)
      if (hex !== null) return hex
    }
  }
  // Between the grid and the range's edge: the edge itself.
  for (const l of away > 0 ? [hi, lo] : [lo, hi]) {
    const hex = at(l)
    if (hex !== null) return hex
  }
  return fitLightness({ ...colour, l: start }, surface, { target })
}
