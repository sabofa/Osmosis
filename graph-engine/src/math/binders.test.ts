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

// A float counter stops changing at 2^53 (i++ is i), so a loop with a bound there
// would never end: only whole numbers a float steps through exactly are counted.
describe('a loop is bounded by the whole numbers a float counts exactly', () => {
  const big = 2 ** 53

  it('a constant bound at or above 2^53 is a CompileError naming it, on both paths', () => {
    for (const [build, name] of [[sum, '__sum'], [prod, '__prod']] as const) {
      for (const [lo, hi] of [[big, big], [1, big], [-big, 3], [-1e300, 1e300]] as const) {
        const err = bothRefuse(build('k', num(lo), num(hi), num(1)), makeScope(), [])
        expect(err.message).toMatch(/bound .* is past/)
        expect(err.names).toEqual([name])
      }
    }
    expect(bothRefuse(sum('k', num(big), num(big), num(1)), makeScope(), []).message).toContain('9007199254740992')
  })

  it('a parameter bound at or above 2^53 is NaN at run time, on both paths, and does not hang', () => {
    for (const value of [big, -big, 1e16, 1e300]) {
      const scope = makeScope({ params: [['n', value]] })
      expect(both(sum('k', variable('n'), variable('n'), num(1)), [], [], scope), `sum at ${value}`).toBeNaN()
      expect(both(prod('k', variable('n'), variable('n'), num(1)), [], [], scope), `prod at ${value}`).toBeNaN()
      expect(both(sum('k', num(0), variable('n'), num(1)), [], [], scope), `sum 0 to ${value}`).toBeNaN()
    }
  })

  it('the largest bounds a float counts exactly still count', () => {
    const top = big - 1
    expect(both(sum('k', num(top - 2), num(top), num(1)), [], [])).toBe(3)
    expect(both(prod('k', num(-top), num(-top + 2), num(1)), [], [])).toBe(1)
    const scope = makeScope({ params: [['n', top]] })
    expect(both(sum('k', variable('n'), variable('n'), num(1)), [], [], scope)).toBe(1)
  })
})

