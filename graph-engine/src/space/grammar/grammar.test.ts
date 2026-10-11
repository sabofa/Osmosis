import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../parser/parseExpr'
import { parseSpaceKeyword } from './keyword'
import type { SpaceForm, SpaceStyle } from './types'
import { parseSpaceUnkeyed } from './unkeyed'

const p = parseExprString

const NO_STYLE: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }

function form(line: string): SpaceForm {
  const statement = parseSpaceKeyword(line) ?? parseSpaceUnkeyed(line)
  if (!statement) throw new Error(`not claimed: ${line}`)
  expect(statement.kind).toBe('space')
  expect(statement.color).toBeNull()
  expect(statement.statementName).toBeNull()
  return statement.form
}

describe('K5.1 — multi-parameter functions', () => {
  it('f(x, y) = x^2 - y^2', () => {
    expect(form('f(x, y) = x^2 - y^2')).toEqual({ form: 'function', name: 'f', params: ['x', 'y'], body: p('x^2 - y^2') })
  })

  it('three parameters', () => {
    expect(form('g(x, y, z) = x y z')).toEqual({ form: 'function', name: 'g', params: ['x', 'y', 'z'], body: p('x y z') })
  })
})

describe('K5.2 — vector functions', () => {
  it('F(x, y, z) = <-y, x, 0>', () => {
    expect(form('F(x, y, z) = <-y, x, 0>')).toEqual({
      form: 'vectorFunction',
      name: 'F',
      params: ['x', 'y', 'z'],
      body: [p('-y'), p('x'), p('0')],
    })
  })

  it('r(t) = ⟨cos(t), sin(t), t/4⟩, with the Unicode brackets', () => {
    expect(form('r(t) = ⟨cos(t), sin(t), t/4⟩')).toEqual({
      form: 'vectorFunction',
      name: 'r',
      params: ['t'],
      body: [p('cos(t)'), p('sin(t)'), p('t/4')],
    })
  })

  it('r(t) = (cos(t), sin(t), t): a tuple on a one-parameter definition', () => {
    expect(form('r(t) = (cos(t), sin(t), t)')).toEqual({
      form: 'vectorFunction',
      name: 'r',
      params: ['t'],
      body: [p('cos(t)'), p('sin(t)'), p('t')],
    })
  })
})

describe('K5.3 — vector constants', () => {
  it('u = <1, 2, 3>', () => {
    expect(form('u = <1, 2, 3>')).toEqual({ form: 'vectorFunction', name: 'u', params: [], body: [p('1'), p('2'), p('3')] })
  })

  it('u = ⟨1, 2, 3⟩', () => {
    expect(form('u = ⟨1, 2, 3⟩')).toMatchObject({ form: 'vectorFunction', name: 'u', params: [] })
  })
})

