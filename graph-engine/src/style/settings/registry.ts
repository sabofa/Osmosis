// The settings registry: every setting in every graph engine, once.
//
// The table is ASSEMBLED from the engines' own tables and never copied from them:
//   style.<group>.<key>    each TOKENS entry (style/tokens.ts), with its range and
//                          choices read from the token and its default from the clean
//                          preset (a style starts as clean, with seed 0);
//   paint.<path>           each PARAM_SCHEMA and CURVE_SCHEMA entry (space/paint/params.ts),
//                          with its default read from DEFAULT_PAINT_PARAMS, and the few painter
//                          settings that have no slider (EXTRA_PAINT_SETTINGS below);
//   media.<name>.<key>     each setting of each medium (style/media/);
//   board.tilt, board.<name>.chromaCap
//                          the constants that derive the boards (style/theme/derive.ts).
// A setting added to any of those tables joins the registry on its own; what it MEANS is
// then the one thing missing, and registry.test.ts fails until it is written in meanings/.
//
// The prose, `meaning` and `interactions`, lives in meanings/*.ts, keyed by path. It is what
// the settings guide (docs/styles/GUIDE.md) is generated from.

import { CURVE_SCHEMA, DEFAULT_PAINT_PARAMS, PARAM_SCHEMA, getParam } from '../../space/paint/params'
import { MEDIA } from '../media'
import { PRESETS } from '../presets'
import { BOARD_BASES, BOARD_TILT } from '../theme/derive'
import { BOARD_NAMES, GRAPH_TYPES, MEDIUM_NAMES, type GraphType, type MediumName } from '../theme/types'
import { readToken, TOKENS, type Token } from '../tokens'
import { BOARD_MEANINGS } from './meanings/boards'
import { MEDIA_MEANINGS } from './meanings/media'
import { PAINT_MEANINGS } from './meanings/paint'
import { STYLE_MEANINGS } from './meanings/style'
import type { Meaning, SettingSpec } from './types'

export type { Meaning, SettingKind, SettingSpec, SettingValue } from './types'

// Where the settings of each engine apply.
//   The figure styles belong to the two figure types. The generic groups (paper, colour,
//   lettering, the seed) also apply to the other types that draw: the 2D graph, the table and
//   the space engine. The flowchart type is reserved and has no defaults yet.
const FIGURES: readonly GraphType[] = ['figure2d', 'figure3d']
const DRAWN: readonly GraphType[] = GRAPH_TYPES.filter((type) => type !== 'flowchart')
const GENERIC_GROUPS: readonly Token['group'][] = ['paper', 'lettering', 'colour', 'seed']

// Each spec gets its own copies of the lists, so freezing one never freezes another module's constant.
const applies = (graphTypes: readonly GraphType[], media: readonly MediumName[] | 'all'): SettingSpec['appliesTo'] => ({
  graphTypes: [...graphTypes],
  media: media === 'all' ? 'all' : [...media],
})

const MEANINGS: ReadonlyMap<string, Meaning> = new Map(
  [STYLE_MEANINGS, PAINT_MEANINGS, MEDIA_MEANINGS, BOARD_MEANINGS].flatMap((table) => Object.entries(table))
)

