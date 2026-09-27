import { describe, expect, it } from 'vitest'
import { parseExprString } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { compileScalar, CompileError } from './compile'
import { diff, differentiationSteps, gradient } from './diff'
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

describe('diff composes user functions (fix round 1, C1)', () => {
  const f = fn(['x'], 'x^2')

  it('d/dx f(f(x)) = 4x^3 with f = x^2: 32 at x = 2', () => {
    // f(f(x)) = x^4
    const scope = makeScope({ functions: [['f', f]] })
    expect(derivative('f(f(x))', 'x', ['x'], scope)(2)).toBe(32)
  })

  it('three deep: d/dx f(f(f(x))) = 8x^7, 8 at x = 1', () => {
    const scope = makeScope({ functions: [['f', f]] })
    expect(derivative('f(f(f(x)))', 'x', ['x'], scope)(1)).toBe(8)
  })

  it('d/dx f(g(x)) with g = f + 1 = 2(x^2 + 1) * 2x: 40 at x = 2', () => {
    // g calls f, and f's argument is g: not a cycle
    const scope = makeScope({ functions: [['f', f], ['g', fn(['x'], 'f(x) + 1')]] })
    expect(derivative('f(g(x))', 'x', ['x'], scope)(2)).toBe(40)
  })

  it('still refuses a genuine cycle, naming both', () => {
    const cyclic = makeScope({ functions: [['f', fn(['x'], 'g(x) + 1')], ['g', fn(['x'], 'f(x) * 2')]] })
    let caught: unknown = null
    try {
      diff(p('f(x)'), 'x', cyclic)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CompileError)
    expect((caught as CompileError).names).toEqual(expect.arrayContaining(['f', 'g']))
  })
})

describe('diff with respect to a parameter follows constants and bodies (fix round 1, M3)', () => {
  const scope = makeScope({ params: [['a', 3]], functions: [['k', fn([], '2a')], ['f', fn(['x'], 'a*x')]] })

  it('k = 2a: d/da k = 2', () => {
    expect(derivative('k', 'a', [], scope)()).toBe(2)
  })

  it('d/da (k * a) = 2a + k = 4a: 12 at a = 3', () => {
    expect(derivative('k*a', 'a', [], scope)()).toBe(12)
  })

  it('f(x) = a x: d/da f(3) = 3', () => {
    expect(derivative('f(3)', 'a', [], scope)()).toBe(3)
  })

  it('a constant is still constant in a bound variable', () => {
    expect(derivative('k*x', 'x', ['x'], scope)(5)).toBe(6)
  })

  it('refuses a cycle among constants', () => {
    const loop = makeScope({ functions: [['m', fn([], 'n + 1')], ['n', fn([], 'm')]] })
    expect(() => diff(p('m'), 'x', loop)).toThrow(CompileError)
  })
})

describe('diff stays small on nested definitions (fix round 2, item 2)', () => {
  // f_k(s, t) = f_{k+1}(s, t) + f_{k+1}(t, s) for k = 1..7, f_8(s, t) = s^2 t.
  // By hand: f_7 = s^2 t + t^2 s, and each level doubles, so
  // f_1 = 64 (s^2 t + s t^2); d f_1/ds = 64 (2st + t^2), d f_1/dt = 64 (s^2 + 2st).
  const functions: [string, MathFunction][] = [['f8', fn(['s', 't'], 's^2 * t')]]
  for (let k = 7; k >= 1; k--) functions.push([`f${k}`, fn(['s', 't'], `f${k + 1}(s, t) + f${k + 1}(t, s)`)])
  const scope = makeScope({ functions })

  it('depth 7: under 50k nodes before simplify, under 50 ms, with the hand-computed values', () => {
    const t0 = performance.now()
    const before = differentiationSteps()
    const dx = diff(p('f1(x, y)'), 'x', scope)
    const dy = diff(p('f1(x, y)'), 'y', scope)
    const elapsed = performance.now() - t0
    // 109 steps for d/dx, fewer for d/dy (the partials are cached by then);
    // uncached, d/dx alone is 4.5 million
    expect(differentiationSteps() - before).toBeLessThan(1000)
    expect(countNodes(dx)).toBeLessThan(50000)
    expect(countNodes(dy)).toBeLessThan(50000)
    expect(elapsed).toBeLessThan(50)
    const fx = compileScalar(simplify(dx), ['x', 'y'], scope)
    const fy = compileScalar(simplify(dy), ['x', 'y'], scope)
    // at (2, 1): 64 (4 + 1) = 320 and 64 (4 + 4) = 512; at (1, 2): 64 (4 + 4) = 512 and 64 (1 + 4) = 320
    expect(fx(2, 1)).toBe(320)
    expect(fy(2, 1)).toBe(512)
    expect(fx(1, 2)).toBe(512)
    expect(fy(1, 2)).toBe(320)
  }, 30000)

  it('names the cycle path, as compile does', () => {
    const cyclic = makeScope({ functions: [['f', fn(['x'], 'g(x) + 1')], ['g', fn(['x'], 'f(x) * 2')]] })
    expect(() => diff(p('f(x)'), 'x', cyclic)).toThrow('"f" and "g" are defined in terms of each other (f → g → f)')
  })
})

describe('diff stays linear in the nesting when v is not read by the bodies (fix round 2, item 2)', () => {
  // The same family at depth 12: f_1 = 2^11 (s^2 t + s t^2). Its derivative
  // is 40,965 nodes when expanded; skipping the bodies' own reads of x (they
  // have none) is what keeps it near 10 ms rather than ~150 ms.
  const functions: [string, MathFunction][] = [['f13', fn(['s', 't'], 's^2 * t')]]
  for (let k = 12; k >= 1; k--) functions.push([`f${k}`, fn(['s', 't'], `f${k + 1}(s, t) + f${k + 1}(t, s)`)])

  it('depth 12 in linear work and under 50k nodes, with the hand-computed values', () => {
    // Work is counted, not timed: wall time under a loaded test run is not a
    // measure. Linear here is 179 steps; without the skip it is 225,072.
    const scope = makeScope({ functions })
    const before = differentiationSteps()
    const dx = diff(p('f1(x, y)'), 'x', scope)
    expect(differentiationSteps() - before).toBeLessThan(1000)
    expect(countNodes(dx)).toBeLessThan(50000)
    // 2048 (2st + t^2) at (2, 1) = 2048 * 5; at (1, 2) = 2048 * 8
    const fx = compileScalar(simplify(dx), ['x', 'y'], scope)
    expect(fx(2, 1)).toBe(10240)
    expect(fx(1, 2)).toBe(16384)
  }, 30000)
})
