import { describe, expect, it } from 'vitest'
import { compileScalar } from '../math/compile'
import { call, num, variable } from '../math/expr'
import { and, compare, factorialOf, integral, not, or, piecewise, prime, prod, sum } from '../math/reserved'
import { makeScope } from '../math/scope'
import { parseConditionString, parseExprString } from './parseExpr'
import { evalExpr } from './evalExpr'
import type { Expr } from './types'

function evalStr(s: string, bindings: Record<string, number> = {}): number {
  return evalExpr(parseExprString(s), bindings)
}

describe('parseExpr / evalExpr', () => {
  it('respects standard operator precedence', () => {
    expect(evalStr('2 + 3 * 4')).toBe(14)
    expect(evalStr('(2 + 3) * 4')).toBe(20)
  })

  it('right-associates power', () => {
    expect(evalStr('2^3^2')).toBe(2 ** (3 ** 2))
  })

  // Unary minus binds looser than "^" — "-2^2" is -(2^2) = -4, matching
  // Desmos/WolframAlpha/TI calculators/Python, not (-2)^2 = 4. This matters
  // for real specs: "y = -x^2" must be a downward-opening parabola.
  it('binds unary minus looser than power', () => {
    expect(evalStr('-2^2')).toBe(-4)
    expect(evalStr('-x^2', { x: 3 })).toBe(-9)
    expect(evalStr('(-2)^2')).toBe(4) // explicit parens still override
  })

  it('allows a negative exponent', () => {
    expect(evalStr('2^-2')).toBe(0.25)
    expect(evalStr('-2^-2')).toBe(-0.25)
  })

  it('supports implicit multiplication', () => {
    expect(evalStr('2x', { x: 5 })).toBe(10)
    expect(evalStr('3(x+1)', { x: 1 })).toBe(6)
    expect(evalStr('2 sin(x)', { x: 0 })).toBe(0)
  })

  it('evaluates builtin functions', () => {
    expect(evalStr('sqrt(16)')).toBe(4)
    expect(evalStr('abs(-3)')).toBe(3)
    expect(evalStr('sin(x)^2', { x: 0 })).toBe(0)
  })

  it('throws on unbound variables', () => {
    expect(() => evalStr('x')).toThrow(/Unbound variable/)
  })

  it('treats adjacent numbers as implicit multiplication rather than a parse error', () => {
    // "2 3" is not ambiguous under this grammar's implicit-multiplication
    // rule (see parseTerm) — it's 2*3, same as "2 sin(x)" is 2*sin(x).
    expect(evalStr('1 + 2 3')).toBe(7)
  })

  it('throws on genuinely unconsumed trailing tokens', () => {
    expect(() => parseExprString('1 + 2)')).toThrow(/trailing tokens/)
  })

  it('resolves named constants pi and e', () => {
    expect(evalStr('pi')).toBeCloseTo(Math.PI)
    expect(evalStr('e')).toBeCloseTo(Math.E)
  })
})

// Scientific notation (integration J6): see tokenize.test.ts for the rule.
describe('parseExpr: scientific notation', () => {
  it('evaluates 1e6 * x, 1e-12 and 1.5e+6 as numbers', () => {
    expect(evalStr('1e6 * x', { x: 2 })).toBe(2000000)
    expect(evalStr('1e-12')).toBe(1e-12)
    expect(evalStr('1.5e+6')).toBe(1500000)
  })

  it('keeps e the constant in 2e, 3e x, 2e^x and e^(-x)', () => {
    expect(evalStr('2e')).toBe(2 * Math.E)
    expect(evalStr('3e x', { x: 2 })).toBe(3 * Math.E * 2)
    expect(evalStr('2e^x', { x: 1 })).toBe(2 * Math.E)
    expect(evalStr('e^(-x)', { x: 1 })).toBe(Math.E ** -1)
  })

  it('reads 2E3 as 2 times the name E3, as before', () => {
    expect(evalStr('2E3', { E3: 5 })).toBe(10)
  })
})

const v = variable

