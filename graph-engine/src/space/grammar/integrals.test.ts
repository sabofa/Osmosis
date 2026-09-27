import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../parser/parseExpr'
import { parseStatement } from '../../parser/parseStatement'
import { parseSpaceKeyword } from './keyword'
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
