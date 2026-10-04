// Chalk, on the blackboard: pastel and light.
//
// Fitting, in OKLCH: the lightness is clamped to 0.80-0.95 and the chroma is the
// base's x `chroma` (0.6, 0.5-0.7), so every colour comes out as a light, dusty
// version of itself: `color: red` is a pastel chalk red (light, dusty, still red),
// whoever wrote it. Then the lightness is moved only as far as it takes for a stroke of it,
// drawn at the chalk's opacity (0.9) over the board, to keep 4.5:1 with the board.
// Strokes lighten (overlaps brighten, never darken). The chalk skips on the tooth and speckles.
//
// A board looks the same in light and in dark (Ben), and so does what is drawn on
// it, coloured chalk included: nothing here reads `theme.mode` or `theme.colours`.
// Every role is fitted from `theme.boardColours`, the theme's light-mode colours
// (the adapter fills them in both modes). The roles that come from ink and muted
// (dark on a light page) take the board's own neutrals instead: the whitest chalk
// for lines, labels and the rest of the structure, a step dimmer for auxiliary
// lines. To use the light mode's own ink and muted instead, replace `NEUTRALS` with
// `{ ink: theme.boardColours.ink, muted: theme.boardColours.muted }` in `colour`.
//
// The board is the blackboard. The greenboard is another surface for the same chalk
// (a later task picks it); the chalk keeps 4.5:1 against it too, since it is
// only a little lighter.

import { fromOklch, toOklch } from '../color'
import { baseColour, fitWithin, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'chroma', label: 'Chroma', min: 0.5, max: 0.7, step: 0.05, default: 0.6 }]

const LIGHTEST = 0.95
const DIMMEST = 0.8

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the board.
const OPACITY = 0.9

const NEUTRALS = {
  ink: fromOklch({ l: LIGHTEST, c: 0, h: 0 }),
  muted: fromOklch({ l: DIMMEST, c: 0, h: 0 }),
}

export const chalk: Medium = {
  name: 'chalk',
  surface: 'blackboard',
  settings: SETTINGS,
  colour(theme, role, settings) {
    const base = toOklch(baseColour(theme, 'chalk', role, NEUTRALS, theme.boardColours))
    const chroma = settingOf(SETTINGS, settings, 'chroma')
    return { hex: fitWithin({ ...base, c: base.c * chroma }, theme.boards.blackboard, 4.5, DIMMEST, LIGHTEST, OPACITY), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.boards.blackboard,
  overlap: 'lighten',
  grain: () => ({ skips: 0.4, speckle: 0.6, streaks: 0, softEdge: 0 }),
}