// The term limit bounds one nest of loops, counted over the nest: sum(i, sum(j, ...)) runs
// the product of the two ranges, not the larger of them. Bounds known at compile time that
// break it are a CompileError; any other nest that runs past it is NaN, never a long freeze.
describe('the term limit counts across nested loops', () => {
  const inner = (hi: Expr, lo: Expr = num(1)) => sum('j', lo, hi, num(1))
  const nest = (outerHi: Expr, innerHi: Expr) => sum('i', num(1), outerHi, inner(innerHi))
  const n = variable('n')
  const m = variable('m')

  it('sum(i = 1 to 1000, sum(j = 1 to 1000, 1)) is a CompileError at compile, on both paths', () => {
    const err = bothRefuse(nest(num(1000), num(1000)), makeScope(), [])
    expect(err.message).toMatch(/100000/)
    expect(err.message).toMatch(/nested/)
    expect(err.names).toEqual(['__sum'])
    // a product nest, a sum in a product, and the loop in a user function the outer loop calls
    expect(bothRefuse(prod('i', num(1), num(1000), prod('j', num(1), num(1000), num(1))), makeScope(), []).message).toMatch(/100000/)
    expect(bothRefuse(prod('i', num(1), num(1000), inner(num(1000))), makeScope(), []).message).toMatch(/100000/)
    const scope = makeScope({ functions: [['f', { params: ['u'], body: sum('j', num(1), num(1000), variable('u')) }]] })
    expect(bothRefuse(sum('i', num(1), num(1000), p('f(i)')), scope, []).message).toMatch(/100000/)
    // three deep: 50 x 50 x 50 = 125000
    expect(bothRefuse(sum('i', num(1), num(50), sum('j', num(1), num(50), sum('l', num(1), num(50), num(1)))), makeScope(), []).message).toMatch(/100000/)
  })

  it('a nest inside a larger expression or a function body is checked where it is compiled', () => {
    const big = nest(num(1000), num(1000))
    expect(bothRefuse({ kind: 'binary', op: '+', left: num(1), right: big } as Expr, makeScope(), []).message).toMatch(/nested/)
    const scope = makeScope({ functions: [['g', { params: ['x'], body: big }]] })
    expect(bothRefuse(p('g(1)'), scope, []).message).toMatch(/nested/)
  })

  it('sum(i = 1 to 100, sum(j = 1 to 100, 1)) is 10000, and a triple nest of 40 is 64000', () => {
    expect(both(nest(num(100), num(100)), [], [])).toBe(10000)
    expect(both(sum('i', num(1), num(40), sum('j', num(1), num(40), sum('l', num(1), num(40), num(1)))), [], [])).toBe(64000)
  })

  it('a nest that runs exactly the limit is allowed, and one more term is not', () => {
    // 1 + 99999 = 100000: an outer loop of 1 term running an inner loop of 99999
    expect(both(sum('i', num(1), num(1), inner(num(99999))), [], [])).toBe(99999)
    expect(bothRefuse(sum('i', num(1), num(1), inner(num(100000))), makeScope(), []).message).toMatch(/100000/)
  })

  it('with @param bounds of 1000 and 1000 it is NaN on both paths, and returns promptly', () => {
    const scope = makeScope({ params: [['n', 1000], ['m', 1000]] })
    expect(both(nest(n, m), [], [], scope)).toBeNaN()
    // the parameters move with no recompile: the same compiled nest, in range, is a number
    const closure = compileScalar(nest(n, m), [], scope)
    const program = compileMany([nest(n, m)], [], scope)
    scope.params.values[0] = 100
    scope.params.values[1] = 100
    expect(closure()).toBe(10000)
    expect(program(one)[0]).toBe(10000)
    scope.params.values[0] = 1000
    expect(closure()).toBeNaN()
    expect(program(one)[0]).toBeNaN()
  })

  it('a triangle sum counts what it runs: n(n + 1)/2 for n = 400, NaN for n = 500', () => {
    // sum(i = 1 to n, sum(j = 1 to i, 1)): 400 + 80200 iterations, then 500 + 125250
    const triangle = sum('i', num(1), n, sum('j', num(1), variable('i'), num(1)))
    const scope = makeScope({ params: [['n', 400]] })
    expect(both(triangle, [], [], scope)).toBe(80200)
    scope.params.values[0] = 500
    expect(both(triangle, [], [], scope)).toBeNaN()
  })

  it('a loop beside another is its own count, and a second evaluation counts afresh', () => {
    const scope = makeScope({ params: [['n', 60000]] })
    // two sums in a row of 60000: each is under the limit, and each is its own nest
    const twice = { kind: 'binary', op: '+', left: sum('i', num(1), n, num(1)), right: sum('j', num(1), n, num(1)) } as Expr
    expect(both(twice, [], [], scope)).toBe(120000)
    const closure = compileScalar(twice, [], scope)
    expect(closure()).toBe(120000)
    expect(closure()).toBe(120000)
  })

  it('the same compiled nest is NaN for one input and a number for another, on both paths', () => {
    // sum(i = 1 to x, sum(j = 1 to 500, 1)): x = 100 runs 100 + 50000, x = 300 is past the limit
    const e = sum('i', num(1), x, sum('j', num(1), num(500), num(1)))
    expect(both(e, ['x'], [100])).toBe(50000)
    expect(both(e, ['x'], [300])).toBeNaN()
    expect(both(e, ['x'], [100])).toBe(50000)
  })

  it('a loop in a piecewise branch that is not taken is not counted, on either path', () => {
    // compileMany evaluates both loops and compileScalar one: the value is the same
    const big = sum('j', num(1), num(60000), num(1))
    const pieces = { kind: 'call', name: '__piecewise', args: [p('__gt(x, 0)'), big, big] } as Expr
    expect(both(pieces, ['x'], [1])).toBe(60000)
    expect(both(pieces, ['x'], [-1])).toBe(60000)
  })

  it('an integral does not hand its terms to the loops in its integrand: each evaluation counts its own', () => {
    // integral(t = 0 to 1, sum(k = 1 to 40, t^k)) = sum of 1/(k+1) for k = 1..40
    const e = integral('t', num(0), num(1), sum('k', num(1), num(40), p('t^k')))
    let harmonic = 0
    for (let k = 2; k <= 41; k++) harmonic += 1 / k
    expect(Math.abs(both(e, [], []) - harmonic)).toBeLessThan(1e-9)
  })
})

