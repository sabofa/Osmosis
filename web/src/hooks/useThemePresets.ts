import type { ThemeManifest } from 'theme-core'
import { useThemeContext } from '../theme/context'
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
  manifest?: ThemeManifest
  layer?: 'workspace' | 'ambience' | null
}

// Themes live on the server (canonical); the ThemeProvider owns the list, the
// active id and the applied stylesheet. This hook is the editor/Settings view
// of it, in the legacy 8-token preset shape. `_mode` is unused: the provider
// already applies the resolved mode.
export function useThemePresets(_mode?: ResolvedMode) {
  const c = useThemeContext()
  return {
    themes: c.presets,
    ambienceThemes: c.presets.filter((p) => p.layer !== 'workspace'),
    workspaceThemes: c.presets.filter((p) => p.layer === 'workspace' || !p.layer),
    activeId: c.activeId,
    setActiveId: c.setActiveId,
    activeWorkspaceId: c.activeWorkspaceId,
    setActiveWorkspaceId: c.setActiveWorkspaceId,
    saveTheme: c.saveTheme,
    saveManifest: c.saveManifest,
    previewManifest: c.previewManifest,
    deleteTheme: c.deleteTheme,
    error: c.error,
    refresh: c.refresh,
  }
}
