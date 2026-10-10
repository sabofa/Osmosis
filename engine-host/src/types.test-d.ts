// Type-level test: compiled by `tsc --noEmit` (see the package typecheck script).
import type { DocumentTokens, EngineHost, EngineLayer, ToolbarCommand } from './index.js'

declare const doc: DocumentTokens

const cmd: ToolbarCommand = { id: 'bold', label: 'Bold', icon: 'bold', group: 'text', enabled: true, active: false, run: () => {} }

export const host: EngineHost = {
  tokens: doc,
  icons: { kind: 'builtin', slug: 'retro' },
  components: { button: { '--radius': '4px' } },
  toolbar: { publishCommands: (cmds) => { void cmds }, clear: () => {} },
  layers: (list) => { void list },
}

export const layer: EngineLayer = { id: 'sheet', label: 'Sheet', token: 'doc-sheet-alpha', paper: 'blackboard', minOverride: 0.5 }

// @ts-expect-error unknown field on EngineLayer
export const bad: EngineLayer = { id: 'x', label: 'X', token: 'callout-alpha', extra: 1 }

// @ts-expect-error toolbar is required
export const noToolbar: EngineHost = { tokens: doc, icons: { kind: 'default' }, layers: () => {} }

void cmd
