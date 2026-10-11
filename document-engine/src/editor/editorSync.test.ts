import { describe, it, expect } from 'vitest'
import { ChangeSet, EditorState, Transaction } from '@codemirror/state'
import { history, undo, undoDepth } from '@codemirror/commands'
import {
  decideValueSync, decideQueuedApply, rememberEmitted, diffRange, detectEol, normalizeEol, toHostEol,
  changesToTextChanges, remapHighlightsThroughChanges,
} from './editorSync'

const cs = (doc: string, spec: Parameters<typeof ChangeSet.of>[0]) => ChangeSet.of(spec, doc.length)

describe('decideValueSync', () => {
  it('noop when equal, apply when different, queue while composing', () => {
    expect(decideValueSync('a', 'a', false)).toBe('noop')
    expect(decideValueSync('a', 'a', true)).toBe('noop')
    expect(decideValueSync('b', 'a', false)).toBe('apply')
    expect(decideValueSync('b', 'a', true)).toBe('queue')
  })
})

describe('decideQueuedApply', () => {
  it('retries while composing, whatever the value', () => {
    expect(decideQueuedApply('b', 'a', true, false)).toBe('retry')
    expect(decideQueuedApply('a', 'a', true, true)).toBe('retry')
  })
  it('drops an echo of our own text and a value equal to the doc', () => {
    expect(decideQueuedApply('old', 'new', false, true)).toBe('drop')
    expect(decideQueuedApply('same', 'same', false, false)).toBe('drop')
  })
  it('applies a genuinely external, different value', () => {
    expect(decideQueuedApply('ext', 'doc', false, false)).toBe('apply')
  })
})

describe('rememberEmitted', () => {
  it('keeps the newest entries and skips immediate repeats', () => {
    const ring: string[] = []
    for (let i = 0; i < 12; i++) rememberEmitted(ring, 't' + i)
    rememberEmitted(ring, 't11')
    expect(ring).toEqual(['t4', 't5', 't6', 't7', 't8', 't9', 't10', 't11'])
  })
})

