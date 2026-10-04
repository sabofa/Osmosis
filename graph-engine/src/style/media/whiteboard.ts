// Whiteboard marker: dry-erase inks, saturated, mid to dark, fitted to the white board.
//
// Fitting, in OKLCH: the lightness is clamped to 0.35-0.55; the chroma is the
// base's, lifted to at least 0.10 (as far as the gamut allows); then the lightness
// is moved only as far as it takes for a stroke of it, drawn at the marker's opacity (0.95)
// over the board, to keep 4.5:1 with the board. A near-neutral base stays neutral (see
// `liftChroma`): a black marker for lines and labels.
// Strokes multiply, lighter than a marker's. The ink streaks, and runs dry:
// `dry` (0.3) is its `skips`, the board showing through where the marker has run out.
//
// A board looks the same in light and in dark (Ben), and so does what is drawn on
// it: nothing here reads `theme.mode` or `theme.colours`. Every role is fitted from
// `theme.boardColours`, the theme's light-mode colours (the adapter fills them in
// both modes). The roles that come from ink and muted take the board's own neutrals
// instead: a black marker for the structure, a grey one for auxiliary lines. To use
// the light mode's own ink and muted instead, replace `NEUTRALS` with
// `{ ink: theme.boardColours.ink, muted: theme.boardColours.muted }` in `colour`.

import { fromOklch, toOklch } from '../color'
import { baseColour, fitWithin, liftChroma, settingOf } from './fit'
import type { Medium, MediumSettingSpec } from './types'

const SETTINGS: readonly MediumSettingSpec[] = [{ key: 'dry', label: 'Running dry', min: 0, max: 1, step: 0.05, default: 0.3 }]

const DARKEST = 0.35
const LIGHTEST = 0.55

// The opacity of one stroke. The contrast floor is measured on a stroke at it, over the board.
const OPACITY = 0.95

const NEUTRALS = {
  ink: fromOklch({ l: DARKEST, c: 0, h: 0 }),
  muted: fromOklch({ l: LIGHTEST, c: 0, h: 0 }),
}

export const whiteboard: Medium = {
  name: 'whiteboard',
  surface: 'whiteboard',
  settings: SETTINGS,
  colour(theme, role) {
    const base = toOklch(baseColour(theme, 'whiteboard', role, NEUTRALS, theme.boardColours))
    return { hex: fitWithin({ ...base, c: liftChroma(base.c, 0.1) }, theme.boards.whiteboard, 4.5, DARKEST, LIGHTEST, OPACITY), opacity: OPACITY }
  },
  surfaceColour: (theme) => theme.boards.whiteboard,
  overlap: 'multiply',
  grain: (settings) => ({ skips: settingOf(SETTINGS, settings, 'dry'), speckle: 0, streaks: 0.35, softEdge: 0 }),
}
