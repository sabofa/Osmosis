import { describe, it, expect } from 'vitest'
import { openTab, closeTab, focusTab, retitleTab, parseTabState, type TabState } from './tabs'

const empty: TabState = { tabs: [], active: null }

describe('tabs', () => {
  it('opens, focuses an existing tab instead of duplicating it, and keeps order', () => {
    let s = openTab(empty, { nodeId: 'a', title: 'A' })
    s = openTab(s, { nodeId: 'b', title: 'B' })
    s = openTab(s, { nodeId: 'a', title: 'A again' })
    expect(s.tabs.map((t) => t.nodeId)).toEqual(['a', 'b'])
    expect(s.active).toBe('a')
  })
  it('closing the active tab activates its right neighbour, else its left, else nothing', () => {
    let s = ['a', 'b', 'c'].reduce((acc, id) => openTab(acc, { nodeId: id, title: id }), empty)
    s = focusTab(s, 'b')
    s = closeTab(s, 'b'); expect(s.active).toBe('c')
    s = closeTab(s, 'c'); expect(s.active).toBe('a')
    s = closeTab(s, 'a'); expect(s.active).toBeNull()
  })
  it('marks a tab the tutor opened as directed, without limiting anything else', () => {
    const s = openTab(empty, { nodeId: 'q', title: 'Item', directed: true })
    expect(s.tabs[0].directed).toBe(true)
  })
})

describe('tabs, beyond the basics', () => {
  it('closing a tab that is not active leaves the active one alone', () => {
    let s = ['a', 'b', 'c'].reduce((acc, id) => openTab(acc, { nodeId: id, title: id }), empty)
    s = closeTab(s, 'a')
    expect(s.active).toBe('c')
    expect(s.tabs.map((t) => t.nodeId)).toEqual(['b', 'c'])
  })
  it('ignores a close or a focus for a tab that is not open', () => {
    const s = openTab(empty, { nodeId: 'a', title: 'A' })
    expect(closeTab(s, 'zzz')).toBe(s)
    expect(focusTab(s, 'zzz')).toBe(s)
  })
  it('keeps a tab directed once the tutor has pointed at it, and follows a rename', () => {
    let s = openTab(empty, { nodeId: 'a', title: 'A' })
    s = openTab(s, { nodeId: 'a', title: 'A', directed: true })
    expect(s.tabs[0].directed).toBe(true)
    s = openTab(s, { nodeId: 'a', title: 'A' })
    expect(s.tabs[0].directed).toBe(true)
    s = retitleTab(s, 'a', 'Renamed')
    expect(s.tabs[0].title).toBe('Renamed')
  })
  it('reads back saved state, dropping what is malformed and never activating a missing tab', () => {
    expect(parseTabState(null)).toEqual(empty)
    expect(parseTabState('nope')).toEqual(empty)
    expect(parseTabState({ tabs: 'x' })).toEqual(empty)
    const s = parseTabState({
      tabs: [{ nodeId: 'a', title: 'A', directed: true }, { nodeId: 'a', title: 'dup' }, { nodeId: 3, title: 'bad' }, null, { nodeId: 'b', title: 'B' }],
      active: 'gone',
    })
    expect(s.tabs).toEqual([
      { nodeId: 'a', title: 'A', directed: true },
      { nodeId: 'b', title: 'B', directed: false },
    ])
    expect(s.active).toBe('a')
    expect(parseTabState({ tabs: [{ nodeId: 'b', title: 'B' }], active: 'b' }).active).toBe('b')
  })
})
