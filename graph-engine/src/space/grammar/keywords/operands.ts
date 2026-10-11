// Operands of S4a's keyword statements: points and vectors (plan A3, A4).
//
//   point:   "(1, 2, 3)", or a name ("P") defined elsewhere by "P = (1, 2, 3)"
//   vector:  "<1, 2, 3>" or "⟨1, 2, 3⟩", a vector constant's name ("u", from
//            "u = <1, 2, 3>"), or a vector function at a point ("F(1, 0, 2)")
//
// A tuple means a point, never a vector (SP2), so "(1, 0, 0)" where a vector
// is expected is refused with the way to write one. Names are resolved by the
// kernel, which knows the spec's points and definitions.

import { splitTopLevelComma, stripOuterParens } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import { parseVectorLiteral } from '../vector'
import type { PointOperand, VectorOperand } from './geometryForms'

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const CALL = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/

export function parsePointOperand(text: string): PointOperand {
  const t = text.trim()
  if (NAME.test(t)) return { kind: 'name', name: t, text: t }
  if (t.startsWith('(') && t.endsWith(')')) {
    const parts = splitTopLevelComma(stripOuterParens(t))
    if (parts.length !== 3) throw new Error(`A point in space has three coordinates, got ${parts.length} in "${t}"`)
    return { kind: 'tuple', coords: [parseExprString(parts[0]), parseExprString(parts[1]), parseExprString(parts[2])], text: t }
  }
  throw new Error(`Expected a point — "(1, 2, 3)" or a point's name — got "${t}"`)
}

export function parseVectorOperand(text: string): VectorOperand {
  const t = text.trim()
  const literal = parseVectorLiteral(t, false)
  if (literal) return { kind: 'literal', components: literal, text: t }
  if (NAME.test(t)) return { kind: 'named', name: t, args: null, text: t }
  const call = CALL.exec(t)
  if (call) return { kind: 'named', name: call[1], args: splitTopLevelComma(call[2]).map((a) => parseExprString(a)), text: t }
  if (t.startsWith('(') && t.endsWith(')')) {
    throw new Error(`"${t}" is a point; a vector is written <${t.slice(1, -1).trim()}>`)
  }
  throw new Error(`Expected a vector — "<1, 2, 3>", a vector's name or "F(1, 0, 2)" — got "${t}"`)
}
