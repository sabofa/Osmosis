// Named presets in localStorage (spec §6, L5). Every access is inside a
// try/catch: a private window, blocked site data or a full quota must leave
// the lab working, with presets that simply do not persist. The functions take
// the storage as an argument so the graph-engine suite can drive a fake one.

import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import { paramsFromData } from './paintLabParams'

export const PRESETS_KEY = 'osmosis.paintLab.presets'
const NAME_MAX = 60

export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

// localStorage, or null where the browser will not hand it over.
export function browserStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readAll(storage: PresetStorage | null): Map<string, PaintParams> {
  const all = new Map<string, PaintParams>()
  if (!storage) return all
  try {
    const text = storage.getItem(PRESETS_KEY)
    if (!text) return all
    const data: unknown = JSON.parse(text)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return all
    for (const [name, value] of Object.entries(data)) {
      // An older or hand-edited preset is read over the defaults, like any JSON.
      const parsed = paramsFromData(value)
      if (parsed.ok) all.set(name, parsed.params)
    }
  } catch {
    return new Map()
  }
  return all
}

function writeAll(all: Map<string, PaintParams>, storage: PresetStorage | null): boolean {
  if (!storage) return false
  try {
    storage.setItem(PRESETS_KEY, JSON.stringify(Object.fromEntries(all)))
    return true
  } catch {
    return false
  }
}

// Every saved preset, by name, in the order they were first saved.
export function readPresets(storage: PresetStorage | null = browserStorage()): Record<string, PaintParams> {
  return Object.fromEntries(readAll(storage))
}

// Save under a name (trimmed; saving over a name replaces it in place).
// False when the name is empty or the storage would not take it.
export function savePreset(name: string, params: PaintParams, storage: PresetStorage | null = browserStorage()): boolean {
  const clean = name.trim().slice(0, NAME_MAX)
  if (!clean) return false
  const all = readAll(storage)
  all.set(clean, params)
  return writeAll(all, storage)
}

export function deletePreset(name: string, storage: PresetStorage | null = browserStorage()): boolean {
  const all = readAll(storage)
  if (!all.delete(name)) return false
  return writeAll(all, storage)
}
