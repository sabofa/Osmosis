// parseSpaceKeyword: the hook parseStatementCore calls first (K5). It claims
// keyword-led space statements, one row per keyword, so phases S4 and S5 add
// rows ("contour:", "trace:", "plane:", ...) without touching the hook.
//
// In S1 the table has one row, "implicit:", the forced implicit-surface
// reading. "plane:" is not a row: "plane: A-B-C" and every point-list plane
// form belong to solid figures, whose refusal must still catch them. When S4
// adds space's "plane:" forms, that row must return null for them.

import { parseExprString } from '../../parser/parseExpr'
import { INTEGRAL_KEYWORDS } from './keywords/integrals'
import { buildStyle, splitStyle } from './style'
import { spaceStatement, type SpaceForm, type SpaceStatement } from './types'

interface KeywordRow {
  keyword: string
  // The text after "keyword:", trimmed. Throws on a malformed statement.
  parse(rest: string): SpaceForm
}

// "implicit: <equation> [style]": the surface reading of an equation, even one
// without z ("implicit: x^2 + y^2 = 4" is a cylinder).
function parseImplicit(text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  const eq = rest.indexOf('=')
  if (eq === -1 || rest.indexOf('=', eq + 1) !== -1 || /[<>]/.test(rest)) {
    throw new Error(`Expected "implicit: <equation>" with one "=", e.g. "implicit: x^2 + y^2 = 4", got "implicit: ${text}"`)
  }
  return {
    form: 'implicitSurface',
    left: parseExprString(rest.slice(0, eq)),
    right: parseExprString(rest.slice(eq + 1)),
    forced: true,
    style: buildStyle(clauses, 'implicit surface'),
  }
}

const KEYWORDS: readonly KeywordRow[] = [
  { keyword: 'implicit', parse: parseImplicit },
  ...INTEGRAL_KEYWORDS,
]

// An operand that is only a hyphenated point list ("A-B-C") belongs to
// solid figures, whatever the keyword: it is never claimed.
const POINT_LIST = /^[A-Z][A-Za-z0-9']*(\s*-\s*[A-Z][A-Za-z0-9']*)+$/

export function parseSpaceKeyword(line: string): SpaceStatement | null {
  for (const row of KEYWORDS) {
    if (!line.startsWith(`${row.keyword}:`)) continue
    const rest = line.slice(row.keyword.length + 1).trim()
    if (POINT_LIST.test(rest)) return null
    return spaceStatement(row.parse(rest))
  }
  return null
}