describe('calc P1 syntax', () => {
  it('absolute-value bars', () => {
    expect(parseExprString('|x - 1|')).toEqual(call('abs', parseExprString('x - 1')))
    expect(parseExprString('2|x|')).toEqual({ kind: 'binary', op: '*', left: num(2), right: call('abs', v('x')) })
    expect(parseExprString('||x| - 1|')).toEqual(call('abs', parseExprString('abs(x) - 1')))
    expect(parseExprString('|(2|x|)|')).toEqual(call('abs', { kind: 'binary', op: '*', left: num(2), right: call('abs', v('x')) }))
  })

  it('postfix ! binds tighter than ^ and unary minus', () => {
    expect(parseExprString('n!')).toEqual(factorialOf(v('n')))
    expect(parseExprString('-3!')).toEqual({ kind: 'unary', op: '-', arg: factorialOf(num(3)) })
    expect(parseExprString('2^3!')).toEqual({ kind: 'binary', op: '^', left: num(2), right: factorialOf(num(3)) })
    expect(parseExprString('(2k+1)!')).toEqual(factorialOf(parseExprString('2k+1')))
  })

  it("primes: f'(x), f''(x + 1)", () => {
    expect(parseExprString("f'(x)")).toEqual(prime('f', 1, [v('x')]))
    expect(parseExprString("f''(x + 1)")).toEqual(prime('f', 2, [parseExprString('x + 1')]))
    expect(() => parseExprString("f''''''(x)")).toThrow(/At most 5/)
  })

  it('sin^2(x) is (sin x)^2; sin^-1(x) is asin(x); sec^-1 is refused', () => {
    expect(parseExprString('sin^2(x)')).toEqual({ kind: 'binary', op: '^', left: call('sin', v('x')), right: num(2) })
    expect(parseExprString('sin^-1(x)')).toEqual(call('asin', v('x')))
    expect(parseExprString('cosh^-1(x)')).toEqual(call('acosh', v('x')))
    expect(() => parseExprString('sec^-1(x)')).toThrow(/acos/)
    // a variable's power is untouched: x^2(x + 1) is still x^2 · (x + 1)
    expect(parseExprString('x^2(x + 1)')).toEqual({ kind: 'binary', op: '*', left: parseExprString('x^2'), right: parseExprString('x + 1') })
  })

  it('piecewise in braces, with an otherwise', () => {
    expect(parseExprString('{x < 0: x^2, x <= 2: 2x + 1, 5}')).toEqual(
      piecewise(
        [
          [compare('<', v('x'), num(0)), parseExprString('x^2')],
          [compare('<=', v('x'), num(2)), parseExprString('2x + 1')],
        ],
        num(5)
      )
    )
    expect(parseExprString('{x < 0: -1}')).toEqual(piecewise([[compare('<', v('x'), num(0)), parseExprString('-1')]], null))
  })

  it('conditions: chains, and, or, not, !=, =', () => {
    expect(parseConditionString('0 < x < 1')).toEqual(and(compare('<', num(0), v('x')), compare('<', v('x'), num(1))))
    expect(parseConditionString('x < 0 or x > 1 and y != 2')).toEqual(or(compare('<', v('x'), num(0)), and(compare('>', v('x'), num(1)), compare('!=', v('y'), num(2)))))
    expect(parseConditionString('not x = 0')).toEqual(not(compare('=', v('x'), num(0))))
  })

  it('piecewise errors are legible', () => {
    expect(() => parseExprString('{5, x < 0: 1}')).toThrow(/last piece/)
    expect(() => parseExprString('{x: 1}')).toThrow(/comparison/)
    expect(() => parseExprString('{x < 0 1}')).toThrow(/":"/)
  })

  it('sum, prod and integral forms', () => {
    expect(parseExprString('sum(k = 0 to n, x^k)')).toEqual(sum('k', num(0), v('n'), parseExprString('x^k')))
    expect(parseExprString('integral(t = 0 to x, sin(t)/t)')).toEqual(integral('t', num(0), v('x'), parseExprString('sin(t)/t')))
    // a user function named sum, called normally, is still a call
    expect(parseExprString('sum(x)')).toEqual(call('sum', v('x')))
    expect(() => parseExprString('sum(k = 0, x)')).toThrow(/"to"/)
  })

  it('a comparison outside braces is not an expression', () => {
    expect(() => parseExprString('x < 1')).toThrow()
  })
})

