import { describe, expect, it } from 'vitest'
import { formatCoordinate, formatPoint, formatZoom } from './readout'

describe('formatCoordinate', () => {
  it('rounds to at most three decimals', () => {
    expect(formatCoordinate(1.23456)).toBe('1.235')
  })
  it('trims trailing zeros and a bare point', () => {
    expect(formatCoordinate(2)).toBe('2')
    expect(formatCoordinate(1.5)).toBe('1.5')
    expect(formatCoordinate(2.0004)).toBe('2')
  })
  it('never prints a negative zero', () => {
    expect(formatCoordinate(-0.0001)).toBe('0')
    expect(formatCoordinate(-0)).toBe('0')
  })
  it('keeps the sign of a real negative', () => {
    expect(formatCoordinate(-2.5)).toBe('-2.5')
  })
})

describe('formatPoint', () => {
  it('joins the values in parentheses', () => {
    expect(formatPoint([1.5, -2])).toBe('(1.5, -2)')
    expect(formatPoint([1, 2, 3])).toBe('(1, 2, 3)')
  })
})

describe('formatZoom', () => {
  it('prints three significant figures, trimmed, with the times sign', () => {
    expect(formatZoom(4)).toBe('4×')
    expect(formatZoom(0.25)).toBe('0.25×')
    expect(formatZoom(12.5)).toBe('12.5×')
    expect(formatZoom(1.23456)).toBe('1.23×')
    expect(formatZoom(123.456)).toBe('123×')
  })
})
