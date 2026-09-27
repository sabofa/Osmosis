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

describe('statement line numbers (S1, K7)', () => {
  it('records the 1-based source line of each statement, parallel to statements', () => {
    // line 1 is blank, 2 a directive, 3 a statement, 4 blank, 5 a statement
    const result = parseSpec('\n@theme: dark\nz = x*y\n\nA = (1,2,3)')
    expect(result.statementLines).toEqual([3, 5])
    expect(result.statements).toHaveLength(2)
  })

  it('skips a line that failed to parse', () => {
    const result = parseSpec('y = x\nthis is not valid\nx^2 + y^2 = 1')
    expect(result.statementLines).toEqual([1, 3])
  })

  it('gives a @param its source line', () => {
    const result = parseSpec('y = x\n\n@param a = 1 range [0, 5]')
    expect(result.config.bindings).toEqual([{ name: 'a', value: 1, min: 0, max: 5, step: null, integer: false, line: 3 }])
  })
})

describe('space directives read constants in the spec’s angle unit (fix round 1, M4)', () => {
  // sin(30 degrees) = 1/2; sin(30 radians) = -0.988
  it('@angle: degrees then @param a = sin(30) gives a = 0.5', () => {
    const result = parseSpec('@angle: degrees\n@param a = sin(30) range [0, 1]')
    expect(result.errors).toEqual([])
    expect(result.config.bindings[0].value).toBeCloseTo(0.5, 15)
  })

  it('whichever comes first: @param before @angle', () => {
    const result = parseSpec('@param a = sin(30) range [0, 1]\n@angle: degrees')
    expect(result.errors).toEqual([])
    expect(result.config.bindings[0].value).toBeCloseTo(0.5, 15)
  })

  it('@bounds3d and @camera too', () => {
    // 2 sin(90 degrees) = 2; atan2(1, 1) = 45 degrees
    const result = parseSpec('@bounds3d: x [0, 2*sin(90)]\n@camera: azimuth atan2(1, 1)\n@angle: degrees')
    expect(result.config.space.bounds.x).toEqual({ min: 0, max: 2 })
    expect(result.config.space.camera.azimuth).toBe(45)
  })

  it('radians by default', () => {
    const result = parseSpec('@param a = sin(pi/6) range [0, 1]')
    expect(result.config.bindings[0].value).toBeCloseTo(0.5, 15)
  })
})
