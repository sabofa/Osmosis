import { describe, expect, it } from 'vitest'
import { finished, valueAt } from './timeline'

const b = (min: number, max: number, integer = false) => ({ min, max, integer })

describe('valueAt', () => {
  it('sweeps once: 3 s of 6 s on [0, 10] is 5, and it holds at 10 after 6 s', () => {
    expect(valueAt(b(0, 10), 1000, 4000, 'once')).toBe(5)
    expect(valueAt(b(0, 10), 1000, 7000, 'once')).toBe(10)
    expect(valueAt(b(0, 10), 1000, 20000, 'once')).toBe(10)
    expect(finished(1000, 6999, 'once')).toBe(false)
    expect(finished(1000, 7000, 'once')).toBe(true)
  })

  it('ping-pongs on loop: 10 at 6 s, back to 5 at 9 s, 0 at 12 s', () => {
    expect(valueAt(b(0, 10), 0, 6000, 'loop')).toBe(10)
    expect(valueAt(b(0, 10), 0, 9000, 'loop')).toBe(5)
    expect(valueAt(b(0, 10), 0, 12000, 'loop')).toBe(0)
    expect(valueAt(b(0, 10), 0, 15000, 'loop')).toBe(5)
    expect(finished(0, 60000, 'loop')).toBe(false)
  })

  it('steps an integer binding: 3.2 s of 6 on [1, 30] is round(1 + 29 * 3.2 / 6) = 16', () => {
    // 1 + 29 * 3.2 / 6 = 16.4666...
    expect(valueAt(b(1, 30, true), 0, 3200, 'once')).toBe(16)
  })
})
