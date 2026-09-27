// parseSpaceKeyword: the hook parseStatementCore calls first (K5). It claims
// keyword-led space statements, one row per keyword, so phases S4 and S5 add
// rows ("contour:", "trace:", "plane:", ...) without touching the hook.
//
// In S1 the table has one row, "implicit:", the forced implicit-surface
// reading. S4a adds contour:, line:, plane:, cross:, project:, cylindrical:,
// spherical:, frame:, osculating: and motion:.
//
// One rule holds for every keyword, agreed with the solid-figure side
// (2026-09-26): a statement whose operand is only a hyphenated list of point
// names ("A-B", "A-B-C", ...), optionally followed by "dashed" or "plain", is
// never claimed. "line: A-B", "plane: A-B-C" and "path: A-B-C-D" stay
// solid-figure territory, and the solid-figure refusal still catches them.

import { parseExprString } from '../../parser/parseExpr'
import { buildStyle, splitStyle } from './style'
import { spaceStatement, type SpaceForm, type SpaceStatement } from './types'
import { parseContour } from './keywords/contour'
import { parseLine, parsePlane } from './keywords/geometry'
import { parseCross, parseProject } from './keywords/vectors'
import { parseCylindrical, parseSpherical } from './keywords/coordinates'

interface KeywordRow {
  keyword: string
  // The text after "keyword:", trimmed. Throws on a malformed statement;
  // null leaves the line to the shared grammar (a solid figure's form).
  parse(rest: string): SpaceForm | null
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
  { keyword: 'contour', parse: parseContour },
  { keyword: 'line', parse: parseLine },
  { keyword: 'plane', parse: parsePlane },
  { keyword: 'cross', parse: parseCross },
  { keyword: 'project', parse: parseProject },
  { keyword: 'cylindrical', parse: parseCylindrical },
  { keyword: 'spherical', parse: parseSpherical },
]

// "keyword: A-B-C [dashed | plain]": a solid figure's point list.
const POINT_LIST = /^[a-z][a-z-]*:\s*[A-Za-z][A-Za-z0-9_']*(-[A-Za-z][A-Za-z0-9_']*)+(\s+(dashed|plain))?\s*$/

export function parseSpaceKeyword(line: string): SpaceStatement | null {
  if (POINT_LIST.test(line)) return null
  for (const row of KEYWORDS) {
    if (!line.startsWith(`${row.keyword}:`)) continue
    const form = row.parse(line.slice(row.keyword.length + 1).trim())
    return form ? spaceStatement(form) : null
  }
  return null
}