describe('calc P1 syntax: what did not move, and the edges', () => {
  const bin = (op: '+' | '-' | '*' | '/' | '^', left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right })
  const minus = (arg: Expr): Expr => ({ kind: 'unary', op: '-', arg })

  it('trees that parsed before are the same trees', () => {
    expect(parseExprString('2x')).toEqual(bin('*', num(2), v('x')))
    expect(parseExprString('3(x+1)')).toEqual(bin('*', num(3), bin('+', v('x'), num(1))))
    expect(parseExprString('2 sin(x)')).toEqual(bin('*', num(2), call('sin', v('x'))))
    expect(parseExprString('-2^2')).toEqual(minus(bin('^', num(2), num(2))))
    expect(parseExprString('2^3^2')).toEqual(bin('^', num(2), bin('^', num(3), num(2))))
    expect(parseExprString('2^-1')).toEqual(bin('^', num(2), minus(num(1))))
    expect(parseExprString('log(x, 2)')).toEqual(call('log', v('x'), num(2)))
    expect(parseExprString('f(x, y)')).toEqual(call('f', v('x'), v('y')))
    expect(parseExprString('k(x + 1)')).toEqual(call('k', bin('+', v('x'), num(1))))
  })

  it('"to", "and", "or" and "not" are ordinary names outside their forms', () => {
    expect(parseExprString('2to')).toEqual(bin('*', num(2), v('to')))
    expect(parseExprString('x and')).toEqual(bin('*', v('x'), v('and')))
    expect(parseExprString('or')).toEqual(v('or'))
    // inside a sum's lower bound a bare "to" ends the bound; in parentheses it does not
    expect(parseExprString('sum(k = 2(to) to n, k)')).toEqual(sum('k', bin('*', num(2), v('to')), v('n'), v('k')))
  })

  it('bars: adjacent pairs multiply, nested pairs nest, and an unclosed bar is an error', () => {
    expect(parseExprString('|x||y|')).toEqual(bin('*', call('abs', v('x')), call('abs', v('y'))))
    expect(parseExprString('|x - |y||')).toEqual(call('abs', bin('-', v('x'), call('abs', v('y')))))
    expect(parseExprString('|2x|')).toEqual(call('abs', bin('*', num(2), v('x'))))
    expect(parseExprString('|x|^2')).toEqual(bin('^', call('abs', v('x')), num(2)))
    expect(parseExprString('|x|!')).toEqual(factorialOf(call('abs', v('x'))))
    expect(() => parseExprString('|x')).toThrow(/closing "\|"/)
  })

  it('factorials stack and take a call or a bar pair', () => {
    expect(parseExprString('n!!')).toEqual(factorialOf(factorialOf(v('n'))))
    expect(parseExprString('f(x)!')).toEqual(factorialOf(call('f', v('x'))))
    expect(parseExprString('n!^2')).toEqual(bin('^', factorialOf(v('n')), num(2)))
    expect(parseExprString('2n!')).toEqual(bin('*', num(2), factorialOf(v('n'))))
  })

  it('primes: a name with a prime needs its argument; several arguments pass through', () => {
    expect(() => parseExprString("f'")).toThrow(/needs its argument/)
    expect(() => parseExprString("f' + 1")).toThrow(/needs its argument/)
    expect(parseExprString("g'(x, y)")).toEqual(prime('g', 1, [v('x'), v('y')]))
    expect(parseExprString("f'(x)^2")).toEqual(bin('^', prime('f', 1, [v('x')]), num(2)))
    expect(parseExprString("f'''''(x)")).toEqual(prime('f', 5, [v('x')]))
  })

  it('function powers: any built-in, several arguments, other exponents', () => {
    expect(parseExprString('cos^2(x)')).toEqual(bin('^', call('cos', v('x')), num(2)))
    expect(parseExprString('log^2(x, 2)')).toEqual(bin('^', call('log', v('x'), num(2)), num(2)))
    expect(parseExprString('sin^-2(x)')).toEqual(bin('^', call('sin', v('x')), minus(num(2))))
    expect(parseExprString('sin^(-1)(x)')).toEqual(call('asin', v('x')))
    expect(parseExprString('tanh^-1(x)')).toEqual(call('atanh', v('x')))
    expect(() => parseExprString('csc^-1(x)')).toThrow(/asin\(1\/x\)/)
    expect(() => parseExprString('cot^-1(x)')).toThrow(/atan\(1\/x\)/)
    // a name that is not a built-in is a variable: its power is untouched
    expect(parseExprString('f^2(x)')).toEqual(bin('*', bin('^', v('f'), num(2)), v('x')))
  })

  // A built-in name with a power and no argument list is not a function power:
  // it parses exactly as it did before, as a variable to a power, so a document
  // that defines the name itself (@param gamma = 2) can still write gamma^2.
  it('a built-in name raised to a power with no argument list is still a variable', () => {
    expect(parseExprString('gamma^2')).toEqual(bin('^', v('gamma'), num(2)))
    expect(parseExprString('2 min^k')).toEqual(bin('*', num(2), bin('^', v('min'), v('k'))))
    expect(parseExprString('step^-1 + 1')).toEqual(bin('+', bin('^', v('step'), minus(num(1))), num(1)))
    expect(parseExprString('sin^2 x')).toEqual(bin('*', bin('^', v('sin'), num(2)), v('x')))
    expect(parseExprString('root^2^3')).toEqual(bin('^', v('root'), bin('^', num(2), num(3))))
    expect(parseExprString('gamma^n!')).toEqual(bin('^', v('gamma'), factorialOf(v('n'))))
    // the exponent is read once however deep the chain goes
    expect(parseExprString(`${'min^'.repeat(200)}2`)).toBeTruthy()
    const scope = makeScope({ params: [['gamma', 3]] })
    expect(compileScalar(parseExprString('gamma^2'), [], scope)()).toBe(9)
    expect(compileScalar(parseExprString('gamma^2 x'), ['x'], scope)(2)).toBe(18)
  })

  it('piecewise: values may be anything, conditions may combine, nesting works', () => {
    expect(parseExprString('{0 < x < 1: x, 0}')).toEqual(piecewise([[parseConditionString('0 < x < 1'), v('x')]], num(0)))
    expect(parseExprString('{x < 0 or x > 1: 1, 0}')).toEqual(piecewise([[parseConditionString('x < 0 or x > 1'), num(1)]], num(0)))
    expect(parseExprString('{not x < 0: x}')).toEqual(piecewise([[not(compare('<', v('x'), num(0))), v('x')]], null))
    expect(parseExprString('{x < 0: {x < -1: 1, 2}, 3}')).toEqual(
      piecewise([[compare('<', v('x'), num(0)), piecewise([[compare('<', v('x'), minus(num(1))), num(1)]], num(2))]], num(3))
    )
    expect(parseExprString('2{x < 0: 1, 0}')).toEqual(bin('*', num(2), piecewise([[compare('<', v('x'), num(0)), num(1)]], num(0))))
    expect(parseExprString('{|x| < 1: x, 0}')).toEqual(piecewise([[compare('<', call('abs', v('x')), num(1)), v('x')]], num(0)))
    expect(parseExprString('{x >= 0: sqrt(x), x != -1: 0, 1}')).toEqual(
      piecewise(
        [
          [compare('>=', v('x'), num(0)), call('sqrt', v('x'))],
          [compare('!=', v('x'), minus(num(1))), num(0)],
        ],
        num(1)
      )
    )
  })

  it('piecewise errors: empty, unclosed, only an otherwise', () => {
    expect(() => parseExprString('{}')).toThrow()
    expect(() => parseExprString('{5}')).toThrow(/at least one/)
    expect(() => parseExprString('{x < 0: 1')).toThrow(/"," or "}"/)
    expect(() => parseExprString('{x < 0: 1, 2, 3}')).toThrow(/last piece/)
  })

  it('conditions: and binds tighter than or, not binds tightest, a chain needs a comparator', () => {
    expect(parseConditionString('x < 1 and y < 2 or z < 3')).toEqual(or(and(compare('<', v('x'), num(1)), compare('<', v('y'), num(2))), compare('<', v('z'), num(3))))
    expect(parseConditionString('not x < 1 and y < 2')).toEqual(and(not(compare('<', v('x'), num(1))), compare('<', v('y'), num(2))))
    expect(parseConditionString('0 <= x < 1 <= y')).toEqual(and(and(compare('<=', num(0), v('x')), compare('<', v('x'), num(1))), compare('<=', num(1), v('y'))))
    expect(parseConditionString('2x >= y + 1')).toEqual(compare('>=', parseExprString('2x'), parseExprString('y + 1')))
    expect(() => parseConditionString('x + 1')).toThrow(/comparison/)
    expect(() => parseConditionString('x < 1 2 )')).toThrow(/trailing/)
    expect(() => parseConditionString('x < 1 or')).toThrow()
  })

  it('sum, prod and integral: bounds are expressions, an infinite bound is the name inf, the bound variable can be anything', () => {
    expect(parseExprString('prod(j = 1 to n, j)')).toEqual(prod('j', num(1), v('n'), v('j')))
    expect(parseExprString('integral(t = 0 to inf, exp(-t))')).toEqual(integral('t', num(0), v('inf'), parseExprString('exp(-t)')))
    expect(parseExprString('sum(k = 2n to 3n + 1, k)')).toEqual(sum('k', parseExprString('2n'), parseExprString('3n + 1'), v('k')))
    expect(parseExprString('2 sum(k = 0 to 3, k)')).toEqual(bin('*', num(2), sum('k', num(0), num(3), v('k'))))
    expect(parseExprString('sum(k = 0 to 3, sum(j = 0 to k, j))')).toEqual(sum('k', num(0), num(3), sum('j', num(0), v('k'), v('j'))))
    expect(() => parseExprString('sum(k = 0 to 3 x)')).toThrow(/","/)
    expect(() => parseExprString('sum(k = 0 to 3, k')).toThrow(/"\)"/)
  })
})
