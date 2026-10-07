import { MEDIA, type MediumSettings } from './media'
import { isPresetName, PRESETS } from './presets'
import { REGISTRY } from './settings/registry'
import type { SettingValue } from './settings/types'
import { stylePathOf } from './settings/values'
import { TYPE_DEFAULTS } from './typeDefaults'
import type { StyleLayer } from './resolve'
import type { GraphType, MediumName } from './theme/types'
import { readToken, TOKENS, type Style, type Token } from './tokens'

export { toPaintParams } from './settings/paintParams'
export { BUILTIN_THEME_STYLES } from './theme/builtinStyles'
export { TYPE_DEFAULTS } from './typeDefaults'
export type { SettingValue } from './settings/types'

// The six-layer settings stack.
//
// Every setting, from the figure styles and the Paint Lab's painter alike, resolves
// through one stack. The most specific layer wins:
//
//   1. the registry's defaults (style/settings/registry.ts);
//   2. the graph type's defaults;
//   3. the theme, for all graph types;
//   4. the theme, for this graph type;
//   5. the document;
//   6. the figure.
//
// Ben's ruling (2026-10-04): a theme's setting beats a graph type's default, so 3 and
// 4 sit above 2. A document or a figure sets any single setting with
// "@style-set: <registry path> <value>".
//
// A LAYER may start from a preset ("@style: pencil"). A preset replaces every style.*
// setting below it with that preset's look, then the layer's own settings apply on
// top, whatever order they were written in (that is today's rule). A preset is the
// figure styles' look: it never touches paint.* or media.* or board.*, and, as
// before, never the seed, so choosing a preset never rerolls.
//
// This module only combines. Reading values from text or from a host's object, and
// refusing the bad ones, is style/settings/values.ts and style/resolve.ts; a layer
// that reaches here is taken to be valid, and a path that is not a setting is skipped.

// One layer's settings: a preset, then single settings by registry path.
export interface SettingsLayer {
  preset?: string
  set?: Record<string, SettingValue>
}

// What a theme says about style, for all graph types and for each one.
export interface ThemeStyles {
  all?: SettingsLayer
  byType?: Partial<Record<GraphType, SettingsLayer>>
}

export interface StyleStack {
  // The graph types' defaults. Left out, they are the built-in ones (TYPE_DEFAULTS,
  // style/typeDefaults.ts, empty to start); given, they stand in for them, so `{}` is none.
  typeDefaults?: Partial<Record<GraphType, SettingsLayer>>
  // From ThemeInput.styles (`themeStylesOf`, style/resolve.ts).
  theme?: ThemeStyles
  document?: SettingsLayer
  figure?: SettingsLayer
}

// Every registry path, with its value.
export type ResolvedSettings = ReadonlyMap<string, SettingValue>

// Each figure-style token with its registry path.
const STYLE_TOKENS: readonly (readonly [Token, string])[] = TOKENS.map((token) => [token, stylePathOf(token)] as const)

const DEFAULTS: ReadonlyMap<string, SettingValue> = new Map(REGISTRY.map((spec) => [spec.path, spec.default]))

// The settings a preset replaces: every figure style but the seed.
const PRESET_PATHS: ReadonlySet<string> = new Set(STYLE_TOKENS.filter(([token]) => token.group !== 'seed').map(([, path]) => path))

function applyLayer(values: Map<string, SettingValue>, layer: SettingsLayer | null | undefined): void {
  if (!layer) return
  if (layer.preset !== undefined && isPresetName(layer.preset)) {
    const look = PRESETS[layer.preset]
    for (const [token, path] of STYLE_TOKENS) {
      if (PRESET_PATHS.has(path)) values.set(path, readToken(look, token) as SettingValue)
    }
  }
  for (const [path, value] of Object.entries(layer.set ?? {})) {
    if (values.has(path)) values.set(path, value)
  }
}

// Every setting of the registry for one graph type: the registry's defaults, then the six layers in
// order, each overriding only what it sets.
export function resolveSettings(stack: StyleStack, graphType: GraphType): ResolvedSettings {
  const values = new Map(DEFAULTS)
  const typeDefaults = stack.typeDefaults ?? TYPE_DEFAULTS
  for (const layer of [typeDefaults[graphType], stack.theme?.all, stack.theme?.byType?.[graphType], stack.document, stack.figure]) applyLayer(values, layer)
  return values
}

// Several layers as one, applied in order: the one layer resolves exactly as the layers would, one
// after the other. It is how a list of layers (resolveStyle's [the host's base style, the figure's])
// becomes the stack's document layer. A preset replaces the figure styles of the layers before it
// (not their seed, nor anything that is not a figure style), as in resolveSettings.
export function collapseLayers(layers: readonly (SettingsLayer | null | undefined)[]): SettingsLayer | undefined {
  let merged: SettingsLayer | undefined
  for (const layer of layers) {
    if (!layer) continue
    const preset = layer.preset !== undefined && isPresetName(layer.preset) ? layer.preset : undefined
    if (merged === undefined) {
      merged = { ...(preset !== undefined ? { preset } : {}), set: { ...layer.set } }
      continue
    }
    const before = Object.entries(merged.set ?? {}).filter(([path]) => preset === undefined || !PRESET_PATHS.has(path))
    const own = preset ?? merged.preset
    merged = { ...(own !== undefined ? { preset: own } : {}), set: { ...Object.fromEntries(before), ...layer.set } }
  }
  return merged
}

// The figure styles' Style: the style.* settings, in the order and shape resolveStyle
// has always returned them.
export function toStyle(resolved: ResolvedSettings): Style {
  const style: Record<string, Record<string, SettingValue> | SettingValue> = { line: {}, fill: {}, paper: {}, lettering: {}, colour: {}, seed: 0 }
  for (const [token, path] of STYLE_TOKENS) {
    const value = resolved.get(path) ?? DEFAULTS.get(path)!
    if (token.group === 'seed') style.seed = value
    else (style[token.group] as Record<string, SettingValue>)[token.key] = value
  }
  return style as unknown as Style
}

// The values of one medium's settings, by their short names (what Medium.colour takes).
export function mediumSettingsOf(resolved: ResolvedSettings, name: MediumName): MediumSettings {
  const out: MediumSettings = {}
  for (const setting of MEDIA[name].settings) {
    const value = resolved.get(`media.${name}.${setting.key}`)
    out[setting.key] = typeof value === 'number' ? value : setting.default
  }
  return out
}

// A figure's or a host's StyleLayer (groups of settings, as the "@style…" directives
// write them) as a settings layer: the same settings, by registry path. This is how
// the old two-layer resolve runs on the stack.
export function layerFromStyleLayer(layer: StyleLayer): SettingsLayer {
  const set: Record<string, SettingValue> = {}
  for (const [token, path] of STYLE_TOKENS) {
    const value = token.group === 'seed' ? layer.seed : (layer[token.group] as Record<string, SettingValue | undefined> | undefined)?.[token.key]
    if (value !== undefined) set[path] = value
  }
  Object.assign(set, layer.set)
  return layer.preset !== undefined ? { preset: layer.preset, set } : { set }
}
