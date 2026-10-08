import { builtinById, DEFAULT_THEME_ID, migrate as migrateTheme, resolve, toLegacyTokens } from 'theme-core'
import type { Location, ThemeManifest } from 'theme-core'
import type { ThemePreset } from '../hooks/useThemePresets'

// Which manifest is in force. Unknown, null or retired builtin ids fall back
// to the default theme, never to nothing.
export function activeManifest(custom: Array<{ id: string; manifest: ThemeManifest }>, activeId: string | null): ThemeManifest {
  const fallback = builtinById(DEFAULT_THEME_ID)!
  if (!activeId) return fallback
  return custom.find((c) => c.id === activeId)?.manifest ?? builtinById(activeId) ?? fallback
}

// The shape the editor and Settings still speak: legacy 8-token maps + css.
export function toPresetView(id: string, name: string, manifest: ThemeManifest, builtin?: boolean): ThemePreset {
  return { id, name, tokens: toLegacyTokens(resolve(manifest)), customCss: manifest.css ?? '', builtin, manifest }
}

export function presetToManifest(p: ThemePreset): ThemeManifest {
  if (p.manifest) {
    const same = JSON.stringify(p.tokens) === JSON.stringify(toLegacyTokens(resolve(p.manifest)))
    if (same && (p.manifest.css ?? '') === p.customCss) return { ...p.manifest, id: p.id, name: p.name }
  }
  return migrateTheme({ id: p.id, name: p.name, tokens: p.tokens, custom_css: p.customCss })
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ThemeCache {
  themes: Array<{ id: string; name: string; manifest: ThemeManifest; updated_at: string }>
  active_theme_id: string | null
  location: Location | null
}

export const CACHE_KEY = 'osmosis:theme-cache'

export function readCache(s: StorageLike): ThemeCache | null {
  try {
    const raw = s.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || !Array.isArray(c.themes)) return null
    if (!c.themes.every((t: { manifest?: unknown }) => t && typeof t.manifest === 'object' && t.manifest)) return null
    return { themes: c.themes, active_theme_id: c.active_theme_id ?? null, location: c.location ?? null }
  } catch {
    return null
  }
}

export function writeCache(s: StorageLike, value: ThemeCache): void {
  try {
    s.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // storage full or unavailable: the server copy is the real one
  }
}
