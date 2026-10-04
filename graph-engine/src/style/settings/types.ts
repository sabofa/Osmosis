// The settings registry's vocabulary.
//
// Every setting in every graph engine is one SettingSpec: where it lives (its
// path), what its range and default are, and above all what it MEANS in the
// picture. The registry (registry.ts) assembles the specs from the engines' own
// tables (the figure styles' TOKENS, the Paint Lab's PARAM_SCHEMA and
// CURVE_SCHEMA, the media's settings and the board constants) and adds the
// prose from meanings/*.ts. The settings guide (docs/styles/GUIDE.md) is
// generated from it.

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
  // A choice's valid values.
  choices?: readonly string[]
  default: SettingValue
  unit?: string
  // What it does in the picture: said in the painter's terms (value, edge, stroke,
  // colour, roughness, grain), which direction makes it stronger, and the part of
  // its range that matters where that is not obvious.
  meaning: string
  // The other registry paths it fights or amplifies: only where the interaction is
  // real and can be seen.
  interactions: string[]
  appliesTo: { graphTypes: readonly GraphType[]; media: readonly MediumName[] | 'all' }
}

// The prose half of a spec, kept in meanings/*.ts and keyed by path. `unit` is
// there because the engines' tables do not carry one.
export interface Meaning {
  meaning: string
  interactions?: readonly string[]
  unit?: string
}

export type Meanings = Readonly<Record<string, Meaning>>
