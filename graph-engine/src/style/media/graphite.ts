// Graphite pencil: greys with a hint of the role's hue. Never saturated.
//
// Fitting, in OKLCH: the chroma is the base's, held to `hint` (0.02) at most, so a
// red role comes out a warm grey and a blue one a cool grey; the lightness is
// moved away from the paper until a stroke of it, drawn at the pencil's opacity (0.85) over
// the paper, keeps 4.5:1 with it. Strokes build
// (layers darken toward a graphite maximum). The tooth skips strongly.

import { toOklch } from '../color'
import { fitLightness } from '../theme/contrast'
import { baseColour, pageNeutrals, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the paper.
const OPACITY = 0.85

const SETTINGS: readonly MediumSettingSpec[] = [
  { key: 'hint', label: 'Hue hint (chroma cap)', min: 0, max: 0.05, step: 0.005, default: 0.02 },
  { key: 'grain', label: 'Speckle', min: 0, max: 1, step: 0.05, default: 0.2 },
]

export const graphite: Medium = {
  name: 'graphite',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role, settings) {
    const base = toOklch(baseColour(theme, 'graphite', role, pageNeutrals(theme), theme.colours))
    const hint = settingOf(SETTINGS, settings, 'hint')
    return { hex: fitLightness({ ...base, c: Math.min(base.c, hint) }, theme.colours.paper, { target: 4.5, opacity: OPACITY }), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'build',
  grain: (settings) => ({ skips: 0.5, speckle: settingOf(SETTINGS, settings, 'grain'), streaks: 0, softEdge: 0 }),
}
