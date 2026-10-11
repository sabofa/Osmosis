import { describe, expect, it } from 'vitest'
import { parseConditionString, parseExprString } from '../../../parser/parseExpr'
import { add, call, mul, num, variable as v } from '../../../math/expr'
import { and, compare, not, or } from '../../../math/reserved'
import { exprText } from './exprText'
import { sceneOf } from './testing'

describe('exprText', () => {
  it('writes expressions back as authors write them, parentheses only where needed', () => {
    const cases: [string, string][] = [
      ['sqrt(x - 0.5)', 'sqrt(x - 0.5)'],
      ['1 - x - y', '1 - x - y'],
      ['1 - (x - y)', '1 - (x - y)'],
      ['(1 + x)*y', '(1 + x)*y'],
      ['x^2 + y^2', 'x^2 + y^2'],
      ['-sqrt(1 - x^2)', '-sqrt(1 - x^2)'],
      ['a/(b*c)', 'a/(b*c)'],
      ['(x^2)^3', '(x^2)^3'],
      ['atan2(y, x)', 'atan2(y, x)'],
    ]
    for (const [input, text] of cases) expect(exprText(parseExprString(input))).toBe(text)
  })

  it('round-trips: the text parses back to the same tree', () => {
    for (const input of ['1/(x - 0.3)^2', '-x^2', '2*x*y - 3', 'sin(x)^2 + cos(-y)', '1 - x - y - z']) {
      const tree = parseExprString(input)
      expect(parseExprString(exprText(tree))).toEqual(tree)
    }
  })
})

