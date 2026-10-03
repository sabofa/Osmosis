import { describe, expect, it } from 'vitest'
import { BUILTIN_NAMES } from '../../math/compile'
import { add, call, div, mul, num, sub, variable } from '../../math/expr'
import type { Expr } from '../../parser/types'
import { expr, scopeOf } from './testkit'
import { SMOOTH_BUILTINS, TROUBLE_BUILTINS, troubleGenerators } from './structure'

const x = variable('x')
const sinK = (u: Expr, k = Math.PI) => call('sin', mul(num(k), u))
const cosK = (u: Expr, k = Math.PI) => call('cos', mul(num(k), u))

// What a call of the walk gives, as [origin, why, expr] rows in the order found.
function rows(text: string, defs = '', angle: 'radians' | 'degrees' = 'radians') {
  return troubleGenerators(expr(text), 'x', scopeOf(defs, angle)).map((g) => [g.origin, g.why, g.expr])
}

describe('troubleGenerators', () => {
  it('classifies every built-in as troubled or smooth, never both', () => {
    for (const name of BUILTIN_NAMES) expect(TROUBLE_BUILTINS.has(name) !== SMOOTH_BUILTINS.has(name), name).toBe(true)
  })
  it('names a denominator, a log domain and a condition seam', () => {
    const whys = troubleGenerators(expr('{x < 1: ln(x), 1/(x - 2)}'), 'x', scopeOf()).map((g) => `${g.origin}:${g.why}`)
    expect(whys).toEqual(expect.arrayContaining(['seam:condition', 'natural:ln domain', 'natural:denominator']))
  })
  it('drops generators that do not depend on the parameter', () => {
    expect(troubleGenerators(expr('x / a'), 'x', scopeOf('@param a = 2 range [0, 5]'))).toEqual([])
  })
  it('sees through a user function and a derivative', () => {
    expect(troubleGenerators(expr('f(x)'), 'x', scopeOf('f(x) = 1/(x - 3)')).length).toBeGreaterThan(0)
    expect(troubleGenerators(expr("f'(x)"), 'x', scopeOf('f(x) = 1/x')).length).toBeGreaterThan(0)
  })
  it('walks a binder body, unrolling the bound name over constant whole bounds', () => {
    // The brief's first version of this test expected [] (a body was never walked); the
    // poles of sum(k = 1 to 5, 1/(x - k)) are at 1 to 5, so now each term gives its own.
    const gens = troubleGenerators(expr('sum(k = 1 to 5, 1/(x - k))'), 'x', scopeOf())
    expect(gens.map((g) => g.expr)).toEqual([1, 2, 3, 4, 5].map((n) => sub(x, num(n))))
  })
  it('leaves x^2 and x^3 alone but not x^-1 or x^(1/2)', () => {
    expect(troubleGenerators(expr('x^2 + x^3'), 'x', scopeOf())).toEqual([])
    expect(troubleGenerators(expr('x^(-1)'), 'x', scopeOf())).toHaveLength(1)
    expect(troubleGenerators(expr('x^(1/2)'), 'x', scopeOf())).toHaveLength(1)
  })
})

describe('the built-in lists', () => {
  it('hold only built-ins that exist', () => {
    for (const name of [...TROUBLE_BUILTINS, ...SMOOTH_BUILTINS]) expect(BUILTIN_NAMES.has(name), name).toBe(true)
  })
  it('keep the troubled four with no rule of their own on the list', () => {
    expect([...TROUBLE_BUILTINS].sort()).toEqual(
      'acos acosh asin atan2 atanh ceil choose cot csc floor gamma gcd lcm ln log mod perm root round sec sign sqrt step tan'.split(' ').sort()
    )
    for (const name of 'choose perm gcd lcm'.split(' ')) expect(rows(`${name}(x, 2)`), name).toEqual([])
  })
  it('give a smooth built-in no generators of its own, only its arguments', () => {
    for (const name of SMOOTH_BUILTINS) {
      const text = ['min', 'max', 'hypot'].includes(name) ? `${name}(x, 1)` : `${name}(x)`
      expect(rows(text), name).toEqual([])
    }
    expect(rows('sin(1/(x - 1))')).toEqual([['natural', 'denominator', sub(x, num(1))]])
  })
})

