import { isValidColor } from './colors'
import { parseExprString } from './parseExpr'
import type {
  Condition,
  Construction,
  GeometryArcDirection,
  Expr,
  GeometryRef,
  MeasureContent,
  MeasureOvermark,
  GivensSection,
  MeasureSubject,
  PlaneForm,
  RegionExpr,
  RegionOperatorName,
  SolidPrimitive,
  Statement,
  StatementShape,
  TriangleCentreKind,
  TriangleSlot,
} from './types'

function stripComment(line: string): string {
  const idx = line.indexOf('#')
  return idx === -1 ? line : line.slice(0, idx)
}

// Splits a comma-separated list at paren/bracket depth 0 (so "cos(t)*3, sin(t)*2"
// splits into two parts, not three).
function splitTopLevelComma(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

function stripOuterParens(s: string): string {
  const t = s.trim()
  if (t.startsWith('(') && t.endsWith(')')) return t.slice(1, -1)
  throw new Error(`Expected a parenthesized "(x, y)" or "(x, y, z)" tuple, got "${s.trim()}"`)
}

// A 2-tuple is a 2D coordinate/direction; a 3-tuple is 3D. Anything else is an error.
function parseTuple(s: string): Expr[] {
  const inner = stripOuterParens(s)
  const parts = splitTopLevelComma(inner).map((p) => parseExprString(p))
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`Expected "(x, y)" or "(x, y, z)", got "${s.trim()}"`)
  }
  return parts
}

// "(x1,y1[,z1]) -> (x2,y2[,z2])" — shared by the plain ray statement and the
// labeled "vector:" statement, which is otherwise identical.
function parseArrow(str: string): { x1: Expr; y1: Expr; z1: Expr | null; x2: Expr; y2: Expr; z2: Expr | null } {
  const idx = str.indexOf('->')
  if (idx === -1) throw new Error(`Expected "(x1,y1) -> (x2,y2)", got "${str.trim()}"`)
  const from = parseTuple(str.slice(0, idx))
  const to = parseTuple(str.slice(idx + 2))
  return {
    x1: from[0],
    y1: from[1],
    z1: from.length === 3 ? from[2] : null,
    x2: to[0],
    y2: to[1],
    z2: to.length === 3 ? to[2] : null,
  }
}

// Finds the earliest top-level comparator in a line, preferring the 2-char
// form ("<=" over "<") when they start at the same position. Comparators
// never appear inside our expression grammar otherwise, so a plain scan is safe.
function findComparator(line: string): { op: '<' | '<=' | '>' | '>='; idx: number } | null {
  const candidates: { op: '<' | '<=' | '>' | '>='; idx: number }[] = []
  for (const op of ['<=', '>=', '<', '>'] as const) {
    const idx = line.indexOf(op)
    if (idx !== -1) candidates.push({ op, idx })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.idx - b.idx || b.op.length - a.op.length)
  return candidates[0]
}

type Relation = { type: 'equals'; idx: number } | { type: 'comparator'; op: '<' | '<=' | '>' | '>='; idx: number }

// Scans left to right for whichever comes first: a standalone "=" (an
// assignment/equation) or a comparator ("<", "<=", ">", ">="). Used at the
// top level of a statement, where it matters which kind of relation the line
// actually is — see the call site for why this can't be two separate checks.
function findTopLevelRelation(line: string): Relation | null {
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '<' || c === '>') {
      const twoChar = line[i + 1] === '='
      return { type: 'comparator', op: (twoChar ? c + '=' : c) as '<' | '<=' | '>' | '>=', idx: i }
    }
    if (c === '=') return { type: 'equals', idx: i }
  }
  return null
}

// Parses an "if <condition>" clause's condition text, restricted to the
// statement's independent variable: either "x < 0" (variable on the left) or
// a two-sided range "-1 <= x < 1" (both bounds using < or <=).
function parseCondition(condStr: string, varName: string): Condition {
  const first = findComparator(condStr)
  if (!first) throw new Error(`Expected a condition like "${varName} < 0", got "${condStr}"`)

  const rest = condStr.slice(first.idx + first.op.length)
  const second = findComparator(rest)

  if (!second) {
    const lhs = condStr.slice(0, first.idx).trim()
    if (lhs !== varName) throw new Error(`Expected "${varName} ${first.op} <expr>", got "${condStr}"`)
    return { kind: 'compare', op: first.op, value: parseExprString(condStr.slice(first.idx + first.op.length)) }
  }

  if (first.op === '>' || first.op === '>=' || second.op === '>' || second.op === '>=') {
    throw new Error(`A range condition must use "<" or "<=" on both sides, got "${condStr}"`)
  }
  const low = condStr.slice(0, first.idx).trim()
  const mid = rest.slice(0, second.idx).trim()
  const high = rest.slice(second.idx + second.op.length).trim()
  if (mid !== varName) throw new Error(`Expected "<low> ${first.op} ${varName} ${second.op} <high>", got "${condStr}"`)
  return { kind: 'range', lowOp: first.op, low: parseExprString(low), highOp: second.op, high: parseExprString(high) }
}

// Matches "keyword:" (default/unnamed table) or "<name>.keyword:" (a
// specific named table — see parser/types.ts's grammar comment). Returns
// null if the line doesn't start with either form of this keyword at all.
function splitTableName(line: string, keyword: 'header' | 'row' | 'table'): { tableName: string; rest: string } | null {
  if (line.startsWith(keyword + ':')) return { tableName: '', rest: line.slice(keyword.length + 1) }
  const prefixed = new RegExp(`^([a-zA-Z_][a-zA-Z0-9_]*)\\.${keyword}:`).exec(line)
  if (prefixed) return { tableName: prefixed[1], rest: line.slice(prefixed[0].length) }
  return null
}

function parseForRange(rangeStr: string): { param: string; from: Expr; to: Expr } {
  const inIdx = rangeStr.indexOf(' in ')
  if (inIdx === -1) throw new Error(`Expected "<param> in [a, b]", got "${rangeStr.trim()}"`)
  const param = rangeStr.slice(0, inIdx).trim()
  const bracketStr = rangeStr.slice(inIdx + ' in '.length).trim()
  if (!bracketStr.startsWith('[') || !bracketStr.endsWith(']')) {
    throw new Error(`Expected a "[a, b]" range, got "${bracketStr}"`)
  }
  const bounds = splitTopLevelComma(bracketStr.slice(1, -1))
  if (bounds.length !== 2) throw new Error(`Expected two bounds in "[a, b]", got "${bracketStr}"`)
  return { param, from: parseExprString(bounds[0]), to: parseExprString(bounds[1]) }
}

// --------------------------------------------------------------------------
// Geometry constructions (v2). See parser/types.ts's grammar comment for the
// full surface. Everything here works in *names*; resolving them and doing the
// arithmetic belongs to scene/geometry, which this file must not import.
// --------------------------------------------------------------------------

// Geometry names are letters only — the rule point labels already follow, and
// what keeps "A" (a point) from colliding with the general-identifier rule
// that "a = 5" uses.
const GEOMETRY_NAME = /^[a-zA-Z]+$/

function geometryName(raw: string, role: string): string {
  const name = raw.trim()
  if (!GEOMETRY_NAME.test(name)) {
    throw new Error(`Expected a geometry name (letters only) for the ${role}, got "${name}"`)
  }
  return name
}

// "A-B" -> two point names. Used by every construction that names a segment.
function parseNamePair(text: string, role: string): [string, string] {
  const parts = text.split('-')
  if (parts.length !== 2) throw new Error(`Expected "A-B" (two point names) for the ${role}, got "${text.trim()}"`)
  return [geometryName(parts[0], role), geometryName(parts[1], role)]
}

// A LINE through two named points, as a measure or the common perpendicular
// takes it (phase 10): "A-B", or "line A-B". Always the infinite line.
function parseLineOperand(text: string, role: string): [string, string] {
  return parseNamePair(text.trim().replace(/^line\s+/, ''), role)
}

function parseNameTriple(text: string, role: string): [string, string, string] {
  const parts = text.split('-')
  if (parts.length !== 3) throw new Error(`Expected "A-B-C" (three point names) for the ${role}, got "${text.trim()}"`)
  return [geometryName(parts[0], role), geometryName(parts[1], role), geometryName(parts[2], role)]
}

// A triangle is named as a run of single-letter vertices, "ABC" — the form
// the DSL uses everywhere a triangle appears. Multi-letter geometry names are
// legal in general but cannot be written this way, since "ABC" would be
// ambiguous between three vertices and one two-letter plus one one-letter.
function parseTriangleNames(text: string, role: string): [string, string, string] {
  const name = text.trim()
  if (!/^[a-zA-Z]{3}$/.test(name)) {
    throw new Error(`Expected three single-letter vertex names (e.g. "ABC") for the ${role}, got "${name}"`)
  }
  const [a, b, c] = [name[0], name[1], name[2]]
  if (a === b || b === c || a === c) throw new Error(`A triangle needs three distinct vertices, got "${name}"`)
  return [a, b, c]
}

// One operand of a construction. Either a name bound earlier, or a line
// written inline: "A-B" (the infinite line through them), or with an explicit
// "line"/"segment"/"ray" prefix. "circle <name>" is accepted as a readability
// prefix — the name already carries its kind, so the word is documentation.
function parseGeometryRef(text: string, role: string): GeometryRef {
  let rest = text.trim()
  let extent: 'infinite' | 'ray' | 'segment' | null = null
  let expectCircle = false

  // "plane A-B-C", or any other plane form (phase 8, Q2). Only a solid
  // figure has anywhere for one to be, and the solid-figure walk says so
  // when it is given points in the plane.
  const plane = /^plane\s+(.+)$/.exec(rest)
  if (plane) return { kind: 'plane', plane: parsePlaneForm(plane[1], `plane of the ${role}`) }

  const prefix = /^(line|segment|ray|circle)\s+/.exec(rest)
  if (prefix) {
    rest = rest.slice(prefix[0].length).trim()
    if (prefix[1] === 'circle') expectCircle = true
    else extent = prefix[1] === 'line' ? 'infinite' : (prefix[1] as 'ray' | 'segment')
  }

  if (rest.includes('-')) {
    if (expectCircle) throw new Error(`A circle is named, not written as two points — got "circle ${rest}"`)
    const [from, to] = parseNamePair(rest, role)
    return { kind: 'through', extent: extent ?? 'infinite', from, to }
  }
  if (extent !== null) throw new Error(`Expected "${prefix?.[1]} A-B" (two point names), got "${text.trim()}"`)
  return { kind: 'named', name: geometryName(rest, role) }
}

// ---------------------------------------------------------------------------
// Planes (phase 8, Q2)
// ---------------------------------------------------------------------------
//
// Every way an author writes a plane, in the AUTHOR's frame, z up. The text
// after "plane" is kept as `source`, so a message quotes the plane as it was
// written. Which names are points, and whether the plane exists at all, is
// the solid-figure walk's to decide: the parser only reads the shape.

const PLANE_FORMS =
  '"plane A-B-C", "plane through P perpendicular to A-B", "plane through P parallel to A-B-C", ' +
  '"plane 2x + y - z = 3", "plane z = 1" or "plane p" (a named plane)'

// Whether an expression mentions a variable — so "z = x + 1" reads as an
// equation, and "z = 1" (or "z = 2 * a") as the axis form.
function mentions(expr: Expr, names: ReadonlySet<string>): boolean {
  switch (expr.kind) {
    case 'num':
      return false
    case 'var':
      return names.has(expr.name)
    case 'unary':
      return mentions(expr.arg, names)
    case 'binary':
      return mentions(expr.left, names) || mentions(expr.right, names)
    case 'call':
      return expr.args.some((arg) => mentions(arg, names))
  }
}

const AXIS_NAMES: ReadonlySet<string> = new Set(['x', 'y', 'z'])

export function parsePlaneForm(text: string, role = 'plane'): PlaneForm {
  const source = text.trim().replace(/\s+/g, ' ')

  const perpendicular = /^through\s+([a-zA-Z]+)\s+perpendicular\s+to\s+(?:line\s+)?(.+)$/.exec(source)
  if (perpendicular) {
    return {
      kind: 'perpendicular',
      through: geometryName(perpendicular[1], 'point the plane passes through'),
      line: parseNamePair(perpendicular[2], 'line the plane is perpendicular to'),
      source,
    }
  }

  const parallel = /^through\s+([a-zA-Z]+)\s+parallel\s+to\s+(.+)$/.exec(source)
  if (parallel) {
    // "parallel to A-B-C", "parallel to p", or with the word written out:
    // "parallel to plane A-B-C" (any form).
    const to = parsePlaneForm(parallel[2].trim().replace(/^plane\s+/, ''), role)
    return { kind: 'parallel', through: geometryName(parallel[1], 'point the plane passes through'), to, source }
  }

  if (/^through\s/.test(source)) throw new Error(`Expected a plane — ${PLANE_FORMS} — got "plane ${source}"`)

  const equals = source.indexOf('=')
  if (equals !== -1) {
    if (source.indexOf('=', equals + 1) !== -1) throw new Error(`A plane has one "=", got "plane ${source}"`)
    const lhs = source.slice(0, equals).trim()
    const left = parseExprString(lhs)
    const right = parseExprString(source.slice(equals + 1))
    // The phase-5 axis form: one axis letter equal to a value. It keeps its
    // own path (and every byte it drew) all the way to the section.
    if (/^[xyzXYZ]$/.test(lhs) && !mentions(right, AXIS_NAMES)) {
      return { kind: 'axis', axis: lhs.toLowerCase() as 'x' | 'y' | 'z', at: right, source }
    }
    return { kind: 'equation', left, right, source }
  }

  if (source.includes('-')) return { kind: 'points', points: parseNameTriple(source, role), source }
  if (GEOMETRY_NAME.test(source)) return { kind: 'named', name: source, source }
  throw new Error(`Expected a plane — ${PLANE_FORMS} — got "plane ${source}"`)
}

