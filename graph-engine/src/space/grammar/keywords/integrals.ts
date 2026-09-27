// The integral vocabulary (S5; spec SP9 rows 5.1-5.6):
//
//   region: <domain>                         a region on the floor, its area in the readout
//   R = region <domain>                      names it; draws nothing on its own
//   centroid: R [density <expr>]             the centroid (centre of mass) of a named region or volume
//
// <domain> is exactly what follows "over" on a surface (space/grammar/domain.ts):
// ranges (type I, type II, polar), an inequality, or a region's name.
//
// The keyword rows are spread onto the end of parseSpaceKeyword's table; the
// named forms are claimed by parseSpaceUnkeyed after its solid-figure
// exclusions ("G = centroid ABC" is a solid-figure construction and is never
// claimed here: only "NAME = region ..." is).

import { splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import type { Expr } from '../../../parser/types'
import { BUILTIN_NAMES } from '../../../math/compile'
import { parseOverDomain } from '../domain'
import { splitStyle, type RawClause, type StyleKey } from '../style'
import { spaceStatement, type Domain, type SpaceForm, type SpaceStatement, type SpaceStyle } from '../types'

export type IntegralForm =
  // "region: <domain>"
  | { form: 'region'; domain: Domain; style: SpaceStyle }
  // "R = region <domain>": binds R, draws nothing
  | { form: 'namedRegion'; name: string; domain: Domain }
  // "centroid: R [density <expr>]"
  | { form: 'centroid'; of: string; density: Expr | null; style: SpaceStyle }

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const COORDINATES = new Set(['x', 'y', 'z', 'r', 'theta', 'rho', 'phi'])

// What a clause is being applied to, and the clauses each takes. color: and
// name: are the shared loop's, stripped before the hooks run.
type IntegralTarget = 'region' | 'centroid'
const TAKES: Record<IntegralTarget, readonly StyleKey[]> = {
  region: ['opacity', 'res'],
  centroid: [],
}

function clauseLabel(key: StyleKey): string {
  return key === 'dashed' ? 'dashed' : `${key}:`
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/

// The style clauses an integral statement takes, validated here in its own
// words (buildStyle's messages name surfaces and curves).
function integralStyle(clauses: readonly RawClause[], target: IntegralTarget): SpaceStyle {
  const style: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }
  const seen = new Set<StyleKey>()
  const takes = TAKES[target]
  for (const { key, value } of clauses) {
    if (key === 'color' || key === 'name') {
      throw new Error(`write color: and name: after the other clauses, e.g. "region: x^2 + y^2 <= 4 opacity: 0.5 color: red"`)
    }
    if (!takes.includes(key)) {
      const list = takes.length === 0 ? 'only color:' : [...takes.map(clauseLabel), 'color:'].join(', ')
      throw new Error(`${clauseLabel(key)} does not apply to a ${target}, which takes ${list}`)
    }
    if (seen.has(key)) throw new Error(`${clauseLabel(key)} is given twice`)
    seen.add(key)
    if (!NUMBER.test(value)) throw new Error(`${key}: expects a number, got "${value}"`)
    const v = Number.parseFloat(value)
    if (key === 'opacity') {
      if (v < 0 || v > 1) throw new Error(`opacity: must be from 0 to 1, got ${value}`)
      style.opacity = v
    } else if (key === 'res') {
      if (!Number.isInteger(v) || v < 2 || v > 400) throw new Error(`res: must be a whole number from 2 to 400 on a ${target}, got ${value}`)
      style.res = v
    }
  }
  return style
}

// "<domain>", with a region's own message when the ranges do not pair up.
function regionDomain(text: string, shape: string): Domain {
  const body = text.trim()
  if (body === '') throw new Error(`Expected a region, e.g. "${shape}"`)
  if (/\sin\s*\[/.test(` ${body}`)) {
    const ranges = splitTopLevelComma(body)
    if (ranges.length !== 2) {
      throw new Error(`A region needs two ranges, x and y (or r and theta), got ${ranges.length}: "${shape}"`)
    }
  }
  return parseOverDomain(body)
}

function parseRegion(text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  return { form: 'region', domain: regionDomain(rest, 'region: x in [0, 1], y in [x^2, x]'), style: integralStyle(clauses, 'region') }
}

// "<expr> density <expr>" or "density: <expr>"
function splitDensity(text: string): { head: string; density: Expr | null } {
  const match = /\sdensity:?\s+/.exec(` ${text}`)
  if (!match) return { head: text.trim(), density: null }
  const at = match.index - 1
  return { head: text.slice(0, Math.max(at, 0)).trim(), density: parseExprString(text.slice(at + match[0].length)) }
}

function parseCentroid(text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  const { head, density } = splitDensity(rest)
  if (!NAME.test(head)) {
    throw new Error(`centroid: takes the name of a region or a volume, e.g. "R = region x in [0, 1], y in [0, x]" then "centroid: R", got "centroid: ${text.trim()}"`)
  }
  return { form: 'centroid', of: head, density, style: integralStyle(clauses, 'centroid') }
}

// Rows for parseSpaceKeyword's table.
export const INTEGRAL_KEYWORDS: readonly { keyword: string; parse(rest: string): SpaceForm }[] = [
  { keyword: 'region', parse: parseRegion },
  { keyword: 'centroid', parse: parseCentroid },
]

function checkName(name: string, what: string): void {
  if (COORDINATES.has(name)) throw new Error(`"${name}" is a coordinate, not a name for a ${what} — write e.g. "R = region ..."`)
  if (BUILTIN_NAMES.has(name) || name === 'pi' || name === 'e') throw new Error(`"${name}" is a built-in name, not a name for a ${what}`)
}

// "NAME = region <domain>", claimed by parseSpaceUnkeyed. Anything else,
// including "G = centroid ABC" and every other solid-figure construction, is
// left alone (null).
export function parseNamedIntegral(line: string): SpaceStatement | null {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*region\s+(.+)$/.exec(line.trim())
  if (!match) return null
  const [, name, body] = match
  checkName(name, 'region')
  const { rest, clauses } = splitStyle(body)
  if (clauses.some((c) => c.key !== 'color' && c.key !== 'name')) {
    throw new Error(`a named region draws nothing — style the statement that draws it, e.g. "region: ${name} opacity: 0.5"`)
  }
  return spaceStatement({ form: 'namedRegion', name, domain: regionDomain(rest, `${name} = region x in [0, 1], y in [x^2, x]`) })
}
