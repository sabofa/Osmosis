// The integral vocabulary (S5; spec SP9 rows 5.1-5.6):
//
//   region: <domain>                         a region on the floor, its area in the readout
//   R = region <domain>                      names it; draws nothing on its own
//   volume: under f over <domain>            the solid under z = f, with its walls; the double integral
//   volume: between g and f over <domain>    the solid between z = g (bottom) and z = f (top)
//   riemann: under f over x in [a, b], y in [c, d], n = 4 [by 3] [sample: mid]
//                                            Riemann boxes, the sum beside the integral
//   volume: x in [..], y in [..], z in [..] [cylindrical | spherical] [integrand <expr>]
//                                            an iterated triple-integral region, any order
//   V = volume <any volume>                  names it; volume: V draws it
//   centroid: R [density <expr>]             the centroid (centre of mass) of a named region or volume
//
// <domain> is exactly what follows "over" on a surface (space/grammar/domain.ts):
// ranges (type I, type II, polar), an inequality, or a region's name. f and g
// are targets: a defined function of x and y, or an expression in x and y (and
// r and theta over a polar region).
//
// The keyword rows are spread onto the end of parseSpaceKeyword's table; the
// named forms are claimed by parseSpaceUnkeyed after its solid-figure
// exclusions ("G = centroid ABC" is a solid-figure construction and is never
// claimed here: only "NAME = region ..." and "NAME = volume ..." are).

