import { describe, expect, it } from 'vitest'
import {
  highlightAccent,
  highlightOf,
  highlightOverlay,
  outermostMatches,
  selectedItems,
} from './highlight'
import type { FigureTarget } from './hitItems'

const t = (statement: number, object: string | null): FigureTarget => ({ statement, object })

describe('highlightOf', () => {
  it('matches an element by statement and object when the target names both', () => {
    expect(highlightOf('2', 'AB', [t(2, 'AB')], [])).toEqual({ hovered: true, selected: false })
    expect(highlightOf('2', 'AC', [t(2, 'AB')], [])).toEqual({ hovered: false, selected: false })
    expect(highlightOf('3', 'AB', [t(2, 'AB')], [])).toEqual({ hovered: false, selected: false })
  })

  it('matches every element of the statement when the target has no object', () => {
    expect(highlightOf('2', 'AB', [t(2, null)], [])).toEqual({ hovered: true, selected: false })
    expect(highlightOf('2', null, [t(2, null)], [])).toEqual({ hovered: true, selected: false })
    expect(highlightOf('4', 'AB', [t(2, null)], [])).toEqual({ hovered: false, selected: false })
  })

  it('does not match an element with no object against a target that names one', () => {
    expect(highlightOf('2', null, [t(2, 'AB')], [])).toEqual({ hovered: false, selected: false })
  })

  it('judges hover and selection independently, and an element can be both', () => {
    expect(highlightOf('2', 'AB', [t(2, 'AB')], [t(2, 'AB')])).toEqual({ hovered: true, selected: true })
    expect(highlightOf('2', 'AB', [], [t(2, 'AB')])).toEqual({ hovered: false, selected: true })
  })

  it('matches any of several targets, as a label and its side light up together', () => {
    const targets = [t(2, 'AB'), t(2, 'label-AB')]
    expect(highlightOf('2', 'label-AB', targets, [])).toEqual({ hovered: true, selected: false })
  })

  it('is false for an element with no statement at all', () => {
    expect(highlightOf(null, 'givens', [t(2, null)], [t(2, null)])).toEqual({ hovered: false, selected: false })
  })

  it('reads the statement as the attribute text the renderer wrote', () => {
    expect(highlightOf('12', 'x', [t(12, 'x')], [])).toEqual({ hovered: true, selected: false })
    expect(highlightOf('1', 'x', [t(12, 'x')], [])).toEqual({ hovered: false, selected: false })
  })
})

describe('highlightOf: the givens panel', () => {
  // The panel carries data-object="givens" and no data-statement, so it can
  // only be matched by the item id.
  const ids = (hovered: string | null, selected: string | null) => ({ hovered, selected: selected === null ? [] : [selected] })

  it('lights the panel when the givens item is hovered or selected', () => {
    expect(highlightOf(null, 'givens', [], [], ids('givens', null))).toEqual({ hovered: true, selected: false })
    expect(highlightOf(null, 'givens', [], [], ids(null, 'givens'))).toEqual({ hovered: false, selected: true })
  })

  it('does not light the panel for any other item, or when nothing is pointed at', () => {
    expect(highlightOf(null, 'givens', [t(2, null)], [t(2, null)], ids('A', 'A'))).toEqual({ hovered: false, selected: false })
    expect(highlightOf(null, 'givens', [], [], ids(null, null))).toEqual({ hovered: false, selected: false })
    expect(highlightOf(null, 'givens', [], [])).toEqual({ hovered: false, selected: false })
  })

  it('lights only the panel, not every element, for the givens id', () => {
    expect(highlightOf('2', 'AB', [], [], ids('givens', 'givens'))).toEqual({ hovered: false, selected: false })
    expect(highlightOf(null, 'AB', [], [], ids('givens', 'givens'))).toEqual({ hovered: false, selected: false })
  })
})

