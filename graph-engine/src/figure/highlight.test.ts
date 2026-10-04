import { describe, expect, it } from 'vitest'
import { highlightOf } from './highlight'
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
