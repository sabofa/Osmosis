// The style model's vocabulary: what a style is made of, and the range of
// every setting.
//
// A STYLE is five groups of settings — line, fill, paper, lettering, colour —
// plus a seed that rerolls every random choice. A PRESET (presets.ts) is a
// named, complete set of values for the five groups.
//
// This module is renderer-independent on purpose: it knows nothing about
// figures, SVG layers or three.js, so the graphing engine can adopt the same
// model later. Everything below is data. The one table that matters most is
// TOKENS: it is what validates a directive, what names the valid values in a
// refusal, what writes a style back out as directives, and what the style lab
// builds its controls from — one list, so the four can never disagree.

import { colorByName } from './colorNames'
import { MEDIUM_NAMES, type MediumName } from './theme/types'

// A point in drawing coordinates. Structurally the same as the engine's Vec2,
// declared here so this module imports nothing from the rest of the engine.
export interface Point {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

// Six line types, each its own algorithm in lines/ — not one sketchy line
// with different numbers.
export const LINE_TYPES = ['technical', 'ink', 'brush', 'pencil', 'marker', 'chalk'] as const
export type LineType = (typeof LINE_TYPES)[number]

export const FILL_TYPES = ['flat', 'hatch', 'crosshatch', 'stipple', 'scribble', 'wash', 'none'] as const
export type FillType = (typeof FILL_TYPES)[number]

// The three boards are papers too: the surface a chalk or whiteboard look is drawn on. Until the
// generated backgrounds arrive they are a flat sheet of the board's colour (papers/index.ts).
export const PAPER_TYPES = ['none', 'clean', 'paper', 'rough-paper', 'canvas', 'graph', 'rough-graph', 'dotted', 'ruled', 'blackboard', 'greenboard', 'whiteboard'] as const
export type PaperType = (typeof PAPER_TYPES)[number]

export const LETTERING_FACES = ['math', 'textbook', 'hand'] as const
export type LetteringFace = (typeof LETTERING_FACES)[number]

// A colour setting is "#rrggbb", or "theme": the viewer's own theme colour
// for that role (the ink of the palette, the paper of the palette).
export const THEME_COLOUR = 'theme'

// ---------------------------------------------------------------------------
// The groups
// ---------------------------------------------------------------------------

export interface LineSettings {
  type: LineType
  // 0 to 1: how far a stroke may stray from the true geometry — endpoint
  // offset, overshoot, bowing. At 0 every stroke starts and ends exactly on
  // its true endpoints.
  looseness: number
  // 0 to 1: small, fast waviness along the stroke.
  wobble: number
  // 1 to 3: how many times a stroke is drawn over itself.
  passes: number
  // A multiplier on the renderer's own stroke weights.
  width: number
  // 0 to 1: how much the width swells and thins along a stroke (pressure).
  variation: number
  // 0 to 1: how much the ends thin out.
  taper: number
  // 0 to 1: texture broken into the stroke (graphite, chalk dust).
  grain: number
  opacity: number
}

export interface FillSettings {
  type: FillType
  // Hatch direction, in degrees, anticlockwise from the page's horizontal.
  angle: number
  // Gap between hatch lines or stipple dots, in drawing units (a figure's
  // geometry is fitted into 640 of them).
  spacing: number
  opacity: number
  // 0 to 1: how far a fill's marks may stray from perfect placement — a
  // hatch line off its spot or angle, a scribble's uneven turns, stipple
  // clumping, a flat tint off register. At 0 every fill draws exactly as
  // before roughness existed, byte for byte; roughness only adds
  // imperfection on top.
  roughness: number
}

export interface PaperSettings {
  type: PaperType
  tint: string
  // 0 to 1: grain or weave strength.
  texture: number
  // Grid, dot or ruling spacing, in drawing units.
  grid: number
}

export interface LetteringSettings {
  face: LetteringFace
  size: number
  // 0 to 1: a slight seeded rotation, a few degrees at most (lettering.ts).
  tilt: number
}

export interface ColourSettings {
  ink: string
  // 0 to 1.5: muted to vivid, through OKLCH chroma (color.ts). 1 is the
  // identity.
  saturation: number
  // The colouring engine every colour of the figure goes through (style/media/): clean draws the
  // exact theme colours, as a figure always has; every other medium fits each role's colour (a
  // line, a label, a point, a fill, an author's own "color:") to its own range and to its surface.
  medium: MediumName
}

export interface Look {
  line: LineSettings
  fill: FillSettings
  paper: PaperSettings
  lettering: LetteringSettings
  colour: ColourSettings
}

// A resolved style: a complete look plus the seed.
export interface Style extends Look {
  seed: number
}

export type StyleGroup = keyof Look

// ---------------------------------------------------------------------------
// TOKENS — every setting, its directive and its range
// ---------------------------------------------------------------------------

interface TokenBase {
  group: StyleGroup | 'seed'
  key: string
  // The canonical directive, without the "@style-" prefix. Short where the
  // setting name is unambiguous across groups ("looseness"), group-prefixed
  // where it is not ("line-opacity" and "fill-opacity"), and the bare group
  // name for the group's kind ("line: brush").
  directive: string
  // Every other spelling the parser accepts.
  aliases: readonly string[]
  // What the style lab calls it.
  label: string
}

export type Token =
  | (TokenBase & { kind: 'choice'; choices: readonly string[] })
  | (TokenBase & { kind: 'number'; min: number; max: number; step: number; integer?: boolean })
  | (TokenBase & { kind: 'colour' })

const choice = (group: StyleGroup, key: string, directive: string, choices: readonly string[], label: string, aliases: readonly string[] = []): Token => ({
  group,
  key,
  directive,
  aliases: [`${group}-${key}`, ...aliases],
  label,
  kind: 'choice',
  choices,
})

const number = (
  group: StyleGroup | 'seed',
  key: string,
  directive: string,
  min: number,
  max: number,
  step: number,
  label: string,
  aliases: readonly string[] = [],
  integer = false
): Token => ({
  group,
  key,
  directive,
  aliases: group === 'seed' ? aliases : [`${group}-${key}`, ...aliases],
  label,
  kind: 'number',
  min,
  max,
  step,
  ...(integer ? { integer: true } : {}),
})

const colour = (group: StyleGroup, key: string, directive: string, label: string, aliases: readonly string[] = []): Token => ({
  group,
  key,
  directive,
  aliases: [`${group}-${key}`, ...aliases],
  label,
  kind: 'colour',
})

export const TOKENS: readonly Token[] = [
  choice('line', 'type', 'line', LINE_TYPES, 'Line'),
  number('line', 'looseness', 'looseness', 0, 1, 0.01, 'Looseness'),
  number('line', 'wobble', 'wobble', 0, 1, 0.01, 'Wobble'),
  number('line', 'passes', 'passes', 1, 3, 1, 'Passes', [], true),
  number('line', 'width', 'line-width', 0.25, 4, 0.05, 'Width', ['width']),
  number('line', 'variation', 'variation', 0, 1, 0.01, 'Variation'),
  number('line', 'taper', 'taper', 0, 1, 0.01, 'Taper'),
  number('line', 'grain', 'grain', 0, 1, 0.01, 'Grain'),
  number('line', 'opacity', 'line-opacity', 0.05, 1, 0.01, 'Opacity'),

  choice('fill', 'type', 'fill', FILL_TYPES, 'Fill'),
  number('fill', 'angle', 'fill-angle', -180, 180, 1, 'Angle', ['angle']),
  number('fill', 'spacing', 'fill-spacing', 3, 40, 0.5, 'Spacing', ['spacing']),
  number('fill', 'opacity', 'fill-opacity', 0, 1, 0.01, 'Opacity'),
  number('fill', 'roughness', 'fill-roughness', 0, 1, 0.01, 'Roughness', ['roughness']),

  choice('paper', 'type', 'paper', PAPER_TYPES, 'Paper'),
  colour('paper', 'tint', 'tint', 'Tint'),
  number('paper', 'texture', 'texture', 0, 1, 0.01, 'Texture'),
  number('paper', 'grid', 'grid', 6, 80, 1, 'Grid'),

  choice('lettering', 'face', 'lettering', LETTERING_FACES, 'Lettering'),
  number('lettering', 'size', 'lettering-size', 0.6, 1.6, 0.05, 'Size', ['size']),
  number('lettering', 'tilt', 'tilt', 0, 1, 0.01, 'Tilt'),

  colour('colour', 'ink', 'ink', 'Ink', ['color-ink']),
  number('colour', 'saturation', 'saturation', 0, 1.5, 0.01, 'Saturation', ['color-saturation']),
  choice('colour', 'medium', 'medium', MEDIUM_NAMES, 'Medium', ['color-medium']),

  number('seed', 'seed', 'seed', 0, 9999, 1, 'Seed', [], true),
]

// A token's value in a style (or a preset, which is a style without a seed).
export function readToken(style: Look | Style, token: Token): string | number | undefined {
  if (token.group === 'seed') return 'seed' in style ? style.seed : undefined
  return (style[token.group] as unknown as Record<string, string | number>)[token.key]
}

// A colour setting's value, normalised: "theme", or "#rrggbb" in lower case.
// Accepts the shared colour names (colorNames.ts), "#rrggbb" and the same six
// digits without the "#" — which a spec needs, because "#" starts a comment
// there. Six digits only, exactly as a statement's "color:" (parser/colors.ts).
export function parseColourSetting(value: string): string | null {
  const text = value.trim().toLowerCase()
  if (text === THEME_COLOUR) return THEME_COLOUR
  const named = colorByName(text)
  if (named !== null) return `#${named.toString(16).padStart(6, '0')}`
  const hex = text.startsWith('#') ? text.slice(1) : text
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`
  return null
}
