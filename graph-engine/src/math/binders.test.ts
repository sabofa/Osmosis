import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { CompileError, compileMany, compileScalar, freeVariablesDeep } from './compile'
import { diff } from './diff'
import { call, num, substitute, varNames, variable } from './expr'
import { integrateValue } from './binders'
import { integral, prime, prod, sum } from './reserved'
import { makeScope, type MathScope } from './scope'
import { simplify } from './simplify'

const k = variable('k')
const t = variable('t')
const x = variable('x')
const one = new Float64Array(1)

function both(expr: Expr, vars: string[], at: number[], scope = makeScope()): number {
  const closure = compileScalar(expr, vars, scope)(...at)
  const program = compileMany([expr], vars, scope)(one, ...at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

// d/dv of expr at `at` (v the only variable), on both compile paths.
function derivativeAt(expr: Expr, v: string, scope: MathScope, at: number): number {
  const d = simplify(diff(expr, v, scope))
  const closure = compileScalar(d, [v], scope)(at)
  const program = compileMany([d], [v], scope)(one, at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

// The message a compile refuses with, which both paths must give.
function bothRefuse(expr: Expr, scope = makeScope(), vars: string[] = ['x']): CompileError {
  const errors = [() => compileScalar(expr, vars, scope), () => compileMany([expr], vars, scope)].map((compile) => {
    try {
      compile()
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError)
      return err as CompileError
    }
    throw new Error('compiled without a refusal')
  })
  expect(errors[1].message).toBe(errors[0].message)
  expect(errors[1].names).toEqual(errors[0].names)
  return errors[0]
}

describe('__sum and __prod', () => {
  it('sum(k = 1 to 10, k) is 55; prod(k = 1 to 5, k) is 120', () => {
    expect(both(sum('k', num(1), num(10), k), [], [])).toBe(55)
    expect(both(prod('k', num(1), num(5), k), [], [])).toBe(120)
  })

  it('an empty sum is 0 and an empty product is 1', () => {
    expect(both(sum('k', num(3), num(2), k), [], [])).toBe(0)
    expect(both(prod('k', num(3), num(2), k), [], [])).toBe(1)
  })

  it('the Taylor partial sum of e^x at x = 1 with n = 15 is e to 1e-12', () => {
    // n! syntax arrives in Task 5, so the factorial is spelled gamma(k + 1).
    const scope = makeScope({ params: [['n', 15]] })
    const s = sum('k', num(0), variable('n'), p('x^k / gamma(k + 1)'))
    expect(Math.abs(both(s, ['x'], [1], scope) - Math.E)).toBeLessThan(1e-12)
  })

  it('reads the outer variables around it', () => {
    // Σ_{k=1}^{3} k·x = 6x
    expect(both(sum('k', num(1), num(3), p('k x')), ['x'], [2])).toBe(12)
  })

  it('refuses a constant bound that is not whole, and too many terms', () => {
    expect(() => compileScalar(sum('k', num(0.5), num(3), k), [], makeScope())).toThrow(CompileError)
    expect(() => compileScalar(sum('k', num(0), num(200000), k), [], makeScope())).toThrow(/100000/)
  })

  it('is NaN at run time when a parameter bound is not whole', () => {
    const scope = makeScope({ params: [['n', 2.5]] })
    expect(both(sum('k', num(0), variable('n'), k), [], [], scope)).toBeNaN()
  })

  it('d/dx sum(k = 1 to 3, x^k) at 1 is 1 + 2 + 3', () => {
    const d = simplify(diff(sum('k', num(1), num(3), p('x^k')), 'x', makeScope()))
    expect(compileScalar(d, ['x'], makeScope())(1)).toBe(6)
  })

  it('a product has no derivative rule yet', () => {
    expect(() => diff(prod('k', num(1), num(3), p('x + k')), 'x', makeScope())).toThrow(CompileError)
  })
})

describe('__integral', () => {
  it('integral(t = 0 to x, 2t) at 3 is 9', () => {
    expect(Math.abs(both(integral('t', num(0), x, p('2t')), ['x'], [3]) - 9)).toBeLessThan(1e-12)
  })

  it('Si(1), the integral of sin(t)/t from 0 to 1', () => {
    expect(Math.abs(both(integral('t', num(0), num(1), p('sin(t)/t')), [], []) - 0.946083070367183)).toBeLessThan(1e-12)
  })

  it('infinite bounds by a change of variables', () => {
    expect(Math.abs(both(integral('t', num(1), variable('inf'), p('1/t^2')), [], []) - 1)).toBeLessThan(1e-9)
    expect(Math.abs(both(integral('t', p('-inf'), variable('inf'), p('exp(-t^2)')), [], []) - Math.sqrt(Math.PI))).toBeLessThan(1e-9)
  })

  it('a divergent integral is NaN', () => {
    expect(both(integral('t', num(1), variable('inf'), p('1/t')), [], [])).toBeNaN()
  })

  it('reversed bounds change the sign', () => {
    expect(Math.abs(both(integral('t', num(3), num(0), p('2t')), [], []) + 9)).toBeLessThan(1e-12)
  })

  it('integrateValue: equal bounds are 0, NaN bounds are NaN', () => {
    expect(integrateValue((u) => u, 2, 2)).toBe(0)
    expect(integrateValue((u) => u, Number.NaN, 2)).toBeNaN()
  })

  it('Leibniz: d/dx integral(t = 0 to x, sin t) is sin x; d/dx integral(t = 0 to x^2, t) is 2x^3', () => {
    const scope = makeScope()
    const a = compileScalar(simplify(diff(integral('t', num(0), x, p('sin(t)')), 'x', scope)), ['x'], scope)
    expect(a(1)).toBeCloseTo(Math.sin(1), 14)
    const b = compileScalar(simplify(diff(integral('t', num(0), p('x^2'), t), 'x', scope)), ['x'], scope)
    expect(b(2)).toBeCloseTo(16, 12)
  })

  it('Leibniz under the sign: d/da integral(t = 0 to 1, a t) is 1/2', () => {
    const scope = makeScope({ params: [['a', 3]] })
    const d = compileScalar(simplify(diff(integral('t', num(0), num(1), p('a t')), 'a', scope)), [], scope)
    expect(d()).toBeCloseTo(0.5, 12)
  })
})

describe('binders bind', () => {
  it('a substitution never reaches the bound variable', () => {
    const s = sum('k', num(0), num(3), p('k x'))
    expect(substitute(s, new Map([['k', num(5)]]))).toEqual(s)
  })

  it('a substituted value that mentions the bound name does not get captured', () => {
    // Σ_{j=0}^{3} j · k with the outer k = 2 is 12
    const s = substitute(sum('k', num(0), num(3), p('k x')), new Map([['x', variable('k')]]))
    expect(compileScalar(s, ['k'], makeScope())(2)).toBe(12)
  })

  it('varNames and freeVariablesDeep leave the bound name out', () => {
    expect(varNames(sum('k', num(0), variable('n'), p('k x')))).toEqual(new Set(['n', 'x']))
    const scope = makeScope({ params: [['a', 1]] })
    expect(freeVariablesDeep(integral('t', num(0), x, p('a t')), scope, new Set(['x']))).toEqual(new Set(['a']))
  })
})

// ---------------------------------------------------------------------------
// Beyond the brief's tests
// ---------------------------------------------------------------------------

describe('a binder is a binder wherever it sits', () => {
  it('nests: a sum in a sum, an integral in a sum, an integral of an integral', () => {
    // Σ_{j=1}^{3} Σ_{k=1}^{j} k = 1 + 3 + 6
    expect(both(sum('j', num(1), num(3), sum('k', num(1), variable('j'), k)), [], [])).toBe(10)
    // Σ_{k=1}^{3} ∫_0^k 2t dt = 1 + 4 + 9
    expect(Math.abs(both(sum('k', num(1), num(3), integral('t', num(0), k, p('2t'))), [], []) - 14)).toBeLessThan(1e-11)
    // ∫_0^1 ∫_0^s t dt ds = 1/6
    expect(Math.abs(both(integral('s', num(0), num(1), integral('t', num(0), variable('s'), t)), [], []) - 1 / 6)).toBeLessThan(1e-9)
  })

  it('an inner binder may reuse the outer name; the inner body reads the innermost', () => {
    // Σ_{k=1}^{2} Σ_{k=1}^{3} k = 2 · 6
    expect(both(sum('k', num(1), num(2), sum('k', num(1), num(3), k)), [], [])).toBe(12)
  })

  it('reads a user function and a constant from its body, and is one inside a function', () => {
    const scope = makeScope({
      functions: [
        ['c', { params: [], body: num(3) }],
        ['sq', { params: ['u'], body: p('u^2') }],
        ['area', { params: ['x'], body: integral('t', num(0), x, p('2t')) }],
        ['tri', { params: ['n'], body: sum('k', num(1), variable('n'), k) }],
      ],
    })
    // Σ_{k=1}^{c} sq(k) = 1 + 4 + 9
    expect(both(sum('k', num(1), variable('c'), p('sq(k)')), [], [], scope)).toBe(14)
    // an inlined function's argument is a computed register, not a variable
    expect(Math.abs(both(p('area(x + 1)'), ['x'], [2], scope) - 9)).toBeLessThan(1e-12)
    expect(both(p('tri(x + 1)'), ['x'], [3], scope)).toBe(10)
    expect(both(p('tri(x) + tri(x)'), ['x'], [3], scope)).toBe(12)
  })

  it('a name called with one argument inside the body is the product it is outside', () => {
    // x(k) with x a bound input is x * k
    expect(both(sum('k', num(1), num(3), p('x(k)')), ['x'], [2])).toBe(12)
    // k(2) with k the bound index is k * 2
    expect(both(sum('k', num(1), num(3), call('k', num(2))), [], [])).toBe(12)
  })

  it('a binder that appears twice at the top level is the same value', () => {
    const s = sum('k', num(1), num(3), p('k x'))
    const out = compileMany([s, s], ['x'], makeScope())(new Float64Array(2), 2)
    expect([out[0], out[1]]).toEqual([12, 12])
  })

  it('refuses the wrong number of arguments, and a first argument that names nothing, on both paths', () => {
    for (const name of ['__sum', '__prod', '__integral']) {
      expect(bothRefuse(call(name, k, num(1), num(3))).message).toBe(`"${name}" takes 4 arguments, got 3`)
      expect(bothRefuse(call(name, k, num(1), num(3))).names).toEqual([name])
      const unnamed = bothRefuse(call(name, num(2), num(1), num(3), x))
      expect(unnamed.message).toMatch(new RegExp(`^${name}: the first argument must name the`))
      expect(unnamed.names).toEqual([name])
    }
  })

  it('an unknown name in the body is a CompileError on both paths, hint and all', () => {
    expect(bothRefuse(sum('k', num(1), num(3), variable('q'))).names).toEqual(['q'])
    // "xy" with x and y both inputs reads as the product the author forgot to mark
    expect(bothRefuse(sum('k', num(1), num(3), variable('xy')), makeScope(), ['x', 'y']).message).toBe('Unknown variable "xy" — did you mean x*y?')
  })

  it('a cycle through a binder is named the same on both paths', () => {
    const scope = makeScope({
      functions: [
        ['f', { params: ['x'], body: sum('k', num(1), num(2), call('g', k)) }],
        ['g', { params: ['x'], body: call('f', variable('x')) }],
      ],
    })
    const message = bothRefuse(p('f(x)'), scope).message
    expect(message).toMatch(/"f" and "g" are defined in terms of each other/)
  })

  it('the integrand reads the caller frame: two integrals over one variable do not disturb each other', () => {
    // ∫_0^x t dt + ∫_0^x t^2 dt at x = 3: 4.5 + 9
    const e = { kind: 'binary', op: '+', left: integral('t', num(0), x, t), right: integral('t', num(0), x, p('t^2')) } as Expr
    expect(Math.abs(both(e, ['x'], [3]) - 13.5)).toBeLessThan(1e-11)
  })
})

describe('binders and the derivative', () => {
  it('a user function with a binder in its body: g(x) = sum(k = 1 to 3, k x), g\'(2) and d/dt g(t) are 6', () => {
    const scope = makeScope({ functions: [['g', { params: ['x'], body: sum('k', num(1), num(3), p('k x')) }]] })
    expect(both(prime('g', 1, [num(2)]), [], [], scope)).toBe(6)
    expect(derivativeAt(call('g', variable('t')), 't', scope, 2)).toBe(6)
    // its second derivative is 0, and f'(u) differentiates through the chain rule
    expect(derivativeAt(prime('g', 1, [variable('t')]), 't', scope, 2)).toBe(0)
    expect(derivativeAt(call('g', p('t^2')), 't', scope, 2)).toBe(24)
  })

  it('a function whose body is an integral: F(x) = integral(t = 0 to x, 2t), F\'(3) = 6, d/du F(u^2) at 2 = 4 * 8', () => {
    const scope = makeScope({ functions: [['F', { params: ['x'], body: integral('t', num(0), x, p('2t')) }]] })
    expect(Math.abs(both(prime('F', 1, [num(3)]), [], [], scope) - 6)).toBeLessThan(1e-9)
    expect(Math.abs(derivativeAt(call('F', p('u^2')), 'u', scope, 2) - 32)).toBeLessThan(1e-9)
  })

  it('a parameter named like the bound variable stays the parameter outside the binder', () => {
    // f(k) = sum(k = 1 to 3, k) + k: the sum is 6 whatever k is, so f(2) = 8, f'(2) = 1, d/dt f(t) = 1
    const scope = makeScope({ functions: [['f', { params: ['k'], body: { kind: 'binary', op: '+', left: sum('k', num(1), num(3), k), right: k } as Expr }]] })
    expect(both(call('f', num(2)), [], [], scope)).toBe(8)
    expect(both(prime('f', 1, [num(2)]), [], [], scope)).toBe(1)
    expect(derivativeAt(call('f', variable('t')), 't', scope, 2)).toBe(1)
  })

  it('a typo in a body does not hide behind its derivative', () => {
    const scope = makeScope({ functions: [['f', { params: ['x'], body: p('x + q') }]] })
    for (const compile of [() => compileScalar(prime('f', 1, [variable('u')]), ['u'], scope), () => compileMany([prime('f', 1, [variable('u')])], ['u'], scope)]) {
      expect(compile).toThrow(/Unknown variable "q"/)
    }
    expect(bothRefuse(call('f', variable('u')), scope, ['u']).message).toBe('Unknown variable "q"')
    expect(bothRefuse(prime('f', 1, [variable('u')]), scope, ['u']).message).toBe('Unknown variable "q"')
    expect(bothRefuse(prime('f', 1, [variable('u')]), scope, ['u']).names).toEqual(['q'])
  })

  it('a typo inside a binder in a body does not hide either', () => {
    const scope = makeScope({ functions: [['f', { params: ['x'], body: sum('k', num(1), num(3), p('k x + q')) }]] })
    expect(bothRefuse(prime('f', 1, [variable('u')]), scope, ['u']).names).toEqual(['q'])
  })

  it("a function whose body is fine still has a derivative (the body check changes nothing)", () => {
    const scope = makeScope({ params: [['a', 2]], functions: [['f', { params: ['x'], body: p('a x^2') }]] })
    expect(both(prime('f', 1, [x]), ['x'], [3], scope)).toBe(12)
  })

  it('a derivative refusal inside a function is set aside for an argument that is constant', () => {
    // h(x, n) = x * sum(k = 1 to n, k): refused in n (the bounds), fine in x
    const body = { kind: 'binary', op: '*', left: variable('x'), right: sum('k', num(1), variable('n'), k) } as Expr
    const scope = makeScope({ functions: [['h', { params: ['x', 'n'], body }]] })
    expect(derivativeAt(call('h', variable('t'), num(3)), 't', scope, 2)).toBe(6)
    // ...and still refused when the bound itself varies
    expect(() => diff(call('h', num(2), variable('t')), 't', scope)).toThrow(CompileError)
  })

  it('the same for a product: no rule, but only a refusal when it depends on the variable', () => {
    const body = { kind: 'binary', op: '+', left: variable('x'), right: prod('k', num(1), num(3), p('a + k')) } as Expr
    const scope = makeScope({ functions: [['m', { params: ['x', 'a'], body }]] })
    expect(derivativeAt(call('m', variable('t'), num(2)), 't', scope, 5)).toBe(1)
    expect(() => diff(call('m', num(1), variable('t')), 't', scope)).toThrow(CompileError)
    // a product that does not read the variable is constant
    expect(diff(prod('k', num(1), num(3), p('a + k')), 'x', makeScope({ params: [['a', 2]] }))).toEqual(num(0))
    expect(() => diff(prod('k', num(1), num(3), p('x + k')), 'x', makeScope())).toThrow(/product/)
  })

  it('a sum whose bounds depend on the variable has no rule, unless the variable is not read', () => {
    expect(() => diff(sum('k', num(1), x, k), 'x', makeScope())).toThrow(/bounds depend on "x"/)
    expect(() => diff(sum('k', num(1), x, k), 'x', makeScope())).toThrow(CompileError)
    // a bound that is a @param is constant in x
    const scope = makeScope({ params: [['n', 4]] })
    expect(derivativeAt(sum('k', num(1), variable('n'), p('k x')), 'x', scope, 7)).toBe(10)
    // d/dk of a sum over k is 0: the index is not the variable
    expect(diff(sum('k', num(1), num(3), p('k x')), 'k', makeScope())).toEqual(num(0))
  })

  it('a bound index that shares a name with a user constant is the index, not the constant', () => {
    // k = 2a is a document constant; the sum's own k shadows it, so d/da sum(k = 1 to 3, k a) is 6, not 6a + 6
    const scope = makeScope({ params: [['a', 5]], functions: [['k', { params: [], body: p('2a') }]] })
    expect(derivativeAt(sum('k', num(1), num(3), p('k a')), 'a', scope, 1)).toBe(6)
    expect(derivativeAt(integral('k', num(0), num(2), p('k a')), 'a', scope, 1)).toBeCloseTo(2, 12)
  })

  it('a call named like the bound variable differentiates as the product it compiles to', () => {
    // sum(k = 1 to 3, k(x)) = 6x; integral(t = 0 to x, t(2)) = x^2
    expect(derivativeAt(sum('k', num(1), num(3), call('k', x)), 'x', makeScope(), 5)).toBe(6)
    expect(derivativeAt(integral('t', num(0), x, call('t', num(2))), 'x', makeScope(), 3)).toBeCloseTo(6, 12)
  })

  it('Leibniz with both bounds moving and the integrand reading the variable', () => {
    // F(x) = ∫_x^{x^2} t x dt = (x^5 - x^3) / 2; F'(2) = (5 * 16 - 3 * 4) / 2 = 34
    expect(derivativeAt(integral('t', x, p('x^2'), p('t x')), 'x', makeScope(), 2)).toBeCloseTo(34, 9)
  })

  it('a malformed binder is a CompileError in diff, not a crash', () => {
    expect(() => diff(call('__sum', k, num(1), num(3)), 'x', makeScope())).toThrow(CompileError)
    expect(() => diff(call('__integral', num(1), num(1), num(3), x), 'x', makeScope())).toThrow(CompileError)
  })
})

describe('substitute and varNames, binder-aware', () => {
  it('the bound name stays a name: never replaced, only renamed away from a capture', () => {
    const s = sum('k', num(0), num(3), p('k x'))
    const out = substitute(s, new Map<string, Expr>([['x', p('k + 1')]])) as Expr & { kind: 'call' }
    expect(out.args[0].kind).toBe('var')
    expect((out.args[0] as { name: string }).name).not.toBe('k')
    // Σ_{j=0}^{3} j (k + 1) with the outer k = 2 is 18
    expect(compileScalar(out, ['k'], makeScope())(2)).toBe(18)
  })

  it('the bounds are outside the binding: a substitution reaches them', () => {
    const s = sum('k', variable('n'), variable('m'), k)
    expect(substitute(s, new Map([['n', num(1)], ['m', num(4)]]))).toEqual(sum('k', num(1), num(4), k))
    expect(substitute(s, new Map([['k', num(9)]]))).toEqual(s)
  })

  it('a replacement that does not mention the bound name leaves the binder as written', () => {
    const s = integral('t', num(0), x, p('t x'))
    expect(substitute(s, new Map<string, Expr>([['x', num(2)]]))).toEqual(integral('t', num(0), num(2), p('t * 2')))
  })

  it('capture-free for a nested binder of the same name', () => {
    // Σ_{k=1}^{2} Σ_{j=1}^{3} j x with x -> k, the k of the outside: not the sum's own k.
    // With the outer k = 2 that is 2 * 6 * 2.
    const s = sum('k', num(1), num(2), sum('j', num(1), num(3), p('j x')))
    const out = substitute(s, new Map<string, Expr>([['x', k]]))
    expect(compileScalar(out, ['k'], makeScope())(2)).toBe(24)
  })

  it('varNames sees a name read by a nested binder only where it is free', () => {
    expect(varNames(sum('j', num(1), num(3), sum('k', num(1), variable('j'), p('k x + j'))))).toEqual(new Set(['x']))
    expect(varNames(integral('t', variable('a'), variable('b'), p('t c')))).toEqual(new Set(['a', 'b', 'c']))
  })
})
