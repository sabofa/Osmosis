import type { ThemeManifest } from '../manifest.js'
import { osmosis } from './osmosis.js'
import { forest } from './forest.js'
import { ocean } from './ocean.js'
import { ember } from './ember.js'
import { wsClean } from './ws-clean.js'

export const BUILTINS: readonly ThemeManifest[] = [osmosis, forest, ocean, ember, wsClean]
export const DEFAULT_THEME_ID = 'builtin:osmosis'
export { DEFAULT_WORKSPACE_THEME_ID } from '../manifest.js'
export const REMOVED_BUILTINS = ['builtin:slate', 'builtin:plum'] as const

export function isBuiltinId(id: string): boolean {
  return id.startsWith('builtin:')
}

export function builtinById(id: string): ThemeManifest | undefined {
  return BUILTINS.find((b) => b.id === id)
}
