import { createContext, useContext } from 'react'
import type { Location, Mode, ModeSource, ThemeManifest } from 'theme-core'
import type { ThemeRecord } from '../lib/api'
import type { ThemePreset } from '../hooks/useThemePresets'

export type CustomTheme = Pick<ThemeRecord, 'id' | 'name' | 'manifest' | 'updated_at'>

export interface ThemeContextValue {
  source: ModeSource
  setSource(s: ModeSource): void
  twilightBlend: boolean
  setTwilightBlend(b: boolean): void
  mode: Mode
  blend: number
  effectiveSource: ModeSource
  location: Location | null
  setLocation(loc: Location | null): Promise<boolean>
  custom: CustomTheme[]
  activeId: string | null
  setActiveId(id: string | null): void
  activeWorkspaceId: string | null
  setActiveWorkspaceId(id: string | null): void
  previewManifest(m: ThemeManifest | null): void
  saveTheme(p: ThemePreset): Promise<boolean>
  saveManifest(m: ThemeManifest): Promise<boolean>
  deleteTheme(id: string): Promise<boolean>
  presets: ThemePreset[]
  error: string | null
  refresh(): Promise<void>
  state(): { source: ModeSource; effectiveSource: ModeSource; mode: Mode; blend: number; twilightBlend: boolean }
}

export const Ctx = createContext<ThemeContextValue | null>(null)

export function useThemeContext(): ThemeContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme / useThemePresets need a <ThemeProvider>')
  return v
}