const CENTRE_KEYWORDS: TriangleCentreKind[] = ['centroid', 'circumcenter', 'incenter', 'orthocenter', 'incircle', 'circumcircle']

// "<centre> [of] ABC" — shared by the bound form ("G = centroid ABC") and the
// bare one ("incircle of ABC"), which are the same construction with and
// without a name to bind.
//
// Four vertices are accepted for a centroid alone: "G = centroid ABCD" is the
// centroid of a tetrahedron, which the solid-figure walk resolves. Every other
// centre is a triangle's and has no four-point meaning.
function parseTriangleCentre(text: string): Construction | null {
  const match = /^([a-z]+)\s+(?:of\s+)?([a-zA-Z]{3,4})$/.exec(text.trim())
  if (!match) return null
  const centre = CENTRE_KEYWORDS.find((k) => k === match[1])
  if (!centre) return null
  if (match[2].length === 4) {
    if (centre !== 'centroid') {
      throw new Error(`Expected three vertices for a ${centre} ("${centre} ABC") — only a centroid takes four, got "${match[2]}"`)
    }
    const [a, b, c, d] = [...match[2]]
    if (new Set([a, b, c, d]).size !== 4) throw new Error(`A centroid needs four distinct vertices, got "${match[2]}"`)
    return { kind: 'triangleCentre', centre, vertices: [a, b, c, d] }
  }
  return { kind: 'triangleCentre', centre, vertices: parseTriangleNames(match[2], `${centre} triangle`) }
}

// --------------------------------------------------------------------------
// The circle vocabulary (phase 4)
//
// Every form names the circle it is on, because a figure with two circles
// makes "the chord P-Q" meaningless, and every ARC form names its direction,
// because "the arc from P to Q" is two arcs (G1).
// --------------------------------------------------------------------------

const ARC_DIRECTIONS: GeometryArcDirection[] = ['minor', 'major', 'ccw', 'cw']

// Missing and unrecognised are the same error on purpose: both mean the spec
// has not said which of the two arcs it means, and the fix for both is to
// write one of the four words.
function requireArcDirection(word: string | undefined, subject: string): GeometryArcDirection {
  const found = ARC_DIRECTIONS.find((d) => d === word?.trim().toLowerCase())
  if (!found) {
    throw new Error(
      `"${subject}" names two different arcs — end the line with "minor", "major", "ccw" or "cw" to say which one you mean` +
        (word ? `, not "${word.trim()}"` : '')
    )
  }
  return found
}

// "P-Q" or "PQ", then checked against the geometry-name rule: a circle
// construction works in the same namespace every other construction does.
function parseCirclePair(text: string, role: string): [string, string] {
  const [from, to] = parsePointRun(text, 2, role)
  return [geometryName(from, role), geometryName(to, role)]
}

// The forms that produce a LINE, and so can be bound to a name and used
// again. Shared by "<c> = chord P-Q on O" and the bare "chord P-Q on O".
function parseCircleConstruction(text: string): Construction | null {
  const chord = /^chord\s+(.+?)\s+on\s+([a-zA-Z]+)$/.exec(text)
  if (chord) {
    const [from, to] = parseCirclePair(chord[1], 'chord')
    return { kind: 'chord', circle: geometryName(chord[2], 'circle a chord lies on'), from, to }
  }

  const tangentAt = /^tangent\s+at\s+([a-zA-Z]+)\s+on\s+([a-zA-Z]+)$/.exec(text)
  if (tangentAt) {
    return {
      kind: 'tangentAt',
      circle: geometryName(tangentAt[2], 'circle a tangent touches'),
      point: geometryName(tangentAt[1], 'point a tangent touches at'),
    }
  }

  const tangentFrom = /^tangent\s+from\s+([a-zA-Z]+)\s+to\s+([a-zA-Z]+)$/.exec(text)
  if (tangentFrom) {
    return {
      kind: 'tangentFrom',
      circle: geometryName(tangentFrom[2], 'circle a tangent touches'),
      point: geometryName(tangentFrom[1], 'point the tangents are drawn from'),
    }
  }

  if (/^tangent\s/.test(text)) {
    throw new Error(
      `Expected "tangent at P on O" (P a point of the circle) or "tangent from P to O" (P outside it), got "${text}"`
    )
  }

  // "through" is accepted and ignored: the spec writes "secant through P",
  // but one point names infinitely many secants, so this takes the two that
  // determine the line.
  const secant = /^secant\s+(?:through\s+)?(.+?)\s+on\s+([a-zA-Z]+)$/.exec(text)
  if (secant) {
    const [from, to] = parseCirclePair(secant[1], 'secant')
    return { kind: 'secant', circle: geometryName(secant[2], 'circle a secant cuts'), from, to }
  }

  const radius = /^radius\s+([a-zA-Z]+)\s+to\s+([a-zA-Z]+)$/.exec(text)
  if (radius) {
    return {
      kind: 'radiusTo',
      circle: geometryName(radius[1], 'circle a radius belongs to'),
      point: geometryName(radius[2], 'point a radius is drawn to'),
    }
  }

  const diameter = /^diameter\s+(.+?)\s+on\s+([a-zA-Z]+)$/.exec(text)
  if (diameter) {
    const [from, to] = parseCirclePair(diameter[1], 'diameter')
    return { kind: 'diameter', circle: geometryName(diameter[2], 'circle a diameter belongs to'), from, to }
  }

  return null
}

// The forms that produce a drawn SHAPE or MARK rather than a value: an arc,
// the two fills built on one, and the two angle marks. They bind no name —
// nothing intersects an arc — so they are statements of their own.
function parseCircleShape(line: string): StatementShape | null {
  const shape = /^(arc|sector|segment)\s+(.+?)\s+on\s+([a-zA-Z]+)(?:\s+(\S+))?$/.exec(line)
  if (shape) {
    const [from, to] = parseCirclePair(shape[2], shape[1])
    return {
      kind: 'circleShape',
      shape: shape[1] as 'arc' | 'sector' | 'segment',
      circle: geometryName(shape[3], `circle the ${shape[1]} lies on`),
      from,
      to,
      direction: requireArcDirection(shape[4], `${shape[1]} ${shape[2].trim()}`),
    }
  }

  const central = /^central\s+angle\s+(.+?)\s+on\s+([a-zA-Z]+)(?:\s+(\S+))?$/.exec(line)
  if (central) {
    const [from, to] = parseCirclePair(central[1], 'central angle')
    return {
      kind: 'centralAngle',
      circle: geometryName(central[2], 'circle the angle is central to'),
      from,
      to,
      direction: requireArcDirection(central[3], `central angle ${central[1].trim()}`),
    }
  }

  const inscribed = /^inscribed\s+angle\s+(.+?)\s+on\s+([a-zA-Z]+)$/.exec(line)
  if (inscribed) {
    const [from, vertex, to] = parsePointRun(inscribed[1], 3, 'inscribed angle').map((n) =>
      geometryName(n, 'inscribed angle')
    )
    return { kind: 'inscribedAngle', circle: geometryName(inscribed[2], 'circle the angle is inscribed in'), from, vertex, to }
  }

  return null
}

function parseConstructionBody(rhs: string): Construction | null {
  const text = rhs.trim()

  // "line through P parallel to A-B" / "line through P perpendicular to A-B"
  const lineThrough = /^line\s+through\s+([a-zA-Z]+)\s+(parallel|perpendicular)\s+to\s+(.+)$/.exec(text)
  if (lineThrough) {
    const base = parseGeometryRef(lineThrough[3], 'base line')
    const through = geometryName(lineThrough[1], 'point the line passes through')
    return lineThrough[2] === 'parallel' ? { kind: 'parallelLine', through, base } : { kind: 'perpendicularLine', through, base }
  }

  const perpBisector = /^perpendicular\s+bisector\s+(?:of\s+)?(.+)$/.exec(text)
  if (perpBisector) {
    const [from, to] = parseNamePair(perpBisector[1], 'bisected segment')
    return { kind: 'perpendicularBisector', from, to }
  }

  const angleBisector = /^bisector\s+of\s+angle\s+(.+)$/.exec(text)
  if (angleBisector) {
    const [from, vertex, to] = parseNameTriple(angleBisector[1], 'bisected angle')
    return { kind: 'angleBisector', from, vertex, to }
  }

  // "M = center of S" (phase 9, R1): a sphere solid's centre, as a point in
  // space. Exactly this shape — one name after "of" — so nothing else an
  // author writes is read as it. "centre of S" is the same construction
  // (fix round 1): the engine's own prose spells it that way.
  const centerOf = /^cent(?:er|re)\s+of\s+([a-zA-Z]+)$/.exec(text)
  if (centerOf) return { kind: 'centerOf', solid: geometryName(centerOf[1], 'sphere whose centre it is') }

  // "P, Q = common perpendicular of A-B and C-D" (phase 10, M6): the feet of
  // the common perpendicular of two lines in space. "line" before either
  // line is optional, as in "distance between".
  const common = /^common\s+perpendicular\s+(?:of\s+)?(.+?)\s+and\s+(.+)$/.exec(text)
  if (common) {
    return {
      kind: 'commonPerpendicular',
      first: parseLineOperand(common[1], 'first line of the common perpendicular'),
      second: parseLineOperand(common[2], 'second line of the common perpendicular'),
    }
  }

  const mid = /^midpoint\s+(?:of\s+)?(.+)$/.exec(text)
  if (mid) {
    const [from, to] = parseNamePair(mid[1], 'segment')
    return { kind: 'midpoint', from, to }
  }

  const foot = /^foot\s+([a-zA-Z]+)\s+to\s+(.+)$/.exec(text)
  if (foot) {
    return { kind: 'foot', from: geometryName(foot[1], 'point the perpendicular drops from'), base: parseGeometryRef(foot[2], 'line it drops to') }
  }

  if (/^intersect\b/.test(text)) {
    const operands = splitTopLevelComma(text.slice('intersect'.length))
    if (operands.length !== 2) {
      throw new Error(`Expected "intersect <object>, <object>" (two operands), got ${operands.length} in "${text}"`)
    }
    return { kind: 'intersect', left: parseGeometryRef(operands[0], 'first operand'), right: parseGeometryRef(operands[1], 'second operand') }
  }

  const divide = /^divide\s+(.+?)\s+at\s+(.+)$/.exec(text)
  if (divide) {
    const [from, to] = parseNamePair(divide[1], 'divided segment')
    const ratio = divide[2].split(':')
    if (ratio.length !== 2) throw new Error(`Expected a ratio "m:n" after "at", got "${divide[2].trim()}"`)
    return { kind: 'divide', from, to, ratioFrom: parseExprString(ratio[0]), ratioTo: parseExprString(ratio[1]) }
  }

  const reflect = /^reflect\s+([a-zA-Z]+)\s+over\s+(.+)$/.exec(text)
  if (reflect) {
    return { kind: 'reflect', point: geometryName(reflect[1], 'reflected point'), over: parseGeometryRef(reflect[2], 'mirror line') }
  }

  const rotate = /^rotate\s+([a-zA-Z]+)\s+about\s+([a-zA-Z]+)\s+by\s+(.+)$/.exec(text)
  if (rotate) {
    return {
      kind: 'rotate',
      point: geometryName(rotate[1], 'rotated point'),
      about: geometryName(rotate[2], 'centre of rotation'),
      angle: parseExprString(rotate[3]),
    }
  }

  const translate = /^translate\s+([a-zA-Z]+)\s+by\s+(.+)$/.exec(text)
  if (translate) {
    const by = parseTuple(translate[2])
    if (by.length !== 2) throw new Error(`Expected "translate P by (dx, dy)", got "${text}"`)
    return { kind: 'translate', point: geometryName(translate[1], 'translated point'), dx: by[0], dy: by[1] }
  }

  // "O = circle P, 5" — a circle around a named centre. The existing
  // "circle: (cx, cy), r" statement draws one but binds no geometry name, so
  // without this form the spec's own "intersect circle O, line B-C" has no
  // way to get an O to talk about.
  const circleAt = /^circle\s+([a-zA-Z]+)\s*,(.+)$/.exec(text)
  if (circleAt) {
    return { kind: 'circleAt', center: geometryName(circleAt[1], 'circle centre'), radius: parseExprString(circleAt[2]) }
  }

  const dilate = /^dilate\s+([a-zA-Z]+)\s+from\s+([a-zA-Z]+)\s+by\s+(.+)$/.exec(text)
  if (dilate) {
    return {
      kind: 'dilate',
      point: geometryName(dilate[1], 'dilated point'),
      from: geometryName(dilate[2], 'centre of dilation'),
      factor: parseExprString(dilate[3]),
    }
  }

  const onACircle = parseCircleConstruction(text)
  if (onACircle) return onACircle

  return parseTriangleCentre(text)
}

