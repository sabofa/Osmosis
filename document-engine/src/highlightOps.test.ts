import { describe, it, expect } from 'vitest'
import { toggleHighlightRange, highlightAtOffset, removeHighlightRange } from './highlightOps'

let n = 0
const makeId = () => `id-${++n}`

describe('toggleHighlightRange', () => {
  it('adds a highlight when there is no existing overlap', () => {
    const result = toggleHighlightRange([], 5, 10, 'yellow', makeId)
    expect(result).toEqual([{ id: expect.any(String), start: 5, end: 10, color: 'yellow' }])
  })

  it('removes a highlight when the selection exactly matches it', () => {
    const existing = [{ id: 'h1', start: 5, end: 10, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 5, 10, 'yellow', makeId)
    expect(result).toEqual([])
  })

  it('removes the overlapping middle and keeps the outer remainders when selection is fully inside an existing highlight', () => {
    const existing = [{ id: 'h1', start: 0, end: 20, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 8, 12, 'yellow', makeId)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 8, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 12, end: 20, color: 'yellow' })
  })

  it('recolors (not removes) a same-color-different selection straddling an existing highlight\'s edge', () => {
    const existing = [{ id: 'h1', start: 0, end: 10, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 5, 15, 'green', makeId)
    // [0,5) stays yellow (untouched remainder of h1). [5,15) is a
    // different color than what was there ('yellow'), so instead of just
    // vanishing, it becomes green — both the previously-yellow [5,10) part
    // and the previously-unhighlighted [10,15) part merge into one new
    // green highlight, since neither counted as "already this color".
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 5, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 5, end: 15, color: 'green' })
    expect(result).toHaveLength(2)
  })

  it('recolors a selection fully inside a differently-colored highlight, splitting it into two remainders', () => {
    const existing = [{ id: 'h1', start: 0, end: 20, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 8, 12, 'pink', makeId)
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 8, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 8, end: 12, color: 'pink' })
    expect(result).toContainEqual({ id: expect.any(String), start: 12, end: 20, color: 'yellow' })
    expect(result).toHaveLength(3)
  })

  it('unhighlights only the same-color portion when a selection spans both a same-color and a different-color highlight', () => {
    const existing = [
      { id: 'h1', start: 0, end: 10, color: 'yellow' },
      { id: 'h2', start: 10, end: 20, color: 'green' },
    ]
    const result = toggleHighlightRange(existing, 5, 15, 'yellow', makeId)
    // [5,10) was already yellow (the target color) -> removed.
    // [10,15) was green (a different color) -> recolored to yellow.
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 5, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 15, end: 20, color: 'green' })
    expect(result).toContainEqual({ id: expect.any(String), start: 10, end: 15, color: 'yellow' })
    expect(result.some((h) => h.start === 5 && h.end === 10)).toBe(false)
  })

  it('leaves non-overlapping highlights untouched', () => {
    const existing = [{ id: 'h1', start: 0, end: 5, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 10, 15, 'yellow', makeId)
    expect(result).toContainEqual(existing[0])
    expect(result).toContainEqual({ id: expect.any(String), start: 10, end: 15, color: 'yellow' })
  })
})

describe('removeHighlightRange', () => {
  it('strips highlight coverage regardless of color, splitting around the overlap', () => {
    const existing = [
      { id: 'h1', start: 0, end: 10, color: 'yellow' },
      { id: 'h2', start: 10, end: 20, color: 'green' },
    ]
    const result = removeHighlightRange(existing, 5, 15, makeId)
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 5, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 15, end: 20, color: 'green' })
    expect(result).toHaveLength(2)
  })

  it('leaves non-overlapping highlights untouched and adds nothing', () => {
    const existing = [{ id: 'h1', start: 0, end: 5, color: 'yellow' }]
    const result = removeHighlightRange(existing, 10, 15, makeId)
    expect(result).toEqual(existing)
  })
})

describe('highlightAtOffset', () => {
  it('finds the highlight containing an offset', () => {
    const existing = [
      { id: 'h1', start: 0, end: 5, color: 'yellow' },
      { id: 'h2', start: 10, end: 15, color: 'green' },
    ]
    expect(highlightAtOffset(existing, 12)?.id).toBe('h2')
    expect(highlightAtOffset(existing, 7)).toBeNull()
  })
})
