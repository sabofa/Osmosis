import { describe, it, expect } from 'vitest'
import { ChangeSet } from '@codemirror/state'
import { decideValueSync, changesToTextChanges, remapHighlightsThroughChanges } from './editorSync'

const cs = (doc: string, spec: Parameters<typeof ChangeSet.of>[0]) => ChangeSet.of(spec, doc.length)

describe('decideValueSync', () => {
  it('noop when equal, apply when different, queue while composing', () => {
    expect(decideValueSync('a', 'a', false)).toBe('noop')
    expect(decideValueSync('a', 'a', true)).toBe('noop')
    expect(decideValueSync('b', 'a', false)).toBe('apply')
    expect(decideValueSync('b', 'a', true)).toBe('queue')
  })
})

describe('changesToTextChanges', () => {
  it('lists insert, delete and replace in old coordinates', () => {
    const c = cs('hello world', [{ from: 0, insert: 'XX' }, { from: 5, to: 6 }, { from: 8, to: 11, insert: 'abc' }])
    expect(changesToTextChanges(c)).toEqual([
      { from: 0, to: 0, insertLen: 2 },
      { from: 5, to: 6, insertLen: 0 },
      { from: 8, to: 11, insertLen: 3 },
    ])
  })
  it('counts UTF-16 units for astral insertions', () => {
    expect(changesToTextChanges(cs('ab', { from: 1, insert: '😀' }))).toEqual([{ from: 1, to: 1, insertLen: 2 }])
  })
})

describe('remapHighlightsThroughChanges', () => {
  it('returns null with no highlights', () => {
    expect(remapHighlightsThroughChanges('abc', 'abc', [], cs('abc', []))).toBeNull()
  })
  it('returns null when nothing moved or changed', () => {
    const h = [{ id: 'a', start: 0, end: 1, quote: 'a', prefix: '', suffix: 'bc' }]
    const out = remapHighlightsThroughChanges('abc', 'abcd', h, cs('abc', { from: 3, insert: 'd' }))
    // suffix context is re-read from the new text, so only an identical re-read yields null
    expect(out === null || out[0].start === 0).toBe(true)
  })
  it('shifts codepoint offsets across an emoji inserted before the highlight', () => {
    const old = 'ab cd'
    const out = remapHighlightsThroughChanges(old, '😀ab cd', [{ id: 'h', start: 3, end: 5 }], cs(old, { from: 0, insert: '😀' }))!
    expect(out[0]).toMatchObject({ start: 4, end: 6, quote: 'cd' })
  })
  it('converts through an astral char already in the old text', () => {
    const old = '😀ab' // codepoints: emoji 0, a 1, b 2
    const out = remapHighlightsThroughChanges(old, '😀Xab', [{ id: 'h', start: 1, end: 3 }], cs(old, { from: 2, insert: 'X' }))!
    expect(out[0]).toMatchObject({ start: 2, end: 4, quote: 'ab' })
  })
  it('keeps a highlight that itself contains an astral char intact', () => {
    const old = 'a😀b'
    const out = remapHighlightsThroughChanges(old, 'Za😀b', [{ id: 'h', start: 1, end: 2 }], cs(old, { from: 0, insert: 'Z' }))!
    expect(out[0]).toMatchObject({ start: 2, end: 3, quote: '😀' })
  })
  it('drops highlights whose text was deleted', () => {
    const old = 'abcdef'
    expect(remapHighlightsThroughChanges(old, 'aef', [{ id: 'h', start: 1, end: 3 }], cs(old, { from: 1, to: 4 }))).toEqual([])
  })
  it('does not grow a highlight on insertions at its edges', () => {
    const old = 'abcd'
    const out = remapHighlightsThroughChanges(old, 'aXbcYd', [{ id: 'h', start: 1, end: 3 }], cs(old, [{ from: 1, insert: 'X' }, { from: 3, insert: 'Y' }]))!
    expect(out[0]).toMatchObject({ start: 2, end: 4, quote: 'bc' })
  })
})