describe('a bound that reads no variable is checked when it is compiled (M1)', () => {
  it('sum(k = -1.5 to 3, k) and a bound of 5/2 are CompileErrors naming the bound, on both paths', () => {
    const lower = bothRefuse(sum('k', p('-1.5'), num(3), k), makeScope(), [])
    expect(lower.message).toBe('sum: the lower bound -1.5 is not a whole number')
    expect(lower.names).toEqual(['__sum'])
    const upper = bothRefuse(sum('k', num(1), p('5/2'), k), makeScope(), [])
    expect(upper.message).toBe('sum: the upper bound 2.5 is not a whole number')
    expect(bothRefuse(prod('k', num(1), p('5/2'), k), makeScope(), []).message).toBe('prod: the upper bound 2.5 is not a whole number')
  })

  it('through a constant, a function of constants, pi, and a NaN', () => {
    const scope = makeScope({
      functions: [
        ['half', { params: [], body: p('5/2') }],
        ['up', { params: ['u'], body: p('u + 0.5') }],
      ],
    })
    expect(bothRefuse(sum('k', num(1), variable('half'), k), scope, []).message).toBe('sum: the upper bound 2.5 is not a whole number')
    expect(bothRefuse(sum('k', num(1), p('up(2)'), k), scope, []).message).toBe('sum: the upper bound 2.5 is not a whole number')
    expect(bothRefuse(sum('k', num(1), variable('pi'), k), makeScope(), []).message).toMatch(/upper bound 3\.14159.* is not a whole number/)
    expect(bothRefuse(sum('k', num(1), p('0/0'), k), makeScope(), []).message).toBe('sum: the upper bound NaN is not a whole number')
  })

  it('a closed bound past the term limit or past 2^53 is a CompileError too', () => {
    expect(bothRefuse(sum('k', num(1), p('10^6'), num(1)), makeScope(), []).message).toMatch(/1000000 terms is past the limit of 100000/)
    expect(bothRefuse(sum('k', num(1), p('2^53'), num(1)), makeScope(), []).message).toMatch(/bound 9007199254740992 is past/)
    expect(bothRefuse(prod('k', p('-(2^53)'), num(1), num(1)), makeScope(), []).message).toMatch(/lower bound -9007199254740992 is past/)
  })

  it('a closed bound that is whole works, as a literal would', () => {
    expect(both(sum('k', num(1), p('2*3'), k), [], [])).toBe(21)
    expect(both(sum('k', p('2^2'), p('10/2'), k), [], [])).toBe(9)
    expect(both(prod('k', num(1), p('floor(4.7)'), k), [], [])).toBe(24)
    const scope = makeScope({ functions: [['n', { params: [], body: num(4) }]] })
    expect(both(sum('k', num(1), variable('n'), k), [], [], scope)).toBe(10)
  })

  it('a bound that reads a variable, a @param or the bound index of an outer loop is still a run-time check', () => {
    const scope = makeScope({ params: [['n', 2.5]] })
    expect(both(sum('k', num(1), variable('n'), k), [], [], scope)).toBeNaN()
    expect(both(sum('k', num(1), p('x/2'), k), ['x'], [5])).toBeNaN()
    expect(both(sum('k', num(1), p('x/2'), k), ['x'], [6])).toBe(6)
    // the inner bound reads the outer index, even when a user constant has the index's name
    const named = makeScope({ functions: [['i', { params: [], body: p('5/2') }]] })
    expect(both(sum('i', num(1), num(3), sum('j', num(1), variable('i'), num(1))), [], [], named)).toBe(6)
    // a call by the index name, i(2), is the product i * 2: 2, 4, 6 as the bound
    expect(both(sum('i', num(1), num(3), sum('j', num(1), call('i', num(2)), num(1))), [], [], named)).toBe(12)
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
    expect(() => diff(sum('k', num(1), x, k), 'x', makeScope())).toThrow(/bounds depend on the variable/)
    expect(() => diff(sum('k', num(1), x, k), 'x', makeScope())).toThrow(CompileError)
    // a bound that is a @param is constant in x
    const scope = makeScope({ params: [['n', 4]] })
    expect(derivativeAt(sum('k', num(1), variable('n'), p('k x')), 'x', scope, 7)).toBe(10)
    // d/dk of a sum over k is 0: the index is not the variable
    expect(diff(sum('k', num(1), num(3), p('k x')), 'k', makeScope())).toEqual(num(0))
  })

  it('a refusal raised through a user function never prints an internal parameter name', () => {
    const message = (run: () => unknown): string => {
      try {
        run()
      } catch (err) {
        return (err as Error).message
      }
      return ''
    }
    // h(x, n) = x * sum(k = 1 to n, k) and m(x, a) = x + prod(k = 1 to 3, a + k), each refused in its second parameter
    const h = { params: ['x', 'n'], body: { kind: 'binary', op: '*', left: variable('x'), right: sum('k', num(1), variable('n'), k) } as Expr }
    const m = { params: ['x', 'a'], body: { kind: 'binary', op: '+', left: variable('x'), right: prod('k', num(1), num(3), p('a + k')) } as Expr }
    const scope = makeScope({ functions: [['h', h], ['m', m]] })
    const t = variable('t')
    for (const [label, expr, pattern] of [
      ['sum through h', call('h', num(2), t), /No derivative rule for a sum/],
      ['prod through m', call('m', num(1), t), /No derivative rule for a product/],
      ['sum direct', sum('k', num(1), t, k), /No derivative rule for a sum/],
      ['prod direct', prod('k', num(1), num(3), p('t + k')), /No derivative rule for a product/],
    ] as const) {
      const said = message(() => diff(expr, 't', scope))
      expect(said, label).toMatch(pattern)
      expect(said, label).not.toContain('#')
      expect(said, label).not.toContain('"t"')
    }
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

// diff copies derivative expressions into a binder's body, and those mention free
// names (a @param, a constant, pi, e, inf). A binder whose bound name is one of them
// must not read them as itself: compile resolves the binder first, so the values are
// right and only the derivative could go wrong. Each check below is the derivative
// of the compiled function on BOTH compile paths against a closed form, and against
// central differences of the compiled value (h = 1e-5, tolerance 1e-6).
describe('a binder named like a document name does not capture it in the derivative', () => {
  const central = (f: (a: number) => number, at: number, h = 1e-5) => (f(at + h) - f(at - h)) / (2 * h)

  it('@param k, g(x) = k x^2, F(x) = sum(k = 1 to 3, g(x)): F(x) = 15 x^2, so F\'(1) is 30, not 12', () => {
    const scope = makeScope({
      params: [['k', 5]],
      functions: [
        ['g', { params: ['x'], body: p('k x^2') }],
        ['F', { params: ['x'], body: sum('k', num(1), num(3), p('g(x)')) }],
      ],
    })
    expect(both(call('F', x), ['x'], [2], scope)).toBe(60)
    expect(derivativeAt(call('F', x), 'x', scope, 1)).toBeCloseTo(30, 12)
    expect(derivativeAt(call('F', x), 'x', scope, 3)).toBeCloseTo(90, 12)
    // f'(x), which compiles the same diff, and the second derivative through it
    expect(both(prime('F', 1, [num(1)]), [], [], scope)).toBeCloseTo(30, 12)
    expect(both(prime('F', 2, [num(1)]), [], [], scope)).toBeCloseTo(30, 12)
    expect(central(compileScalar(call('F', x), ['x'], scope), 1)).toBeCloseTo(30, 6)
    // the parameter moves with the document: no recompile, the derivative follows it
    scope.params.values[0] = 2
    expect(derivativeAt(call('F', x), 'x', scope, 1)).toBeCloseTo(12, 12)
  })

  it('@param a, f(t) = a t, I(x) = integral(a = 0 to 1, f(x)): I(x) = 10 x, so I\'(x) is 10, not 0.5', () => {
    const scope = makeScope({
      params: [['a', 10]],
      functions: [
        ['f', { params: ['t'], body: p('a t') }],
        ['I', { params: ['x'], body: integral('a', num(0), num(1), p('f(x)')) }],
      ],
    })
    expect(Math.abs(both(call('I', x), ['x'], [3], scope) - 30)).toBeLessThan(1e-9)
    expect(Math.abs(derivativeAt(call('I', x), 'x', scope, 3) - 10)).toBeLessThan(1e-9)
    expect(Math.abs(both(prime('I', 1, [num(3)]), [], [], scope) - 10)).toBeLessThan(1e-9)
    expect(Math.abs(central(compileScalar(call('I', x), ['x'], scope), 3) - 10)).toBeLessThan(1e-6)
  })

  it('a bound pi: d/dx sum(pi = 1 to 2, erf(x)) at 0.5 is 2 (2/sqrt(pi)) e^-0.25 = 1.758, not 2.659', () => {
    const scope = makeScope()
    const s = p('sum(pi = 1 to 2, erf(x))')
    const closed = 2 * (2 / Math.sqrt(Math.PI)) * Math.exp(-0.25)
    expect(closed).toBeCloseTo(1.758, 3)
    expect(Math.abs(derivativeAt(s, 'x', scope, 0.5) - closed)).toBeLessThan(1e-9)
    expect(Math.abs(central(compileScalar(s, ['x'], scope), 0.5) - closed)).toBeLessThan(1e-6)
    // the integral form of the same name, ∫_1^2 erf(x) dpi = erf(x)
    const i = integral('pi', num(1), num(2), p('erf(x)'))
    expect(Math.abs(derivativeAt(i, 'x', scope, 0.5) - closed / 2)).toBeLessThan(1e-9)
  })

  it('a bound pi under @angle: degrees: d/dx sum(pi = 1 to 2, sin(x)) at 30 is 2 cos(30°) pi/180', () => {
    const scope = makeScope({ angle: 'degrees' })
    const closed = (2 * Math.cos(Math.PI / 6) * Math.PI) / 180
    expect(Math.abs(derivativeAt(p('sum(pi = 1 to 2, sin(x))'), 'x', scope, 30) - closed)).toBeLessThan(1e-12)
    // inverse trig carries 180/pi
    const asinClosed = (2 * 180) / Math.PI / Math.sqrt(1 - 0.25)
    expect(Math.abs(derivativeAt(p('sum(pi = 1 to 2, asin(x))'), 'x', scope, 0.5) - asinClosed)).toBeLessThan(1e-9)
  })

  it('a bound e: g(x) = e x^2, F(x) = sum(e = 1 to 3, g(x)) = 3 e x^2, so F\'(1) is 6 e', () => {
    const scope = makeScope({
      functions: [
        ['g', { params: ['x'], body: p('e x^2') }],
        ['F', { params: ['x'], body: sum('e', num(1), num(3), p('g(x)')) }],
      ],
    })
    expect(Math.abs(derivativeAt(call('F', x), 'x', scope, 1) - 6 * Math.E)).toBeLessThan(1e-12)
    expect(Math.abs(central(compileScalar(call('F', x), ['x'], scope), 1) - 6 * Math.E)).toBeLessThan(1e-6)
  })

  it('a bound index named like a @param, with f\'(k) in the body: G(x) = sum(k = 1 to 3, f\'(x)) = 30 x', () => {
    const scope = makeScope({
      params: [['k', 5]],
      functions: [
        ['f', { params: ['x'], body: p('k x^2') }],
        ['G', { params: ['x'], body: sum('k', num(1), num(3), prime('f', 1, [x])) }],
      ],
    })
    expect(both(call('G', x), ['x'], [2], scope)).toBe(60)
    expect(derivativeAt(call('G', x), 'x', scope, 2)).toBeCloseTo(30, 12)
    // and with the bound index itself as the argument: sum(k = 1 to 3, f'(k)) = 10 * 6
    expect(both(sum('k', num(1), num(3), prime('f', 1, [k])), [], [], scope)).toBe(60)
    expect(derivativeAt(p('x sum(k = 1 to 3, k)'), 'x', scope, 2)).toBe(6)
  })

  it('a bound name that is not a document name keeps the name it was written with', () => {
    const scope = makeScope({ params: [['a', 1]] })
    const d = diff(sum('j', num(1), num(3), p('j x')), 'x', scope) as Expr & { kind: 'call' }
    expect((d.args[0] as { name: string }).name).toBe('j')
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

  it('a binder is renamed only when a replacement of a name FREE in its body mentions the bound name', () => {
    // zz does not occur in the body, so the k it maps to can capture nothing
    const s = sum('k', num(1), num(3), k)
    expect(substitute(s, new Map<string, Expr>([['zz', k]]))).toEqual(s)
    const i = integral('t', num(0), num(1), p('a t'))
    expect(substitute(i, new Map<string, Expr>([['b', t]]))).toEqual(i)
    // ...but a free name of the body that maps to a k does need it
    const captured = substitute(sum('k', num(1), num(3), p('k x')), new Map<string, Expr>([['x', k]])) as Expr & { kind: 'call' }
    expect((captured.args[0] as { name: string }).name).toMatch(/^#k\./)
  })

  it('d/dt F(t) for F(x) = integral(t = 0 to 1, x t) is 1/2, and prints no internal name', () => {
    // the argument t shares the integral's bound name, but x is the only free name of the body and x -> t is
    // what the chain rule substitutes into a partial that no longer reads x
    const scope = makeScope({ functions: [['F', { params: ['x'], body: integral('t', num(0), num(1), p('x t')) }]] })
    const d = simplify(diff(call('F', t), 't', scope))
    expect(JSON.stringify(d)).not.toContain('#')
    expect(Math.abs(derivativeAt(call('F', t), 't', scope, 3) - 0.5)).toBeLessThan(1e-12)
    // the same for a sum: g(x) = sum(k = 1 to 3, k x) at the argument k
    const g = makeScope({ functions: [['g', { params: ['x'], body: sum('k', num(1), num(3), p('k x')) }]] })
    expect(JSON.stringify(simplify(diff(call('g', k), 'k', g)))).not.toContain('#')
    expect(derivativeAt(call('g', k), 'k', g, 5)).toBe(6)
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
