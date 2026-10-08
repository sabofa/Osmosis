import { normalise, type Mode, type ThemeManifest } from './manifest.js'

export interface LegacyThemeRow { id: string; name: string; tokens: { light: Record<string, string>; dark: Record<string, string> }; custom_css?: string }

export class MigrateError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MigrateError'
    this.code = code
  }
}

export const LEGACY_TOKEN_MAP: Record<string, string> = {
  '--bg': 'color-canvas', '--surface': 'color-surface', '--ink': 'color-text', '--muted': 'color-text-muted',
  '--line': 'color-border', '--line-strong': 'color-border-strong', '--accent': 'color-accent',
  '--accent-wash': 'color-accent-wash', '--good': 'color-good', '--bad': 'color-bad', '--danger': 'color-bad',
  '--heat-0': 'color-heat-0', '--heat-1': 'color-heat-1', '--heat-2': 'color-heat-2', '--heat-3': 'color-heat-3', '--heat-4': 'color-heat-4',
}

const SEED_KEYS: Record<string, 'canvas' | 'surface' | 'ink' | 'accent'> = {
  '--bg': 'canvas', '--surface': 'surface', '--ink': 'ink', '--accent': 'accent',
}

const MANIFEST_FIELDS = new Set(['schema', 'id', 'name', 'description', 'author', 'seeds', 'dials', 'fonts', 'overrides', 'css', 'graph', 'ambience', 'sounds', 'assets'])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function migrate(raw: unknown): ThemeManifest {
  if (!isObj(raw)) throw new MigrateError('not_object', 'theme must be an object')
  if (raw.schema === 1) {
    for (const k of Object.keys(raw)) {
      if (!MANIFEST_FIELDS.has(k)) throw new MigrateError('unknown_field', `unknown manifest field: ${k}`)
    }
    if (typeof raw.id !== 'string') throw new MigrateError('invalid_manifest', 'id must be a string')
    if (typeof raw.name !== 'string' || raw.name === '') throw new MigrateError('invalid_manifest', 'name must be a non-empty string')
    return normalise(raw as unknown as Partial<ThemeManifest> & { id: string; name: string })
  }
  if (!isObj(raw.tokens)) throw new MigrateError('unknown_shape', 'neither a legacy theme row nor a schema-1 manifest')
  const { light, dark } = raw.tokens
  if (!isObj(light) || !isObj(dark)) throw new MigrateError('invalid_tokens', 'tokens must have light and dark objects')
  if (typeof raw.id !== 'string') throw new MigrateError('invalid_manifest', 'id must be a string')
  if (typeof raw.name !== 'string' || raw.name === '') throw new MigrateError('invalid_manifest', 'name must be a non-empty string')

  const seeds: NonNullable<ThemeManifest['seeds']> = {}
  const overrides: { light: Record<string, string>; dark: Record<string, string> } = { light: {}, dark: {} }
  const blocks: string[] = []
  for (const [mode, toks] of [['light', light], ['dark', dark]] as [Mode, Record<string, unknown>][]) {
    let unknown = ''
    for (const [k, v] of Object.entries(toks)) {
      if (typeof v !== 'string') throw new MigrateError('invalid_tokens', `token ${k} must be a string`)
      const target = LEGACY_TOKEN_MAP[k]
      if (!target) { unknown += `${k}:${v};`; continue }
      overrides[mode][target] = v
      const seed = SEED_KEYS[k]
      if (seed) (seeds[mode] ??= {})[seed] = v
    }
    if (unknown) blocks.push(`:root[data-theme="${mode}"]{${unknown}}`)
  }
  if (typeof raw.custom_css === 'string' && raw.custom_css) blocks.push(raw.custom_css)
  const m: Partial<ThemeManifest> & { id: string; name: string } = { id: raw.id, name: raw.name, seeds }
  if (Object.keys(overrides.light).length || Object.keys(overrides.dark).length) {
    m.overrides = {}
    if (Object.keys(overrides.light).length) m.overrides.light = overrides.light
    if (Object.keys(overrides.dark).length) m.overrides.dark = overrides.dark
  }
  if (blocks.length) m.css = blocks.join('\n')
  return normalise(m)
}
