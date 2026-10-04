// Marker: saturated, mid lightness.
//
// Fitting, in OKLCH: the lightness is clamped to 0.45-0.65; the chroma is the
// base's, lifted to at least 0.12 (as far as the sRGB gamut allows at that
// lightness and hue); then the lightness is moved only as far as it takes to keep
// 3:1 with the paper, for a stroke at the marker's opacity (as drawn). On a paper
// too mid-toned for a mid-lightness marker to keep 3:1, the floor wins and the
// lightness leaves the range (see `fitWithin`).
//
// A near-neutral base stays neutral: the lift fades in with the base's chroma (see
// `liftChroma`), so the marker's lines are a black marker, not an olive one.
//
// The roles that come from ink and muted take the marker's own neutrals, as the
// boards' media do (see `neutrals`). The theme's ink and muted are far outside a
// marker's range in opposite directions (ink and muted of a dark theme are both
// light, and both clamp to the top of the range), which made lines and auxiliary lines
// the same colour on a dark paper. Strokes multiply (overlaps darken), and streak along
// the stroke.

import { fromOklch, toOklch } from '../color'
import type { ThemeInput } from '../theme/types'
import { baseColour, fitWithin, liftChroma, settingOf, type Neutrals } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'streaks', label: 'Streaks', min: 0, max: 1, step: 0.05, default: 0.4 }]

const LOWEST = 0.45
const HIGHEST = 0.65

// How much nearer the paper the muted marker sits than the ink one.
const MUTED_STEP = 0.1

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the paper.
const OPACITY = 0.9

// The marker's ink: the end of its lightness range farthest from the paper (the darkest on
// a light paper, the lightest on a dark one; the darkest where they tie), a neutral grey.
// Its muted: 0.10 nearer the paper than that (on the default dark paper it still keeps 3:1).
function neutrals(theme: ThemeInput): Neutrals {
  const paper = toOklch(theme.colours.paper).l
  const ink = Math.abs(LOWEST - paper) >= Math.abs(HIGHEST - paper) ? LOWEST : HIGHEST
  const muted = ink + Math.sign(paper - ink) * MUTED_STEP
  return { ink: fromOklch({ l: ink, c: 0, h: 0 }), muted: fromOklch({ l: muted, c: 0, h: 0 }) }
}

export const marker: Medium = {
  name: 'marker',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role) {
    const base = toOklch(baseColour(theme, 'marker', role, neutrals(theme), theme.colours))
    return { hex: fitWithin({ ...base, c: liftChroma(base.c, 0.12) }, theme.colours.paper, 3, LOWEST, HIGHEST, OPACITY), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'multiply',
  grain: (settings) => ({ skips: 0, speckle: 0, streaks: settingOf(SETTINGS, settings, 'streaks'), softEdge: 0 }),
}
