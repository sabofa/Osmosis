import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { CompileError, compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { makeScope } from './scope'
import { simplify } from './simplify'
import { choose, erf, erfc, factorial, gamma, gcd, lcm, perm, root, step } from './special'

const SQRT_PI = Math.sqrt(Math.PI)
const scope = makeScope()

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
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

  it('choose and perm answer Infinity at once when they overflow, however long the loop would be', () => {
    const t0 = performance.now()
    expect(choose(4e8, 2e8)).toBe(Infinity)
    expect(perm(4e8, 2e8)).toBe(Infinity)
    expect(performance.now() - t0).toBeLessThan(200)
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
