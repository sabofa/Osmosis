import { DEFAULT_DIALS, DEFAULT_SEEDS, OWNED_DIALS, normalise, validate } from 'theme-core'
import type { ColourSeeds, Dials, FontRole, LayerKind, Mode, Report, StackName, ThemeManifest } from 'theme-core'
import type { ThemePreset } from '../hooks/useThemePresets'
import { presetToManifest } from '../theme/themeState'

export type SeedKey = keyof Omit<ColourSeeds, 'series'>
export type DialKey = keyof Dials

const DIAL_RANGE: Partial<Record<DialKey, [number, number]>> = { typeScale: [1.125, 1.333], baseSize: [13, 18] }
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
const customId = () => `custom-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`

export function startManifest(initial: ThemePreset | null, builtinSource?: ThemePreset): ThemeManifest {
  if (initial) return copy(initial.manifest ?? presetToManifest(initial))
  if (builtinSource) {
    const base = copy(builtinSource.manifest ?? presetToManifest(builtinSource))
    return { ...base, id: customId(), name: `${builtinSource.name} copy`, author: 'human' }
  }
  return normalise({
    id: customId(),
    name: 'New theme',
    author: 'human',
    seeds: { light: { ...DEFAULT_SEEDS.light }, dark: { ...DEFAULT_SEEDS.dark } },
  })
}

export function setSeed(m: ThemeManifest, mode: Mode, key: SeedKey, value: string, deriveOther: boolean): ThemeManifest {
  const other: Mode = mode === 'light' ? 'dark' : 'light'
  const mine = { ...m.seeds[mode] }
  const v = value.trim()
  if (HEX_RE.test(v)) mine[key] = v.toLowerCase()
  else delete mine[key]
  const seeds = { ...m.seeds, [mode]: mine }
  const o = seeds[other]
  if (deriveOther && o && key in o) {
    const next = { ...o }
    delete next[key]
    seeds[other] = next
  }
  return { ...m, seeds }
}

export function setDial<K extends DialKey>(m: ThemeManifest, key: K, value: Dials[K]): ThemeManifest {
  const dials: Partial<Dials> = { ...m.dials }
  let v: number | boolean = value
  if (typeof v === 'number') {
    const [lo, hi] = DIAL_RANGE[key] ?? [0, 1]
    v = Math.min(hi, Math.max(lo, v))
  }
  if (v === DEFAULT_DIALS[key]) delete dials[key]
  else (dials as Record<string, unknown>)[key] = v
  return { ...m, dials }
}

export function setFont(m: ThemeManifest, role: FontRole, stack: StackName | null): ThemeManifest {
  const fonts = { ...m.fonts }
  if (stack) fonts[role] = { stack }
  else delete fonts[role]
  return { ...m, fonts }
}

// Full theme = no layer key at all (hidden controls keep their values).
export function setLayer(m: ThemeManifest, layer: LayerKind | null): ThemeManifest {
  const out = { ...m }
  if (layer) out.layer = layer
  else delete out.layer
  return out
}

export function setCss(m: ThemeManifest, css: string): ThemeManifest {
  const out = { ...m }
  if (css) out.css = css
  else delete out.css
  return out
}

export const setName = (m: ThemeManifest, name: string): ThemeManifest => ({ ...m, name })

export function countOverrides(m: ThemeManifest): number {
  const o = m.overrides
  if (!o) return 0
  return (['any', 'light', 'dark'] as const).reduce((n, k) => n + Object.keys(o[k] ?? {}).length, 0)
}

export function clearOverrides(m: ThemeManifest): ThemeManifest {
  const out = { ...m }
  delete out.overrides
  return out
}

// builtin: ids are display-only and would fail validation as "reserved".
export function reportFor(m: ThemeManifest): Report {
  const forced = m.id.startsWith('builtin:') ? { ...m, id: customId() } : m
  return validate(forced)
}

// What the editor shows for a layer. A full theme (no layer) shows everything;
// hidden controls keep their values, the validator warns that they're ignored.
export function dialVisible(layer: LayerKind | undefined, key: DialKey): boolean {
  if (!layer) return true
  const other = layer === 'workspace' ? 'ambience' : 'workspace'
  return !(OWNED_DIALS[other] as readonly string[]).includes(key)
}

export function seedsVisible(layer: LayerKind | undefined): boolean {
  return layer !== 'workspace'
}

export function fontVisible(layer: LayerKind | undefined, role: FontRole): boolean {
  return !(layer === 'ambience' && role !== 'math')
}

export function layerNote(layer: LayerKind | undefined): string | null {
  if (layer === 'workspace') return 'A workspace theme controls shape, type, space and material; colours come from the ambience theme.'
  if (layer === 'ambience') return 'An ambience theme controls colour, surface and graph; shape, type and space come from the workspace theme.'
  return null
}

export const WORKSPACE_OVERRIDE_NOTE =
  'A workspace theme is active - shape, type, space and material settings here are overridden while it is selected.'

// The edited manifest's shape/type controls are masked in the live preview by an active workspace theme.
export function workspaceOverrides(layer: LayerKind | undefined, workspaceActive: boolean): boolean {
  return workspaceActive && layer !== 'workspace'
}
