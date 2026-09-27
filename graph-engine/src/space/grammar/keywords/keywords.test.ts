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

describe('the uniform point-list rule: a hyphenated list of point names is never claimed', () => {
  for (const line of ['line: A-B', 'line: A-B dashed', 'line: A-B plain', 'plane: A-B-C', 'path: A-B-C-D', 'contour: A-B', 'implicit: P-Q']) {
    it(line, () => {
      expect(parseSpaceKeyword(line)).toBeNull()
    })
  }

  it('so "plane: A-B-C" still meets the solid-figure refusal through parseStatement', () => {
    expect(() => parseStatement('plane: A-B-C')).toThrow(/A plane is not drawn on its own/)
  })
})

describe('contour:', () => {
  it('contour: g levels 1, 4, 9', () => {
    expect(form('contour: g levels 1, 4, 9')).toEqual({
      form: 'contour',
      target: p('g'),
      text: 'g',
      levels: { kind: 'list', values: [p('1'), p('4'), p('9')] },
      floor: false,
      labels: false,
      style: NO_STYLE,
    })
  })

  it('an inline target, a range of levels, floor and labels in either order', () => {
    expect(form('contour: x^2 - y^2 levels -4..4 step 1 labels floor')).toMatchObject({
      target: p('x^2 - y^2'),
      text: 'x^2 - y^2',
      levels: { kind: 'range', from: p('-4'), to: p('4'), step: p('1') },
      floor: true,
      labels: true,
    })
  })

  it('levels n is a count; level c is one level', () => {
    expect(form('contour: f levels 12')).toMatchObject({ levels: { kind: 'count', n: 12 } })
    expect(form('contour: f level 2.5')).toMatchObject({ levels: { kind: 'list', values: [p('2.5')] } })
    expect(form('contour: f levels pi, 2 pi')).toMatchObject({ levels: { kind: 'list', values: [p('pi'), p('2 pi')] } })
  })

  it('takes opacity:, res:, width: and dashed', () => {
    expect(form('contour: g levels 3 opacity: 0.3 res: 40')).toMatchObject({ style: { opacity: 0.3, res: 40 } })
    expect(form('contour: f levels 3 width: 2 dashed')).toMatchObject({ style: { width: 2, dashed: true } })
  })

  const refusals: [string, RegExp][] = [
    ['contour: g', /Expected "contour: g levels 5"/],
    ['contour: levels 3', /Expected "contour: g levels 5"/],
    ['contour: g levels 2.5', /not a count, a list or a range .* "level 2.5" for one level/],
    ['contour: g levels 0', /the count is from 1 to 50/],
    ['contour: g levels 51', /the count is from 1 to 50/],
    ['contour: g levels 1..4', /needs a step: "levels 1..4 step 1"/],
    ['contour: g level 1, 2', /"level" takes one value/],
    ['contour: g levels 3 floor floor', /"floor" is given twice/],
    ['contour: g levels 3 mesh: on', /mesh: does not apply to contour: — it takes opacity:, res:, width:, dashed and color:/],
    ['contour: g levels 3 colormap: height', /colormap: does not apply to contour:/],
  ]
  for (const [line, message] of refusals) {
    it(`refuses ${line}`, () => {
      expect(() => parseSpaceKeyword(line)).toThrow(message)
    })
  }
})

describe('line:', () => {
  const tuple = (a: string, b: string, c: string) => ({ kind: 'tuple', coords: [p(a), p(b), p(c)] })

  it('line: through (1, 2, 3) direction <1, -1, 2>', () => {
    expect(form('line: through (1, 2, 3) direction <1, -1, 2>')).toEqual({
      form: 'line',
      through: { ...tuple('1', '2', '3'), text: '(1, 2, 3)' },
      to: { kind: 'direction', vector: { kind: 'literal', components: [p('1'), p('-1'), p('2')], text: '<1, -1, 2>' } },
      text: 'through (1, 2, 3) direction <1, -1, 2>',
      style: NO_STYLE,
    })
  })

  it('line: through P and Q; through two tuples', () => {
    expect(form('line: through P and Q')).toMatchObject({ through: { kind: 'name', name: 'P' }, to: { kind: 'point', point: { kind: 'name', name: 'Q' } } })
    expect(form('line: through (1, 2, 3) and (0, 0, 1)')).toMatchObject({ through: tuple('1', '2', '3'), to: { kind: 'point', point: tuple('0', '0', '1') } })
  })

  it('a direction may be a vector constant or a vector function at a point', () => {
    expect(form('line: through P direction u')).toMatchObject({ to: { kind: 'direction', vector: { kind: 'named', name: 'u', args: null } } })
    expect(form('line: through P direction F(1, 0, 2)')).toMatchObject({
      to: { kind: 'direction', vector: { kind: 'named', name: 'F', args: [p('1'), p('0'), p('2')] } },
    })
  })

  it('takes width: and dashed', () => {
    expect(form('line: through P and Q width: 3 dashed')).toMatchObject({ style: { width: 3, dashed: true } })
  })

  const refusals: [string, RegExp][] = [
    ['line: (1, 2, 3) direction <1, 0, 0>', /Expected "line: through \(1, 2, 3\) direction <1, -1, 2>" or "line: through P and Q"/],
    ['line: through (1, 2) direction <1, 0, 0>', /A point in space has three coordinates, got 2 in "\(1, 2\)"/],
    ['line: through P direction (1, 0, 0)', /a vector is written <1, 0, 0>/],
    ['line: through P and 3', /Expected a point/],
    ['line: through P and Q opacity: 0.5', /opacity: does not apply to line: — it takes width:, dashed and color:/],
  ]
  for (const [line, message] of refusals) {
    it(`refuses ${line}`, () => {
      expect(() => parseSpaceKeyword(line)).toThrow(message)
    })
  }
})

