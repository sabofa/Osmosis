// Marker: saturated, mid lightness.
//
// Fitting, in OKLCH: the lightness is clamped to 0.45-0.65; the chroma is the
// base's, lifted to at least 0.12 (as far as the sRGB gamut allows at that
// lightness and hue); then the lightness is moved only as far as it takes to keep
// 3:1 with the paper. On a paper too mid-toned for a mid-lightness marker to keep
// 3:1, the floor wins and the lightness leaves the range (see `fitWithin`).
//
// A near-neutral base (a black ink) stays neutral: the lift fades in with the
// base's chroma (see `liftChroma`), so the marker's lines are a black marker, not
// an olive one. Strokes multiply (overlaps darken), and streak along the stroke.

import { toOklch } from '../color'
import { baseColour, fitWithin, liftChroma, pageNeutrals, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'streaks', label: 'Streaks', min: 0, max: 1, step: 0.05, default: 0.4 }]

export const marker: Medium = {
  name: 'marker',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role) {
    const base = toOklch(baseColour(theme, 'marker', role, pageNeutrals(theme), theme.colours))
    return { hex: fitWithin({ ...base, c: liftChroma(base.c, 0.12) }, theme.colours.paper, 3, 0.45, 0.65), opacity: 0.9 }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'multiply',
  grain: (settings) => ({ skips: 0, speckle: 0, streaks: settingOf(SETTINGS, settings, 'streaks'), softEdge: 0 }),
}
