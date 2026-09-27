import { describe, expect, it } from 'vitest'
import { formatApprox, formatNumber, formatPoint, supportedDigits } from './format'

describe('formatNumber (E8)', () => {
  it.each([
    [0.000123456, '1.235×10⁻⁴'],
    [2.5, '2.5'],
    [-3, '−3'],
    [123456, '1.235×10⁵'],
    [-0, '0'],
    [1 / 3, '0.3333'],
  ])('%s prints %s', (value, text) => {
    expect(formatNumber(value)).toBe(text)
  })

  it('never infers exactness: 1/3 is not "1/3" and pi is not "π"', () => {
    expect(formatNumber(1 / 3)).not.toContain('/')
    expect(formatNumber(Math.PI)).toBe('3.142')
    expect(formatNumber(Math.PI / 2)).toBe('1.571')
  })

  it('trims trailing zeros and rounds before choosing the form', () => {
    expect(formatNumber(0.5)).toBe('0.5')
    expect(formatNumber(12340)).toBe('12340')
    expect(formatNumber(0.001234)).toBe('0.001234')
    // 99999.5 rounds to 1.000e5 at 4 digits: scientific, mantissa trimmed.
    expect(formatNumber(99999.5)).toBe('1×10⁵')
    expect(formatNumber(-0.00005)).toBe('−5×10⁻⁵')
    // A value that rounds to exactly 1e-3 is not scientific.
    expect(formatNumber(0.00099996)).toBe('0.001')
  })

  it('names what is not a number', () => {
    expect(formatNumber(Number.NaN)).toBe('undefined')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞')
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('−∞')
  })
})

describe('formatApprox and formatPoint', () => {
  it('marks a numeric value with ≈, with the digits its error estimate supports', () => {
    expect(formatApprox(1 / 3)).toBe('≈ 0.3333')
    // 4.18879... with an error of 1e-6: 6 digits.
    expect(supportedDigits(4.18879020478639, 1e-6)).toBe(6)
    expect(formatApprox(4.18879020478639, 1e-6)).toBe('≈ 4.18879')
  })

  it('prints a point with U+2212 minus signs', () => {
    expect(formatPoint([0.3, -0.7, -0.4])).toBe('(0.3, −0.7, −0.4)')
  })
})
