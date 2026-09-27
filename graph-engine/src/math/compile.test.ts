import { describe, expect, it } from 'vitest'
import { parseExprString } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { BUILTIN_NAMES, builtinArity, CompileError, compileMany, compileScalar, compileVector, freeVariablesDeep } from './compile'
import { makeScope, type MathFunction } from './scope'
import { evalExpr } from '../parser/evalExpr'

const p = parseExprString

function fn(params: string[], body: string): MathFunction {
  return { params, body: p(body) }
}

function value(text: string, angle: 'radians' | 'degrees' = 'radians'): number {
  return compileScalar(p(text), [], makeScope({ angle }))()
}

// Every expected value below is worked by hand from the definition of the
// function, not read off the code under test.
describe('built-ins in radians', () => {
  it('atan2(1, -1) is 3pi/4, in the second quadrant', () => {
    expect(value('atan2(1, -1)')).toBe(2.356194490192345)
  })

  it('sec, csc and cot are reciprocals', () => {
    expect(value('sec(0)')).toBe(1)
    expect(Math.abs(value('cot(pi/4)') - 1)).toBeLessThanOrEqual(1e-15)
    // csc(pi/2) = 1 / sin(pi/2) = 1
    expect(value('csc(pi/2)')).toBe(1)
  })

  it('hyperbolics and their inverses', () => {
    // sinh(1) = (e - 1/e) / 2
    expect(value('sinh(1)')).toBe(1.1752011936438014)
    expect(value('acosh(1)')).toBe(0)
    expect(value('tanh(0)')).toBe(0)
    expect(value('asinh(0)')).toBe(0)
  })

  it('hypot, min and max take two or more arguments', () => {
    // 3-4-5 then 5-12-13
    expect(value('hypot(3, 4, 12)')).toBe(13)
    expect(value('min(3, -1, 2)')).toBe(-1)
    expect(value('max(3, -1, 2)')).toBe(3)
    expect(value('min(4, 7)')).toBe(4)
  })

  it('mod is floor-mod, with the sign of the divisor', () => {
    // -1 - 3*floor(-1/3) = -1 - 3*(-1) = 2
    expect(value('mod(-1, 3)')).toBe(2)
    // 7 - (-3)*floor(7/-3) = 7 + 3*(-3) = -2
    expect(value('mod(7, -3)')).toBe(-2)
  })

  it('round goes half away from zero; floor, ceil, sign', () => {
    expect(value('round(-2.5)')).toBe(-3)
    expect(value('round(2.5)')).toBe(3)
    expect(value('floor(-0.5)')).toBe(-1)
    expect(value('ceil(-0.5)')).toBe(-0)
    expect(value('sign(-0.5)')).toBe(-1)
  })

  it('log(a, b) is the log of a in base b', () => {
    expect(value('log(8, 2)')).toBe(3)
    expect(value('log(1000)')).toBe(3)
  })

  it('inverse trig returns radians', () => {
    expect(value('asin(1)')).toBe(Math.PI / 2)
    expect(value('acos(-1)')).toBe(Math.PI)
    expect(value('atan(1)')).toBe(Math.PI / 4)
  })
})

describe('@angle: degrees', () => {
  it('trig takes degrees', () => {
    expect(Math.abs(value('sin(30)', 'degrees') - 0.5)).toBeLessThanOrEqual(1e-15)
    expect(Math.abs(value('cos(60)', 'degrees') - 0.5)).toBeLessThanOrEqual(1e-15)
  })

  it('inverse trig returns degrees', () => {
    expect(value('asin(1)', 'degrees')).toBe(90)
    expect(value('atan2(1, 1)', 'degrees')).toBe(45)
  })

  it('hyperbolics are not angles', () => {
    expect(value('sinh(1)', 'degrees')).toBe(1.1752011936438014)
  })
})

describe('bound variables', () => {
  it('x^2 - y^2 at (1, 2) is -3', () => {
    const f = compileScalar(p('x^2 - y^2'), ['x', 'y'], makeScope())
    expect(f(1, 2)).toBe(-3)
  })

  it('three variables', () => {
    const f = compileScalar(p('x*y - z'), ['x', 'y', 'z'], makeScope())
    // 2*3 - 4
    expect(f(2, 3, 4)).toBe(2)
  })

  it('a bound variable shadows a parameter of the same name', () => {
    const scope = makeScope({ params: [['t', 100]] })
    expect(compileScalar(p('t + 1'), ['t'], scope)(2)).toBe(3)
  })
})

