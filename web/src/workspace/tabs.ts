// The tab bar's state, as pure functions so the rules are tested without a DOM.
//
// A tab is a file's node id: opening a file that is already open focuses its
// tab and never adds a second one. `directed` marks a tab the tutor opened. It
// guides, it never limits: nothing here refuses to open, close or focus a tab
// because of it.

export interface Tab {
  nodeId: string
  title: string
  directed: boolean
}

export interface TabState {
  tabs: Tab[]
  active: string | null
}

export const emptyTabs: TabState = { tabs: [], active: null }

export function openTab(s: TabState, t: { nodeId: string; title: string; directed?: boolean }): TabState {
  const existing = s.tabs.find((x) => x.nodeId === t.nodeId)
  if (existing) {
    // Focus it where it is. The name may have changed since it opened, and a
    // tutor pointing at a tab Ben already had open still marks it directed.
    const tabs = s.tabs.map((x) => (x === existing ? { ...x, title: t.title, directed: x.directed || !!t.directed } : x))
    return { tabs, active: t.nodeId }
  }
  return { tabs: [...s.tabs, { nodeId: t.nodeId, title: t.title, directed: !!t.directed }], active: t.nodeId }
}

export function focusTab(s: TabState, nodeId: string): TabState {
  if (!s.tabs.some((x) => x.nodeId === nodeId)) return s
  return s.active === nodeId ? s : { ...s, active: nodeId }
}

// Closing the active tab activates its right neighbour, else its left, else
// nothing. Closing any other tab leaves the active one alone.
export function closeTab(s: TabState, nodeId: string): TabState {
  const at = s.tabs.findIndex((x) => x.nodeId === nodeId)
  if (at === -1) return s
  const tabs = s.tabs.filter((x) => x.nodeId !== nodeId)
  if (s.active !== nodeId) return { tabs, active: s.active }
  const next = tabs[at] ?? tabs[at - 1] ?? null
  return { tabs, active: next ? next.nodeId : null }
}

// A tab keeps the name its file had where Ben opened it; a rename here changes
// that name, so the tab follows.
export function retitleTab(s: TabState, nodeId: string, title: string): TabState {
  if (!s.tabs.some((x) => x.nodeId === nodeId && x.title !== title)) return s
  return { ...s, tabs: s.tabs.map((x) => (x.nodeId === nodeId ? { ...x, title } : x)) }
}

// Tabs come back from localStorage, which anything may have written to or an
// older version may have shaped differently. Keep what is well formed, drop
// the rest, and never leave `active` pointing at a tab that is not there.
export function parseTabState(raw: unknown): TabState {
  if (raw === null || typeof raw !== 'object') return emptyTabs
  const { tabs: rawTabs, active } = raw as { tabs?: unknown; active?: unknown }
  if (!Array.isArray(rawTabs)) return emptyTabs
  const tabs: Tab[] = []
  for (const t of rawTabs) {
    if (t === null || typeof t !== 'object') continue
    const { nodeId, title, directed } = t as { nodeId?: unknown; title?: unknown; directed?: unknown }
    if (typeof nodeId !== 'string' || typeof title !== 'string') continue
    if (tabs.some((x) => x.nodeId === nodeId)) continue
    tabs.push({ nodeId, title, directed: directed === true })
  }
  const stillThere = typeof active === 'string' && tabs.some((x) => x.nodeId === active)
  return { tabs, active: stillThere ? (active as string) : (tabs[0]?.nodeId ?? null) }
}
