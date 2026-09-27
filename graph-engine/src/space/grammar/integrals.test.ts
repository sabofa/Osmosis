import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../parser/parseExpr'
import { parseStatement } from '../../parser/parseStatement'
import { parseSpaceKeyword } from './keyword'
import { STYLE_CLAUSE_START, STYLE_KEYS } from './style'
import type { SpaceForm } from './types'
import { parseSpaceUnkeyed } from './unkeyed'

const p = parseExprString

function form(line: string): SpaceForm {
  const statement = parseSpaceKeyword(line) ?? parseSpaceUnkeyed(line)
  if (!statement) throw new Error(`not claimed: ${line}`)
  return statement.form
}

describe('S5 grammar — region:', () => {
  it('type I: the inner bounds read the outer variable', () => {
    expect(form('region: x in [0, 1], y in [x^2, x]')).toMatchObject({
      form: 'region',
      domain: { kind: 'iterated', coords: 'cartesian', outer: { param: 'x' }, inner: { param: 'y', from: p('x^2'), to: p('x') } },
    })
  })

  it('type II: written y first, x in [0, y/2]', () => {
    expect(form('region: y in [0, 2], x in [0, y/2]')).toMatchObject({
      domain: { kind: 'iterated', outer: { param: 'y' }, inner: { param: 'x', to: p('y/2') } },
    })
  })

  it('polar', () => {
    expect(form('region: r in [0, 2], theta in [0, pi/2]')).toMatchObject({ domain: { kind: 'iterated', coords: 'polar' } })
  })

  it('an inequality, joined by "and"', () => {
    expect(form('region: x^2 + y^2 <= 4 and y >= 0')).toMatchObject({
      domain: { kind: 'inequality', conditions: [{ kind: 'region', op: '<=' }, { kind: 'region', op: '>=' }] },
    })
  })

  it('a named region draws with region: R', () => {
    expect(form('region: R')).toMatchObject({ form: 'region', domain: { kind: 'named', name: 'R' } })
  })

  it('takes opacity: and res:', () => {
    expect(form('region: x^2 + y^2 <= 4 opacity: 0.5 res: 128')).toMatchObject({ style: { opacity: 0.5, res: 128 } })
  })

  it('refuses a clause that does not apply, by name', () => {
    expect(() => form('region: x in [0, 1], y in [0, x] width: 3')).toThrow(/width: does not apply to a region/)
  })

  it('refuses one range, in its own words', () => {
    expect(() => form('region: x in [0, 1]')).toThrow(/A region needs two ranges/)
  })
})

describe('S5 grammar — named regions (the unkeyed claim)', () => {
  it('R = region x in [0, 1], y in [x^2, x] is claimed and draws nothing on its own', () => {
    expect(form('R = region x in [0, 1], y in [x^2, x]')).toMatchObject({
      form: 'namedRegion',
      name: 'R',
      domain: { kind: 'iterated', outer: { param: 'x' } },
    })
  })

  it('G = centroid ABC is NOT claimed: it stays the solid-figure construction', () => {
    expect(parseSpaceUnkeyed('G = centroid ABC')).toBeNull()
    expect(parseSpaceKeyword('G = centroid ABC')).toBeNull()
    expect(parseStatement('G = centroid ABC')).toMatchObject({ kind: 'construction', body: { kind: 'triangleCentre', centre: 'centroid' } })
  })

  it('a coordinate is not a region name', () => {
    expect(() => form('x = region x in [0, 1], y in [0, x]')).toThrow(/"x" is a coordinate/)
  })

  it('refuses a style clause on a named region, saying where it goes', () => {
    expect(() => form('R = region x in [0, 1], y in [0, x] opacity: 0.5')).toThrow(/a named region draws nothing/)
  })
})

describe('S5 grammar — centroid:', () => {
  it('centroid: V is claimed by the keyword hook', () => {
    expect(parseSpaceKeyword('centroid: V')).toMatchObject({ kind: 'space', form: { form: 'centroid', of: 'V', density: null } })
  })

  it('takes a density', () => {
    expect(form('centroid: R density x')).toMatchObject({ form: 'centroid', of: 'R', density: p('x') })
    expect(form('centroid: R density: x*y')).toMatchObject({ density: p('x*y') })
  })

  it('refuses anything but a name', () => {
    expect(() => form('centroid: x in [0, 1], y in [0, x]')).toThrow(/centroid: takes the name of a region or a volume/)
  })
})

describe('S5 grammar — keyword ownership', () => {
  it('never claims an operand that is only a hyphenated point list', () => {
    for (const line of ['region: A-B-C', 'centroid: A-B-C', 'region: P1 - P2 - P3']) {
      expect(parseSpaceKeyword(line)).toBeNull()
    }
  })
})