// "triangle ABC: AB = 8, angle A = 90, AC = 6".
//
// Measurements are mapped onto the canonical a/b/c slots here rather than in
// the scene builder, because this is the layer that knows the vertex names —
// which means "side DE" of triangle ABC can be rejected as a *parse* error,
// naming the triangle, instead of surfacing later as a missing measurement.
// --------------------------------------------------------------------------
// Solid figures (phase 5; z-up author frame from phase 6)
//
// Everything written here is in the AUTHOR's frame, z up: X toward the viewer
// and left, Y right, Z up. A prism's width runs along Y, its depth along X
// and its height along Z; "plane z = 1" is a horizontal cut. The parser keeps
// the author's axes as written and never converts — the figure renderer does
// that at one boundary, figure/authorFrame.ts.
//
// Phase 6 added points in space ("A = (0, 0, 0)"), a solid's named vertices
// as real points (lettered in textbook order since phase 6b: a prism's ABCD
// counter-clockwise from above from the front-left bottom corner, EFGH above
// them; a pyramid's apex E; a tetrahedron's apex D), constructions on them
// ("plane A-B-C" as an operand of foot and intersect, "centroid ABCD"), and
// "segment: A-G [dashed | plain]" under the glass rule.
//
// Phase 7 added solids on named points ("hull A-B-C-D", "tetrahedron
// A-B-C-D", "pyramid A-B-C-D apex E", "prism A-B-C height 5", "sphere center
// M radius 5", "cylinder from A to B radius 3", "cone apex V base O radius
// 3", "frustum from O radius 6 to P radius 3"), the tetrahedron by its six
// edges ("tetrahedron ABCD with AB = ..., ..."), and more solids by
// dimensions (frustum, cube, regular prism/pyramid/frustum, rectangle
// pyramid, octahedron). The frustum's rules (P2), the placement and
// lettering of regular bases (P5), and which sections a placed round solid
// takes (P7) are in the grammar comment too.
//
// Phase 8 added planes as objects: every plane form ("plane A-B-C", "plane
// through P perpendicular to A-B", "... parallel to A-B-C", "plane 2x + y -
// z = 3", "plane z = 1", "plane p") wherever a plane is taken, and named
// planes, "p = plane ..." (see parsePlaneForm).
//
// Phase 9 added spheres the figure constructs: "insphere of T",
// "circumsphere of T", "circumsphere A-B-C-D", "sphere center P tangent to
// plane ...", "... externally | internally tangent to T" (see
// parseSphereTangency), and the construction "M = center of S".
//
// Nothing here knows which names are points in space: that is decided by
// the solid-figure walk (figure/solidScope.ts), after parsing. The full
// surface, and the mode rule for solid figures, is documented in
// parser/types.ts's grammar comment.
// --------------------------------------------------------------------------

// The primitive names an author can write, in the order the error message
// lists them. Kept here rather than imported from figure/solids.ts because
// parser/index.ts is a renderer-free entry point — the same reason
// GeometryExtent is duplicated rather than imported.
const SOLID_PRIMITIVE_NAMES = ['prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere', 'frustum', 'hull', 'cube', 'octahedron', 'insphere', 'circumsphere']

// The dimension words "label: S height" can name. The renderer decides which
// of these a given primitive actually HAS (a tetrahedron has no height to
// label); the parser only needs to recognise the shape of the phrase.
const SOLID_DIMENSIONS = ['width', 'height', 'depth', 'base', 'edge', 'radius', 'top', 'side']

// "A-B-C-D": a hyphenated run of point names, for a solid placed by points.
// `form` is the whole phrase an error quotes back.
function parsePointList(text: string, form: string, role: string): string[] {
  const trimmed = text.trim()
  if (!trimmed.includes('-')) throw new Error(`Expected "${form}" — point names joined by hyphens — got "${trimmed}"`)
  const names = trimmed.split('-').map((part) => geometryName(part, `points of the ${role}`))
  const repeated = names.find((name, i) => names.indexOf(name) !== i)
  if (repeated) throw new Error(`"${repeated}" is named twice in "${trimmed}" — each point is one corner`)
  return names
}