describe('user functions', () => {
  it('inlines a two-parameter function through another: g(2) = f(2, 3) = 6', () => {
    const scope = makeScope({ functions: [['f', fn(['x', 'y'], 'x*y')], ['g', fn(['t'], 'f(t, t+1)')]] })
    expect(compileScalar(p('g(2)'), [], scope)()).toBe(6)
    expect(compileScalar(p('g(s)'), ['s'], scope)(2)).toBe(6)
  })

  it('reads a user constant', () => {
    const scope = makeScope({ functions: [['k', fn([], '2*pi')]] })
    expect(compileScalar(p('k/2'), [], scope)()).toBe(Math.PI)
  })

  it('evaluates each argument once, however often the body uses it', () => {
    // f uses its parameter four times. The argument reads parameter `a`, and
    // the parameter store counts its reads: substituting the argument into
    // the body would read it four times per call; a let-slot reads it once.
    let reads = 0
    const store = new Float64Array([3])
    const counted = new Proxy(store, {
      get(target, key) {
        if (key === '0') reads++
        return Reflect.get(target, key)
      },
    }) as Float64Array
    const scope = makeScope({ functions: [['f', fn(['x'], 'x*x*x*x')]] })
    const withCount = { ...scope, params: { index: new Map([['a', 0]]), values: counted } }
    const g = compileScalar(p('f(a + 1)'), [], withCount)
    reads = 0
    // (3 + 1)^4
    expect(g()).toBe(256)
    expect(reads).toBe(1)
  })

  it('refuses a cycle, naming both functions', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'g(x)')], ['g', fn(['x'], 'f(x)')]] })
    let caught: unknown = null
    try {
      compileScalar(p('f(1)'), [], scope)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CompileError)
    expect((caught as CompileError).names).toEqual(expect.arrayContaining(['f', 'g']))
    expect((caught as CompileError).message).toMatch(/f/)
    expect((caught as CompileError).message).toMatch(/g/)
  })

  it('a function body sees its own parameters, not the caller’s variables', () => {
    // y is free in f's body; the caller binding y must not leak into it.
    const scope = makeScope({ functions: [['f', fn(['x'], 'x + y')]] })
    expect(() => compileScalar(p('f(x)'), ['x', 'y'], scope)).toThrow(CompileError)
  })
})

describe('parameters', () => {
  it('reads the slot at call time: no recompile after a change', () => {
    const scope = makeScope({ params: [['a', 0]] })
    const f = compileScalar(p('a*x'), ['x'], scope)
    scope.params.values[0] = 3
    expect(f(2)).toBe(6)
    scope.params.values[0] = 5
    // the same closure object, re-read
    expect(f(2)).toBe(10)
  })
})

describe('compile errors happen at compile time', () => {
  it('an unknown variable names it', () => {
    let caught: unknown = null
    try {
      compileScalar(p('x + w'), ['x'], makeScope())
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CompileError)
    expect((caught as CompileError).names).toEqual(['w'])
    expect((caught as CompileError).message).toMatch(/"w"/)
  })

  it('an unknown function names it', () => {
    expect(() => compileScalar(p('frob(1)'), [], makeScope())).toThrow(/frob/)
  })

  it('a wrong argument count is an arity error', () => {
    const scope = makeScope({ functions: [['f', fn(['x', 'y'], 'x + y')]] })
    expect(() => compileScalar(p('f(1)'), [], scope)).toThrow(/takes 2/)
    expect(() => compileScalar(p('atan2(1)'), [], makeScope())).toThrow(/atan2/)
    expect(() => compileScalar(p('min(1)'), [], makeScope())).toThrow(/min/)
    expect(() => compileScalar(p('sin(1, 2)'), [], makeScope())).toThrow(/sin/)
  })

  it('a vector-valued function used as a number is refused', () => {
    const r: MathFunction = { params: ['t'], body: [p('cos(t)'), p('sin(t)'), p('t')] }
    const u: MathFunction = { params: [], body: [p('1'), p('2'), p('3')] }
    const scope = makeScope({ functions: [['r', r], ['u', u]] })
    expect(() => compileScalar(p('r(1) + 1'), [], scope)).toThrow(/vector/)
    expect(() => compileScalar(p('2*u'), [], scope)).toThrow(/vector/)
  })

  it('a function named without a call is refused', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'x')]] })
    expect(() => compileScalar(p('f + 1'), [], scope)).toThrow(/f/)
  })
})