describe('S5 grammar — volume: under and between', () => {
  it('under f over a region', () => {
    expect(form('volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, 2*pi]')).toMatchObject({
      form: 'volume',
      solid: { kind: 'between', top: { expr: p('4 - x^2 - y^2'), text: '4 - x^2 - y^2' }, bottom: null, region: { kind: 'iterated', coords: 'polar' } },
    })
  })

  it('between g and f: g is the bottom, f the top', () => {
    expect(form('volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]')).toMatchObject({
      solid: { kind: 'between', bottom: { text: 'x^2 + y^2' }, top: { text: '2' }, region: { kind: 'iterated' } },
    })
  })

  it('over a named region, or an inequality', () => {
    expect(form('volume: under f over R opacity: 0.3')).toMatchObject({ solid: { region: { kind: 'named', name: 'R' } }, style: { opacity: 0.3 } })
    expect(form('volume: under 1 over x^2 + y^2 <= 1')).toMatchObject({ solid: { region: { kind: 'inequality' } } })
  })

  it('refuses a volume with no region', () => {
    expect(() => form('volume: under x*y')).toThrow(/volume: under f over R/)
    expect(() => form('volume: between x and y')).toThrow(/between g and f over R/)
  })
})

describe('S5 grammar — riemann:', () => {
  it('under f over a rectangle, n = 2, sample mid by default', () => {
    expect(form('riemann: under x*y over x in [0, 2], y in [0, 2], n = 2')).toMatchObject({
      form: 'riemann',
      target: { text: 'x*y' },
      region: { kind: 'iterated', coords: 'cartesian', outer: { param: 'x' }, inner: { param: 'y' } },
      n: [p('2'), p('2')],
      sample: 'mid',
    })
  })

  it('n = 4 by 3, a sample rule and opacity', () => {
    expect(form('riemann: under f over x in [0, 1], y in [0, 1], n = 4 by 3 sample: upper-right opacity: 0.4')).toMatchObject({
      n: [p('4'), p('3')],
      sample: 'upper-right',
      style: { opacity: 0.4 },
    })
  })

  it('n may be a binding', () => {
    expect(form('riemann: under x*y over x in [0, 2], y in [0, 2], n = n sample: random')).toMatchObject({ n: [p('n'), p('n')], sample: 'random' })
  })

  it('refuses a region that is not a rectangle', () => {
    const message = /Riemann boxes need a rectangle; use x in \[a, b\], y in \[c, d\]/
    expect(() => form('riemann: under x*y over x in [0, 1], y in [0, x], n = 2')).toThrow(message)
    expect(() => form('riemann: under x*y over r in [0, 1], theta in [0, pi], n = 2')).toThrow(message)
    expect(() => form('riemann: under x*y over x^2 + y^2 <= 1, n = 2')).toThrow(message)
  })

  it('refuses a missing n and an unknown sample rule', () => {
    expect(() => form('riemann: under x*y over x in [0, 2], y in [0, 2]')).toThrow(/n = 4/)
    expect(() => form('riemann: under x*y over x in [0, 2], y in [0, 2], n = 2 sample: middle')).toThrow(/sample: mid, lower-left, upper-right, lower-right, upper-left or random/)
  })
})

