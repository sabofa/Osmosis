// "frame:", "osculating:" and "motion:" (plan A6; SP9 rows 3.1-3.4).
//
//   frame: r at t = 1                   T, N and B at r(1)
//   osculating: r at t = 1              the osculating circle; takes width:, dashed
//   motion: r at t = 1 [components]     v and a, and with "components" the
//                                       tangential and normal parts of a
//
// The curve is a vector function's name ("r", or "r(t)"), or an inline
// "<cos(s), sin(s), s>" (a tuple works too) whose parameter "at" names. The
// value may read parameters.

import { parseExprString } from '../../../parser/parseExpr'
import { splitStyle } from '../style'
import type { SpaceForm } from '../types'
import { parseVectorLiteral } from '../vector'
import type { CurveOperand } from './geometryForms'
import { keywordStyle, topLevel } from './shared'

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const CALL = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^()]*\)$/

function parseCurveOperand(text: string): CurveOperand {
  const t = text.trim()
  if (NAME.test(t)) return { kind: 'named', name: t, text: t }
  const call = CALL.exec(t)
  if (call) return { kind: 'named', name: call[1], text: t }
  const components = parseVectorLiteral(t, true)
  if (components) return { kind: 'inline', components, text: t }
  throw new Error(`Expected a curve — a vector function's name "r" or "<cos(t), sin(t), t>" — got "${t}"`)
}

function parseCurveStatement(keyword: 'frame' | 'osculating' | 'motion', text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  let body = rest.trim()
  let components = false
  const flag = /\s+components$/.exec(body)
  if (flag) {
    if (keyword !== 'motion') throw new Error('"components" belongs to motion: — the tangential and normal parts of a')
    components = true
    body = body.slice(0, flag.index).trimEnd()
  }
  const usage = `Expected "${keyword}: r at t = 1" — a curve, then its parameter's value — got "${keyword}: ${body}"`
  const at = topLevel(body, /\s+at\s+/).pop()
  if (!at) throw new Error(usage)
  const where = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=(.+)$/.exec(body.slice(at.index + at[0].length).trim())
  if (!where) throw new Error(usage)
  return {
    form: keyword,
    curve: parseCurveOperand(body.slice(0, at.index)),
    param: where[1],
    at: parseExprString(where[2]),
    components,
    style: keywordStyle(clauses, keyword === 'osculating' ? ['width', 'dashed'] : [], keyword),
  }
}

export function parseFrame(text: string): SpaceForm {
  return parseCurveStatement('frame', text)
}

export function parseOsculating(text: string): SpaceForm {
  return parseCurveStatement('osculating', text)
}

export function parseMotion(text: string): SpaceForm {
  return parseCurveStatement('motion', text)
}