describe('compileVector', () => {
  it('<cos t, sin t, t> at t = pi is (-1, ~0, pi)', () => {
    const exprs: [Expr, Expr, Expr] = [p('cos(t)'), p('sin(t)'), p('t')]
    const r = compileVector(exprs, ['t'], makeScope())
    const out = new Float64Array(3)
    r(out, Math.PI)
    expect(out[0]).toBe(-1)
    expect(Math.abs(out[1])).toBeLessThan(1e-15)
    expect(out[2]).toBe(Math.PI)
  })

  it('shares let-slots across components without crosstalk', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'x^2')]] })
    const r = compileVector([p('f(u)'), p('f(u + 1)'), p('f(2u)')], ['u'], scope)
    const out = new Float64Array(3)
    r(out, 3)
    expect([...out]).toEqual([9, 16, 36])
  })
})

describe('freeVariablesDeep', () => {
  it('follows user functions and constants, minus their own parameters', () => {
    const scope = makeScope({
      functions: [
        ['f', fn(['x', 'y'], 'a*x + y')],
        ['k', fn([], 'b + 1')],
      ],
    })
    expect([...freeVariablesDeep(p('f(x, y) + k'), scope)].sort()).toEqual(['a', 'b', 'x', 'y'])
  })

  it('removes only the top level’s bound names, not a body’s free names', () => {
    // f reads parameter t; the statement binds its own t. f's t is still free.
    const scope = makeScope({ functions: [['f', fn(['x'], 'x + t')]] })
    expect([...freeVariablesDeep(p('f(t)'), scope, new Set(['t']))]).toEqual(['t'])
    expect([...freeVariablesDeep(p('t*2'), scope, new Set(['t']))]).toEqual([])
  })

  it('leaves out pi and e, and survives a cycle', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'g(x) + pi')], ['g', fn(['x'], 'f(x) + e + c')]] })
    expect([...freeVariablesDeep(p('f(1)'), scope)]).toEqual(['c'])
  })
})

describe('fast paths compute exactly what the general closures do', () => {
  // Every operator with every operand shape the compiler reads inline (a
  // bound variable, a literal, a parameter) and a general node, checked
  // against the 2D evaluator (parser/evalExpr.ts), which is independent code
  // doing the same double operations.
  const operands = ['x', 'y', '2.5', 'a', 'sin(y)', '-x', 'pi']
  const ops = ['+', '-', '*', '/', '^']
  const points: [number, number][] = [
    [0.7, -1.3],
    [2, 3],
    [-0.4, 0.9],
  ]
  it('on every pair of operand shapes', () => {
    const scope = makeScope({ params: [['a', 1.7]] })
    let checked = 0
    for (const op of ops) {
      for (const l of operands) {
        for (const r of operands) {
          const text = `(${l}) ${op} (${r})`
          const f = compileScalar(p(text), ['x', 'y'], scope)
          for (const [x, y] of points) {
            expect(Object.is(f(x, y), evalExpr(p(text), { x, y, a: 1.7 }))).toBe(true)
            checked++
          }
        }
      }
    }
    expect(checked).toBe(5 * 7 * 7 * 3)
  })

  it('aliases an argument that is already a slot, in any order', () => {
    const scope = makeScope({
      functions: [
        ['f', fn(['x', 'y'], 'x - y')],
        ['g', fn(['t'], 'f(t, t + 1) * f(t + 1, t)')],
      ],
    })
    // f(y, x) at (1, 5) = 5 - 1
    expect(compileScalar(p('f(y, x)'), ['x', 'y'], scope)(1, 5)).toBe(4)
    // g(3) = f(3, 4) * f(4, 3) = (-1) * 1
    expect(compileScalar(p('g(3)'), [], scope)()).toBe(-1)
    expect(compileScalar(p('g(s)'), ['s'], scope)(3)).toBe(-1)
  })
})

describe('hypot does not overflow (fix round 1, M6)', () => {
  it('hypot(1e200, 1e200) = sqrt(2) 1e200, finite', () => {
    const h = value('hypot(10^200, 10^200)')
    expect(Number.isFinite(h)).toBe(true)
    expect(h / 1e200).toBeCloseTo(Math.SQRT2, 14)
  })

  it('and with four arguments: hypot(1, 2, 2, 4) = 5', () => {
    expect(value('hypot(1, 2, 2, 4)')).toBe(5)
    expect(Number.isFinite(value('hypot(10^200, 10^200, 10^200, 10^200)'))).toBe(true)
  })
})

