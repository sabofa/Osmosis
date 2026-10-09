import { describe, it, expect } from 'vitest'
import { cpToUtf16, utf16ToCp, cpLength, sliceCp } from './offsets'

const corpus = [
  '', 'abc', 'café', 'αβγ δ', 'a😀b', '😀😀', '𝔸x𝔸', 'éx', 'こんにちは世界', 'a\ud83dz',
]

describe('offsets', () => {
  it('ASCII is identity', () => {
    expect(cpLength('abc')).toBe(3)
    expect(cpToUtf16('abc', 2)).toBe(2)
    expect(utf16ToCp('abc', 2)).toBe(2)
  })
  it('BMP chars are one unit', () => {
    expect(cpLength('éαβ')).toBe(3)
    expect(cpToUtf16('αβγ', 2)).toBe(2)
  })
  it('surrogate pairs', () => {
    expect(cpLength('a😀b')).toBe(3)
    expect(cpToUtf16('a😀b', 2)).toBe(3)
    expect(utf16ToCp('a😀b', 3)).toBe(2)
    expect(cpLength('𝔸')).toBe(1)
  })
  it('index inside a pair maps to the pair codepoint index', () => {
    expect(utf16ToCp('a😀b', 2)).toBe(1)
  })
  it('combining marks count as separate codepoints', () => {
    expect(cpLength('é')).toBe(2)
  })
  it('Japanese', () => {
    expect(cpLength('こんにちは')).toBe(5)
    expect(sliceCp('こんにちは', 1, 3)).toBe('んに')
  })
  it('clamps', () => {
    expect(cpToUtf16('a😀', -5)).toBe(0)
    expect(cpToUtf16('a😀', 99)).toBe(3)
    expect(utf16ToCp('a😀', -1)).toBe(0)
    expect(utf16ToCp('a😀', 99)).toBe(2)
    expect(sliceCp('abc', 2, 1)).toBe('')
    expect(sliceCp('a😀b', 1, 99)).toBe('😀b')
  })
  it('round trips over the corpus', () => {
    for (const t of corpus) {
      for (let n = 0; n <= cpLength(t); n++) {
        expect(utf16ToCp(t, cpToUtf16(t, n))).toBe(n)
      }
    }
  })
})
