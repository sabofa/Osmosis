import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { CompileError, compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { makeScope, type MathFunction } from './scope'
import { simplify } from './simplify'
import { choose, erf, erfc, factorial, gamma, gcd, lcm, perm, root, step } from './special'

const SQRT_PI = Math.sqrt(Math.PI)
const scope = makeScope()

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
}

function fn(params: string[], body: string): MathFunction {
  return { params, body: p(body) }
}

describe('gamma', () => {
  it('is (n - 1)! exactly at positive integers', () => {
    expect(gamma(1)).toBe(1)
    expect(gamma(5)).toBe(24)
    expect(gamma(11)).toBe(3628800)
  })

  it('half-integers to 1e-14', () => {
    expect(rel(gamma(0.5), SQRT_PI)).toBeLessThan(1e-14)
    expect(rel(gamma(1.5), SQRT_PI / 2)).toBeLessThan(1e-14)
    expect(rel(gamma(-0.5), -2 * SQRT_PI)).toBeLessThan(1e-14)
  })

  it('has poles at 0 and the negative integers, and overflows past 171', () => {
    expect(gamma(0)).toBeNaN()
    expect(gamma(-1)).toBeNaN()
    expect(gamma(-7)).toBeNaN()
    expect(Number.isFinite(gamma(171))).toBe(true)
    expect(gamma(172)).toBe(Infinity)
    expect(Number.isFinite(gamma(170.5))).toBe(true)
  })

  it('overflows to Infinity, never NaN, however far past 171 a non-integer goes', () => {
    expect(gamma(171.7)).toBe(Infinity)
    expect(gamma(739.5)).toBe(Infinity)
    expect(gamma(1000.5)).toBe(Infinity)
    expect(1 / gamma(1000.5)).toBe(0)
  })

  it('underflows through the reflection to a signed zero, never NaN', () => {
    // Γ alternates in sign between poles: negative on (-1001, -1000), positive on (-1002, -1001).
    expect(Object.is(gamma(-1000.5), -0)).toBe(true)
    expect(Object.is(gamma(-1001.5), 0)).toBe(true)
  })

  it('factorial is gamma(x + 1)', () => {
    expect(factorial(5)).toBe(120)
    expect(factorial(0)).toBe(1)
    expect(rel(factorial(0.5), SQRT_PI / 2)).toBeLessThan(1e-14)
    expect(factorial(-1)).toBeNaN()
  })
})

describe('erf and erfc', () => {
  it.each([
    [0.5, 0.5204998778130465],
    [1, 0.8427007929497149],
    [2, 0.9953222650189527],
    [3, 0.9999779095030014],
  ])('erf(%s)', (x, want) => {
    expect(rel(erf(x), want)).toBeLessThan(1e-14)
    expect(rel(erf(-x), -want)).toBeLessThan(1e-14)
  })

  it('erf(0) is 0, erfc(0) is 1', () => {
    expect(erf(0)).toBe(0)
    expect(erfc(0)).toBe(1)
  })

  it('erfc keeps relative precision in the tail', () => {
    expect(rel(erfc(3), 2.209049699858544e-5)).toBeLessThan(1e-12)
    expect(rel(erfc(5), 1.5374597944280349e-12)).toBeLessThan(1e-12)
    expect(rel(erfc(-1), 1.842700792949715)).toBeLessThan(1e-14)
  })

  it('reach their limits at infinity', () => {
    expect(erf(Infinity)).toBe(1)
    expect(erf(-Infinity)).toBe(-1)
    expect(erfc(Infinity)).toBe(0)
    expect(erfc(-Infinity)).toBe(2)
    expect(erf(Number.NaN)).toBeNaN()
    expect(erfc(Number.NaN)).toBeNaN()
  })
})

