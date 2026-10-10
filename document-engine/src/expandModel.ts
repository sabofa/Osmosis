// Pure state helpers for graph-embed expand. Ordinals count graph fences in
// document order (the same ordinal TextContent keys them by).

export interface ExpandState {
  // The graph filling the viewer, if any.
  expanded: number | null
  // The last graph hovered or focused; what toolbar commands target.
  active: number | null
}

export const INITIAL_EXPAND: ExpandState = { expanded: null, active: null }

export function setActiveGraph(s: ExpandState, ordinal: number | null): ExpandState {
  return s.active === ordinal ? s : { ...s, active: ordinal }
}

// Expanding also makes that graph the active one.
export function expandGraph(s: ExpandState, ordinal: number): ExpandState {
  return s.expanded === ordinal && s.active === ordinal ? s : { expanded: ordinal, active: ordinal }
}

export function collapseGraph(s: ExpandState): ExpandState {
  return s.expanded === null ? s : { ...s, expanded: null }
}

// Drops ordinals that no longer exist (the text lost graph fences).
export function clampExpand(s: ExpandState, count: number): ExpandState {
  const expanded = s.expanded !== null && s.expanded < count ? s.expanded : null
  const active = s.active !== null && s.active < count ? s.active : null
  return expanded === s.expanded && active === s.active ? s : { expanded, active }
}

// Which graph a toolbar command acts on: the active one, or the only one.
export function commandTarget(s: ExpandState, count: number): number | null {
  if (s.active !== null && s.active < count) return s.active
  return count === 1 ? 0 : null
}

export function canExpandCommand(s: ExpandState, count: number): boolean {
  return s.expanded === null && commandTarget(s, count) !== null
}

export function canCollapseCommand(s: ExpandState): boolean {
  return s.expanded !== null
}

// Esc collapses an expanded graph and nothing else sees it.
// An Escape aimed at an open menu closes that menu first (`inMenu`).
export function escapeDecision(key: string, s: ExpandState, inMenu = false): 'collapse' | 'ignore' {
  return key === 'Escape' && s.expanded !== null && !inMenu ? 'collapse' : 'ignore'
}

// True when an event target sits inside a menu popup (zoom menu, any role=menu).
export function targetInMenu(target: EventTarget | null): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null
  return !!el && typeof el.closest === 'function' && !!el.closest('.document-viewer-zoom-menu, [role="menu"]')
}

// On collapse, focus returns to the graph's expand button only when focus was
// in the viewer or had fallen to the body (not when the user moved elsewhere).
export function restoreFocusOnCollapse(activeInViewer: boolean, activeIsBody: boolean): boolean {
  return activeInViewer || activeIsBody
}

// Double-click on the embed: the live plot keeps its own double-click (reset)
// unless the embed is locked, where gestures are blocked and the whole embed
// is a hit target.
// A double-click on a button (the expand button itself) never expands.
export function dblClickExpands(insidePlot: boolean, locked: boolean, alreadyExpanded: boolean, onButton = false): boolean {
  if (alreadyExpanded || onButton) return false
  return locked || !insidePlot
}