import { parseForRange, splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import type { Expr } from '../../../parser/types'
import { isClassicBuiltin } from '../shadowable'
import { readNames } from '../reads'
import { parseOverDomain } from '../domain'
import { splitStyle, STYLE_CLAUSE_START, type RawClause, type StyleKey } from '../style'
import { spaceStatement, type Domain, type ParamRange, type SpaceForm, type SpaceStatement, type SpaceStyle } from '../types'

// A function of two variables as written: a defined name or an expression.
export interface Target {
  expr: Expr
  text: string
}

// Where a Riemann box's height is sampled, in its cell.
export type SampleRule = 'mid' | 'lower-left' | 'upper-right' | 'lower-right' | 'upper-left' | 'random'
const SAMPLE_RULES: readonly SampleRule[] = ['mid', 'lower-left', 'upper-right', 'lower-right', 'upper-left', 'random']

export type Coordinates3 = 'rectangular' | 'cylindrical' | 'spherical'

// What a volume: statement fills. "between" with no bottom is "under" (z = 0).
// "iterated" holds its ranges outer to inner, read from their dependencies.
export type VolumeSolid =
  | { kind: 'between'; top: Target; bottom: Target | null; region: Domain }
  | { kind: 'iterated'; coords: Coordinates3; order: [ParamRange, ParamRange, ParamRange]; integrand: Target | null }
  | { kind: 'named'; name: string }

export type IntegralForm =
  // "region: <domain>"
  | { form: 'region'; domain: Domain; style: SpaceStyle }
  // "R = region <domain>": binds R, draws nothing
  | { form: 'namedRegion'; name: string; domain: Domain }
  // "volume: under f over R", "volume: between g and f over R", "volume: x in [..], ...", "volume: V"
  | { form: 'volume'; solid: VolumeSolid; style: SpaceStyle }
  // "V = volume ...": binds V, draws nothing
  | { form: 'namedVolume'; name: string; solid: VolumeSolid }
  // "riemann: under f over x in [a, b], y in [c, d], n = nx [by ny] [sample: <rule>]"
  | { form: 'riemann'; target: Target; region: Domain; n: [Expr, Expr]; sample: SampleRule; style: SpaceStyle }
  // "centroid: R [density <expr>]"
  | { form: 'centroid'; of: string; density: Expr | null; style: SpaceStyle }

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const COORDINATES = new Set(['x', 'y', 'z', 'r', 'theta', 'rho', 'phi'])

// What a clause is being applied to, and the clauses each takes. color: and
// name: are the shared loop's, stripped before the hooks run.
type IntegralTarget = 'region' | 'volume' | 'Riemann sum' | 'centroid'
const TAKES: Record<IntegralTarget, readonly StyleKey[]> = {
  region: ['opacity', 'res'],
  volume: ['opacity', 'res', 'mesh'],
  'Riemann sum': ['opacity'],
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
    if (key === 'mesh') {
      if (value !== 'on' && value !== 'off') throw new Error(`mesh: must be "on" or "off", got "${value}"`)
      style.mesh = value === 'on'
      continue
    }
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


// Takes "<keyword> <value>" out of `text` wherever it stands, before or after
// the style clauses: its value runs to the next style clause or the end.
function pull(text: string, keyword: RegExp): { rest: string; value: string | null } {
  const m = keyword.exec(text)
  if (!m) return { rest: text.trim(), value: null }
  const from = m.index + m[0].length
  const next = STYLE_CLAUSE_START.exec(text.slice(from))
  const to = next ? from + next.index : text.length
  return { rest: `${text.slice(0, m.index)}${text.slice(to)}`.trim(), value: text.slice(from, to).trim() }
}

// A hyphenated point list ("A-B-C") is a solid-figure operand, never claimed.
const POINT_LIST = /^[A-Z][A-Za-z0-9']*(\s*-\s*[A-Z][A-Za-z0-9']*)+$/

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

function target(text: string, shape: string): Target {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error(`Expected a function of x and y, e.g. "${shape}"`)
  return { expr: parseExprString(trimmed), text: trimmed }
}

const SYSTEMS: Record<Coordinates3, readonly string[]> = {
  rectangular: ['x', 'y', 'z'],
  cylindrical: ['r', 'theta', 'z'],
  spherical: ['rho', 'phi', 'theta'],
}

function describe(names: readonly string[]): string {
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// The ranges outer to inner: the outer variable's bounds are constant, the
// middle's read at most the outer, the inner's read either. Among the orders
// that work, the written one wins. None working is refused, naming the bounds
// that read each other.
function chainOrder(ranges: readonly ParamRange[]): [ParamRange, ParamRange, ParamRange] {
  const names = ranges.map((r) => r.param)
  const reads = ranges.map((r) => {
    const used = readNames(r.to, names, readNames(r.from, names))
    return names.filter((n) => used.has(n))
  })
  ranges.forEach((r, i) => {
    if (reads[i].includes(r.param)) throw new Error(`the bounds of ${r.param} read ${r.param} itself`)
  })
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  for (const [o, m, i] of orders) {
    if (reads[o].length === 0 && reads[m].every((n) => n === names[o])) return [ranges[o], ranges[m], ranges[i]]
  }
  const hint = 'the outer bounds must be constant and each inner pair may read only what is outside it, e.g. "x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]"'
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      if (reads[a].includes(names[b]) && reads[b].includes(names[a])) {
        throw new Error(`the bounds of ${names[a]} read ${names[b]}, and the bounds of ${names[b]} read ${names[a]} — ${hint}`)
      }
    }
  }
  // No pair reads each other, so the three read round a cycle.
  const next = (i: number) => names.indexOf(reads[i][0])
  const second = next(0)
  const third = next(second)
  throw new Error(`the bounds of ${names[0]} read ${names[second]}, ${names[second]}'s read ${names[third]} and ${names[third]}'s read ${names[next(third)]} — ${hint}`)
}

// A volume's own clauses, taken out wherever they stand (before or after the
// style clauses): "integrand[:] <expr>" and the coordinate system's name.
interface VolumeClauses {
  rest: string
  integrand: Target | null
  coords: Coordinates3 | null
}

const SYSTEM_WORD = /\s(cylindrical|spherical|rectangular)(?=\s|$)/

function volumeClauses(text: string): VolumeClauses {
  let coords: Coordinates3 | null = null
  const word = (t: string) => {
    const m = SYSTEM_WORD.exec(` ${t}`)
    if (!m) return t
    if (coords && coords !== m[1]) throw new Error(`a volume is in one coordinate system, got ${coords} and ${m[1]}`)
    coords = m[1] as Coordinates3
    return `${` ${t}`.slice(0, m.index)}${` ${t}`.slice(m.index + m[0].length)}`.trim()
  }
  const { rest, value } = pull(` ${text}`, /\sintegrand:?\s+/)
  const integrand = value === null ? null : target(word(value), 'volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y] integrand x')
  return { rest: word(rest), integrand, coords }
}

