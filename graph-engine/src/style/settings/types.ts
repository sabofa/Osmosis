// The settings registry's vocabulary.
//
// Every setting in every graph engine is one SettingSpec: where it lives (its
// path), what its range and default are, and which graph types and media it
// applies to. The registry (registry.ts) assembles the specs from the engines' own
// tables (the figure styles' TOKENS, the Paint Lab's PARAM_SCHEMA and
// CURVE_SCHEMA, the media's settings and the board constants). That is the TABLE,
// and it is all a renderer needs.
//
// What each setting MEANS in the picture, and which others it fights or amplifies,
// is the prose, in meanings/*.ts. It is large (about 86 KB minified) and only the
// settings guide (docs/styles/GUIDE.md), the Style Lab and the tests read it, so it
// is joined to the table in settings/guide.ts as a GuideEntry, and the registry
// never imports it: a renderer that reads the registry does not carry the prose.

import type { GraphType, MediumName } from '../theme/types'

// A setting's value: a number, a choice or a colour as text, or a curve's
// control points ([x, y] pairs, x ascending over 0..1).
export type SettingValue = number | string | number[][]

export type SettingKind = 'number' | 'choice' | 'colour' | 'curve'

export interface SettingSpec {
  // 'style.line.looseness', 'paint.value.terminatorSoftness', 'media.chalk.chroma', 'board.tilt'.
  path: string
  label: string
  group: string
  type: SettingKind
  // A number's range and step. For a curve, `min` and `max` are the range of its y axis.
  min?: number
  max?: number
  step?: number
  // A number that is whole by what it counts (a seed, a switch, a number of bristles), not
  // by its slider's step: a value that is not whole is refused, not rounded (values.ts).
  // A degree or a pixel on a slider that moves by 1 is not whole in this sense.
  integer?: boolean
  // A choice's valid values.
  choices?: readonly string[]
  default: SettingValue
  // What a number counts ('px', '°', '×'), where it counts something.
  unit?: string
  appliesTo: { graphTypes: readonly GraphType[]; media: readonly MediumName[] | 'all' }
}

// A setting with its prose: what the guide, the lab and the tests read (guide.ts).
export interface GuideEntry extends SettingSpec {
  // What it does in the picture: said in the painter's terms (value, edge, stroke,
  // colour, roughness, grain), which direction makes it stronger, and the part of
  // its range that matters where that is not obvious.
  meaning: string
  // The other registry paths it fights or amplifies: only where the interaction is
  // real and can be seen. Always both ways: when one names another, the other names it back.
  interactions: readonly string[]
}

// The prose half of a spec, kept in meanings/*.ts and keyed by path.
export interface Meaning {
  meaning: string
  interactions?: readonly string[]
}

export type Meanings = Readonly<Record<string, Meaning>>
