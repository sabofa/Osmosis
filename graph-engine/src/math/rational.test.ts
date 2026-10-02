import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { oddRootExponent, rationalLiteral, realOddPow } from './rational'
import { makeScope } from './scope'
import { simplify } from './simplify'

const scope = makeScope()
const one = new Float64Array(1)

function both(text: string, x: number): number {
  const closure = compileScalar(p(text), ['x'], scope)(x)
  const program = compileMany([p(text)], ['x'], scope)(one, x)[0]
  expect(Object.is(program, closure), `${text} at ${x}: compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

describe('rationalLiteral reads integer-literal arithmetic exactly', () => {
  it.each([
    ['1/3', { p: 1, q: 3 }],
    ['2/6', { p: 1, q: 3 }],
    ['-1/3', { p: -1, q: 3 }],
    ['1/3 - 1', { p: -2, q: 3 }],
    ['2^3/4', { p: 2, q: 1 }],
    ['(1/2)^-2', { p: 4, q: 1 }],
    ['5', { p: 5, q: 1 }],
  ])('%s', (text, want) => {
    expect(rationalLiteral(p(text))).toEqual(want)
  })

  it.each(['0.5', 'x/3', '1/0', 'pi/3', 'sqrt(1)/3', '2^0.5', '9007199254740993/3'])('%s is not one', (text) => {
    expect(rationalLiteral(p(text))).toBeNull()
  })
})

describe('oddRootExponent: lowest terms, odd denominator above 1', () => {
  it.each([
    ['1/3', { p: 1, q: 3 }],
    ['2/3', { p: 2, q: 3 }],
    ['2/6', { p: 1, q: 3 }],
    ['-1/3', { p: -1, q: 3 }],
    ['1/3 - 1', { p: -2, q: 3 }],
  ])('%s', (text, want) => {
    expect(oddRootExponent(p(text))).toEqual(want)
  })

  it.each(['1/2', '3', '4/2', '0.3333333333333333', 'x'])('%s is not', (text) => {
    expect(oddRootExponent(p(text))).toBeNull()
  })
})

describe('realOddPow', () => {
  it('a negative base takes the real root; odd p keeps the sign', () => {
    expect(realOddPow(-8, 1 / 3, true)).toBeCloseTo(-2, 14)
    expect(realOddPow(-8, 2 / 3, false)).toBeCloseTo(4, 13)
  })

  it('a non-negative base is Math.pow bit for bit', () => {
    for (const x of [0, 0.5, 2, 8, 1e10]) expect(realOddPow(x, 1 / 3, true)).toBe(Math.pow(x, 1 / 3))
  })

  it('NaN stays NaN', () => {
    expect(realOddPow(Number.NaN, 1 / 3, true)).toBeNaN()
  })
})

describe('real odd roots on both compile paths', () => {
  it('x^(1/3) at -8 is -2', () => {
    expect(both('x^(1/3)', -8)).toBeCloseTo(-2, 14)
  })

  it('x^(2/3) at -8 is 4, the same as at 8, never negative', () => {
    expect(both('x^(2/3)', -8)).toBeCloseTo(4, 13)
    expect(both('x^(2/3)', -8)).toBe(both('x^(2/3)', 8))
  })

  it('x^(-1/3) at -8 is -1/2', () => {
    expect(both('x^(-1/3)', -8)).toBeCloseTo(-0.5, 14)
  })

  it('a non-negative base is exactly what Math.pow gave before', () => {
    for (const x of [0, 0.5, 2, 8, 1e10]) expect(both('x^(1/3)', x)).toBe(Math.pow(x, 1 / 3))
  })

  it('(-8)^(1/3) is -2', () => {
    expect(compileScalar(p('(-8)^(1/3)'), [], scope)()).toBeCloseTo(-2, 14)
  })

  it('a float or even-denominator exponent stays principal', () => {
    expect(both('x^0.5', -4)).toBeNaN()
    expect(both('x^(1/2)', -4)).toBeNaN()
    expect(both('x^0.3333333333333333', -8)).toBeNaN()
  })
})

describe('the rule survives diff and simplify', () => {
  it("d/dx x^(1/3) = (1/3) x^(-2/3): 1/12 at x = -8 and at x = 8", () => {
    const d = simplify(diff(p('x^(1/3)'), 'x', scope))
    const f = compileScalar(d, ['x'], scope)
    expect(f(-8)).toBeCloseTo(1 / 12, 14)
    expect(f(8)).toBeCloseTo(1 / 12, 14)
    expect(compileMany([d], ['x'], scope)(one, -8)[0]).toBe(f(-8))
  })

  it('d/dx x^(2/3) at -8 is -1/3', () => {
    const d = simplify(diff(p('x^(2/3)'), 'x', scope))
    expect(compileScalar(d, ['x'], scope)(-8)).toBeCloseTo(-1 / 3, 14)
  })

  it('simplify keeps a non-whole integer quotient, and still folds whole ones', () => {
    expect(simplify(p('1/3'))).toEqual(p('1/3'))
    expect(simplify(p('6/3'))).toEqual({ kind: 'num', value: 2 })
    expect(simplify(p('1/2 + 0'))).toEqual(p('1/2'))
  })

  it('a kept quotient compiles to the same double folding used to give', () => {
    expect(compileScalar(simplify(p('2*(1/3)')), [], scope)()).toBe(2 * (1 / 3))
    expect(compileScalar(simplify(p('1/2 + 1/4')), [], scope)()).toBe(1 / 2 + 1 / 4)
  })
})