// "x in [..], y in [..], z in [..]", in the system named (rectangular when
// none is), with its integrand.
function parseIterated(text: string, integrand: Target | null, system: Coordinates3 | null): VolumeSolid {
  const coords: Coordinates3 = system ?? 'rectangular'
  const parts = splitTopLevelComma(text.trim())
  if (parts.length !== 3) {
    throw new Error(`A triple-integral region needs three ranges, got ${parts.length}: "volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]"`)
  }
  const ranges = parts.map((part) => parseForRange(part.trim()))
  const names = ranges.map((r) => r.param).sort()
  if (names.join(',') !== [...SYSTEMS[coords]].sort().join(',')) {
    for (const other of ['cylindrical', 'spherical'] as const) {
      if (coords === 'rectangular' && names.join(',') === [...SYSTEMS[other]].sort().join(',')) {
        throw new Error(`${describe(SYSTEMS[other])} are ${other} coordinates — add "${other}" after the ranges`)
      }
    }
    throw new Error(`A ${coords} volume is over ${describe(SYSTEMS[coords])}, got ${describe(ranges.map((r) => r.param))}`)
  }
  if (coords !== 'rectangular') {
    for (const r of ranges) {
      const foreign = ['x', 'y', 'z'].find((v) => !SYSTEMS[coords].includes(v) && readNames(r.to, ['x', 'y', 'z'], readNames(r.from, ['x', 'y', 'z'])).has(v))
      if (foreign) {
        throw new Error(`bounds in ${coords} coordinates may use ${describe(SYSTEMS[coords])}, not ${foreign} — the bounds of ${r.param} read ${foreign}`)
      }
    }
  }
  return { kind: 'iterated', coords, order: chainOrder(ranges), integrand }
}

