import { describe, it, expect } from 'vitest'
import { toInternalRange, fromInternalRange, markerSpanInternal } from './offsetBoundary'
import { toggleHighlightRange, removeHighlightRange } from './highlightOps'
import { makeAnchor } from './core/anchors'

// "a😀b𝔸c日本" : cp 0 a,1 😀,2 b,3 𝔸,4 c,5 日,6 本  (utf16: 😀 and 𝔸 are 2 units)
const TEXT = 'a😀b𝔸c日本'

describe('range boundary', () => {
  it('is identity on ASCII', () => {
    expect(toInternalRange('hello world', { start: 2, end: 7 })).toEqual({ start: 2, end: 7 })
    expect(fromInternalRange('hello world', { start: 2, end: 7 })).toEqual({ start: 2, end: 7 })
  })
  it('maps a cp range to the right UTF-16 slice and back', () => {
    const r = toInternalRange(TEXT, { start: 1, end: 5 })
    expect(r).toEqual({ start: 1, end: 7 })
    expect(TEXT.slice(r.start, r.end)).toBe('😀b𝔸c')
    expect(fromInternalRange(TEXT, r)).toEqual({ start: 1, end: 5 })
  })
  it('round-trips every cp range exactly', () => {
    for (let s = 0; s <= 7; s++)
      for (let e = s; e <= 7; e++) {
        expect(fromInternalRange(TEXT, toInternalRange(TEXT, { start: s, end: e }))).toEqual({ start: s, end: e })
      }
  })
  it('preserves extra fields', () => {
    expect(toInternalRange(TEXT, { id: 'x', start: 1, end: 2, color: 'y' })).toEqual({ id: 'x', start: 1, end: 3, color: 'y' })
  })
})

describe('markerSpanInternal', () => {
  it('returns the token span in UTF-16', () => {
    const t = 'x 😀(A)𝔸 y'
    const s = markerSpanInternal(t, 3)! // cp 3 = "("
    expect(t.slice(s.start, s.end)).toBe('😀(A)𝔸')
  })
  it('null when no token', () => {
    expect(markerSpanInternal('a  b', 2)).toBeNull()
  })
})

describe('highlight ops with surrogate pairs (codepoint unit)', () => {
  let n = 0
  const id = () => `i${++n}`
  it('toggle/remove split on cp boundaries and slice correctly', () => {
    const hs = toggleHighlightRange([], 1, 6, 'yellow', id)
    expect(hs).toHaveLength(1)
    const split = removeHighlightRange(hs, 2, 4, id)
    const slices = split.map((h) => {
      const r = toInternalRange(TEXT, h)
      return TEXT.slice(r.start, r.end)
    })
    expect(split.map((h) => [h.start, h.end]).sort()).toEqual([[1, 2], [4, 6]])
    expect(slices.sort()).toEqual(['😀', 'c日'].sort())
  })
})

describe('round trip via anchors', () => {
  it('selection -> cp -> quote matches', () => {
    const internal = { start: 1, end: 7 }
    const cp = fromInternalRange(TEXT, internal)
    expect(makeAnchor(TEXT, cp.start, cp.end).quote).toBe(TEXT.slice(internal.start, internal.end))
  })
})
