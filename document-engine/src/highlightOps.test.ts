import { describe, it, expect } from 'vitest'
import { toggleHighlightRange, highlightAtOffset } from './highlightOps'

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

  it('trims an existing highlight and adds the non-overlapping remainder when selection straddles its edge', () => {
    const existing = [{ id: 'h1', start: 0, end: 10, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 5, 15, 'green', makeId)
    // [0,5) stays highlighted (remainder of h1), [5,10) is removed (was
    // covered by h1, now unhighlighted), [10,15) is added in the new color.
    expect(result).toContainEqual({ id: expect.any(String), start: 0, end: 5, color: 'yellow' })
    expect(result).toContainEqual({ id: expect.any(String), start: 10, end: 15, color: 'green' })
    expect(result.some((h) => h.start === 5 && h.end === 10)).toBe(false)
  })

  it('leaves non-overlapping highlights untouched', () => {
    const existing = [{ id: 'h1', start: 0, end: 5, color: 'yellow' }]
    const result = toggleHighlightRange(existing, 10, 15, 'yellow', makeId)
    expect(result).toContainEqual(existing[0])
    expect(result).toContainEqual({ id: expect.any(String), start: 10, end: 15, color: 'yellow' })
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
