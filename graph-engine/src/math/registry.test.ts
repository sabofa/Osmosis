import { describe, expect, it, vi } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { BUILTIN_NAMES, builtinArity, CompileError, compileScalar } from './compile'
import { diff } from './diff'
import { call, num, variable } from './expr'
import { BUILTIN_REGISTRY } from './registry'
import { makeScope } from './scope'
import { simplify } from './simplify'
import { box, chainSweep, fmt, must, pointsOf, show, withZeroSigns } from './interval/compose.testkit'
import { iv } from './interval/core'
import { mulberry32, pointsIn, randomBox } from './interval/testkit'

// The sweeps are a second or two on a quiet machine; the default 5 s is for a loaded one.
vi.setConfig({ testTimeout: 120_000 })

describe('the registry triple', () => {
  it('names exactly the built-ins, each with a twin', () => {
    expect([...BUILTIN_REGISTRY.keys()].sort()).toEqual([...BUILTIN_NAMES].sort())
    for (const [name, entry] of BUILTIN_REGISTRY) expect(typeof entry.twin, name).toBe('function')
  })

  it('classes every derivative as a rule or a refusal', () => {
    for (const [name, entry] of BUILTIN_REGISTRY) expect(['rule', 'refuses'], name).toContain(entry.derivative)
    // diff.ts refuses exactly these when an argument depends on the variable
    expect([...BUILTIN_REGISTRY].filter(([, e]) => e.derivative === 'refuses').map(([n]) => n).sort()).toEqual(['choose', 'gamma', 'gcd', 'lcm', 'perm'])
  })

  // Each argument position is differentiated in turn, the others held at
  // constants; 'refuses' throws a CompileError saying there is no rule, 'rule' agrees with a
  // central difference wherever the function is smooth there.
  const scope = makeScope()
  const rand = mulberry32(4242)

  const refusal = (expr: Expr): Error | undefined => {
    try {
      diff(expr, 'x', scope)
    } catch (err) {
      return err as Error
    }
    return undefined
  }
  const expectRefusal = (label: string, expr: Expr) => {
    const err = refusal(expr)
    expect(err, `${label} should be refused`).toBeInstanceOf(CompileError)
    expect(err!.message, label).toContain('No derivative rule')
  }
  const expectRule = (label: string, expr: Expr) => {
    const f = compileScalar(expr, ['x'], scope)
    const d = compileScalar(simplify(diff(expr, 'x', scope)), ['x'], scope)
    let checked = 0
    for (let i = 0; i < 200 && checked < 20; i++) {
      const x = (rand() * 2 - 1) * 3
      const h = 1e-6 * Math.max(1, Math.abs(x))
      const fd = (f(x + h) - f(x - h)) / (2 * h)
      const second = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
      // skip points where f is undefined, jumps, or bends too sharply for
      // a central difference to judge
      if (![f(x - h), f(x), f(x + h), d(x)].every(Number.isFinite) || Math.abs(second) * h > 1e-3 * Math.max(1, Math.abs(fd))) continue
      expect(Math.abs(d(x) - fd), `${label}'(${x}) = ${d(x)} vs ${fd}`).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(fd)))
      checked++
    }
    expect(checked, `${label}: too few smooth points to judge`).toBeGreaterThan(0)
  }

  // root(n, x) is NaN for a non-whole index, so its radicand is tested with a whole one.
  const CONSTANTS: Record<string, number[]> = { root: [3, 2] }
  for (const name of [...BUILTIN_NAMES].sort()) {
    it(`${name}: its derivative class holds`, () => {
      const entry = BUILTIN_REGISTRY.get(name)!
      const { min } = builtinArity(name)!
      const arity = Math.max(min, 1)
      const constants = (CONSTANTS[name] ?? [0.7, 2, 3]).slice(0, arity)
      for (let position = 0; position < arity; position++) {
        const args = constants.map((c, i) => (i === position ? variable('x') : p(String(c))))
        const expr = call(name, ...args)
        const label = `${name} position ${position}`
        // root's index must be constant in the variable: diff refuses it there.
        if (name === 'root' && position === 0) expectRefusal(label, expr)
        else if (entry.derivative === 'refuses') expectRefusal(label, expr)
        else expectRule(label, expr)
      }
    })
  }

  // The arities above the minimum: log(a, b) (the base is differentiated too), and min, max and
  // hypot of three arguments (diff folds the first two, and hypot sums over every argument).
  const EXTRA: [string, number[]][] = [['log', [2, 3]], ['min', [0.7, 2, -1]], ['max', [0.7, 2, -1]], ['hypot', [0.7, 2, 3]]]
  for (const [name, constants] of EXTRA) {
    it(`${name} of ${constants.length} arguments: its derivative rule holds at every position`, () => {
      expect(BUILTIN_REGISTRY.get(name)!.derivative).toBe('rule')
      expect(builtinArity(name)!.max).toBeGreaterThanOrEqual(constants.length)
      for (let position = 0; position < constants.length; position++) {
        const args = constants.map((c, i) => (i === position ? variable('x') : p(String(c))))
        expectRule(`${name}/${constants.length} position ${position}`, call(name, ...args))
      }
    })
  }

  it('refuses nothing it differentiates: a refusal needs an argument that depends on the variable', () => {
    // with constant arguments the derivative of a refused built-in is 0 (diff.ts), and x stays free
    for (const [name, entry] of BUILTIN_REGISTRY) {
      if (entry.derivative !== 'refuses') continue
      const { min } = builtinArity(name)!
      const args = [num(5), num(2)].slice(0, Math.max(min, 1))
      expect(() => diff(call(name, ...args), 'x', scope), name).not.toThrow()
    }
  })

  // The triple's glue: the twin the registry holds encloses the scalar the compile gives, for
  // every built-in, argument position by position (the others held at constants), over random
  // boxes and the signed zeros. The per-family test files go much deeper; this one catches a
  // twin wired to the wrong built-in or to the wrong argument.
  const ARGS: Record<string, number[]> = { root: [3, 2], log: [10, 10], choose: [5, 2], perm: [5, 2], gcd: [12, 18], lcm: [4, 6], atan2: [1, 1], mod: [7, 3], hypot: [3, 4], min: [1, 2], max: [1, 2] }
  for (const name of [...BUILTIN_NAMES].sort()) {
    it(`${name}: the twin encloses the scalar at every argument position`, () => {
      const entry = BUILTIN_REGISTRY.get(name)!
      const { min } = builtinArity(name)!
      const arity = Math.max(min, 1)
      const constants = (ARGS[name] ?? [2, 3]).slice(0, arity)
      const r = mulberry32(31 * name.length + name.charCodeAt(0))
      for (const angle of ['radians', 'degrees'] as const) {
        for (let position = 0; position < arity; position++) {
          const args = constants.map((c, i) => (i === position ? variable('x') : num(c)))
          const g = compileScalar(call(name, ...args), ['x'], makeScope({ angle }))
          for (let trial = 0; trial < 120; trial++) {
            const [lo, hi] = randomBox(r)
            for (const [l, h] of withZeroSigns(lo, hi)) {
              const out = iv()
              entry.twin(out, args.map((_, i) => (i === position ? box(l, h) : box(constants[i], constants[i]))), angle)
              for (const x of trial < 40 ? pointsOf(l, h, r, 3) : pointsIn(l, h, r, 4)) {
                const y = g(x)
                must(out, y, () => `${name}(${args.map((_, i) => (i === position ? 'x' : fmt(constants[i]))).join(', ')}) ${angle} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(out)}`)
              }
            }
          }
        }
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Random chains over every built-in: the registry holds every twin to the soundness of the
// others when they feed each other.
// ---------------------------------------------------------------------------

describe('random chains over every built-in', () => {
  const unary = [...BUILTIN_REGISTRY.keys()].filter((n) => builtinArity(n)!.min <= 1 && builtinArity(n)!.max >= 1 && !['root'].includes(n))
  const binary = ['atan2', 'log', 'mod', 'min', 'max', 'hypot', 'choose', 'perm', 'gcd', 'lcm']
  const POOL = { unary, binary, indexed: ['root'] }

  // A built-in added later arrives in the chains too: it is a one-argument call or it is named
  // here (this fails until it is, so a new built-in cannot dodge the chain sweep).
  it('every built-in is in a pool of the chain sweep', () => {
    expect(new Set([...unary, ...binary, 'root'])).toEqual(new Set(BUILTIN_NAMES))
    for (const n of binary) expect(builtinArity(n)!.max, n).toBeGreaterThanOrEqual(2)
    expect(unary).toContain('gamma')
    expect(unary).toContain('floor')
    expect(unary).toContain('erfc')
  })

  it('depth 2 and 3 over the edge boxes', () => chainSweep(20261201, 2500, true, POOL))
  it('depth 2 and 3 over random boxes', () => chainSweep(20261202, 5000, false, POOL))
})
