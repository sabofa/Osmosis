// Ink: deep and dense, in high contrast with the paper.
//
// Fitting, in OKLCH: the chroma is the base's x `chroma` (0.9), and the
// lightness is moved away from the paper until the colour keeps `contrast` (7:1,
// the WCAG AAA bar) with it. A colour that already does is left where it is.
// Strokes multiply (two overlapping strokes of ink are darker where they cross).
//
// The ink LINE has no grain (Ben, 2026-09-30: no speckle, pinholes or dry-brush on
// ink), so the grain here is 0 on every axis but `softEdge`: at most a soft edge
// where the ink meets rough paper.

import { toOklch } from '../color'
import { fitLightness } from '../theme/contrast'
import { baseColour, noGrain, pageNeutrals, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [
  { key: 'chroma', label: 'Chroma', min: 0, max: 1.5, step: 0.05, default: 0.9 },
  { key: 'contrast', label: 'Contrast with the paper', min: 4.5, max: 15, step: 0.5, default: 7 },
  { key: 'edge', label: 'Soft edge', min: 0, max: 0.5, step: 0.01, default: 0.15 },
]

export const ink: Medium = {
  name: 'ink',
  surface: 'paper',
  settings: SETTINGS,
  colour(theme, role, settings) {
    const base = toOklch(baseColour(theme, 'ink', role, pageNeutrals(theme), theme.colours))
    const chroma = settingOf(SETTINGS, settings, 'chroma')
    const contrast = settingOf(SETTINGS, settings, 'contrast')
    return { hex: fitLightness({ ...base, c: base.c * chroma }, theme.colours.paper, { target: contrast }), opacity: 1 }
  },
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'multiply',
  grain: (settings) => ({ ...noGrain(), softEdge: settingOf(SETTINGS, settings, 'edge') }),
}
