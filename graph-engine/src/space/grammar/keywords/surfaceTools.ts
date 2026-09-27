// The calculus of a surface (S4b; SP9 rows 4.2-4.8): one keyword row per
// statement, each taking a TARGET, a function of x and y — a defined name
// ("f") or an inline expression ("x^2 - y^2") — or, where noted, of x, y and
// z. Which it is, is decided in the kernel, which has the scope.
//
//   path: on f along (t, t^2) for t in [-1, 1] [toward (0, 0)]
//   trace: f at x = 2 [tangent at y = 1]          (or "at y = 1 [tangent at x = 2]")
//   tangent-plane: f at (1, 2) [normal]           (F at (1, 1, 1) for three variables)
//   gradient: f at (1, 2) [lifted]                (F at (1, 1, 1) [surface])
//   directional: f at (1, 2) toward <3, 4>
//   critical: f
//   lagrange: max f subject to g = c              (also min, extrema)
//
// Every statement but path: takes "over x in [a, b], y in [c, d]" for its
// domain; without it, the domain is the box's x/y range (@bounds3d, else
// [-5, 5]^2). Points are expressions, so they may read parameters.
//
// contour: is shared with S4a, which owns its grammar; S4b owns the builder of
// a two-variable contour (kernel/surfaceTools/contours.ts).

import { parseForRange, parseTuple } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import type { Expr } from '../../../parser/types'
import { splitStyle, type RawClause, type StyleKey } from '../style'
import type { ParamRange, SpaceStyle } from '../types'

// "over x in [a, b], y in [c, d]": a rectangle, bounds constant in x and y.
export interface RectOver {
  x: ParamRange
  y: ParamRange
}

export type SurfaceToolForm =
  | { form: 'path'; target: Expr; along: [Expr, Expr]; t: ParamRange; toward: [Expr, Expr] | null; style: SpaceStyle }
  | { form: 'trace'; target: Expr; axis: 'x' | 'y'; at: Expr; tangentAt: Expr | null; over: RectOver | null; style: SpaceStyle }
  | { form: 'tangentPlane'; target: Expr; point: Expr[]; normal: boolean; over: RectOver | null; style: SpaceStyle }
  | { form: 'gradient'; target: Expr; point: Expr[]; lifted: boolean; surface: boolean; over: RectOver | null; style: SpaceStyle }
  | { form: 'directional'; target: Expr; point: [Expr, Expr]; toward: [Expr, Expr]; over: RectOver | null; style: SpaceStyle }
  | { form: 'critical'; target: Expr; over: RectOver | null; style: SpaceStyle }
  | {
      form: 'lagrange'
      goal: 'max' | 'min' | 'extrema'
      target: Expr
      constraint: Expr
      level: Expr
      over: RectOver | null
      style: SpaceStyle
    }

const NO_STYLE: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/

function label(key: StyleKey): string {
  return key === 'dashed' ? 'dashed' : `${key}:`
}

function numberOf(key: string, value: string): number {
  if (!NUMBER.test(value)) throw new Error(`${key}: expects a number, got "${value}"`)
  return Number.parseFloat(value)
}

// The style clauses a tool takes: opacity: on its meshes, width: on its main
// curve, res: where it samples (segments along a path, the grid a level curve
// is traced on). Anything else is refused by the statement's name.
function toolStyle(clauses: readonly RawClause[], keyword: string, allowed: readonly StyleKey[], maxRes = 400): SpaceStyle {
  const style: SpaceStyle = { ...NO_STYLE }
  const seen = new Set<StyleKey>()
  for (const { key, value } of clauses) {
    if (key === 'color' || key === 'name') {
      throw new Error(`write color: and name: after the other clauses, e.g. "${keyword}: … ${allowed.length ? `${label(allowed[0])} … ` : ''}color: red"`)
    }
    if (!allowed.includes(key)) {
      const takes = allowed.length ? `it takes ${allowed.map(label).join(', ')}, color: and name:` : 'it takes only color: and name:'
      throw new Error(`${label(key)} does not apply to ${keyword}: — ${takes}`)
    }
    if (seen.has(key)) throw new Error(`${label(key)} is given twice`)
    seen.add(key)
    const v = numberOf(key, value)
    if (key === 'opacity') {
      if (v < 0 || v > 1) throw new Error(`opacity: must be from 0 to 1, got ${value}`)
      style.opacity = v
    } else if (key === 'width') {
      if (!(v > 0)) throw new Error(`width: must be positive, got ${value}`)
      style.width = v
    } else if (key === 'res') {
      if (!Number.isInteger(v) || v < 2 || v > maxRes) throw new Error(`res: must be a whole number from 2 to ${maxRes} on ${keyword}:, got ${value}`)
      style.res = v
    }
  }
  return style
}

function pair(text: string, what: string): [Expr, Expr] {
  const tuple = parseTuple(text)
  if (tuple.length !== 2) throw new Error(`${what} takes two coordinates "(a, b)", got "${text.trim()}"`)
  return [tuple[0], tuple[1]]
}

// path: on <target> along (x(t), y(t)) for t in [a, b] [toward (x0, y0)]
function parsePath(text: string): SurfaceToolForm {
  const { rest: body, clauses } = splitStyle(text)
  const example = 'on f along (t, t^2) for t in [-1, 1]'
  const along = body.indexOf(' along ')
  const forIdx = body.indexOf(' for ', along)
  if (!body.startsWith('on ') || along === -1 || forIdx === -1) {
    throw new Error(`Expected "path: ${example}" (optionally "toward (x0, y0)"), got "path: ${text}"`)
  }
  const target = parseExprString(body.slice('on '.length, along))
  const curve = pair(body.slice(along + ' along '.length, forIdx), 'A path along a curve')
  const towardIdx = body.indexOf(' toward ', forIdx)
  const rangeText = body.slice(forIdx + ' for '.length, towardIdx === -1 ? undefined : towardIdx)
  const t = parseForRange(rangeText.trim())
  const toward = towardIdx === -1 ? null : pair(body.slice(towardIdx + ' toward '.length), '"toward"')
  return { form: 'path', target, along: curve, t, toward, style: toolStyle(clauses, 'path', ['width', 'res'], 10000) }
}

export const SURFACE_TOOL_KEYWORDS: readonly { keyword: string; parse(rest: string): SurfaceToolForm }[] = [
  { keyword: 'path', parse: parsePath },
]
