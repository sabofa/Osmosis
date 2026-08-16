import { describe, it, expect } from 'vitest'
import { findTokenSpan } from './findTokenSpan'

describe('findTokenSpan', () => {
  it('expands an offset mid-word to the whole word', () => {
    const text = 'revise (A) as follows'
    expect(findTokenSpan(text, 8)).toEqual({ start: 7, end: 10 }) // "(A)"
  })

  it('expands an offset landing on a bracket to the full bracketed token', () => {
    const text = 'revise (A) as follows'
    expect(findTokenSpan(text, 7)).toEqual({ start: 7, end: 10 })
  })

  it('handles a numbered marker like "12."', () => {
    const text = 'see item 12. for details'
    expect(findTokenSpan(text, 9)).toEqual({ start: 9, end: 12 })
  })

  it('returns null when the offset sits in whitespace with no adjacent token', () => {
    expect(findTokenSpan('a   b', 2)).toBeNull()
  })

  it('falls back to the preceding token when offset is on trailing whitespace', () => {
    const text = 'word '
    expect(findTokenSpan(text, 4)).toEqual({ start: 0, end: 4 })
  })

  it('returns null for empty text', () => {
    expect(findTokenSpan('', 0)).toBeNull()
  })

  it('returns null for an out-of-range offset', () => {
    expect(findTokenSpan('word', -1)).toBeNull()
    expect(findTokenSpan('word', 10)).toBeNull()
  })
})
