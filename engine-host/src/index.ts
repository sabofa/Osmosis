/** Types-only contract between the app shell and the engines (06-engine-host 2/3/4/5). No runtime code. */
import type { DocumentTokens, GraphThemeSource, IconSheetRef } from 'theme-core'

export type { DocumentTokens, GraphThemeSource, DocumentAlphas, GraphAlphas, IconSheetRef } from 'theme-core'

/** One transparency layer an engine exposes to the shell's layer controls. */
export interface EngineLayer {
  id: string
  label: string
  /** The layer token it edits, e.g. `doc-sheet-alpha`. */
  token: string
  /** Paper kind that raises the floor (graph boards). */
  paper?: string
  minOverride?: number
}

export interface ToolbarCommand {
  id: string
  label: string
  icon: string
  group: string
  enabled: boolean
  active: boolean
  shortcut?: string
  run: () => void
}

export interface ToolbarSlot {
  publishCommands(cmds: ToolbarCommand[]): void
  clear(): void
}

/** Per-component look: CSS custom property name -> value. */
export type ComponentLook = Record<string, string>

export interface EngineHost {
  tokens: DocumentTokens | GraphThemeSource
  icons: IconSheetRef
  components?: Record<string, ComponentLook>
  toolbar: ToolbarSlot
  layers: (list: EngineLayer[]) => void
}
