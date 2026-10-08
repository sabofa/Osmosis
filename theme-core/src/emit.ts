import type { Mode } from './manifest.js'
import type { ResolvedTheme, TokenMap } from './resolve.js'

export const ALIASES: Record<string, string> = {
  '--bg': 'color-canvas', '--surface': 'color-surface', '--ink': 'color-text', '--muted': 'color-text-muted',
  '--line': 'color-border', '--line-strong': 'color-border-strong', '--accent': 'color-accent',
  '--accent-wash': 'color-accent-wash', '--good': 'color-good', '--bad': 'color-bad', '--danger': 'color-bad',
  '--heat-0': 'color-heat-0', '--heat-1': 'color-heat-1', '--heat-2': 'color-heat-2', '--heat-3': 'color-heat-3', '--heat-4': 'color-heat-4',
}

export function toCssVars(map: TokenMap): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) out[`--${k}`] = v
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(map, target)) out[alias] = map[target]!
  }
  return out
}

export function toStylesheet(map: TokenMap, mode: Mode, css?: string): string {
  const decl = Object.entries(toCssVars(map)).map(([k, v]) => `${k}:${v}`).join(';')
  return `:root{${decl}}\n:root{color-scheme:${mode}}\n${css ?? ''}`
}

const LEGACY_KEYS = ['--accent', '--accent-wash', '--bg', '--surface', '--ink', '--muted', '--line', '--line-strong'] as const

export function toLegacyTokens(r: ResolvedTheme): { light: Record<string, string>; dark: Record<string, string> } {
  const pick = (m: TokenMap): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const k of LEGACY_KEYS) out[k] = m[ALIASES[k]!]!
    return out
  }
  return { light: pick(r.light), dark: pick(r.dark) }
}
