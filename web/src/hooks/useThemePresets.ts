import { useCallback, useEffect, useState } from 'react'
import { TOKEN_FIELDS } from '../lib/themeTokens'
import type { ResolvedMode } from './useTheme'

export interface ThemePreset {
  id: string
  name: string
  tokens: {
    light: Record<string, string>
    dark: Record<string, string>
  }
  customCss: string
}

const THEMES_KEY = 'osmosis:theme-presets'
const ACTIVE_KEY = 'osmosis:active-theme-preset'
const STYLE_TAG_ID = 'osmosis-preset-css'
const LEGACY_CSS_KEY = 'osmosis:custom-css'

function loadThemes(): ThemePreset[] {
  try {
    const raw = localStorage.getItem(THEMES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore malformed storage
  }

  // One-time migration: the app used to have a single global custom-CSS box.
  // Carry any existing value forward as a named preset instead of losing it,
  // and keep it active since it was already in effect.
  const legacy = localStorage.getItem(LEGACY_CSS_KEY)
  if (legacy && legacy.trim()) {
    const imported: ThemePreset = {
      id: 'imported',
      name: 'Imported theme',
      tokens: { light: {}, dark: {} },
      customCss: legacy,
    }
    localStorage.setItem(THEMES_KEY, JSON.stringify([imported]))
    localStorage.setItem(ACTIVE_KEY, imported.id)
    localStorage.removeItem(LEGACY_CSS_KEY)
    return [imported]
  }

  return []
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
  const [themes, setThemes] = useState<ThemePreset[]>(loadThemes)
  const [activeId, setActiveIdState] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY))

  useEffect(() => {
    applyPreset(themes.find((t) => t.id === activeId), mode)
  }, [activeId, themes, mode])

  const setActiveId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
    setActiveIdState(id)
  }, [])

  const saveTheme = useCallback((theme: ThemePreset) => {
    setThemes((prev) => {
      const next = [...prev.filter((t) => t.id !== theme.id), theme]
      localStorage.setItem(THEMES_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const deleteTheme = useCallback((id: string) => {
    setThemes((prev) => {
      const next = prev.filter((t) => t.id !== id)
      localStorage.setItem(THEMES_KEY, JSON.stringify(next))
      return next
    })
    setActiveIdState((cur) => {
      if (cur !== id) return cur
      localStorage.removeItem(ACTIVE_KEY)
      return null
    })
  }, [])

  return { themes, activeId, setActiveId, saveTheme, deleteTheme }
}
