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

import { resolveForPaint, attachQuotes } from './offsetBoundary'

describe('resolveForPaint', () => {
  const text = 'one two three four'
  it('legacy items without a quote are unchanged', () => {
    const items = [{ id: 'a', start: 4, end: 7 }]
    expect(resolveForPaint(text, items)).toEqual({ resolved: items, failed: [] })
  })
  it('repaints a shifted offset on the quote', () => {
    const old = 'one two three four'
    const a = makeAnchor(old, 4, 7)
    const shifted = 'ZZZZ one two three four'
    const { resolved, failed } = resolveForPaint(shifted, [{ id: 'h', ...a }])
    expect(failed).toEqual([])
    expect(resolved[0]).toMatchObject({ id: 'h', start: 9, end: 12, quote: 'two' })
  })
  it('works on emoji text (cp offsets)', () => {
    const old = 'a😀b𝔸c'
    const a = makeAnchor(old, 3, 5) // 𝔸c
    const now = '😀😀' + old
    const { resolved } = resolveForPaint(now, [{ id: 'h', ...a }])
    expect(resolved[0]).toMatchObject({ start: 5, end: 7 })
  })
  it('reports a deleted quote and does not paint it', () => {
    const a = makeAnchor(text, 4, 7)
    const { resolved, failed } = resolveForPaint('one three four', [{ id: 'h', ...a }, { id: 'k', start: 0, end: 3 }])
    expect(resolved.map((r) => r.id)).toEqual(['k'])
    expect(failed.map((r) => r.id)).toEqual(['h'])
  })
})

describe('attachQuotes', () => {
  it('fills quotes only for items not in the known id set', () => {
    const out = attachQuotes(TEXT, [{ id: 'old', start: 0, end: 1 }, { id: 'new', start: 1, end: 3 }], new Set(['old']))
    expect(out[0]).toEqual({ id: 'old', start: 0, end: 1 })
    expect(out[1]).toMatchObject({ id: 'new', quote: '😀b', prefix: 'a', suffix: '𝔸c日本' })
  })
})

import { resolveMarkersForPaint } from './offsetBoundary'
describe('resolveMarkersForPaint', () => {
  it('moves quoted markers, drops missing ones, leaves legacy', () => {
    const old = 'see (A) and (B)'
    const mk = (offset: number, q: string) => ({ id: q, offset, ...makeAnchor(old, offset, offset + q.length) })
    const a = mk(4, '(A)')
    const b = mk(12, '(B)')
    const { resolved, failed } = resolveMarkersForPaint('xx see (A) and', [a, b, { id: 'l', offset: 1 }])
    expect(resolved.map((m) => [m.id, m.offset])).toEqual([['(A)', 7], ['l', 1]])
    expect(failed.map((m) => m.id)).toEqual(['(B)'])
  })
})

describe('conversion needs the text the view paints against', () => {
  it('collapses against empty text but is exact against the pdf text', () => {
    const pdf = 'x😀 hello'
    const r = { start: 3, end: 8 }
    expect(fromInternalRange('', toInternalRange(pdf, r))).toEqual({ start: 0, end: 0 })
    expect(fromInternalRange(pdf, toInternalRange(pdf, r))).toEqual(r)
  })
})
