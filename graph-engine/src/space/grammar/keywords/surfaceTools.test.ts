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
