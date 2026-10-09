// The engine's public boundary speaks CODEPOINT indices; the DOM-facing
// internals (data-start, Range offsets, markdown block ranges) speak UTF-16.
// All conversion between the two lives here.
import { cpLength, cpToUtf16, utf16ToCp } from './core/offsets'
import { findTokenSpan } from './core/findTokenSpan'
import { makeAnchor, resolveAnchor } from './core/anchors'

interface Ranged {
  start: number
  end: number
}

// Public (codepoint) -> internal (UTF-16). Extra fields are preserved.
export function toInternalRange<T extends Ranged>(text: string, r: T): T {
  return { ...r, start: cpToUtf16(text, r.start), end: cpToUtf16(text, r.end) }
}

// Internal (UTF-16) -> public (codepoint). Extra fields are preserved.
export function fromInternalRange<T extends Ranged>(text: string, r: T): T {
  return { ...r, start: utf16ToCp(text, r.start), end: utf16ToCp(text, r.end) }
}

// Token span around a marker's codepoint offset, expressed in UTF-16 for leaf
// splitting / data-start comparison.
export function markerSpanInternal(text: string, offsetCp: number): { start: number; end: number } | null {
  const span = findTokenSpan(text, offsetCp)
  return span ? toInternalRange(text, span) : null
}

interface Quoted extends Ranged {
  quote?: string
  prefix?: string
  suffix?: string
}

// Re-finds each quoted item against the current text. Items that resolve are
// returned at their RESOLVED offsets (codepoints); items whose quote can no
// longer be found go to `failed` and must not be painted. Items with no quote
// (legacy) pass through unchanged at their stored offsets.
export function resolveForPaint<T extends Quoted>(text: string, items: T[]): { resolved: T[]; failed: T[] } {
  const resolved: T[] = []
  const failed: T[] = []
  for (const item of items) {
    if (!item.quote) {
      resolved.push(item)
      continue
    }
    const hit = resolveAnchor(text, {
      start: item.start,
      end: item.end,
      quote: item.quote,
      prefix: item.prefix,
      suffix: item.suffix,
    })
    if (hit) resolved.push({ ...item, start: hit.start, end: hit.end })
    else failed.push(item)
  }
  return { resolved, failed }
}

// Fills quote/prefix/suffix (via makeAnchor) on items whose id is NOT in
// `knownIds` — i.e. highlights newly created or split by an edit. Known
// items are returned as-is.
export function attachQuotes<T extends Quoted & { id: string }>(text: string, items: T[], knownIds: Set<string>): T[] {
  return items.map((item) => {
    if (knownIds.has(item.id)) return item
    const a = makeAnchor(text, item.start, item.end)
    return { ...item, quote: a.quote, prefix: a.prefix, suffix: a.suffix }
  })
}

// Marker flavour of resolveForPaint: a marker is a point (`offset`), its quote
// is the text starting there.
export function resolveMarkersForPaint<T extends { offset: number; quote?: string; prefix?: string; suffix?: string }>(
  text: string,
  markers: T[]
): { resolved: T[]; failed: T[] } {
  const r = resolveForPaint(
    text,
    markers.map((m) => ({ m, start: m.offset, end: m.offset + cpLength(m.quote ?? ''), quote: m.quote, prefix: m.prefix, suffix: m.suffix }))
  )
  return {
    resolved: r.resolved.map((x) => (x.m.quote ? { ...x.m, offset: x.start } : x.m)),
    failed: r.failed.map((x) => x.m),
  }
}
