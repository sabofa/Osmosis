import { builtinById, compose, DEFAULT_THEME_ID, LEGACY_TOKEN_MAP, migrate as migrateTheme, resolve, toLegacyTokens } from 'theme-core'
import type { Location, ThemeManifest } from 'theme-core'
import type { ThemePreset } from '../hooks/useThemePresets'

// Which ambience manifest is in force. Unknown, null or retired builtin ids
// fall back to the default theme, never to nothing. A stale pointer to a
// workspace-layer theme is ignored the same way.
export function activeManifest(custom: Array<{ id: string; manifest: ThemeManifest }>, activeId: string | null): ThemeManifest {
  const fallback = builtinById(DEFAULT_THEME_ID)!
  if (!activeId) return fallback
  const found = custom.find((c) => c.id === activeId)?.manifest ?? builtinById(activeId)
  return found && found.layer !== 'workspace' ? found : fallback
}

// The workspace slot. Empty means "no workspace theme": no default is
// substituted. An ambience-layer theme can't sit here (stale pointer).
export function activeWorkspaceManifest(
  custom: Array<{ id: string; manifest: ThemeManifest }>,
  builtins: ReadonlyArray<ThemeManifest> | undefined,
  activeWorkspaceId: string | null
): ThemeManifest | null {
  if (!activeWorkspaceId) return null
  const found =
    custom.find((c) => c.id === activeWorkspaceId)?.manifest ??
    (builtins ? builtins.find((b) => b.id === activeWorkspaceId) : builtinById(activeWorkspaceId))
  return found && found.layer !== 'ambience' ? found : null
}

// An old server can't honour a workspace pointer, so a stored one is ignored.
export function effectiveWorkspaceId(supports: boolean, id: string | null): string | null {
  return supports ? id : null
}

// Both slots into the one manifest the stylesheet is built from. With an
// empty workspace slot this is the ambience manifest itself, by identity.
export function composeActive(workspace: ThemeManifest | null, ambience: ThemeManifest): ThemeManifest {
  return compose({ workspace, ambience }).manifest
}

// A previewed manifest replaces the slot its layer names; a full theme (no
// layer) or an ambience theme replaces the ambience slot.
export function applyPreview(
  preview: ThemeManifest | null,
  workspace: ThemeManifest | null,
  ambience: ThemeManifest
): { workspace: ThemeManifest | null; ambience: ThemeManifest } {
  if (!preview) return { workspace, ambience }
  if (preview.layer === 'workspace') return { workspace: preview, ambience }
  return { workspace, ambience: preview }
}

// The shape the editor and Settings still speak: legacy 8-token maps + css.
export function toPresetView(id: string, name: string, manifest: ThemeManifest, builtin?: boolean): ThemePreset {
  return { id, name, tokens: toLegacyTokens(resolve(manifest)), customCss: manifest.css ?? '', builtin, manifest, layer: manifest.layer ?? null }
}

const SEED_OF: Record<string, 'canvas' | 'surface' | 'ink' | 'accent'> = {
  '--bg': 'canvas', '--surface': 'surface', '--ink': 'ink', '--accent': 'accent',
}

// An edit through the legacy editor writes only the tokens that changed, on
// top of the manifest's own fields; everything else stays authored/derived.
export function presetToManifest(p: ThemePreset): ThemeManifest {
  if (!p.manifest) return migrateTheme({ id: p.id, name: p.name, tokens: p.tokens, custom_css: p.customCss })
  const base = p.manifest
  const out: ThemeManifest = { ...base, id: p.id, name: p.name }
  const orig = toLegacyTokens(resolve(base))
  for (const mode of ['light', 'dark'] as const) {
    for (const [tok, value] of Object.entries(p.tokens[mode] ?? {})) {
      if (orig[mode]?.[tok] === value) continue
      const sem = LEGACY_TOKEN_MAP[tok]
      if (!sem) continue
      out.overrides = { ...out.overrides, [mode]: { ...out.overrides?.[mode], [sem]: value } }
      const seed = SEED_OF[tok]
      if (seed) out.seeds = { ...out.seeds, [mode]: { ...out.seeds?.[mode], [seed]: value } }
    }
  }
  if ((base.css ?? '') !== p.customCss) out.css = p.customCss
  // The editor showed 8 colours; those 8 are what gets saved. Pin any token a
  // changed seed re-derived away from the value the user saw.
  const got = toLegacyTokens(resolve(out))
  for (const mode of ['light', 'dark'] as const) {
    for (const [tok, value] of Object.entries(p.tokens[mode] ?? {})) {
      if (got[mode]?.[tok] === value) continue
      const sem = LEGACY_TOKEN_MAP[tok]
      if (!sem) continue
      out.overrides = { ...out.overrides, [mode]: { ...out.overrides?.[mode], [sem]: value } }
    }
  }
  return out
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ThemeCache {
  themes: Array<{ id: string; name: string; manifest: ThemeManifest; updated_at: string }>
  active_theme_id: string | null
  active_workspace_theme_id?: string | null
  // Derived on read: true when the stored cache carries the workspace key.
  supportsWorkspace?: boolean
  location: Location | null
}

export const CACHE_KEY = 'osmosis:theme-cache'

export function readCache(s: StorageLike): ThemeCache | null {
  try {
    const raw = s.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || !Array.isArray(c.themes)) return null
    const themes = c.themes.flatMap((t: { id?: unknown; name?: unknown; manifest?: unknown; updated_at?: unknown }) => {
      try {
        if (!t || typeof t.manifest !== 'object' || !t.manifest) return []
        const manifest = migrateTheme(t.manifest)
        resolve(manifest)
        return [{ ...t, manifest }]
      } catch {
        return []
      }
    })
    if (c.themes.length > 0 && themes.length === 0) return null
    return {
      themes,
      active_theme_id: c.active_theme_id ?? null,
      active_workspace_theme_id: c.active_workspace_theme_id ?? null,
      supportsWorkspace: 'active_workspace_theme_id' in c,
      location: c.location ?? null,
    }
  } catch {
    return null
  }
}

export function writeCache(s: StorageLike, value: ThemeCache): void {
  try {
    // The workspace key is written only for servers that support it.
    const { supportsWorkspace, active_workspace_theme_id, ...rest } = value
    const out = supportsWorkspace ? { ...rest, active_workspace_theme_id: active_workspace_theme_id ?? null } : rest
    s.setItem(CACHE_KEY, JSON.stringify(out))
  } catch {
    // storage full or unavailable: the server copy is the real one
  }
}
