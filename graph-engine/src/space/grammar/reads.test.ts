// What the grammar's dependency checks see: a variable, and also a name that
// calc reads as a factor, x(1) = x * 1 (math/compile.ts). Without it the
// grammar saw "y in [0, x(1)]" as constant and put y outside x.

import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../parser/parseExpr'
import { parseOverDomain } from './domain'
import { parseSpaceKeyword } from './keyword'
import { readNames } from './reads'
import type { SpaceForm } from './types'

const p = parseExprString
const names = (text: string, calling: string[]) => [...readNames(p(text), calling)].sort()

describe('readNames', () => {
  it('counts a variable, and a one-argument call of a name asked about, as a read of it', () => {
    expect(names('x + y', ['x'])).toEqual(['x', 'y'])
    expect(names('x(1) + y', ['x'])).toEqual(['x', 'y'])
    expect(names('x(2) + 1', ['x', 'y'])).toEqual(['x'])
    expect(names('y(x + 1)', ['y'])).toEqual(['x', 'y'])
  })

  it('does not count a call of a name it was not asked about, or a built-in, or a call of two arguments', () => {
    expect(names('x(1) + 1', ['y'])).toEqual([])
    expect(names('f(x)', ['x'])).toEqual(['x'])
    expect(names('sin(1)', ['sin'])).toEqual([])
    expect(names('x(1, 2)', ['x'])).toEqual([])
  })

  it('adds to a set it is given', () => {
    const into = new Set(['a'])
    expect(readNames(p('x(1)'), ['x'], into)).toBe(into)
    expect([...into].sort()).toEqual(['a', 'x'])
  })
})

function iterated(text: string): Extract<ReturnType<typeof parseOverDomain>, { kind: 'iterated' }> {
  const domain = parseOverDomain(text)
  if (domain.kind !== 'iterated') throw new Error('expected an iterated domain')
  return domain
}

describe('a bound that writes the other variable as a factor reads it, in either order', () => {
  it('over y in [0, x(1)], x in [0, 1] has x outside, as over y in [0, x*1], x in [0, 1] does', () => {
    for (const text of ['y in [0, x(1)], x in [0, 1]', 'x in [0, 1], y in [0, x(1)]', 'y in [0, x*1], x in [0, 1]']) {
      const domain = iterated(text)
      expect([domain.outer.param, domain.inner.param], text).toEqual(['x', 'y'])
    }
  })

  it('and when each reads the other, it is refused: x in [0, y(1)], y in [0, x(1)]', () => {
    expect(() => parseOverDomain('x in [0, y(1)], y in [0, x(1)]')).toThrow(/depend on each other/)
  })
})

function volume(text: string): Extract<SpaceForm, { form: 'volume' }> {
  const statement = parseSpaceKeyword(text)
  if (statement?.kind !== 'space' || statement.form.form !== 'volume') throw new Error('expected a volume')
  return statement.form
}

describe('a triple integral orders its ranges by what the bounds read, calls included', () => {
  it('volume: y in [0, x(1)], x in [0, 1], z in [0, 1] is x, then y, then z', () => {
    for (const text of ['volume: y in [0, x(1)], x in [0, 1], z in [0, 1]', 'volume: x in [0, 1], y in [0, x(1)], z in [0, 1]']) {
      const solid = volume(text).solid
      if (solid.kind !== 'iterated') throw new Error('expected an iterated solid')
      expect(solid.order.map((r) => r.param), text).toEqual(['x', 'y', 'z'])
    }
  })

  it('a bound that reads itself through a call is refused: x in [0, x(1)]', () => {
    expect(() => volume('volume: x in [0, x(1)], y in [0, 1], z in [0, 1]')).toThrow(/the bounds of x read x itself/)
  })

  it('a foreign coordinate named through a call is refused in cylindrical coordinates: z in [0, y(1)]', () => {
    expect(() => volume('volume: r in [0, 1], theta in [0, 2*pi], z in [0, y(1)] cylindrical')).toThrow(/not y — the bounds of z read y/)
  })
})
