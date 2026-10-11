import { describe, expect, it } from 'vitest'
import { formatCoord, formatForSpan } from './format'

describe('formatForSpan', () => {
  it('matches formatCoord at ordinary spans', () => {
    for (const [v, s] of [[1.23456, 20], [-0.004, 10], [3, 15], [1234.5678, 1000]] as const) {
      expect(formatForSpan(v, s)).toBe(formatCoord(v))
    }
  })
  it('prints at least 9 significant digits at a tiny span', () => {
    const text = formatForSpan(1000.000000123, 1e-8)
    expect(text.replace(/[-.]/g, '').length).toBeGreaterThanOrEqual(9)
    expect(text.startsWith('1000.00000012')).toBe(true)
  })
  it('caps decimals at 15 and survives bad input', () => {
    expect(formatForSpan(0.1, 1e-30)).toBe('0.1')
    expect(formatForSpan(NaN, 1)).toBe('NaN')
  })
})
