import { describe, it, expect } from 'vitest'
import { toNfc, isNfc } from './normalize'

describe('normalize', () => {
  it('composes e + U+0301', () => {
    expect(toNfc('é')).toBe('é')
    expect(isNfc('é')).toBe(false)
    expect(isNfc('é')).toBe(true)
  })
  it('composes Hangul jamo', () => {
    expect(toNfc('한')).toBe('한')
  })
  it('leaves NFC text unchanged', () => {
    expect(toNfc('abc 😀 こん')).toBe('abc 😀 こん')
  })
  it('is idempotent', () => {
    const once = toNfc('ạ́')
    expect(toNfc(once)).toBe(once)
    expect(isNfc(once)).toBe(true)
  })
})