describe('compileMany: several outputs in one frame, shared subexpressions once (fix round 1, I2)', () => {
  it('gives exactly what each compiled alone gives', () => {
    const scope = makeScope({
      params: [['a', 1.3]],
      functions: [['f', fn(['x', 'y'], 'x^2 - y')]],
    })
    const texts = ['a cos(u) sin(v)', '-a sin(u) sin(v)', 'a cos(u) cos(v)', 'f(cos(u), sin(v)) + cos(u)', 'hypot(a cos(u), sin(v), 2)', 'cos(u)']
    const many = compileMany(texts.map(p), ['u', 'v'], scope)
    const alone = texts.map((t) => compileScalar(p(t), ['u', 'v'], scope))
    const out = new Float64Array(texts.length)
    for (const [u, v] of [
      [0.3, 1.1],
      [2.9, -0.4],
      [0, Math.PI],
    ]) {
      many(out, u, v)
      texts.forEach((_, i) => expect(Object.is(out[i], alone[i](u, v))).toBe(true))
    }
  })

  it('in degrees too', () => {
    const scope = makeScope({ angle: 'degrees' })
    const many = compileMany([p('sin(t)'), p('sin(t) * 2')], ['t'], scope)
    const out = many(new Float64Array(2), 30)
    expect(out[1]).toBe(2 * out[0])
    expect(Math.abs(out[0] - 0.5)).toBeLessThanOrEqual(1e-15)
  })

  it('computes a subexpression shared across outputs once', () => {
    // "a*u" appears in all three outputs; with sharing the parameter store is
    // read once per call, without it three times.
    let reads = 0
    const store = new Float64Array([2])
    const counted = new Proxy(store, {
      get(target, key) {
        if (key === '0') reads++
        return Reflect.get(target, key)
      },
    }) as Float64Array
    const scope = { ...makeScope(), params: { index: new Map([['a', 0]]), values: counted } }
    const many = compileMany([p('sin(a*u)'), p('cos(a*u)'), p('a*u + 1')], ['u'], scope)
    const out = new Float64Array(3)
    reads = 0
    many(out, 0.5)
    expect(reads).toBe(1)
    // a*u once, then sin, cos and + 1: four instructions (six if a*u were
    // computed for each output)
    expect(many.instructions).toBe(4)
    // 2 * 0.5 = 1
    expect([...out]).toEqual([Math.sin(1), Math.cos(1), 2])
  })

  it('keeps 0 and -0 apart', () => {
    const zero: Expr = { kind: 'num', value: 0 }
    const negativeZero: Expr = { kind: 'num', value: -0 }
    const x: Expr = { kind: 'var', name: 'x' }
    const exprs: Expr[] = [
      { kind: 'binary', op: '*', left: x, right: zero },
      { kind: 'binary', op: '*', left: x, right: negativeZero },
    ]
    const out = compileMany(exprs, ['x'], makeScope())(new Float64Array(2), 3)
    expect(Object.is(out[0], 0)).toBe(true)
    expect(Object.is(out[1], -0)).toBe(true)
  })
})

