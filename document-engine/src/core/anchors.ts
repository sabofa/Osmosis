// Text anchors: a quote plus surrounding context, so a selection can be
// re-found after the text around it changes. All offsets are codepoints.
import { cpLength, sliceCp, utf16ToCp, cpToUtf16 } from './offsets'

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

// Length (in codepoints) of the common tail of a and b.
function commonTail(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let n = 0
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++
  return n
}

// Length (in codepoints) of the common head of a and b.
function commonHead(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

export function resolveAnchor(text: string, anchor: TextAnchor): { start: number; end: number } | null {
  const { quote } = anchor
  if (!quote) return null
  if (sliceCp(text, anchor.start, anchor.end) === quote) return { start: anchor.start, end: anchor.end }

  const qLen = cpLength(quote)
  const ctx = Math.max(cpLength(anchor.prefix ?? ''), cpLength(anchor.suffix ?? ''))
  let best: { start: number; end: number } | null = null
  let bestScore = -1
  let bestDist = Infinity
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const start = utf16ToCp(text, i)
    if (cpToUtf16(text, start) !== i) continue // not on a codepoint boundary
    const end = start + qLen
    const score =
      commonTail(sliceCp(text, Math.max(0, start - ctx), start), anchor.prefix ?? '') +
      commonHead(sliceCp(text, end, end + ctx), anchor.suffix ?? '')
    const dist = Math.abs(start - anchor.start)
    if (score > bestScore || (score === bestScore && dist < bestDist)) {
      best = { start, end }
      bestScore = score
      bestDist = dist
    }
  }
  return best
}
