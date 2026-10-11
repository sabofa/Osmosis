import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { call, num, substitute, substituteArguments, variable } from './expr'
import { oddRootExponent, rationalLiteral, realOddPow } from './rational'
import { integral, prime } from './reserved'
import { makeScope, type MathScope } from './scope'
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

  // Each cross product must be exact on its own: the sum landing back in range
  // does not make an inexact term right (the true answer here is 1).
  it.each(['9007199254740991/3 - 9007199254740988/3', '9007199254740991/3 + -9007199254740988/3', '9007199254740991/3 + 9007199254740988/3'])(
    '%s leaves the safe-integer range on the way, so it is not one',
    (text) => {
      expect(rationalLiteral(p(text))).toBeNull()
    },
  )

  it('reads an integer power with a negative exponent as the reciprocal', () => {
    expect(rationalLiteral(p('3^-1'))).toEqual({ p: 1, q: 3 })
    expect(rationalLiteral(p('2^-1'))).toEqual({ p: 1, q: 2 })
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

  // rationalLiteral also reads int ^ negative int (3^-1 = 1/3), so simplify keeps
  // that shape too: any non-integer result folded from two integer operands.
  it('simplify keeps an integer power with a negative exponent, so x^(3^-1) is still -2 at -8', () => {
    const s = simplify(p('x^(3^-1)'))
    expect(compileScalar(s, ['x'], scope)(-8)).toBeCloseTo(-2, 14)
    expect(compileMany([s], ['x'], scope)(one, -8)[0]).toBe(compileScalar(s, ['x'], scope)(-8))
  })

  it('d/dx x^(3^-1) is 1/12 at x = -8 after simplify', () => {
    const d = simplify(diff(p('x^(3^-1)'), 'x', scope))
    expect(compileScalar(d, ['x'], scope)(-8)).toBeCloseTo(1 / 12, 14)
  })

  it('simplify(2^-1) stays unfolded and compiles to 0.5', () => {
    const s = simplify(p('2^-1'))
    expect(s.kind).toBe('binary')
    expect(compileScalar(s, [], scope)()).toBe(0.5)
  })

  it('whole powers and powers of a non-integer still fold, as before', () => {
    expect(simplify(p('2^3'))).toEqual({ kind: 'num', value: 8 })
    expect(simplify(p('2^0.5'))).toEqual({ kind: 'num', value: Math.pow(2, 0.5) })
    expect(simplify(p('0.5/2'))).toEqual({ kind: 'num', value: 0.25 })
  })
})

// ---------------------------------------------------------------------------
// The real-root rule is read from a shape the author wrote, and a derivative must
// never invent one: where a value is NaN (principal root of a negative number), its
// derivative is NaN too, not a real number from a ratio the kernel made.
// ---------------------------------------------------------------------------

