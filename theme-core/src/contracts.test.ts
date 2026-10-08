import { describe, expect, it } from 'vitest'
import { toDocumentTokens, toGraphThemeSource } from './contracts.js'
import { normalise, type Mode } from './manifest.js'
import { resolve } from './resolve.js'

const styles = { x: 1 }
const boards = { blackboard: '#1d2a24' }
const a = normalise({ id: 'a', name: 'A' })
const b = normalise({ id: 'b', name: 'B', seeds: { light: { canvas: '#eef1e5', ink: '#17170f', accent: '#2f7a4f' } }, graph: { boards, styles } })
const modes: Mode[] = ['light', 'dark']

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0
const allStrings = (o: unknown): boolean =>
  Array.isArray(o) ? o.every(allStrings) : typeof o === 'object' && o !== null ? Object.values(o).every(allStrings) : nonEmpty(o)

describe('contracts', () => {
  for (const m of [a, b]) for (const mode of modes) {
    const r = resolve(m)
    it(`${m.id}/${mode} graph complete`, () => {
      const g = toGraphThemeSource(r, m, mode)
      expect(g.mode).toBe(mode)
      expect(allStrings(g.colours)).toBe(true)
      expect(allStrings(g.lightColours)).toBe(true)
      expect(g.colours.series).toHaveLength(8)
      expect(g.colours.surface).not.toBe(g.lightColours!.surface)
      expect(g.lettering?.family).toBe(r[mode]['font-display'])
    })
    it(`${m.id}/${mode} document complete`, () => {
      const d = toDocumentTokens(r, m, mode)
      expect(allStrings({ ...d, scale: { ...d.scale, ratio: 'x' } })).toBe(true)
      expect(d.colors.highlight).toHaveLength(4)
      expect(d.key).toBe(r.key)
      expect(d.mode).toBe(mode)
    })
  }
  it('passes boards/styles by reference', () => {
    const g = toGraphThemeSource(resolve(b), b, 'dark')
    expect(g.boards).toBe(boards)
    expect(g.styles).toBe(styles)
    const g2 = toGraphThemeSource(resolve(a), a, 'dark')
    expect(g2.boards).toBeUndefined()
    expect(g2.styles).toBeUndefined()
  })
  it('lightColours is the other mode', () => {
    const r = resolve(a)
    expect(toGraphThemeSource(r, a, 'dark').lightColours!.surface).toBe(r.light['color-surface'])
    expect(toGraphThemeSource(r, a, 'light').lightColours!.surface).toBe(r.dark['color-surface'])
  })
  it('scale ratio', () => {
    const r = resolve(a)
    expect(toDocumentTokens(r, a, 'light').scale.ratio).toBe(1.2)
    const c = normalise({ id: 'c', name: 'C', dials: { typeScale: 1.25 } })
    expect(toDocumentTokens(resolve(c), c, 'light').scale.ratio).toBe(1.25)
  })
  it('throws naming a missing token', () => {
    const r = resolve(a)
    delete r.light['graph-paper']
    expect(() => toGraphThemeSource(r, a, 'light')).toThrow(/graph-paper/)
  })
  it('pins the contract keys', () => {
    const r = resolve(a)
    const g = toGraphThemeSource(r, a, 'light')
    const d = toDocumentTokens(r, a, 'light')
    expect(Object.keys(g.colours)).toEqual(['surface', 'paper', 'ink', 'muted', 'line', 'lineStrong', 'accent', 'accentWash', 'good', 'bad', 'series'])
    expect(Object.keys(d)).toEqual(['mode', 'colors', 'fonts', 'scale', 'key'])
    expect(Object.keys(d.colors)).toEqual(['page', 'text', 'textMuted', 'link', 'rule', 'selection', 'highlight', 'codeBg', 'codeText', 'syntax', 'tableHeader', 'tableStripe', 'accent'])
    expect(Object.keys(d.colors.syntax)).toEqual(['keyword', 'string', 'number', 'comment', 'function', 'type', 'operator', 'punctuation'])
    expect(Object.keys(d.fonts)).toEqual(['body', 'display', 'mono', 'math', 'cjk'])
    expect(Object.keys(d.scale)).toEqual(['base', 'ratio', 'leading', 'measure'])
  })
})