describe('combinatorics, integers and roots', () => {
  it('choose and perm are exact on integers and 0 outside the range', () => {
    expect(choose(5, 2)).toBe(10)
    expect(choose(50, 25)).toBe(126410606437752)
    expect(choose(5, 7)).toBe(0)
    expect(choose(5, -1)).toBe(0)
    expect(perm(5, 2)).toBe(20)
    expect(perm(5, 0)).toBe(1)
    expect(perm(5, 6)).toBe(0)
  })

  it('choose is exact whenever its result is below 2^53, even where the running product is not', () => {
    // r * (n - m + i) passes 2^53 here before the division brings it back.
    expect(choose(55, 26)).toBe(3560597348629860)
    // Pascal's triangle by addition is exact while its entries are below 2^53.
    let row = [1]
    let checked = 0
    for (let n = 1; n <= 60; n++) {
      const next = [1]
      for (let k = 1; k < n; k++) next.push(row[k - 1] + row[k])
      next.push(1)
      row = next
      row.forEach((value, k) => {
        if (value >= 2 ** 53) return
        checked++
        expect(choose(n, k), `choose(${n}, ${k})`).toBe(value)
      })
    }
    expect(checked).toBeGreaterThan(1500)
  })

  it('choose and perm answer Infinity when they overflow, however large n is', () => {
    // A loop over every step up to n would not finish (vitest cannot interrupt
    // synchronous code, so a regression here hangs); the answer is known at the
    // first overflow.
    expect(choose(1e15, 5e14)).toBe(Infinity)
    expect(perm(1e15, 5e14)).toBe(Infinity)
  })

  it('perm is right for n at and beyond 2^53', () => {
    expect(perm(2 ** 53, 0)).toBe(1)
    expect(perm(2 ** 53, 1)).toBe(2 ** 53)
    expect(perm(1e20, 0)).toBe(1)
    expect(perm(1e20, 1)).toBe(1e20)
  })

  it('choose of non-integers goes through gamma', () => {
    // C(0.5, 1) = Γ(1.5) / (Γ(2) Γ(0.5)) = 0.5
    expect(rel(choose(0.5, 1), 0.5)).toBeLessThan(1e-14)
  })

  it('gcd and lcm take integers only', () => {
    expect(gcd(12, 18)).toBe(6)
    expect(gcd(-12, 18)).toBe(6)
    expect(gcd(0, 0)).toBe(0)
    expect(lcm(4, 6)).toBe(12)
    expect(lcm(4, 0)).toBe(0)
    expect(gcd(1.5, 3)).toBeNaN()
  })

  it('root(n, x): odd n is real below zero, even n is not', () => {
    expect(root(3, -27)).toBe(-3)
    expect(root(2, 9)).toBe(3)
    expect(root(2, -9)).toBeNaN()
    expect(rel(root(5, -32), -2)).toBeLessThan(1e-15)
    expect(rel(root(-2, 4), 0.5)).toBeLessThan(1e-15)
    expect(root(0, 4)).toBeNaN()
    expect(root(2.5, 4)).toBeNaN()
  })

  it('step is Heaviside with step(0) = 1', () => {
    expect(step(-1e-300)).toBe(0)
    expect(step(0)).toBe(1)
    expect(step(2)).toBe(1)
    expect(step(Number.NaN)).toBeNaN()
  })
})

describe('the new built-ins compile on both paths', () => {
  const one = new Float64Array(1)
  it.each(['gamma(x)', 'erf(x)', 'erfc(x)', 'cbrt(x)', 'step(x)', 'choose(x, 2)', 'perm(x, 2)', 'gcd(x, 4)', 'lcm(x, 4)', 'root(3, x)'])('%s', (text) => {
    for (const x of [-2.5, -1, 0, 0.5, 3, 6]) {
      const closure = compileScalar(p(text), ['x'], scope)(x)
      expect(Object.is(compileMany([p(text)], ['x'], scope)(one, x)[0], closure), `${text} at ${x}`).toBe(true)
    }
  })
})

