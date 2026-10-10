import { describe, it, expect } from 'vitest'
import {
  INITIAL_EXPAND,
  setActiveGraph,
  expandGraph,
  collapseGraph,
  clampExpand,
  commandTarget,
  canExpandCommand,
  canCollapseCommand,
  escapeDecision,
  dblClickExpands,
  targetInMenu,
  restoreFocusOnCollapse,
} from './expandModel'

describe('expand state', () => {
  it('expand sets expanded and active; collapse keeps active', () => {
    const e = expandGraph(INITIAL_EXPAND, 2)
    expect(e).toEqual({ expanded: 2, active: 2 })
    expect(collapseGraph(e)).toEqual({ expanded: null, active: 2 })
    expect(collapseGraph(INITIAL_EXPAND)).toBe(INITIAL_EXPAND)
  })
  it('active tracking is idempotent', () => {
    const a = setActiveGraph(INITIAL_EXPAND, 1)
    expect(setActiveGraph(a, 1)).toBe(a)
  })
  it('clamp drops vanished ordinals', () => {
    expect(clampExpand({ expanded: 3, active: 3 }, 2)).toEqual({ expanded: null, active: null })
    const ok = { expanded: 1, active: 0 }
    expect(clampExpand(ok, 2)).toBe(ok)
  })
})

describe('command targeting', () => {
  it('uses the active graph, else the only graph, else none', () => {
    expect(commandTarget({ expanded: null, active: 1 }, 3)).toBe(1)
    expect(commandTarget(INITIAL_EXPAND, 1)).toBe(0)
    expect(commandTarget(INITIAL_EXPAND, 2)).toBeNull()
    expect(commandTarget({ expanded: null, active: 5 }, 2)).toBeNull()
    expect(commandTarget(INITIAL_EXPAND, 0)).toBeNull()
  })
  it('expand/collapse enablement', () => {
    expect(canExpandCommand({ expanded: null, active: 0 }, 2)).toBe(true)
    expect(canExpandCommand(INITIAL_EXPAND, 2)).toBe(false)
    expect(canExpandCommand({ expanded: 0, active: 0 }, 2)).toBe(false)
    expect(canCollapseCommand({ expanded: 0, active: 0 })).toBe(true)
    expect(canCollapseCommand(INITIAL_EXPAND)).toBe(false)
  })
})

describe('escape and double-click decisions', () => {
  it('Escape collapses only while expanded', () => {
    expect(escapeDecision('Escape', { expanded: 0, active: 0 })).toBe('collapse')
    expect(escapeDecision('Escape', INITIAL_EXPAND)).toBe('ignore')
    expect(escapeDecision('Enter', { expanded: 0, active: 0 })).toBe('ignore')
  })
  it('double-click: frame always, plot only when locked, never when expanded', () => {
    expect(dblClickExpands(false, false, false)).toBe(true)
    expect(dblClickExpands(true, false, false)).toBe(false)
    expect(dblClickExpands(true, true, false)).toBe(true)
    expect(dblClickExpands(false, true, true)).toBe(false)
  })
  it('Esc aimed at an open menu closes the menu, not the graph', () => {
    expect(escapeDecision('Escape', { expanded: 0, active: 0 }, true)).toBe('ignore')
    expect(escapeDecision('Escape', { expanded: 0, active: 0 }, false)).toBe('collapse')
  })
  it('double-click on a button never expands', () => {
    expect(dblClickExpands(false, false, false, true)).toBe(false)
    expect(dblClickExpands(false, true, false, true)).toBe(false)
  })
  it('detects menu targets', () => {
    const mk = (hit: boolean) => ({ closest: (sel: string) => (hit && sel.includes('zoom-menu') ? {} : null) })
    expect(targetInMenu(mk(true) as unknown as EventTarget)).toBe(true)
    expect(targetInMenu(mk(false) as unknown as EventTarget)).toBe(false)
    expect(targetInMenu(null)).toBe(false)
    expect(targetInMenu({} as EventTarget)).toBe(false)
  })
  it('restores focus only from the viewer or body', () => {
    expect(restoreFocusOnCollapse(true, false)).toBe(true)
    expect(restoreFocusOnCollapse(false, true)).toBe(true)
    expect(restoreFocusOnCollapse(false, false)).toBe(false)
  })
})
