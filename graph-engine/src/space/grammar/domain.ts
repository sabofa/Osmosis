// Surface domains (SP2, K6): what follows "for" or "over" on a z = f line.
//
//   for x in [a, b], y in [c, d]      a rectangle; its bounds may not read x or y
//   over x in [0, 1], y in [x^2, x]   iterated, type I or II
//   over r in [0, 2], theta in [0, pi]  iterated, polar
//   over x^2 + y^2 <= 4 [and ...]      an inequality (a conjunction)
//   over R                             a named region, resolved in S5
//
// An iterated domain's outer variable is the one whose bounds are constant
// (they do not read the other variable); when both are, the one written
// first. When each reads the other, the domain is refused.

import { parseForRange, splitTopLevelComma } from '../../parser/grammarUtil'
import { parseExprString } from '../../parser/parseExpr'
import { varNames } from '../../math/expr'
import type { Domain, ParamRange, RegionCondition } from './types'

type Op = '<' | '<=' | '>' | '>='

function reads(range: ParamRange, name: string): boolean {
  return varNames(range.from).has(name) || varNames(range.to).has(name)
}

function parseRanges(text: string): ParamRange[] {
  return splitTopLevelComma(text).map((part) => parseForRange(part.trim()))
}

function pairOf(ranges: ParamRange[], keyword: 'for' | 'over'): [ParamRange, ParamRange] {
  if (ranges.length !== 2) {
    throw new Error(`A surface's domain needs ranges for x and y (or r and theta), got ${ranges.length}: "z = ... ${keyword} x in [a, b], y in [c, d]"`)
  }
  return [ranges[0], ranges[1]]
}

// "for x in [a, b], y in [c, d]", either order.
export function parseForDomain(text: string): Domain {
  const [a, b] = pairOf(parseRanges(text), 'for')
  const names = [a.param, b.param].sort().join(',')
  if (names !== 'x,y') {
    throw new Error(`"for" takes x and y (a rectangle), got "${a.param}" and "${b.param}" — write a polar domain with "over r in [..], theta in [..]"`)
  }
  if (reads(a, b.param) || reads(b, a.param)) {
    throw new Error('Bounds that depend on the other variable need "over", not "for": "z = ... over x in [0, 1], y in [x^2, x]"')
  }
  return a.param === 'x' ? { kind: 'rect', x: a, y: b } : { kind: 'rect', x: b, y: a }
}

// The first top-level comparator at or after `from`, preferring "<=" to "<".
function findComparator(text: string, from = 0): { op: Op; idx: number } | null {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '<' || c === '>') {
      const two = text[i + 1] === '='
      return { op: (two ? c + '=' : c) as Op, idx: i }
    }
  }
  return null
}

// One condition: "left op right", or a chain "low op mid op high" whose two
// operators point the same way, normalised to "<" / "<=".
function parseCondition(text: string): RegionCondition {
  const first = findComparator(text)
  if (!first) throw new Error(`Expected a condition like "x^2 + y^2 <= 4", got "${text.trim()}"`)
  const left = text.slice(0, first.idx)
  const afterFirst = first.idx + first.op.length
  const second = findComparator(text, afterFirst)
  if (!second) return { kind: 'region', left: parseExprString(left), op: first.op, right: parseExprString(text.slice(afterFirst)) }

  if (findComparator(text, second.idx + second.op.length)) {
    throw new Error(`A chained condition has two comparisons, found a third in "${text.trim()}"`)
  }
  const firstLess = first.op === '<' || first.op === '<='
  const secondLess = second.op === '<' || second.op === '<='
  if (firstLess !== secondLess) {
    throw new Error(`A chained condition's comparisons must point the same direction, got "${first.op}" and "${second.op}" in "${text.trim()}"`)
  }
  const flip = (op: Op): '<' | '<=' => (op === '>' ? '<' : op === '>=' ? '<=' : op)
  const mid = text.slice(afterFirst, second.idx)
  const right = text.slice(second.idx + second.op.length)
  return {
    kind: 'regionChain',
    low: parseExprString(firstLess ? left : right),
    lowOp: firstLess ? (first.op as '<' | '<=') : flip(second.op),
    mid: parseExprString(mid),
    highOp: firstLess ? (second.op as '<' | '<=') : flip(first.op),
    high: parseExprString(firstLess ? right : left),
  }
}

// What follows "over".
export function parseOverDomain(text: string): Domain {
  const body = text.trim()
  if (/\sin\s*\[/.test(` ${body}`)) {
    const [a, b] = pairOf(parseRanges(body), 'over')
    const names = [a.param, b.param].sort().join(',')
    const coords = names === 'x,y' ? 'cartesian' : names === 'r,theta' ? 'polar' : null
    if (!coords) {
      throw new Error(`An iterated domain is over x and y, or r and theta (polar), got "${a.param}" and "${b.param}"`)
    }
    const aReadsB = reads(a, b.param)
    const bReadsA = reads(b, a.param)
    if (aReadsB && bReadsA) {
      throw new Error(`The bounds of ${a.param} and ${b.param} depend on each other — the outer variable's bounds must be constant`)
    }
    const [outer, inner] = aReadsB ? [b, a] : [a, b]
    return { kind: 'iterated', coords, outer, inner }
  }
  if (findComparator(body)) {
    const parts = splitTopLevelComma(body).flatMap((part) => part.split(/\s+and\s+/))
    return { kind: 'inequality', conditions: parts.map(parseCondition) }
  }
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(body)) return { kind: 'named', name: body }
  throw new Error(`Expected a domain after "over" — ranges, an inequality or a region's name — got "${body}"`)
}
