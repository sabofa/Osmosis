import { describe, expect, it } from 'vitest'
import { def, parseTokenValue, onColour, mixTo, hex, type TokenType } from './types.js'
import { parseColour } from '../colour.js'

describe('parseTokenValue', () => {
  const table: [TokenType, string[], string[]][] = [
    ['color', ['#fff', '#112233', '#11223344', 'oklch(0.5 0.1 200)'], ['nope', '']],
    ['length', ['0', '4px', '1.5rem', '.5em', '-2px', '50%', '60ch'], ['4', 'px', '1 px', 'auto', '']],
    ['number', ['0', '1.2', '-3', '1e2'], ['', ' ', 'abc', 'Infinity']],
    ['duration', ['120ms', '.2s', '1s'], ['120', 'ms', '1 s', '']],
    ['shadow', ['0 1px 2px #000'], ['', '  ']],
    ['easing', ['ease', 'cubic-bezier(.2,0,0,1)'], ['']],
    ['font', ['Inter, sans-serif'], ['']],
    ['string', ['x'], ['']],
  ]
  for (const [type, ok, bad] of table) {
    it(`${type} accepts/rejects`, () => {
      for (const v of ok) expect(parseTokenValue(type, v), `${type} ${v}`).toBe(true)
      for (const v of bad) expect(parseTokenValue(type, v), `${type} ${v}`).toBe(false)
    })
  }
})

describe('def', () => {
  it('applies defaults', () => {
    const d = def('a', 'colour', 'color', 'm', () => '#000')
    expect(d.tier).toBe('semantic')
    expect(d.modeDependent).toBe(true)
    expect(def('b', 'shape', 'length', 'm', () => '1px').modeDependent).toBe(false)
  })
  it('honours opts', () => {
    const d = def('c', 'component', 'length', 'm', () => '1px', { tier: 'component', modeDependent: true })
    expect(d.tier).toBe('component')
    expect(d.modeDependent).toBe(true)
  })
})

describe('colour helpers', () => {
  it('onColour picks readable text', () => {
    expect(hex(onColour(parseColour('#ffffff')))).not.toBe('#ffffff')
    expect(hex(onColour(parseColour('#101010')))).toBe('#ffffff')
  })
  it('mixTo endpoints', () => {
    const a = parseColour('#ff0000'), b = parseColour('#0000ff')
    expect(hex(mixTo(a, b, 0))).toBe('#ff0000')
    expect(hex(mixTo(a, b, 1))).toBe('#0000ff')
  })
})
