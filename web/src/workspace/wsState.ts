import { emptyTabs, parseTabState, type TabState } from './tabs'

// What the workspace remembers between visits: the workspace that was open
// (`osmosis:ws:last`) and, per workspace, which files were open in tabs
// (`osmosis:ws:tabs:<rootId>`). localStorage can be absent, full or blocked
// (a private window, cleared site data), and what is in it can be anything, so
// every read and write goes through here, is wrapped in try/catch, and the
// page works the same without it.

// The part of Storage this uses, so a test can hand in a stand-in.
export interface StoreLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// A workspace: a trajectory, a track or a course, or the scratch view of
// unplaced files.
export interface Root {
  id: string
  kind: 'trajectory' | 'track' | 'course' | 'scratch'
  title: string
}

export const SCRATCH: Root = { id: 'scratch', kind: 'scratch', title: 'Scratch' }

export const LAST_KEY = 'osmosis:ws:last'
export const tabsKey = (rootId: string): string => `osmosis:ws:tabs:${rootId}`

function browserStore(): StoreLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readLast(store: StoreLike | null = browserStore()): Root | null {
  try {
    const raw = store?.getItem(LAST_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Root> | null
    if (!v || typeof v.id !== 'string' || typeof v.title !== 'string') return null
    if (v.kind !== 'trajectory' && v.kind !== 'track' && v.kind !== 'course' && v.kind !== 'scratch') return null
    return { id: v.id, kind: v.kind, title: v.title }
  } catch {
    return null
  }
}

export function writeLast(root: Root, store: StoreLike | null = browserStore()): void {
  try {
    store?.setItem(LAST_KEY, JSON.stringify(root))
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export function clearLast(store: StoreLike | null = browserStore()): void {
  try {
    store?.removeItem(LAST_KEY)
  } catch {
    // As above.
  }
}

export function readTabs(rootId: string, store: StoreLike | null = browserStore()): TabState {
  try {
    const raw = store?.getItem(tabsKey(rootId))
    return raw ? parseTabState(JSON.parse(raw)) : emptyTabs
  } catch {
    return emptyTabs
  }
}

export function writeTabs(rootId: string, state: TabState, store: StoreLike | null = browserStore()): void {
  try {
    store?.setItem(tabsKey(rootId), JSON.stringify(state))
  } catch {
    // The tabs just do not come back next time.
  }
}
