import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../../parser/parseExpr'
import { parseStatement } from '../../../parser/parseStatement'
import { parseSpaceKeyword } from '../keyword'
import type { SpaceForm, SpaceStyle } from '../types'

const p = parseExprString
const NO_STYLE: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }

function form(line: string): SpaceForm {
  const statement = parseSpaceKeyword(line)
  if (!statement) throw new Error(`not claimed: ${line}`)
  return statement.form
}

describe('keyword ownership: a hyphenated point list belongs to solid figures', () => {
  it.each(['path: A-B-C-D', 'path: A-B', 'path: A-B-C dashed', 'path: P - Q plain'])('does not claim "%s"', (line) => {
    expect(parseSpaceKeyword(line)).toBeNull()
  })

  it('leaves "path: A-B-C-D" to the shared grammar, which does not read it as space', () => {
    let kind: string | null = null
    try {
      kind = parseStatement('path: A-B-C-D').kind
    } catch {
      kind = null
    }
    expect(kind).not.toBe('space')
  })
})

describe('path:', () => {
  it('parses a target, a curve in the plane and its parameter range', () => {
    expect(form('path: on f along (t, t^2) for t in [-1, 1]')).toEqual({
      form: 'path',
      target: p('f'),
      along: [p('t'), p('t^2')],
      t: { param: 't', from: p('-1'), to: p('1') },
      toward: null,
      style: NO_STYLE,
    })
  })

  it('parses toward, an inline target and style clauses', () => {
    expect(form('path: on x*y/(x^2 + y^2) along (s, 0) for s in [0, 1] toward (0, 0) width: 3 res: 64')).toEqual({
      form: 'path',
      target: p('x*y/(x^2 + y^2)'),
      along: [p('s'), p('0')],
      t: { param: 's', from: p('0'), to: p('1') },
      toward: [p('0'), p('0')],
      style: { ...NO_STYLE, width: 3, res: 64 },
    })
  })

  it.each([
    ['path: f along (t, t) for t in [0, 1]', /Expected "path: on f along \(t, t\^2\) for t in \[-1, 1\]"/],
    ['path: on f along (t, t, t) for t in [0, 1]', /A path along a curve takes two coordinates/],
    ['path: on f along (t, t) for t in [0, 1] opacity: 0.5', /opacity: does not apply to path: — it takes width:, res:, color: and name:/],
    ['path: on f along (t, t) for t in [0, 1] toward (0, 0, 0)', /"toward" takes two coordinates/],
  ])('refuses "%s" in its own words', (line, message) => {
    expect(() => parseSpaceKeyword(line)).toThrow(message)
  })
})

describe('trace:', () => {
  it('parses "at x = a" with a tangent at y', () => {
    expect(form('trace: f at x = 2 tangent at y = 1')).toEqual({
      form: 'trace',
      target: p('f'),
      axis: 'x',
      at: p('2'),
      tangentAt: p('1'),
      over: null,
      style: NO_STYLE,
    })
  })

  it('parses "at y = b", a domain and style', () => {
    expect(form('trace: x^2 - y^2 at y = -1 over x in [-2, 2], y in [-2, 2] opacity: 0.3 width: 2')).toEqual({
      form: 'trace',
      target: p('x^2 - y^2'),
      axis: 'y',
      at: p('-1'),
      tangentAt: null,
      over: { x: { param: 'x', from: p('-2'), to: p('2') }, y: { param: 'y', from: p('-2'), to: p('2') } },
      style: { ...NO_STYLE, opacity: 0.3, width: 2 },
    })
  })

  it.each([
    ['trace: f at x = 2 tangent at x = 1', /The trace at x = … is a curve in y, so its tangent is "tangent at y = …", got "tangent at x = …"/],
    ['trace: f at z = 1', /Expected "trace: f at x = 2 tangent at y = 1"/],
    ['trace: f', /Expected "trace: f at x = 2 tangent at y = 1"/],
    ['trace: f at x = 1 over r in [0, 1], theta in [0, pi]', /trace: takes "over x in \[a, b\], y in \[c, d\]" \(a rectangle\)/],
    ['trace: f at x = 1 res: 20', /res: does not apply to trace: — it takes opacity:, width:, color: and name:/],
  ])('refuses "%s" in its own words', (line, message) => {
    expect(() => parseSpaceKeyword(line)).toThrow(message)
  })
})

