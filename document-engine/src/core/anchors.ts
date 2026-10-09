// Text anchors: a quote plus surrounding context, so a selection can be
// re-found after the text around it changes. All offsets are codepoints.
import { cpLength, sliceCp, cpToUtf16 } from './offsets'

export interface TextAnchor {
  start: number // codepoint offset, inclusive
  end: number // codepoint offset, exclusive
  quote: string
  prefix?: string
  suffix?: string
}

export function makeAnchor(text: string, start: number, end: number, contextLen = 40): TextAnchor {
  return {
    start,
    end,
    quote: sliceCp(text, start, end),
    prefix: sliceCp(text, Math.max(0, start - contextLen), start),
    suffix: sliceCp(text, end, end + contextLen),
  }
}

const MAX_CANDIDATES = 200
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff

// Length of the common tail of two codepoint arrays.
function commonTail(x: string[], y: string[]): number {
  let n = 0
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++
  return n
}

// Length of the common head of two codepoint arrays.
function commonHead(x: string[], y: string[]): number {
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

// True when UTF-16 index i does not split a surrogate pair.
function onBoundary(text: string, i: number): boolean {
  return !(i > 0 && i < text.length && isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1)))
}

export function resolveAnchor(text: string, anchor: TextAnchor): { start: number; end: number } | null {
  const { quote } = anchor
  if (!quote) return null
  if (sliceCp(text, anchor.start, anchor.end) === quote) return { start: anchor.start, end: anchor.end }

  const qLen = cpLength(quote)
  const prefix = Array.from(anchor.prefix ?? '')
  const suffix = Array.from(anchor.suffix ?? '')
  const ctx = Math.max(prefix.length, suffix.length)

  // Matches that start and end on codepoint boundaries.
  let cands: number[] = []
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    if (onBoundary(text, i) && onBoundary(text, i + quote.length)) cands.push(i)
  }
  if (cands.length === 0) return null
  if (cands.length > MAX_CANDIDATES) {
    const a16 = cpToUtf16(text, anchor.start)
    cands = cands
      .sort((p, q) => Math.abs(p - a16) - Math.abs(q - a16))
      .slice(0, MAX_CANDIDATES)
      .sort((p, q) => p - q)
  }

  let best: { start: number; end: number } | null = null
  let bestScore = -1
  let bestDist = Infinity
  // Codepoint index of each candidate, found in one left-to-right walk.
  let u = 0
  let cp = 0
  for (const i of cands) {
    while (u < i) {
      u += isHigh(text.charCodeAt(u)) && u + 1 < text.length && isLow(text.charCodeAt(u + 1)) ? 2 : 1
      cp++
    }
    const start = cp
    const end = start + qLen
    const before = Array.from(text.slice(Math.max(0, i - 2 * ctx - 1), i)).slice(-ctx || undefined)
    const after = Array.from(text.slice(i + quote.length, i + quote.length + 2 * ctx + 1)).slice(0, ctx)
    const score = (ctx ? commonTail(before, prefix) : 0) + commonHead(after, suffix)
    const dist = Math.abs(start - anchor.start)
    if (score > bestScore || (score === bestScore && dist < bestDist)) {
      best = { start, end }
      bestScore = score
      bestDist = dist
    }
  }
  return best
}
