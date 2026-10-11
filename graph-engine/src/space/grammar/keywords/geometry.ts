// "line:" and "plane:" (plan A3; SP9 row 2.5).
//
//   line: through (1, 2, 3) direction <1, -1, 2>
//   line: through P and Q                       named points or tuples
//   plane: 2x + y - z = 3                       an equation affine in x, y, z
//   plane: through (1, 2, 3) normal <1, 1, 1>
//   plane: through P, Q, R                      three points
//
// A line takes width: and dashed; a plane takes opacity:. Both are drawn
// clipped exactly to the box (kernel/geometry/planes.ts).
//
// "plane:" never claims the solid figures' plane forms, whose refusal ("A
// plane is not drawn on its own ...") must still reach them: a point list
// ("plane: A-B-C", by parseSpaceKeyword's uniform rule), a named plane
// ("plane: p"), and "through P perpendicular to A-B" / "through P parallel
// to A-B-C".

import { splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import { splitStyle } from '../style'
import type { SpaceForm } from '../types'
import { parsePointOperand, parseVectorOperand } from './operands'
import { keywordStyle } from './shared'

export function parseLine(text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  const body = rest.trim()
  const style = () => keywordStyle(clauses, ['width', 'dashed'], 'line')
  const direction = /^through\s+(.+?)\s+direction\s+(.+)$/.exec(body)
  if (direction) {
    return {
      form: 'line',
      through: parsePointOperand(direction[1]),
      to: { kind: 'direction', vector: parseVectorOperand(direction[2]) },
      text: body,
      style: style(),
    }
  }
  const two = /^through\s+(.+?)\s+and\s+(.+)$/.exec(body)
  if (two) {
    return { form: 'line', through: parsePointOperand(two[1]), to: { kind: 'point', point: parsePointOperand(two[2]) }, text: body, style: style() }
  }
  throw new Error(`Expected "line: through (1, 2, 3) direction <1, -1, 2>" or "line: through P and Q", got "line: ${body}"`)
}

const PLANE_USAGE = '"plane: 2x + y - z = 3", "plane: through P normal <1, 1, 1>" or "plane: through P, Q, R"'

const SOLID_FIGURE_PLANE = /^([a-zA-Z_][a-zA-Z0-9_]*|through\s+\S+\s+(perpendicular|parallel)\s+to\s.*)$/

export function parsePlane(text: string): SpaceForm | null {
  const { rest, clauses } = splitStyle(text)
  const body = rest.trim()
  if (SOLID_FIGURE_PLANE.test(body)) return null
  const style = () => keywordStyle(clauses, ['opacity'], 'plane')
  if (/^through\s/.test(body)) {
    const operands = body.slice('through'.length).trim()
    const normal = /^(.+?)\s+normal\s+(.+)$/.exec(operands)
    if (normal) {
      return {
        form: 'plane',
        def: { kind: 'pointNormal', point: parsePointOperand(normal[1]), normal: parseVectorOperand(normal[2]) },
        text: body,
        style: style(),
      }
    }
    const points = splitTopLevelComma(operands)
    if (points.length === 3) {
      const [p, q, r] = points.map(parsePointOperand)
      return { form: 'plane', def: { kind: 'points', points: [p, q, r] }, text: body, style: style() }
    }
    throw new Error(`Expected ${PLANE_USAGE}, got "plane: ${body}"`)
  }
  const eq = body.indexOf('=')
  if (eq === -1 || /[<>]/.test(body)) throw new Error(`Expected ${PLANE_USAGE}, got "plane: ${body}"`)
  if (body.indexOf('=', eq + 1) !== -1) throw new Error(`A plane's equation has one "=", got "plane: ${body}"`)
  return {
    form: 'plane',
    def: { kind: 'equation', left: parseExprString(body.slice(0, eq)), right: parseExprString(body.slice(eq + 1)) },
    text: body,
    style: style(),
  }
}
