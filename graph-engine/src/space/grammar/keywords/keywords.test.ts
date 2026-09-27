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