describe('derivatives of the new built-ins', () => {
  const at = (text: string, x: number) => compileScalar(simplify(diff(p(text), 'x', scope)), ['x'], scope)(x)

  it('cbrt and root: 1/12 at -8 and at 8', () => {
    expect(at('cbrt(x)', -8)).toBeCloseTo(1 / 12, 14)
    expect(at('cbrt(x)', 8)).toBeCloseTo(1 / 12, 14)
    expect(at('root(3, x)', -8)).toBeCloseTo(1 / 12, 14)
  })

  it('erf is 2/sqrt(pi) at 0; erfc is its negative', () => {
    expect(at('erf(x)', 0)).toBeCloseTo(2 / SQRT_PI, 15)
    expect(at('erfc(x)', 0)).toBeCloseTo(-2 / SQRT_PI, 15)
  })

  it('step is 0 where it has a derivative and NaN at 0', () => {
    expect(at('step(x)', 1)).toBe(0)
    expect(at('step(x)', 0)).toBeNaN()
  })

  it('gamma, choose, perm, gcd and lcm refuse, naming why', () => {
    for (const text of ['gamma(x)', 'choose(x, 2)', 'perm(x, 2)', 'gcd(x, 2)', 'lcm(x, 2)']) {
      expect(() => diff(p(text), 'x', scope), text).toThrow(CompileError)
    }
    expect(() => diff(p('gamma(x)'), 'x', scope)).toThrow(/digamma/)
  })

  it('root refuses an index that depends on the variable', () => {
    expect(() => diff(p('root(x, 8)'), 'x', scope)).toThrow(CompileError)
  })
})

