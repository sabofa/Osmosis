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

import { parseForRange, parseTuple, splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import type { Expr } from '../../../parser/types'
import { parseForDomain } from '../domain'
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

// The index of the bracket closing the one at `open` ("(" or "["), or -1.
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// A trailing "over <rect>", split off.
function splitOver(text: string, keyword: string): { rest: string; over: RectOver | null } {
  const idx = text.lastIndexOf(' over ')
  if (idx === -1) return { rest: text, over: null }
  const example = `${keyword}: takes "over x in [a, b], y in [c, d]" (a rectangle)`
  let domain
  try {
    domain = parseForDomain(text.slice(idx + ' over '.length))
  } catch (err) {
    throw new Error(`${example} — ${err instanceof Error ? err.message : String(err)}`)
  }
  if (domain.kind !== 'rect') throw new Error(example)
  return { rest: text.slice(0, idx).trim(), over: { x: domain.x, y: domain.y } }
}

// "<target> at <rest>": the target, and what follows "at".
function splitAt(text: string, keyword: string, example: string): { target: Expr; after: string } {
  const idx = text.indexOf(' at ')
  if (idx === -1) throw new Error(`Expected "${keyword}: ${example}", got "${keyword}: ${text}"`)
  return { target: parseExprString(text.slice(0, idx)), after: text.slice(idx + ' at '.length).trim() }
}

// "(a, b)" or "(a, b, c)" at the start of `text`, and the words after it.
function leadingPoint(text: string, keyword: string, example: string): { point: Expr[]; words: string[] } {
  if (!text.startsWith('(')) throw new Error(`Expected a point "(a, b)" after "at", e.g. "${keyword}: ${example}", got "${text}"`)
  const end = closing(text, 0)
  if (end === -1) throw new Error(`Unclosed "(" in the point "${text}"`)
  const point = parseTuple(text.slice(0, end + 1))
  const tail = text.slice(end + 1).trim()
  return { point, words: tail === '' ? [] : tail.split(/\s+/) }
}

// The words after a point, each one of `allowed`, none twice.
function flags(words: readonly string[], allowed: readonly string[], keyword: string): Set<string> {
  const out = new Set<string>()
  for (const w of words) {
    if (!allowed.includes(w)) {
      const takes = allowed.length ? `it takes ${allowed.map((a) => `"${a}"`).join(' or ')}` : 'nothing may follow it'
      throw new Error(`Unexpected "${w}" after the point in ${keyword}: — ${takes}`)
    }
    if (out.has(w)) throw new Error(`"${w}" is given twice`)
    out.add(w)
  }
  return out
}

// "<u1, u2>" or "⟨u1, u2⟩": a direction in the plane.
function planeVector(text: string, keyword: string): [Expr, Expr] {
  const t = text.trim()
  const bracketed = (t.startsWith('<') && t.endsWith('>')) || (t.startsWith('⟨') && t.endsWith('⟩'))
  if (!bracketed) throw new Error(`Expected a direction "<u1, u2>" after "toward" in ${keyword}:, got "${t}"`)
  const parts = splitTopLevelComma(t.slice(1, -1))
  if (parts.length !== 2) throw new Error(`A direction in the plane has two components, got ${parts.length} in "${t}"`)
  return [parseExprString(parts[0]), parseExprString(parts[1])]
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

// trace: <target> at x = a [tangent at y = b]   (or with x and y swapped)
function parseTrace(text: string): SurfaceToolForm {
  const { rest: styled, clauses } = splitStyle(text)
  const { rest, over } = splitOver(styled, 'trace')
  const example = 'f at x = 2 tangent at y = 1'
  const { target, after } = splitAt(rest, 'trace', example)
  const match = /^([xy])\s*=\s*(.+?)(?:\s+tangent\s+at\s+([a-z]+)\s*=\s*(.+))?$/.exec(after)
  if (!match) throw new Error(`Expected "trace: ${example}" (or "at y = 1 tangent at x = 2"), got "trace: ${text}"`)
  const axis = match[1] as 'x' | 'y'
  const other = axis === 'x' ? 'y' : 'x'
  if (match[3] !== undefined && match[3] !== other) {
    throw new Error(`The trace at ${axis} = … is a curve in ${other}, so its tangent is "tangent at ${other} = …", got "tangent at ${match[3]} = …"`)
  }
  return {
    form: 'trace',
    target,
    axis,
    at: parseExprString(match[2]),
    tangentAt: match[4] === undefined ? null : parseExprString(match[4]),
    over,
    style: toolStyle(clauses, 'trace', ['opacity', 'width']),
  }
}

// tangent-plane: <target> at (a, b) [normal], or at (x0, y0, z0)
function parseTangentPlane(text: string): SurfaceToolForm {
  const { rest: styled, clauses } = splitStyle(text)
  const { rest, over } = splitOver(styled, 'tangent-plane')
  const example = 'f at (1, 2) normal'
  const { target, after } = splitAt(rest, 'tangent-plane', example)
  const { point, words } = leadingPoint(after, 'tangent-plane', example)
  const set = flags(words, ['normal'], 'tangent-plane')
  return { form: 'tangentPlane', target, point, normal: set.has('normal'), over, style: toolStyle(clauses, 'tangent-plane', ['opacity']) }
}

// gradient: <target> at (a, b) [lifted], or at (x0, y0, z0) [surface]
function parseGradient(text: string): SurfaceToolForm {
  const { rest: styled, clauses } = splitStyle(text)
  const { rest, over } = splitOver(styled, 'gradient')
  const example = 'f at (1, 2)'
  const { target, after } = splitAt(rest, 'gradient', example)
  const { point, words } = leadingPoint(after, 'gradient', example)
  const set = flags(words, ['lifted', 'surface'], 'gradient')
  if (set.has('lifted') && point.length === 3) throw new Error('"lifted" applies to a gradient of f(x, y) at (a, b): a gradient in space is drawn at its point')
  if (set.has('surface') && point.length === 2) throw new Error('"surface" applies to a gradient of F(x, y, z) at (x0, y0, z0): it draws the level surface through the point')
  return { form: 'gradient', target, point, lifted: set.has('lifted'), surface: set.has('surface'), over, style: toolStyle(clauses, 'gradient', ['res']) }
}

// directional: <target> at (a, b) toward <u1, u2>
function parseDirectional(text: string): SurfaceToolForm {
  const { rest: styled, clauses } = splitStyle(text)
  const { rest, over } = splitOver(styled, 'directional')
  const example = 'f at (1, 2) toward <3, 4>'
  const { target, after } = splitAt(rest, 'directional', example)
  const toward = after.indexOf(' toward ')
  if (toward === -1) throw new Error(`Expected "directional: ${example}", got "directional: ${text}"`)
  return {
    form: 'directional',
    target,
    point: pair(after.slice(0, toward), 'directional:'),
    toward: planeVector(after.slice(toward + ' toward '.length), 'directional'),
    over,
    style: toolStyle(clauses, 'directional', ['opacity', 'width']),
  }
}

export const SURFACE_TOOL_KEYWORDS: readonly { keyword: string; parse(rest: string): SurfaceToolForm }[] = [
  { keyword: 'path', parse: parsePath },
  { keyword: 'trace', parse: parseTrace },
  { keyword: 'tangent-plane', parse: parseTangentPlane },
  { keyword: 'gradient', parse: parseGradient },
  { keyword: 'directional', parse: parseDirectional },
]
