// Style sets on disk (Task 8, T8.1): the pure core of the Style Lab's Save. Pure, no DOM, so the dev
// middleware (review/vite.config.mts) and the lab share it.

import type { ThemeStyles } from '../../../graph-engine/src/style/layers'
import { checkThemeStyles } from '../../../graph-engine/src/style/resolve'

export const THEME_IDS = ['slate', 'forest', 'ember', 'plum'] as const

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
  }
  return v
}

// Canonical JSON: sorted keys, 2-space indent, a trailing LF.
export function serialiseStyleSet(styles: ThemeStyles): string {
  return JSON.stringify(sortKeys(styles), null, 2) + '\n'
}

// Text to a checked set, or the reason it is refused (bad JSON, an unknown path, out of range, a non-integer).
export function parseStyleSet(text: string): { styles: ThemeStyles } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { error: `That is not valid JSON: ${(err as Error).message}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A style set must be a JSON object such as { "all": {...}, "byType": {...} }.' }
  const { styles, errors } = checkThemeStyles(raw)
  if (errors.length) return { error: errors.join('; ') }
  return { styles }
}

// Repo-relative file of a built-in theme's style set; null for anything but a known theme id.
export function styleSetPath(themeId: string): string | null {
  if (!/^[a-z0-9-]+$/.test(themeId)) return null
  if (!(THEME_IDS as readonly string[]).includes(themeId)) return null
  return `graph-engine/src/style/theme/builtinStyles/${themeId}.json`
}
