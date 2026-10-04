// The contract of a medium: a colouring engine.
//
// A medium decides how colour behaves in it. Given the resolved theme and a
// role (a line, a label, a point, series slot n, an author's own colour), it
// returns that medium's colour: fitted to the medium's own range of lightness
// and chroma, and to its surface (the paper, or its board). It also says how
// two strokes of it combine (`overlap`) and how it meets the paper's tooth
// (`grain`). Both are DATA here: nothing in this module draws anything.
//
// A medium is always given a ThemeInput. There is no "no theme": a caller that
// has none passes `defaultTheme(mode)` (style/theme/adapter.ts).

import type { Hex, MediumName, RoleKey, ThemeInput } from '../theme/types'

// What is being coloured. `slot` is a series index (the n-th categorical
// colour; past the last it wraps). `colour` is the author's own colour
// (`color: red`): it is a base colour like any other, and is fitted too.
export interface Role {
  key: RoleKey
  slot?: number
  colour?: Hex
}

// A medium's colour, and the opacity of ONE stroke of it (0 to 1).
export interface MediumColour {
  hex: Hex
  opacity: number
}

// How two strokes of a medium combine:
//   normal    the top stroke covers the one under it.
//   multiply  overlaps darken (ink, marker, whiteboard marker).
//   build     layers deepen toward a maximum (graphite, coloured pencil).
//   lighten   overlaps brighten, never darken (chalk).
export type Overlap = 'normal' | 'multiply' | 'build' | 'lighten'

// How a medium meets the paper's tooth, each 0 to 1:
//   skips     the tooth shows through the stroke, as gaps.
//   speckle   dusty grains at the stroke's edges and inside it.
//   streaks   lines of lighter and darker along the stroke.
//   softEdge  how far the edge of a stroke is softened where it meets rough paper.
export interface GrainSpec {
  skips: number
  speckle: number
  streaks: number
  softEdge: number
}

// The values of a medium's settings, keyed by the setting's short name.
// A key that is missing takes its default; one out of range is clamped.
export type MediumSettings = Record<string, number>

export interface MediumSettingSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface Medium {
  name: MediumName
  // The surface the medium is fitted to. A board medium brings its own.
  surface: 'paper' | 'blackboard' | 'greenboard' | 'whiteboard'
  settings: readonly MediumSettingSpec[]
  colour(theme: ThemeInput, role: Role, settings: MediumSettings): MediumColour
  // The colour the medium is fitted against: `theme.colours.paper` for a paper
  // medium, the medium's board in `theme.boards` for a board medium.
  surfaceColour(theme: ThemeInput): Hex
  overlap: Overlap
  grain(settings: MediumSettings): GrainSpec
}
