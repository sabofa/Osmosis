import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedMode = 'light' | 'dark'

const STORAGE_KEY = 'osmosis:theme'

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
}

function readStored(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Persisted light/dark/system choice. 'system' clears the data-theme attribute
// so the prefers-color-scheme rules in index.css take over. Also resolves the
// *actual* light/dark mode (following the OS when the choice is 'system') so
// theme presets know which of their light/dark token sets to apply.
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStored())
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    (theme === 'system' ? systemPrefersDark() : theme === 'dark') ? 'dark' : 'light'
  )

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') {
      setResolvedMode(theme)
      return
    }
    setResolvedMode(systemPrefersDark() ? 'dark' : 'light')
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolvedMode(mql.matches ? 'dark' : 'light')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((choice: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, choice)
    setThemeState(choice)
  }, [])

  return { theme, setTheme, resolvedMode }
}
