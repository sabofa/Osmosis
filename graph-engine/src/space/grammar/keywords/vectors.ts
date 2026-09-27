// "cross:" and "project:" (plan A4; SP9 rows 2.2-2.4).
//
//   cross: u x v [at P]          also "u × v"; the parallelogram, u × v, and
//                                right-angle marks; takes opacity: (the
//                                parallelogram's)
//   project: u onto v [at P]     the projection, the perpendicular part, and
//                                the scalar component and angle
//
// Operands are vectors (operands.ts); P is a point, the origin by default.
// The separators are found at the top level only, outside brackets, so an
// operand like F(1, 0, 2) keeps its commas and parentheses.

import { splitStyle } from '../style'
import type { SpaceForm } from '../types'
import { parsePointOperand, parseVectorOperand } from './operands'
import { keywordStyle } from './shared'

// The bracket depth before each character.
function depths(text: string): number[] {
  const out: number[] = []
  let depth = 0
  for (const c of text) {
    out.push(depth)
    if (c === '(' || c === '[' || c === '<' || c === '⟨') depth++
    else if (c === ')' || c === ']' || c === '>' || c === '⟩') depth--
  }
  return out
}

// The matches of `separator` that lie outside every bracket.
function topLevel(text: string, separator: RegExp): RegExpExecArray[] {
  const depth = depths(text)
  const global = new RegExp(separator.source, 'g')
  return [...text.matchAll(global)].filter((m) => depth[m.index] === 0 && depth[m.index + m[0].length - 1] === 0) as RegExpExecArray[]
}

function parseVectorOp(keyword: 'cross' | 'project', text: string): SpaceForm {
  const usage = keyword === 'cross' ? '"cross: u x v" or "cross: u x v at (1, 1, 1)"' : '"project: u onto v" or "project: u onto v at (1, 1, 1)"'
  const { rest, clauses } = splitStyle(text)
  let body = rest.trim()
  let at = null
  const atMatch = topLevel(body, /\s+at\s+/).pop()
  if (atMatch) {
    at = parsePointOperand(body.slice(atMatch.index + atMatch[0].length))
    body = body.slice(0, atMatch.index).trim()
  }
  const separator = topLevel(body, keyword === 'cross' ? /\s+x\s+|\s*×\s*/ : /\s+onto\s+/)[0]
  if (!separator) throw new Error(`Expected ${usage}, got "${keyword}: ${text.trim()}"`)
  const u = body.slice(0, separator.index).trim()
  const v = body.slice(separator.index + separator[0].length).trim()
  if (u === '' || v === '') throw new Error(`Expected ${usage}, got "${keyword}: ${text.trim()}"`)
  return {
    form: keyword,
    u: parseVectorOperand(u),
    v: parseVectorOperand(v),
    at,
    style: keywordStyle(clauses, keyword === 'cross' ? ['opacity'] : [], keyword),
  }
}

export function parseCross(text: string): SpaceForm {
  return parseVectorOp('cross', text)
}

export function parseProject(text: string): SpaceForm {
  return parseVectorOp('project', text)
}
