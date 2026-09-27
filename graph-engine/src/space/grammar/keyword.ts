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
import { parseFrame, parseMotion, parseOsculating } from './keywords/curves'
import { SURFACE_TOOL_KEYWORDS } from './keywords/surfaceTools'

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
  { keyword: 'frame', parse: parseFrame },
  { keyword: 'osculating', parse: parseOsculating },
  { keyword: 'motion', parse: parseMotion },
  ...SURFACE_TOOL_KEYWORDS,
]

// The uniform ownership rule (agreed with solid figures, 2026-09-26): an
// operand that is only a hyphenated list of point names ("A-B", "A-B-C-D",
// "A - B", "a-b"), optionally followed by "dashed" or "plain", belongs to a
// solid figure whatever the keyword, so "plane: A-B-C" and "path: A-B-C-D" are
// never claimed here. One rule, the union of S4a's and S4b's spellings.
const POINT_LIST_TIGHT = /^[A-Za-z][A-Za-z0-9_']*(-[A-Za-z][A-Za-z0-9_']*)+(\s+(dashed|plain))?$/
const POINT_LIST_SPACED = /^[A-Z][A-Za-z0-9_]*'*(\s*-\s*[A-Z][A-Za-z0-9_]*'*)+(\s+(dashed|plain))?$/

// Lowercase names ("a-b") are only a point list under the keywords where a
// drawn point list is plausible; elsewhere "f-g" is an expression, as in
// "critical: f-g".
const LOWERCASE_POINT_LIST_KEYWORDS: ReadonlySet<string> = new Set(['line', 'plane', 'path'])

function isPointList(keyword: string, operand: string): boolean {
  if (POINT_LIST_SPACED.test(operand)) return true
  return LOWERCASE_POINT_LIST_KEYWORDS.has(keyword) && POINT_LIST_TIGHT.test(operand)
}

export function parseSpaceKeyword(line: string): SpaceStatement | null {
  for (const row of KEYWORDS) {
    if (!line.startsWith(`${row.keyword}:`)) continue
    const operand = line.slice(row.keyword.length + 1).trim()
    if (isPointList(row.keyword, operand)) return null
    const form = row.parse(operand)
    return form ? spaceStatement(form) : null
  }
  return null
}
