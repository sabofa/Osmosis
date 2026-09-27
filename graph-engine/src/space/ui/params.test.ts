import { describe, expect, it } from 'vitest'
import type { Binding } from '../config'
import { displayValue, stepDecimals } from './params'

const binding = (patch: Partial<Binding>): Binding => ({ name: 'a', value: 0, min: -5, max: 5, step: null, integer: false, line: 1, ...patch })

describe('the number box', () => {
  it('shows a stepped binding to its step\'s decimals', () => {
    expect(stepDecimals(0.1)).toBe(1)
    expect(stepDecimals(0.25)).toBe(2)
    expect(stepDecimals(5)).toBe(0)
    expect(displayValue(binding({ step: 0.1 }), 0.1 + 0.2)).toBe('0.3')
    expect(displayValue(binding({ step: 0.25 }), -1.25)).toBe('-1.25')
    expect(displayValue(binding({ step: 0.1 }), 1)).toBe('1.0')
  })

  it('shows a continuous binding to 4 significant digits, and an integer as one', () => {
    expect(displayValue(binding({}), 0.123456789)).toBe('0.1235')
    expect(displayValue(binding({}), -2.00004)).toBe('-2')
    expect(displayValue(binding({ integer: true, step: null }), 16)).toBe('16')
  })
})
