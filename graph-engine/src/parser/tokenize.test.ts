import { describe, expect, it } from 'vitest'
import { tokenize } from './tokenize'

describe('tokenize', () => {
  it('tokenizes numbers, identifiers, and operators', () => {
    expect(tokenize('2x + sin(y)')).toEqual([
      { kind: 'num', value: 2 },
      { kind: 'ident', name: 'x' },
      { kind: 'op', value: '+' },
      { kind: 'ident', name: 'sin' },
      { kind: 'op', value: '(' },
      { kind: 'ident', name: 'y' },
      { kind: 'op', value: ')' },
    ])
  })

  it('allows digits and underscores after the first identifier character', () => {
    expect(tokenize('k1')).toEqual([{ kind: 'ident', name: 'k1' }])
    expect(tokenize('my_fn')).toEqual([{ kind: 'ident', name: 'my_fn' }])
  })

  it('does not allow an identifier to start with a digit', () => {
    expect(tokenize('1x')).toEqual([
      { kind: 'num', value: 1 },
      { kind: 'ident', name: 'x' },
    ])
  })

  it('parses decimal numbers', () => {
    expect(tokenize('3.14')).toEqual([{ kind: 'num', value: 3.14 }])
  })

  it('skips whitespace', () => {
    expect(tokenize('  1 \t + 2 ')).toEqual([
      { kind: 'num', value: 1 },
      { kind: 'op', value: '+' },
      { kind: 'num', value: 2 },
    ])
  })

  it('throws on an unexpected character', () => {
    expect(() => tokenize('1 % 2')).toThrow(/Unexpected character/)
  })
})