// Every volume: form but its style.
function parseVolumeSolid(rest: string, clauses: VolumeClauses): VolumeSolid {
  if (/\sin\s*\[/.test(` ${rest}`) && !/^(under|between)\s/.test(rest)) return parseIterated(rest, clauses.integrand, clauses.coords)
  if (clauses.integrand || clauses.coords) {
    throw new Error(`${clauses.integrand ? 'integrand' : clauses.coords} applies to a triple-integral region, e.g. "volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y] integrand x"`)
  }
  if (NAME.test(rest)) return { kind: 'named', name: rest }
  const under = /^under\s+(.+)$/.exec(rest)
  if (under) {
    const shape = 'volume: under f over R'
    const over = under[1].indexOf(' over ')
    if (over < 0) throw new Error(`Expected "${shape}", e.g. "volume: under 4 - x^2 - y^2 over x^2 + y^2 <= 4", got "volume: ${rest}"`)
    const region = regionDomain(under[1].slice(over + ' over '.length), shape)
    return { kind: 'between', top: target(under[1].slice(0, over), shape), bottom: null, region }
  }
  const between = /^between\s+(.+)$/.exec(rest)
  if (between) {
    const shape = 'volume: between g and f over R'
    const over = between[1].indexOf(' over ')
    const and = between[1].indexOf(' and ')
    if (over < 0 || and < 0 || and > over) {
      throw new Error(`Expected "${shape}" (g the bottom, f the top), e.g. "volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]", got "volume: ${rest}"`)
    }
    const bottom = target(between[1].slice(0, and), shape)
    const top = target(between[1].slice(and + ' and '.length, over), shape)
    return { kind: 'between', top, bottom, region: regionDomain(between[1].slice(over + ' over '.length), shape) }
  }
  throw new Error(
    `Expected "volume: under f over R", "volume: between g and f over R" or "volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]", got "volume: ${rest}"`,
  )
}

function parseVolume(text: string): SpaceForm {
  const own = volumeClauses(text)
  const { rest, clauses } = splitStyle(own.rest)
  return { form: 'volume', solid: parseVolumeSolid(rest.trim(), own), style: integralStyle(clauses, 'volume') }
}

export const RIEMANN_RECTANGLE = 'Riemann boxes need a rectangle; use x in [a, b], y in [c, d]'

// Whether an iterated region's inner bounds read its outer variable.
export function readsOuter(region: Extract<Domain, { kind: 'iterated' }>): boolean {
  const outer = [region.outer.param]
  return readNames(region.inner.to, outer, readNames(region.inner.from, outer)).has(region.outer.param)
}

// "under f over x in [a, b], y in [c, d], n = 4 [by 3] [sample: <rule>]". A
// named region is checked for being a rectangle where it is resolved.
function parseRiemann(text: string): SpaceForm {
  const shape = 'riemann: under f over x in [0, 2], y in [0, 2], n = 4'
  // sample: may stand before or after the style clauses.
  const rule = pull(` ${text}`, /\ssample:\s*/)
  const { rest, clauses } = splitStyle(rule.rest)
  const style = integralStyle(clauses, 'Riemann sum')
  let sample: SampleRule = 'mid'
  if (rule.value !== null) {
    if (!(SAMPLE_RULES as readonly string[]).includes(rule.value)) {
      throw new Error(`sample: mid, lower-left, upper-right, lower-right, upper-left or random, got "${rule.value}"`)
    }
    sample = rule.value as SampleRule
  }
  const under = /^under\s+(.+)$/.exec(rest)
  const over = under ? under[1].indexOf(' over ') : -1
  if (!under || over < 0) throw new Error(`Expected "${shape}", got "riemann: ${text.trim()}"`)
  const parts = splitTopLevelComma(under[1].slice(over + ' over '.length))
  const last = /^\s*n\s*=\s*(.+)$/.exec(parts[parts.length - 1])
  if (parts.length < 2 || !last) throw new Error(`Riemann boxes need a count, n: "${shape}" (or "n = 4 by 3")`)
  const counts = last[1].split(/\s+by\s+/)
  if (counts.length > 2) throw new Error(`n takes one count or two, "n = 4" or "n = 4 by 3", got "n = ${last[1].trim()}"`)
  const nx = parseExprString(counts[0])
  const ny = counts.length === 2 ? parseExprString(counts[1]) : nx
  const region = parseOverDomain(parts.slice(0, -1).join(','))
  if (region.kind === 'inequality' || (region.kind === 'iterated' && (region.coords !== 'cartesian' || readsOuter(region)))) {
    throw new Error(RIEMANN_RECTANGLE)
  }
  return { form: 'riemann', target: target(under[1].slice(0, over), shape), region, n: [nx, ny], sample, style }
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
  { keyword: 'volume', parse: parseVolume },
  { keyword: 'riemann', parse: parseRiemann },
]

function checkName(name: string, what: string): void {
  if (COORDINATES.has(name)) throw new Error(`"${name}" is a coordinate, not a name for a ${what} — write e.g. "R = region ..."`)
  if (isClassicBuiltin(name) || name === 'pi' || name === 'e') throw new Error(`"${name}" is a built-in name, not a name for a ${what}`)
}

// "NAME = region <domain>" and "NAME = volume <volume>", claimed by
// parseSpaceUnkeyed. Anything else, including "G = centroid ABC" and every
// other solid-figure construction, is left alone (null), and so is
// "NAME = volume of ...", which is no space form.
export function parseNamedIntegral(line: string): SpaceStatement | null {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(region|volume)\s+(.+)$/.exec(line.trim())
  if (!match) return null
  const [, name, kind, body] = match
  if ((kind === 'volume' && /^of\s/.test(body)) || POINT_LIST.test(body.trim())) return null
  checkName(name, kind)
  const own = kind === 'volume' ? volumeClauses(body) : { rest: body, integrand: null, coords: null }
  const { rest, clauses } = splitStyle(own.rest)
  if (clauses.some((c) => c.key !== 'color' && c.key !== 'name')) {
    throw new Error(`a named ${kind} draws nothing — style the statement that draws it, e.g. "${kind}: ${name} opacity: 0.5"`)
  }
  if (kind === 'volume') return spaceStatement({ form: 'namedVolume', name, solid: parseVolumeSolid(rest.trim(), own) })
  return spaceStatement({ form: 'namedRegion', name, domain: regionDomain(rest, `${name} = region x in [0, 1], y in [x^2, x]`) })
}
