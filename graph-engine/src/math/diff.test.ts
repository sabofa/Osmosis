import { describe, expect, it } from 'vitest'
import { parseExprString } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { compileScalar, CompileError } from './compile'
import { diff, gradient } from './diff'
import { countNodes } from './expr'
import { makeScope, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const p = parseExprString

function fn(params: string[], body: string): MathFunction {
  return { params, body: p(body) }
}

// d/dv of `text`, simplified and compiled over `vars`. Expected values are
// worked by hand from the calculus, never by finite differences of this code.
function derivative(text: string, v: string, vars: string[], scope: MathScope = makeScope()) {
  return compileScalar(simplify(diff(p(text), v, scope)), vars, scope)
}

describe('diff', () => {
  it('d/dx x^2 y^3 = 2x y^3 and d/dy = 3 x^2 y^2', () => {
    // 2*1*8 = 16; 3*1*4 = 12
    expect(derivative('x^2 * y^3', 'x', ['x', 'y'])(1, 2)).toBe(16)
    expect(derivative('x^2 * y^3', 'y', ['x', 'y'])(1, 2)).toBe(12)
  })

  it('d/dx sin(x y) = y cos(x y)', () => {
    // 1 * cos(pi/2) = 6.1e-17 (cos of the double nearest pi/2); 2 * cos(0) = 2
    expect(Math.abs(derivative('sin(x*y)', 'x', ['x', 'y'])(Math.PI / 2, 1))).toBeLessThan(1e-15)
    expect(derivative('sin(x*y)', 'x', ['x', 'y'])(0, 2)).toBe(2)
  })

  it('d/dx atan2(y, x) = -y / (x^2 + y^2)', () => {
    // -1 / 2
    expect(derivative('atan2(y, x)', 'x', ['x', 'y'])(1, 1)).toBe(-0.5)
    // d/dy = x / (x^2 + y^2) = 1/2
    expect(derivative('atan2(y, x)', 'y', ['x', 'y'])(1, 1)).toBe(0.5)
  })

  it('d/dx x^x = x^x (ln x + 1), by the general rule', () => {
    // at 1: 1 * (0 + 1); at 2: 4 * (ln 2 + 1)
    expect(derivative('x^x', 'x', ['x'])(1)).toBe(1)
    expect(derivative('x^x', 'x', ['x'])(2)).toBeCloseTo(6.772588722239781, 13)
  })

  it('d/dx x^3 at 0 is 0 and finite: the power rule, no ln(0)', () => {
    const d = derivative('x^3', 'x', ['x'])
    expect(d(0)).toBe(0)
    // 3 * 2^2
    expect(d(2)).toBe(12)
  })

  it('d/dx 2^x = 2^x ln 2', () => {
    expect(derivative('2^x', 'x', ['x'])(3)).toBeCloseTo(8 * Math.LN2, 14)
  })

  it('non-smooth built-ins differentiate almost everywhere', () => {
    expect(derivative('abs(x)', 'x', ['x'])(-2)).toBe(-1)
    expect(derivative('floor(x)', 'x', ['x'])(0.5)).toBe(0)
    expect(derivative('ceil(x)', 'x', ['x'])(0.5)).toBe(0)
    expect(derivative('round(3x)', 'x', ['x'])(0.1)).toBe(0)
    expect(derivative('sign(x)', 'x', ['x'])(0.5)).toBe(0)
    // mod(x, 3) = x - 3 floor(x/3): slope 1 away from the jumps
    expect(derivative('mod(x, 3)', 'x', ['x'])(0.5)).toBe(1)
    // mod(7, y) = 7 - y floor(7/y): slope -floor(7/y) = -2 at y = 3
    expect(derivative('mod(7, y)', 'y', ['y'])(3)).toBe(-2)
  })

  it('min and max select by sign', () => {
    // min(x^2, 3x) at x = 1: x^2 = 1 < 3, so the slope is 2x = 2
    expect(derivative('min(x^2, 3x)', 'x', ['x'])(1)).toBe(2)
    // at x = 4: 3x = 12 < 16, slope 3
    expect(derivative('min(x^2, 3x)', 'x', ['x'])(4)).toBe(3)
    expect(derivative('max(x^2, 3x)', 'x', ['x'])(1)).toBe(3)
    // three arguments: max(x, 2x, 3x) at x = 1 is 3x, slope 3
    expect(derivative('max(x, 2x, 3x)', 'x', ['x'])(1)).toBe(3)
  })

  it('hypot, sqrt, exp, ln, log', () => {
    // d/dx hypot(x, 4) = x / hypot(x, 4) = 3/5 at x = 3
    expect(derivative('hypot(x, 4)', 'x', ['x'])(3)).toBeCloseTo(0.6, 15)
    // 1 / (2 sqrt(4))
    expect(derivative('sqrt(x)', 'x', ['x'])(4)).toBe(0.25)
    expect(derivative('exp(2x)', 'x', ['x'])(0)).toBe(2)
    expect(derivative('ln(x)', 'x', ['x'])(4)).toBe(0.25)
    // 1 / (x ln 10) at x = 1
    expect(derivative('log(x)', 'x', ['x'])(1)).toBeCloseTo(1 / Math.LN10, 15)
    // log_2 x = ln x / ln 2: 1 / (x ln 2) at x = 1
    expect(derivative('log(x, 2)', 'x', ['x'])(1)).toBeCloseTo(1 / Math.LN2, 15)
  })

  it('trig, inverse trig and hyperbolics', () => {
    // d tan = sec^2: at 0, 1
    expect(derivative('tan(x)', 'x', ['x'])(0)).toBe(1)
    // d asin = 1/sqrt(1 - x^2): at 0, 1
    expect(derivative('asin(x)', 'x', ['x'])(0)).toBe(1)
    // d acos = -1/sqrt(1 - x^2)
    expect(derivative('acos(x)', 'x', ['x'])(0)).toBe(-1)
    // d atan = 1/(1 + x^2): at 1, 1/2
    expect(derivative('atan(x)', 'x', ['x'])(1)).toBe(0.5)
    // d sec = sec tan: at 0, 0; d cot = -csc^2: at pi/2, -1
    expect(derivative('sec(x)', 'x', ['x'])(0)).toBe(0)
    expect(derivative('cot(x)', 'x', ['x'])(Math.PI / 2)).toBe(-1)
    // d csc = -csc cot: at pi/2, -1 * cot(pi/2) ~ 0
    expect(Math.abs(derivative('csc(x)', 'x', ['x'])(Math.PI / 2))).toBeLessThan(1e-15)
    // d sinh = cosh; d cosh = sinh; d tanh = 1 - tanh^2
    expect(derivative('sinh(x)', 'x', ['x'])(0)).toBe(1)
    expect(derivative('cosh(x)', 'x', ['x'])(0)).toBe(0)
    expect(derivative('tanh(x)', 'x', ['x'])(0)).toBe(1)
    // d asinh = 1/sqrt(x^2 + 1); d acosh = 1/sqrt(x^2 - 1) (at 2: 1/sqrt 3);
    // d atanh = 1/(1 - x^2) (at 0.5: 4/3)
    expect(derivative('asinh(x)', 'x', ['x'])(0)).toBe(1)
    expect(derivative('acosh(x)', 'x', ['x'])(2)).toBeCloseTo(1 / Math.sqrt(3), 15)
    expect(derivative('atanh(x)', 'x', ['x'])(0.5)).toBeCloseTo(4 / 3, 15)
  })

  it('applies the chain rule through user functions: g(t) = f(t, 3t), g′(t) = 2t + 3', () => {
    const scope = makeScope({ functions: [['f', fn(['x', 'y'], 'x^2 + y')], ['g', fn(['t'], 'f(t, 3t)')]] })
    expect(derivative('g(t)', 't', ['t'], scope)(1)).toBe(5)
  })

  it('treats a parameter and a constant as constants', () => {
    const scope = makeScope({ params: [['a', 2]], functions: [['k', fn([], '5')]] })
    // d/dx (a x^2 + k) = 2 a x = 12 at x = 3
    expect(derivative('a*x^2 + k', 'x', ['x'], scope)(3)).toBe(12)
  })

  it('degrees: d/dx sin(x) = (pi/180) cos(x)', () => {
    const scope = makeScope({ angle: 'degrees' })
    expect(derivative('sin(x)', 'x', ['x'], scope)(0)).toBe(Math.PI / 180)
    // d/dx asin(x) = (180/pi) / sqrt(1 - x^2): at 0, 180/pi
    expect(derivative('asin(x)', 'x', ['x'], scope)(0)).toBe(180 / Math.PI)
  })

  it('refuses what compile refuses', () => {
    const scope = makeScope({ functions: [['r', { params: ['t'], body: [p('t'), p('t'), p('t')] }]] })
    expect(() => diff(p('r(x)'), 'x', scope)).toThrow(CompileError)
    expect(() => diff(p('frob(x)'), 'x', makeScope())).toThrow(/frob/)
    expect(() => diff(p('atan2(x)'), 'x', makeScope())).toThrow(/atan2/)
    const cyclic = makeScope({ functions: [['f', fn(['x'], 'g(x)')], ['g', fn(['x'], 'f(x)')]] })
    expect(() => diff(p('f(x)'), 'x', cyclic)).toThrow(CompileError)
  })

  it('gradient is the simplified partials in order', () => {
    // f = x^2 - y^2: grad (2x, -2y) = (2, -4) at (1, 2)
    const [fx, fy] = gradient(p('x^2 - y^2'), ['x', 'y'], makeScope())
    expect(compileScalar(fx, ['x', 'y'], makeScope())(1, 2)).toBe(2)
    expect(compileScalar(fy, ['x', 'y'], makeScope())(1, 2)).toBe(-4)
  })
})

describe('simplify', () => {
  const x: Expr = { kind: 'var', name: 'x' }

  it('0 + 1*x^1 is structurally x (the 1*a and a^1 rules)', () => {
    expect(simplify(p('0 + 1*x^1'))).toEqual(x)
  })

  it('x*1 - 0 is structurally x (the a*1 and a-0 rules)', () => {
    expect(simplify(p('x*1 - 0'))).toEqual(x)
  })

  it('folds literals: 2*3 + x*0 is 6', () => {
    expect(simplify(p('2*3 + x*0'))).toEqual({ kind: 'num', value: 6 })
  })

  it('-(-x) is x, and 0 - x is -x', () => {
    expect(simplify(p('-(-x)'))).toEqual(x)
    expect(simplify(p('0 - x'))).toEqual({ kind: 'unary', op: '-', arg: x })
    expect(simplify(p('0 - (-x)'))).toEqual(x)
  })

  it('x/1, x^0, 0*x', () => {
    expect(simplify(p('x/1'))).toEqual(x)
    expect(simplify(p('x^0'))).toEqual({ kind: 'num', value: 1 })
    expect(simplify(p('0*x'))).toEqual({ kind: 'num', value: 0 })
  })

  it('keeps pi and e symbolic', () => {
    expect(simplify(p('pi*2'))).toEqual(p('pi*2'))
    expect(simplify(p('e^1'))).toEqual({ kind: 'var', name: 'e' })
  })

  it('never reorders or factors', () => {
    expect(simplify(p('x*2*3'))).toEqual(p('x*2*3'))
    expect(simplify(p('x - x'))).toEqual(p('x - x'))
  })

  it('is idempotent on derivative outputs', () => {
    const scope = makeScope({ functions: [['f', fn(['x', 'y'], 'x^2 + y')]] })
    const samples = [
      'x^2 * y^3',
      'sin(x*y)',
      'atan2(y, x)',
      'x^x',
      'exp(-x^2) * cos(3x)',
      'sqrt(x^2 + y^2)',
      'f(x, x*y)',
      'min(x^2, y) + max(x, 2)',
      'log(x, 2) - ln(y)/x',
      '(x + 1)/(x - 1) + hypot(x, y, 1)',
    ]
    for (const text of samples) {
      for (const v of ['x', 'y']) {
        const once = simplify(diff(p(text), v, scope))
        expect(simplify(once)).toEqual(once)
      }
    }
  })

  it('shrinks the output of diff on a nested expression', () => {
    const raw = diff(p('sin(cos(x^2 + 1))'), 'x', makeScope())
    const simple = simplify(raw)
    expect(countNodes(simple)).toBeLessThan(countNodes(raw))
    // and the value is unchanged: d/dx = cos(cos(u)) * -sin(u) * 2x, u = x^2 + 1;
    // at x = 0 the factor 2x makes it 0
    expect(compileScalar(simple, ['x'], makeScope())(0) === 0).toBe(true)
  })
})