describe("K5 — one of calc's ten new built-in names may be a definition's (calc ruling, 2026-10-02)", () => {
  it('a vector constant and a vector function: gamma = <1, 2, 3>, step(x) = <x, 0, 0>', () => {
    expect(form('gamma = <1, 2, 3>')).toEqual({ form: 'vectorFunction', name: 'gamma', params: [], body: [p('1'), p('2'), p('3')] })
    expect(form('step(x) = <x, 0, 0>')).toMatchObject({ form: 'vectorFunction', name: 'step', params: ['x'] })
  })

  it('a scalar definition whose right side reads every parameter: gcd(a, b) = a*b, root(x, n) = x^(1/n)', () => {
    expect(form('gcd(a, b) = a*b')).toEqual({ form: 'function', name: 'gcd', params: ['a', 'b'], body: p('a*b') })
    expect(form('root(x, n) = x^(1/n)')).toMatchObject({ form: 'function', name: 'root', params: ['x', 'n'] })
    expect(form('choose(x, k) = x*k')).toMatchObject({ form: 'function', name: 'choose' })
    // a one-argument call of a parameter is a product, so it is a read
    expect(form('lcm(a, b) = a(2) + b')).toMatchObject({ form: 'function', name: 'lcm' })
  })

  it('but one whose right side leaves a parameter unread is an equation, as it always was: choose(x, k) = 3', () => {
    for (const line of ['choose(x, k) = 3', 'root(x, n) = 1', 'choose(x, k) = k', 'gcd(a, b) = a']) {
      expect(parseSpaceUnkeyed(line), line).toBeNull()
    }
    // with a z it is the implicit surface it always was, not a definition of perm
    expect(form('perm(x, y, z) = x + y')).toMatchObject({ form: 'implicitSurface', forced: false })
  })

  it('and one whose parameters are all coordinates is never a definition, even when it reads them all: lcm(x, y) = x*y, gcd(x, y) = x + y - 1', () => {
    for (const line of ['lcm(x, y) = x*y', 'gcd(x, y) = x + y - 1', 'choose(y, x) = x*y']) {
      expect(parseSpaceUnkeyed(line), line).toBeNull()
    }
    expect(form('perm(x, y, z) = x*y*z')).toMatchObject({ form: 'implicitSurface', forced: false })
    expect(form('root(x, y) = x*y + z')).toMatchObject({ form: 'implicitSurface', forced: false })
    // but one coordinate among other parameters still defines
    expect(form('gcd(x, b) = x*b')).toMatchObject({ form: 'function', name: 'gcd', params: ['x', 'b'] })
  })

  it("a classic built-in is never a definition's name, whatever it reads: max(x, a) = 2, log(x, b) = y, min(x, a) = 1", () => {
    for (const line of ['max(x, a) = 2', 'log(x, b) = y', 'min(x, a) = 1', 'hypot(a, b) = a*b', 'mod(a, b) = a + b', 'sin(a, b) = a*b', 'sin(x) = <x, 0, 0>', 'sin(t) = <t, 0, 0>', 'cos = <1, 2, 3>']) {
      expect(parseSpaceUnkeyed(line), line).toBeNull()
    }
    // an equation with a z is claimed, as the implicit surface it is
    expect(form('atan2(y, k) = z')).toMatchObject({ form: 'implicitSurface', forced: false })
  })

  it('a one-parameter scalar definition stays the shared parser\'s functionDef: step(x) = x^2 is not claimed', () => {
    expect(parseSpaceUnkeyed('step(x) = x^2')).toBeNull()
  })

  it('pi and e are never a definition\'s name', () => {
    expect(parseSpaceUnkeyed('pi(a, b) = a + b')).toBeNull()
    expect(parseSpaceUnkeyed('e(a, b) = a + b')).toBeNull()
    expect(parseSpaceUnkeyed('e = <1, 2, 3>')).toBeNull()
  })
})

describe('K5.4 — explicit surfaces with a domain', () => {
  it('z = x*y for x in [0, 1], y in [0, 2]: a rectangle', () => {
    expect(form('z = x*y for x in [0, 1], y in [0, 2]')).toEqual({
      form: 'surface',
      body: p('x*y'),
      domain: {
        kind: 'rect',
        x: { param: 'x', from: p('0'), to: p('1') },
        y: { param: 'y', from: p('0'), to: p('2') },
      },
      style: NO_STYLE,
    })
  })

  it('the rectangle’s ranges may come in either order', () => {
    const f = form('z = x for y in [0, 2], x in [0, 1]')
    expect(f).toMatchObject({ domain: { kind: 'rect', x: { param: 'x' }, y: { param: 'y' } } })
  })

  it('z = x + y over x in [0, 1], y in [x^2, x]: type I, outer x', () => {
    expect(form('z = x + y over x in [0, 1], y in [x^2, x]')).toEqual({
      form: 'surface',
      body: p('x + y'),
      domain: {
        kind: 'iterated',
        coords: 'cartesian',
        outer: { param: 'x', from: p('0'), to: p('1') },
        inner: { param: 'y', from: p('x^2'), to: p('x') },
      },
      style: NO_STYLE,
    })
  })

  it('z = 1 over y in [0, 2], x in [0, y/2]: type II, outer y', () => {
    expect(form('z = 1 over y in [0, 2], x in [0, y/2]')).toMatchObject({
      domain: { kind: 'iterated', coords: 'cartesian', outer: { param: 'y' }, inner: { param: 'x', to: p('y/2') } },
    })
  })

  it('the inner variable is the one whose bounds read the other, even when written first', () => {
    expect(form('z = 1 over y in [x^2, x], x in [0, 1]')).toMatchObject({
      domain: { kind: 'iterated', outer: { param: 'x' }, inner: { param: 'y' } },
    })
  })

  it('z = r over r in [0, 2], theta in [0, pi]: polar', () => {
    expect(form('z = r over r in [0, 2], theta in [0, pi]')).toEqual({
      form: 'surface',
      body: p('r'),
      domain: {
        kind: 'iterated',
        coords: 'polar',
        outer: { param: 'r', from: p('0'), to: p('2') },
        inner: { param: 'theta', from: p('0'), to: p('pi') },
      },
      style: NO_STYLE,
    })
  })

  it('z = 4 - x^2 - y^2 over x^2 + y^2 <= 4: an inequality', () => {
    expect(form('z = 4 - x^2 - y^2 over x^2 + y^2 <= 4')).toEqual({
      form: 'surface',
      body: p('4 - x^2 - y^2'),
      domain: { kind: 'inequality', conditions: [{ kind: 'region', left: p('x^2 + y^2'), op: '<=', right: p('4') }] },
      style: NO_STYLE,
    })
  })

  it('z = x over 1 <= x^2 + y^2 <= 4 and y >= 0: a conjunction with a chain', () => {
    expect(form('z = x over 1 <= x^2 + y^2 <= 4 and y >= 0')).toMatchObject({
      domain: {
        kind: 'inequality',
        conditions: [
          { kind: 'regionChain', low: p('1'), lowOp: '<=', mid: p('x^2 + y^2'), highOp: '<=', high: p('4') },
          { kind: 'region', left: p('y'), op: '>=', right: p('0') },
        ],
      },
    })
  })

  it('a comma joins conditions too, and a > chain is normalised to <', () => {
    expect(form('z = x over 4 > x^2 + y^2 > 1, x >= 0')).toMatchObject({
      domain: {
        kind: 'inequality',
        conditions: [
          { kind: 'regionChain', low: p('1'), lowOp: '<', mid: p('x^2 + y^2'), highOp: '<', high: p('4') },
          { kind: 'region', op: '>=' },
        ],
      },
    })
  })

  it('over R names a region (resolved in S5)', () => {
    expect(form('z = x*y over R')).toMatchObject({ domain: { kind: 'named', name: 'R' } })
  })
})