// Every row of the rules table (structure.ts), one by one.
describe('the generator rules', () => {
  it('a / b gives b', () => expect(rows('1/(x + 2)')).toEqual([['natural', 'denominator', add(x, num(2))]]))
  it('b ^ e gives b unless e is a positive whole literal', () => {
    expect(rows('x^(-2)')).toEqual([['natural', 'power base', x]])
    expect(rows('x^0.5')).toEqual([['natural', 'power base', x]])
    expect(rows('x^x')).toEqual([['natural', 'power base', x]])
    expect(rows('x^4')).toEqual([])
    expect(rows('2^x')).toEqual([])
  })
  it('sqrt, ln and log (one argument) give u', () => {
    expect(rows('sqrt(x)')).toEqual([['natural', 'sqrt domain', x]])
    expect(rows('ln(x)')).toEqual([['natural', 'ln domain', x]])
    expect(rows('log(x)')).toEqual([['natural', 'log domain', x]])
  })
  it('log(a, b) gives a, b and b - 1', () => {
    expect(rows('log(x, 2)')).toEqual([['natural', 'log domain', x]])
    expect(rows('log(2, x)')).toEqual([
      ['natural', 'log base', x],
      ['natural', 'log base', sub(x, num(1))],
    ])
    expect(rows('log(x, x + 3)')).toEqual([
      ['natural', 'log domain', x],
      ['natural', 'log base', add(x, num(3))],
      ['natural', 'log base', sub(add(x, num(3)), num(1))],
    ])
  })
  it('root(n, u) gives u, not the index', () => {
    expect(rows('root(3, x)')).toEqual([['natural', 'root domain', x]])
    expect(rows('root(x, 8)')).toEqual([])
  })
  it('asin, acos and atanh give u - 1 and u + 1; acosh gives u - 1', () => {
    for (const name of ['asin', 'acos', 'atanh']) {
      expect(rows(`${name}(x)`), name).toEqual([
        ['natural', `${name} edge`, sub(x, num(1))],
        ['natural', `${name} edge`, add(x, num(1))],
      ])
    }
    expect(rows('acosh(x)')).toEqual([['natural', 'acosh edge', sub(x, num(1))]])
  })
  it('tan and sec give cos(u); csc and cot give sin(u)', () => {
    expect(rows('tan(x)')).toEqual([['natural', 'tan pole', call('cos', x)]])
    expect(rows('sec(x)')).toEqual([['natural', 'sec pole', call('cos', x)]])
    expect(rows('csc(x)')).toEqual([['natural', 'csc pole', call('sin', x)]])
    expect(rows('cot(x)')).toEqual([['natural', 'cot pole', call('sin', x)]])
  })
  it('gamma and factorial give sin(k u) and sin(k (u + 1)), k the angle unit', () => {
    expect(rows('gamma(x)')).toEqual([['natural', 'gamma pole', sinK(x)]])
    expect(rows('x!')).toEqual([['natural', 'factorial pole', sinK(add(x, num(1)))]])
    expect(rows('gamma(x)', '', 'degrees')).toEqual([['natural', 'gamma pole', sinK(x, 180)]])
    expect(rows('x!', '', 'degrees')).toEqual([['natural', 'factorial pole', sinK(add(x, num(1)), 180)]])
  })
  it('floor and ceil give sin(k u); round gives cos(k u)', () => {
    expect(rows('floor(x)')).toEqual([['natural', 'floor step', sinK(x)]])
    expect(rows('ceil(x)')).toEqual([['natural', 'ceil step', sinK(x)]])
    expect(rows('round(x)')).toEqual([['natural', 'round step', cosK(x)]])
    expect(rows('floor(x)', '', 'degrees')).toEqual([['natural', 'floor step', sinK(x, 180)]])
    expect(rows('round(x)', '', 'degrees')).toEqual([['natural', 'round step', cosK(x, 180)]])
  })
  it('sign and step give u', () => {
    expect(rows('sign(x)')).toEqual([['natural', 'sign step', x]])
    expect(rows('step(x)')).toEqual([['natural', 'step edge', x]])
  })
  it('mod(a, b) gives b and sin(k a / b)', () => {
    expect(rows('mod(x, 3)')).toEqual([['natural', 'mod step', sinK(div(x, num(3)))]])
    expect(rows('mod(5, x)')).toEqual([
      ['natural', 'mod divisor', x],
      ['natural', 'mod step', sinK(div(num(5), x))],
    ])
  })
  it('atan2(y, x) gives y and x', () => {
    expect(rows('atan2(x, x + 1)')).toEqual([
      ['natural', 'atan2 cut', x],
      ['natural', 'atan2 axis', add(x, num(1))],
    ])
  })
  it('the six comparisons give a - b, as seams', () => {
    const ops = { __lt: '<', __le: '<=', __gt: '>', __ge: '>=', __eq: '=', __ne: '!=' }
    for (const [name, cmp] of Object.entries(ops)) {
      // each lists which comparison it is the difference of (curve.ts reads the side that holds, and whether the zero is in it)
      expect(troubleGenerators(call(name, x, num(1)), 'x', scopeOf()), name).toEqual([{ expr: sub(x, num(1)), origin: 'seam', why: 'condition', cmps: [cmp] }])
    }
  })
  it('lists every operator of the comparisons that made a generator, each once', () => {
    const cmps = (text: string) => troubleGenerators(expr(text), 'x', scopeOf()).map((g) => g.cmps)
    // the same comparison twice is listed once
    expect(cmps('{x < 1: 1, x < 1: 2, 3}')).toEqual([['<']])
    // < with <= and < with >= of one expression: all of them, for curve.ts to say whether they agree
    expect(cmps('{x < 1: 1, x <= 1: 2, 3}')).toEqual([['<', '<=']])
    expect(cmps('{x^2 < 2: 0, x^2 >= 2: 1}')).toEqual([['<', '>=']])
    // a natural spot that shares the expression adds nothing and takes nothing away
    expect(cmps('{x < 1: 1/(x - 1), 3}')).toEqual([['<']])
    expect(cmps('1/(x - 1) + {x < 1: 1, 3}')).toEqual([['<']])
    expect(cmps('1/(x - 1)')).toEqual([undefined])
    // a chain is two comparisons of two expressions, one each
    expect(cmps('{0 < x <= 3: 1}')).toEqual([['<'], ['<=']])
    // and the walk through a sum's unrolled terms keeps it
    expect(cmps('sum(k = 1 to 2, {x < k: 1, 0})')).toEqual([['<'], ['<']])
  })
  it('and, or, not and piecewise give nothing of their own, and walk every argument', () => {
    const lt = call('__lt', x, num(0))
    const gt = call('__gt', x, num(2))
    expect(troubleGenerators(call('__and', lt, gt), 'x', scopeOf()).map((g) => g.expr)).toEqual([sub(x, num(0)), sub(x, num(2))])
    expect(troubleGenerators(call('__or', lt, gt), 'x', scopeOf())).toHaveLength(2)
    expect(troubleGenerators(call('__not', lt), 'x', scopeOf())).toHaveLength(1)
    expect(rows('{x < 1: 1/(x - 5), x > 3: 1/(x - 7), 0}').map((r) => r[1])).toEqual(['condition', 'denominator', 'condition', 'denominator'])
  })
  it('a binder gives its bounds, and a body generator that does not read the bound name', () => {
    expect(rows('sum(k = 1 to 1/(x - 1), 1/(x - k))')).toEqual([['natural', 'denominator', sub(x, num(1))]])
    expect(rows('prod(k = 1/(x - 2) to 4, 1/(x - k))')).toEqual([['natural', 'denominator', sub(x, num(2))]])
    expect(rows('integral(t = 0 to 1/(x - 3), 1/t)')).toEqual([['natural', 'denominator', sub(x, num(3))]])
    expect(rows('sum(k = 1 to 5, k/x)')).toEqual([['natural', 'denominator', x]])
    expect(rows('sum(k = 1 to 3, 1/x)')).toEqual([['natural', 'denominator', x]])
    expect(rows('integral(t = 0 to 1, 1/x)')).toEqual([['natural', 'denominator', x]])
  })
  it('a derivative walks the expanded body at its argument', () => {
    const gens = troubleGenerators(expr("f'(x - 4)"), 'x', scopeOf('f(x) = 1/x'))
    expect(gens.length).toBeGreaterThan(0)
    for (const g of gens) expect(JSON.stringify(g.expr)).toContain(JSON.stringify(sub(x, num(4))))
  })
  it('a user function is inlined with its arguments substituted', () => {
    expect(rows('f(2x)', 'f(u) = 1/(u - 3)')).toEqual([['natural', 'denominator', sub(mul(num(2), x), num(3))]])
    expect(rows('g(x, 1)', 'g(u, v) = ln(u - v)')).toEqual([['natural', 'ln domain', sub(x, num(1))]])
  })
  it('does not inline a vector-bodied function, but still walks its arguments', () => {
    expect(rows('r(1/(x - 1))', 'r(t) = <1/t, t, 0>')).toEqual([['natural', 'denominator', sub(x, num(1))]])
  })
  it('stops at a function that calls itself', () => {
    const r = rows('f(x)', 'f(u) = 1/u + f(u)')
    expect(r).toEqual([['natural', 'denominator', x]])
  })
  it('ends on a function that calls itself twice, which the compile refuses but a caller may walk first', () => {
    // Two branches a level over 32 levels would be 2^32 walks without the cap on expansions.
    const gens = troubleGenerators(expr('fib(x)'), 'x', scopeOf('fib(n) = 1/n + fib(n - 1) + fib(n - 2)'))
    expect(gens.length).toBeGreaterThan(0)
    expect(gens[0].expr).toEqual(x)
  })
  it('inlines a function called inside its own argument (f(f(x))) all the way', () => {
    const gens = troubleGenerators(expr('f(f(x))'), 'x', scopeOf('f(u) = 1/(u - 1)'))
    // The outer call's denominator is f(x) - 1 (a call the compile resolves itself),
    // and the walk then reaches the inner f(x).
    expect(gens.map((g) => g.expr)).toEqual([sub(call('f', x), num(1)), sub(x, num(1))])
  })
  it('keeps value names as names (a parameter stays a var node)', () => {
    expect(rows('1/(x - a)', '@param a = 2 range [0, 5]')).toEqual([['natural', 'denominator', sub(x, variable('a'))]])
  })
})

