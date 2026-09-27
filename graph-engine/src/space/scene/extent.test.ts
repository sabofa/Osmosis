import { describe, expect, it } from 'vitest'
import { robustRange, sceneExtent } from './extent'
import type { Mark } from './types'

describe('robustRange', () => {
  it('is null for no finite values', () => {
    expect(robustRange([])).toBeNull()
    expect(robustRange([NaN, Infinity])).toBeNull()
  })

  it('is the full range when the 1st-99th percentile span is at least a fifth of it', () => {
    // 0..100 evenly: p1 = 1, p99 = 99, span 98 >= 20
    const values = Array.from({ length: 101 }, (_, i) => i)
    expect(robustRange(values)).toEqual({ min: 0, max: 100 })
  })

  it('is the percentile span when one spike dominates', () => {
    // 200 values in [0, 1] and one at 1000: full span ~1000, the 1-99
    // percentile span under 1, so the spike is cut.
    const values = [...Array.from({ length: 200 }, (_, i) => i / 199), 1000]
    const r = robustRange(values)!
    expect(r.max).toBeLessThan(1.01)
    expect(r.min).toBeGreaterThanOrEqual(0)
  })

  it('ignores non-finite values', () => {
    expect(robustRange([NaN, 2, 5, Infinity])).toEqual({ min: 2, max: 5 })
  })
})

describe('sceneExtent', () => {
  const color = { author: null, slot: 0 }
  const source = { line: 1, statement: null, object: 's1' }

  it('spans points and arrow tips; null for an empty scene', () => {
    expect(sceneExtent([])).toBeNull()
    const marks: Mark[] = [
      { kind: 'points', source, positions: Float64Array.from([1, 2, 3]), style: { color, size: 8, shape: 'dot' } },
      {
        kind: 'arrows',
        source,
        tails: Float64Array.from([0, 0, 0]),
        vectors: Float64Array.from([-1, 4, 2]),
        style: { color, shaftWidth: 2, headSize: 10, hidden: 'dashed' },
      },
    ]
    expect(sceneExtent(marks)).toEqual({ x: { min: -1, max: 1 }, y: { min: 0, max: 4 }, z: { min: 0, max: 3 } })
  })
})
