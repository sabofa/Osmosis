import { useCallback, useEffect, useState } from 'react'
import { TOKEN_FIELDS } from '../lib/themeTokens'
import { BUILTIN_THEMES } from '../lib/builtinThemes'
import { getThemes, putTheme, deleteThemeRecord, putActiveTheme, type ThemeRecord } from '../lib/api'
import type { ResolvedMode } from './useTheme'

export interface ThemePreset {
  id: string
  name: string
  tokens: {
    light: Record<string, string>
    dark: Record<string, string>
  }
  customCss: string
  builtin?: boolean
}

// Themes live on the server (canonical) and reach this device through its
// node: reads come from GET /api/themes, writes go to the node, which
// forwards them to canonical and refuses them offline. The last known list
// and active id are cached in localStorage only so the first paint after a
// cold load (or with the node unreachable) already has the right palette.
const CACHE_KEY = 'osmosis:theme-cache'
const STYLE_TAG_ID = 'osmosis-preset-css'
const REFRESH_MS = 5 * 60_000

// Pre-sync storage keys; migrated to the server on the first load that finds
// the server empty, then removed.
const LEGACY_THEMES_KEY = 'osmosis:theme-presets'
const LEGACY_ACTIVE_KEY = 'osmosis:active-theme-preset'
const LEGACY_CSS_KEY = 'osmosis:custom-css'

interface Cache {
  themes: ThemePreset[]
  activeId: string | null
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // malformed cache: start clean
  }
  return { themes: [], activeId: null }
}

function writeCache(c: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    // storage full or unavailable: the server copy is the real one
  }
}

function fromRecord(r: ThemeRecord): ThemePreset {
  return { id: r.id, name: r.name, tokens: r.tokens, customCss: r.custom_css }
}

function readLegacy(): { themes: ThemePreset[]; activeId: string | null } | null {
  try {
    const raw = localStorage.getItem(LEGACY_THEMES_KEY)
    const legacyCss = localStorage.getItem(LEGACY_CSS_KEY)
    const themes: ThemePreset[] = raw ? JSON.parse(raw) : []
    if (legacyCss && legacyCss.trim()) {
      themes.push({ id: 'imported', name: 'Imported theme', tokens: { light: {}, dark: {} }, customCss: legacyCss })
    }
    if (themes.length === 0) return null
    return { themes, activeId: localStorage.getItem(LEGACY_ACTIVE_KEY) }
  } catch {
    return null
  }
}

function clearLegacy() {
  localStorage.removeItem(LEGACY_THEMES_KEY)
  localStorage.removeItem(LEGACY_ACTIVE_KEY)
  localStorage.removeItem(LEGACY_CSS_KEY)
}

function applyPreset(preset: ThemePreset | undefined, mode: ResolvedMode) {
  const root = document.documentElement
  for (const field of TOKEN_FIELDS) root.style.removeProperty(field.key)
  if (preset) {
    for (const [key, value] of Object.entries(preset.tokens[mode])) {
      if (value) root.style.setProperty(key, value)
    }
  }

  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_TAG_ID
    document.head.appendChild(tag)
  }
  tag.textContent = preset?.customCss ?? ''
}

// `mode` is the app's *resolved* light/dark mode (following the OS when the
// mode choice is 'system') — a theme preset carries one token set per mode
// and swaps between them automatically as the mode changes.
export function useThemePresets(mode: ResolvedMode) {
  const [cache] = useState(readCache)
  const [custom, setCustom] = useState<ThemePreset[]>(cache.themes)
  const [activeId, setActiveIdState] = useState<string | null>(cache.activeId)
  const [error, setError] = useState<string | null>(null)

  const themes = [...BUILTIN_THEMES, ...custom]

  useEffect(() => {
    applyPreset(themes.find((t) => t.id === activeId), mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, custom, mode])

  const refresh = useCallback(async () => {
    try {
      const { themes: rows, active_theme_id } = await getThemes()
      let list = rows.map(fromRecord)
      let active = active_theme_id

      // One-time migration of pre-sync, browser-only presets: only when the
      // server has nothing yet, so a device that comes late can't overwrite
      // themes made elsewhere.
      const legacy = readLegacy()
      if (legacy && rows.length === 0) {
        for (const t of legacy.themes) {
          const saved = await putTheme({ id: t.id, name: t.name, tokens: t.tokens, custom_css: t.customCss })
          list = [...list.filter((x) => x.id !== saved.id), fromRecord(saved)]
        }
        if (legacy.activeId && list.some((t) => t.id === legacy.activeId)) {
          active = (await putActiveTheme(legacy.activeId)).active_theme_id
        }
        clearLegacy()
      } else if (legacy) {
        clearLegacy()
      }

      setCustom(list)
      setActiveIdState(active)
      writeCache({ themes: list, activeId: active })
      setError(null)
    } catch {
      // Node unreachable: keep the cached list; nothing to tell the user yet.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const setActiveId = useCallback(
    (id: string | null) => {
      const previous = activeId
      setActiveIdState(id)
      putActiveTheme(id)
        .then(() => {
          setError(null)
          writeCache({ ...readCache(), activeId: id })
        })
        .catch((err) => {
          setActiveIdState(previous)
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [activeId]
  )

  const saveTheme = useCallback(async (theme: ThemePreset): Promise<boolean> => {
    try {
      const saved = fromRecord(await putTheme({ id: theme.id, name: theme.name, tokens: theme.tokens, custom_css: theme.customCss }))
      setCustom((prev) => {
        const next = [...prev.filter((t) => t.id !== saved.id), saved]
        writeCache({ ...readCache(), themes: next })
        return next
      })
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const deleteTheme = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteThemeRecord(id)
      setCustom((prev) => {
        const next = prev.filter((t) => t.id !== id)
        writeCache({ ...readCache(), themes: next })
        return next
      })
      setActiveIdState((cur) => (cur === id ? null : cur))
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  return { themes, activeId, setActiveId, saveTheme, deleteTheme, error, refresh }
}
