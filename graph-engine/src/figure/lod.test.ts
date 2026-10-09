import { describe, expect, it } from 'vitest'
import { THIN_EVERY, THIN_MIN_MARKS, thinnedIndices } from './lod'

describe('thinnedIndices', () => {
  it('leaves a small group whole: a flat fill or a few edges are not shading', () => {
    expect(thinnedIndices(0)).toEqual([])
    expect(thinnedIndices(1)).toEqual([])
    expect(thinnedIndices(THIN_MIN_MARKS - 1)).toEqual([])
  })

  it('hides all but every third mark of a group of shading', () => {
    expect(thinnedIndices(9)).toEqual([1, 2, 4, 5, 7, 8])
  })

  it('always keeps the first mark, and keeps one in THIN_EVERY', () => {
    for (const n of [6, 7, 20, 101]) {
      const hidden = new Set(thinnedIndices(n))
      expect(hidden.has(0)).toBe(false)
      expect(n - hidden.size).toBe(Math.ceil(n / THIN_EVERY))
    }
  })
})
