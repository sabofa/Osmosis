import { describe, expect, it } from 'vitest'
import { parseSpec } from './parseSpec'
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
