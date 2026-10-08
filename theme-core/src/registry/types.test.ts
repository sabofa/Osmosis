import { describe, expect, it } from 'vitest'
import { def, parseTokenValue, onColour, mixTo, hex, type TokenType } from './types.js'
import { contrast, parseColour } from '../colour.js'

describe('parseTokenValue', () => {
  const table: [TokenType, string[], string[]][] = [
    ['color', ['#fff', '#112233', '#11223344', 'oklch(0.5 0.1 200)'], ['nope', '']],
    ['length', ['0', '4px', '1.5rem', '.5em', '-2px', '50%', '60ch'], ['4', 'px', '1 px', 'auto', '']],
    ['number', ['0', '1.2', '-3', '.5'], ['', ' ', 'abc', 'Infinity', '1e3', '0x10']],
    ['duration', ['120ms', '.2s', '1s'], ['120', 'ms', '1 s', '']],
    ['shadow', ['0 1px 2px #000', 'none'], ['', '  ', 'banana']],
    ['easing', ['ease', 'linear', 'cubic-bezier(.2,0,0,1)', 'steps(4)'], ['', 'banana']],
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

describe('parseTokenValue injection guard', () => {
  it('rejects ; { } everywhere', () => {
    const types: TokenType[] = ['color', 'length', 'number', 'font', 'shadow', 'duration', 'easing', 'string']
    for (const ty of types) for (const v of ['red;}', 'a{b', '1px 1px 2px #000;', 'x}']) expect(parseTokenValue(ty, v), `${ty} ${v}`).toBe(false)
  })
})

describe('onColour accessibility', () => {
  it('reaches 4.5:1 for 200 accents', () => {
    let n = 0
    for (let h = 0; h < 360; h += 15) for (let l = 0.2; l <= 0.91; l += 0.1) for (const c of [0.05, 0.15]) {
      const a = { l, c, h, a: 1 }
      expect(contrast(onColour(a), a), `${l} ${c} ${h}`).toBeGreaterThanOrEqual(4.5)
      n++
    }
    expect(n).toBeGreaterThanOrEqual(200)
  })
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
