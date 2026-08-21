import { isValidColor } from './colors'
import { parseExprString } from './parseExpr'
import type { Condition, Expr, Statement, StatementShape } from './types'

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
    const parts = spec.split('-').map((p) => p.trim())
    const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    if (parts.length !== 3 || parts.some((p) => !namePattern.test(p))) {
      throw new Error('Expected "angle: A-B-C" (three point names, vertex in the middle)')
    }
    return { kind: 'angle', from: parts[0], vertex: parts[1], to: parts[2], label }
  }

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
