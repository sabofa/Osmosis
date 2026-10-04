import { describe, expect, it } from 'vitest'
import { highlightAccent, highlightDefs, highlightFilterRegion, highlightFilterSizes, highlightFilterValue, highlightOf } from './highlight'
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
  const ids = (hovered: string | null, selected: string | null) => ({ hovered, selected })

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

describe('highlightFilterRegion', () => {
  it('is the visible window grown by its own size on every side, so no line is clipped', () => {
    expect(highlightFilterRegion({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: -90, y: -30, width: 300, height: 150 })
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
