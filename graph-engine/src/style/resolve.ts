import { isPresetName, PRESET_NAMES, PRESETS, type PresetName } from './presets'
import {
  parseColourSetting,
  readToken,
  TOKENS,
  type ColourSettings,
  type FillSettings,
  type LetteringSettings,
  type LineSettings,
  type Look,
  type PaperSettings,
  type Style,
  type Token,
} from './tokens'

// Where a style comes from, and how the layers combine.
//
// Settings layer from least to most specific, each layer overriding only what
// it sets:
//   1. built in: clean;
//   2. the app theme — the viewer's default, passed to the renderer;
//   3. the document — a document's pinned look (today the same parameter);
//   4. the figure's own "@style…" directives.
//
// A LAYER may start from a preset ("@style: pencil"). A preset replaces every
// setting below it — that is what "start from pencil" means — and then the
// layer's own settings apply on top, whatever order they were written in.
// The seed is not part of any preset, so choosing a preset never rerolls.

export interface StyleLayer {
  preset?: PresetName
  line?: Partial<LineSettings>
  fill?: Partial<FillSettings>
  paper?: Partial<PaperSettings>
  lettering?: Partial<LetteringSettings>
  colour?: Partial<ColourSettings>
  seed?: number
}

const GROUPS = ['line', 'fill', 'paper', 'lettering', 'colour'] as const

function cloneLook(look: Look): Look {
  return {
    line: { ...look.line },
    fill: { ...look.fill },
    paper: { ...look.paper },
    lettering: { ...look.lettering },
    colour: { ...look.colour },
  }
}

export function resolveStyle(layers: readonly (StyleLayer | null | undefined)[]): Style {
  let look = cloneLook(PRESETS.clean)
  let seed = 0
  for (const layer of layers) {
    if (!layer) continue
    if (layer.preset) look = cloneLook(PRESETS[layer.preset])
    for (const group of GROUPS) Object.assign(look[group], layer[group] ?? {})
    if (layer.seed !== undefined) seed = layer.seed
  }
  return { ...look, seed }
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

// A token's value from text, or a refusal naming what would have been valid.
function parseValue(token: Token, text: string, name: string): string | number {
  const value = text.trim()
  switch (token.kind) {
    case 'choice':
      if (!token.choices.includes(value)) throw new Error(`${name} must be one of ${token.choices.join(', ')}, got "${value}"`)
      return value
    case 'colour': {
      const colour = parseColourSetting(value)
      if (colour === null) {
        throw new Error(`${name} must be a colour written as six hex digits without the "#" (which starts a comment in a spec), like fdf6e3, or "theme", got "${value}"`)
      }
      return colour
    }
    case 'number': {
      const n = Number(value)
      const range = `from ${token.min} to ${token.max}`
      if (value === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number ${range}, got "${value}"`)
      if (token.integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number ${range}, got "${value}"`)
      if (n < token.min || n > token.max) throw new Error(`${name} must be a number ${range}, got "${value}"`)
      return n
    }
  }
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
  writeValue(layer, token, parseValue(token, value, `@style-${token.directive}`))
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
        writeValue(layer, BY_NAME.get('seed')!, parseValue(BY_NAME.get('seed')!, String(value), 'The base style\'s seed'))
      } catch (err) {
        errors.push((err as Error).message)
      }
      continue
    }
    if (!(GROUPS as readonly string[]).includes(key) || typeof value !== 'object' || value === null) {
      errors.push(`The base style has no group "${key}" — its groups are ${GROUPS.join(', ')}, preset and seed`)
      continue
    }
    for (const [setting, raw] of Object.entries(value as Record<string, unknown>)) {
      const token = TOKENS.find((t) => t.group === key && t.key === setting)
      if (!token) {
        errors.push(`The base style's ${key} has no setting "${setting}"`)
        continue
      }
      try {
        writeValue(layer, token, parseValue(token, String(raw), `The base style's ${key} ${setting}`))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }
  }
  return { layer, errors }
}