describe('K5.5 — the existing forms, carrying a style clause', () => {
  it('z = x^2 opacity: 0.5', () => {
    expect(form('z = x^2 opacity: 0.5')).toEqual({ form: 'surface', body: p('x^2'), domain: null, style: { ...NO_STYLE, opacity: 0.5 } })
  })

  it('(cos(t), sin(t), t) for t in [0, 6] width: 3', () => {
    expect(form('(cos(t), sin(t), t) for t in [0, 6] width: 3')).toEqual({
      form: 'curve',
      fx: p('cos(t)'),
      fy: p('sin(t)'),
      fz: p('t'),
      t: { param: 't', from: p('0'), to: p('6') },
      style: { ...NO_STYLE, width: 3 },
    })
  })

  it('a parametric surface with a style clause', () => {
    expect(form('(u, v, u v) for u in [0, 1], v in [0, 2] mesh: off')).toMatchObject({
      form: 'parametricSurface',
      u: { param: 'u' },
      v: { param: 'v', to: p('2') },
      style: { mesh: false },
    })
  })

  it('several clauses in any order, and a colormap with a map and diverging', () => {
    expect(form('z = x*y for x in [-1, 1], y in [-1, 1] colormap: x*y map balance diverging res: 40 opacity: 0.8')).toMatchObject({
      style: {
        opacity: 0.8,
        res: 40,
        colormap: { by: { kind: 'expr', expr: p('x*y'), text: 'x*y' }, map: 'balance', diverging: true },
      },
    })
    expect(form('(t, t, t) for t in [0, 1] dashed width: 2')).toMatchObject({ style: { dashed: true, width: 2 } })
    // res: counts cells per axis on a surface, segments on a curve
    expect(form('z = x res: 4')).toMatchObject({ style: { res: 4 } })
    expect(form('(t, t, t) for t in [0, 1] res: 1000')).toMatchObject({ style: { res: 1000 } })
    expect(form('z = x colormap: height map magma')).toMatchObject({ style: { colormap: { by: { kind: 'height' }, map: 'magma', diverging: false } } })
    expect(form('z = x colormap: none')).toMatchObject({ style: { colormap: { by: { kind: 'none' }, map: null } } })
  })
})

describe('K5.6 — implicit surfaces', () => {
  it('x^2 + y^2 - z^2 = 1', () => {
    expect(form('x^2 + y^2 - z^2 = 1')).toEqual({
      form: 'implicitSurface',
      left: p('x^2 + y^2 - z^2'),
      right: p('1'),
      forced: false,
      style: NO_STYLE,
    })
  })

  it('x = y^2 + z^2 (the left side is x, not a name)', () => {
    expect(form('x = y^2 + z^2')).toMatchObject({ form: 'implicitSurface', left: p('x'), right: p('y^2 + z^2'), forced: false })
  })

  it('implicit: x^2 + y^2 = 4 forces the surface reading', () => {
    expect(parseSpaceUnkeyed('implicit: x^2 + y^2 = 4')).toBeNull()
    expect(form('implicit: x^2 + y^2 = 4')).toEqual({
      form: 'implicitSurface',
      left: p('x^2 + y^2'),
      right: p('4'),
      forced: true,
      style: NO_STYLE,
    })
  })

  it('a built-in on the left is an equation, not a definition: hypot(x, y, z) = 1', () => {
    expect(form('hypot(x, y, z) = 1')).toMatchObject({ form: 'implicitSurface', left: p('hypot(x, y, z)'), right: p('1'), forced: false })
  })

  it('an implicit surface may carry surface style', () => {
    expect(form('x^2 + y^2 + z^2 = 4 opacity: 0.4')).toMatchObject({ form: 'implicitSurface', style: { opacity: 0.4 } })
  })
})

