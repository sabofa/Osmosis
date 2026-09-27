import { describe, expect, it } from 'vitest'
import { gridIndices } from './mesh'

describe('the grid index cache is a small LRU (fix round 1, M5)', () => {
  it('keeps the four most recently used resolutions and evicts the oldest', () => {
    const first = gridIndices(2)
    expect(gridIndices(2)).toBe(first)
    const three = gridIndices(3)
    gridIndices(4)
    gridIndices(5)
    // using 3 makes it recent; 2 is now the least recently used
    expect(gridIndices(3)).toBe(three)
    gridIndices(6)
    // five distinct resolutions touched: 2 was evicted, 3 was not
    expect(gridIndices(2)).not.toBe(first)
    expect(gridIndices(2)).toEqual(first)
    expect(gridIndices(3)).toBe(three)
  })

  it('makes two triangles per cell, counter-clockwise in (i, j)', () => {
    // n = 1: a = 0, b = 1, d = 2, c = 3
    expect([...gridIndices(1)]).toEqual([0, 1, 3, 0, 3, 2])
  })
})
