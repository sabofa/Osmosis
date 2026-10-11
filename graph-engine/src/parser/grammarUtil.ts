// Line-grammar helpers shared by parser/parseStatement.ts and the space
// grammar (space/grammar/), which must not import parseStatement.ts (its
// hooks are called from there). Moved here unchanged from parseStatement.ts.

import { parseExprString } from './parseExpr'
import type { Expr } from './types'

// Splits a comma-separated list at paren/bracket/brace depth 0 (so "cos(t)*3,
// sin(t)*2" splits into two parts, not three, and a piecewise {x < 0: -t, t}
// stays whole).
export function splitTopLevelComma(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

export function stripOuterParens(s: string): string {
  const t = s.trim()
  if (t.startsWith('(') && t.endsWith(')')) return t.slice(1, -1)
  throw new Error(`Expected a parenthesized "(x, y)" or "(x, y, z)" tuple, got "${s.trim()}"`)
}

// A 2-tuple is a 2D coordinate/direction; a 3-tuple is 3D. Anything else is an error.
export function parseTuple(s: string): Expr[] {
  const inner = stripOuterParens(s)
  const parts = splitTopLevelComma(inner).map((p) => parseExprString(p))
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`Expected "(x, y)" or "(x, y, z)", got "${s.trim()}"`)
  }
  return parts
}

export function parseForRange(rangeStr: string): { param: string; from: Expr; to: Expr } {
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
