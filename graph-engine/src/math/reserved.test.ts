import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { CompileError, compileMany, compileScalar, freeVariablesDeep, paramCallsAsProducts } from './compile'
import { diff, differentiationSteps } from './diff'
import { add, call, mul, num, renameVars, varNames, variable } from './expr'
import { compare, factorialOf, MAX_DERIVATIVE_NODES, not, or, and, piecewise, prime, sum } from './reserved'
import { makeScope, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const x = variable('x')
const one = new Float64Array(1)

function fn(params: string[], body: string): MathFunction {
  return { params, body: p(body) }
}

function both(expr: Expr, at: number, scope = makeScope(), v = 'x'): number {
  const closure = compileScalar(expr, [v], scope)(at)
  const program = compileMany([expr], [v], scope)(one, at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure} at ${at}`).toBe(true)
  return closure
}

// d/dv of expr at `at`, on both compile paths.
function derivativeAt(expr: Expr, v: string, scope: MathScope, at: number): number {
  const d = simplify(diff(expr, v, scope))
  const closure = compileScalar(d, [v], scope)(at)
  const program = compileMany([d], [v], scope)(one, at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

// The message a compile refuses with, on the closure path and the register
// program, which must agree.
function bothRefuse(expr: Expr, scope = makeScope(), vars: string[] = ['x']): string {
  const messages = [
    () => compileScalar(expr, vars, scope),
    () => compileMany([expr], vars, scope),
  ].map((compile) => {
    try {
      compile()
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError)
      return (err as Error).message
    }
    throw new Error('compiled without a refusal')
  })
  expect(messages[1]).toBe(messages[0])
  return messages[0]
}

describe('comparisons and logic', () => {
  it('compare gives 1, 0, and NaN for a NaN side', () => {
    expect(both(compare('<', x, num(0)), -1)).toBe(1)
    expect(both(compare('<', x, num(0)), 0)).toBe(0)
    expect(both(compare('<=', x, num(0)), 0)).toBe(1)
    expect(both(compare('!=', x, num(0)), 0)).toBe(0)
    expect(both(compare('=', x, num(2)), 2)).toBe(1)
    expect(both(compare('<', p('ln(x)'), num(0)), -1)).toBeNaN()
  })

  it('and, or, not', () => {
    const inside = and(compare('>', x, num(0)), compare('<', x, num(1)))
    expect(both(inside, 0.5)).toBe(1)
    expect(both(inside, 2)).toBe(0)
    expect(both(or(compare('<', x, num(0)), compare('>', x, num(1))), 2)).toBe(1)
    expect(both(not(compare('<', x, num(0))), 2)).toBe(1)
  })

  it('every comparison and a NaN in and, or, not', () => {
    expect(both(compare('>', x, num(1)), 2)).toBe(1)
    expect(both(compare('>=', x, num(2)), 2)).toBe(1)
    expect(both(compare('>=', x, num(3)), 2)).toBe(0)
    expect(both(compare('=', x, num(3)), 2)).toBe(0)
    expect(both(compare('!=', x, num(3)), 2)).toBe(1)
    const nan = compare('<', p('ln(x)'), num(0))
    expect(both(and(nan, num(1)), -1)).toBeNaN()
    expect(both(or(num(1), nan), -1)).toBeNaN()
    expect(both(not(nan), -1)).toBeNaN()
    expect(both(not(num(0)), 1)).toBe(1)
    expect(both(not(num(-2)), 1)).toBe(0)
  })

  it('refuses the wrong number of arguments, on both paths', () => {
    expect(bothRefuse(call('__lt', x))).toBe('"__lt" takes 2 arguments, got 1')
    expect(bothRefuse(call('__and', x, x, x))).toBe('"__and" takes 2 arguments, got 3')
    expect(bothRefuse(call('__not', x, x))).toBe('"__not" takes 1 argument, got 2')
    expect(bothRefuse(call('__factorial'))).toBe('"__factorial" takes 1 argument, got 0')
    expect(bothRefuse(call('__piecewise', x))).toMatch(/needs at least one condition/)
  })

  it('a binder with the wrong number of arguments is refused', () => {
    expect(bothRefuse(call('__sum', variable('k'), num(1), num(3)))).toBe('"__sum" takes 4 arguments, got 3')
  })
})

describe('__piecewise', () => {
  const f = piecewise(
    [
      [compare('<', x, num(0)), p('x^2')],
      [compare('<=', x, num(2)), p('2x + 1')],
    ],
    num(5)
  )

  it('takes the first true piece, then the otherwise', () => {
    expect(both(f, -3)).toBe(9)
    expect(both(f, 0)).toBe(1)
    expect(both(f, 2)).toBe(5)
    expect(both(f, 7)).toBe(5)
  })

  it('with no otherwise, is NaN where no piece holds', () => {
    const g = piecewise([[compare('<', x, num(0)), p('x^2')]], null)
    expect(both(g, 1)).toBeNaN()
  })

  it('a NaN condition makes the value NaN', () => {
    const g = piecewise([[compare('<', p('ln(x)'), num(0)), num(1)]], num(2))
    expect(both(g, -1)).toBeNaN()
  })

  it('differentiates piece by piece with the same conditions', () => {
    const d = compileScalar(simplify(diff(f, 'x', makeScope())), ['x'], makeScope())
    expect(d(-1)).toBe(-2)
    expect(d(1)).toBe(2)
    expect(d(3)).toBe(0)
  })

  it('nests, and works inside a user function', () => {
    const nested = piecewise([[compare('<', x, num(0)), piecewise([[compare('<', x, num(-5)), num(1)]], num(2))]], num(3))
    expect(both(nested, -7)).toBe(1)
    expect(both(nested, -2)).toBe(2)
    expect(both(nested, 1)).toBe(3)
    const t = variable('t')
    const scope = makeScope({ functions: [['tri', { params: ['t'], body: piecewise([[compare('<', t, num(0)), p('-t')]], t) }]] })
    expect(both(p('tri(x) + tri(-x)'), 3, scope)).toBe(6)
    expect(both(p('tri(x) + tri(-x)'), -4, scope)).toBe(8)
  })

  it('several outputs share one program', () => {
    const out = new Float64Array(2)
    compileMany([f, p('x')], ['x'], makeScope())(out, 3)
    expect([...out]).toEqual([5, 3])
  })
})

describe('__factorial', () => {
  it('is gamma(a + 1)', () => {
    expect(both(factorialOf(x), 5)).toBe(120)
    expect(both(factorialOf(x), -1)).toBeNaN()
    expect(both(factorialOf(x), 0.5)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 14)
  })

  it('has no derivative rule yet', () => {
    expect(() => diff(factorialOf(x), 'x', makeScope())).toThrow(CompileError)
  })

  it('differentiates to 0 where its argument does not depend on the variable', () => {
    const scope = makeScope({ params: [['k', 4]], functions: [['h', { params: ['t'], body: mul(variable('t'), factorialOf(variable('k'))) }]] })
    // k! is a constant in x, so h(x) = x k! differentiates in x.
    expect(diff(factorialOf(num(3)), 'x', scope)).toEqual(num(0))
    expect(diff(factorialOf(variable('k')), 'x', scope)).toEqual(num(0))
    const d = compileScalar(simplify(diff(call('h', x), 'x', scope)), ['x'], scope)
    expect(d(7)).toBe(24)
    // In k itself it needs digamma, so it refuses.
    expect(() => diff(factorialOf(variable('k')), 'k', scope)).toThrow(/digamma/)
    expect(() => diff(call('h', x), 'k', scope)).toThrow(/digamma/)
  })
})

describe("__prime: f'(x), f''(x)", () => {
  const scope = makeScope({ functions: [['f', fn(['t'], 't^3 - 3t')], ['g', fn(['a', 'b'], 'a b')], ['s', fn(['t'], 'sin(t)')]] })

  it("f'(2) = 9 and f''(2) = 12 for f(t) = t^3 - 3t", () => {
    expect(both(prime('f', 1, [x]), 2, scope)).toBe(9)
    expect(both(prime('f', 2, [x]), 2, scope)).toBe(12)
  })

  it("s'(0) = cos 0 = 1", () => {
    expect(both(prime('s', 1, [x]), 0, scope)).toBe(1)
  })

  it('refuses an unknown function and a function of two variables', () => {
    expect(() => compileScalar(prime('h', 1, [x]), ['x'], scope)).toThrow(/Unknown function "h"/)
    expect(() => compileScalar(prime('g', 1, [x]), ['x'], scope)).toThrow(CompileError)
  })

  it("d/dx f'(x) is f''(x)", () => {
    const d = compileScalar(simplify(diff(prime('f', 1, [x]), 'x', scope)), ['x'], scope)
    expect(d(2)).toBe(12)
  })

  it("a rename never touches the function's name", () => {
    expect(renameVars(prime('f', 1, [variable('f')]), new Map([['f', 'u']]))).toEqual(prime('f', 1, [variable('u')]))
    expect(varNames(prime('f', 1, [x]))).toEqual(new Set(['x']))
  })

  it('freeVariablesDeep follows the function, not its name', () => {
    const withParam = makeScope({ functions: [['q', fn(['t'], 'a t^2')]], params: [['a', 2]] })
    expect(freeVariablesDeep(prime('q', 1, [x]), withParam, new Set(['x']))).toEqual(new Set(['a']))
  })

  it('takes an expression argument, and the chain rule goes through it', () => {
    // f''(x^2) at 1 is 6; d/dx f'(x^2) = f''(x^2) 2x, 12 at 1.
    expect(both(prime('f', 2, [p('x^2')]), 1, scope)).toBe(6)
    const d = compileScalar(simplify(diff(prime('f', 1, [p('x^2')]), 'x', scope)), ['x'], scope)
    expect(d(1)).toBe(12)
  })

  it('reads a parameter at call time, and goes as high as MAX_PRIME_ORDER', () => {
    const withParam = makeScope({ functions: [['q', fn(['t'], 'a t^2')], ['w', fn(['t'], 't^7')]], params: [['a', 2]] })
    const c = compileScalar(prime('q', 1, [x]), ['x'], withParam)
    expect(c(3)).toBe(12)
    withParam.params.values[0] = 5
    expect(c(3)).toBe(30)
    // 7 · 6 · 5 · 4 · 3 · 2 x at 2
    expect(both(prime('w', 6, [x]), 2, withParam)).toBe(10080)
  })

  it('refuses an order the kernel does not compute', () => {
    expect(bothRefuse(prime('f', 9, [x]), scope)).toBe('"f" with that many primes is not supported')
    expect(bothRefuse(prime('f', 0, [x]), scope)).toBe('"f" with that many primes is not supported')
    expect(bothRefuse(call('__prime', variable('f'), num(1), x, x), scope)).toBe(`"f'" takes 1 argument, got 2`)
    expect(bothRefuse(prime('g', 2, [x]), scope)).toBe(`"g''" needs a function of one variable; "g" takes 2`)
  })

  it('a function defined by its own derivative is a CompileError, not a stack overflow', () => {
    const loop = makeScope({ functions: [['f', { params: ['t'], body: add(variable('t'), prime('f', 1, [variable('t')])) }]] })
    expect(bothRefuse(p('f(x)'), loop)).toMatch(/"f" is defined in terms of its own derivative/)
    const pair = makeScope({
      functions: [
        ['f', { params: ['t'], body: prime('g', 1, [variable('t')]) }],
        ['g', { params: ['t'], body: prime('f', 1, [variable('t')]) }],
      ],
    })
    expect(bothRefuse(p('f(x)'), pair)).toMatch(/defined in terms of its own derivative/)
    expect(() => diff(p('f(x)'), 'x', pair)).toThrow(CompileError)
  })

  it('a derivative of a function that is fine still works after a refused one in the same scope', () => {
    const mixed = makeScope({ functions: [['f', fn(['t'], 't^2')], ['bad', { params: ['t'], body: prime('bad', 1, [variable('t')]) }]] })
    expect(() => compileScalar(p('bad(x)'), ['x'], mixed)).toThrow(CompileError)
    expect(both(prime('f', 1, [x]), 3, mixed)).toBe(6)
  })
})

describe('a name that is a value, called, is a product', () => {
  const scope = makeScope({ functions: [['k', fn([], '5')]] })

  it('x(x + 1) at 2 is 6; k(x + 1) at 1 is 10; pi(2) is 2 pi', () => {
    expect(both(p('x(x + 1)'), 2, scope)).toBe(6)
    expect(both(p('k(x + 1)'), 1, scope)).toBe(10)
    expect(compileScalar(p('pi(2)'), [], scope)()).toBe(2 * Math.PI)
  })

  it('differentiates as a product', () => {
    expect(compileScalar(simplify(diff(p('x(x + 1)'), 'x', scope)), ['x'], scope)(2)).toBe(5)
  })

  it('an unknown name is still an unknown function', () => {
    expect(() => compileScalar(p('q(x)'), ['x'], scope)).toThrow(/Unknown function "q"/)
  })

  it('a parameter, e and inf work the same way, on both paths', () => {
    const withParam = makeScope({ params: [['a', 3]] })
    expect(both(p('a(x + 1)'), 2, withParam)).toBe(9)
    expect(both(p('e(x)'), 2)).toBe(2 * Math.E)
    expect(both(p('inf(x)'), 2)).toBe(Infinity)
    expect(compileScalar(simplify(diff(p('a(x + 1)'), 'x', withParam)), ['x'], withParam)(2)).toBe(3)
  })

  it('two arguments is still an unknown function; a constant called with none or two keeps its meaning', () => {
    expect(bothRefuse(p('x(1, 2)'), scope)).toBe('Unknown function "x"')
    expect(both(p('k()'), 0, scope)).toBe(5)
    expect(bothRefuse(p('k(1, 2)'), scope)).toBe('"k" takes 0 arguments, got 2')
  })

  it('diff takes the product only for a name it can see is a value; the rest stay unknown functions', () => {
    expect(() => diff(p('frob(x)'), 'x', scope)).toThrow(/Unknown function "frob"/)
    // y is no value diff knows of when differentiating in x
    expect(() => diff(p('y(x + 1)'), 'x', scope)).toThrow(/Unknown function "y"/)
    // but it is when differentiating in y
    expect(compileScalar(simplify(diff(p('y(x + 1)'), 'y', scope)), ['x', 'y'], scope)(2, 9)).toBe(3)
    expect(compileScalar(simplify(diff(p('pi(x)'), 'x', scope)), ['x'], scope)(2)).toBe(Math.PI)
  })

  it('a function of one variable is still called, never multiplied', () => {
    const withFunction = makeScope({ functions: [['f', fn(['t'], 't^2')]] })
    expect(both(p('f(x)'), 3, withFunction)).toBe(9)
  })

  it('freeVariablesDeep reads the name as a factor, and leaves built-ins and reserved names out', () => {
    const withParam = makeScope({ params: [['a', 2]], functions: [['k', fn([], 'a + 1')]] })
    expect(freeVariablesDeep(p('a(x + 1)'), withParam, new Set(['x']))).toEqual(new Set(['a']))
    expect(freeVariablesDeep(p('k(x + 1)'), withParam, new Set(['x']))).toEqual(new Set(['a']))
    expect(freeVariablesDeep(p('x(x + 1)'), withParam, new Set(['x']))).toEqual(new Set())
    expect(freeVariablesDeep(p('sin(x)'), withParam, new Set(['x']))).toEqual(new Set())
    expect(freeVariablesDeep(compare('<', x, variable('a')), withParam, new Set(['x']))).toEqual(new Set(['a']))
    expect(freeVariablesDeep(p('inf'), withParam, new Set())).toEqual(new Set())
    expect(freeVariablesDeep(p('pi + e + inf'), makeScope({ params: [['inf', 1]] }), new Set())).toEqual(new Set(['inf']))
  })
})

describe('inf', () => {
  it('is a constant, on both paths; a parameter of that name wins', () => {
    expect(both(variable('inf'), 0)).toBe(Infinity)
    expect(both(p('-inf'), 0)).toBe(-Infinity)
    expect(both(variable('inf'), 0, makeScope({ params: [['inf', 7]] }))).toBe(7)
  })
})

describe('the "did you mean x*y?" hint', () => {
  it('names the product when every letter is a bound variable', () => {
    expect(() => compileScalar(p('xy'), ['x', 'y'], makeScope())).toThrow(/did you mean x\*y\?/)
  })

  it('stays quiet otherwise', () => {
    expect(() => compileScalar(p('xz'), ['x', 'y'], makeScope())).toThrow(/^Unknown variable "xz"$/)
  })

  it('is the same on the register program', () => {
    expect(() => compileMany([p('xy')], ['x', 'y'], makeScope())).toThrow(/did you mean x\*y\?/)
    expect(() => compileMany([p('xz')], ['x', 'y'], makeScope())).toThrow(/^Unknown variable "xz"$/)
  })
})

// A document's own definitions shadow a built-in's name; the name in the other
// role is an error, never a product (ruling agreed with space, 2026-10-02).
describe('a document name that is also a built-in', () => {
  const asParameter = '"gamma" is a parameter in this document; rename it to use the built-in gamma function'
  const asConstant = '"gamma" is a constant in this document; rename it to use the built-in gamma function'
  const parameter = makeScope({ params: [['gamma', 2]] })
  const constant = makeScope({ functions: [['gamma', fn([], '2')]] })
  const userFunction = makeScope({ functions: [['gamma', fn(['t'], 't + 1')]] })

  it('a parameter called as a function is an error; used as a value it reads the parameter', () => {
    expect(bothRefuse(p('gamma(3)'), parameter)).toBe(asParameter)
    expect(bothRefuse(p('gamma(x)'), parameter)).toBe(asParameter)
    expect(bothRefuse(p('gamma(1, 2)'), parameter)).toBe(asParameter)
    expect(both(p('gamma * 3'), 0, parameter)).toBe(6)
  })

  it('a user constant called as a function is an error; used as a value it reads the constant', () => {
    expect(bothRefuse(p('gamma(3)'), constant)).toBe(asConstant)
    expect(bothRefuse(p('gamma(1, 2)'), constant)).toBe(asConstant)
    expect(both(p('gamma * 3'), 0, constant)).toBe(6)
  })

  it('a user function of that name shadows the built-in', () => {
    expect(both(p('gamma(3)'), 0, userFunction)).toBe(4)
  })

  it('names the actual name, for any built-in', () => {
    const sine = makeScope({ params: [['sin', 1]] })
    expect(bothRefuse(p('sin(x)'), sine)).toBe('"sin" is a parameter in this document; rename it to use the built-in sin function')
    const choose = makeScope({ functions: [['choose', fn([], '2')]] })
    expect(bothRefuse(p('choose(4, 2)'), choose)).toBe('"choose" is a constant in this document; rename it to use the built-in choose function')
  })

  it('a bare name with no built-in behind it is unchanged: still a product', () => {
    expect(both(p('a(x)'), 2, makeScope({ params: [['a', 3]] }))).toBe(6)
  })

  it('diff refuses the same call with the same messages, and a user function still shadows', () => {
    const message = (expr: Expr, scope: ReturnType<typeof makeScope>) => {
      try {
        diff(expr, 'x', scope)
      } catch (err) {
        expect(err).toBeInstanceOf(CompileError)
        return (err as Error).message
      }
      throw new Error('differentiated without a refusal')
    }
    expect(message(p('gamma(x)'), parameter)).toBe(asParameter)
    expect(message(p('gamma(x)'), constant)).toBe(asConstant)
    expect(compileScalar(simplify(diff(p('gamma(x)'), 'x', userFunction)), ['x'], userFunction)(5)).toBe(1)
    expect(compileScalar(simplify(diff(p('gamma * x'), 'x', parameter)), ['x'], parameter)(5)).toBe(2)
  })
})

// Inside a function's body its parameter is the value a one-argument call by that
// name multiplies, whatever else the document calls that name. diff renames the
// body's variables, and a call name is not a variable, so the body is first
// rewritten to say the product outright.
describe('a function that multiplies by its own parameter', () => {
  it("a @param of the same name does not take the parameter's place", () => {
    const scope = makeScope({ params: [['a', 10]], functions: [['f', fn(['a'], 'a(a + 1)')]] })
    expect(both(p('f(x)'), 2, scope)).toBe(6)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBe(5)
  })

  it("a constant of the same name does not take the parameter's place", () => {
    const scope = makeScope({ functions: [['k', fn([], '5')], ['f', fn(['k'], 'k(k + 1)')]] })
    expect(both(p('f(x)'), 3, scope)).toBe(12)
    expect(derivativeAt(p('f(t)'), 't', scope, 3)).toBe(7)
  })

  it('f(x) = x(x + 1) differentiates, also at a constant argument', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'x(x + 1)')]] })
    expect(both(p('f(x)'), 2, scope)).toBe(6)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBe(5)
    expect(derivativeAt(p('t * f(2)'), 't', scope, 3)).toBe(6)
  })

  it("the body's own reads of the variable see the same product", () => {
    // f(a) = a(a + 1) c, with a and c both @params of the document: d/dc f(2) = 6, d/dt f(t) at 2 = 5 c = 15
    const scope = makeScope({ params: [['a', 10], ['c', 3]], functions: [['f', fn(['a'], 'a(a + 1) * c')]] })
    expect(both(p('f(x)'), 2, scope)).toBe(18)
    expect(derivativeAt(p('f(2)'), 'c', scope, 3)).toBe(6)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBe(15)
  })

  it("f'(2) for f(x) = x(x + 1) is 5", () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'x(x + 1)')]] })
    expect(both(prime('f', 1, [x]), 2, scope)).toBe(5)
    expect(both(prime('f', 2, [x]), 2, scope)).toBe(2)
  })

  it("d/du g'(u) for g(x) = sin(x) x(x + 1) keeps x the parameter, not the document's @param x", () => {
    const scope = makeScope({ params: [['x', 10]], functions: [['g', fn(['x'], 'sin(x) * x(x + 1)')]] })
    const u = variable('u')
    const second = (at: number) => -Math.sin(at) * (at * at + at) + 2 * Math.cos(at) * (2 * at + 1) + 2 * Math.sin(at)
    expect(derivativeAt(prime('g', 1, [u]), 'u', scope, 1.5)).toBeCloseTo(second(1.5), 12)
    const direct = compileScalar(prime('g', 2, [u]), ['u'], scope)
    expect(direct(1.5)).toBeCloseTo(second(1.5), 12)
  })

  it("the rewrite follows compile's lookup order, and reaches into a binder", () => {
    const scope = makeScope({ functions: [['g', fn(['t'], 't')], ['k', fn([], '5')]] })
    const a = variable('a')
    const two = num(2)
    const rewrite = (expr: Expr, params: string[]) => paramCallsAsProducts(expr, params, scope)
    // a parameter's one-argument call is a product; nested calls are reached
    expect(rewrite(p('a(a + 1)'), ['a'])).toEqual({ kind: 'binary', op: '*', left: a, right: p('a + 1') })
    expect(rewrite(not(call('a', two)), ['a'])).toEqual(not({ kind: 'binary', op: '*', left: a, right: two }))
    // a constant of the name is a product of the parameter that shadows it
    expect(rewrite(call('k', two), ['k'])).toEqual({ kind: 'binary', op: '*', left: variable('k'), right: two })
    // a built-in, a user function of one or more parameters, a reserved name, two arguments, and a name that is no parameter stay calls
    expect(rewrite(p('sin(2)'), ['sin'])).toEqual(p('sin(2)'))
    expect(rewrite(p('g(2)'), ['g'])).toEqual(p('g(2)'))
    expect(rewrite(p('a(1, 2)'), ['a'])).toEqual(p('a(1, 2)'))
    expect(rewrite(p('b(2)'), ['a'])).toEqual(p('b(2)'))
    expect(rewrite(call('__not', two), ['__not'])).toEqual(call('__not', two))
    // __prime's first argument names a function, never a call to rewrite
    expect(rewrite(prime('a', 1, [call('a', two)]), ['a'])).toEqual(prime('a', 1, [{ kind: 'binary', op: '*', left: a, right: two }]))
    // a binder's bound name equal to a parameter changes nothing: substitute does not know binders, so
    // the call is a product there too (the variable then reads the innermost binding, as compile's does)
    const bound = sum('a', num(1), call('a', num(3)), call('a', a))
    expect(rewrite(bound, ['a'])).toEqual(sum('a', num(1), mul(a, num(3)), mul(a, a)))
    // and the binder's own name argument is never rewritten
    expect(rewrite(sum('k', num(1), num(3), call('k', variable('k'))), ['a'])).toEqual(sum('k', num(1), num(3), call('k', variable('k'))))
  })
})

describe('a reserved call whose first argument names nothing is a CompileError', () => {
  const scope = makeScope({ functions: [['f', fn(['t'], 't^2')]] })

  it('a typed __prime(2, 1, x), on both paths and in diff', () => {
    const message = '__prime: the first argument must name the function'
    expect(bothRefuse(p('__prime(2, 1, x)'), scope)).toBe(message)
    expect(bothRefuse(call('__prime'), scope)).toBe(message)
    expect(() => diff(p('__prime(2, 1, x)'), 'x', scope)).toThrow(CompileError)
    try {
      compileScalar(p('__prime(2, 1, x)'), ['x'], scope)
    } catch (err) {
      expect((err as CompileError).names).toEqual(['__prime'])
    }
  })
})

// f', f'', ... are bodies over a fresh name for the function's parameter, not the
// parameter's own name: a document @param or constant of that name, read from
// inside the derivative (through a constant, or through a call a prime expanded),
// is the document's value, not the variable being differentiated.
describe("f', f'' keep the function's parameter apart from a document name equal to it", () => {
  const u = variable('u')

  it("@param x = 10, c = x, f(x) = x c: f(2) = 20, d/dt f(t) = 10 and f'(2) = 10", () => {
    const scope = makeScope({ params: [['x', 10]], functions: [['c', fn([], 'x')], ['f', fn(['x'], 'x * c')]] })
    expect(both(p('f(u)'), 2, scope, 'u')).toBe(20)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBe(10)
    expect(both(prime('f', 1, [u]), 2, scope, 'u')).toBe(10)
  })

  it("f(x) = x x c: f'(2) = 2 c x = 40, f''(2) = 2 c = 20, also as d/du f'(u)", () => {
    const scope = makeScope({ params: [['x', 10]], functions: [['c', fn([], 'x')], ['f', fn(['x'], 'x * x * c')]] })
    expect(both(prime('f', 1, [u]), 2, scope, 'u')).toBe(40)
    expect(both(prime('f', 2, [u]), 2, scope, 'u')).toBe(20)
    expect(derivativeAt(prime('f', 1, [variable('t')]), 't', scope, 2)).toBe(20)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBe(40)
  })

  it("h(t) = sin(t) x(t) reads the document's x = 10; f(x) = h'(x): f'(2) = 20 cos 2 - 20 sin 2, f''(2) = -30 sin 2 - 20 cos 2", () => {
    // h = 10 t sin t, f(x) = h'(x) = 10 sin x + 10 x cos x
    const scope = makeScope({
      params: [['x', 10]],
      functions: [
        ['h', fn(['t'], 'sin(t) * x(t)')],
        ['f', { params: ['x'], body: prime('h', 1, [variable('x')]) }],
      ],
    })
    expect(both(p('f(u)'), 2, scope, 'u')).toBeCloseTo(10 * Math.sin(2) + 20 * Math.cos(2), 12)
    expect(both(prime('f', 1, [u]), 2, scope, 'u')).toBeCloseTo(20 * Math.cos(2) - 20 * Math.sin(2), 12)
    expect(both(prime('f', 2, [u]), 2, scope, 'u')).toBeCloseTo(-30 * Math.sin(2) - 20 * Math.cos(2), 12)
    expect(derivativeAt(p('f(t)'), 't', scope, 2)).toBeCloseTo(20 * Math.cos(2) - 20 * Math.sin(2), 12)
    expect(derivativeAt(prime('f', 1, [variable('t')]), 't', scope, 2)).toBeCloseTo(-30 * Math.sin(2) - 20 * Math.cos(2), 12)
  })
})

// A derivative's body can grow tenfold with every order (a composition of two quotients:
// 190279 nodes at order 5, 6.5 s for one 401-sample pass of the viewer, which rebuilds on
// every pan frame). Exact or refuse: past the cap it is a CompileError, raised at the
// order that crosses it, before the larger one is built.
describe('a derivative too large to compute is refused', () => {
  // g(x) = f(f(x)) with f(x) = x^2 / (1 + x^2): g'''' has 20405 nodes, g''''' 190279
  const blowup = () => makeScope({ functions: [['f', fn(['x'], 'x^2 / (1 + x^2)')], ['g', fn(['x'], 'f(f(x))')]] })

  it("g'''''(x) refuses on both paths with a message naming the order asked for, the order that crossed and the cap, and does little work to say so", () => {
    const scope = blowup()
    const before = differentiationSteps()
    const message = bothRefuse(prime('g', 5, [x]), scope)
    const steps = differentiationSteps() - before
    expect(MAX_DERIVATIVE_NODES).toBe(16000)
    expect(message).toBe(
      `"g'''''" is too large to differentiate (order 4 passes ${MAX_DERIVATIVE_NODES} nodes); differentiate fewer times, or write the derivative out`
    )
    // The refusal is raised where the body first crosses the cap (g'''' at 20405 nodes), so diff has
    // visited a few thousand nodes of g''' and no more; building g''''' would visit over 20000 more.
    expect(steps).toBeLessThan(20000)
    // a refusal is a CompileError that names the function
    try {
      compileScalar(prime('g', 5, [x]), ['x'], scope)
    } catch (err) {
      expect((err as CompileError).names).toEqual(['g'])
    }
  })

  it('the refusal is remembered: asking again in the same scope does no more differentiating', () => {
    const scope = blowup()
    bothRefuse(prime('g', 5, [x]), scope)
    const before = differentiationSteps()
    bothRefuse(prime('g', 5, [x]), scope)
    const fourth = bothRefuse(prime('g', 4, [x]), scope)
    expect(differentiationSteps() - before).toBe(0)
    // each ask names the order it asked for; both name the order that crossed
    expect(fourth).toMatch(/^"g''''" is too large to differentiate \(order 4 passes /)
  })

  it("a refusal names the order that crossed the cap, whichever order was asked for", () => {
    // g''''(x) crosses (20405 nodes); the kernel goes three orders past MAX_PRIME_ORDER, so a g''''''
    // (asked for by diff of g''''') still names order 4
    expect(bothRefuse(prime('g', 4, [x]), blowup())).toMatch(/^"g''''" is too large to differentiate \(order 4 passes /)
    expect(bothRefuse(prime('g', 6, [x]), blowup())).toMatch(/^"g''''''" is too large to differentiate \(order 4 passes /)
  })

  it("another function's refusal is not reworded under the caller: h(x) = g''''(x), asked for h', is g's", () => {
    // h' needs g'''' (20405 nodes), which crosses the cap; h has no order 4, and "differentiate h fewer
    // times" would be wrong advice. Both the message and the names are g's.
    const scope = makeScope({
      functions: [['f', fn(['x'], 'x^2 / (1 + x^2)')], ['g', fn(['x'], 'f(f(x))')], ['h', { params: ['x'], body: prime('g', 4, [x]) }]],
    })
    const message = bothRefuse(prime('h', 1, [x]), scope)
    expect(message).toBe(
      `"g''''" is too large to differentiate (order 4 passes ${MAX_DERIVATIVE_NODES} nodes); differentiate fewer times, or write the derivative out`
    )
    for (const compile of [() => compileScalar(prime('h', 1, [x]), ['x'], scope), () => compileMany([prime('h', 1, [x])], ['x'], scope)]) {
      try {
        compile()
        throw new Error('compiled without a refusal')
      } catch (err) {
        expect(err).toBeInstanceOf(CompileError)
        expect((err as CompileError).names).toEqual(['g'])
      }
    }
    // written as h'(x) it is the same refusal; and g's own ask is still worded for g
    expect(bothRefuse(p("h'(x)"), scope)).toBe(message)
    expect(bothRefuse(prime('g', 5, [x]), scope)).toMatch(/^"g'''''" is too large to differentiate \(order 4 passes /)
  })

  it("the orders below the cap still work, in the same scope that refused a higher one", () => {
    const scope = blowup()
    bothRefuse(prime('g', 5, [x]), scope)
    // g(x) = f(f(x)); g'(0) = f'(f(0)) f'(0) = f'(0) f'(0) = 0 (f'(x) = 2x / (1 + x^2)^2)
    expect(both(prime('g', 1, [x]), 0, scope)).toBeCloseTo(0, 14)
    // g'(1): f(1) = 1/2, f'(1) = 1/2, f'(1/2) = 1 / (5/4)^2 = 16/25: 16/25 * 1/2 = 8/25
    expect(both(prime('g', 1, [x]), 1, scope)).toBeCloseTo(8 / 25, 14)
    expect(Number.isFinite(both(prime('g', 3, [x]), 1, scope))).toBe(true)
  })

  it("an ordinary f''''' still works, to the largest the cap allows", () => {
    // exp(-x^2): d^5/dx^5 = -H5(x) exp(-x^2), H5 = 32x^5 - 160x^3 + 120x; at 1 that is 8/e
    const gauss = makeScope({ functions: [['f', fn(['x'], 'exp(-x^2)')]] })
    expect(both(prime('f', 5, [x]), 1, gauss)).toBeCloseTo(8 / Math.E, 12)
    // 1/(1 + x^2): d^5/dx^5 = -120 sin(6 arccot x) / (1 + x^2)^3, which is 15 at 1
    const witch = makeScope({ functions: [['f', fn(['x'], '1/(1 + x^2)')]] })
    expect(both(prime('f', 5, [x]), 1, witch)).toBeCloseTo(15, 11)
    // sqrt(1 + x^2) has a 6010-node fifth derivative: under the cap, and equal to the central
    // difference of the (exact) fourth
    const root = makeScope({ functions: [['f', fn(['x'], 'sqrt(1 + x^2)')]] })
    const fourth = compileScalar(prime('f', 4, [x]), ['x'], root)
    const h = 1e-4
    const fifth = both(prime('f', 5, [x]), 0.7, root)
    expect(Math.abs(fifth - (fourth(0.7 + h) - fourth(0.7 - h)) / (2 * h))).toBeLessThan(1e-6)
  })

  // The fifth derivatives a review measured, in nodes: 8829, 10039, 11175, 13595, 8341, 15244. Ordinary
  // calculus that worked before the cap, so it must keep working under it: each compiles on both paths
  // and its value is the slope of the (exact) fourth derivative, taken as a central difference. h = 1e-5
  // puts the truncation error near h^2 f(7) / 6 and the rounding error near eps f(4) / h; the six
  // agree to a relative 7e-11 to 5.3e-10 (measured), and the bound is 1e-6. Each also has its exact
  // value at that point (sympy, diff(f, x, 5) evaluated at the rational point, 20 digits), pinned to
  // a relative 1e-9.
  it.each([
    ['(x^3 - 2*x)/(x^2 + 4)', 0.7, 3.454424553528079],
    ['(x^2 + 1)/(x^3 - x)', 2.3, -24.14344860097665],
    ['(x + 1)^2/(x - 1)^3', 2.5, -572.400548696845],
    ['x/(x^2 + 1)^2', 0.6, -98.33483557008043],
    ['sin(x)/(1 + cos(x))', 0.9, 1.947713007228414],
    ['sin(x)^2/(1 + x^2)', 1.4, -4.788540322133833],
  ])("the fifth derivative of %s at x = %s is %s on both paths, and is the slope of the fourth", (body, at, exact) => {
    const scope = makeScope({ functions: [['f', fn(['x'], body)]] })
    const h = 1e-5
    const fifth = both(prime('f', 5, [x]), at, scope)
    expect(Math.abs(fifth - exact)).toBeLessThan(1e-9 * Math.abs(exact))
    const fourthScalar = compileScalar(prime('f', 4, [x]), ['x'], scope)
    const fourthMany = compileMany([prime('f', 4, [x])], ['x'], scope)
    const slopes = [
      (fourthScalar(at + h) - fourthScalar(at - h)) / (2 * h),
      (fourthMany(one, at + h)[0] - fourthMany(one, at - h)[0]) / (2 * h),
    ]
    for (const slope of slopes) expect(Math.abs(fifth - slope)).toBeLessThan(1e-6 * Math.max(1, Math.abs(fifth)))
  })

  it('a high power is fine: its derivatives are small however large the exponent', () => {
    // x^30 differentiated five times is 30 29 28 27 26 x^25: a handful of nodes
    const power = makeScope({ functions: [['f', fn(['x'], 'x^30')]] })
    expect(both(prime('f', 5, [x]), 2, power)).toBeCloseTo(30 * 29 * 28 * 27 * 26 * 2 ** 25, -3)
  })
})
