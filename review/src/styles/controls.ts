// The pure logic behind the Style Lab's reusable controls (SettingsPanel, LayerSelector,
// ThemeSwitcher). No React, no DOM, no lab state: it is tested in controls.test.ts.
// Themes come only through the adapter.

import type { SettingSpec, SettingValue } from '../../../graph-engine/src/style/settings/types'
import { defaultTheme, fromColours, fromOsmosisTheme, resolveTheme } from '../../../graph-engine/src/style/theme/adapter'
import { BUILTIN_LIGHT, BUILTIN_THEME_IDS, type BuiltinThemeId } from '../../../graph-engine/src/style/theme/defaults'
import { BOARD_NAMES, type BoardName, type GraphType, type Hex, type PaletteLike, type ThemeColours, type ThemeInput } from '../../../graph-engine/src/style/theme/types'

// ---- settings --------------------------------------------------------------------------------

export interface SettingGroup {
  group: string
  specs: SettingSpec[]
}

// Specs grouped by `spec.group`, groups and specs in the order they first appear.
export function groupSpecs(specs: readonly SettingSpec[]): SettingGroup[] {
  const groups = new Map<string, SettingSpec[]>()
  for (const spec of specs) {
    const list = groups.get(spec.group)
    if (list === undefined) groups.set(spec.group, [spec])
    else list.push(spec)
  }
  return [...groups].map(([group, list]) => ({ group, specs: list }))
}

// The value shown for a path: the layer's own, else the one inherited from the layers below.
export function shownValue(path: string, values: ReadonlyMap<string, SettingValue>, inherited: ReadonlyMap<string, SettingValue>): SettingValue | undefined {
  return values.get(path) ?? inherited.get(path)
}

export const isOwn = (path: string, values: ReadonlyMap<string, SettingValue>): boolean => values.has(path)

export function decimalsOfStep(step: number | undefined): number {
  if (step === undefined || !(step > 0)) return 3
  const text = String(step)
  if (text.includes('e-')) return Math.min(12, Number(text.split('e-')[1]) + 1)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

// A typed or slid number made valid for a spec: snapped to the step (from min), whole when the
// spec is `integer`, clamped to min..max. Not a finite number: undefined.
export function clampNumber(spec: SettingSpec, raw: number): number | undefined {
  if (!Number.isFinite(raw)) return undefined
  let v = raw
  const { min, max, step } = spec
  if (step !== undefined && step > 0) {
    const origin = min ?? 0
    v = origin + Math.round((v - origin) / step) * step
    // Trim the float noise the multiplication leaves (0.30000000000000004).
    v = Number(v.toFixed(decimalsOfStep(step)))
  }
  if (spec.integer === true) v = Math.round(v)
  if (min !== undefined && v < min) v = spec.integer === true ? Math.ceil(min) : min
  if (max !== undefined && v > max) v = spec.integer === true ? Math.floor(max) : max
  return v
}

// The text a number is shown as in its box.
export const formatNumber = (spec: SettingSpec, value: number): string => value.toFixed(spec.integer === true ? 0 : decimalsOfStep(spec.step))

// A curve's points as an SVG path in a w×h box, y over the spec's range (default 0..1; y up).
export function curvePath(points: readonly (readonly number[])[], spec: Pick<SettingSpec, 'min' | 'max'>, w: number, h: number): string {
  const lo = spec.min ?? 0
  const hi = spec.max ?? 1
  const span = hi - lo || 1
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * w).toFixed(1)} ${(h - ((y - lo) / span) * h).toFixed(1)}`).join(' ')
}

// ---- layers ----------------------------------------------------------------------------------

export type EditedLayer = { kind: 'theme' } | { kind: 'themeType'; graphType: GraphType } | { kind: 'document' }

export const layerKey = (layer: EditedLayer): string => (layer.kind === 'themeType' ? `themeType:${layer.graphType}` : layer.kind)

export function layerFromKey(key: string): EditedLayer {
  if (key.startsWith('themeType:')) return { kind: 'themeType', graphType: key.slice('themeType:'.length) as GraphType }
  return key === 'document' ? { kind: 'document' } : { kind: 'theme' }
}

// ---- themes ----------------------------------------------------------------------------------

export const THEME_CHOICE_IDS = ['light', 'dark', ...BUILTIN_THEME_IDS, 'custom'] as const
export type ThemeChoiceId = (typeof THEME_CHOICE_IDS)[number]

// The single colours a custom theme names (the series derives from them).
export const CUSTOM_COLOUR_KEYS = ['surface', 'paper', 'ink', 'muted', 'line', 'lineStrong', 'accent', 'accentWash', 'good', 'bad'] as const satisfies readonly (keyof ThemeColours)[]
export type CustomColourKey = (typeof CUSTOM_COLOUR_KEYS)[number]

export interface CustomTheme {
  mode: 'light' | 'dark'
  colours: Record<CustomColourKey, Hex>
  boards: Record<BoardName, Hex>
}

export type ThemeChoice = { id: Exclude<ThemeChoiceId, 'custom'> } | { id: 'custom'; custom: CustomTheme }

// A custom theme to start from: the default theme of the mode, as resolved.
export function customFromDefault(mode: 'light' | 'dark' = 'light'): CustomTheme {
  const t = defaultTheme(mode)
  const colours = {} as Record<CustomColourKey, Hex>
  for (const k of CUSTOM_COLOUR_KEYS) colours[k] = t.colours[k]
  return { mode, colours, boards: { ...t.boards } }
}

const num = (hex: Hex): number => parseInt(hex.slice(1), 16)

// A built-in theme's light tokens as the Palette the app would resolve for it.
function builtinPalette(id: BuiltinThemeId): PaletteLike {
  const { tokens, good, bad } = BUILTIN_LIGHT[id]
  return {
    background: num(tokens['--surface']),
    axis: num(tokens['--ink']),
    muted: num(tokens['--muted']),
    grid: num(tokens['--line']),
    gridStrong: num(tokens['--line-strong']),
    curve: num(tokens['--accent']),
    segment: num(good),
    point: num(bad),
  }
}

export const isBuiltinId = (id: string): id is BuiltinThemeId => (BUILTIN_THEME_IDS as readonly string[]).includes(id)

// A choice resolved to the theme the engines read, only through the adapter. `styles` is the theme's
// style set (a ThemeStyles) when the page has one to give it; left out, the theme says nothing about style
// (a built-in theme then brings its own file's set).
export function themeInputOf(choice: ThemeChoice, styles?: unknown): ThemeInput {
  if (choice.id === 'light' || choice.id === 'dark') return styles === undefined ? defaultTheme(choice.id) : resolveTheme({ mode: choice.id, styles })
  if (choice.id === 'custom') return fromColours({ mode: choice.custom.mode, colours: choice.custom.colours, boards: choice.custom.boards, styles })
  return fromOsmosisTheme(builtinPalette(choice.id), 'light', { id: choice.id }, styles === undefined ? undefined : () => styles)
}

export const themeLabel = (id: ThemeChoiceId): string => (isBuiltinId(id) ? id.slice('builtin:'.length) : id)

export { BOARD_NAMES }