describe('compileMany is exact on everything compileScalar compiles (fix round 1, I2)', () => {
  it('every operator on every operand shape, all in one program, against the 2D evaluator', () => {
    const operands = ['x', 'y', '2.5', 'a', 'sin(y)', '-x', 'pi']
    const texts: string[] = []
    for (const op of ['+', '-', '*', '/', '^']) for (const l of operands) for (const r of operands) texts.push(`(${l}) ${op} (${r})`)
    const scope = makeScope({ params: [['a', 1.7]] })
    const many = compileMany(texts.map(p), ['x', 'y'], scope)
    const out = new Float64Array(texts.length)
    for (const [x, y] of [
      [0.7, -1.3],
      [2, 3],
      [-0.4, 0.9],
    ]) {
      many(out, x, y)
      texts.forEach((t, i) => expect(Object.is(out[i], evalExpr(p(t), { x, y, a: 1.7 }))).toBe(true))
    }
  })

  for (const angle of ['radians', 'degrees'] as const) {
    it(`every built-in, in ${angle}, against compileScalar`, () => {
      const scope = makeScope({
        angle,
        params: [['a', 0.35]],
        functions: [
          ['f', fn(['s', 't'], 's*t - a')],
          ['k', fn([], '2a')],
        ],
      })
      const texts = [
        'sin(x)', 'cos(x)', 'tan(x)', 'sec(x)', 'csc(x)', 'cot(x)',
        'asin(y)', 'acos(y)', 'atan(y)', 'atan2(y, x)',
        'sinh(x)', 'cosh(x)', 'tanh(x)', 'asinh(x)', 'acosh(x + 2)', 'atanh(y)',
        'sqrt(x)', 'abs(-x)', 'exp(x)', 'ln(x)', 'log(x)', 'log(x, 3)',
        'floor(x*7)', 'ceil(x*7)', 'round(x*7)', 'sign(y - 0.5)', 'mod(x*7, 3)', 'mod(-x, 2)',
        'min(x, y)', 'max(x, y, a)', 'min(x, y, a, k)', 'hypot(x, y)', 'hypot(x, y, a)', 'hypot(x, y, a, k)',
        'f(x, y) + f(y, x)', 'f(f(x, y), k)', 'k*x', '-(-x)', 'x^y', 'e^x',
      ]
      const many = compileMany(texts.map(p), ['x', 'y'], scope)
      const alone = texts.map((t) => compileScalar(p(t), ['x', 'y'], scope))
      const out = new Float64Array(texts.length)
      for (const [x, y] of [
        [0.3, 0.6],
        [1.9, -0.25],
        [0.05, 0.99],
      ]) {
        many(out, x, y)
        texts.forEach((t, i) => {
          if (!Object.is(out[i], alone[i](x, y))) throw new Error(`${t} at (${x}, ${y}): ${out[i]} vs ${alone[i](x, y)}`)
        })
      }
    })
  }

  it('refuses what compileScalar refuses', () => {
    const scope = makeScope({ functions: [['f', fn(['x'], 'g(x)')], ['g', fn(['x'], 'f(x)')]] })
    expect(() => compileMany([p('w')], ['x'], makeScope())).toThrow(/"w"/)
    expect(() => compileMany([p('f(x)')], ['x'], scope)).toThrow(CompileError)
    expect(() => compileMany([p('atan2(x)')], ['x'], makeScope())).toThrow(/atan2/)
  })

  it('reads a parameter at call time', () => {
    const scope = makeScope({ params: [['a', 1]] })
    const many = compileMany([p('a*x')], ['x'], scope)
    scope.params.values[0] = 4
    expect(many(new Float64Array(1), 2)[0]).toBe(8)
  })
})

describe('freeVariablesDeep walks each function once (fix round 2)', () => {
  it('a 2-call nesting 20 deep is walked in linear time', () => {
    // f_k(s, t) = f_{k+1}(s, t) + f_{k+1}(t, s) + a; walking each call site
    // would visit 2^20 bodies.
    const functions: [string, MathFunction][] = [['f21', fn(['s', 't'], 's * t + b')]]
    for (let k = 20; k >= 1; k--) functions.push([`f${k}`, fn(['s', 't'], `f${k + 1}(s, t) + f${k + 1}(t, s) + a`)])
    const scope = makeScope({ functions })
    const t0 = performance.now()
    const names = freeVariablesDeep(p('f1(x, y)'), scope)
    expect(performance.now() - t0).toBeLessThan(20)
    expect([...names].sort()).toEqual(['a', 'b', 'x', 'y'])
  }, 30000)
})

describe('compileMany covers every registered built-in (fix round 2, item 3)', () => {
  // Iterates the registry, not a hand list: a built-in added to the compiler
  // without an instruction in the register program fails here.
  const args = ['x', 'y', '0.7', 'a']
  for (const angle of ['radians', 'degrees'] as const) {
    it(`every name in BUILTIN_NAMES, at every arity up to 4, in ${angle}`, () => {
      const scope = makeScope({ angle, params: [['a', 0.35]] })
      const texts: string[] = []
      for (const name of BUILTIN_NAMES) {
        const arity = builtinArity(name)!
        for (let n = arity.min; n <= Math.min(arity.max, 4); n++) texts.push(`${name}(${args.slice(0, n).join(', ')})`)
      }
      expect(texts.length).toBeGreaterThanOrEqual(BUILTIN_NAMES.size)
      const many = compileMany(texts.map(p), ['x', 'y'], scope)
      const alone = texts.map((t) => compileScalar(p(t), ['x', 'y'], scope))
      const out = new Float64Array(texts.length)
      for (const [x, y] of [
        [0.3, 0.6],
        [1.9, -0.25],
      ]) {
        many(out, x, y)
        texts.forEach((t, i) => {
          if (!Object.is(out[i], alone[i](x, y))) throw new Error(`${t} at (${x}, ${y}): ${out[i]} vs ${alone[i](x, y)}`)
        })
      }
    })
  }
})