// P4 — "ABCD" and "AB = sqrt(41), CD = sqrt(41), AC = ..., ...": four
// distinct single-letter vertices and six edges, each unordered pair of them
// exactly once, in any order and either letter order. Checked HERE, where the
// names are known, so a missing, repeated or foreign pair is a parse error
// that names it — the same reason a triangle's sides are checked here.
function parseTetrahedronEdges(namesText: string, edgesText: string): SolidPrimitive {
  const vertices = [...namesText] as [string, string, string, string]
  if (new Set(vertices).size !== 4) throw new Error(`A tetrahedron's four vertex names must be distinct, got "${namesText}"`)
  const edges: { from: string; to: string; length: Expr }[] = []
  const seen = new Map<string, string>()
  for (const chunk of splitTopLevelComma(edgesText)) {
    const eq = chunk.indexOf('=')
    const pair = eq === -1 ? null : /^([a-zA-Z])\s*-?\s*([a-zA-Z])$/.exec(chunk.slice(0, eq).trim())
    if (!pair) throw new Error(`Expected "<edge> = <length>", e.g. "AB = 5", got "${chunk.trim()}"`)
    const [from, to] = [pair[1], pair[2]]
    for (const letter of [from, to]) {
      if (!vertices.includes(letter)) throw new Error(`${letter} is not one of the tetrahedron's vertices ${namesText} (in "${chunk.trim()}")`)
    }
    if (from === to) throw new Error(`"${from}${to}" is not an edge — an edge joins two different vertices`)
    const key = [from, to].sort().join('')
    const earlier = seen.get(key)
    if (earlier) throw new Error(`The edge ${key} is given twice ("${earlier}" and "${from}${to}")`)
    seen.set(key, `${from}${to}`)
    edges.push({ from, to, length: parseExprString(chunk.slice(eq + 1)) })
  }
  const missing: string[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const key = [vertices[i], vertices[j]].sort().join('')
      if (!seen.has(key)) missing.push(`${vertices[i]}${vertices[j]}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`A tetrahedron by its edges needs all six; ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`)
  }
  return { kind: 'tetrahedronEdges', vertices, edges }
}

// "regular <n> side <s>, <key> <v>, ...": the regular forms' shared shape.
// Returns [n, side, ...the keyed values in `keys` order].
function regularParts(tail: string, keys: string[], form: string, rest: string): Expr[] {
  const parts = splitTopLevelComma(tail).map((part) => part.trim())
  const head = /^regular\s+(\S+)\s+side\s+(.+)$/i.exec(parts[0])
  const values = keys.map((key, i) => (parts.length === keys.length + 1 ? new RegExp(`^${key}\\s+(.+)$`, 'i').exec(parts[i + 1]) : null))
  if (!head || values.some((v) => !v)) throw new Error(`Expected "${form}", got "${rest}"`)
  return [parseExprString(head[1]), parseExprString(head[2]), ...values.map((v) => parseExprString(v![1]))]
}

// Phase 9, R5 — "sphere center P tangent to plane <any form>", "sphere
// center P externally tangent to T", "... internally tangent to T". The
// centre is given and the radius follows from the one thing it touches. Null
// when the text is not a tangency, so the other sphere forms read it.
//
// Refused here, where the words are: a sphere "tangent to T" with no side (a
// sphere touches another from outside or from inside, and guessing which is
// how a figure becomes quietly wrong); a plane "externally" tangent; several
// objects at once, which is a solver (R7); and a tangent sphere with no
// centre, which is the same solver.
function parseSphereTangency(tail: string): SolidPrimitive | null {
  if (!/\btangent\s+to\b/i.test(tail)) return null
  const form = /^center\s+(\S+)\s+(?:(externally|internally)\s+)?tangent\s+to\s+(.+)$/i.exec(tail)
  if (!form) {
    throw new Error(
      'A sphere by tangency is placed by its centre — write "sphere center P tangent to plane A-B-C" or ' +
        '"sphere center P externally tangent to T"; a sphere tangent to several objects at once needs a solver, ' +
        'so place it by its computed centre'
    )
  }
  const center = geometryName(form[1], 'centre of the sphere')
  const side = form[2]?.toLowerCase() as 'externally' | 'internally' | undefined
  const target = form[3].trim()
  if (/\s+and\s+/i.test(target) || splitTopLevelComma(target).length > 1) {
    throw new Error(
      `"tangent to ${target}" names more than one object — a sphere is placed by tangency to one object at a time; ` +
        'several at once needs a solver, so place it by its computed centre and check each tangency with a label'
    )
  }
  const plane = /^plane\s+(.+)$/i.exec(target)
  if (plane) {
    if (side) throw new Error(`A plane has no inside — write "tangent to plane ${plane[1].trim()}", without "${side}"`)
    return { kind: 'sphereTangent', center, to: { kind: 'plane', plane: parsePlaneForm(plane[1], 'plane the sphere is tangent to') } }
  }
  const sphere = geometryName(target, 'sphere it is tangent to')
  if (!side) {
    throw new Error(
      `A sphere touches another from outside or from inside — write "externally tangent to ${sphere}" or "internally tangent to ${sphere}"; ` +
        `if ${sphere} is a plane, write "tangent to plane ${sphere}"`
    )
  }
  return { kind: 'sphereTangent', center, to: { kind: 'sphere', sphere, side: side === 'externally' ? 'external' : 'internal' } }
}

// "prism 8 by 5 by 6", "pyramid square base 6, height 9", "tetrahedron edge 5".
//
// Each form names its own numbers. "8 by 5 by 6" is bare because width,
// height and depth in that order is how a box is dictated; everything else is
// keyed, because "pyramid 6, 9" does not say which is the base.
function parseSolidPrimitive(text: string): SolidPrimitive {
  const rest = text.trim()
  const word = /^([a-zA-Z-]+)(?=\s|$)/.exec(rest)
  const head = word ? word[1] : rest
  const tail = rest.slice(head.length).trim()

  if (head === 'prism') {
    // P6 — on a base polygon: "prism A-B-C-D height 5".
    const onBase = /^([a-zA-Z]+(?:\s*-\s*[a-zA-Z]+)+)\s+height\s+(.+)$/i.exec(tail)
    if (onBase) {
      return { kind: 'prismOn', base: parsePointList(onBase[1], 'prism A-B-C-D height <h>', 'prism base'), height: parseExprString(onBase[2]) }
    }
    // P5 — on a regular n-gon: "prism regular 6 side 12, height 5".
    if (/^regular\s/i.test(tail)) {
      const [sides, side, height] = regularParts(tail, ['height'], 'prism regular <n> side <s>, height <h>', rest)
      return { kind: 'regularPrism', sides, side, height }
    }
    const parts = tail.split(/\s+by\s+/i).map((part) => part.trim())
    if (parts.length !== 3 || parts.some((part) => part === '')) {
      throw new Error(`Expected "prism <width> by <height> by <depth>", got "${rest}"`)
    }
    return { kind: 'prism', width: parseExprString(parts[0]), height: parseExprString(parts[1]), depth: parseExprString(parts[2]) }
  }

  if (head === 'pyramid') {
    // P6 — on a base polygon and an apex: "pyramid A-B-C-D apex E".
    const onBase = /^([a-zA-Z]+(?:\s*-\s*[a-zA-Z]+)+)\s+apex\s+(\S+)$/i.exec(tail)
    if (onBase) {
      return {
        kind: 'pyramidOn',
        base: parsePointList(onBase[1], 'pyramid A-B-C-D apex E', 'pyramid base'),
        apex: geometryName(onBase[2], 'apex of the pyramid'),
      }
    }
    // "square" is required rather than defaulted: a pyramid on a triangular
    // base is a different solid with the same word, and guessing which one
    // an author meant is how a figure becomes quietly wrong.
    // P5 — on a regular n-gon, or on a rectangle (width by depth, like the
    // box's first and last numbers).
    if (/^regular\s/i.test(tail)) {
      const [sides, side, height] = regularParts(tail, ['height'], 'pyramid regular <n> side <s>, height <h>', rest)
      return { kind: 'regularPyramid', sides, side, height }
    }
    if (/^rectangle\s/i.test(tail)) {
      const parts = splitTopLevelComma(tail).map((part) => part.trim())
      const base = parts.length === 2 ? /^rectangle\s+(.+?)\s+by\s+(.+)$/i.exec(parts[0]) : null
      const height = parts.length === 2 ? /^height\s+(.+)$/i.exec(parts[1]) : null
      if (!base || !height) throw new Error(`Expected "pyramid rectangle <width> by <depth>, height <h>", got "${rest}"`)
      return { kind: 'rectanglePyramid', width: parseExprString(base[1]), depth: parseExprString(base[2]), height: parseExprString(height[1]) }
    }
    const keyed = /^square\s+base\s+/i.exec(tail)
    if (!keyed) {
      throw new Error(
        `Expected "pyramid square base <b>, height <h>", "pyramid regular <n> side <s>, height <h>", ` +
          `"pyramid rectangle <w> by <d>, height <h>" or "pyramid A-B-C-D apex E", got "${rest}"`
      )
    }
    const parts = splitTopLevelComma(tail.slice(keyed[0].length)).map((part) => part.trim())
    const height = parts.length === 2 ? /^height\s+(.+)$/i.exec(parts[1]) : null
    if (parts.length !== 2 || !height) throw new Error(`Expected "pyramid square base <b>, height <h>", got "${rest}"`)
    return { kind: 'pyramid', base: parseExprString(parts[0]), height: parseExprString(height[1]) }
  }

  // P6 — round solids placed by points. Each names what places it: a
  // cylinder its two rim centres, a cone its apex and base centre.
  if (head === 'cylinder') {
    const placed = /^from\s+(\S+)\s+to\s+(\S+)\s+radius\s+(.+)$/i.exec(tail)
    if (placed) {
      return {
        kind: 'cylinderOn',
        from: geometryName(placed[1], 'first rim centre of the cylinder'),
        to: geometryName(placed[2], 'second rim centre of the cylinder'),
        radius: parseExprString(placed[3]),
      }
    }
  }
  if (head === 'cone') {
    const placed = /^apex\s+(\S+)\s+base\s+(\S+)\s+radius\s+(.+)$/i.exec(tail)
    if (placed) {
      return {
        kind: 'coneOn',
        apex: geometryName(placed[1], 'apex of the cone'),
        base: geometryName(placed[2], 'base centre of the cone'),
        radius: parseExprString(placed[3]),
      }
    }
  }

  if (head === 'cylinder' || head === 'cone') {
    const parts = splitTopLevelComma(tail).map((part) => part.trim())
    const radius = parts.length === 2 ? /^radius\s+(.+)$/i.exec(parts[0]) : null
    const height = parts.length === 2 ? /^height\s+(.+)$/i.exec(parts[1]) : null
    if (!radius || !height) throw new Error(`Expected "${head} radius <r>, height <h>", got "${rest}"`)
    return { kind: head, radius: parseExprString(radius[1]), height: parseExprString(height[1]) }
  }

  if (head === 'sphere') {
    const tangent = parseSphereTangency(tail)
    if (tangent) return tangent
    const placed = /^center\s+(\S+)\s+radius\s+(.+)$/i.exec(tail)
    if (placed) return { kind: 'sphereOn', center: geometryName(placed[1], 'centre of the sphere'), radius: parseExprString(placed[2]) }
    const radius = /^radius\s+(.+)$/i.exec(tail)
    if (!radius) throw new Error(`Expected "sphere radius <r>", got "${rest}"`)
    return { kind: 'sphere', radius: parseExprString(radius[1]) }
  }

  // Phase 9 (R3, R6) — the sphere tangent to every face of a solid.
  if (head === 'insphere') {
    const of = /^of\s+(\S+)$/i.exec(tail)
    if (!of) throw new Error(`Expected "insphere of <solid>", got "${rest}" — an inscribed sphere is a solid's, named by the solid`)
    return { kind: 'insphere', of: geometryName(of[1], 'solid the sphere is inscribed in') }
  }

  // Phase 9 (R3, R6) — the sphere through a solid's vertices, or through
  // four named points.
  if (head === 'circumsphere') {
    const of = /^of\s+(\S+)$/i.exec(tail)
    if (of) return { kind: 'circumsphere', of: geometryName(of[1], 'solid the sphere is circumscribed about') }
    if (/^[a-zA-Z]+(?:\s*-\s*[a-zA-Z]+){3}$/.test(tail)) {
      const [a, b, c, d] = parsePointList(tail, 'circumsphere A-B-C-D', 'circumsphere')
      return { kind: 'circumsphereOn', points: [a, b, c, d] }
    }
    throw new Error(
      `Expected "circumsphere of <solid>" or "circumsphere A-B-C-D" (four points), got "${rest}" — ` +
        'for more points, build the solid ("hull A-B-C-D-E") and take its circumsphere'
    )
  }

  if (head === 'hull') {
    // P6 — named points, hyphenated like "plane A-B-C". Hyphens are required:
    // "ABCD" is ambiguous between four points and multi-letter names.
    return { kind: 'hull', points: parsePointList(tail, 'hull A-B-C-D', 'hull') }
  }

  if (head === 'frustum') {
    // P6 — "frustum from O radius 6 to P radius 3": each rim by its centre.
    const placed = /^from\s+(\S+)\s+radius\s+(.+?)\s+to\s+(\S+)\s+radius\s+(.+)$/i.exec(tail)
    if (placed) {
      return {
        kind: 'frustumOn',
        from: geometryName(placed[1], 'first rim centre of the frustum'),
        fromRadius: parseExprString(placed[2]),
        to: geometryName(placed[3], 'second rim centre of the frustum'),
        toRadius: parseExprString(placed[4]),
      }
    }
    // P5 — pyramidal: "frustum regular 4 side 6, top 3, height 4".
    if (/^regular\s/i.test(tail)) {
      const [sides, side, top, height] = regularParts(tail, ['top', 'height'], 'frustum regular <n> side <s>, top <t>, height <h>', rest)
      return { kind: 'regularFrustum', sides, side, top, height }
    }
    // P2 — keyed like the cylinder and cone it sits between, with the top
    // rim's radius named "top".
    const parts = splitTopLevelComma(tail).map((part) => part.trim())
    const radius = parts.length === 3 ? /^radius\s+(.+)$/i.exec(parts[0]) : null
    const top = parts.length === 3 ? /^top\s+(.+)$/i.exec(parts[1]) : null
    const height = parts.length === 3 ? /^height\s+(.+)$/i.exec(parts[2]) : null
    if (!radius || !top || !height) throw new Error(`Expected "frustum radius <r>, top <r>, height <h>", got "${rest}"`)
    return { kind: 'frustum', radius: parseExprString(radius[1]), top: parseExprString(top[1]), height: parseExprString(height[1]) }
  }

  if (head === 'tetrahedron') {
    // P4 — by its six edges: "tetrahedron ABCD with AB = ..., ...".
    const byEdges = /^([a-zA-Z]{4})\s+with\s+(.+)$/i.exec(tail)
    if (byEdges) return parseTetrahedronEdges(byEdges[1], byEdges[2])
    // P6 — on four named points: "tetrahedron A-B-C-D".
    if (/^[a-zA-Z]+(?:\s*-\s*[a-zA-Z]+){3}$/.test(tail)) {
      return { kind: 'tetrahedronOn', points: parsePointList(tail, 'tetrahedron A-B-C-D', 'tetrahedron') }
    }
    const edge = /^edge\s+(.+)$/i.exec(tail)
    if (!edge) throw new Error(`Expected "tetrahedron edge <e>", got "${rest}"`)
    return { kind: 'tetrahedron', edge: parseExprString(edge[1]) }
  }

  if (head === 'cube' || head === 'octahedron') {
    const edge = /^edge\s+(.+)$/i.exec(tail)
    if (!edge) throw new Error(`Expected "${head} edge <e>", got "${rest}"`)
    return { kind: head, edge: parseExprString(edge[1]) }
  }

  throw new Error(`Unknown solid "${head}" — the primitives are ${SOLID_PRIMITIVE_NAMES.join(', ')}`)
}

// "cut: S by plane z = 3" / "section: S by plane z = 3 vertices PQRS".
//
// The plane is written the way a problem writes it — an equation — rather
// than as a normal and an offset, because "the plane z = 3" is the sentence
// and a normal vector is an implementation. The axis is the author's, z up,
// kept exactly as written.
function parseCrossSection(text: string, lift: boolean): StatementShape {
  const keyword = lift ? 'section' : 'cut'
  let rest = text.trim()
  let vertices: string[] = []
  const clause = /\s+vertices\s+(\S+)\s*$/i.exec(rest)
  if (clause) {
    if (!lift) {
      throw new Error(
        'A "cut:" is drawn on the solid, in projection, where lengths are foreshortened — ' +
          'use "section:" to lift it out at true shape and name its vertices'
      )
    }
    const names = [...clause[1].trim()]
    // Two names at least: a region cut from a round solid (phase 8, Q5) can
    // have only two corners, the ends of its one chord.
    if (names.length < 2 || names.some((n) => !/^[a-zA-Z]$/.test(n))) {
      throw new Error(`Expected "vertices PQRS" — a run of single-letter names, one per vertex — got "${clause[1]}"`)
    }
    if (new Set(names).size !== names.length) throw new Error(`Vertex names must be distinct, got "${clause[1]}"`)
    vertices = names
    rest = rest.slice(0, clause.index).trim()
  }

  const shape = /^([a-zA-Z]+)\s+by\s+plane\s+(.+)$/i.exec(rest)
  if (!shape) throw new Error(`Expected "${keyword}: <solid> by plane <x|y|z> = <value>", got "${rest}"`)
  return {
    kind: 'crossSection',
    solid: geometryName(shape[1], `solid the ${keyword} applies to`),
    lift,
    plane: parsePlaneForm(shape[2], `plane the ${keyword} is made by`),
    vertices,
  }
}

// "net: S" (phase 11, N1): one solid, by name.
function parseNet(text: string): StatementShape {
  const rest = text.trim()
  if (!/^[a-zA-Z]+$/.test(rest)) throw new Error(`Expected "net: <solid>" — the name of a solid defined earlier — got "${rest}"`)
  return { kind: 'net', solid: rest }
}

// "P to Q over S" — the ends of a shortest path and the solid it runs over,
// shared by the statement and the measure subject (N5).
const SHORTEST_PATH = /^([a-zA-Z_][a-zA-Z0-9_]*)\s+to\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+over\s+([a-zA-Z]+)$/

function shortestParts(text: string, form: string): { from: string; to: string; solid: string } {
  const found = SHORTEST_PATH.exec(text.trim())
  if (!found) throw new Error(`Expected "${form}" — two point names and a solid — got "${text.trim()}"`)
  return { from: found[1], to: found[2], solid: found[3] }
}

// "shortest: P to Q over S [unfold]" (phase 11, N3).
function parseShortest(text: string): StatementShape {
  const unfold = /\s+unfold\s*$/.exec(text)
  const parts = shortestParts(unfold ? text.slice(0, unfold.index) : text, 'shortest: P to Q over S')
  return { kind: 'shortestPath', ...parts, unfold: unfold !== null }
}

// ---------------------------------------------------------------------------
// Shaded regions (phase 12, F4)
// ---------------------------------------------------------------------------
//
// "fill: <region>", where a region is a shape or a boolean of regions:
//
//   A-B-C                  polygon A-B-C-D        triangle ABC
//   square ABCD            rectangle ABCD         circle O
//   sector P-Q on O minor  segment P-Q on O cw    R  (a region named with "name:")
//   <region> minus <region>   <region> and|intersect <region>   <region> or|union <region>
//
// One precedence, left to right, with parentheses: "circle O or circle P
// minus triangle ABC" is "(circle O or circle P) minus triangle ABC".

const REGION_OPERATORS = new Map<string, RegionOperatorName>([
  ['minus', 'difference'],
  ['and', 'intersection'],
  ['intersect', 'intersection'],
  ['or', 'union'],
  ['union', 'union'],
])

const REGION_FORMS =
  '"A-B-C", "polygon A-B-C-D", "triangle ABC", "square ABCD", "rectangle ABCD", "circle O", ' +
  '"sector P-Q on O minor", "segment P-Q on O minor", or a region named with "name:"'

// A polygon's points: hyphenated ("A-B-C-D"), or run together when every
// name is one letter ("ABCD").
function regionPoints(text: string, count: number | null, role: string): string[] {
  if (count !== null) return parsePointRun(text, count, role).map((name) => geometryName(name, role))
  const trimmed = text.trim()
  const names = trimmed.includes('-') ? trimmed.split('-').map((p) => p.trim()) : [...trimmed]
  if (names.length < 3) throw new Error(`A polygon needs at least three points — "${role} A-B-C" — got "${trimmed}"`)
  return names.map((name) => geometryName(name, role))
}

function parseRegionOperand(text: string): RegionExpr {
  const source = text
  // F7 — conics other than circles bound no region the engine can shade.
  const conic = /^(ellipse|parabola|hyperbola|conic)\b/.exec(text)
  if (conic) {
    throw new Error(`A fill is bounded by segments and circle arcs — a region bounded by ${conic[1] === 'ellipse' ? 'an' : 'a'} ${conic[1]} cannot be shaded yet`)
  }

  const shape = /^(sector|segment)\s+(.+?)\s+on\s+([a-zA-Z]+)(?:\s+(\S+))?$/.exec(text)
  if (shape) {
    const kind = shape[1] as 'sector' | 'segment'
    const [from, to] = parseCirclePair(shape[2], kind)
    return {
      kind,
      circle: geometryName(shape[3], `circle the ${kind} lies on`),
      from,
      to,
      direction: requireArcDirection(shape[4], `${kind} ${shape[2].trim()}`),
      source,
    }
  }

  const disk = /^circle\s+(\S+)$/.exec(text)
  if (disk) return { kind: 'disk', circle: geometryName(disk[1], 'circle to shade'), source }

  const polygon = /^(polygon|triangle|square|rectangle)\s+(.+)$/.exec(text)
  if (polygon) {
    const shapeName = polygon[1] as 'polygon' | 'triangle' | 'square' | 'rectangle'
    const count = shapeName === 'polygon' ? null : shapeName === 'triangle' ? 3 : 4
    return { kind: 'polygon', shape: shapeName, points: regionPoints(polygon[2], count, shapeName), source }
  }

  // The spec's own form: "fill: A-B-C".
  if (/^[a-zA-Z]+(\s*-\s*[a-zA-Z]+)+$/.test(text)) {
    return { kind: 'polygon', shape: 'polygon', points: regionPoints(text, null, 'polygon'), source }
  }

  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) return { kind: 'named', name: text, source }

  throw new Error(`Expected a region to shade — ${REGION_FORMS} — got "${text}"`)
}

