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
      expect(allStrings({ ...d, scale: { ...d.scale, ratio: 'x' }, alphas: {} })).toBe(true)
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
    expect(Object.keys(d)).toEqual(['mode', 'colors', 'fonts', 'scale', 'key', 'alphas'])
    expect(Object.keys(d.alphas)).toEqual(['sheet', 'surface', 'callout', 'media'])
    expect(Object.keys(g.alphas!)).toEqual(['paper', 'grid', 'region', 'callout', 'docSurface'])
    expect(Object.keys(d.colors)).toEqual(['page', 'text', 'textMuted', 'link', 'rule', 'selection', 'highlight', 'codeBg', 'codeText', 'syntax', 'tableHeader', 'tableStripe', 'accent'])
    expect(Object.keys(d.colors.syntax)).toEqual(['keyword', 'string', 'number', 'comment', 'function', 'type', 'operator', 'punctuation'])
    expect(Object.keys(d.fonts)).toEqual(['body', 'display', 'mono', 'math', 'cjk'])
    expect(Object.keys(d.scale)).toEqual(['base', 'ratio', 'leading', 'measure'])
  })

  describe('alphas', () => {
    const mk = (dials: Record<string, number> = {}, any: Record<string, string> = {}) =>
      normalise({ id: 'z', name: 'Z', dials, overrides: { any } } as never)
    const docA = (m: ReturnType<typeof mk>, mode: Mode = 'light') => toDocumentTokens(resolve(m), m, mode).alphas
    it('default theme', () => {
      expect(docA(a)).toEqual({ sheet: 1, surface: 0.9, callout: 0.92, media: 1 })
      const g = toGraphThemeSource(resolve(a), a, 'light').alphas!
      expect(g).toEqual({ paper: 1, grid: 1, region: 0.18, callout: 0.92, docSurface: 0.9 })
    })
    it('dial 1 gives the floors', () => {
      expect(docA(mk({ translucency: 1 }))).toEqual({ sheet: 0.55, surface: 0.6, callout: 0.7, media: 0.7 })
      const g = toGraphThemeSource(resolve(mk({ translucency: 1 })), mk({ translucency: 1 }), 'dark').alphas!
      expect(g).toEqual({ paper: 0.25, grid: 0.15, region: 0.18, callout: 0.7, docSurface: 0.6 })
    })
    it('media is never below the sheet', () => {
      expect(docA(mk({}, { 'doc-sheet-alpha': '0.6' })).media).toBe(0.95)
      expect(docA(mk({}, { 'doc-sheet-alpha': '0.6', 'doc-media-alpha': '0.65' })).media).toBe(0.7)
      expect(docA(mk({}, { 'doc-sheet-alpha': '0.8', 'doc-media-alpha': '0.75' })).media).toBe(0.8)
    })
    it('finite numbers in [0,1], both modes', () => {
      for (const m of [a, b, mk({ translucency: 0.5 })]) for (const mode of modes) {
        const vals = [...Object.values(docA(m, mode)), ...Object.values(toGraphThemeSource(resolve(m), m, mode).alphas!)]
        for (const v of vals) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
        expect(docA(m, 'light')).toEqual(docA(m, 'dark'))
      }
    })
  })
})
