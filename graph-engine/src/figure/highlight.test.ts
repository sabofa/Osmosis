import { describe, expect, it } from 'vitest'
import {
  highlightAccent,
  highlightDefs,
  highlightFilterRegion,
  highlightFilterSizes,
  highlightFilterValue,
  highlightOf,
  HIGHLIGHT_REACH_PX,
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

describe('highlightFilterSizes', () => {
  // The filter lengths are in drawing units, which grow with the zoom, so they
  // are written as (target px) / (px per unit): the on-screen size is constant.
  it('is the same on screen at every zoom', () => {
    const at = (ppu: number) => {
      const sizes = highlightFilterSizes(ppu)
      return { hover: sizes.hoverRadius * ppu, halo: sizes.haloDeviation * ppu }
    }
    const base = at(1)
    for (const ppu of [0.1, 0.5, 1, 2.5, 64]) {
      expect(at(ppu).hover).toBeCloseTo(base.hover, 10)
      expect(at(ppu).halo).toBeCloseTo(base.halo, 10)
    }
  })

  it('is about 0.75 px of dilation for hover and a halo about 3 px wide for selection', () => {
    expect(highlightFilterSizes(1).hoverRadius).toBeCloseTo(0.75, 10)
    // A deviation of 1.5 px is a halo about 3 px wide.
    expect(highlightFilterSizes(1).haloDeviation * 2).toBeCloseTo(3, 10)
  })

  it('falls back to one pixel per unit on an unmeasured view', () => {
    expect(highlightFilterSizes(0)).toEqual(highlightFilterSizes(1))
    expect(highlightFilterSizes(Number.NaN)).toEqual(highlightFilterSizes(1))
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

describe('highlightFilterRegion', () => {
  const ppu = 4
  const window = { x: 10, y: 20, width: 100, height: 50 }

  it('is the window grown by a small margin, not by the size of the window itself', () => {
    const r = highlightFilterRegion(window, ppu)
    expect(r.width).toBeLessThan(window.width * 1.5)
    expect(r.height).toBeLessThan(window.height * 1.5)
    // Symmetric: the window sits in the middle.
    expect(r.x + r.width / 2).toBeCloseTo(window.x + window.width / 2, 10)
    expect(r.y + r.height / 2).toBeCloseTo(window.y + window.height / 2, 10)
  })

  it('reaches at least as far as the halo and the dilation do, at every zoom', () => {
    for (const p of [0.1, 1, 4, 64]) {
      const r = highlightFilterRegion(window, p)
      const marginPx = (window.x - r.x) * p
      expect(marginPx).toBeGreaterThanOrEqual(HIGHLIGHT_REACH_PX - 1e-9)
      expect((window.y - r.y) * p).toBeGreaterThanOrEqual(HIGHLIGHT_REACH_PX - 1e-9)
      expect(r.x + r.width - (window.x + window.width)).toBeCloseTo(window.x - r.x, 9)
    }
  })

  it('the reach is three deviations of the halo plus the dilation radius, in px', () => {
    const sizes = highlightFilterSizes(1)
    expect(HIGHLIGHT_REACH_PX).toBeCloseTo(3 * sizes.haloDeviation + sizes.hoverRadius, 10)
  })

  it('falls back to one pixel per unit on an unmeasured view', () => {
    expect(highlightFilterRegion(window, 0)).toEqual(highlightFilterRegion(window, 1))
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

describe('highlightDefs', () => {
  const region = { x: -90, y: -30, width: 300, height: 150 }
  const markup = highlightDefs({ hoverId: 'figure-hover-a', selectId: 'figure-select-a', accent: '#3b6fd8', region, sizes: highlightFilterSizes(1) })

  it('is a defs with both filters, in drawing units over the given region', () => {
    expect(markup).toMatch(/^<defs[ >]/)
    expect(markup).toContain('<filter id="figure-hover-a"')
    expect(markup).toContain('<filter id="figure-select-a"')
    expect(markup.match(/filterUnits="userSpaceOnUse"/g)).toHaveLength(2)
    expect(markup.match(/x="-90" y="-30" width="300" height="150"/g)).toHaveLength(2)
  })

  it('hover dilates the graphic in its own colour and keeps the original on top', () => {
    const hover = markup.slice(markup.indexOf('figure-hover-a'), markup.indexOf('figure-select-a'))
    expect(hover).toMatch(/<feMorphology[^>]*in="SourceGraphic"[^>]*operator="dilate"/)
    expect(hover).not.toContain('feFlood')
    expect(hover.lastIndexOf('in="SourceGraphic"')).toBeGreaterThan(hover.indexOf('<feMerge'))
  })

  it('selection blurs the alpha, floods it with the accent, and merges the halo under the graphic', () => {
    const select = markup.slice(markup.indexOf('figure-select-a'))
    expect(select).toMatch(/<feGaussianBlur[^>]*in="SourceAlpha"/)
    expect(select).toMatch(/<feFlood[^>]*flood-color="#3b6fd8"[^>]*flood-opacity="0.55"/)
    const merge = select.slice(select.indexOf('<feMerge'))
    expect(merge.indexOf('in="halo"')).toBeGreaterThan(-1)
    expect(merge.indexOf('in="halo"')).toBeLessThan(merge.indexOf('in="SourceGraphic"'))
  })

  it('exposes the two lengths the view rewrites every frame as marked elements', () => {
    expect(markup).toMatch(/<feMorphology[^>]*data-size="hover"/)
    expect(markup).toMatch(/<feGaussianBlur[^>]*data-size="halo"/)
  })
})

describe('highlightFilterValue', () => {
  const ids = { hoverId: 'h', selectId: 's' }

  it('names the filter for what is lit, and nothing when nothing is', () => {
    expect(highlightFilterValue({ hovered: true, selected: false }, ids)).toBe('url(#h)')
    expect(highlightFilterValue({ hovered: false, selected: true }, ids)).toBe('url(#s)')
    expect(highlightFilterValue({ hovered: false, selected: false }, ids)).toBe('')
  })

  it('thickens first and haloes the thickened shape when an item is both', () => {
    expect(highlightFilterValue({ hovered: true, selected: true }, ids)).toBe('url(#h) url(#s)')
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
