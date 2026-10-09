import { describe, expect, it } from 'vitest'
import { makeAnchor, resolveAnchor } from './anchors'
import { sliceCp } from './offsets'

const check = (text: string, a: ReturnType<typeof makeAnchor>) => {
  const r = resolveAnchor(text, a)
  expect(r).not.toBeNull()
  expect(sliceCp(text, r!.start, r!.end)).toBe(a.quote)
  return r!
}

describe('anchors', () => {
  it('captures quote and context', () => {
    const a = makeAnchor('hello brave new world', 6, 11, 3)
    expect(a).toEqual({ start: 6, end: 11, quote: 'brave', prefix: 'lo ', suffix: ' ne' })
  })
  it('exact hit keeps offsets', () => {
    const t = 'one two three'
    expect(resolveAnchor(t, makeAnchor(t, 4, 7))).toEqual({ start: 4, end: 7 })
  })
  it('follows a shift from an inserted paragraph', () => {
    const t = 'alpha beta gamma'
    const a = makeAnchor(t, 6, 10)
    const t2 = 'NEW PARAGRAPH\n\n' + t
    expect(check(t2, a)).toEqual({ start: 21, end: 25 })
  })
  it('disambiguates duplicates by context', () => {
    const t = 'red cat sat. blue cat ran. green cat hid.'
    const start = t.indexOf('cat', 14)
    const a = makeAnchor(t, start, start + 3, 8)
    const t2 = 'X' + t
    expect(check(t2, a).start).toBe(start + 1)
  })
  it('ties break by distance to the stored offset', () => {
    const t = 'ab ab ab'
    const a = { start: 6, end: 8, quote: 'ab' }
    expect(resolveAnchor('x' + t, a)).toEqual({ start: 7, end: 9 })
    expect(resolveAnchor(t.slice(0, 5), { start: 0, end: 2, quote: 'ab' })).toEqual({ start: 0, end: 2 })
  })
  it('returns null when quote deleted or empty', () => {
    const t = 'keep this text'
    const a = makeAnchor(t, 5, 9)
    expect(resolveAnchor('keep text', a)).toBeNull()
    expect(resolveAnchor(t, { start: 0, end: 0, quote: '' })).toBeNull()
  })
  it('uses codepoint offsets with emoji', () => {
    const t = '😀😀 hi 👍🏽 there'
    const s = 6
    const a = makeAnchor(t, s, s + 2)
    expect(a.quote).toBe('👍🏽')
    const r = check('🎉🎉🎉' + t, a)
    expect(r.start).toBe(s + 3)
  })
  it('works for Japanese', () => {
    const t = '私は学生です。彼は先生です。'
    const a = makeAnchor(t, 9, 11, 3)
    expect(a.quote).toBe('先生')
    expect(check('追加。' + t, a)).toEqual({ start: 12, end: 14 })
  })
  it('survives whitespace-only edits elsewhere', () => {
    const t = 'first line\nsecond target line\nthird'
    const a = makeAnchor(t, 18, 24)
    const t2 = 'first   line\n\n\nsecond target line\nthird'
    expect(check(t2, a).start).toBe(t2.indexOf('target'))
  })
})
