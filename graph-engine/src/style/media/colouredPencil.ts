// Coloured pencil: the theme colour, slightly desaturated and waxy, held a little light.
//
// Fitting, in OKLCH: the chroma is the base's x `chroma` (0.8); the lightness
// moves 0.05 TOWARD the paper (never past it: lighter on a light paper, darker on
// a dark one), which is what makes it waxy and pale beside ink; and then it is
// moved away again, as far as it needs, until a stroke of it, drawn at the pencil's opacity
// (0.8) over the paper, keeps 3:1 with it. Strokes build
// (layers deepen chroma first, then value). The tooth skips, the paper showing
// through.

import { toOklch } from '../color'
import { fitLightness } from '../theme/contrast'
import { baseColour, pageNeutrals, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'chroma', label: 'Chroma', min: 0, max: 1.2, step: 0.05, default: 0.8 }]

// How far toward the paper the lightness is held.
const HELD = 0.05

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the paper.
const OPACITY = 0.8

export const colouredPencil: Medium = {
  name: 'colouredPencil',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role, settings) {
    const base = toOklch(baseColour(theme, 'colouredPencil', role, pageNeutrals(theme), theme.colours))
    const chroma = settingOf(SETTINGS, settings, 'chroma')
    const gap = toOklch(theme.colours.paper).l - base.l
    const l = base.l + Math.sign(gap) * Math.min(HELD, Math.abs(gap))
    return { hex: fitLightness({ l, c: base.c * chroma, h: base.h }, theme.colours.paper, { target: 3, opacity: OPACITY }), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'build',
  grain: () => ({ skips: 0.45, speckle: 0, streaks: 0, softEdge: 0 }),
}