// Calc's constructs (math/reserved.ts), written by name. The expected text of
// each is worked out from the table at the top of exprText.ts.
describe("exprText prints calc's reserved calls the way they read", () => {
  const value = (input: string) => exprText(parseExprString(input))
  const condition = (input: string) => exprText(parseConditionString(input))

  it('comparisons: < ≤ > ≥ = ≠', () => {
    const cases: [string, string][] = [
      ['x < 1', 'x < 1'],
      ['x <= 1', 'x ≤ 1'],
      ['x > 1', 'x > 1'],
      ['x >= 1', 'x ≥ 1'],
      ['x = 1', 'x = 1'],
      ['x != 1', 'x ≠ 1'],
    ]
    for (const [input, text] of cases) expect(condition(input), input).toBe(text)
  })

  it("a comparison's sides are plain arithmetic: no parentheses for a sum or a negative number", () => {
    expect(condition('x + 1 < 2*y')).toBe('x + 1 < 2*y')
    expect(condition('x < -1')).toBe('x < -1')
    expect(condition('-x >= y - 1')).toBe('-x ≥ y - 1')
    expect(condition('x^2 + y^2 <= 4')).toBe('x^2 + y^2 ≤ 4')
  })

  it('a chain 0 < x <= 1 is the conjunction it is built as', () => {
    expect(condition('0 < x <= 1')).toBe('0 < x and x ≤ 1')
  })

  it('and, or and not, with and binding tighter than or and not tighter than and', () => {
    expect(condition('x > 0 and x < 1')).toBe('x > 0 and x < 1')
    expect(condition('x < 0 or x > 1')).toBe('x < 0 or x > 1')
    expect(condition('a < b or c < d and e < f')).toBe('a < b or c < d and e < f')
    expect(condition('not x < 1')).toBe('not x < 1')
    expect(condition('not x < 1 and y > 2')).toBe('not x < 1 and y > 2')
    expect(condition('a < b and c < d or e < f')).toBe('a < b and c < d or e < f')
  })

  it('parentheses where a looser construct sits inside a tighter one, and for a right operand of the same level', () => {
    const a = compare('<', v('a'), v('b'))
    const b = compare('<', v('c'), v('d'))
    const c = compare('=', v('e'), v('f'))
    expect(exprText(and(or(a, b), c))).toBe('(a < b or c < d) and e = f')
    expect(exprText(or(a, and(b, c)))).toBe('a < b or c < d and e = f')
    expect(exprText(and(a, and(b, c)))).toBe('a < b and (c < d and e = f)')
    expect(exprText(and(and(a, b), c))).toBe('a < b and c < d and e = f')
    expect(exprText(or(a, or(b, c)))).toBe('a < b or (c < d or e = f)')
    expect(exprText(not(and(a, b)))).toBe('not (a < b and c < d)')
    expect(exprText(not(or(a, b)))).toBe('not (a < b or c < d)')
    expect(exprText(not(not(a)))).toBe('not not a < b')
    expect(exprText(and(a, not(b)))).toBe('a < b and not c < d')
    expect(exprText(or(not(a), c))).toBe('not a < b or e = f')
    // a comparison, and, or and not are parenthesised on the side of a comparison or inside arithmetic
    expect(exprText(compare('=', a, c))).toBe('(a < b) = (e = f)')
    expect(exprText(add(num(1), a))).toBe('1 + (a < b)')
    expect(exprText(mul(or(a, b), v('x')))).toBe('(a < b or c < d)*x')
  })

  it('piecewise: {c1: v1, …, otherwise}, with or without the otherwise', () => {
    expect(value('{x < 0: -x, x < 1: x^2, 5}')).toBe('{x < 0: -x, x < 1: x^2, 5}')
    expect(value('{x < 0: 1}')).toBe('{x < 0: 1}')
    expect(value('{x < 0: 1, 2}')).toBe('{x < 0: 1, 2}')
    expect(value('{x > 0 and x < 1: x, 0}')).toBe('{x > 0 and x < 1: x, 0}')
    expect(value('{x <= 0: a + b, c - d}')).toBe('{x ≤ 0: a + b, c - d}')
    // a brace is an atom: no parentheses inside arithmetic, a power or a factorial
    expect(value('2*{x < 0: 1, 2} + 1')).toBe('2*{x < 0: 1, 2} + 1')
    expect(value('{x < 0: 1, 2}^2')).toBe('{x < 0: 1, 2}^2')
  })

  it('factorial: a!, parenthesising anything that is not an atom', () => {
    const cases: [string, string][] = [
      ['x!', 'x!'],
      ['3!', '3!'],
      ['f(x)!', 'f(x)!'],
      ['|x|!', '|x|!'],
      ['(x + 1)!', '(x + 1)!'],
      ['(x*y)!', '(x*y)!'],
      ['(x^2)!', '(x^2)!'],
      ['(-x)!', '(-x)!'],
      ['(-2)!', '(-2)!'],
      // the parser reads "x!!" as a factorial of a factorial, which "x!!" would not say
      ['x!!', '(x!)!'],
      // "!" binds tighter than ^ and unary minus: these need nothing
      ['x!^2', 'x!^2'],
      ['2^x!', '2^x!'],
      ['-x!', '-x!'],
      ['x!*y!', 'x!*y!'],
      ['1 - n!', '1 - n!'],
    ]
    for (const [input, text] of cases) expect(value(input), input).toBe(text)
  })

  it('a factorial of a binder is parenthesised', () => {
    expect(value('sum(k = 1 to 3, k)!')).toBe('(Σ_{k=1}^{3} k)!')
  })

  it("primes: f'(a), f''(a), with k primes, and several arguments", () => {
    expect(value("f'(x)")).toBe("f'(x)")
    expect(value("f''(2)")).toBe("f''(2)")
    expect(value("f'''(x + 1)")).toBe("f'''(x + 1)")
    expect(value("g'(x, y)")).toBe("g'(x, y)")
    expect(value("2*f'(x) - f(x)")).toBe("2*f'(x) - f(x)")
    expect(value("f'(x)^2")).toBe("f'(x)^2")
    expect(value("f'(x)!")).toBe("f'(x)!")
  })

  it('sum, prod and integral: Σ_{k=lo}^{hi} body, Π_{k=lo}^{hi} body, ∫_{lo}^{hi} body dt', () => {
    expect(value('sum(k = 1 to 10, k^2)')).toBe('Σ_{k=1}^{10} k^2')
    expect(value('prod(k = 1 to n, k)')).toBe('Π_{k=1}^{n} k')
    expect(value('integral(t = 0 to 1, t^2)')).toBe('∫_{0}^{1} t^2 dt')
    expect(value('integral(t = 0 to x, sin(t))')).toBe('∫_{0}^{x} sin(t) dt')
    expect(value('sum(k = -1 to n + 1, k)')).toBe('Σ_{k=-1}^{n + 1} k')
  })

  it("a sum's body is parenthesised when it is a sum or difference, and not when it is a product, quotient or power", () => {
    expect(value('sum(k = 1 to n, k + 1)')).toBe('Σ_{k=1}^{n} (k + 1)')
    expect(value('sum(k = 1 to n, k - 1)')).toBe('Σ_{k=1}^{n} (k - 1)')
    expect(value('sum(k = 1 to n, k*x)')).toBe('Σ_{k=1}^{n} k*x')
    expect(value('sum(k = 1 to n, 1/k)')).toBe('Σ_{k=1}^{n} 1/k')
    expect(value('prod(k = 1 to n, 2^k)')).toBe('Π_{k=1}^{n} 2^k')
    expect(value('sum(k = 1 to n, -k)')).toBe('Σ_{k=1}^{n} (-k)')
    // dt ends an integral's body, so nothing in it needs parentheses
    expect(value('integral(t = 0 to 1, t + 1)')).toBe('∫_{0}^{1} t + 1 dt')
  })

  it('a binder is parenthesised inside anything, so nothing reads into its body', () => {
    expect(value('2*sum(k = 1 to 3, k)')).toBe('2*(Σ_{k=1}^{3} k)')
    expect(value('sum(k = 1 to 3, k) + 1')).toBe('(Σ_{k=1}^{3} k) + 1')
    expect(value('1 - integral(t = 0 to 1, t)')).toBe('1 - (∫_{0}^{1} t dt)')
    expect(value('prod(k = 1 to 3, k)^2')).toBe('(Π_{k=1}^{3} k)^2')
    expect(value('-sum(k = 1 to 3, k)')).toBe('-(Σ_{k=1}^{3} k)')
    expect(value('sum(j = 1 to 2, sum(k = 1 to j, j*k))')).toBe('Σ_{j=1}^{2} (Σ_{k=1}^{j} j*k)')
    expect(value('sqrt(sum(k = 1 to 3, k))')).toBe('sqrt(Σ_{k=1}^{3} k)')
    expect(value('{x < 0: sum(k = 1 to 2, k), 0}')).toBe('{x < 0: Σ_{k=1}^{2} k, 0}')
  })

  it('abs is |x|, and an atom: nothing around it, bars nest', () => {
    const cases: [string, string][] = [
      ['abs(x)', '|x|'],
      ['|x|', '|x|'],
      ['|x - 1|', '|x - 1|'],
      ['||x| - 1|', '||x| - 1|'],
      ['|1 - |x||', '|1 - |x||'],
      ['2*|x|', '2*|x|'],
      ['|x|^2', '|x|^2'],
      ['-|x|', '-|x|'],
      ['|x|*|y|', '|x|*|y|'],
      ['|x| + |y|', '|x| + |y|'],
      ['sqrt(|x|)', 'sqrt(|x|)'],
    ]
    for (const [input, text] of cases) expect(value(input), input).toBe(text)
  })

  it('a reserved name with a shape it was never built with is written as the call it is', () => {
    expect(exprText(call('__lt', v('a')))).toBe('__lt(a)')
    expect(exprText(call('__and', v('a'), v('b'), v('c')))).toBe('__and(a, b, c)')
    expect(exprText(call('__not', v('a'), v('b')))).toBe('__not(a, b)')
    expect(exprText(call('__factorial'))).toBe('__factorial()')
    expect(exprText(call('__piecewise', v('a')))).toBe('__piecewise(a)')
    expect(exprText(call('__prime', v('f'), num(0), v('x')))).toBe('__prime(f, 0, x)')
    expect(exprText(call('__prime', v('f'), num(1)))).toBe('__prime(f, 1)')
    expect(exprText(call('__prime', num(1), num(1), v('x')))).toBe('__prime(1, 1, x)')
    expect(exprText(call('__sum', v('k'), num(1), num(3)))).toBe('__sum(k, 1, 3)')
    expect(exprText(call('__sum', num(1), num(1), num(3), v('k')))).toBe('__sum(1, 1, 3, k)')
    expect(exprText(call('__integral', v('t'), num(0)))).toBe('__integral(t, 0)')
    expect(exprText(call('abs', v('x'), v('y')))).toBe('abs(x, y)')
  })

  it('a refusal that names a bound reads it in the new syntax (the bound of volumes and regions)', () => {
    const refusal = (spec: string) => sceneOf(spec).errors.filter((e) => e.line === 1).map((e) => e.message)
    // x < 0.5 makes sqrt(x - 1) not a number, with the first sample at x = 0.00…
    expect(refusal('volume: x in [0, 1], y in [0, 1], z in [0, {x < 0.5: sqrt(x - 1), 1}]')).toEqual([
      expect.stringMatching(/^the bound \{x < 0\.5: sqrt\(x - 1\), 1\} is not a number at \(x, y\) = \(0\.00\d+, [0-9.]+\)$/),
    ])
    expect(refusal('volume: x in [0, 1], y in [0, 1], z in [0, sqrt(|x| - 2)]')).toEqual([expect.stringMatching(/^the bound sqrt\(\|x\| - 2\) is not a number at /)])
    expect(refusal('volume: x in [0, 1], y in [0, 1], z in [0, sqrt(sum(k = 1 to 2, k) - 5)]')).toEqual([
      expect.stringMatching(/^the bound sqrt\(\(Σ_\{k=1\}\^\{2\} k\) - 5\) is not a number at /),
    ])
  })

  it('what is input syntax round-trips: the text parses back to the same tree', () => {
    for (const input of ['x!', '(x + 1)!', 'x!^2', '-x!', 'x!!', '|x - 1|', '||x| - 1|', '1 - |x|', "f'(x)", "f''(x + 1)", '{x < 0: -x, x^2}', '2*{x < 1: x, 1}', '(-x)!']) {
      const tree = parseExprString(input)
      expect(parseExprString(exprText(tree)), input).toEqual(tree)
    }
    for (const input of ['x > 0 and x < 1', 'x < 0 or x > 1 and y < 2', 'not x < 1 and y > 2', 'a < b or c < d and e = f', 'x + 1 < 2*y']) {
      const tree = parseConditionString(input)
      expect(parseConditionString(exprText(tree)), input).toEqual(tree)
    }
  })
})
