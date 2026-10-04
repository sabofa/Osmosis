import { describe, it, expect } from 'vitest'
import { SCRATCH, clearLast, readLast, readTabs, tabsKey, writeLast, writeTabs, type StoreLike } from './wsState'

function memory(initial: Record<string, string> = {}): StoreLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  }
}

// A store that refuses everything, the way a blocked-storage browser does.
const broken: StoreLike = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
  removeItem: () => { throw new Error('denied') },
}

describe('workspace state in localStorage', () => {
  it('remembers the last workspace and forgets it again', () => {
    const s = memory()
    expect(readLast(s)).toBeNull()
    writeLast({ id: 't1', kind: 'track', title: 'quant' }, s)
    expect(s.data['osmosis:ws:last']).toBeDefined()
    expect(readLast(s)).toEqual({ id: 't1', kind: 'track', title: 'quant' })
    clearLast(s)
    expect(readLast(s)).toBeNull()
  })

  it('remembers a trajectory as the workspace too, along with a track, a course and the scratch view', () => {
    const s = memory()
    for (const root of [
      { id: 'tr1', kind: 'trajectory' as const, title: 'quant' },
      { id: 'k1', kind: 'track' as const, title: 'Year 1' },
      { id: 'c1', kind: 'course' as const, title: 'Calc' },
      SCRATCH,
    ]) {
      writeLast(root, s)
      expect(readLast(s)).toEqual(root)
    }
  })

  it('keeps each workspace its own tabs under its own key', () => {
    const s = memory()
    writeTabs('t1', { tabs: [{ nodeId: 'a', title: 'A', directed: false }], active: 'a' }, s)
    expect(Object.keys(s.data)).toEqual(['osmosis:ws:tabs:t1'])
    expect(tabsKey('t1')).toBe('osmosis:ws:tabs:t1')
    expect(readTabs('t1', s).active).toBe('a')
    expect(readTabs('t2', s)).toEqual({ tabs: [], active: null })
  })

  it('treats a stored value that is not what was written as nothing', () => {
    expect(readLast(memory({ 'osmosis:ws:last': '{not json' }))).toBeNull()
    expect(readLast(memory({ 'osmosis:ws:last': JSON.stringify({ id: 1, kind: 'track', title: 'x' }) }))).toBeNull()
    expect(readLast(memory({ 'osmosis:ws:last': JSON.stringify({ id: 'x', kind: 'folder', title: 'x' }) }))).toBeNull()
    expect(readLast(memory({ 'osmosis:ws:last': JSON.stringify({ id: 'x', kind: 'file', title: 'x' }) }))).toBeNull()
    expect(readTabs('t1', memory({ 'osmosis:ws:tabs:t1': 'garbage' }))).toEqual({ tabs: [], active: null })
  })

  it('never throws when storage is unavailable', () => {
    expect(readLast(broken)).toBeNull()
    expect(readTabs('t1', broken)).toEqual({ tabs: [], active: null })
    expect(() => writeLast({ id: 't1', kind: 'course', title: 'c' }, broken)).not.toThrow()
    expect(() => clearLast(broken)).not.toThrow()
    expect(() => writeTabs('t1', { tabs: [], active: null }, broken)).not.toThrow()
    expect(readLast(null)).toBeNull()
  })
})