// f(x) on both compile paths, which must agree bit for bit.
function valueOf(expr: Expr, at: number, sc: MathScope): number {
  const closure = compileScalar(expr, ['x'], sc)(at)
  const program = compileMany([expr], ['x'], sc)(one, at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

// d/dx expr at `at`, by simplify(diff(...)), on both compile paths.
function derivativeOf(expr: Expr, at: number, sc: MathScope): number {
  return valueOf(simplify(diff(expr, 'x', sc)), at, sc)
}

// d/dx of the user function `name` at `at` through f' (math/prime.ts), both paths.
function primeOf(name: string, at: number, sc: MathScope): number {
  return valueOf(prime(name, 1, [num(at)]), 0, sc)
}

const central = (f: (a: number) => number, at: number, h = 1e-5) => (f(at + h) - f(at - h)) / (2 * h)

describe('a ratio built from a float is not a literal ratio (simplify)', () => {
  it('keeps an operation with a non-integer operand and an integer result as written', () => {
    for (const text of ['0.5*2', '0.5 + 0.5', '1.5 - 0.5', '4^0.5', '0.25*4', '2/0.5']) {
      const s = simplify(p(text))
      expect(s.kind, text).toBe('binary')
      // the value is the same IEEE operation, done at run time
      expect(Object.is(compileScalar(s, [], scope)(), compileScalar(p(text), [], scope)()), text).toBe(true)
    }
    expect(rationalLiteral(simplify(p('0.5*2/3')))).toBeNull()
    expect(rationalLiteral(simplify(p('0.5*2/3 - 1')))).toBeNull()
  })

  it('still folds what it folded: a non-integer result of a non-integer, and whole results of whole numbers', () => {
    expect(simplify(p('0.5*3'))).toEqual({ kind: 'num', value: 1.5 })
    expect(simplify(p('0.1 + 0.2'))).toEqual({ kind: 'num', value: 0.1 + 0.2 })
    expect(simplify(p('2*3'))).toEqual({ kind: 'num', value: 6 })
    expect(simplify(p('6/3'))).toEqual({ kind: 'num', value: 2 })
    expect(simplify(p('2^10'))).toEqual({ kind: 'num', value: 1024 })
  })

  it('k(x) = x^(0.5*2/3): k(-8) and k\'(-8) are both NaN, on both paths; at 8 the value is unchanged', () => {
    const sc = makeScope({ functions: [['k', { params: ['x'], body: p('x^(0.5*2/3)') }]] })
    const k = call('k', variable('x'))
    expect(valueOf(k, -8, sc)).toBeNaN()
    expect(derivativeOf(k, -8, sc)).toBeNaN()
    expect(primeOf('k', -8, sc)).toBeNaN()
    // the expression directly, and simplified: the exponent is a float, so principal everywhere
    expect(valueOf(p('x^(0.5*2/3)'), -8, sc)).toBeNaN()
    expect(valueOf(simplify(p('x^(0.5*2/3)')), -8, sc)).toBeNaN()
    expect(derivativeOf(p('x^(0.5*2/3)'), -8, sc)).toBeNaN()
    // x > 0: bit-identical to Math.pow, and the derivative (1/3) x^(-2/3) is 1/12 at 8
    expect(valueOf(p('x^(0.5*2/3)'), 8, sc)).toBe(Math.pow(8, (0.5 * 2) / 3))
    expect(valueOf(simplify(p('x^(0.5*2/3)')), 8, sc)).toBe(Math.pow(8, (0.5 * 2) / 3))
    expect(Math.abs(derivativeOf(k, 8, sc) - 1 / 12)).toBeLessThan(1e-14)
    expect(Math.abs(central(compileScalar(k, ['x'], sc), 8) - 1 / 12)).toBeLessThan(1e-8)
  })
})

describe('a literal argument substituted for a parameter is not a literal ratio (diff and f\')', () => {
  it('h(x) = g(x, 1/3) with g(x, a) = x^a: h(-8) and h\'(-8) are both NaN; h(8) is 2 and h\'(8) is 1/12', () => {
    const sc = makeScope({
      functions: [
        ['g', { params: ['x', 'a'], body: p('x^a') }],
        ['h', { params: ['x'], body: p('g(x, 1/3)') }],
      ],
    })
    const h = call('h', variable('x'))
    expect(valueOf(h, -8, sc)).toBeNaN()
    expect(derivativeOf(h, -8, sc)).toBeNaN()
    expect(primeOf('h', -8, sc)).toBeNaN()
    // g itself, with the ratio written at the call site
    expect(derivativeOf(p('g(x, 1/3)'), -8, sc)).toBeNaN()
    expect(Math.abs(valueOf(h, 8, sc) - 2)).toBeLessThan(1e-15)
    expect(Math.abs(derivativeOf(h, 8, sc) - 1 / 12)).toBeLessThan(1e-14)
    expect(Math.abs(primeOf('h', 8, sc) - 1 / 12)).toBeLessThan(1e-14)
    expect(Math.abs(central(compileScalar(h, ['x'], sc), 8) - 1 / 12)).toBeLessThan(1e-8)
  })

  it('the same through the exponent\'s arithmetic: g(x, a) = x^(a - 1) at a = 1/3, and a ratio folded from the argument', () => {
    const sc = makeScope({
      functions: [
        ['g', { params: ['x', 'a'], body: p('x^(a - 1)') }],
        ['m', { params: ['x'], body: p('g(x, 2/3)') }],
        ['n', { params: ['x'], body: p('g(x, 1/3 - 1/3 + 4/6)') }],
      ],
    })
    // m(x) = x^(-1/3) as a principal power: NaN at -8; m(8) = 1/2, m'(8) = -1/3 8^(-4/3) = -1/48
    for (const name of ['m', 'n']) {
      const f = call(name, variable('x'))
      expect(valueOf(f, -8, sc), name).toBeNaN()
      expect(derivativeOf(f, -8, sc), name).toBeNaN()
      expect(primeOf(name, -8, sc), name).toBeNaN()
      expect(Math.abs(valueOf(f, 8, sc) - 0.5), name).toBeLessThan(1e-15)
      expect(Math.abs(derivativeOf(f, 8, sc) + 1 / 48), name).toBeLessThan(1e-14)
    }
  })

  it('a whole-number argument too: r(x, n) = x^(1/n), s(x) = r(x, 3) is principal, so s\'(-8) is NaN as s(-8) is', () => {
    const sc = makeScope({
      functions: [
        ['r', { params: ['x', 'n'], body: p('x^(1/n)') }],
        ['s', { params: ['x'], body: p('r(x, 3)') }],
      ],
    })
    const s = call('s', variable('x'))
    expect(valueOf(s, -8, sc)).toBeNaN()
    expect(derivativeOf(s, -8, sc)).toBeNaN()
    expect(primeOf('s', -8, sc)).toBeNaN()
    expect(Math.abs(valueOf(s, 8, sc) - 2)).toBeLessThan(1e-15)
    expect(Math.abs(derivativeOf(s, 8, sc) - 1 / 12)).toBeLessThan(1e-14)
  })

  it('a ratio the author wrote beside the parameter is not a literal ratio either: x^(a + 1/3) at a = 2', () => {
    const sc = makeScope({
      functions: [
        ['t', { params: ['x', 'a'], body: p('x^(a + 1/3)') }],
        ['w', { params: ['x'], body: p('t(x, 2)') }],
      ],
    })
    const w = call('w', variable('x'))
    expect(valueOf(w, -8, sc)).toBeNaN()
    expect(derivativeOf(w, -8, sc)).toBeNaN()
    expect(primeOf('w', -8, sc)).toBeNaN()
    // w(x) = x^(7/3); w'(8) = 7/3 8^(4/3) = 112/3
    expect(Math.abs(derivativeOf(w, 8, sc) - 112 / 3)).toBeLessThan(1e-12)
  })

  it('a literal ratio the author wrote in a body stays a real root through the same call', () => {
    // t(x, a) = a x^(1/3): the exponent is a literal in t's own body, so the root is real
    const sc = makeScope({
      functions: [
        ['t', { params: ['x', 'a'], body: p('a x^(1/3)') }],
        ['u', { params: ['x'], body: p('t(x, 3)') }],
      ],
    })
    const u = call('u', variable('x'))
    expect(valueOf(u, -8, sc)).toBeCloseTo(-6, 14)
    // u'(x) = x^(-2/3) = 1/4 at -8 and at 8
    expect(derivativeOf(u, -8, sc)).toBeCloseTo(0.25, 14)
    expect(derivativeOf(u, 8, sc)).toBeCloseTo(0.25, 14)
    expect(primeOf('u', -8, sc)).toBeCloseTo(0.25, 14)
  })

  it('the integral\'s bounds are substituted the same way, and a ratio the author wrote in the integrand stays real', () => {
    // F(x) = integral(t = 1 to x, 1/t) is ln x; F'(x) = 1/x, the integrand at the bound x, folded or not
    const sc = makeScope({ functions: [['F', { params: ['x'], body: integral('t', num(1), variable('x'), p('1/t')) }]] })
    expect(Math.abs(derivativeOf(call('F', variable('x')), 4, sc) - 0.25)).toBeLessThan(1e-12)
    // a literal upper bound and a moving lower one: G(x) = integral(t = x to 8, t^(1/3)); G'(x) = -x^(1/3), real at -8
    const g = makeScope({ functions: [['G', { params: ['x'], body: integral('t', variable('x'), num(8), p('t^(1/3)')) }]] })
    expect(derivativeOf(call('G', variable('x')), -8, g)).toBeCloseTo(2, 12)
  })
})

describe('substituteArguments folds only what a replacement reaches', () => {
  it('writes a literal argument in as the number the run time computes, not the exact quotient', () => {
    const out = substituteArguments(p('x^a'), new Map<string, Expr>([['a', p('1/3 - 1')]]))
    expect(out).toEqual({ kind: 'binary', op: '^', left: variable('x'), right: num(1 / 3 - 1) })
    // 1/3 - 1 is -0.6666666666666667 at run time; the exact -2/3 would be a different double
    expect(Object.is(1 / 3 - 1, -2 / 3)).toBe(false)
  })

  it('folds an operation on numbers that a replacement reached, literals the author wrote in it too, and nothing else', () => {
    // a/3 - 1/3 with a = 2: all numbers once the 2 is in, so it is the number 2/3 - 1/3
    const out = substituteArguments(p('a/3 - 1/3'), new Map<string, Expr>([['a', num(2)]]))
    expect(out).toEqual(num(2 / 3 - 1 / 3))
    // the part the replacement does not reach keeps its shape
    const kept = substituteArguments(p('a x + 1/3'), new Map<string, Expr>([['a', num(2)]])) as Expr & { kind: 'binary' }
    expect(kept.right).toEqual(p('1/3'))
    // a body that is only the author's literals is untouched, as with substitute
    expect(substituteArguments(p('x^(1/3)'), new Map<string, Expr>([['y', num(2)]]))).toEqual(substitute(p('x^(1/3)'), new Map<string, Expr>([['y', num(2)]])))
    expect(rationalLiteral((substituteArguments(p('x^(1/3)'), new Map<string, Expr>([['y', num(2)]])) as Expr & { kind: 'binary' }).right)).toEqual({ p: 1, q: 3 })
  })

  it('an operation that is not finite is left as written', () => {
    const out = substituteArguments(p('1/a'), new Map<string, Expr>([['a', num(0)]]))
    expect(out).toEqual(p('1/0'))
    expect(compileScalar(out, [], scope)()).toBe(Infinity)
  })

  it('the value is the same: folded or not, a positive base gives the very same double, on both paths', () => {
    const args = ['1/3', '1/3 - 1', '0.5*2/3', '2/6', '-1/3', '3', '1/2']
    for (const body of ['a * x^(a - 1)', 'x^(a/3)', 'x^(1/a) + a', 'x^(a + 1/3)', '(a + 1) * x^(-a)']) {
      for (const argument of args) {
        const map = new Map<string, Expr>([['a', p(argument)]])
        const plain = substitute(p(body), map)
        const folded = substituteArguments(p(body), map)
        for (const x of [0.5, 2, 8, 100.25]) {
          const sc = makeScope()
          const a = compileScalar(plain, ['x'], sc)(x)
          const b = compileScalar(folded, ['x'], sc)(x)
          const c = compileMany([folded], ['x'], sc)(one, x)[0]
          expect(Object.is(b, a), `${body}, a = ${argument}, x = ${x}: folded ${b} vs plain ${a}`).toBe(true)
          expect(Object.is(c, b), `${body}, a = ${argument}, x = ${x}: compileMany ${c} vs compileScalar ${b}`).toBe(true)
        }
      }
    }
  })
})

describe('a user constant is never a literal ratio (deferred from Task 1)', () => {
  it('(-8)^(1/3) is -2 on compileMany, bit for bit what compileScalar gives', () => {
    const closure = compileScalar(p('(-8)^(1/3)'), [], scope)()
    const program = compileMany([p('(-8)^(1/3)')], [], scope)(one)[0]
    expect(program).toBeCloseTo(-2, 14)
    expect(Object.is(program, closure)).toBe(true)
  })

  it('x^a with a = 1/3 a constant stays Math.pow: NaN at -8, and so does its derivative', () => {
    const sc = makeScope({ functions: [['a', { params: [], body: p('1/3') }]] })
    const e = p('x^a')
    expect(valueOf(e, -8, sc)).toBeNaN()
    expect(derivativeOf(e, -8, sc)).toBeNaN()
    expect(valueOf(e, 8, sc)).toBe(Math.pow(8, 1 / 3))
    expect(Math.abs(derivativeOf(e, 8, sc) - 1 / 12)).toBeLessThan(1e-14)
    // through a user function of x, and f'
    const f = makeScope({ functions: [['a', { params: [], body: p('1/3') }], ['q', { params: ['x'], body: p('x^a') }]] })
    expect(derivativeOf(call('q', variable('x')), -8, f)).toBeNaN()
    expect(primeOf('q', -8, f)).toBeNaN()
  })

  it('x^a with a = 1/3 a @param likewise', () => {
    const sc = makeScope({ params: [['a', 1 / 3]] })
    expect(valueOf(p('x^a'), -8, sc)).toBeNaN()
    expect(derivativeOf(p('x^a'), -8, sc)).toBeNaN()
  })
})