describe('a refusal bites only when an argument depends on the variable', () => {
  const k3 = makeScope({ params: [['k', 3]] })
  const atIn = (text: string, v: string, s: ReturnType<typeof makeScope>, x: number) => compileScalar(simplify(diff(p(text), v, s)), [v], s)(x)
  const E_INV_HALF = Math.exp(-1) / 2 // pdf(1, 3) = 1^2 e^-1 / gamma(3), whose x-derivative at 1 is (2x - x^2) e^-x / 2

  const pdf = makeScope({ functions: [['pdf', fn(['x', 'k'], 'x^(k - 1) * exp(-x) / gamma(k)')]] })
  const withRoot = makeScope({ functions: [['r', fn(['n', 'x'], 'root(n, x) + 1')]] })
  const nested = makeScope({
    functions: [
      ['pdf', fn(['x', 'k'], 'x^(k - 1) * exp(-x) / gamma(k)')],
      ['h', fn(['x'], 'pdf(x, 3) * 2')],
      ['h2', fn(['k'], 'pdf(2, k)')],
    ],
  })

  it('constant arguments differentiate to 0, in every refused function', () => {
    expect(atIn('x^2 / gamma(3)', 'x', scope, 4)).toBeCloseTo(4, 14)
    expect(atIn('choose(10, 3) * x^3 * (1 - x)^7', 'x', scope, 0.5)).toBeCloseTo(-0.9375, 12)
    expect(atIn('gcd(4, 6) * x', 'x', scope, 5)).toBe(2)
    expect(atIn('lcm(4, 6) * x', 'x', scope, 5)).toBe(12)
    expect(atIn('perm(5, 2) * x', 'x', scope, 1)).toBe(20)
    expect(atIn('root(3, 8)', 'x', scope, 5)).toBe(0)
  })

  it('a @param is constant in x', () => {
    // d/dx x^(k-1) / gamma(k) = (k-1) x^(k-2) / gamma(k), which is x at k = 3
    expect(atIn('x^(k - 1) / gamma(k)', 'x', k3, 2)).toBeCloseTo(2, 14)
    expect(atIn('root(k, x)', 'x', k3, 8)).toBeCloseTo(1 / 12, 14)
  })

  it('but differentiating in the param itself is still refused, naming why', () => {
    expect(() => diff(p('x^(k - 1) / gamma(k)'), 'k', k3)).toThrow(/digamma/)
    expect(() => diff(p('root(k, x)'), 'k', k3)).toThrow(/index/)
    expect(() => diff(p('gcd(x, 2)'), 'x', scope)).toThrow(/whole numbers/)
  })

  // d/dx pdf(x, a) at x = 1 for a constant a: ((a - 1) - 1) e^-1 / gamma(a)
  const dPdfAt1 = (a: number) => ((a - 2) * Math.exp(-1)) / gamma(a)
  const constants = makeScope({
    params: [
      ['k', 3],
      ['m', 2],
      ['s', 1.5],
    ],
    functions: [
      ['pdf', fn(['x', 'k'], 'x^(k - 1) * exp(-x) / gamma(k)')],
      ['a', fn([], '1 / k')],
      ['shape', fn([], 'm^2 / s^2')],
    ],
  })

  it('a constant argument, however its own derivative is written, never trips the refused parameter', () => {
    // The argument's derivative is 0 / u-shaped, which simplify rightly keeps (step's NaN at 0 needs that).
    expect(atIn('pdf(x, 1 / k)', 'x', constants, 1)).toBeCloseTo(dPdfAt1(1 / 3), 12)
    expect(atIn('pdf(x, sqrt(k))', 'x', constants, 1)).toBeCloseTo(dPdfAt1(Math.sqrt(3)), 12)
    expect(atIn('pdf(x, ln(k))', 'x', constants, 1)).toBeCloseTo(dPdfAt1(Math.log(3)), 12)
    // a constant defined as 1 / k, and one defined as m^2 / s^2 (m, s @params)
    expect(atIn('pdf(x, a)', 'x', constants, 1)).toBeCloseTo(dPdfAt1(1 / 3), 12)
    expect(atIn('pdf(x, shape)', 'x', constants, 1)).toBeCloseTo(dPdfAt1(4 / 2.25), 12)
  })

  it('an argument that depends on the variable refuses, however flat it is, as the built-in does', () => {
    expect(() => diff(p('gamma(floor(x))'), 'x', constants)).toThrow(/digamma/)
    expect(() => diff(p('pdf(x, floor(x))'), 'x', constants)).toThrow(/digamma/)
  })

  it('a user function refused in one parameter still differentiates in the others', () => {
    expect(atIn('pdf(x, 3)', 'x', pdf, 1)).toBeCloseTo(E_INV_HALF, 14)
    expect(atIn('pdf(x, 1 + 2)', 'x', pdf, 1)).toBeCloseTo(E_INV_HALF, 14)
    expect(atIn('r(3, x)', 'x', withRoot, -8)).toBeCloseTo(1 / 12, 14)
  })

  it('and refuses when the argument that reaches the refused parameter moves with the variable', () => {
    expect(() => diff(p('pdf(2, x)'), 'x', pdf)).toThrow(/digamma/)
    expect(() => diff(p('pdf(x, x)'), 'x', pdf)).toThrow(/digamma/)
    expect(() => diff(p('r(x, 8)'), 'x', withRoot)).toThrow(/index/)
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
    for (const [text, s] of [
      ['r(x, 8)', withRoot],
      ['pdf(2, x)', pdf],
      ['h2(x)', nested],
    ] as const) {
      const said = message(() => diff(p(text), 'x', s))
      expect(said, text).toMatch(/No derivative rule/)
      expect(said, text).not.toContain('#')
    }
    expect(message(() => diff(p('root(x, 8)'), 'x', scope))).not.toContain('"x"')
  })

  it('the refusal carries through a user function that calls one', () => {
    expect(atIn('h(x)', 'x', nested, 1)).toBeCloseTo(2 * E_INV_HALF, 14)
    // h2(3) = pdf(2, 3) = 4 e^-2 / 2, constant in x
    expect(atIn('h2(3) * x', 'x', nested, 2)).toBeCloseTo(2 * Math.exp(-2), 14)
    expect(() => diff(p('h2(x)'), 'x', nested)).toThrow(/digamma/)
  })

  it('a cycle or an unknown name inside the function is still reported for constant arguments', () => {
    const cyclic = makeScope({ functions: [['f', fn(['x'], 'g(x) + 1')], ['g', fn(['x'], 'f(x) * 2')]] })
    expect(() => diff(p('f(3)'), 'x', cyclic)).toThrow(/defined in terms of each other/)
    const unknown = makeScope({ functions: [['f', fn(['x'], 'frob(x)')]] })
    expect(() => diff(p('f(3)'), 'x', unknown)).toThrow(/frob/)
  })
})
