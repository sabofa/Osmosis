import { describe, expect, it } from 'vitest'
import { RESTORE_BATCHES, restoreBatches, THIN_EVERY, THIN_MIN_MARKS, thinnedIndices } from './lod'

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

describe('restoreBatches', () => {
  it('brings every skipped mark back exactly once, in order, in at most RESTORE_BATCHES batches', () => {
    for (const n of [0, 1, 3, 4, 10, 270]) {
      const batches = restoreBatches(n)
      expect(batches.length).toBeLessThanOrEqual(RESTORE_BATCHES)
      expect(batches.flat()).toEqual(Array.from({ length: n }, (_, i) => i))
    }
  })

  it('splits a list into equal batches, the last holding what is left', () => {
    expect(restoreBatches(10)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]])
  })
})
