// Clean: the exact theme colours, with nothing done to them.
//
// The identity medium: whatever base colour a role has (an author's own, a theme
// override, a series slot, the role's own source) comes out as it is, at full
// opacity, with nothing fitted and no grain. A figure drawn in it is the
// technical drawing it has always been.

import { baseColour, noGrain, pageNeutrals } from './fit'
import type { Medium } from './types'

export const clean: Medium = {
  name: 'clean',
  surface: 'paper',
  settings: [],
  colour: (theme, role) => ({ hex: baseColour(theme, 'clean', role, pageNeutrals(theme)), opacity: 1 }),
  surfaceColour: (theme) => theme.colours.paper,
  overlap: 'normal',
  grain: noGrain,
}