describe('lines space does not claim (both hooks return null)', () => {
  const negatives = [
    // equations without z stay 2D
    'x^2 + y^2 = 25',
    'y = x^2',
    // the existing forms, with no clause and no domain
    'z = x*y',
    '(cos(t), sin(t), t) for t in [0, 6]',
    '(u, v, u*v) for u in [0, 1], v in [0, 1]',
    // single-parameter definitions stay functionDef — even with z in them
    'k(x) = x^2',
    'g(z) = z^2',
    // a tuple is a point
    'A = (1, 2, 3)',
    // a bare name on the left is a constant or a construction
    'k = z + 1',
    'M = midpoint A-B',
    'S = solid prism 8 by 5 by 6',
    'p = plane x + y + z = 4',
    'plane = 2',
    'net = 5',
    // solid-figure keywords
    'plane: A-B-C',
    'segment: A-B dashed',
    // a 2D curve with a clause is not a space curve
    '(cos(t), sin(t)) for t in [0, 6]',
    '(cos(t), sin(t)) for t in [0, 6] width: 3',
    // relations that are not equations
    'x^2 + z^2 < 4',
    // a definition named after a built-in, pi or e (fix round 1, I1)
    'log(y, x) = 2',
    'log(x, y) = 1',
    'sin(x, y) = 1',
    'pi = <1, 2, 3>',
    'e(x, y) = x + y',
    // a first word that is a solid-figure keyword (fix round 1, R2)
    'plane z = 1',
    'plane x + y + z = 4',
    'triangle = <1, 2, 3>',
    'label z = 3',
    'angle z = 1',
    'circle x^2 + z^2 = 1 opacity: 0.5',
    'solid (u, v, 1) for u in [0, 1], v in [0, 1] mesh: off',
  ]
  for (const line of negatives) {
    it(line, () => {
      expect(parseSpaceKeyword(line)).toBeNull()
      expect(parseSpaceUnkeyed(line)).toBeNull()
    })
  }
})

describe('refusals on a claimed line', () => {
  const refusals: [string, RegExp][] = [
    ['z = x^2 width: 3', /width: applies to curves and lines, not to a surface/],
    ['z = x^2 dashed', /dashed applies to curves and lines, not to a surface/],
    ['(t, t, t) for t in [0, 1] opacity: 0.5', /opacity: applies to surfaces, not to a curve/],
    ['z = x^2 opacity: 2', /opacity/],
    ['z = x^2 res: 1000', /res: must be a whole number from 2 to 400 on a surface/],
    ['z = x^2 res: 1', /res/],
    ['z = x^2 res: 2.5', /res/],
    ['(t, t, t) for t in [0, 1] res: 20000', /from 2 to 10000 on a curve/],
    ['z = x^2 colormap: height map neon', /neon/],
    ['z = x^2 colormap: height map viridis diverging', /diverging/],
    ['z = x^2 opacity: 0.5 opacity: 0.6', /twice/],
    ['z = 1 over x in [0, y], y in [0, x]', /depend on each other/],
    ['z = 1 over u in [0, 1], v in [0, 1]', /x and y, or r and theta/],
    ['z = 1 for x in [0, 1], y in [x, 1]', /over/],
    ['z = 1 for x in [0, 1]', /x and y/],
    ['u = <1, 2>', /three components/],
    ['u = <1, 2, 3, 4>', /three components/],
    ['r(t) = <t, t>', /three components/],
    ['f(x, y) = x + y opacity: 0.5', /not to a function definition/],
    ['f(x, x) = x', /twice/],
    ['z = x over 1 < x > 2', /same direction/],
    ['implicit: x^2 + y^2', /equation/],
    // color: or name: left before a style clause (fix round 1, R3)
    ['z = x color: red opacity: 0.5', /write color: and name: after the other clauses/],
    ['(t, t, t) for t in [0, 1] name: c width: 2', /write color: and name: after the other clauses/],
    ['implicit: x^2 + z^2 = 1 color: red mesh: off', /write color: and name: after the other clauses/],
  ]
  for (const [line, message] of refusals) {
    it(line, () => {
      expect(() => parseSpaceKeyword(line) ?? parseSpaceUnkeyed(line)).toThrow(message)
    })
  }
})
