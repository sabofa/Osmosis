// Marker: saturated, mid lightness; black for its lines.
//
// Fitting, in OKLCH: the lightness of a coloured role is clamped to 0.45-0.65; the chroma is the
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
// the same colour on a dark paper. The neutrals are a near-black ink on a light paper (L 0.22)
// and a near-white one on a dark paper (L 0.92), as a marker's black is: they sit OUTSIDE the
// 0.45 to 0.65 range, which holds the coloured roles only (series, accent, an author's own),
// so they are fitted with the floor alone. Strokes multiply (overlaps darken), and streak
// along the stroke.

import { toOklch } from '../color'
import { baseOf, fitWithin, liftChroma, neutralsOn, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'streaks', label: 'Streaks', min: 0, max: 1, step: 0.05, default: 0.4 }]

const LOWEST = 0.45
const HIGHEST = 0.65

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the paper.
const OPACITY = 0.9

// The marker's ink: the near-black (L 0.22) or the near-white (L 0.92), whichever is farther from
// the paper (the near-black where they tie), a neutral grey with no chroma, and its muted 0.15 nearer
// the paper (0.37 on a light paper, 0.77 on a dark one): `neutralsOn` (fit.ts).

export const marker: Medium = {
  name: 'marker',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role) {
    const { hex, neutral } = baseOf(theme, 'marker', role, neutralsOn(theme.colours.paper), theme.colours)
    const base = toOklch(hex)
    // A neutral keeps the lightness it has (the floor alone moves it); a coloured role is held to the marker's range.
    const [lo, hi] = neutral ? [0, 1] : [LOWEST, HIGHEST]
    return { hex: fitWithin({ ...base, c: liftChroma(base.c, 0.12) }, theme.colours.paper, 3, lo, hi, OPACITY), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'multiply',
  grain: (settings) => ({ skips: 0, speckle: 0, streaks: settingOf(SETTINGS, settings, 'streaks'), softEdge: 0 }),
}
