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

// Scientific notation (integration J6; handoff open item 4, agreed with the
// solid-figure side): a lowercase e is an exponent only when it directly
// follows a numeral AND is directly followed by an optional sign and a digit.
// An uppercase E never is (capital point and constant names).
describe('tokenize: scientific notation', () => {
  const num = (value: number) => ({ kind: 'num', value })
  const ident = (name: string) => ({ kind: 'ident', name })
  const op = (value: string) => ({ kind: 'op', value })

  it('reads 1e-12, 2e3 and 1.5e+6 as one number each', () => {
    expect(tokenize('1e-12')).toEqual([num(1e-12)])
    expect(tokenize('2e3')).toEqual([num(2000)])
    expect(tokenize('1.5e+6')).toEqual([num(1500000)])
    expect(tokenize('1e6 * x')).toEqual([num(1000000), op('*'), ident('x')])
    // the exponent ends at its last digit; implicit multiplication follows
    expect(tokenize('2e-3x')).toEqual([num(0.002), ident('x')])
  })

  it('never reads an uppercase E as an exponent: 2E3 is 2 times E3', () => {
    expect(tokenize('2E3')).toEqual([num(2), ident('E3')])
    expect(tokenize('2E-3')).toEqual([num(2), ident('E'), op('-'), num(3)])
  })

  it('keeps e as the constant where no digit follows: 2e, e, 3e x, 2e^x, e^(-x), 2e-x, 2exp(x)', () => {
    expect(tokenize('2e')).toEqual([num(2), ident('e')])
    expect(tokenize('e')).toEqual([ident('e')])
    expect(tokenize('3e x')).toEqual([num(3), ident('e'), ident('x')])
    expect(tokenize('2e^x')).toEqual([num(2), ident('e'), op('^'), ident('x')])
    expect(tokenize('e^(-x)')).toEqual([ident('e'), op('^'), op('('), op('-'), ident('x'), op(')')])
    expect(tokenize('2e-x')).toEqual([num(2), ident('e'), op('-'), ident('x')])
    expect(tokenize('2exp(x)')).toEqual([num(2), ident('exp'), op('('), ident('x'), op(')')])
  })

  it('needs the sign and the digit directly after the e: 3e -1, 3e- 1 and 3 e3 keep e', () => {
    expect(tokenize('3e -1')).toEqual([num(3), ident('e'), op('-'), num(1)])
    expect(tokenize('3e- 1')).toEqual([num(3), ident('e'), op('-'), num(1)])
    expect(tokenize('3 e3')).toEqual([num(3), ident('e3')])
  })

  it('leaves e inside identifiers alone: net, sec, center, x1e3', () => {
    expect(tokenize('net')).toEqual([ident('net')])
    expect(tokenize('sec(x)')).toEqual([ident('sec'), op('('), ident('x'), op(')')])
    expect(tokenize('center')).toEqual([ident('center')])
    expect(tokenize('x1e3')).toEqual([ident('x1e3')])
    expect(tokenize('2sec(x)')).toEqual([num(2), ident('sec'), op('('), ident('x'), op(')')])
  })
})

// Fix round 1: a numeric literal the scanner cannot read as one finite
// number is refused, never silently cut short or made infinite.
describe('tokenize: numeric literals that are not one finite number', () => {
  it('refuses a literal too large for a double: 1e400, 2e+309, and 400 digits', () => {
    expect(() => tokenize('1e400')).toThrow('1e400 is too large for a number')
    expect(() => tokenize('y = 2e+309 x')).toThrow('2e+309 is too large for a number')
    expect(() => tokenize(`1${'0'.repeat(400)}`)).toThrow(/is too large for a number$/)
    // the largest double is still a number
    expect(tokenize('1.7e308')).toEqual([{ kind: 'num', value: 1.7e308 }])
  })

  it('refuses a second decimal point: 1.2.3e5 and 1.2.3 no longer read as 1.2', () => {
    expect(() => tokenize('1.2.3e5')).toThrow('1.2.3e5 has more than one decimal point')
    expect(() => tokenize('x + 1.2.3')).toThrow('1.2.3 has more than one decimal point')
    // one point, leading or trailing digits, is a number
    expect(tokenize('2.')).toEqual([{ kind: 'num', value: 2 }])
    expect(tokenize('2.5e-1')).toEqual([{ kind: 'num', value: 0.25 }])
  })
})
