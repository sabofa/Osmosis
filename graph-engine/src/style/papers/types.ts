import type { Box } from '../markup'
import type { Random } from '../random'
import type { PaperSettings } from '../tokens'
import type { ThemeInput } from '../theme/types'

// The contract every paper keeps.
//
// A paper is laid behind everything a figure draws. It is given the figure's
// view box and returns SVG: DEFS (patterns and filters, once) and the
// BACKGROUND (the elements laid under the figure). The background covers at
// least three view boxes beyond the figure in every direction, so panning
// never shows an edge. Papers are SVG by nature — a pattern, a grain — and
// write their own markup (markup.ts), still importing nothing from the
// figure renderer.

export interface PaperInput {
  settings: PaperSettings
  // The paper colour, resolved (the theme's paper when the setting says
  // "theme") and saturated.
  tint: string
  view: Box
  // Names a def: ids are made unique per figure by the caller.
  id: (name: string) => string
  // Any other colour the paper uses (ruling, grid), through the style's
  // saturation.
  colour: (hex: string) => string
  random: Random
  // The theme the paper's colours come from (a board's colour, the rulings' lines), and the style's seed.
  theme: ThemeInput
  seed: number
}

export interface PaperOutput {
  defs: string[]
  background: string[]
}

export interface PaperType {
  draw(input: PaperInput): PaperOutput
}
