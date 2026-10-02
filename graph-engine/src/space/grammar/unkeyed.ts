// parseSpaceUnkeyed: the hook parseStatementCore calls immediately before its
// function-definition branch (K5). It claims a line only on an unmistakable
// space signal, and returns null for everything else, so the shared parser
// reads that line exactly as it always has:
//
//   1. NAME(p1, p2[, p3]) = <expr>              a two- or three-parameter function
//   2. NAME(p, ...) = <a, b, c> | ⟨a, b, c⟩ | (a, b, c)
//                                                a vector function
//   3. NAME = <a, b, c> | ⟨a, b, c⟩             a vector constant ("NAME = (a, b, c)" stays a point)
//   4. z = <expr> for x in [..], y in [..]      a surface over a domain
//      z = <expr> over <domain>
//   5. z = <expr>, (…) for t in […] (three components), or (…) for u in […], v in […],
//      followed by at least one SP8 style clause
//   6. an equation whose free variables include z, whose left side is not z
//      alone and not a bare name other than x or y   an implicit surface
//
// Never claimed: "NAME = <solid-figure form>" (solid, midpoint, plane, ...),
// "NAME = (a, b, c)", a one-parameter definition "k(x) = ..." (it stays the
// existing functionDef, even when its parameter is z), and an equation with
// no z ("x^2 + y^2 = 25" stays the 2D implicit curve).
//
// Style clauses are stripped only on a line this hook claims.

import { parseTuple, parseForRange, splitTopLevelComma } from '../../parser/grammarUtil'
import { parseExprString } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { BUILTIN_NAMES } from '../../math/compile'
import { varNames } from '../../math/expr'
import { parseForDomain, parseOverDomain } from './domain'
import { parseNamedIntegral } from './keywords/integrals'
import { buildStyle, splitStyle, type RawClause } from './style'
import { spaceStatement, type SpaceForm, type SpaceStatement } from './types'
import { parseVectorLiteral } from './vector'

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// "NAME(p1, ...) = rhs": a name, then a parenthesised parameter list.
const DEFINITION = /^([a-zA-Z_][a-zA-Z0-9_]*)\(([^()]*)\)\s*=(.*)$/

// pi and e are never a definition's or a vector constant's name.
function core(name: string): boolean {
  return name === 'pi' || name === 'e'
}

// A built-in's name is a document's to use (the ruling of 2026-10-02: a
// document's own @param, constant or function shadows the built-in), with one
// reading kept as it always was: a built-in's name followed by only
// coordinates, "log(y, x) = 2" or "hypot(x, y, z) = 1", is an equation calling
// the built-in. With any other parameter, "gcd(a, b) = a*b", it cannot be that
// equation (a and b are unknown in a scene), so it is a definition.
const COORDINATES = new Set(['x', 'y', 'z'])

function callsBuiltin(name: string, params: readonly string[]): boolean {
  return BUILTIN_NAMES.has(name) && params.every((p) => COORDINATES.has(p))
}

function parseDefinition(rest: string, clauses: readonly RawClause[]): SpaceForm | 'unclaimed' | null {
  const match = DEFINITION.exec(rest)
  if (!match) return null
  const [, name, paramText, rhs] = match
  const params = paramText.split(',').map((p) => p.trim())
  if (params.some((p) => !NAME.test(p))) return null
  const vector = parseVectorLiteral(rhs, true)
  // A one-parameter scalar definition is the shared parser's functionDef,
  // whatever its name (a built-in's name is the document's own then, and the
  // kernel's scope lets it shadow the built-in).
  if (params.length === 1 && !vector) return 'unclaimed'
  if (core(name) || (!vector && callsBuiltin(name, params))) return null

  if (vector) {
    buildStyle(clauses, 'vector definition')
    checkParams(name, params)
    return { form: 'vectorFunction', name, params, body: vector }
  }
  if (params.length === 2 || params.length === 3) {
    buildStyle(clauses, 'function definition')
    checkParams(name, params)
    return { form: 'function', name, params, body: parseExprString(rhs) }
  }
  return 'unclaimed'
}

function checkParams(name: string, params: readonly string[]) {
  const repeated = params.find((p, i) => params.indexOf(p) !== i)
  if (repeated) throw new Error(`"${repeated}" is named twice in ${name}(${params.join(', ')})`)
}

function parseVectorConstant(rest: string, clauses: readonly RawClause[]): SpaceForm | null {
  const eq = rest.indexOf('=')
  if (eq === -1) return null
  const name = rest.slice(0, eq).trim()
  if (!NAME.test(name) || core(name)) return null
  // The tuple exclusion: "A = (1, 2, 3)" is a labelled point, never a vector.
  const vector = parseVectorLiteral(rest.slice(eq + 1), false)
  if (!vector) return null
  if (name === 'x' || name === 'y' || name === 'z') {
    throw new Error(`"${name}" is a coordinate, not a name for a vector — write e.g. "u = <1, 2, 3>"`)
  }
  buildStyle(clauses, 'vector definition')
  return { form: 'vectorFunction', name, params: [], body: vector }
}