describe('plane:', () => {
  it('plane: 2x + y - z = 3', () => {
    expect(form('plane: 2x + y - z = 3')).toEqual({
      form: 'plane',
      def: { kind: 'equation', left: p('2x + y - z'), right: p('3') },
      text: '2x + y - z = 3',
      style: NO_STYLE,
    })
  })

  it('plane: through (1, 2, 3) normal <1, 1, 1>; through three points; through P, Q, R', () => {
    expect(form('plane: through (1, 2, 3) normal <1, 1, 1>')).toMatchObject({
      def: { kind: 'pointNormal', point: { kind: 'tuple' }, normal: { kind: 'literal', components: [p('1'), p('1'), p('1')] } },
    })
    expect(form('plane: through (1,0,0), (0,1,0), (0,0,1)')).toMatchObject({ def: { kind: 'points', points: [{ kind: 'tuple' }, { kind: 'tuple' }, { kind: 'tuple' }] } })
    expect(form('plane: through P, Q, R')).toMatchObject({
      def: { kind: 'points', points: [{ kind: 'name', name: 'P' }, { kind: 'name', name: 'Q' }, { kind: 'name', name: 'R' }] },
    })
  })

  it('takes opacity:', () => {
    expect(form('plane: z = 1 opacity: 0.2')).toMatchObject({ style: { opacity: 0.2 } })
  })

  it("never claims the solid figures' plane forms, whose refusal still fires", () => {
    for (const line of ['plane: p', 'plane: through P perpendicular to A-B', 'plane: through P parallel to A-B-C']) {
      expect(parseSpaceKeyword(line)).toBeNull()
      expect(() => parseStatement(line)).toThrow(/A plane is not drawn on its own/)
    }
  })

  const refusals: [string, RegExp][] = [
    ['plane: through (1, 2, 3)', /Expected "plane: 2x \+ y - z = 3", "plane: through P normal <1, 1, 1>" or "plane: through P, Q, R"/],
    ['plane: through P, Q', /Expected "plane: 2x \+ y - z = 3"/],
    ['plane: x + y = 1 = z', /one "="/],
    ['plane: z = 1 width: 2', /width: does not apply to plane: — it takes opacity: and color:/],
  ]
  for (const [line, message] of refusals) {
    it(`refuses ${line}`, () => {
      expect(() => parseSpaceKeyword(line)).toThrow(message)
    })
  }
})

describe('cross: and project:', () => {
  const lit = (a: string, b: string, c: string) => ({ kind: 'literal', components: [p(a), p(b), p(c)] })

  it('cross: <1,0,0> x <0,1,0>', () => {
    expect(form('cross: <1,0,0> x <0,1,0>')).toEqual({
      form: 'cross',
      u: { ...lit('1', '0', '0'), text: '<1,0,0>' },
      v: { ...lit('0', '1', '0'), text: '<0,1,0>' },
      at: null,
      style: NO_STYLE,
    })
  })

  it('cross: u × v at (1, 1, 1); named and evaluated operands', () => {
    expect(form('cross: u × v at (1, 1, 1)')).toMatchObject({
      u: { kind: 'named', name: 'u' },
      v: { kind: 'named', name: 'v' },
      at: { kind: 'tuple', coords: [p('1'), p('1'), p('1')] },
    })
    expect(form('cross: F(1, 0, 2) x <x0, 1, 0> at P')).toMatchObject({
      u: { kind: 'named', name: 'F', args: [p('1'), p('0'), p('2')] },
      v: lit('x0', '1', '0'),
      at: { kind: 'name', name: 'P' },
    })
  })

  it('cross: takes opacity: for its parallelogram', () => {
    expect(form('cross: u x v opacity: 0.5')).toMatchObject({ style: { opacity: 0.5 } })
  })

  it('project: u onto v [at P]', () => {
    expect(form('project: <3,4,0> onto <1,0,0>')).toMatchObject({ form: 'project', u: lit('3', '4', '0'), v: lit('1', '0', '0'), at: null })
    expect(form('project: u onto v at Q')).toMatchObject({ at: { kind: 'name', name: 'Q' } })
  })

  const refusals: [string, RegExp][] = [
    ['cross: u v', /Expected "cross: u x v"/],
    ['cross: u x', /Expected "cross: u x v"/],
    ['cross: (1,0,0) x <0,1,0>', /a vector is written <1,0,0>/],
    ['project: u on v', /Expected "project: u onto v"/],
    ['project: u onto v opacity: 0.5', /opacity: does not apply to project: — it takes color:/],
  ]
  for (const [line, message] of refusals) {
    it(`refuses ${line}`, () => {
      expect(() => parseSpaceKeyword(line)).toThrow(message)
    })
  }
})
