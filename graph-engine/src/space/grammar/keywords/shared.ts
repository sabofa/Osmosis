// What phase S4a's keyword rows share: the style a keyword statement takes.
//
// A keyword statement may take clauses from both of SP8's families — a plane
// is a mesh (opacity:) with an outline, a contour draws surfaces or curves —
// so the allowed set is named per keyword, and a clause outside it is
// refused in the statement's own words. The values are validated by
// style.ts's buildStyle, the surface clauses as an implicit surface's and the
// line clauses as a curve's.

import { buildStyle, type RawClause, type StyleKey } from '../style'
import type { SpaceStyle } from '../types'

function label(key: StyleKey): string {
  return key === 'dashed' ? 'dashed' : `${key}:`
}

function list(keys: readonly StyleKey[]): string {
  const names = [...keys.map(label), 'color:']
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function keywordStyle(clauses: readonly RawClause[], allowed: readonly StyleKey[], keyword: string): SpaceStyle {
  for (const clause of clauses) {
    // A color: or name: written before a style clause: buildStyle refuses
    // where it is written.
    if (clause.key === 'color' || clause.key === 'name') continue
    if (!allowed.includes(clause.key)) {
      throw new Error(`${label(clause.key)} does not apply to ${keyword}: — it takes ${list(allowed)}`)
    }
  }
  const isLine = (c: RawClause) => c.key === 'width' || c.key === 'dashed'
  const surface = buildStyle(
    clauses.filter((c) => !isLine(c)),
    'implicit surface'
  )
  const line = buildStyle(clauses.filter(isLine), 'curve')
  return { ...surface, width: line.width, dashed: line.dashed }
}

// The bracket depth before each character, counting (), [], <> and ⟨⟩: in
// an operand, < and > are only ever a vector's brackets.
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

// The matches of `separator` that lie outside every bracket, in order.
export function topLevel(text: string, separator: RegExp): RegExpExecArray[] {
  const depth = depths(text)
  const global = new RegExp(separator.source, 'g')
  return [...text.matchAll(global)].filter((m) => depth[m.index] === 0 && depth[m.index + m[0].length - 1] === 0) as RegExpExecArray[]
}