describe('highlightOf: several selected', () => {
  it('lights the givens panel when the givens item is among the selected', () => {
    const ids = (selected: string[]) => ({ hovered: null, selected })
    expect(highlightOf(null, 'givens', [], [], ids(['A', 'givens', 'B']))).toEqual({ hovered: false, selected: true })
    expect(highlightOf(null, 'givens', [], [], ids(['A', 'B']))).toEqual({ hovered: false, selected: false })
    expect(highlightOf(null, 'givens', [], [], ids([]))).toEqual({ hovered: false, selected: false })
  })

  it('an element lights for any of several selected targets', () => {
    const picked = [t(2, 'AB'), t(5, null)]
    expect(highlightOf('2', 'AB', [], picked)).toEqual({ hovered: false, selected: true })
    expect(highlightOf('5', 'zz', [], picked)).toEqual({ hovered: false, selected: true })
    expect(highlightOf('3', 'AB', [], picked)).toEqual({ hovered: false, selected: false })
  })
})

describe('outermostMatches', () => {
  // A tiny tree: node -> parent, as the DOM gives them.
  interface N {
    name: string
    parent: N | null
  }
  const node = (name: string, parent: N | null = null): N => ({ name, parent })
  const parentOf = (n: N) => n.parent
  const names = (list: N[]) => list.map((n) => n.name)

  it('keeps a match whose ancestors are not matched', () => {
    const root = node('root')
    const g = node('g', root)
    const a = node('a', g)
    expect(names(outermostMatches([a], parentOf))).toEqual(['a'])
  })

  it('drops a match with a matched ancestor, however deep', () => {
    const root = node('root')
    const g = node('g', root)
    const sub = node('sub', g)
    const path = node('path', sub)
    expect(names(outermostMatches([g, sub, path], parentOf))).toEqual(['g'])
    // The middle one is skipped for the group, even if nothing in between matched.
    expect(names(outermostMatches([g, path], parentOf))).toEqual(['g'])
  })

  it('keeps unrelated matches, and siblings, in the order given', () => {
    const root = node('root')
    const g1 = node('g1', root)
    const g2 = node('g2', root)
    const p1 = node('p1', g1)
    const p2 = node('p2', g2)
    expect(names(outermostMatches([g1, p1, g2, p2], parentOf))).toEqual(['g1', 'g2'])
    expect(names(outermostMatches([p2, p1], parentOf))).toEqual(['p2', 'p1'])
  })

  it('a matched element does not hide the descendants of a sibling', () => {
    const root = node('root')
    const g1 = node('g1', root)
    const g2 = node('g2', root)
    const p2 = node('p2', g2)
    expect(names(outermostMatches([g1, p2], parentOf))).toEqual(['g1', 'p2'])
  })

  it('an unmatched element between two matches does not stop the outer one winning', () => {
    const root = node('root')
    const outer = node('outer', root)
    const mid = node('mid', outer)
    const inner = node('inner', mid)
    expect(names(outermostMatches([outer, inner], parentOf))).toEqual(['outer'])
  })

  it('handles nothing, and many matches in one group, cheaply', () => {
    expect(outermostMatches([], parentOf)).toEqual([])
    const root = node('root')
    const g = node('g', root)
    const paths = Array.from({ length: 2000 }, (_, i) => node(`p${i}`, g))
    expect(names(outermostMatches([g, ...paths], parentOf))).toEqual(['g'])
  })
})

