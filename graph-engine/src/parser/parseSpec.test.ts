import { describe, expect, it } from 'vitest'
import { parseSpec } from './parseSpec'

describe('parseSpec', () => {
  it('parses config directives and statements together, order-independent', () => {
    const result = parseSpec('@theme: dark\ny = x^2\n@hover: none')
    expect(result.config.theme).toBe('dark')
    expect(result.config.hover).toBe('none')
    expect(result.statements).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })

  it('ignores blank lines and comment-only lines', () => {
    const result = parseSpec('y = x\n\n# just a comment\n   \nx^2 + y^2 = 1')
    expect(result.statements).toHaveLength(2)
  })

  it('strips trailing comments from a statement line', () => {
    const result = parseSpec('y = x^2   # a parabola')
    expect(result.errors).toHaveLength(0)
    expect(result.statements).toHaveLength(1)
  })

  it('collects an error per bad line without dropping the rest of the spec', () => {
    const result = parseSpec('y = x\nthis is not valid\nx^2 + y^2 = 1')
    expect(result.statements).toHaveLength(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].line).toBe(2)
  })

  it('lets a later "last value wins" directive override an earlier one', () => {
    const result = parseSpec('@theme: dark\n@theme: light')
    expect(result.config.theme).toBe('light')
  })

  it('rejects an unknown config key with a line-numbered error', () => {
    const result = parseSpec('@nonsense: 1')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].line).toBe(1)
  })
})
