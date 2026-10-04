// The theme, as the style engines see it.
//
// `ThemeSource` is everything a theme MIGHT say, now or after the theming
// overhaul: every field is optional. `ThemeInput` is what the engines get: the
// same thing with every field filled (see adapter.ts). Nothing downstream of
// the adapter reads Osmosis's theme, CSS or a Palette; it reads this.

export const GRAPH_TYPES = ['graph2d', 'table', 'figure2d', 'figure3d', 'space', 'flowchart'] as const
export type GraphType = (typeof GRAPH_TYPES)[number]

export const MEDIUM_NAMES = ['clean', 'ink', 'graphite', 'colouredPencil', 'marker', 'chalk', 'whiteboard'] as const
export type MediumName = (typeof MEDIUM_NAMES)[number]

export const BOARD_NAMES = ['blackboard', 'greenboard', 'whiteboard'] as const
export type BoardName = (typeof BOARD_NAMES)[number]

// What a medium colours: the roles a drawing is made of.
export const ROLE_KEYS = [
  'line',
  'hidden',
  'auxiliary',
  'point',
  'label',
  'measure',
  'caption',
  'givens',
  'highlight',
  'focus',
  'fill',
  'region',
  'shading',
] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

// '#rrggbb', lower case, once resolved. A source may also give '#rgb' or
// upper case; the adapter normalises it.
export type Hex = string

// The categorical colours of a resolved theme: always exactly this many.
export const SERIES_COUNT = 8

// The single colours of a theme (the series is the one list).
export const COLOUR_KEYS = ['surface', 'paper', 'ink', 'muted', 'line', 'lineStrong', 'accent', 'accentWash', 'good', 'bad'] as const
export type ColourKey = (typeof COLOUR_KEYS)[number]

// The slots of render/palette.ts's `Palette` that the adapter reads, as numbers
// (0xRRGGBB). Declared here rather than imported, because style/ imports nothing
// from render/ (determinism.test.ts enforces it). A `Palette` is assignable to
// this; adapter.test.ts checks the copies in defaults.ts against the real ones.
export interface PaletteLike {
  background: number
  curve: number
  segment: number
  point: number
  axis: number
  grid: number
  gridStrong: number
  muted: number
}

export interface ThemeColours {
  surface: Hex
  paper: Hex
  ink: Hex
  muted: Hex
  line: Hex
  lineStrong: Hex
  accent: Hex
  accentWash: Hex
  good: Hex
  bad: Hex
  // Categorical colours. Any length in a source; exactly SERIES_COUNT once resolved.
  series: Hex[]
}

export type MediumColours = Partial<Record<RoleKey, Hex>>

export interface ThemeSource {
  mode?: 'light' | 'dark'
  colours?: Partial<ThemeColours>
  boards?: Partial<Record<BoardName, Hex>>
  media?: Partial<Record<MediumName, MediumColours>>
  // The theme's style settings (all graphs, and per graph type). Task 4 types
  // this as `ThemeStyles` (style/layers.ts); the adapter only passes it through.
  styles?: unknown
  lettering?: { family?: string }
}

export interface ThemeInput {
  mode: 'light' | 'dark'
  colours: ThemeColours
  boards: Record<BoardName, Hex>
  media: Partial<Record<MediumName, MediumColours>>
  // Passed through untouched (undefined when the theme has none); Task 4 narrows it.
  styles: unknown
  lettering: { family: string | null }
  // FNV-1a hex of every resolved value above. Caches (papers, baked fills)
  // are keyed on it, so a theme change invalidates exactly what it should.
  key: string
}
