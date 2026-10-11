import { describe, expect, it } from 'vitest'
import { DISPLAY_DIGITS, formatApprox, formatApproxFull, formatNumber, formatPoint, supportedDigits } from './format'

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

describe('formatApprox display cap (S6 plan V3)', () => {
  it('caps an on-figure annotation at DISPLAY_DIGITS even when the error supports more: ∬ ≈ 25.1327412287 becomes ≈ 25.1327', () => {
    expect(DISPLAY_DIGITS).toBe(6)
    const value = 25.132741228718345
    const error = 1e-10
    expect(supportedDigits(value, error)).toBeGreaterThan(DISPLAY_DIGITS)
    expect(formatApprox(value, error)).toBe('≈ 25.1327')
  })

  it('formatApproxFull is never capped: it prints every digit the error supports', () => {
    const value = 25.132741228718345
    const error = 1e-10
    expect(formatApproxFull(value, error)).toBe(`≈ ${formatNumber(value, supportedDigits(value, error))}`)
    expect(formatApproxFull(value, error)).not.toBe(formatApprox(value, error))
  })

  it('the cap never adds digits the error does not support: fewer than 6 stays fewer than 6', () => {
    // Only 3 digits supported: the cap must not round up to 6.
    expect(supportedDigits(1.2345, 1e-3)).toBe(3)
    expect(formatApprox(1.2345, 1e-3)).toBe(formatApproxFull(1.2345, 1e-3))
  })

  it('with no error estimate, both print the default 4 digits (unaffected by the cap)', () => {
    expect(formatApprox(1 / 3)).toBe(formatApproxFull(1 / 3))
    expect(formatApprox(1 / 3)).toBe('≈ 0.3333')
  })
})