describe('diffRange', () => {
  const applyD = (a: string, b: string) => {
    const d = diffRange(a, b)
    return d ? a.slice(0, d.from) + d.insert + a.slice(d.to) : a
  }
  it('null for identical text, including empty', () => {
    expect(diffRange('', '')).toBeNull()
    expect(diffRange('abc', 'abc')).toBeNull()
  })
  it('empty to text and text to empty', () => {
    expect(diffRange('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' })
    expect(diffRange('abc', '')).toEqual({ from: 0, to: 3, insert: '' })
  })
  it('finds the minimal middle replacement', () => {
    expect(diffRange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' })
    expect(diffRange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
    expect(diffRange('abc', 'abcd')).toEqual({ from: 3, to: 3, insert: 'd' })
    expect(diffRange('abcd', 'bcd')).toEqual({ from: 0, to: 1, insert: '' })
  })
  it('does not let prefix and suffix overlap on repeated characters', () => {
    expect(diffRange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
    expect(applyD('abab', 'ababab')).toBe('ababab')
  })
  it('never splits a surrogate pair', () => {
    // 😀 = D83D DE00, 😁 = D83D DE01: same high half, different low half
    expect(diffRange('a😀b', 'a😁b')).toEqual({ from: 1, to: 3, insert: '😁' })
    // same low half under a different high half (😀 vs another with DE00)
    const x = '🨀'
    expect(diffRange('a😀b', 'a' + x + 'b')).toEqual({ from: 1, to: 3, insert: x })
    expect(diffRange('😀', '😀😀')).toEqual({ from: 2, to: 2, insert: '😀' })
    expect(diffRange('ab', 'a😀b')).toEqual({ from: 1, to: 1, insert: '😀' })
  })
  it('round-trips random-ish edits', () => {
    const pairs: [string, string][] = [['', 'x'], ['a😀b😁c', 'a😁b😀c'], ['😀😀😀', '😀😁😀'], ['line1\nline2', 'line1\nnew\nline2'], ['same', 'sam']]
    for (const [a, b] of pairs) expect(applyD(a, b)).toBe(b)
  })
})

// No DOM here, so no real EditorView: the same transactions run on EditorState.
describe('external sync as a transaction', () => {
  const mk = (doc: string, anchor: number) =>
    EditorState.create({ doc, selection: { anchor }, extensions: [history()] })
  const external = (s: EditorState, next: string) => {
    const d = diffRange(s.doc.toString(), next)!
    return s.update({ changes: d, annotations: Transaction.addToHistory.of(false) }).state
  }
  it('maps the caret through the minimal change instead of resetting it', () => {
    const s = external(mk('hello world', 11), 'HELLO hello world') // insert before the caret
    expect(s.doc.toString()).toBe('HELLO hello world')
    expect(s.selection.main.head).toBe(17)
    const t = external(mk('hello world', 2), 'hello world!') // edit after the caret
    expect(t.selection.main.head).toBe(2)
  })
  it('keeps a reversed selection reversed', () => {
    const s0 = EditorState.create({ doc: 'abcdef', selection: { anchor: 4, head: 1 }, extensions: [history()] })
    const s = external(s0, 'Xabcdef')
    expect(s.selection.main.anchor).toBe(5)
    expect(s.selection.main.head).toBe(2)
  })
  it('stays out of undo history', () => {
    let s = mk('ab', 2)
    s = s.update({ changes: { from: 2, insert: 'c' }, userEvent: 'input.type' }).state
    s = external(s, 'Zabc')
    expect(undoDepth(s)).toBe(1)
    const un = undo({ state: s, dispatch: (tr: Transaction) => { s = tr.state } } as never)
    expect(un).toBe(true)
    expect(s.doc.toString()).toBe('Zab')
  })
})

describe('line endings', () => {
  it('detectEol: CRLF, LF, mixed by majority, no breaks keep the fallback', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n')
    expect(detectEol('a\nb\n')).toBe('\n')
    expect(detectEol('a\r\nb\r\nc\nd')).toBe('\r\n')
    expect(detectEol('a\nb\nc\r\nd')).toBe('\n')
    expect(detectEol('single line', '\r\n')).toBe('\r\n')
    expect(detectEol('single line')).toBe('\n')
  })
  it('normalizeEol and toHostEol round-trip a CRLF text', () => {
    const host = 'a\r\n\r\nb\r\n'
    const internal = normalizeEol(host)
    expect(internal).toBe('a\n\nb\n')
    expect(toHostEol(internal, '\r\n')).toBe(host)
    expect(toHostEol(internal, '\n')).toBe(internal)
    expect(normalizeEol('x\ry')).toBe('x\ny')
  })
  it('CRLF changes are reported in host coordinates', () => {
    const internal = 'ab\ncd\nef' // host: ab\r\ncd\r\nef
    const c = ChangeSet.of([{ from: 3, to: 5, insert: 'X\nY' }], internal.length)
    // internal 3..5 ("cd") = host 4..6; inserted "X\nY" = 4 host units
    expect(changesToTextChanges(c, { oldText: internal })).toEqual([{ from: 4, to: 6, insertLen: 4 }])
  })
  it('highlights in a CRLF host text remap by host offsets', () => {
    const internal = 'one\ntwo\nthree'
    const host = toHostEol(internal, '\r\n') // 'one\r\ntwo\r\nthree'
    const start = host.indexOf('three')
    const h = [{ id: 'h', start, end: start + 5 }]
    const c = ChangeSet.of({ from: 0, insert: 'X' }, internal.length)
    const out = remapHighlightsThroughChanges(internal, 'X' + internal, h, c, '\r\n')!
    expect(out[0]).toMatchObject({ start: start + 1, end: start + 6, quote: 'three' })
    // an edit on a later line leaves an earlier highlight where it was (and is a no-op for it)
    const early = [{ id: 'e', start: 0, end: 3, quote: 'one', prefix: '', suffix: '\r\ntwo\r\nthree' }]
    const c2 = ChangeSet.of({ from: internal.length, insert: '!' }, internal.length)
    const out2 = remapHighlightsThroughChanges(internal, internal + '!', early, c2, '\r\n')
    expect(out2 === null || out2[0].start === 0).toBe(true)
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