// A spec's prose half. A missing meaning is empty and not an error: registry.test.ts is what
// refuses it, so a setting added elsewhere never breaks the engines that import this table.
function prose(path: string): Pick<SettingSpec, 'meaning' | 'interactions' | 'unit'> {
  const found = MEANINGS.get(path)
  return {
    meaning: found?.meaning ?? '',
    interactions: [...(found?.interactions ?? [])],
    ...(found?.unit !== undefined ? { unit: found.unit } : {}),
  }
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// ---------------------------------------------------------------------------
// style.*
// ---------------------------------------------------------------------------

function styleSpec(token: Token): SettingSpec {
  const path = token.group === 'seed' ? 'style.seed' : `style.${token.group}.${token.key}`
  const appliesTo = applies(GENERIC_GROUPS.includes(token.group) ? DRAWN : FIGURES, 'all')
  const base = { path, label: token.label, group: token.group === 'seed' ? 'General' : capitalised(token.group), ...prose(path), appliesTo }
  // A style starts as clean (resolveStyle) with seed 0, so that is every token's default.
  const initial = token.group === 'seed' ? 0 : readToken(PRESETS.clean, token)
  switch (token.kind) {
    case 'number':
      return { ...base, type: 'number', min: token.min, max: token.max, step: token.step, default: initial as number }
    case 'choice':
      return { ...base, type: 'choice', choices: [...token.choices], default: initial as string }
    case 'colour':
      return { ...base, type: 'colour', default: initial as string }
  }
}

// ---------------------------------------------------------------------------
// paint.*
// ---------------------------------------------------------------------------

// The painter's settings that the Paint Lab has no slider for. They are in PaintParams and the painter reads
// them, but PARAM_SCHEMA does not list them (and gains no slider for them): they are named here, so that no
// setting of the painter is missing from the registry. registry.test.ts walks every leaf of
// DEFAULT_PAINT_PARAMS to hold that. Their defaults are read from the defaults like the others; the range and
// the choices have no other home, so they are written here.
export interface ExtraPaintSetting {
  path: string
  label: string
  group: string
  choices?: readonly string[]
  min?: number
  max?: number
  step?: number
}
export const EXTRA_PAINT_SETTINGS: readonly ExtraPaintSetting[] = Object.freeze([
  // PaintParams.canvas.weave is typed 'duck' | 'linen', and there is no list of them to read.
  { path: 'canvas.weave', label: 'Canvas weave', group: 'Impasto & canvas', choices: ['duck', 'linen'] },
  // The share of the strokes a frame made while the camera is dragged draws.
  { path: 'particles.dragDensity', label: 'Share of strokes while dragging', group: 'Particles', min: 0, max: 1, step: 0.01 },
])

function paintSpecs(): SettingSpec[] {
  const sliders = PARAM_SCHEMA.map((schema): SettingSpec => {
    const path = `paint.${schema.path}`
    return {
      path,
      label: schema.label,
      group: schema.group,
      type: 'number',
      min: schema.min,
      max: schema.max,
      step: schema.step,
      default: getParam(DEFAULT_PAINT_PARAMS, schema.path),
      ...prose(path),
      appliesTo: applies(['space'], 'all'),
    }
  })
  const curves = CURVE_SCHEMA.map((schema): SettingSpec => {
    const path = `paint.${schema.path}`
    // getParam walks any dotted path and is typed for numbers: a curve's points come back as they are.
    const points = getParam(DEFAULT_PAINT_PARAMS, schema.path) as unknown as number[][]
    return {
      path,
      label: schema.label,
      group: schema.group,
      type: 'curve',
      // For a curve, the range is the y axis the editor allows.
      min: schema.yMin,
      max: schema.yMax,
      default: points.map(([x, y]) => [x, y]),
      ...prose(path),
      appliesTo: applies(['space'], 'all'),
    }
  })
  const extras = EXTRA_PAINT_SETTINGS.map((extra): SettingSpec => {
    const path = `paint.${extra.path}`
    const initial = getParam(DEFAULT_PAINT_PARAMS, extra.path) as unknown as string | number
    const base = { path, label: extra.label, group: extra.group, ...prose(path), appliesTo: applies(['space'], 'all') }
    return extra.choices !== undefined
      ? { ...base, type: 'choice', choices: [...extra.choices], default: initial }
      : { ...base, type: 'number', min: extra.min, max: extra.max, step: extra.step, default: initial }
  })
  return [...sliders, ...curves, ...extras]
}

// ---------------------------------------------------------------------------
// media.*
// ---------------------------------------------------------------------------

function mediaSpecs(): SettingSpec[] {
  return MEDIUM_NAMES.flatMap((name) =>
    MEDIA[name].settings.map((setting): SettingSpec => {
      const path = `media.${name}.${setting.key}`
      return {
        path,
        label: setting.label,
        group: name,
        type: 'number',
        min: setting.min,
        max: setting.max,
        step: setting.step,
        default: setting.default,
        ...prose(path),
        appliesTo: applies(GRAPH_TYPES, [name]),
      }
    })
  )
}

// ---------------------------------------------------------------------------
// board.*
// ---------------------------------------------------------------------------

// The media that draw on each board: chalk on the blackboard (and the greenboard, which is
// another surface for the same chalk), the whiteboard marker on the whiteboard.
const BOARD_MEDIA: Record<(typeof BOARD_NAMES)[number], readonly MediumName[]> = {
  blackboard: ['chalk'],
  greenboard: ['chalk'],
  whiteboard: ['whiteboard'],
}

function boardSpecs(): SettingSpec[] {
  const tilt: SettingSpec = {
    path: 'board.tilt',
    label: 'Tilt toward the accent',
    group: 'Boards',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: BOARD_TILT,
    ...prose('board.tilt'),
    appliesTo: applies(GRAPH_TYPES, ['chalk', 'whiteboard']),
  }
  const caps = BOARD_NAMES.map((name): SettingSpec => {
    const path = `board.${name}.chromaCap`
    return {
      path,
      label: `${capitalised(name)} chroma cap`,
      group: 'Boards',
      type: 'number',
      min: 0,
      max: 0.12,
      step: 0.001,
      default: BOARD_BASES[name].maxChroma,
      ...prose(path),
      appliesTo: applies(GRAPH_TYPES, BOARD_MEDIA[name]),
    }
  })
  return [tilt, ...caps]
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

// Interactions run both ways: when a setting names another, the other names it back. The meanings
// write each pair once, and this adds the reverse link, so the guide never shows a one-way pair. A name
// that is not a setting is left as it is (registry.test.ts refuses it).
function linked(specs: SettingSpec[]): SettingSpec[] {
  const byPath = new Map(specs.map((spec) => [spec.path, spec]))
  for (const spec of specs) {
    for (const other of [...spec.interactions]) {
      const target = byPath.get(other)
      if (target !== undefined && !target.interactions.includes(spec.path)) target.interactions.push(spec.path)
    }
  }
  return specs
}

// A spec nobody can edit: the registry is shared by every engine and the guide.
function frozen(spec: SettingSpec): SettingSpec {
  Object.freeze(spec.interactions)
  Object.freeze(spec.appliesTo.graphTypes)
  if (Array.isArray(spec.appliesTo.media)) Object.freeze(spec.appliesTo.media)
  Object.freeze(spec.appliesTo)
  if (spec.choices !== undefined) Object.freeze(spec.choices)
  if (spec.type === 'curve') {
    for (const point of spec.default as number[][]) Object.freeze(point)
    Object.freeze(spec.default)
  }
  return Object.freeze(spec)
}

export const REGISTRY: readonly SettingSpec[] = Object.freeze(linked([...TOKENS.map(styleSpec), ...paintSpecs(), ...mediaSpecs(), ...boardSpecs()]).map(frozen))

const BY_PATH: ReadonlyMap<string, SettingSpec> = new Map(REGISTRY.map((spec) => [spec.path, spec]))

// The setting at a path, or undefined. A path names one setting: a group such as `paint.value` is not one.
export function settingAt(path: string): SettingSpec | undefined {
  return BY_PATH.get(path)
}