describe('tangent-plane:', () => {
  it('parses a point in the plane, and normal', () => {
    expect(form('tangent-plane: f at (1, 2) normal')).toEqual({
      form: 'tangentPlane',
      target: p('f'),
      point: [p('1'), p('2')],
      normal: true,
      over: null,
      style: NO_STYLE,
    })
  })

  it('parses a point in space, whose coordinates may read parameters', () => {
    expect(form('tangent-plane: x^2 + y^2 + z^2 at (a, 1, sqrt(2)) opacity: 0.4')).toEqual({
      form: 'tangentPlane',
      target: p('x^2 + y^2 + z^2'),
      point: [p('a'), p('1'), p('sqrt(2)')],
      normal: false,
      over: null,
      style: { ...NO_STYLE, opacity: 0.4 },
    })
  })

  it('is claimed before the 2D "tangent:" statement, which it does not disturb', () => {
    expect(parseStatement('tangent-plane: f at (1, 2)').kind).toBe('space')
    expect(parseStatement('tangent: x^2 at x = 1').kind).toBe('tangent')
  })

  it.each([
    ['tangent-plane: f at 1, 2', /Expected a point "\(a, b\)" after "at"/],
    ['tangent-plane: f at (1, 2) sideways', /Unexpected "sideways" after the point in tangent-plane: — it takes "normal"/],
    ['tangent-plane: f at (1, 2) normal normal', /"normal" is given twice/],
  ])('refuses "%s" in its own words', (line, message) => {
    expect(() => parseSpaceKeyword(line)).toThrow(message)
  })
})

describe('gradient:', () => {
  it('parses a point in the plane with lifted, and a point in space with surface', () => {
    expect(form('gradient: f at (1, 2) lifted')).toEqual({
      form: 'gradient',
      target: p('f'),
      point: [p('1'), p('2')],
      lifted: true,
      surface: false,
      over: null,
      style: NO_STYLE,
    })
    expect(form('gradient: x*y*z at (1, 2, 3) surface')).toMatchObject({ form: 'gradient', point: [p('1'), p('2'), p('3')], lifted: false, surface: true })
  })

  it.each([
    ['gradient: f at (1, 2, 3) lifted', /"lifted" applies to a gradient of f\(x, y\) at \(a, b\)/],
    ['gradient: f at (1, 2) surface', /"surface" applies to a gradient of F\(x, y, z\)/],
    ['gradient: f', /Expected "gradient: f at \(1, 2\)"/],
  ])('refuses "%s" in its own words', (line, message) => {
    expect(() => parseSpaceKeyword(line)).toThrow(message)
  })
})

describe('directional:', () => {
  it('parses the point and the direction, in either bracket', () => {
    const expected = { form: 'directional', target: p('f'), point: [p('1'), p('2')], toward: [p('3'), p('4')], over: null, style: NO_STYLE }
    expect(form('directional: f at (1, 2) toward <3, 4>')).toEqual(expected)
    expect(form('directional: f at (1, 2) toward ⟨3, 4⟩')).toEqual(expected)
  })

  it.each([
    ['directional: f at (1, 2) toward <3, 4, 5>', /A direction in the plane has two components, got 3/],
    ['directional: f at (1, 2) toward (3, 4)', /Expected a direction "<u1, u2>" after "toward"/],
    ['directional: f at (1, 2)', /Expected "directional: f at \(1, 2\) toward <3, 4>"/],
  ])('refuses "%s" in its own words', (line, message) => {
    expect(() => parseSpaceKeyword(line)).toThrow(message)
  })
})