// The first " for " or " over " in the right-hand side of "z = ...".
function splitDomain(rhs: string): { body: string; keyword: 'for' | 'over'; domain: string } | null {
  const forIdx = rhs.indexOf(' for ')
  const overIdx = rhs.indexOf(' over ')
  if (forIdx === -1 && overIdx === -1) return null
  const useFor = forIdx !== -1 && (overIdx === -1 || forIdx < overIdx)
  const idx = useFor ? forIdx : overIdx
  const keyword = useFor ? 'for' : 'over'
  return { body: rhs.slice(0, idx), keyword, domain: rhs.slice(idx + keyword.length + 2) }
}

function parseSurface(rest: string, clauses: readonly RawClause[]): SpaceForm | null {
  const match = /^z\s*=(.*)$/.exec(rest)
  if (!match) return null
  const split = splitDomain(match[1])
  if (split) {
    const domain = split.keyword === 'for' ? parseForDomain(split.domain) : parseOverDomain(split.domain)
    return { form: 'surface', body: parseExprString(split.body), domain, style: buildStyle(clauses, 'surface') }
  }
  // The existing "z = f" form is claimed only when it carries a style clause.
  if (!styled(clauses)) return null
  return { form: 'surface', body: parseExprString(match[1]), domain: null, style: buildStyle(clauses, 'surface') }
}

// Whether the clauses include a real style clause: a color: or name: left
// before one (which buildStyle refuses legibly) does not by itself claim.
function styled(clauses: readonly RawClause[]): boolean {
  return clauses.some((c) => c.key !== 'color' && c.key !== 'name')
}

// "(fx, fy, fz) for t in [..]" and "(fx, fy, fz) for u in [..], v in [..]",
// claimed only with a style clause and three components.
function parseStyledParametric(rest: string, clauses: readonly RawClause[]): SpaceForm | null {
  if (!styled(clauses) || !rest.startsWith('(')) return null
  const forIdx = rest.indexOf(' for ')
  if (forIdx === -1) return null
  let tuple: Expr[]
  try {
    tuple = parseTuple(rest.slice(0, forIdx))
  } catch {
    return null
  }
  if (tuple.length !== 3) return null
  const ranges = splitTopLevelComma(rest.slice(forIdx + ' for '.length)).map((part) => parseForRange(part.trim()))
  const [fx, fy, fz] = tuple
  if (ranges.length === 1) return { form: 'curve', fx, fy, fz, t: ranges[0], style: buildStyle(clauses, 'curve') }
  if (ranges.length === 2) {
    return { form: 'parametricSurface', fx, fy, fz, u: ranges[0], v: ranges[1], style: buildStyle(clauses, 'parametric surface') }
  }
  throw new Error(`Expected one or two "<param> in [a, b]" clauses after "for", got ${ranges.length}`)
}

// Rule 6: an equation whose free variables include z.
function parseImplicitEquation(rest: string, clauses: readonly RawClause[]): SpaceForm | null {
  if (/[<>]/.test(rest) || / (for|over) /.test(rest)) return null
  const eq = rest.indexOf('=')
  if (eq === -1 || rest.indexOf('=', eq + 1) !== -1) return null
  const lhs = rest.slice(0, eq).trim()
  if (lhs === 'z') return null
  // "NAME = ..." is a constant or a construction, except x and y.
  if (NAME.test(lhs) && lhs !== 'x' && lhs !== 'y') return null
  let left: Expr
  let right: Expr
  try {
    left = parseExprString(lhs)
    right = parseExprString(rest.slice(eq + 1))
  } catch {
    return null
  }
  const names = varNames(right, varNames(left))
  if (!names.has('z')) return null
  return { form: 'implicitSurface', left, right, forced: false, style: buildStyle(clauses, 'implicit surface') }
}

// A line whose first word is a solid-figure keyword belongs to the shared
// grammar, whatever follows it: "plane z = 1" and "plane x + y + z = 4" parse
// exactly as they always have.
const SOLID_FIGURE_WORD =
  /^(plane|net|solid|cut|section|fill|shortest|dihedral|angle|segment|tick|triangle|polygon|circle|label|given|find)\s/

export function parseSpaceUnkeyed(line: string): SpaceStatement | null {
  if (SOLID_FIGURE_WORD.test(line)) return null
  // "R = region ..." (S5), after the exclusions above; never "G = centroid ABC".
  const named = parseNamedIntegral(line)
  if (named) return named
  const { rest, clauses } = splitStyle(line)

  // A one-parameter scalar definition keeps the shared parser's reading (its
  // functionDef), even with z in it: "g(z) = z^2" is a definition, not an
  // equation.
  const definition = parseDefinition(rest, clauses)
  if (definition === 'unclaimed') return null
  const form =
    definition ??
    parseVectorConstant(rest, clauses) ??
    parseSurface(rest, clauses) ??
    parseStyledParametric(rest, clauses) ??
    parseImplicitEquation(rest, clauses)
  return form ? spaceStatement(form) : null
}
