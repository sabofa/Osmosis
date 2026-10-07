import { layerFromStyleLayer, resolveLayers, toStyle, type SettingsLayer, type ThemeStyles } from './layers'
import { isPresetName, PRESET_NAMES, PRESETS, type PresetName } from './presets'
import type { SettingSpec, SettingValue } from './settings/types'
import { findSetting, noSuchSetting, parseTokenValue, readSettingValue, tokenAt } from './settings/values'
import { GRAPH_TYPES } from './theme/types'
import {
  readToken,
  TOKENS,
  type ColourSettings,
  type FillSettings,
  type LetteringSettings,
  type LineSettings,
  type PaperSettings,
  type Style,
  type Token,
} from './tokens'

// Where a style comes from, and how the layers combine.
//
// Every setting resolves through the six-layer stack in layers.ts: the registry's
// defaults, the graph type's, the theme's, the theme's for this graph type, the
// document's, the figure's — each overriding only what it sets. The figure styles
// are the stack's style.* settings, and this module is where they are written and
// checked:
//   - a figure's own "@style…" directives write a StyleLayer (applyStyleDirective);
//   - "@style-set: <registry path> <value>" sets any single setting, from the
//     figure styles to the Paint Lab's painter (applyStyleSet);
//   - a host's base style, which is the document layer, is checked into a
//     StyleLayer (checkLayer), and a theme's style set into a ThemeStyles
//     (checkThemeStyles).
//
// A LAYER may start from a preset ("@style: pencil"). A preset replaces every
// style.* setting below it — that is what "start from pencil" means — and then the
// layer's own settings apply on top, whatever order they were written in. A preset
// never touches paint.* or media.*, and the seed is not part of any preset, so
// choosing a preset never rerolls.

export interface StyleLayer {
  preset?: PresetName
  line?: Partial<LineSettings>
  fill?: Partial<FillSettings>
  paper?: Partial<PaperSettings>
  lettering?: Partial<LetteringSettings>
  colour?: Partial<ColourSettings>
  seed?: number
  // Every other setting a "@style-set" wrote, by registry path (paint.*, media.*,
  // board.*). A style.* setting written by "@style-set" goes into the groups above,
  // where "@style-looseness" writes it, so the last one written wins. Absent when
  // there is none, so a figure that says nothing has an empty layer.
  set?: Record<string, SettingValue>
}

const GROUPS = ['line', 'fill', 'paper', 'lettering', 'colour'] as const

// The figure styles of the layers, base first: the stack's style.* settings for a
// figure (graph type figure2d). With the two layers of a rendered figure, [the host's
// base style, the figure's own], that is the stack with the base as the document and
// the figure as the figure; resolveStyle also folds any other number of layers.
export function resolveStyle(layers: readonly (StyleLayer | null | undefined)[]): Style {
  return toStyle(resolveLayers(layers.map((layer) => (layer ? layerFromStyleLayer(layer) : undefined))))
}

// Whether a resolved style is clean — the look the renderer draws through its
// clean pen, byte for byte as before styles existed. The seed does not count:
// clean has no randomness to reroll.
export function isClean(style: Style): boolean {
  return TOKENS.every((token) => token.group === 'seed' || readToken(style, token) === readToken(PRESETS.clean, token))
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

const BY_NAME = new Map<string, Token>()
for (const token of TOKENS) {
  BY_NAME.set(token.directive, token)
  for (const alias of token.aliases) BY_NAME.set(alias, token)
}

function writeValue(layer: StyleLayer, token: Token, value: string | number): void {
  if (token.group === 'seed') {
    layer.seed = value as number
    return
  }
  const group = (layer[token.group] ??= {}) as Record<string, string | number>
  group[token.key] = value
}

// Applies one "@style…" directive to a figure's layer. `name` is the key
// without its "@" — "style" or "style-<setting>". Throws, with a message
// naming the valid presets, settings or values, on anything it does not
// know; the caller (parseSpec) reports it and the layer is left untouched.
export function applyStyleDirective(layer: StyleLayer, name: string, value: string): void {
  if (name === 'style-set') {
    applyStyleSet(layer, value)
    return
  }
  if (name === 'style') {
    const preset = value.trim()
    if (!isPresetName(preset)) throw new Error(`@style must be one of ${PRESET_NAMES.join(', ')}, got "${preset}"`)
    layer.preset = preset
    return
  }
  const setting = name.startsWith('style-') ? name.slice('style-'.length) : ''
  const token = BY_NAME.get(setting)
  if (!token) {
    throw new Error(`Unknown style setting "@${name}" — the style settings are ${TOKENS.map((t) => t.directive).join(', ')}`)
  }
  writeValue(layer, token, parseTokenValue(token, value, `@style-${token.directive}`))
}

// A setting written to a layer: a style.* setting where "@style-<setting>" writes it, any
// other into `set` by its registry path (curves copied).
function writeSetting(layer: StyleLayer, spec: SettingSpec, value: SettingValue): void {
  const token = tokenAt(spec.path)
  if (token !== undefined) {
    writeValue(layer, token, value as string | number)
    return
  }
  const set = (layer.set ??= {})
  set[spec.path] = Array.isArray(value) ? value.map(([x, y]) => [x, y]) : value
}

// Applies one "@style-set: <registry path> <value>" directive to a figure's layer. The
// path is a registry path (style.line.looseness, paint.value.terminatorSoftness,
// media.chalk.chroma), and a figure style may leave "style." off (line.looseness). A
// path that is not a setting is refused with the nearest ones named, and a value that
// is not valid is refused with what is valid, a number's range included: out of range
// is refused, never clamped, as "@style-<setting>" refuses it. A refused directive
// throws before it touches the layer, so the figure draws without it.
export function applyStyleSet(layer: StyleLayer, text: string): void {
  const split = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!split) throw new Error('@style-set needs a setting and a value, like "@style-set: style.line.looseness 0.4"')
  const spec = findSetting(split[1])
  if (!spec) throw new Error(noSuchSetting('@style-set', split[1]))
  writeSetting(layer, spec, readSettingValue(spec, split[2] ?? '', `@style-set ${spec.path}`))
}

