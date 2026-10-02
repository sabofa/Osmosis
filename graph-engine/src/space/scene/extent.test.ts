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

describe('robustRange by selection agrees with a sort', () => {
  // The reference sorts a copy and interpolates between order statistics;
  // the code under test selects them without sorting.
  function reference(values: number[]) {
    const s = values.filter(Number.isFinite).sort((a, b) => a - b)
    if (s.length === 0) return null
    const at = (q: number) => {
      const i = q * (s.length - 1)
      const lo = Math.floor(i)
      const hi = Math.min(lo + 1, s.length - 1)
      return s[lo] + (s[hi] - s[lo]) * (i - lo)
    }
    const [p1, p99] = [at(0.01), at(0.99)]
    return p99 - p1 < 0.2 * (s[s.length - 1] - s[0]) ? { min: p1, max: p99 } : { min: s[0], max: s[s.length - 1] }
  }
  // a fixed linear congruential sequence, so the data is the same every run
  let seed = 12345
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (const [label, make] of [
    ['uniform', () => next() * 10 - 5],
    ['with spikes', (i: number) => (i % 97 === 0 ? 1e6 * next() : next())],
    ['with ties', () => Math.floor(next() * 5)],
    ['with non-finite', (i: number) => (i % 13 === 0 ? NaN : i % 17 === 0 ? -Infinity : next() - 0.5)],
  ] as const) {
    it(label, () => {
      // 250, 1234 and 5000 put both percentiles strictly inside the array,
      // with many values after each, where the next order statistic is not
      // simply the neighbour of the selected one.
      for (const n of [1, 2, 3, 7, 100, 250, 1001, 1234, 5000]) {
        const values = Array.from({ length: n }, (_, i) => make(i))
        expect(robustRange(values)).toEqual(reference(values))
      }
    })
  }
})
