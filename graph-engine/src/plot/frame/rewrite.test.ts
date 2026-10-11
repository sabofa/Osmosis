import { describe, expect, it } from 'vitest'
import { compileScalar } from '../../math/compile'
import { num, variable } from '../../math/expr'
import { compare, piecewise } from '../../math/reserved'
import { makeScope } from '../../math/scope'
import { parseExprString } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { logOf, substituteVar, throughScales } from './rewrite'

const p = parseExprString
const scope = makeScope()
const run = (e: Expr, x: number, y: number) => compileScalar(e, ['x', 'y'], scope)(x, y)

// mulberry32, seeded
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function close(a: number, b: number) {
  if (Number.isNaN(a) || Number.isNaN(b)) return expect(Number.isNaN(a) && Number.isNaN(b)).toBe(true)
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))
}

const cases: [string, Expr][] = [
  ['x^3', p('x^3')],
  ['sin(x)*y', p('sin(x)*y')],
  ['ln(x) - y', p('ln(x) - y')],
  ['x*y', p('x*y')],
  ['abs(x) + 1', p('abs(x) + 1')],
  ['sum', p('sum(k = 1 to 5, k*x)')],
  ['sum with y bound', p('sum(y = 1 to 3, y*x)')],
  ['piecewise', piecewise([[compare('>', variable('x'), num(1)), p('y^2')]], p('x + y'))],
  ['nested call args', p('sqrt(abs(sin(x*y) + 2)) + exp(y/4)')],
]

describe('throughScales', () => {
  for (const [label, e] of cases) {
    it(`${label}: log/log, x-only and y-only agree with the original at (10^u, 10^v)`, () => {
      const next = rng(7)
      for (let i = 0; i < 50; i++) {
        const u = next() * 4 - 2
        const v = next() * 4 - 2
        close(run(throughScales(e, { x: 'log', y: 'log' }), u, v), run(e, 10 ** u, 10 ** v))
        close(run(throughScales(e, { x: 'log', y: 'linear' }), u, v), run(e, 10 ** u, v))
        close(run(throughScales(e, { x: 'linear', y: 'log' }), u, v), run(e, u, 10 ** v))
      }
    })
  }

  it('returns the identical object for linear/linear', () => {
    const e = p('x^2 + y')
    expect(throughScales(e, { x: 'linear', y: 'linear' })).toBe(e)
  })

  it('returns the identical object when the log variable does not occur', () => {
    const e = p('y^2')
    expect(throughScales(e, { x: 'log', y: 'linear' })).toBe(e)
  })

  it('honours custom variable names', () => {
    const e = p('t + 1')
    const g = compileScalar(throughScales(e, { x: 'log', y: 'linear' }, { x: 't', y: 's' }), ['t'], scope)
    close(g(2), 101)
  })
})

describe('substituteVar', () => {
  it('returns the identical object when the name does not occur', () => {
    const e = p('sin(x) + 2')
    expect(substituteVar(e, 'q', num(3))).toBe(e)
  })

  it('leaves a sum-bound name alone and substitutes the free one', () => {
    const e = p('sum(k = 1 to 5, k*x)')
    const r = substituteVar(e, 'k', num(100))
    expect(r).toBe(e)
    expect(compileScalar(substituteVar(e, 'x', num(2)), [], scope)()).toBe(30)
  })

  it('does not treat a call name as a variable', () => {
    const e = p('sin(x)')
    expect(substituteVar(e, 'sin', num(1))).toBe(e)
  })
})

describe('logOf', () => {
  it('is log10 of the compiled expression', () => {
    for (const [, e] of cases) {
      const next = rng(11)
      for (let i = 0; i < 10; i++) {
        const x = next() * 4 + 0.1
        const y = next() * 4 + 0.1
        close(run(logOf(e), x, y), Math.log10(run(e, x, y)))
      }
    }
  })
})
