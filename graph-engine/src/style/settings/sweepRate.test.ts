import { describe, expect, it } from 'vitest'
import { activeRange, rate, safeRange, saturates } from './sweepRate'

describe('rate', () => {
  it('colour thresholds, at each edge', () => {
    expect(rate('colour', 0)).toBe('none')
    expect(rate('colour', 0.00499)).toBe('none')
    expect(rate('colour', 0.005)).toBe('subtle')
    expect(rate('colour', 0.01999)).toBe('subtle')
    expect(rate('colour', 0.02)).toBe('moderate')
    expect(rate('colour', 0.05999)).toBe('moderate')
    expect(rate('colour', 0.06)).toBe('strong')
    expect(rate('colour', 1)).toBe('strong')
  })
  it('geometry thresholds, at each edge', () => {
    expect(rate('geometry', 0)).toBe('none')
    expect(rate('geometry', 0.0999)).toBe('none')
    expect(rate('geometry', 0.1)).toBe('subtle')
    expect(rate('geometry', 0.7499)).toBe('subtle')
    expect(rate('geometry', 0.75)).toBe('moderate')
    expect(rate('geometry', 2.4999)).toBe('moderate')
    expect(rate('geometry', 2.5)).toBe('strong')
    expect(rate('geometry', 40)).toBe('strong')
  })
})

describe('activeRange', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  it('a linear change: 80% of the steps', () => {
    // 8 equal steps; 80% of 8 is 6.4, so 7 steps are needed
    expect(activeRange(values, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([0, 7])
  })
  it('a step change concentrated in one step', () => {
    expect(activeRange(values, [0, 0, 0, 0, 5, 5, 5, 5, 5])).toEqual([3, 4])
  })
  it('a saturating curve', () => {
    const change = [0, 5, 8, 9.5, 9.9, 10, 10, 10, 10]
    expect(activeRange(values, change)).toEqual([0, 2])
  })
  it('all zeros and a lone value give null', () => {
    expect(activeRange(values, [0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull()
    expect(activeRange([1], [3])).toBeNull()
  })
  it('counts a rise and a fall both as change', () => {
    expect(activeRange([0, 1, 2, 3], [0, 4, 0, 0])).toEqual([0, 2])
  })
  it('works on string values', () => {
    expect(activeRange(['a', 'b', 'c'], [0, 0, 3])).toEqual(['b', 'c'])
  })
})

describe('saturates', () => {
  it('a linear change does not', () => expect(saturates([0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe(false))
  it('a saturating curve does', () => expect(saturates([0, 5, 8, 9.5, 9.9, 10, 10, 10, 10])).toBe(true))
  it('all zeros do not', () => expect(saturates([0, 0, 0, 0])).toBe(false))
  it('the edge: the last two steps add exactly 5%', () => {
    expect(saturates([0, 95, 97.5, 100])).toBe(false)
    expect(saturates([0, 96, 98, 100])).toBe(true)
  })
})

describe('safeRange', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  it('widens one step each side', () => expect(safeRange(values, [3, 5])).toEqual([2, 6]))
  it('clamps at the ends', () => {
    expect(safeRange(values, [0, 2])).toEqual([0, 3])
    expect(safeRange(values, [6, 8])).toEqual([5, 8])
    expect(safeRange(values, [0, 8])).toEqual([0, 8])
  })
  it('null stays null', () => expect(safeRange(values, null)).toBeNull())
})