describe('highlightOverlay', () => {
  const accent = '#3b6fd8'
  const items = [
    { id: 'a', shape: { kind: 'segment' as const, a: { x: 0, y: 0 }, b: { x: 10, y: 5 } } },
    { id: 'p', shape: { kind: 'point' as const, at: { x: 3, y: 4 } } },
    { id: 'c', shape: { kind: 'circle' as const, center: { x: 1, y: 2 }, radius: 3 } },
    { id: 'poly', shape: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] } },
    { id: 'arc', shape: { kind: 'arc' as const, center: { x: 0, y: 0 }, radius: 2, start: 0, end: Math.PI / 2 } },
    { id: 'arc', shape: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] } },
    { id: 'lab', shape: { kind: 'rect' as const, rect: { x: 0, y: 0, width: 5, height: 2 } } },
    { id: 'givens', shape: { kind: 'rect' as const, rect: { x: 1, y: 1, width: 5, height: 2 } } },
  ]

  it('is empty when nothing is pointed at', () => {
    expect(highlightOverlay(items, null, [], accent)).toBe('')
    expect(highlightOverlay(items, 'missing', ['missing'], accent)).toBe('')
  })

  it('draws plain stroked shapes that keep their pixel width at any zoom, with no filter', () => {
    const svg = highlightOverlay(items, 'a', [], accent)
    expect(svg).toContain('d="M0 0L10 5"')
    expect(svg).toContain('vector-effect="non-scaling-stroke"')
    expect(svg).toContain('fill="none"')
    expect(svg).not.toContain('filter')
    expect(svg).toContain('pointer-events="none"')
  })

  it('draws a selection as a wide soft stroke under a thin core, and hover over the top', () => {
    const svg = highlightOverlay(items, 'a', ['a'], accent)
    const widths = [...svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => Number(m[1]))
    expect(widths).toEqual([8, 2.5, 3.5])
  })

  it('draws every selected id, in order', () => {
    const svg = highlightOverlay(items, null, ['p', 'a'], accent)
    expect(svg.indexOf('M3 4L3 4')).toBeLessThan(svg.indexOf('M0 0L10 5'))
  })

  it('draws a point as a round dot heavier than a line', () => {
    const svg = highlightOverlay(items, null, ['p'], accent)
    expect(svg).toContain('M3 4L3 4')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('stroke-width="20"')
  })

  it('draws a circle as a circle, a polygon closed, and an arc as an arc', () => {
    expect(highlightOverlay(items, 'c', [], accent)).toContain('<circle cx="1" cy="2" r="3"')
    expect(highlightOverlay(items, 'poly', [], accent)).toContain('d="M0 0L4 0L0 4Z"')
    const arc = highlightOverlay(items, 'arc', [], accent)
    expect(arc).toMatch(/d="M2 0A2 2 0 0 1 [-0-9.e]+ 2"/)
    // Its sector is an item of the same id, drawn too.
    expect(arc).toContain('M0 0L2 0L0 2Z')
  })

  it('draws an arc running the other way with the other sweep flag, and a full turn as a circle', () => {
    const back = [{ id: 'x', shape: { kind: 'arc' as const, center: { x: 0, y: 0 }, radius: 2, start: Math.PI / 2, end: 0 } }]
    expect(highlightOverlay(back, 'x', [], accent)).toContain('A2 2 0 0 0 2 0')
    const full = [{ id: 'x', shape: { kind: 'arc' as const, center: { x: 0, y: 0 }, radius: 2, start: 0, end: 7 } }]
    expect(highlightOverlay(full, 'x', [], accent)).toContain('<circle')
  })

  it('outlines the givens panel but not the rect of a label', () => {
    expect(highlightOverlay(items, 'givens', [], accent)).toContain('d="M1 1L6 1L6 3L1 3Z"')
    expect(highlightOverlay(items, 'lab', [], accent)).toBe('')
  })
})

describe('highlightAccent', () => {
  it('is the theme accent, trimmed, or the default blue', () => {
    expect(highlightAccent('  #c04040 ')).toBe('#c04040')
    expect(highlightAccent('')).toBe('#3b6fd8')
    expect(highlightAccent('   ')).toBe('#3b6fd8')
    expect(highlightAccent(null)).toBe('#3b6fd8')
  })
})

describe('selectedItems', () => {
  const item = (id: string, statement: number, author?: { x: number; y: number }) => ({
    id,
    shape: { kind: 'point' as const, at: { x: 0, y: 0 } },
    targets: [{ statement, object: id }],
    ...(author ? { author } : {}),
  })
  const items = [item('A', 1, { x: 1, y: 2 }), item('B', 2), item('A', 1), item('C', 3, { x: 5, y: 6 })]

  it('reports each selected id, in the order selected', () => {
    expect(selectedItems(items, ['C', 'B']).map((s) => s.id)).toEqual(['C', 'B'])
  })

  it('prefers the item with author coordinates when a label shares the id', () => {
    expect(selectedItems(items, ['A'])[0].author).toEqual({ x: 1, y: 2 })
    // Even when the label comes first.
    expect(selectedItems([item('A', 1), item('A', 1, { x: 1, y: 2 })], ['A'])[0].author).toEqual({ x: 1, y: 2 })
  })

  it('leaves out an id that names nothing, and answers empty for an empty selection', () => {
    expect(selectedItems(items, ['gone', 'B']).map((s) => s.id)).toEqual(['B'])
    expect(selectedItems(items, [])).toEqual([])
  })

  it('carries the targets', () => {
    expect(selectedItems(items, ['B'])[0].targets).toEqual([{ statement: 2, object: 'B' }])
  })
})