describe('binder bodies', () => {
  const denominators = (...ns: number[]) => ns.map((n) => ['natural', 'denominator', sub(x, num(n))])
  it('unrolls a sum or a product, one generator per term in order', () => {
    expect(rows('sum(k = 1 to 3, 1/(x - k))')).toEqual(denominators(1, 2, 3))
    expect(rows('prod(k = 2 to 4, 1/(x - k))')).toEqual(denominators(2, 3, 4))
    expect(rows('sum(k = -2 to -1, 1/(x - k))')).toEqual(denominators(-2, -1))
  })
  it('takes bounds that are constants of the document, and bounds computed from numbers', () => {
    expect(rows('sum(k = 1 to n, 1/(x - k))', 'n = 3')).toEqual(denominators(1, 2, 3))
    expect(rows('sum(k = 1 to 2 + 1, 1/(x - k))')).toEqual(denominators(1, 2, 3))
  })
  it('unrolls through a user function called in the body', () => {
    expect(rows('sum(k = 1 to 2, f(x, k))', 'f(a, b) = 1/(a - b)')).toEqual(denominators(1, 2))
  })
  it('unrolls nested binders into every pair of terms', () => {
    expect(troubleGenerators(expr('sum(i = 1 to 2, sum(j = 1 to 3, 1/(x - i - j)))'), 'x', scopeOf())).toHaveLength(6)
  })
  it('drops what reads the bound name when the bounds are not constants', () => {
    expect(rows('sum(k = 1 to x, 1/(x - k))')).toEqual([])
    expect(rows('sum(k = 1 to n, 1/(x - k))', '@param n = 3 range [1, 5]')).toEqual([])
  })
  it('drops what reads the bound name when a bound is not whole, or the span is over 64 terms', () => {
    expect(rows('sum(k = 1 to 2.5, 1/(x - k))')).toEqual([])
    expect(rows('sum(k = 1 to 65, 1/(x - k))')).toEqual([])
    expect(rows('sum(k = 1 to 64, 1/(x - k))')).toHaveLength(64)
  })
  it('gives nothing for an empty range', () => {
    expect(rows('sum(k = 5 to 1, 1/(x - k))')).toEqual([])
  })
  it('drops what reads the bound name when a bound is not a safe integer (and ends)', () => {
    // 1e20 is whole to Number.isInteger, and n++ would never change it.
    expect(rows('sum(k = 1e20 to 1e20, 1/(x - k))')).toEqual([])
    expect(rows('sum(k = 1 to 1/0, 1/(x - k))')).toEqual([])
    expect(rows('sum(k = 9007199254740993 to 9007199254740994, 1/(x - k))')).toEqual([])
  })
  it('drops what reads the bound name when a bound cannot be computed, and does not throw', () => {
    // gamma takes one argument: the curve's own compile reports that.
    expect(rows('sum(k = 1 to gamma(1, 2), 1/(x - k))')).toEqual([])
  })
  it('never unrolls an integral: a body generator that reads the variable of integration is dropped', () => {
    expect(rows('integral(t = 0 to x, 1/(t - 2))')).toEqual([])
    expect(rows('integral(t = 0 to 5, 1/(x - t))')).toEqual([])
  })
  it('leaves the body alone when the bound name is the plot variable', () => {
    expect(rows('sum(x = 1 to 3, 1/(x - 2))')).toEqual([])
  })
  it('keeps the bound name of an inner binder from reaching an outer one', () => {
    // The inner k shadows the outer one: only the inner range is unrolled.
    expect(troubleGenerators(expr('sum(k = 1 to 5, sum(k = 1 to 2, 1/(x - k)))'), 'x', scopeOf()).map((g) => g.expr)).toEqual([sub(x, num(1)), sub(x, num(2))])
  })
  it('does not take a body generator for a document constant that the bound name shadows', () => {
    // k is a constant of the document and also the bound name: inside the sum it is the bound one.
    expect(rows('sum(k = 1 to 2, 1/(x - k))', 'k = 7')).toEqual(denominators(1, 2))
  })
})

