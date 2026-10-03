import { describe, expect, it, vi } from 'vitest'
import { parseConditionString, parseExprString as p } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { CompileError, compileScalar } from '../compile'
import { call, num, variable } from '../expr'
import { MAX_TERMS } from '../reserved'
import { makeScope, type MathFunction, type MathScope } from '../scope'
import { box, fmt, must, nextDown, nextUp, pointsOf, show, within, withZeroSigns } from './compose.testkit'
import { type CompiledInterval, compileInterval } from './compile'
import { CONTINUOUS, DEFINED, iv, type Iv, PARTIAL, UNKNOWN } from './core'
import { continuitySweep, continuityViolation, findJump, overclaims, samplerBox, soundnessSweep } from './fuzz.testkit'
import * as surface from './index'
import { mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

// The sweeps are a second or two on a quiet machine; the default 5 s is for a loaded one.
vi.setConfig({ testTimeout: 120_000 })

const fn = (params: string[], body: string): MathFunction => ({ params, body: p(body) })

// One evaluation of `src` over the given box ends (x, then y, then z).
function at(src: string | Expr, vars: string[], scope: MathScope, ...ends: number[]): Iv {
  const expr = typeof src === 'string' ? p(src) : src
  return compileInterval(expr, vars, scope)(iv(), ...ends)
}

const plain = makeScope()

// ---------------------------------------------------------------------------
// Names and errors are the scalar compile's
// ---------------------------------------------------------------------------

describe('the interval compiler validates with the scalar compile', () => {
  it('an unknown function and a forgotten product are the scalar compile errors', () => {
    expect(() => compileInterval(p('q(x)'), ['x'], plain)).toThrow('Unknown function "q"')
    expect(() => compileInterval(p('q(x)'), ['x'], plain)).toThrow(CompileError)
    expect(() => compileInterval(p('xy'), ['x', 'y'], plain)).toThrow('did you mean x*y?')
    expect(() => compileInterval(p('xy'), ['x', 'y'], plain)).toThrow(CompileError)
  })

  it('every other refusal comes through unchanged: arity, shadowing, cycles, vectors', () => {
    const scope = makeScope({
      params: [['sin', 1]],
      functions: [
        ['f', fn(['t'], 'f(t)')],
        ['v', { params: ['t'], body: [p('t'), p('t'), p('t')] }],
      ],
    })
    const message = (src: string) => {
      try {
        compileInterval(p(src), ['x'], scope)
      } catch (err) {
        expect(err).toBeInstanceOf(CompileError)
        return (err as Error).message
      }
      return 'no error'
    }
    for (const src of ['sin(x)', 'f(x)', 'v(x)', 'cos(x, x)', 'k(x)']) {
      let scalar = 'no error'
      try {
        compileScalar(p(src), ['x'], scope)
      } catch (err) {
        scalar = (err as Error).message
      }
      expect(message(src), src).toBe(scalar)
      expect(scalar, src).not.toBe('no error')
    }
  })

  it('more than three variables is refused', () => {
    expect(() => compileInterval(p('x'), ['a', 'b', 'c', 'd'], plain)).toThrow()
  })

  it('the public surface re-exports the compiler and the decorated interval', () => {
    expect(surface.compileInterval).toBe(compileInterval)
    expect([surface.UNKNOWN, surface.PARTIAL, surface.DEFINED, surface.CONTINUOUS]).toEqual([0, 1, 2, 3])
    expect(surface.iv()).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
  })
})

describe('names resolve as the scalar compile resolves them', () => {
  it('a bound variable shadows a parameter and a constant; a parameter shadows pi', () => {
    const scope = makeScope({ params: [['x', 100], ['pi', 7]], functions: [['y', fn([], '5')]] })
    // x and y are the inputs, not the parameter 100 or the constant 5
    expect(within(at('x + y', ['x', 'y'], scope, 1, 2, 10, 20), 11, 22)).toBe(true)
    // pi is a parameter here, read at call time
    expect(at('pi', [], scope)).toEqual({ lo: 7, hi: 7, v: CONTINUOUS })
    // and with no input called y, y is the constant
    expect(at('x + y', ['x'], scope, 1, 2)).toMatchObject({ v: CONTINUOUS })
    expect(within(at('x + y', ['x'], scope, 1, 2), 6, 7)).toBe(true)
  })

  it('a user function of that name wins over a built-in and over a bound variable of the call name', () => {
    const scope = makeScope({ functions: [['sin', fn(['t'], 't + 1')], ['g', fn(['t'], '10 t')]] })
    const r = at('sin(x)', ['x'], scope, 1, 2)
    expect(within(r, 2, 3)).toBe(true)
    // g is both the bound variable and a function: the call is the function, the bare name the variable
    const s = at('g(g)', ['g'], scope, 1, 2)
    expect(within(s, 10, 20)).toBe(true)
  })

  it('a value called with one argument is a product: x(x + 1), a(x), k(x + 1), pi(x)', () => {
    const scope = makeScope({ params: [['a', 2]], functions: [['k', fn([], '3')]] })
    expect(within(at('x(x + 1)', ['x'], scope, 1, 2), 2, 6)).toBe(true)
    expect(within(at('a(x)', ['x'], scope, 1, 2), 2, 4)).toBe(true)
    expect(within(at('k(x + 1)', ['x'], scope, 0, 1), 3, 6)).toBe(true)
    expect(within(at('pi(x)', ['x'], scope, 1, 2), Math.PI, 2 * Math.PI)).toBe(true)
  })

  it('pi, e and inf are single values', () => {
    expect(at('pi', [], plain)).toEqual({ lo: Math.PI, hi: Math.PI, v: CONTINUOUS })
    expect(at('e', [], plain)).toEqual({ lo: Math.E, hi: Math.E, v: CONTINUOUS })
    expect(at('inf', [], plain)).toEqual({ lo: Infinity, hi: Infinity, v: CONTINUOUS })
  })

  it('a parameter is read at call time: no recompile when it changes; NaN is empty', () => {
    const scope = makeScope({ params: [['a', 2]] })
    const g = compileInterval(p('a x'), ['x'], scope)
    const out = iv()
    expect(within(g(out, 1, 2), 2, 4)).toBe(true)
    scope.params.values[0] = 5
    expect(within(g(out, 1, 2), 5, 10)).toBe(true)
    scope.params.values[0] = Number.NaN
    expect(g(out, 1, 2)).toMatchObject({ lo: Infinity, hi: -Infinity, v: PARTIAL })
  })

  it('a function body sees its own parameters, never the caller variables', () => {
    const scope = makeScope({ params: [['t', 4]], functions: [['f', fn(['u'], 'u + t')]] })
    // t inside f is the document parameter (4); the caller's variable t is not visible
    expect(within(at('f(t)', ['t'], scope, 1, 2), 5, 6)).toBe(true)
  })

  it('an input box that is NaN or backwards is empty, and so is what reads it', () => {
    const g = compileInterval(p('x + 1'), ['x'], plain)
    expect(g(iv(), Number.NaN, 1)).toMatchObject({ lo: Infinity, hi: -Infinity, v: PARTIAL })
    expect(g(iv(), 2, 1)).toMatchObject({ lo: Infinity, hi: -Infinity, v: PARTIAL })
  })

  it('the output may be any Iv, and a compiled function can be called again and again', () => {
    const g = compileInterval(p('x^2'), ['x'], plain)
    const out = iv()
    expect(g(out, -1, 2)).toBe(out)
    expect(within(out, 0, 4)).toBe(true)
    expect(within(g(out, 3, 4), 9, 16)).toBe(true)
    expect(within(g(out, -1, 2), 0, 4)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tight and honest on simple boxes
// ---------------------------------------------------------------------------

describe('tight verdicts on simple boxes', () => {
  it('polynomials, poles, domains and odd roots', () => {
    const r1 = at('x^2 - 1', ['x'], plain, -1, 2)
    expect(within(r1, -1, 3)).toBe(true)
    expect(r1.v).toBe(CONTINUOUS)
    expect(at('1/x', ['x'], plain, -1, 1).v).toBe(PARTIAL)
    const r3 = at('sqrt(x - 1)', ['x'], plain, 0, 2)
    expect(r3.v).toBe(PARTIAL)
    expect(within(r3, 0, 1)).toBe(true)
    const r4 = at('x^(1/3)', ['x'], plain, -8, 8)
    expect(within(r4, -2, 2)).toBe(true)
    expect(r4.v).toBe(CONTINUOUS)
    expect(within(at('x^(2/3)', ['x'], plain, -8, 1), 0, 4)).toBe(true)
    expect(at('x^(2/3)', ['x'], plain, -8, 1).v).toBe(CONTINUOUS)
  })

  it('degrees, a parameter, a user function and a constant product', () => {
    const r = at('sin(x)', ['x'], makeScope({ angle: 'degrees' }), 0, 90)
    expect(within(r, 0, 1)).toBe(true)
    expect(r.v).toBe(CONTINUOUS)
    expect(within(at('a x', ['x'], makeScope({ params: [['a', 2]] }), 1, 2), 2, 4)).toBe(true)
    expect(within(at('f(x + 1)', ['x'], makeScope({ functions: [['f', fn(['t'], 't^2')]] }), 0, 1), 1, 4)).toBe(true)
    expect(within(at('k(x + 1)', ['x'], makeScope({ functions: [['k', fn([], '3')]] }), 0, 1), 3, 6)).toBe(true)
  })

  it('inverse trig answers in degrees too, and a user function nests', () => {
    const r = at('asin(x)', ['x'], makeScope({ angle: 'degrees' }), 0, 1)
    expect(within(r, 0, 90, 1e-10)).toBe(true)
    const scope = makeScope({ functions: [['f', fn(['t'], 't + 1')], ['h', fn(['t'], 'f(f(t)) * 2')]] })
    const s = at('h(x)', ['x'], scope, 0, 1)
    expect(within(s, 4, 6)).toBe(true)
    expect(s.v).toBe(CONTINUOUS)
  })

  it('a constant subtree is the single value the scalar computes: no widening on exact arithmetic', () => {
    expect(at('2 + 3', [], plain)).toEqual({ lo: 5, hi: 5, v: CONTINUOUS })
    expect(at('1/3', [], plain)).toEqual({ lo: 1 / 3, hi: 1 / 3, v: CONTINUOUS })
    expect(at('sqrt(2) * pi', [], plain)).toEqual({ lo: Math.SQRT2 * Math.PI, hi: Math.SQRT2 * Math.PI, v: CONTINUOUS })
    // 0/0 is NaN: a NaN point is empty
    expect(at('0/0', [], plain)).toMatchObject({ lo: Infinity, hi: -Infinity, v: PARTIAL })
    // -0 keeps its sign
    expect(Object.is(at('-0', [], plain).lo, -0)).toBe(true)
  })

  it('a literal odd root at 1e300 is the real root to within the library bound, not shifted by a widened exponent', () => {
    for (const [src, big] of [['x^(1/3)', 1e300], ['x^(-1/3)', 1e300], ['x^(2/3)', 1e300], ['x^(5/3)', 1e150], ['x^(-5/3)', 1e150]] as const) {
      const f = compileScalar(p(src), ['x'], plain)
      for (const x of [big, 1 / big, 0.75 * big, -big, -1 / big]) {
        const y = f(x)
        const r = at(src, ['x'], plain, x, x)
        expect(r.lo <= y && y <= r.hi, `${src} at ${x}: ${y} against ${show(r)}`).toBe(true)
        expect(r.hi - r.lo <= 2e-15 * Math.abs(y), `${src} at ${x}: ${show(r)} is wider than the library bound`).toBe(true)
      }
    }
    // inside a user function body the exponent is just as exact
    const scope = makeScope({ functions: [['f', fn(['t'], 't^(1/3)')]] })
    const r = at('f(x)', ['x'], scope, 1e300, 1e300)
    const y = compileScalar(p('f(x)'), ['x'], scope)(1e300)
    expect(r.lo <= y && y <= r.hi && r.hi - r.lo <= 2e-15 * y).toBe(true)
  })

  it('a subtree that reads only parameters is a single value read at call time', () => {
    const scope = makeScope({ params: [['a', 2]] })
    const g = compileInterval(p('x^(a/2 + 1/3) + (a + 1) * 0'), ['x'], scope)
    const out = iv()
    expect(g(out, 4, 4).hi - g(out, 4, 4).lo).toBeLessThan(1e-13)
    scope.params.values[0] = 3
    const r = g(out, 4, 4)
    expect(r.lo <= Math.pow(4, 3 / 2 + 1 / 3) && Math.pow(4, 3 / 2 + 1 / 3) <= r.hi).toBe(true)
  })
})

describe('reserved constructs', () => {
  it('piecewise: decided, undecided, and with no otherwise', () => {
    expect(at('{x < 0: -1, 1}', ['x'], plain, 1, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(at('{x < 0: -1, 1}', ['x'], plain, -2, -1)).toEqual({ lo: -1, hi: -1, v: CONTINUOUS })
    expect(at('{x < 0: -1, 1}', ['x'], plain, -1, 1)).toEqual({ lo: -1, hi: 1, v: DEFINED })
    expect(at('{x < 0: -1}', ['x'], plain, -1, 1).v).toBeLessThanOrEqual(PARTIAL)
    expect(at('{x < 0: -1}', ['x'], plain, -2, -1)).toEqual({ lo: -1, hi: -1, v: CONTINUOUS })
    expect(at('{x < 0: -1}', ['x'], plain, 1, 2)).toMatchObject({ lo: Infinity, hi: -Infinity, v: PARTIAL })
  })

  it('piecewise walks the pieces in order and stops at the first that surely holds', () => {
    const src = '{x < 0: x^2, x <= 2: 2x + 1, 5}'
    expect(within(at(src, ['x'], plain, 0.5, 1), 2, 3)).toBe(true)
    expect(at(src, ['x'], plain, 0.5, 1).v).toBe(CONTINUOUS)
    expect(at(src, ['x'], plain, 3, 4)).toEqual({ lo: 5, hi: 5, v: CONTINUOUS })
    expect(at(src, ['x'], plain, -1, 1).v).toBe(DEFINED)
    expect(at(src, ['x'], plain, 1, 3).v).toBe(DEFINED)
    // a piece that is never reached is not read: the surely true first piece ends the walk
    expect(at('{x > 0: 1, sqrt(-x) > 1: 2, 3}', ['x'], plain, 1, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
  })

  it('a condition that is NaN somewhere makes the piecewise partial, and one that is NaN everywhere ends the walk', () => {
    expect(at('{sqrt(x) < 2: 1, 2}', ['x'], plain, -1, 1).v).toBeLessThanOrEqual(PARTIAL)
    expect(at('{sqrt(x) < 2: 1, 2}', ['x'], plain, 1, 3).v).toBe(CONTINUOUS)
    const r = at('{sqrt(x) < 2: 1, 2}', ['x'], plain, -5, -1)
    expect(r.lo).toBeGreaterThan(r.hi)
    expect(r.v).toBe(PARTIAL)
  })

  it('the union of pieces keeps a zero bound honest, also through a piece that is a piecewise', () => {
    // [+0, +0] joined with [-0, 1] holds both zeros: a bottom of exactly -0 would deny +0 (1 / the box reads it)
    const direct = at('{x < 0.5: 0, x}', ['x'], plain, -0, 1)
    expect(direct.lo).toBeLessThan(0)
    expect(direct.hi).toBeGreaterThanOrEqual(1)
    const nested = at('{x < 0.5: 0, x < 2: {x < 7: x, 2}, 5}', ['x'], plain, -0, 1)
    expect(nested.lo < 0).toBe(true)
    expect(nested.hi).toBeGreaterThanOrEqual(1)
    // the two zeros as the only bounds: the pair -0, +0
    const pair = at('{x < 0.5: 0, -0}', ['x'], plain, 0, 1)
    expect(Object.is(pair.lo, -0) && Object.is(pair.hi, 0)).toBe(true)
    // a +0 top over a negative bottom, with a -0 given too, moves off zero
    const top = at('{x < 0.5: 0, -x}', ['x'], plain, 0, 1)
    expect(top.lo).toBeLessThanOrEqual(-1)
    expect(top.hi).toBeGreaterThan(0)
  })

  it('comparisons: decided true, decided false, and both; a weaker operand weakens the answer', () => {
    expect(at('{x < 2: 1, 0}', ['x'], plain, 0, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(at('{x > 2: 1, 0}', ['x'], plain, 0, 1)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    const cond = (src: string, lo: number, hi: number) => at(parseConditionString(src), ['x'], plain, lo, hi)
    expect(cond('x < 2', 0, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x < 2', 3, 4)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x < 2', 1, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    expect(cond('x <= 2', 0, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x < 2', 2, 3)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x > 2', 2, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    expect(cond('x >= 2', 2, 3)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x >= 2', 0, 1)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x = 2', 2, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x = 2', 3, 4)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x = 2', 1, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    expect(cond('x != 2', 2, 2)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x != 2', 3, 4)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x != 2', 1, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    // a partial operand: the comparison is no better than it
    expect(cond('sqrt(x) < 5', -1, 1).v).toBe(PARTIAL)
    expect(cond('sqrt(x) < 5', -1, 1)).toMatchObject({ lo: 1, hi: 1 })
    // an operand that is NaN everywhere
    expect(cond('sqrt(x) < 5', -3, -1).lo).toBeGreaterThan(cond('sqrt(x) < 5', -3, -1).hi)
  })

  it('and, or, not on truth intervals, and a surely false operand does not hide a NaN', () => {
    const cond = (src: string, lo: number, hi: number) => at(parseConditionString(src), ['x'], plain, lo, hi)
    expect(cond('x < 2 and x > 0', 0.5, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x < 2 and x > 0', 3, 4)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x < 2 and x > 0', 1, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    expect(cond('x < 2 or x > 5', 0, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('x < 2 or x > 5', 3, 4)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('x < 2 or x > 5', 1, 6)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    expect(cond('not x < 2', 0, 1)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(cond('not x < 2', 3, 4)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(cond('not x < 2', 1, 3)).toEqual({ lo: 0, hi: 1, v: DEFINED })
    // 0 and NaN is NaN in the scalar (andValue): the answer is surely false where defined, and partial
    const r = cond('x > 5 and sqrt(x) < 5', -1, 4)
    expect(r.v).toBe(PARTIAL)
    expect(r).toMatchObject({ lo: 0, hi: 0 })
    const s = cond('x > -5 or sqrt(x) < 5', -1, 4)
    expect(s.v).toBe(PARTIAL)
    expect(s).toMatchObject({ lo: 1, hi: 1 })
    expect(cond('not sqrt(x) < 5', -1, 4).v).toBe(PARTIAL)
    // an operand that is NaN everywhere
    const t = cond('x > 5 and sqrt(x) < 5', -4, -1)
    expect(t.lo).toBeGreaterThan(t.hi)
  })

  it('a condition that is not a comparison reads as nonzero = true', () => {
    // the grammar writes only comparisons as pieces' conditions; a condition is any expression to the kernel
    const x = variable('x')
    const pw = (cond: Expr, value: Expr, otherwise: Expr) => call('__piecewise', cond, value, otherwise)
    expect(at(pw(x, num(1), num(2)), ['x'], plain, 1, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(at(pw(x, num(1), num(2)), ['x'], plain, -2, -1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(at(pw(x, num(1), num(2)), ['x'], plain, -1, 1)).toEqual({ lo: 1, hi: 2, v: DEFINED })
    expect(at(pw(p('x - x'), num(1), num(2)), ['x'], plain, 1, 2).v).toBeLessThanOrEqual(DEFINED)
    // exactly zero everywhere: surely false
    expect(at(pw(num(0), num(1), num(2)), [], plain)).toEqual({ lo: 2, hi: 2, v: CONTINUOUS })
    expect(at(pw(p('x * 0'), num(1), num(2)), ['x'], plain, 1, 2).v).toBeLessThanOrEqual(DEFINED)
  })

  it('x! is gamma(x + 1)', () => {
    const r = at('x!', ['x'], plain, 1, 3)
    // gamma over [2, 4]
    expect(r.lo).toBeLessThanOrEqual(1)
    expect(r.lo).toBeGreaterThan(1 - 1e-12)
    expect(r.hi).toBeGreaterThanOrEqual(6)
    expect(r.hi).toBeLessThan(6 + 1e-12)
    expect(r.v).toBe(CONTINUOUS)
    expect(at('x!', ['x'], plain, -2, -0.5).v).toBeLessThanOrEqual(PARTIAL)
  })

  it('sum and prod enclose term by term', () => {
    const r = at('sum(k = 1 to 3, k x)', ['x'], plain, 0, 1)
    expect(within(r, 0, 6)).toBe(true)
    expect(r.v).toBe(CONTINUOUS)
    expect(within(at('prod(k = 1 to 4, x + k)', ['x'], plain, 0, 1), 24, 120, 1e-10)).toBe(true)
    expect(within(at('sum(k = 0 to 6, x^k / k!)', ['x'], plain, 0, 1), 1, 2.7180555555555554, 1e-10)).toBe(true)
    // an empty range is the identity, exactly
    expect(at('sum(k = 5 to 1, x)', ['x'], plain, 0, 1)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(at('prod(k = 5 to 1, x)', ['x'], plain, 0, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    // nested, the inner bound reading the outer variable
    expect(within(at('sum(i = 1 to 3, sum(j = 1 to i, 1))', [], plain), 6, 6)).toBe(true)
  })

  it('a loop bound that is not one whole number is unknown', () => {
    expect(at('sum(k = 1 to n, 1)', ['x'], makeScope({ params: [['n', 2.5]] }), 0, 1).v).toBe(UNKNOWN)
    expect(at('sum(k = 1 to x, 1)', ['x'], plain, 2, 3).v).toBe(UNKNOWN)
    expect(within(at('sum(k = 1 to x, 1)', ['x'], plain, 3, 3), 3, 3)).toBe(true)
    expect(at('sum(k = 1 to x, 1)', ['x'], plain, 3, 3).v).toBe(CONTINUOUS)
    expect(at('sum(k = x to 5, 1)', ['x'], plain, 1, 2).v).toBe(UNKNOWN)
    expect(at('sum(k = 1 to n, 1)', ['x'], makeScope({ params: [['n', Number.NaN]] }), 0, 1).v).toBe(UNKNOWN)
  })

  it('a loop that starts at a signed zero starts at it: a box of both zeros holds both first terms', () => {
    const f = compileScalar(p('sum(i = x to 1, i^(-1))'), ['x'], plain)
    expect(f(0)).toBe(Infinity)
    expect(f(-0)).toBe(-Infinity)
    const g = compileInterval(p('sum(i = x to 1, i^(-1))'), ['x'], plain)
    expect(g(iv(), 0, 0).hi).toBe(Infinity)
    expect(g(iv(), -0, -0).lo).toBe(-Infinity)
    const both = g(iv(), -0, 0)
    expect(both.lo).toBe(-Infinity)
    expect(both.hi).toBe(Infinity)
  })

  it('a bound that is one whole number where it is defined keeps the loop partial where it is not', () => {
    const r = at('sum(k = 1 to max(floor(sqrt(x)), 3), k)', ['x'], plain, -1, 0.5)
    expect(r.v).toBe(PARTIAL)
    expect(within(r, 6, 6)).toBe(true)
    expect(compileScalar(p('sum(k = 1 to max(floor(sqrt(x)), 3), k)'), ['x'], plain)(-1)).toBeNaN()
    // defined everywhere on [0.5, 1] (floor may jump there, so no better than DEFINED)
    expect(at('sum(k = 1 to max(floor(sqrt(x)), 3), k)', ['x'], plain, 0.5, 1)).toMatchObject({ v: DEFINED })
    expect(at('sum(k = 1 to max(floor(sqrt(x)), 3), k)', ['x'], plain, 0.5, 0.6).v).toBe(CONTINUOUS)
  })

  it('a loop bound that is a parameter expression is a single whole number', () => {
    const scope = makeScope({ params: [['n', 4]] })
    const g = compileInterval(p('sum(k = 1 to n + 1, k)'), [], scope)
    expect(within(g(iv()), 15, 15)).toBe(true)
    expect(g(iv()).v).toBe(CONTINUOUS)
    scope.params.values[0] = 5
    expect(within(g(iv()), 21, 21)).toBe(true)
  })

  it('integral is unknown with bounds [-inf, inf]', () => {
    expect(at('integral(t = 0 to x, t)', ['x'], plain, 0, 1)).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
    expect(at('x + integral(t = 0 to 1, t x)', ['x'], plain, 0, 1)).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
    // one that reads a parameter is a quadrature per call: unknown too
    expect(at('integral(t = 0 to 1, a t)', ['x'], makeScope({ params: [['a', 2]] }), 0, 1)).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
  })

  it('an integral that reads no variable and no parameter is the number the scalar computes, once', () => {
    const r = at('integral(t = 0 to 1, t)', [], plain)
    expect(r).toEqual({ lo: 0.5, hi: 0.5, v: CONTINUOUS })
    const scalar = compileScalar(p('x integral(t = 0 to pi, sin(t))'), ['x'], plain)(3)
    const s = at('x integral(t = 0 to pi, sin(t))', ['x'], plain, 3, 3)
    expect(s.lo <= scalar && scalar <= s.hi && s.hi - s.lo < 1e-14).toBe(true)
    expect(s.v).toBe(CONTINUOUS)
    // one that never settles is NaN in the scalar, and so empty
    const d = at('integral(t = 0 to 1, 1/t)', [], plain)
    expect(d.lo).toBeGreaterThan(d.hi)
    expect(d.v).toBe(PARTIAL)
    // a loop in a bound is charged to the budget, so it is never folded
    expect(at('integral(t = 0 to sum(k = 1 to 3, 1), t)', [], plain).v).toBe(UNKNOWN)
  })

  it("f'(x) is the derivative's body, inlined", () => {
    const scope = makeScope({ functions: [['f', fn(['t'], 't^3')]] })
    const r = at("f'(x)", ['x'], scope, 1, 2)
    expect(within(r, 3, 12)).toBe(true)
    expect(r.v).toBe(CONTINUOUS)
    expect(within(at("f''(x)", ['x'], scope, 1, 2), 6, 12)).toBe(true)
    expect(within(at("f'(2 x)", ['x'], scope, 1, 2), 12, 48)).toBe(true)
  })

  it('a power by a variable exponent and by a parameter', () => {
    expect(within(at('2^x', ['x'], plain, 1, 3), 2, 8)).toBe(true)
    expect(within(at('x^y', ['x', 'y'], plain, 2, 3, 1, 2), 2, 9)).toBe(true)
    expect(within(at('x^a', ['x'], makeScope({ params: [['a', 2]] }), -2, 3), 0, 9)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The loop budget mirrors the scalar's
// ---------------------------------------------------------------------------

describe('the loop budget', () => {
  const nParam = (n: number) => makeScope({ params: [['n', n]] })

  it('a loop of exactly MAX_TERMS runs; one more is unknown, and NaN in the scalar', () => {
    const run = (n: number) => at('sum(k = 1 to n, 1)', [], nParam(n))
    // a hundred thousand additions, two ulps each: within 1e-9 relative
    expect(within(run(MAX_TERMS), MAX_TERMS, MAX_TERMS, 1e-4)).toBe(true)
    expect(run(MAX_TERMS).v).toBe(CONTINUOUS)
    expect(run(MAX_TERMS + 1).v).toBe(UNKNOWN)
    expect(compileScalar(p('sum(k = 1 to n, 1)'), [], nParam(MAX_TERMS + 1))()).toBeNaN()
  })

  it('a nest past the budget at run time is unknown wherever the scalar is NaN, and bounded where it is not', () => {
    const scope = makeScope({ params: [['n', 1], ['m', 1]] })
    const f = compileScalar(p('sum(i = 1 to n, sum(j = 1 to m, 1))'), [], scope)
    const g = compileInterval(p('sum(i = 1 to n, sum(j = 1 to m, 1))'), [], scope)
    const out = iv()
    let nan = 0
    let finite = 0
    for (const [n, m] of [[10, 10], [300, 300], [316, 316], [317, 316], [317, 317], [400, 300], [1, 99998], [1, 99999], [2, 50000], [2, 49999], [50000, 1], [99999, 1], [100000, 1]]) {
      scope.params.values[0] = n
      scope.params.values[1] = m
      const y = f()
      g(out)
      must(out, y, () => `n ${n} m ${m}: scalar ${y}, twin ${show(out)}`)
      if (Number.isNaN(y)) {
        nan++
        expect(out.v, `n ${n} m ${m}`).toBeLessThanOrEqual(PARTIAL)
      } else finite++
    }
    expect(nan).toBeGreaterThan(3)
    expect(finite).toBeGreaterThan(3)
  })

  it("an unknown loop that a function drops is still charged: the next loop in its nest is not trusted", () => {
    // At x = 3 the j loop charges 3 x 30000, so the q loop (20000 more) passes the budget and the scalar
    // is NaN, though the twin's j loop answers unknown without running and g returns only its second argument.
    const scope = makeScope({ functions: [['g', fn(['t', 'u'], 'u')]] })
    const src = 'sum(i = 1 to 1, g(sum(j = 1 to x, sum(l = 1 to 30000, 1)), sum(q = 1 to 20000, 1)))'
    const f = compileScalar(p(src), ['x'], scope)
    expect(f(3)).toBeNaN()
    expect(f(2)).toBe(20000)
    const r = at(src, ['x'], scope, 2.5, 3.5)
    expect(r.v).toBeLessThanOrEqual(PARTIAL)
    for (const x of [2, 2.5, 3, 3.5]) must(r, f(x), () => `x ${x}: ${show(r)}`)
  })

  it('a loop in a bound of another loop counts the way the scalar counts it', () => {
    const scope = makeScope({ params: [['n', 60000]] })
    const src = 'sum(i = 1 to n, sum(j = 1 to sum(l = 1 to 2, 1), 1))'
    const f = compileScalar(p(src), [], scope)
    const r = at(src, [], scope)
    must(r, f(), () => `scalar ${f()}, twin ${show(r)}`)
    scope.params.values[0] = 10
    must(at(src, [], scope), f(), () => 'small n')
  })

  it('a product past the budget is unknown too, and a prod of an empty range is exact', () => {
    expect(at('prod(k = 1 to n, 1)', [], nParam(MAX_TERMS + 5)).v).toBe(UNKNOWN)
    expect(at('prod(k = 1 to n, 1)', [], nParam(0))).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
  })

  it('a loop beside another is its own count; a loop inside another adds to it', () => {
    const scope = nParam(60000)
    // 60000 + 60000 would pass the budget if the second were counted with the first
    const beside = at('sum(k = 1 to n, 1) + sum(k = 1 to n, 1)', [], scope)
    expect(within(beside, 120000, 120000, 1e-3)).toBe(true)
    expect(beside.v).toBe(CONTINUOUS)
    expect(compileScalar(p('sum(k = 1 to n, 1) + sum(k = 1 to n, 1)'), [], scope)()).toBe(120000)
    // inside the first, the second adds its terms every time it is entered
    expect(at('sum(i = 1 to 2, sum(k = 1 to n, 1))', [], scope).v).toBe(UNKNOWN)
    expect(compileScalar(p('sum(i = 1 to 2, sum(k = 1 to n, 1))'), [], scope)()).toBeNaN()
    // an integrand's loops are counted on their own, and put back after: 40000 inside the integral and
    // 2 around it is no nest of 80000 (the integral reads no variable and no parameter, so it is a number)
    const around = 'sum(i = 1 to 2, integral(t = 0 to 1, sum(k = 1 to 40000, 1)) * 0 + i)'
    expect(compileScalar(p(around), [], scope)()).toBe(3)
    expect(within(at(around, [], scope), 3, 3)).toBe(true)
    expect(at(around, [], scope).v).toBe(CONTINUOUS)
  })

  it('every evaluation starts a new count', () => {
    const scope = nParam(MAX_TERMS)
    const g = compileInterval(p('sum(k = 1 to n, 1)'), [], scope)
    for (let i = 0; i < 3; i++) {
      const r = g(iv())
      expect(within(r, MAX_TERMS, MAX_TERMS, 1e-4)).toBe(true)
      expect(r.v).toBe(CONTINUOUS)
    }
  })
})

// ---------------------------------------------------------------------------
// Soundness over composite expressions
// ---------------------------------------------------------------------------

// One expression of x over 300 random boxes and the testkit's edge boxes, each zero end as both
// signs, against compileScalar at the ends, the signed zeros the box holds, and interior points.
// A violation of `must` (strict admits plus the zero-bound invariant) fails the test.
function sweep1(src: string | Expr, scope: MathScope = plain): void {
  const expr = typeof src === 'string' ? p(src) : src
  const label = typeof src === 'string' ? src : JSON.stringify(src)
  const f = compileScalar(expr, ['x'], scope)
  const g = compileInterval(expr, ['x'], scope)
  const rand = mulberry32(label.length * 31 + 7)
  const out = iv()
  const boxes = [...Array.from({ length: 300 }, () => randomBox(rand)), ...EDGE_BOXES]
  for (const [lo, hi] of boxes) {
    for (const [l, h] of withZeroSigns(lo, hi)) {
      g(out, l, h)
      for (const x of pointsOf(l, h, rand)) {
        const y = f(x)
        must(out, y, () => `${label} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(out)}`)
      }
    }
  }
}

const EDGE_BOXES: [number, number][] = [
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, 2], [0, 2], [-2, 0], [-1, 1], [-1e-300, 1e-300],
  [-5e-324, 5e-324], [0, 1], [-1, 0], [0.5, 2], [-3, -1], [1, 1], [-8, 8], [0, 1e-300], [-1e-300, 0], [-0.7, 0.3], [-0.9, -0.1], [0.1, 0.9], [-0.5, 0.5], [2.9, 3.1],
  [3, 3], [-3, -3], [2, 4], [-4, -2], [1, 2], [-1, -0], [0.25, 4], [-30, 30], [nextDown(1), nextUp(1)], [nextDown(3), nextUp(3)], [170, 172], [-171.5, -170.5], [24, 26],
]

// Two variables: random box pairs, and the edge boxes crossed. A handful of points per box.
const EDGE2: [number, number][] = [
  [-0, 0], [0, 0], [-1, 1], [0, 1], [-1, 0], [1, 2], [-2, -1], [0.5, 0.5], [-0, 2], [-2, -0], [-3, 3], [-Infinity, Infinity], [0, Infinity], [-5e-324, 5e-324], [2, 2], [-1, -1],
]

// A few points of [lo, hi]: the ends, the signed zeros it holds, and some in between. An interior point that
// rounds to a zero is not one (a box whose zero end is -0 does not hold +0), so the zeros are only the held ones.
function few(lo: number, hi: number, rand: () => number): number[] {
  const pts = pointsIn(lo, hi, rand, 3).filter((x) => x !== 0)
  for (const z of zerosIn(lo, hi)) pts.push(z)
  for (const x of [(lo + hi) / 2, 1, -1, 2]) if (x !== 0 && lo <= x && x <= hi) pts.push(x)
  return pts
}

function sweep2(src: string, scope: MathScope = plain): void {
  const expr = p(src)
  const f = compileScalar(expr, ['x', 'y'], scope)
  const g = compileInterval(expr, ['x', 'y'], scope)
  const rand = mulberry32(src.length * 17 + 3)
  const out = iv()
  const pairs: [[number, number], [number, number]][] = Array.from({ length: 300 }, () => [randomBox(rand), randomBox(rand)])
  for (const bx of EDGE2) for (const by of EDGE2) pairs.push([bx, by])
  for (const [bx, by] of pairs) {
    for (const [xl, xh] of withZeroSigns(bx[0], bx[1])) {
      for (const [yl, yh] of withZeroSigns(by[0], by[1])) {
        g(out, xl, xh, yl, yh)
        for (const x of few(xl, xh, rand)) {
          for (const y of few(yl, yh, rand)) {
            const v = f(x, y)
            must(out, v, () => `${src} over x [${fmt(xl)}, ${fmt(xh)}] y [${fmt(yl)}, ${fmt(yh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(v)}, twin ${show(out)}`)
          }
        }
      }
    }
  }
}

const ONE_VARIABLE = [
  'x^3 - 2x + 1',
  '(x^2 - 1)/(x - 1)',
  'sin(x)/x',
  'tan(x) + sec(x)',
  'ln(x^2 - 4)',
  'sqrt(1 - x^2)',
  'x^(1/3) - x^(2/3)',
  'floor(x) + x',
  'abs(x - 2) * sign(x)',
  'gamma(x) * erf(x)',
  '{x < 0: x^2, x <= 2: 2x + 1, 5}',
  '{x < -1 or x > 1: 1/x, 0}',
  'sum(k = 0 to 6, x^k / k!)',
  'step(x) * exp(-x)',
  'atan2(x, x^2 - 1)',
  'mod(x, 3)',
  // compositions that broke earlier tasks
  'exp(-1/x)',
  'exp(1/x)',
  '1/x^(-2/3)',
  '1/x^(-1/3)',
  'x^(-2/3)',
  '{x < 0: -1/x, sqrt(x)}',
  'x(x + 1)',
  'x(x + 1)/x',
  '1/(1/x)',
  'sqrt(x)/x',
  'ln(x)/ln(x + 1)',
  'cbrt(x) * x^(1/3)',
  'x^x',
  '2^x - x^2',
  'x!',
  '(x - 1)!/x!',
  'asin(x) + acos(x)',
  'round(x) - ceil(x)',
  'atan(1/x)',
  'cot(x) * x',
  'erfc(x)^2',
  'min(x, 1/x)',
  'max(sin(x), cos(x))',
  'hypot(x, 1/x)',
  'log(x, 2) + log(x)',
  'root(3, x) + root(2, x)',
  'choose(x, 2) + perm(x, 1)',
  'gcd(x, 4) + lcm(x, 2)',
  'sum(k = 1 to 4, prod(j = 1 to k, x + j))',
  'sum(i = 1 to 3, sum(j = 1 to i, x^j / j))',
  'prod(k = 1 to 3, {x < k: 1, 2})',
  // a counter starts at the bound itself: at a signed zero, the first term is of that sign
  'sum(i = x to 1, i^(-1))',
  'prod(i = x to 1, i^(-1))',
  'sum(i = x to 1, atan2(1, i))',
  // a bound that is one whole number where it is defined, and NaN elsewhere
  'sum(k = 1 to max(floor(sqrt(x)), 3), k)',
  'prod(k = max(floor(sqrt(x)), 1) to 3, k)',
  'integral(t = 0 to x, t^2) + 1',
  '{x = 0: 1, x != 0: x}',
  // a piece that is itself a piecewise, after one that gave +0: the union must remember it
  '{x < 0.5: 0, x < 2: {x < 7: x, 2}, 5}',
  '{x > -1: {x < 0.5: 0, -x}, {x < 7: x, 2}}',
  '{not x < 1: 1/x, 0}',
  '{sqrt(x) < 2: 1, 2}',
  '{ln(x) > 0 and x < 5: x, -x}',
  '{x > 0: ln(x)}',
]

describe('soundness over composite expressions of one variable', () => {
  for (const src of ONE_VARIABLE) it(src, () => sweep1(src))

  it('conditions that are not comparisons, and a comparison used as a number', () => {
    // the grammar writes only comparisons as the conditions of a piece, and a comparison only as one;
    // the kernel takes any expression as a condition, and a truth value is a number
    const x = variable('x')
    const pw = (...args: Expr[]) => call('__piecewise', ...args)
    sweep1(pw(x, p('1/x'), num(0)))
    sweep1(pw(p('1/x'), num(1), num(0)))
    sweep1(pw(p('sin(x)'), p('x'), p('-x')))
    sweep1(pw(p('floor(x)'), p('1/x'), num(7)))
    sweep1(pw(p('x * (x - 1)'), num(1)))
    sweep1(pw(p('ln(x)'), num(1), p('sqrt(x)'), num(2), num(3)))
    const lt = parseConditionString('x < 1')
    sweep1({ kind: 'binary', op: '-', left: { kind: 'binary', op: '*', left: lt, right: num(5) }, right: parseConditionString('x >= 2') })
    sweep1({ kind: 'binary', op: '/', left: num(1), right: parseConditionString('x < 1') })
    sweep1({ kind: 'binary', op: '*', left: parseConditionString('x < 0'), right: p('-1') })
    sweep1(call('__and', p('x'), p('1/x')))
    sweep1(call('__or', p('x'), p('sqrt(x)')))
    sweep1(call('__not', p('1/x')))
  })

  it('in degrees', () => {
    const deg = makeScope({ angle: 'degrees' })
    for (const src of ['sin(x)/x', 'tan(x) + sec(x)', 'asin(x/2) + atan(x)', 'atan2(x, x^2 - 1)', 'cot(x) + csc(x)', 'cos(x)^2 + sin(x)^2']) sweep1(src, deg)
  })

  it('with a user function, a constant and a parameter', () => {
    const scope = makeScope({
      functions: [['f', fn(['t'], 't^2 + 1')], ['g', fn(['t', 'u'], 't u')], ['k', fn([], '3')]],
      params: [['a', 2]],
    })
    sweep1('f(g(x, a)) - k(x + 1)', scope)
    sweep1("f'(x) * x", scope)
    sweep1("f''(x) + f'(x)/x", scope)
    sweep1('g(x, x) - g(1/x, 1/x)', scope)
    sweep1('a(x) + k(a) + a^k', scope)
    sweep1('x^(a/3)', scope)
    sweep1('sum(i = 1 to a + 1, f(i x))', scope)
  })

  it('with document names that collide with a function parameter', () => {
    const scope = makeScope({ params: [['a', 10], ['c', 3]], functions: [['f', fn(['a'], 'a(a + 1) * c')]] })
    for (const src of ['f(x)', "f'(x)", "f''(x)", 'f(x) + f(a)', "f'(x)/f(x)", "f'(a) * x"]) sweep1(src, scope)
    const kscope = makeScope({ functions: [['k', fn([], '5')], ['f', fn(['k'], 'k(k + 1)')]] })
    for (const src of ['f(x)', "f'(x)", 'k(x) + f(k)']) sweep1(src, kscope)
    const xscope = makeScope({ params: [['x', 10]], functions: [['g', fn(['x'], 'sin(x) * x(x + 1)')]] })
    for (const src of ["g'(x)", "g''(x) - g(x)"]) sweep1(src, xscope)
  })

  it('with a loop whose budget a parameter can break', () => {
    const scope = makeScope({ params: [['n', 5]] })
    const f = compileScalar(p('sum(k = 1 to n, x^k)'), ['x'], scope)
    const g = compileInterval(p('sum(k = 1 to n, x^k)'), ['x'], scope)
    const out = iv()
    const rand = mulberry32(99)
    for (const n of [0, 1, 5, 60, 100000, 100001, 3.5, Number.NaN, -4]) {
      scope.params.values[0] = n
      for (const [lo, hi] of [[0, 1], [-1, 1], [0.5, 0.5], [-0, 0], [2, 3]]) {
        g(out, lo, hi)
        for (const x of pointsOf(lo, hi, rand)) must(out, f(x), () => `n ${n} over [${lo}, ${hi}] at ${x}: ${f(x)} against ${show(out)}`)
      }
    }
  })
})

const TWO_VARIABLES = [
  'x y - sin(x + y)',
  'x^2 + y^2 - 4',
  'hypot(x, y) - 1',
  'max(x, y) - min(x, y)',
  'x/y',
  'atan2(y, x)',
  'x^y',
  'mod(x, y)',
  '(x y)/(x + y)',
  'sqrt(x) * sqrt(y) - sqrt(x y)',
  '{x < y: x, y}',
  '{x y > 1: 1/(x y), x + y}',
  'exp(-1/x) * y',
  'floor(x y) - x y',
  'sum(k = 1 to 3, x^k y)',
  'log(x, y)',
  'ln(x) y^(1/3)',
  'x(y + 1) - y(x + 1)',
]

describe('soundness over composite expressions of two variables', () => {
  for (const src of TWO_VARIABLES) it(src, () => sweep2(src))

  it('with a function of two parameters', () => {
    const scope = makeScope({ functions: [['g', fn(['t', 'u'], 't u + t/u')]] })
    for (const src of ['g(x, y)', 'g(y, x) - g(x, y)', 'g(x + y, x - y)']) sweep2(src, scope)
  })

  it('three variables', () => {
    const expr = p('x y z - x^2 + z/y')
    const f = compileScalar(expr, ['x', 'y', 'z'], plain)
    const g = compileInterval(expr, ['x', 'y', 'z'], plain)
    const rand = mulberry32(5)
    const out = iv()
    for (let i = 0; i < 200; i++) {
      const [bx, by, bz] = [randomBox(rand), randomBox(rand), randomBox(rand)]
      g(out, bx[0], bx[1], by[0], by[1], bz[0], bz[1])
      for (const x of few(bx[0], bx[1], rand)) for (const y of few(by[0], by[1], rand)) for (const z of few(bz[0], bz[1], rand)) must(out, f(x, y, z), () => `(${x}, ${y}, ${z}) against ${show(out)}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Random expressions against the scalar compile
// ---------------------------------------------------------------------------

describe('random expressions are sound against the scalar compile', () => {
  // Trees over every construct the compiler has a rule for (the built-ins, the reserved calls, user
  // functions, parameters, loops, derivatives), in scopes whose parameters include NaN, infinities and
  // zeros, over edge boxes with each zero end as both signs and at every point fuzzPoints gives:
  // strictly (an infinity needs its bound, a NaN needs PARTIAL or UNKNOWN) and with the zero-bound
  // invariant. A compile error must be the scalar compile's own.
  it('one variable', () => {
    const r = soundnessSweep(101, 2000)
    expect(r.failures).toEqual([])
    expect(r.compiled).toBeGreaterThan(1900)
    expect(r.checks).toBeGreaterThan(400_000)
  })

  it('two variables', () => {
    const r = soundnessSweep(202, 1500, { two: true })
    expect(r.failures).toEqual([])
    expect(r.compiled).toBeGreaterThan(1400)
    expect(r.checks).toBeGreaterThan(400_000)
  })

  it('a fixed seed gives the same sweep', () => {
    expect(soundnessSweep(7, 60)).toEqual(soundnessSweep(7, 60))
  })
})

// ---------------------------------------------------------------------------
// A CONTINUOUS verdict never covers a jump
// ---------------------------------------------------------------------------

// `admits` and `must` read values only, so a twin that said CONTINUOUS across floor's step, a piecewise
// seam or atan2's cut would pass every sweep above. That verdict is what a sampler connects across, so it
// is held here, by the scalar: for a box the twin calls CONTINUOUS, sample the scalar over it, bisect the
// widest gap down to adjacent doubles, and fail on a gap that stays wide and flat on both sides.
describe('a CONTINUOUS verdict never covers a jump', () => {
  // Boxes placed on the places these expressions jump: centres at the integers, the multiples of 0.7 and
  // of a half, and a quarter turn, each at four widths down to a few ulps, from either side and astride
  // (the astride ones off centre: a sample that lands exactly on sign's zero is a third value between its
  // two steps, and the search reads that as a spike, not a jump).
  const CENTRES = [0, 1, -1, 2, 0.7, 1.4, 0.5, 1.5, 2.5, -0.5, Math.PI / 2, 3]
  const PLACED: [number, number][] = []
  for (const c of CENTRES) {
    for (const w of [1e-12, 1e-6, 1e-3, 0.1]) PLACED.push([c - w, c + 0.37 * w], [c - 0.61 * w, c + w], [c - w, c], [c, c + w])
  }
  const SAMPLER: [number, number][] = []
  const rand = mulberry32(31)
  for (let i = 0; i < 150; i++) SAMPLER.push(samplerBox(rand))
  const BOXES = [...PLACED, ...SAMPLER]

  const JUMPING = [
    'floor(x)', 'ceil(x)', 'round(x)', 'sign(x)', 'step(x)', 'mod(x, 1)', 'mod(x, 0.7)', 'floor(x) + x', 'x - floor(x)', 'round(2x)/2',
    '{x < 1: 0, 1}', '{x < 1: x, x + 1}', '{x <= 0.5: x^2, 2 - x}', '{floor(x) < 1: x, 0}', '{x < 0: -1, x < 2: 1, 3}',
    'atan2(x, -1)', 'atan2(x - 1, -2)', 'atan2(sin(x), cos(x) - 2)',
    'min(floor(x), 1) + 0', 'sum(k = 1 to 3, floor(k x))', 'sqrt(x^2 + 1) * floor(x)',
  ]
  const SMOOTH = [
    'sin(x)', 'cos(x)', 'tan(x)', 'sec(x)', 'csc(x)', 'cot(x)', 'asin(x)', 'acos(x)', 'atan(x)', 'sinh(x)', 'cosh(x)', 'tanh(x)', 'asinh(x)',
    'acosh(x)', 'atanh(x)', 'sqrt(x)', 'abs(x)', 'exp(x)', 'ln(x)', 'log(x)', 'log(x, 2)', 'gamma(x)', 'erf(x)', 'erfc(x)', 'cbrt(x)',
    'x^(1/3)', 'x^(2/3)', 'x^2', 'x^3 - 2x', '1/x', 'x^x', 'hypot(x, 1)', 'min(x, 1)', 'max(x, 0.5)', 'abs(x - 1)', 'sqrt(x^2)', 'x!',
    'root(3, x)', 'x/(x^2 + 1)', 'exp(-x^2)', 'sin(x)/x', 'atan2(x, 2)', 'atan2(2, x)', '{x < 1: x, 2 - x}', '{x > 1: ln(x), 0}', 'sum(k = 1 to 4, x^k)',
    'sin(floor(x)) x',
  ]

  const run = (src: string, scope: MathScope = plain) => {
    const e = p(src)
    return { f: compileScalar(e, ['x'], scope), g: compileInterval(e, ['x'], scope) }
  }

  it('every expression that jumps is called DEFINED or weaker over a box on the jump', () => {
    for (const src of JUMPING) {
      const { f, g } = run(src)
      expect(continuityViolation(f, g, BOXES), src).toBeNull()
    }
  })

  it('the elementary functions and the smooth compositions are searched too, and many of their boxes are CONTINUOUS', () => {
    for (const src of SMOOTH) {
      const { f, g } = run(src)
      expect(continuityViolation(f, g, BOXES), src).toBeNull()
      const out = iv()
      let continuous = 0
      for (const [lo, hi] of BOXES) if (g(out, lo, hi).v === CONTINUOUS && Number.isFinite(f((lo + hi) / 2))) continuous++
      // a function undefined over most of the boxes (acosh, atanh) still has some: the search is not vacuous
      expect(continuous, src).toBeGreaterThan(5)
    }
  })

  it('the search is not vacuous: a twin that calls those boxes CONTINUOUS is caught on every jumping expression', () => {
    for (const src of JUMPING) {
      const { f, g } = run(src)
      const violation = continuityViolation(f, overclaims(g), BOXES)
      expect(violation, src).not.toBeNull()
    }
    // the case the review named: floor marked CONTINUOUS across an integer
    const { f, g } = run('floor(x)')
    const claimed: CompiledInterval = (out, lo, hi) => {
      g(out, lo, hi)
      out.v = CONTINUOUS
      return out
    }
    expect(continuityViolation(f, claimed, [[0.5, 1.5]])?.jump).toMatch(/^a jump between 0\.99999999999999\d+ and 1:/)
    // and a smooth function is not called a jump by it
    const s = run('x^2 + sin(x)')
    expect(continuityViolation(s.f, s.g, [[0.5, 1.5], [-3, 3]])).toBeNull()
  })

  it('findJump tells a jump from a pole, a steep curve and a staircase of roundings', () => {
    expect(findJump((x) => (x < 1 ? 0 : 1), 0.5, 1.5)).not.toBeNull()
    expect(findJump((x) => Math.floor(x * 4) / 4, 0.1, 0.6)).not.toBeNull()
    expect(findJump((x) => Math.tan(x), 1.5, 1.6)).toBeNull()
    expect(findJump((x) => 1 / x, -1, 1)).toBeNull()
    expect(findJump((x) => Math.tanh(1e6 * (x - 1)), 0.9, 1.1)).toBeNull()
    expect(findJump((x) => Math.sin(x), 0, 3)).toBeNull()
    // a staircase of many small steps, as erf near 1 makes: no step is most of what the curve moves
    expect(findJump((x) => Math.round(x * 1e6) / 1e6 + x, 0, 1)).toBeNull()
    // an infinite sample is overflow, which CONTINUOUS does not exclude
    expect(findJump((x) => (x < 1 ? 0 : Infinity), 0, 2)).toBeNull()
  })

  it('random expressions over sampler-sized boxes: no CONTINUOUS box holds a jump', () => {
    const r = continuitySweep(404, 3000)
    expect(r.failures).toEqual([])
    expect(r.compiled).toBeGreaterThan(2900)
    // the boxes the twin called CONTINUOUS and the scalar was searched over
    expect(r.checks).toBeGreaterThan(15_000)
  })

  it('and the random sweep is not vacuous either: overclaiming DEFINED as CONTINUOUS is caught', () => {
    const r = continuitySweep(404, 300, { wrap: overclaims })
    expect(r.failures.length).toBeGreaterThan(3)
    expect(r.failures[0]).toContain('is CONTINUOUS but has a jump')
  })
})

// ---------------------------------------------------------------------------
// Hand-built expressions the grammar does not write
// ---------------------------------------------------------------------------

describe('expressions built from nodes', () => {
  it('a call to a reserved name with the wrong shape is the scalar compile error', () => {
    expect(() => compileInterval(call('__lt', variable('x')), ['x'], plain)).toThrow(CompileError)
    expect(() => compileInterval(call('__not', variable('x'), variable('x')), ['x'], plain)).toThrow(CompileError)
    expect(() => compileInterval(call('__piecewise', variable('x')), ['x'], plain)).toThrow(CompileError)
  })

  it('box helper agrees with setBox', () => {
    expect(box(1, 2)).toEqual({ lo: 1, hi: 2, v: CONTINUOUS })
  })
})
