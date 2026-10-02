// Vector literals: "<a, b, c>", "⟨a, b, c⟩", and, where a definition allows
// it, the tuple "(a, b, c)". They are recognised only where a vector is
// expected (a definition's right-hand side) and never reach the shared
// expression parser, so the inequality grammar is untouched (SP2).

import { splitTopLevelComma } from '../../parser/grammarUtil'
import { parseExprString } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'

// The index of the bracket that closes the one at `open`, or -1.
function closingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') depth++
    else if (text[i] === ')' || text[i] === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// The text inside the brackets when `text` is one bracketed literal, or null.
function literalBody(text: string, allowTuple: boolean): string | null {
  const t = text.trim()
  if ((t.startsWith('<') && t.endsWith('>')) || (t.startsWith('⟨') && t.endsWith('⟩'))) return t.slice(1, -1)
  if (allowTuple && t.startsWith('(') && closingParen(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1)
    // "(x + 1)" is a parenthesised number, not a tuple.
    return splitTopLevelComma(inner).length > 1 ? inner : null
  }
  return null
}

// The three components when `text` is a vector literal, null when it is not
// one. A literal with other than three components is refused.
export function parseVectorLiteral(text: string, allowTuple: boolean): [Expr, Expr, Expr] | null {
  const body = literalBody(text, allowTuple)
  if (body === null) return null
  const parts = splitTopLevelComma(body)
  if (parts.length !== 3) {
    throw new Error(`A vector has three components, got ${parts.length} in "${text.trim()}"`)
  }
  return [parseExprString(parts[0]), parseExprString(parts[1]), parseExprString(parts[2])]
}