describe('a derivative past the expansion limit', () => {
  it('is walked by its arguments alone', () => {
    // g0 calls g1 ... g31 calls h'(1/(u - 1)): 32 functions deep, the derivative is past the limit.
    const defs = ['h(t) = t']
    for (let i = 0; i < 31; i++) defs.push(`g${i}(u) = g${i + 1}(u)`)
    defs.push("g31(u) = h'(1/(u - 1))")
    expect(rows('g0(x)', defs.join('\n'))).toEqual([['natural', 'denominator', sub(x, num(1))]])
  })
})

describe('deduplication', () => {
  it('keeps one of two generators that are the same expression', () => {
    expect(troubleGenerators(expr('1/(x - 1) + 1/(x - 1)'), 'x', scopeOf())).toHaveLength(1)
  })
  it('lets a seam win over a natural one, taking its reason', () => {
    const gens = troubleGenerators(expr('{x < 1: 1/(x - 1), 0}'), 'x', scopeOf())
    // (and keeping the comparison it is the seam of: the natural spot adds none and takes none)
    expect(gens).toEqual([{ expr: sub(x, num(1)), origin: 'seam', why: 'condition', cmps: ['<'] }])
    const reversed = troubleGenerators(expr('1/(x - 1) + {x < 1: 1, 0}'), 'x', scopeOf())
    expect(reversed).toEqual([{ expr: sub(x, num(1)), origin: 'seam', why: 'condition', cmps: ['<'] }])
  })
})