// A region expression, as a "fill:" or an "area" subject writes it.
function parseRegionExpr(text: string): RegionExpr {
  const tokens = text.replace(/[()]/g, ' $& ').trim().split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0) throw new Error(`Expected a region to shade — ${REGION_FORMS}`)
  let at = 0

  const operand = (): RegionExpr => {
    if (tokens[at] === '(') {
      at++
      const inner = expression()
      if (tokens[at] !== ')') throw new Error(`A "(" in the region "${text.trim()}" is never closed`)
      at++
      return { ...inner, source: `(${inner.source})` }
    }
    const words: string[] = []
    while (at < tokens.length && tokens[at] !== '(' && tokens[at] !== ')' && !REGION_OPERATORS.has(tokens[at])) words.push(tokens[at++])
    if (words.length === 0) {
      const found = at < tokens.length ? `"${tokens[at]}"` : 'the end of the line'
      throw new Error(`Expected a region before ${found} in "${text.trim()}" — ${REGION_FORMS}`)
    }
    return parseRegionOperand(words.join(' '))
  }

  const expression = (): RegionExpr => {
    let left = operand()
    while (at < tokens.length && tokens[at] !== ')') {
      const word = tokens[at]
      const op = REGION_OPERATORS.get(word)
      if (!op) throw new Error(`Expected "minus", "and", "or", "intersect" or "union" in "${text.trim()}", got "${word}"`)
      at++
      const right = operand()
      left = { kind: 'combine', op, left, right, source: `${left.source} ${word} ${right.source}` }
    }
    return left
  }

  const region = expression()
  if (at < tokens.length) throw new Error(`A ")" in the region "${text.trim()}" has no "(" to close`)
  return region
}

// "fill: <region>" (phase 12, F4).
function parseFill(text: string): StatementShape {
  // F7 — hatching is Track 5's styling; a fill is a flat tint.
  if (/\b(hatch|hatched|hatching)\s*$/.test(text) || /\bpattern:/.test(text)) {
    throw new Error('Hatching is not drawn yet — a fill is a flat tint; give it a colour with "color:"')
  }
  return { kind: 'fill', region: parseRegionExpr(text) }
}

// The body of a solid statement: the primitive, plus an optional trailing
// "vertices ABCD" clause naming the projected vertices. `name` comes from the
// bound form ("S = solid ...") and is null for the drawn-only "solid: ..." one.
function parseSolidBody(text: string, name: string | null): StatementShape {
  let rest = text.trim()
  let vertices: string[] = []
  const clause = /\s+vertices\s+(\S+)\s*$/i.exec(rest)
  if (clause) rest = rest.slice(0, clause.index).trim()
  const primitive = parseSolidPrimitive(rest)
  if (clause) {
    const names = [...clause[1].trim()]
    // A prism on a triangle names a three-letter top (P6); every other
    // solid has at least four vertices.
    const least = primitive.kind === 'prismOn' ? 3 : 4
    if (names.length < least || names.some((n) => !/^[a-zA-Z]$/.test(n))) {
      throw new Error(`Expected "vertices ABCD" — a run of single-letter names, one per vertex — got "${clause[1]}"`)
    }
    if (new Set(names).size !== names.length) throw new Error(`Vertex names must be distinct, got "${clause[1]}"`)
    vertices = names
  }
  return { kind: 'solid', name, primitive, vertices }
}

function parseTriangleStatement(line: string): StatementShape {
  const colon = line.indexOf(':')
  if (colon === -1) throw new Error('Expected "triangle ABC: <measurement>, <measurement>, <measurement>"')
  const names = parseTriangleNames(line.slice('triangle'.length, colon), 'triangle')
  const sides: Partial<Record<TriangleSlot, Expr>> = {}
  const angles: Partial<Record<TriangleSlot, Expr>> = {}
  const slots: TriangleSlot[] = ['a', 'b', 'c']

  for (const chunk of splitTopLevelComma(line.slice(colon + 1))) {
    const eqIdx = chunk.indexOf('=')
    if (eqIdx === -1) throw new Error(`Expected "<side> = <value>" or "angle <vertex> = <value>", got "${chunk.trim()}"`)
    const lhs = chunk.slice(0, eqIdx).trim()
    const value = parseExprString(chunk.slice(eqIdx + 1))

    const angleAt = /^angle\s+([a-zA-Z])$/.exec(lhs)
    if (angleAt) {
      const index = names.indexOf(angleAt[1])
      if (index === -1) throw new Error(`"${angleAt[1]}" is not a vertex of triangle ${names.join('')}`)
      if (angles[slots[index]]) throw new Error(`Angle ${angleAt[1]} of triangle ${names.join('')} is given twice`)
      angles[slots[index]] = value
      continue
    }

    if (!/^[a-zA-Z]{2}$/.test(lhs)) throw new Error(`Expected a side ("AB") or an angle ("angle A") of triangle ${names.join('')}, got "${lhs}"`)
    const endpoints = [lhs[0], lhs[1]]
    if (endpoints[0] === endpoints[1] || endpoints.some((v) => !names.includes(v))) {
      throw new Error(`"${lhs}" is not a side of triangle ${names.join('')}`)
    }
    // The side joining two vertices is the one opposite the third.
    const oppositeIndex = names.findIndex((v) => !endpoints.includes(v))
    if (sides[slots[oppositeIndex]]) throw new Error(`Side ${lhs} of triangle ${names.join('')} is given twice`)
    sides[slots[oppositeIndex]] = value
  }

  return { kind: 'triangle', names, sides, angles }
}

