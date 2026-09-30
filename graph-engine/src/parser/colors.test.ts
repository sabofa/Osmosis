import { describe, expect, it } from 'vitest'
import { parseSpec } from './parseSpec'
import { isValidColor, resolveColor } from './colors'
import { parseStatement } from './parseStatement'

// "#" starts a comment in a spec, so "color: #d03030" never reached the
// parser: hex colours were unwritable. Six bare hex digits are the
// additive form (figure styles part 1, fix round 1).
describe('a statement colour in hex', () => {
  it('reads six bare hex digits, normalised to "#rrggbb"', () => {
    expect(parseStatement('A = (1, 2) color: D03030').color).toBe('#d03030')
    expect(parseStatement('y = x color: 2080d0').color).toBe('#2080d0')
  })

  it('still reads names as written', () => {
    expect(parseStatement('y = x color: teal').color).toBe('teal')
  })

  it('works through a whole spec, where "#…" was a comment', () => {
    const parsed = parseSpec('A = (0, 0)\nB = (1, 2) color: 1f9a92')
    expect(parsed.errors).toEqual([])
    expect(parsed.statements[1].color).toBe('#1f9a92')
  })

  it('refuses anything else, and says how to write hex', () => {
    expect(() => parseStatement('y = x color: 12345')).toThrow(/six hex digits without the "#"/)
    expect(() => parseStatement('y = x color: navy')).toThrow(/Unknown color "navy"/)
  })
})

// Re-review 1: a name is looked up as an OWN key. "constructor" and the rest
// of what every object inherits are not colours, and were accepted.
describe('names every object inherits', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    it(`refuses "color: ${name}"`, () => {
      expect(() => parseStatement(`y = x color: ${name}`)).toThrow(/Unknown color/)
      expect(isValidColor(name)).toBe(false)
      expect(resolveColor(name)).toBe(0x888891)
    })
  }

  it('takes six hex digits only, as the style colour settings do', () => {
    expect(() => parseStatement('y = x color: fed')).toThrow(/Unknown color/)
    expect(parseStatement('y = x color: ffeedd').color).toBe('#ffeedd')
  })
})
