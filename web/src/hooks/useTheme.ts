import type { Mode, ModeSource } from 'theme-core'
import { useThemeContext } from '../theme/context'

export type ThemeChoice = ModeSource
export type ResolvedMode = Mode

// Thin view of the ThemeProvider: the persisted light/dark/system/sun choice
// and the mode it resolves to right now (plus the twilight blend).
export function useTheme() {
  const c = useThemeContext()
  return {
    theme: c.source,
    setTheme: c.setSource,
    resolvedMode: c.mode,
    blend: c.blend,
    twilightBlend: c.twilightBlend,
    setTwilightBlend: c.setTwilightBlend,
    location: c.location,
    state: c.state,
    refresh: c.refresh,
  }
}