// The kind-specific grammar, unaware of the trailing "color:" clause the
// outer parseStatement below splices off first.
function parseStatementCore(rawLine: string): StatementShape {
  const line = stripComment(rawLine).trim()
  if (line.length === 0) throw new Error('Empty statement')

  // Slope/direction field: "field: dy/dx = <expr(x,y)>"
  if (line.startsWith('field:')) {
    const rest = line.slice('field:'.length).trim()
    const eqIdx = rest.indexOf('=')
    if (eqIdx === -1) throw new Error('Expected "field: dy/dx = <expr(x,y)>"')
    const lhs = rest.slice(0, eqIdx).trim()
    if (lhs !== 'dy/dx') throw new Error(`Expected "dy/dx" on the left of a field statement, got "${lhs}"`)
    return { kind: 'field', body: parseExprString(rest.slice(eqIdx + 1)) }
  }

  // Scatter points: "scatter: (1,2), (2,3), (4,5)"
  if (line.startsWith('scatter:')) {
    const rest = line.slice('scatter:'.length).trim()
    const tupleStrs = splitTopLevelComma(rest)
    const points: [Expr, Expr][] = tupleStrs.map((s) => {
      const parts = parseTuple(s)
      if (parts.length !== 2) throw new Error(`Scatter points must be "(x, y)", got "${s.trim()}"`)
      return [parts[0], parts[1]]
    })
    if (points.length === 0) throw new Error('scatter needs at least one point')
    return { kind: 'scatter', points }
  }

  // Table header/row: "header: cell | cell | cell", "row: cell | cell | cell"
  // — each optionally prefixed with "<name>." to target one specific table
  // when a spec defines more than one (see splitTableName below);
  // unprefixed lines belong to the same default (unnamed) table.
  const headerMatch = splitTableName(line, 'header')
  if (headerMatch) {
    return { kind: 'tableHeader', tableName: headerMatch.tableName, cells: headerMatch.rest.split('|').map((c) => c.trim()) }
  }
  const rowMatch = splitTableName(line, 'row')
  if (rowMatch) {
    return { kind: 'tableRow', tableName: rowMatch.tableName, cells: rowMatch.rest.split('|').map((c) => c.trim()) }
  }

  // Auto-generated value table: "table: y = x^2 for x in [0, 5] step 1"
  const tableMatch = splitTableName(line, 'table')
  if (tableMatch) {
    const rest = tableMatch.rest.trim()
    const eqIdx = rest.indexOf('=')
    if (eqIdx === -1) throw new Error('Expected "table: y = <expr(x)> for x in [a, b] step s"')
    const dependent = rest.slice(0, eqIdx).trim()
    const afterEq = rest.slice(eqIdx + 1).trim()
    const forIdx = afterEq.indexOf(' for ')
    if (forIdx === -1) throw new Error('Expected "table: y = <expr(x)> for x in [a, b] step s"')
    const bodyStr = afterEq.slice(0, forIdx).trim()
    const rangeStr = afterEq.slice(forIdx + ' for '.length).trim()
    const stepIdx = rangeStr.indexOf(' step ')
    if (stepIdx === -1) throw new Error('Expected "... step <s>" after the range')
    const { param: independent, from, to } = parseForRange(rangeStr.slice(0, stepIdx).trim())
    const step = parseExprString(rangeStr.slice(stepIdx + ' step '.length).trim())
    // Kept as the raw "dependent = bodyStr" source text (not re-derived from
    // the parsed Expr) so a table can optionally display its generating
    // formula (see parser/config.ts's "formulas" directive) exactly as
    // written, without needing an AST-to-string pretty-printer.
    const formula = `${dependent} = ${bodyStr}`
    return { kind: 'tableGenerator', tableName: tableMatch.tableName, dependent, body: parseExprString(bodyStr), formula, independent, from, to, step }
  }

  // Circle by center + radius: "circle: (cx, cy), r"
  if (line.startsWith('circle:')) {
    const rest = line.slice('circle:'.length).trim()
    const parts = splitTopLevelComma(rest)
    if (parts.length !== 2) throw new Error('Expected "circle: (cx, cy), r"')
    const center = parseTuple(parts[0])
    if (center.length !== 2) throw new Error('Expected "circle: (cx, cy), r"')
    return { kind: 'circle', cx: center[0], cy: center[1], radius: parseExprString(parts[1]) }
  }

  // Polygon by labeled vertices: "polygon: A(0,0), B(4,0), C(2,3)" — each
  // vertex also registers as a named point (see buildScene.ts), usable by
  // angle:/tick:/right-angle: and in later statements' expressions, same as
  // a plain "A = (x, y)" point statement would.
  if (line.startsWith('polygon:')) {
    const rest = line.slice('polygon:'.length).trim()
    const chunks = splitTopLevelComma(rest).map((c) => c.trim())
    if (chunks.length < 3) throw new Error('polygon needs at least 3 vertices, e.g. "polygon: A(0,0), B(4,0), C(2,3)"')
    const vertexPattern = /^([a-zA-Z][a-zA-Z0-9_]*)\((.+)\)$/
    const vertices = chunks.map((chunk) => {
      const match = vertexPattern.exec(chunk)
      if (!match) throw new Error(`Expected "<Label>(x, y)", got "${chunk}"`)
      const [, label, inner] = match
      const coords = splitTopLevelComma(inner)
      if (coords.length !== 2) throw new Error(`Expected "<Label>(x, y)", got "${chunk}"`)
      return { label, x: parseExprString(coords[0]), y: parseExprString(coords[1]) }
    })
    return { kind: 'polygon', vertices }
  }

  // Angle arc: "angle: A-B-C" (vertex is the middle name), optionally
  // "angle: A-B-C label: 60°" to show text near the arc. A/B/C are names of
  // points defined elsewhere (a plain point statement or a polygon vertex —
  // see buildScene.ts's named-point pass), resolved order-independently
  // same as function/constant references. If combined with color:/name:,
  // "label:" must come last (those two are stripped from the true end of
  // the line before this runs — see parseStatement's outer wrapper — so a
  // "label:" positioned before either of them wouldn't get a chance to be
  // recognized as the trailing clause it is).
  if (line.startsWith('angle:')) {
    const rest = line.slice('angle:'.length).trim()
    const labelIdx = rest.indexOf('label:')
    const spec = (labelIdx === -1 ? rest : rest.slice(0, labelIdx)).trim()
    const label = labelIdx === -1 ? null : rest.slice(labelIdx + 'label:'.length).trim()
    // M8 (phase 10) — an angle between two lines, or a line and a plane, has
    // no vertex: skew lines never meet, and a line meets a plane where the
    // angle is not drawn. Its value belongs in the table; its mark, on a
    // construction that has a vertex.
    if (/^between\s/.test(spec)) {
      throw new Error(
        `An angle between two lines, or a line and a plane, has no vertex to draw its mark at — put its measure in the givens table ` +
          `("given: angle ${spec}"), or draw the construction that has one (drop the foot F and mark "angle: A-P-F")`
      )
    }
    const parts = spec.split('-').map((p) => p.trim())
    const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    if (parts.length !== 3 || parts.some((p) => !namePattern.test(p))) {
      throw new Error('Expected "angle: A-B-C" (three point names, vertex in the middle)')
    }
    return { kind: 'angle', from: parts[0], vertex: parts[1], to: parts[2], label }
  }

  // Measure label: "label: AB", "label: AB = 8", "label: angle ABC",
  // "label: segment AB". See parseMeasureLabel for the grammar and for why
  // "= 8" is a check rather than a caption.
  //
  // Checked before the generic "=" forms below, which would otherwise read
  // "label: AB = 8" as an implicit curve.
  if (line.startsWith('label:')) return parseMeasureLabel(line.slice('label:'.length))

  // A line of the boxed givens panel — the same subjects as "label:", written
  // out rather than measured onto the drawing.
  if (line.startsWith('given:')) return parseGiven(line.slice('given:'.length), 'given')

  // The same row, in the table's "Find" section. A sibling statement rather
  // than a qualifier on "given:", because "find: BC" is how the sentence
  // reads and the two sections are the conventional pair.
  if (line.startsWith('find:')) return parseGiven(line.slice('find:'.length), 'find')

  // Congruence tick mark(s): "tick: A-B", optionally "tick: A-B count: 2" —
  // give two tick: statements the same count to mark their segments
  // congruent. A/B resolved the same way as angle:'s points.
  if (line.startsWith('tick:')) {
    const rest = line.slice('tick:'.length).trim()
    const countIdx = rest.indexOf('count:')
    const spec = (countIdx === -1 ? rest : rest.slice(0, countIdx)).trim()
    const countStr = countIdx === -1 ? '1' : rest.slice(countIdx + 'count:'.length).trim()
    const count = Number.parseInt(countStr, 10)
    if (!Number.isFinite(count) || count < 1 || String(count) !== countStr) {
      throw new Error(`tick count must be a positive integer, got "${countStr}"`)
    }
    const parts = spec.split('-').map((p) => p.trim())
    const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    if (parts.length !== 2 || parts.some((p) => !namePattern.test(p))) {
      throw new Error('Expected "tick: A-B" (two point names)')
    }
    return { kind: 'tick', from: parts[0], to: parts[1], count }
  }

  // Segment between two named points: "segment: A-B", optionally
  // "segment: A-B dashed". A/B resolved the same way as angle:'s points, so
  // this can draw between *constructed* points — which the coordinate form
  // "(x1,y1) -- (x2,y2)" cannot, since a construction has no coordinates to
  // type. This is what makes "drop the altitude and draw it dashed" one line.
  //
  // "plain" is the other override: between points in a solid figure a
  // segment is dashed where a solid hides it (S6), and an author may force
  // either style against that rule.
  if (line.startsWith('segment:')) {
    const rest = line.slice('segment:'.length).trim()
    const forced = /\b(dashed|plain)$/.exec(rest)
    const style = forced ? (forced[1] as 'dashed' | 'plain') : 'auto'
    const spec = (forced ? rest.slice(0, forced.index) : rest).trim()
    const parts = spec.split('-').map((p) => p.trim())
    const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    if (parts.length !== 2 || parts.some((p) => !namePattern.test(p))) {
      throw new Error('Expected "segment: A-B" (two point names), optionally followed by "dashed" or "plain"')
    }
    return { kind: 'namedSegment', from: parts[0], to: parts[1], style }
  }

  // Right-angle marker: "right-angle: A-B-C" (vertex is the middle name) —
  // the small square at B indicating a 90-degree angle between rays B->A
  // and B->C. A/B/C resolved the same way as angle:'s points.
  if (line.startsWith('right-angle:')) {
    const rest = line.slice('right-angle:'.length).trim()
    const parts = rest.split('-').map((p) => p.trim())
    const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    if (parts.length !== 3 || parts.some((p) => !namePattern.test(p))) {
      throw new Error('Expected "right-angle: A-B-C" (three point names, vertex in the middle)')
    }
    return { kind: 'rightAngle', from: parts[0], vertex: parts[1], to: parts[2] }
  }

  // The dihedral angle's mark (phase 10, M3): "dihedral: C-A-B-D", the edge
  // in the middle ("C-AB-D"). "CABD" works too, as in a label.
  if (line.startsWith('dihedral:')) {
    const [from, a, b, to] = parsePointRun(line.slice('dihedral:'.length), 4, 'dihedral')
    return { kind: 'dihedral', from, edge: [a, b], to }
  }

  // A solid: "solid: prism 8 by 5 by 6". The bound form, "S = solid prism
  // 8 by 5 by 6", is handled with the other "=" statements below.
  if (line.startsWith('solid:')) return parseSolidBody(line.slice('solid:'.length), null)

  // Q7 (phase 8) — what an author might ask for that is not drawn: a plane on
  // its own (a plane is drawn only through the section it cuts), and — until
  // phase 11 made "net:" a statement — a net. Refused in words, rather than
  // as an unrecognised line.
  // They catch ONLY those shapes (fix rounds 1 and 2): "plane:" / "net:", or
  // "plane <operand>" / "net <solid>" — the keyword, a space, a letter — on a
  // line with no relation in it (no "=", "<" or ">"). Every such line was an
  // "Unrecognized statement" before phase 8. Anything else starting with the
  // word — an assignment ("plane = 2"), an operator ("net + x = y"), a call
  // ("net (x) = x^2"), an implicit product ("plane x = 1", "net x > y") —
  // falls through to the grammar below exactly as it always did.
  if (/^plane(:|\s+[a-zA-Z][^=<>]*$)/.test(line)) {
    throw new Error(
      'A plane is not drawn on its own — it is drawn through the section it cuts ("cut: S by plane A-B-C"), and named with "p = plane A-B-C"'
    )
  }
  // Phase 11 (N1) — "net: S" is the statement now. A bare "net S" with no
  // relation in it (refused since phase 8) stays refused, pointing at the
  // colon; every other line starting with the word ("net = 5", "net(x) =
  // x^2", "net + x = y") falls through exactly as it always did.
  if (line.startsWith('net:')) return parseNet(line.slice('net:'.length))
  if (/^net\s+[a-zA-Z][^=<>]*$/.test(line)) throw new Error(`A net is written with a colon — "net: ${line.slice('net'.length).trim()}"`)
  // Phase 11 (N3, N5) — "shortest: P to Q over S [unfold]". Only the keyword
  // with its colon: "shortest = 3" and the like read as they always did.
  if (line.startsWith('shortest:')) return parseShortest(line.slice('shortest:'.length))
  // Phase 12 (F4) — "fill: <region>". Only the keyword with its colon:
  // "fill = 3", "fill(x) = x^2" and "fill + x = y" read as they always did. A
  // bare "fill A-B-C" with no relation in it (unrecognised before) points at
  // the colon, as "net S" does.
  if (line.startsWith('fill:')) return parseFill(line.slice('fill:'.length))
  if (/^fill\s+[a-zA-Z][^=<>]*$/.test(line)) throw new Error(`A fill is written with a colon — "fill: ${line.slice('fill'.length).trim()}"`)

  // The two forms of a cross-section. Checked before the generic "=" handling
  // below, which would otherwise read "cut: S by plane z = 3" as an implicit
  // curve.
  if (line.startsWith('cut:')) return parseCrossSection(line.slice('cut:'.length), false)
  if (line.startsWith('section:')) return parseCrossSection(line.slice('section:'.length), true)

  // Solved triangle: "triangle ABC: AB = 8, angle A = 90, AC = 6". Checked
  // before the generic "=" handling below, since the measurement list
  // contains "=" signs of its own.
  if (/^triangle\s/.test(line)) return parseTriangleStatement(line)

  // The nameless centre-circle forms the spec writes bare: "incircle of ABC"
  // and "circumcircle of ABC" draw the circle without binding a name to it.
  if (/^(incircle|circumcircle)\s/.test(line)) {
    const centre = parseTriangleCentre(line)
    if (!centre) throw new Error(`Expected "incircle of ABC" or "circumcircle of ABC", got "${line}"`)
    return { kind: 'construction', names: [], body: centre }
  }

  // The circle vocabulary drawn without a name to bind — the same forms the
  // "<name> = ..." grammar takes, the way "incircle of ABC" already works.
  // Checked before the generic "=" handling below (and before "tangent:",
  // which is a different statement entirely: a tangent to a *function*).
  if (/^(chord|tangent|secant|radius|diameter)\s/.test(line)) {
    const body = parseCircleConstruction(line)
    if (body) return { kind: 'construction', names: [], body }
  }

  // Arcs, the two fills built on one, and the two angle marks.
  const circleShape = parseCircleShape(line)
  if (circleShape) return circleShape

  // Tangent line: "tangent: x^2 - 1 at x = 2"
  if (line.startsWith('tangent:')) {
    const rest = line.slice('tangent:'.length).trim()
    const atIdx = rest.indexOf(' at ')
    if (atIdx === -1) throw new Error('Expected "tangent: <expr(x)> at x = <value>"')
    const body = parseExprString(rest.slice(0, atIdx).trim())
    const atClause = rest.slice(atIdx + ' at '.length).trim()
    const eqIdx = atClause.indexOf('=')
    if (eqIdx === -1 || atClause.slice(0, eqIdx).trim() !== 'x') throw new Error('Expected "at x = <value>"')
    return { kind: 'tangent', body, at: parseExprString(atClause.slice(eqIdx + 1).trim()) }
  }

  // Labeled vector: "vector: (0,0) -> (3,4)" — a ray, plus a magnitude label.
  if (line.startsWith('vector:')) {
    return { kind: 'vector', ...parseArrow(line.slice('vector:'.length)) }
  }

  // Animated/traced point: "animate: (cos(t), sin(t)) for t in [0, 6.283]"
  if (line.startsWith('animate:')) {
    const rest = line.slice('animate:'.length).trim()
    const forIdx = rest.indexOf(' for ')
    if (forIdx === -1) throw new Error('Expected "animate: (fx(t), fy(t)) for t in [a, b]"')
    const tuple = parseTuple(rest.slice(0, forIdx))
    if (tuple.length !== 2 && tuple.length !== 3) {
      throw new Error(`"animate" needs a 2- or 3-component tuple, got "${rest.slice(0, forIdx).trim()}"`)
    }
    const range = parseForRange(rest.slice(forIdx + ' for '.length).trim())
    return {
      kind: 'animatedPoint',
      fx: tuple[0],
      fy: tuple[1],
      fz: tuple.length === 3 ? tuple[2] : null,
      param: range.param,
      from: range.from,
      to: range.to,
    }
  }

  // Named function definition: "k(x) = x^2 + 1" — usable in later statements
  // as k(...), including composed with other functions. Checked before the
  // generic "for" and "=" handling below, since a bare parenthesized
  // parameter name after an identifier ("name(param) = ...") doesn't overlap
  // with anything else in the grammar (parametric tuples start with "(",
  // not an identifier).
  const functionDefMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\(([a-zA-Z_][a-zA-Z0-9_]*)\)\s*=(.*)$/.exec(line)
  if (functionDefMatch) {
    const [, name, param, body] = functionDefMatch
    return { kind: 'functionDef', name, param, body: parseExprString(body) }
  }

  // Polar curve: "r = 1 + cos(theta)" (theta defaults to [0, 2*pi]) or
  // "r = f(theta) for theta in [a, b]"
  if (/^r\s*=/.test(line)) {
    const eqIdx = line.indexOf('=')
    let rest = line.slice(eqIdx + 1).trim()
    let from: Expr = { kind: 'num', value: 0 }
    let to: Expr = { kind: 'binary', op: '*', left: { kind: 'num', value: 2 }, right: { kind: 'var', name: 'pi' } }
    const forIdx = rest.indexOf(' for ')
    if (forIdx !== -1) {
      const range = parseForRange(rest.slice(forIdx + ' for '.length).trim())
      from = range.from
      to = range.to
      rest = rest.slice(0, forIdx).trim()
    }
    return { kind: 'polar', body: parseExprString(rest), from, to }
  }

  // Parametric curve/surface: "(...) for t in [a, b]" or "(...) for u in [a,b], v in [c,d]"
  const forIdx = line.indexOf(' for ')
  if (forIdx !== -1) {
    const tupleStr = line.slice(0, forIdx)
    const rangeStr = line.slice(forIdx + ' for '.length).trim()
    const tuple = parseTuple(tupleStr)

    const clauses = splitTopLevelComma(rangeStr).map(parseForRange)

    if (clauses.length === 1) {
      if (tuple.length !== 2 && tuple.length !== 3) {
        throw new Error(`A single "for" parameter needs a 2- or 3-component tuple, got "${tupleStr.trim()}"`)
      }
      return {
        kind: 'parametric',
        fx: tuple[0],
        fy: tuple[1],
        fz: tuple.length === 3 ? tuple[2] : null,
        param: clauses[0].param,
        from: clauses[0].from,
        to: clauses[0].to,
      }
    }

    if (clauses.length === 2) {
      if (tuple.length !== 3) {
        throw new Error(`A parametric surface needs a 3-component tuple "(fx(u,v), fy(u,v), fz(u,v))", got "${tupleStr.trim()}"`)
      }
      return {
        kind: 'parametricSurface',
        fx: tuple[0],
        fy: tuple[1],
        fz: tuple[2],
        paramU: clauses[0].param,
        uFrom: clauses[0].from,
        uTo: clauses[0].to,
        paramV: clauses[1].param,
        vFrom: clauses[1].from,
        vTo: clauses[1].to,
      }
    }

    throw new Error(`Expected one or two "<param> in [a, b]" clauses after "for", got ${clauses.length}`)
  }

  // Ray: "(x1,y1[,z1]) -> (x2,y2[,z2])"
  if (line.indexOf('->') !== -1) {
    return { kind: 'ray', ...parseArrow(line) }
  }

  // Segment: "(x1,y1[,z1]) -- (x2,y2[,z2])"
  const segIdx = line.indexOf('--')
  if (segIdx !== -1) {
    const from = parseTuple(line.slice(0, segIdx))
    const to = parseTuple(line.slice(segIdx + 2))
    return {
      kind: 'segment',
      x1: from[0],
      y1: from[1],
      z1: from.length === 3 ? from[2] : null,
      x2: to[0],
      y2: to[1],
      z2: to.length === 3 ? to[2] : null,
    }
  }

  // Bare point: "(x, y)" or "(x, y, z)" with nothing else on the line.
  if (line.startsWith('(') && line.endsWith(')')) {
    const parts = parseTuple(line)
    return { kind: 'point', label: null, x: parts[0], y: parts[1], z: parts.length === 3 ? parts[2] : null }
  }

  // Whichever relation — a plain "=" or a comparator — appears first decides
  // the statement kind. This has to be a single left-to-right scan rather
  // than two separate checks: an explicit statement's "if x < 0" clause
  // contains a "<" too, so a comparator-first check would misread the whole
  // line as an inequality region. Scanning for whichever comes first means
  // "y = ... if x < 0"'s "=" (right after "y") wins, while "y > x^2 - 1" (no
  // "=" at all) correctly falls through to the comparator case below.
  const relation = findTopLevelRelation(line)
  if (relation?.type === 'comparator') {
    const left = line.slice(0, relation.idx).trim()
    const right = line.slice(relation.idx + relation.op.length).trim()
    // The "if <condition>" piecewise clause only exists on y=/x= explicit
    // statements (see the "equals" branch below) — an inequality region has
    // no such clause in its grammar. Without this check, a stray "if" here
    // falls through into parseExprString(right), where the tokenizer chokes
    // on the leftover comparator inside the condition text (e.g. the "<=" in
    // "0 <= x <= 3") with an opaque "Unexpected character" error that gives
    // no hint the real mistake was applying "if" to the wrong statement form.
    if (/\bif\b/.test(right)) {
      throw new Error(
        `"if" clauses are only valid on explicit y=/x= function statements, not on inequality-region statements. ` +
          `To shade over a bounded interval, restrict the function itself instead, e.g. "y = x^2 if 0 <= x <= 3".`
      )
    }

    // A second top-level comparator inside "right" means this is a chained
    // comparison ("7 < x < 12"), not a single region — expressions never
    // contain "<"/">" themselves, so any second comparator here is
    // unambiguously a chain, not a false positive from the expression text.
    const second = findComparator(right)
    if (second) {
      const mid = right.slice(0, second.idx).trim()
      const tail = right.slice(second.idx + second.op.length).trim()
      if (findComparator(tail)) {
        throw new Error(
          `A chained comparison supports only two operators (e.g. "7 < x < 12"), but found a third comparator in "${line.trim()}".`
        )
      }
      const firstIsLess = relation.op === '<' || relation.op === '<='
      const secondIsLess = second.op === '<' || second.op === '<='
      if (firstIsLess !== secondIsLess) {
        throw new Error(
          `Chained comparison operators must point the same direction, but found "${relation.op}" and "${second.op}" in "${line.trim()}". ` +
            `Use "a < x < b" or "a > x > b", not a mix like "a < x > b".`
        )
      }
      // Normalise "a > x > b" into the equivalent "b < x < a" shape so
      // buildScene only ever has to handle one internal form.
      const flip = (op: '<' | '<=' | '>' | '>='): '<' | '<=' => (op === '>' ? '<' : op === '>=' ? '<=' : op)
      const low = firstIsLess ? left : tail
      const lowOp = firstIsLess ? relation.op : flip(second.op)
      const high = firstIsLess ? tail : left
      const highOp = firstIsLess ? second.op : flip(relation.op)
      return {
        kind: 'regionChain',
        low: parseExprString(low),
        lowOp: lowOp as '<' | '<=',
        mid: parseExprString(mid),
        highOp: highOp as '<' | '<=',
        high: parseExprString(high),
      }
    }

    return { kind: 'region', left: parseExprString(left), op: relation.op, right: parseExprString(right) }
  }

  if (relation?.type === 'equals') {
    const eqIdx = relation.idx
    const lhs = line.slice(0, eqIdx).trim()
    const rhs = line.slice(eqIdx + 1).trim()

    if (lhs === 'y' || lhs === 'x') {
      const independent = lhs === 'y' ? 'x' : 'y'
      const ifIdx = rhs.indexOf(' if ')
      if (ifIdx === -1) return { kind: 'explicit', independent, body: parseExprString(rhs), condition: null }
      const body = parseExprString(rhs.slice(0, ifIdx).trim())
      const condition = parseCondition(rhs.slice(ifIdx + ' if '.length).trim(), independent)
      return { kind: 'explicit', independent, body, condition }
    }
    if (lhs === 'z') return { kind: 'surface', body: parseExprString(rhs) }

    // A named geometry construction: "M = midpoint A-B", and the two-name
    // form "P, Q = intersect circle O, line B-C". Checked after the y=/x=/z=
    // and polar cases above so those reserved names keep their meaning, and
    // before the labeled-point and named-constant cases below, whose
    // left-hand sides it would otherwise look identical to.
    // The bound solid: "S = solid prism 8 by 5 by 6". Checked before the
    // construction and named-constant cases, whose left-hand sides look the
    // same — a solid is not a point, a line or a circle, so it is not a
    // Construction, but it binds a name in the same definition-before-use way.
    if (GEOMETRY_NAME.test(lhs) && /^solid\s/.test(rhs)) {
      return parseSolidBody(rhs.slice('solid'.length), lhs)
    }

    // A named plane (phase 8, Q2): "p = plane A-B-C", any plane form on the
    // right. It binds, and draws nothing.
    if (GEOMETRY_NAME.test(lhs) && /^plane\s/.test(rhs)) {
      return { kind: 'planeDef', name: lhs, plane: parsePlaneForm(rhs.slice('plane'.length), 'named plane') }
    }

    const constructionNames = splitTopLevelComma(lhs).map((part) => part.trim())
    if (constructionNames.every((name) => GEOMETRY_NAME.test(name))) {
      const body = parseConstructionBody(rhs)
      if (body) return { kind: 'construction', names: constructionNames, body }
    }

    // Labeled point: "A = (2, 3)" or "A = (2, 3, 1)"
    if (/^[a-zA-Z]+$/.test(lhs) && rhs.startsWith('(') && rhs.endsWith(')')) {
      const parts = parseTuple(rhs)
      return { kind: 'point', label: lhs, x: parts[0], y: parts[1], z: parts.length === 3 ? parts[2] : null }
    }

    // Named constant: "a = 5" — usable as a bare variable in later statements.
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lhs)) {
      return { kind: 'constantDef', name: lhs, value: parseExprString(rhs) }
    }

    // Implicit curve: "x^2/9 + y^2/4 = 1"
    return { kind: 'implicit', left: parseExprString(lhs), right: parseExprString(rhs) }
  }

  throw new Error(`Unrecognized statement: "${line}"`)
}