// A style written back as the directives that reproduce it: the nearest
// preset, then only the settings that differ from it. What the style lab's
// "copy directives" box shows.
export function directivesFor(style: Style): string[] {
  let best: PresetName = 'clean'
  let fewest = Number.POSITIVE_INFINITY
  for (const name of PRESET_NAMES) {
    const differing = TOKENS.filter((t) => t.group !== 'seed' && readToken(style, t) !== readToken(PRESETS[name], t)).length
    if (differing < fewest) {
      best = name
      fewest = differing
    }
  }
  const lines = [`@style: ${best}`]
  for (const token of TOKENS) {
    const value = readToken(style, token)
    if (token.group === 'seed') {
      if (value !== 0) lines.push(`@style-seed: ${value}`)
      continue
    }
    if (value === readToken(PRESETS[best], token)) continue
    // Written without its "#": "#" starts a comment in a spec.
    const text = token.kind === 'colour' && typeof value === 'string' ? value.replace(/^#/, '') : String(value)
    lines.push(`@style-${token.directive}: ${text}`)
  }
  return lines
}

// ---------------------------------------------------------------------------
// A base style from the host
// ---------------------------------------------------------------------------

// A host passes its base style as an object, which may have come from
// anywhere (a stored theme, a URL). It is checked token by token: what is
// valid is kept, and each thing that is not is named — the renderer returns
// those as errors rather than throwing, and draws with the rest.
export function checkLayer(input: StyleLayer): { layer: StyleLayer; errors: string[] } {
  const layer: StyleLayer = {}
  const errors: string[] = []
  // The whole thing must be an object of groups. A bare preset name, an
  // array or null is refused in one sentence, not group by group.
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    const got = input === null ? 'null' : Array.isArray(input) ? 'an array' : `the ${typeof input} ${JSON.stringify(input)}`
    return {
      layer,
      errors: [`The base style must be an object such as { preset: 'ink', line: { looseness: 0.3 } }, got ${got}`],
    }
  }
  const source = input as unknown as Record<string, unknown>
  for (const key of Object.keys(source)) {
    const value = source[key]
    if (value === undefined) continue
    if (key === 'preset') {
      if (typeof value === 'string' && isPresetName(value)) layer.preset = value
      else errors.push(`The base style's preset must be one of ${PRESET_NAMES.join(', ')}, got "${String(value)}"`)
      continue
    }
    if (key === 'seed') {
      try {
        writeValue(layer, BY_NAME.get('seed')!, parseTokenValue(BY_NAME.get('seed')!, String(value), 'The base style\'s seed'))
      } catch (err) {
        errors.push((err as Error).message)
      }
      continue
    }
    if (key === 'set') {
      if (!isPlainObject(value)) {
        errors.push(`The base style's set must be an object of registry paths and values, got ${JSON.stringify(value)}`)
        continue
      }
      for (const [path, raw] of Object.entries(value)) {
        const spec = findSetting(path)
        if (!spec) {
          errors.push(noSuchSetting("The base style's set", path))
          continue
        }
        try {
          writeSetting(layer, spec, readSettingValue(spec, raw, `The base style's set ${spec.path}`))
        } catch (err) {
          errors.push((err as Error).message)
        }
      }
      continue
    }
    if (!(GROUPS as readonly string[]).includes(key) || typeof value !== 'object' || value === null) {
      errors.push(`The base style has no group "${key}" — its groups are ${GROUPS.join(', ')}, preset, seed and set`)
      continue
    }
    for (const [setting, raw] of Object.entries(value as Record<string, unknown>)) {
      const token = TOKENS.find((t) => t.group === key && t.key === setting)
      if (!token) {
        errors.push(`The base style's ${key} has no setting "${setting}"`)
        continue
      }
      try {
        writeValue(layer, token, parseTokenValue(token, String(raw), `The base style's ${key} ${setting}`))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }
  }
  return { layer, errors }
}

// ---------------------------------------------------------------------------
// A theme's style set
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// One settings layer of a theme's style set, from a host or a stored theme. What is valid
// is kept (a path that is a setting, with a valid value, by its registry path) and each
// thing that is not is named, as checkLayer does for a base style.
export function checkSettingsLayer(input: unknown, label: string): { layer: SettingsLayer; errors: string[] } {
  const layer: SettingsLayer = {}
  const errors: string[] = []
  if (!isPlainObject(input)) {
    errors.push(`${label} must be an object such as { preset: 'ink', set: { 'style.line.looseness': 0.3 } }, got ${JSON.stringify(input) ?? String(input)}`)
    return { layer, errors }
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'preset') {
      if (typeof value === 'string' && isPresetName(value)) layer.preset = value
      else errors.push(`${label}'s preset must be one of ${PRESET_NAMES.join(', ')}, got ${JSON.stringify(value)}`)
    } else if (key === 'set') {
      if (!isPlainObject(value)) {
        errors.push(`${label}'s set must be an object of registry paths and values, got ${JSON.stringify(value)}`)
        continue
      }
      const set: Record<string, SettingValue> = {}
      for (const [path, raw] of Object.entries(value)) {
        const spec = findSetting(path)
        if (!spec) {
          errors.push(noSuchSetting(`${label}'s set`, path))
          continue
        }
        try {
          set[spec.path] = readSettingValue(spec, raw, `${label}'s set ${spec.path}`)
        } catch (err) {
          errors.push((err as Error).message)
        }
      }
      layer.set = set
    } else {
      errors.push(`${label} has no "${key}" — a settings layer has preset and set`)
    }
  }
  return { layer, errors }
}

