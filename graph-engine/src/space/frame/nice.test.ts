import { describe, expect, it } from 'vitest'
import { niceStep, stepFor } from './nice'

describe('niceStep: the 1-2-5 ladder value nearest span/target in log scale', () => {
  // (span, target) -> ideal span/target -> the two ladder neighbours, and the
  // nearer one by |log(candidate / ideal)|.
  const cases: [number, number, number][] = [
    // 0.125: 0.1 (log 1.25 = 0.097) beats 0.2 (log 1.6 = 0.470)
    [1, 8, 0.1],
    // 0.25: 0.2 (log 1.25) beats 0.5 (log 2)
    [2, 8, 0.2],
    // 1.25: 1 (log 1.25) beats 2 (log 1.6)
    [10, 8, 1],
    // 0.875: 1 (log 1.143) beats 0.5 (log 1.75)
    [7, 8, 1],
    // 0.0375: 0.05 (log 1.333) beats 0.02 (log 1.875)
    [0.3, 8, 0.05],
    // 0.785: 1 (log 1.273) beats 0.5 (log 1.571)
    [2 * Math.PI, 8, 1],
  ]
  for (const [span, target, expected] of cases) {
    it(`niceStep(${span}, ${target}) = ${expected}`, () => {
      expect(niceStep(span, target)).toBe(expected)
    })
  }

  // A tie goes to the larger (K9), but on a 1-2-5 ladder the midpoints in log
  // scale are sqrt(2), sqrt(10) and sqrt(50) times a power of ten, all
  // irrational, so no double lands exactly on one; the rule cannot be pinned
  // by a test, only stated. Either side of sqrt(10) = 3.1623:
  it('picks the nearer rung either side of a log midpoint', () => {
    expect(niceStep(3.16, 1)).toBe(2)
    expect(niceStep(3.17, 1)).toBe(5)
  })

  it('an authored step wins over the ladder', () => {
    expect(stepFor(1, 8, { value: Math.PI / 2, pi: { num: 1, den: 2 } })).toBe(Math.PI / 2)
    expect(stepFor(1, 8, null)).toBe(0.1)
  })
})