const COLOR_CLAUSE = /\s+color:\s*(\S+)\s*$/i
const NAME_CLAUSE = /\s+name:\s*(\S+)\s*$/i

// Matches and strips one end-anchored trailing clause, if present. A plain
// helper function (rather than inlining this in parseStatement's loop)
// sidesteps a TypeScript inference quirk where a mutable outer `let` read
// inside a loop's own re-assignment expression gets flagged as circular.
function stripTrailingClause(line: string, pattern: RegExp): { line: string; value: string } | null {
  const match = pattern.exec(line)
  if (!match) return null
  return { line: line.slice(0, match.index), value: match[1] }
}

// ---------------------------------------------------------------------------
// Measure labels
// ---------------------------------------------------------------------------

// The same name rule angle:/tick:/segment: use for their points, so a label
// can name anything those can.
const POINT_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// A run of single letters ("AB", "ABC") is the form the subject is written in
// when every point has a one-letter name, which is the common case and the
// one the spec writes. "A-B" is the fallback for longer names, and is the
// spelling the rest of the geometry DSL already uses.
function parsePointRun(text: string, count: number, role: string): string[] {
  const trimmed = text.trim()
  const names = trimmed.includes('-') ? trimmed.split('-').map((p) => p.trim()) : [...trimmed]
  const plural = `${['', 'one', 'two', 'three', 'four'][count]} point names`
  const letters = 'ABCD'.slice(0, count)
  if (names.length !== count || names.some((n) => !POINT_NAME.test(n))) {
    throw new Error(`Expected ${plural} for the ${role} — "${letters}" or "${[...letters].join('-')}" — got "${trimmed}"`)
  }
  return names
}

// ---------------------------------------------------------------------------
// Measures between lines and planes (phase 10, M5)
// ---------------------------------------------------------------------------
//
// "angle between A-B and C-D", "angle between A-B and plane P-Q-R",
// "distance between A-B and C-D", "distance from P to plane P-Q-R",
// "distance from P to line A-B". Each reads its own "= value", because a
// plane written as an equation carries an "=" of its own:
// "distance from G to plane x + y + z = 1" names a plane and asserts
// nothing, "distance from G to plane x + y + z = 1 = 0.577" asserts.

interface SpaceMeasure {
  subject: MeasureSubject
  // The subject as the author wrote it, before any "= value".
  text: string
  value: string | null
}

// Splits "<plane>[ = value]" where the plane may be an equation. Two "=":
// the last is the assertion. One: it is the plane's own when what precedes
// it is an equation side (an axis letter, or anything that is not a list of
// point names, "through ..." or a plane's name), else the assertion.
function splitPlaneValue(text: string): { plane: string; value: string | null } {
  const first = text.indexOf('=')
  if (first === -1) return { plane: text, value: null }
  const last = text.lastIndexOf('=')
  if (last !== first) return { plane: text.slice(0, last), value: text.slice(last + 1) }
  const before = text.slice(0, first).trim()
  const named = /^[a-zA-Z]+(\s*-\s*[a-zA-Z]+){2}$/.test(before) || /^through\s/.test(before) || (GEOMETRY_NAME.test(before) && !/^[xyzXYZ]$/.test(before))
  return named ? { plane: before, value: text.slice(first + 1) } : { plane: text, value: null }
}

function splitValue(text: string): { rest: string; value: string | null } {
  const equals = text.indexOf('=')
  return equals === -1 ? { rest: text, value: null } : { rest: text.slice(0, equals), value: text.slice(equals + 1) }
}

function parseSpaceMeasure(body: string): SpaceMeasure | null {
  const between = /^(angle|distance)\s+between\s+(.+?)\s+and\s+(.+)$/.exec(body)
  if (between) {
    const [, what, firstText, tail] = between
    if (/^plane\s/.test(firstText.trim()) || /^plane\s/.test(tail.trim())) {
      if (/^plane\s/.test(firstText.trim())) {
        throw new Error(
          what === 'angle'
            ? `The angle between two planes is a dihedral angle — write "dihedral C-A-B-D" along the edge A-B they share; "angle between" takes a line first ("angle between A-B and plane P-Q-R")`
            : `"distance between" takes two lines — for a plane, measure from a point: "distance from P to plane P-Q-R"`
        )
      }
      if (what === 'distance') {
        throw new Error(`"distance between" takes two lines — for a line and a plane, measure from a point of the line: "distance from P to plane P-Q-R"`)
      }
      const { plane, value } = splitPlaneValue(tail.trim().slice('plane'.length))
      const line = parseLineOperand(firstText, 'line of the angle')
      return {
        subject: { kind: 'linePlaneAngle', line, plane: parsePlaneForm(plane, 'plane of the angle') },
        text: `angle between ${firstText.trim()} and plane ${plane.trim()}`,
        value,
      }
    }
    const { rest, value } = splitValue(tail)
    const first = parseLineOperand(firstText, `first line of the ${what}`)
    const second = parseLineOperand(rest, `second line of the ${what}`)
    return {
      subject: what === 'angle' ? { kind: 'lineAngle', first, second } : { kind: 'lineDistance', first, second },
      text: `${what} between ${firstText.trim()} and ${rest.trim()}`,
      value,
    }
  }

  const from = /^distance\s+from\s+(\S+)\s+to\s+(.+)$/.exec(body)
  if (from) {
    const point = geometryName(from[1], 'point the distance is measured from')
    const target = from[2].trim()
    if (/^plane\s/.test(target)) {
      const { plane, value } = splitPlaneValue(target.slice('plane'.length))
      return {
        subject: { kind: 'pointPlaneDistance', point, plane: parsePlaneForm(plane, 'plane the distance is measured to') },
        text: `distance from ${point} to plane ${plane.trim()}`,
        value,
      }
    }
    const { rest, value } = splitValue(target)
    return {
      subject: { kind: 'pointLineDistance', point, line: parseLineOperand(rest, 'line the distance is measured to') },
      text: `distance from ${point} to ${rest.trim()}`,
      value,
    }
  }

  if (/^(angle|distance)\s+(between|from)\s/.test(body)) {
    throw new Error(
      `Expected "angle between A-B and C-D", "angle between A-B and plane P-Q-R", "distance between A-B and C-D", ` +
        `"distance from P to plane P-Q-R" or "distance from P to line A-B", got "${body}"`
    )
  }
  return null
}