// A theme's style set (ThemeInput.styles, from a stored theme or the built-in table) checked
// into a ThemeStyles: what is valid is kept and what is not is named. Nothing, null and
// undefined are an empty set, with no error.
export function checkThemeStyles(input: unknown): { styles: ThemeStyles; errors: string[] } {
  const styles: ThemeStyles = {}
  const errors: string[] = []
  if (input === undefined || input === null) return { styles, errors }
  if (!isPlainObject(input)) {
    errors.push(`The theme's styles must be an object such as { all: {...}, byType: { space: {...} } }, got ${JSON.stringify(input) ?? String(input)}`)
    return { styles, errors }
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'all') {
      const checked = checkSettingsLayer(value, "The theme's styles.all")
      styles.all = checked.layer
      errors.push(...checked.errors)
    } else if (key === 'byType') {
      if (!isPlainObject(value)) {
        errors.push(`The theme's styles.byType must be an object keyed by graph type (${GRAPH_TYPES.join(', ')}), got ${JSON.stringify(value)}`)
        continue
      }
      const byType: NonNullable<ThemeStyles['byType']> = {}
      for (const [type, layer] of Object.entries(value)) {
        if (layer === undefined) continue
        if (!(GRAPH_TYPES as readonly string[]).includes(type)) {
          errors.push(`The theme's styles.byType has no graph type "${type}" — the graph types are ${GRAPH_TYPES.join(', ')}`)
          continue
        }
        const checked = checkSettingsLayer(layer, `The theme's styles.byType.${type}`)
        byType[type as (typeof GRAPH_TYPES)[number]] = checked.layer
        errors.push(...checked.errors)
      }
      styles.byType = byType
    } else {
      errors.push(`The theme's styles has no "${key}" — it has all and byType`)
    }
  }
  return { styles, errors }
}

// The style set of a resolved theme, as the stack takes it: undefined when the theme has
// none. What a theme carries is untrusted data (the adapter copies and freezes it), so
// this reads it through checkThemeStyles and keeps only what is valid.
export function themeStylesOf(theme: { styles?: unknown }): ThemeStyles | undefined {
  return theme.styles === undefined || theme.styles === null ? undefined : checkThemeStyles(theme.styles).styles
}