describe('S5 grammar — volume: triple-integral regions', () => {
  const X = { param: 'x', from: p('0'), to: p('1') }
  const Y = { param: 'y', from: p('0'), to: p('1 - x') }
  const Z = { param: 'z', from: p('0'), to: p('1 - x - y') }

  it('rectangular, in the written order when it is a chain', () => {
    expect(form('volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]')).toEqual({
      form: 'volume',
      solid: { kind: 'iterated', coords: 'rectangular', order: [X, Y, Z], integrand: null },
      style: { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false },
    })
  })

  it('any written order: the innermost variable is the one whose bounds read the others', () => {
    expect(form('volume: z in [0, 1 - x - y], y in [0, 1 - x], x in [0, 1]')).toMatchObject({ solid: { order: [X, Y, Z] } })
    expect(form('volume: y in [0, 1 - x], x in [0, 1], z in [0, 1 - x - y]')).toMatchObject({ solid: { order: [X, Y, Z] } })
  })

  it('cylindrical and spherical, by suffix', () => {
    expect(form('volume: r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical')).toMatchObject({
      solid: { coords: 'cylindrical', order: [{ param: 'r' }, { param: 'theta' }, { param: 'z' }] },
    })
    expect(form('volume: rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi] spherical')).toMatchObject({
      solid: { coords: 'spherical', order: [{ param: 'rho' }, { param: 'phi' }, { param: 'theta' }] },
    })
  })

  it('an integrand, with or without a colon, before or after the suffix', () => {
    expect(form('volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y] integrand x')).toMatchObject({ solid: { integrand: { text: 'x' } } })
    expect(form('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand: x*y opacity: 0.3')).toMatchObject({
      solid: { integrand: { expr: p('x*y') } },
      style: { opacity: 0.3 },
    })
    expect(form('volume: r in [0, 1], theta in [0, pi], z in [0, 1] integrand r cylindrical')).toMatchObject({
      solid: { coords: 'cylindrical', integrand: { text: 'r' } },
    })
    expect(form('volume: r in [0, 1], theta in [0, pi], z in [0, 1] cylindrical integrand r')).toMatchObject({
      solid: { coords: 'cylindrical', integrand: { text: 'r' } },
    })
  })

  it('refuses bounds that are not a chain, naming the offending bounds', () => {
    expect(() => form('volume: x in [0, y], y in [0, x], z in [0, 1]')).toThrow(/the bounds of x read y, and the bounds of y read x/)
    expect(() => form('volume: x in [0, y], y in [0, z], z in [0, x]')).toThrow(/the bounds of x read y, y's read z and z's read x/)
  })

  it('refuses the wrong variables for the system, with the fix', () => {
    expect(() => form('volume: r in [0, 1], theta in [0, pi], z in [0, 1]')).toThrow(/add "cylindrical"/)
    expect(() => form('volume: x in [0, 1], y in [0, 1], z in [0, 1] spherical')).toThrow(/A spherical volume is over rho, phi and theta/)
    expect(() => form('volume: x in [0, 1], y in [0, 1]')).toThrow(/three ranges/)
  })

  it('names a volume: V = volume ..., drawn by volume: V', () => {
    expect(form('V = volume x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]')).toMatchObject({
      form: 'namedVolume',
      name: 'V',
      solid: { kind: 'iterated', order: [X, Y, Z] },
    })
    expect(form('W = volume under f over R')).toMatchObject({ form: 'namedVolume', name: 'W', solid: { kind: 'between' } })
    expect(form('volume: V')).toMatchObject({ form: 'volume', solid: { kind: 'named', name: 'V' } })
  })

  it('never claims a point list', () => {
    expect(parseSpaceKeyword('volume: A-B-C-D')).toBeNull()
  })
})

describe('S5 grammar — fix round 1', () => {
  it('style clauses may come before sample:, integrand or a coordinate system', () => {
    expect(form('riemann: under x*y over x in [0, 2], y in [0, 2], n = 2 opacity: 0.5 sample: upper-right')).toMatchObject({
      sample: 'upper-right',
      style: { opacity: 0.5 },
    })
    expect(form('volume: x in [0, 1], y in [0, 1], z in [0, 1] opacity: 0.3 integrand x*y')).toMatchObject({
      solid: { integrand: { expr: p('x*y') } },
      style: { opacity: 0.3 },
    })
    expect(form('volume: r in [0, 1], theta in [0, pi], z in [0, 1] opacity: 0.3 cylindrical')).toMatchObject({
      solid: { coords: 'cylindrical' },
      style: { opacity: 0.3 },
    })
    expect(form('volume: r in [0, 1], theta in [0, pi], z in [0, 1] res: 20 integrand r cylindrical opacity: 0.3')).toMatchObject({
      solid: { coords: 'cylindrical', integrand: { text: 'r' } },
      style: { opacity: 0.3, res: 20 },
    })
  })

  it('a cylindrical or spherical bound that reads x or y says which variables it may use', () => {
    expect(() => form('volume: r in [0, 1], theta in [0, pi], z in [0, x] cylindrical')).toThrow(
      /bounds in cylindrical coordinates may use r, theta and z, not x/,
    )
    expect(() => form('volume: rho in [0, y], phi in [0, pi/4], theta in [0, 2*pi] spherical')).toThrow(
      /bounds in spherical coordinates may use rho, phi and theta, not y/,
    )
  })

  it('never claims a hyphenated point list after "NAME = region" or "NAME = volume"', () => {
    expect(parseSpaceUnkeyed('V = volume A-B-C-D')).toBeNull()
    expect(parseSpaceUnkeyed('R = region A-B-C')).toBeNull()
  })
})

describe('S5 grammar — the style clause keys have one source (fix round 2)', () => {
  it('STYLE_CLAUSE_START finds every keyed clause and "dashed", and nothing inside a word', () => {
    for (const key of STYLE_KEYS) expect(STYLE_CLAUSE_START.test(` ${key}: 1`)).toBe(true)
    expect(STYLE_CLAUSE_START.test(' dashed')).toBe(true)
    expect(STYLE_CLAUSE_START.test(' opacityx: 1')).toBe(false)
    expect(STYLE_CLAUSE_START.test('x in [0, 1]')).toBe(false)
  })
})