// A stated value asserts, so it has to be a value and not an expression: the
// whole point of the form is comparing a number the author wrote against a
// number the engine computed. Anything that is not a plain decimal literal is
// symbolic instead — "x", "θ", "2a" — and prints without being checked.
//
// Drawing the line at "is it a literal" rather than "does it evaluate"
// matters: under an evaluating rule, whether "label: AB = a" asserted would
// depend on whether some other line happened to define a constant called `a`,
// and an author could not tell by looking at the label.
const NUMERIC_VALUE = /^[+-]?(\d+\.?\d*|\.\d+)$/

function parseMeasureContent(text: string): MeasureContent {
  const value = text.trim()
  if (value === '') throw new Error('Expected a value after "=" in a label, e.g. "label: AB = 8" or "label: AB = x"')
  if (NUMERIC_VALUE.test(value)) return { kind: 'stated', value: Number.parseFloat(value) }
  return { kind: 'symbol', text: value }
}

// What a label or a given names, and how that name is written when it is
// written out rather than measured.
//
// `explicit` says the author chose the notation form by keyword
// ("segment AB"), which is what makes "label: segment AB = 8" — two different
// labels asked for at once — refusable.
interface LabelSubject {
  subject: MeasureSubject
  mark: MeasureOvermark
  prefix: string
  explicit: boolean
}

function parseLabelSubject(text: string, role: string): LabelSubject {
  const subjectText = text.trim()

  const notation = /^(segment|ray|line)\s+(.+)$/.exec(subjectText)
  if (notation) {
    const [, word, names] = notation
    const [from, to] = parsePointRun(names, 2, `${word} ${role}`)
    return { subject: { kind: 'length', from, to }, mark: word as Exclude<MeasureOvermark, 'none'>, prefix: '', explicit: true }
  }

  // "arc PQ on O minor" — the circle and the direction are both required,
  // because an arc without them names neither one arc nor one measure.
  const arc = /^arc\s+(.+?)\s+on\s+([a-zA-Z]+)(?:\s+(\S+))?$/.exec(subjectText)
  if (arc) {
    const [from, to] = parseCirclePair(arc[1], `arc ${role}`)
    return {
      subject: {
        kind: 'arc',
        circle: geometryName(arc[2], `circle the arc ${role} lies on`),
        from,
        to,
        direction: requireArcDirection(arc[3], `arc ${arc[1].trim()}`),
      },
      // Written under an arc mark when it is written out rather than
      // measured, which is what the givens table does with it.
      mark: 'arc',
      prefix: '',
      explicit: false,
    }
  }

  if (/^arc\s/.test(subjectText)) {
    throw new Error(`Expected "arc PQ on <circle> <direction>" for the ${role}, got "${subjectText}"`)
  }

  const triangle = /^triangle\s+(.+)$/.exec(subjectText)
  if (triangle) {
    const [a, b, c] = parsePointRun(triangle[1], 3, `triangle ${role}`)
    return { subject: { kind: 'triangle', names: [a, b, c] }, mark: 'none', prefix: '△', explicit: true }
  }

  // Phase 12 (F3) — "area R", "area square ABCD minus circle O": the area
  // of a shaded region. "area of S" stays with the refusal below.
  const area = /^area\s+(.+)$/.exec(subjectText)
  if (area && !/^of\s/.test(area[1])) {
    // Fix round 1 (M6) — "area R < area S" and the like: a relation between
    // two areas is not a region, and is not stated yet.
    if (/[<>≤≥≅~∥⊥]|\barea\s/.test(area[1])) {
      throw new Error(`Relations between areas are not stated yet — give each area its own line ("${role}: area R", "${role}: area S")`)
    }
    return { subject: { kind: 'area', region: parseRegionExpr(area[1]) }, mark: 'none', prefix: '', explicit: false }
  }

  // M8 (phase 10) — areas and volumes are not measured yet; said so, rather
  // than misread as a malformed pair of point names.
  if (/^(?:[a-zA-Z]+\s+(?:volume|area|surface\s+area)|(?:volume|area|surface\s+area)\s+of\s+.+)$/.test(subjectText)) {
    throw new Error(`Areas and volumes are not measured yet — "${subjectText}" cannot be ${role === 'label' ? 'labelled' : 'stated'}; measure lengths and angles instead`)
  }

  // "shortest P to Q over S" (phase 11, N5): the length of the path.
  const shortest = /^shortest\s+(.+)$/.exec(subjectText)
  if (shortest) {
    return { subject: { kind: 'shortestPath', ...shortestParts(shortest[1], 'shortest P to Q over S') }, mark: 'none', prefix: '', explicit: false }
  }

  // "dihedral C-A-B-D" (phase 10, M3): the edge is the middle two names.
  const dihedral = /^dihedral\s+(.+)$/.exec(subjectText)
  if (dihedral) {
    const [from, a, b, to] = parsePointRun(dihedral[1], 4, `dihedral ${role}`)
    return { subject: { kind: 'dihedral', from, edge: [a, b], to }, mark: 'none', prefix: '', explicit: false }
  }

  const angle = /^angle\s+(.+)$/.exec(subjectText)
  if (angle) {
    const [from, vertex, to] = parsePointRun(angle[1], 3, `angle ${role}`)
    // "angle" selects which measurement is meant, not how to write it, so
    // this is not an explicit notation form: "label: angle ABC = 30" is a
    // perfectly ordinary asserted measure.
    return { subject: { kind: 'angle', from, vertex, to }, mark: 'none', prefix: '∠', explicit: false }
  }

  // "S height", "S edge" — a named dimension of a named solid. Two words, so
  // it cannot be confused with the one-word forms below; checked before them
  // because "S height" would otherwise fail as a malformed point run.
  const dimension = new RegExp(`^([a-zA-Z]+)\\s+(${SOLID_DIMENSIONS.join('|')})$`).exec(subjectText)
  if (dimension) {
    return {
      subject: { kind: 'solidDimension', solid: dimension[1], dimension: dimension[2] },
      mark: 'none',
      prefix: '',
      explicit: false,
    }
  }

  const [from, to] = parsePointRun(subjectText, 2, `length ${role}`)
  // A bare segment name is written with an overbar when it is written at all.
  return { subject: { kind: 'length', from, to }, mark: 'segment', prefix: '', explicit: false }
}

// The relations a given can state. Words and symbols both, because a spec is
// typed text and an author is as likely to paste the symbol as to spell it.
const RELATION_WORDS = ['congruent', 'cong', 'similar', 'sim', 'parallel', 'par', 'perpendicular', 'perp']
const RELATION_SYMBOLS: Record<string, string> = {
  congruent: '≅',
  cong: '≅',
  '≅': '≅',
  similar: '~',
  sim: '~',
  '~': '~',
  parallel: '∥',
  par: '∥',
  '∥': '∥',
  perpendicular: '⊥',
  perp: '⊥',
  '⊥': '⊥',
}

function splitRelation(text: string): { left: string; symbol: string; right: string } | null {
  const word = new RegExp(`^(.*?)\\s+(${RELATION_WORDS.join('|')})\\s+(.*)$`).exec(text)
  if (word) return { left: word[1], symbol: RELATION_SYMBOLS[word[2]], right: word[3] }
  const symbol = /^(.*?)\s*([≅~∥⊥])\s*(.*)$/.exec(text)
  if (symbol) return { left: symbol[1], symbol: RELATION_SYMBOLS[symbol[2]], right: symbol[3] }
  return null
}

// "label: <subject> [= <value>]".
function parseMeasureLabel(rest: string): StatementShape {
  const body = rest.trim()
  if (body === '') {
    throw new Error('Expected something to label, e.g. "label: AB", "label: AB = 8" or "label: angle A-B-C"')
  }

  // M5 — an angle or a distance between lines and planes has no one point to
  // hang an inline label on: its place is the givens table, or the author
  // draws the construction (a foot, a common perpendicular) and labels that.
  const space = parseSpaceMeasure(body)
  if (space) {
    throw new Error(
      `"label: ${space.text}" has no single point to hang a label on — write "given: ${space.text}" to put it in the givens table, ` +
        'or draw the construction (a foot, or a common perpendicular) and label its segment'
    )
  }

  const equals = body.indexOf('=')
  const content: MeasureContent | null = equals === -1 ? null : parseMeasureContent(body.slice(equals + 1))
  const named = parseLabelSubject(equals === -1 ? body : body.slice(0, equals), 'label')

  if (named.explicit) {
    if (content) {
      throw new Error('A notation label writes a name and takes no "= value" — drop the keyword to measure it instead')
    }
    return { kind: 'measureLabel', subject: named.subject, content: { kind: 'name', mark: named.mark, prefix: named.prefix } }
  }

  return { kind: 'measureLabel', subject: named.subject, content: content ?? { kind: 'computed' } }
}

// "given: <subject> [= <value>]" or "given: <subject> <relation> <subject>",
// and "find: <subject>", which is the same row in the table's other section.
function parseGiven(rest: string, section: GivensSection): StatementShape {
  const body = rest.trim()
  if (body === '') {
    throw new Error(
      `Expected something to state, e.g. "${section}: AB = 8", "${section}: angle A-B-C = 30" or "${section}: AB parallel CD"`
    )
  }

  // M5 first: a plane written "through P perpendicular to A-B" holds a
  // relation word, and an equation holds an "=" of its own.
  const space = parseSpaceMeasure(body)
  if (space) {
    const content = space.value === null ? { kind: 'computed' as const } : parseMeasureContent(space.value)
    return { kind: 'given', section, entry: { kind: 'measure', subject: space.subject, content } }
  }

  // An area's region is a boolean of shapes, never a relation (phase 12).
  const relation = /^area\s/.test(body) ? null : splitRelation(body)
  if (relation) {
    return {
      kind: 'given',
      section,
      entry: {
        kind: 'relation',
        left: parseLabelSubject(relation.left, 'given').subject,
        symbol: relation.symbol,
        right: parseLabelSubject(relation.right, 'given').subject,
      },
    }
  }

  const equals = body.indexOf('=')
  const content: MeasureContent | null = equals === -1 ? null : parseMeasureContent(body.slice(equals + 1))
  const named = parseLabelSubject(equals === -1 ? body : body.slice(0, equals), 'given')
  return { kind: 'given', section, entry: { kind: 'measure', subject: named.subject, content: content ?? { kind: 'computed' } } }
}

// Parses one non-empty, comment-stripped line into a Statement. Splices off
// trailing "color: <value>" and/or "name: <id>" clauses (see
// parser/types.ts's grammar comment) — in either order — before handing the
// rest to the kind-specific grammar, so every statement kind gets both for
// free rather than each one parsing them individually. Only one of each can
// ever be positioned at the true trailing end at a time, so a plain "strip
// whichever end-anchored clause matches, repeat" loop handles either
// ordering without needing to compare positions. Throws with a
// human-readable message on anything unrecognized.
export function parseStatement(rawLine: string): Statement {
  let line = stripComment(rawLine)
  let color: string | null = null
  let statementName: string | null = null

  for (;;) {
    if (color === null) {
      const stripped = stripTrailingClause(line, COLOR_CLAUSE)
      if (stripped) {
        if (!isValidColor(stripped.value)) {
          throw new Error(`Unknown color "${stripped.value}" — use a name (red, orange, yellow, green, teal, blue, purple, pink, brown, black, gray, cyan) or "#rrggbb"`)
        }
        color = stripped.value
        line = stripped.line
        continue
      }
    }
    if (statementName === null) {
      const stripped = stripTrailingClause(line, NAME_CLAUSE)
      if (stripped) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(stripped.value)) {
          throw new Error(`Invalid name "${stripped.value}" — use a plain identifier (letters, digits, underscore, not starting with a digit)`)
        }
        statementName = stripped.value
        line = stripped.line
        continue
      }
    }
    break
  }

  return { ...parseStatementCore(line), color, statementName }
}
