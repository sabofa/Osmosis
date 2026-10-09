// The engine's public boundary speaks CODEPOINT indices; the DOM-facing
// internals (data-start, Range offsets, markdown block ranges) speak UTF-16.
// All conversion between the two lives here.
import { cpToUtf16, utf16ToCp } from './core/offsets'
import { findTokenSpan } from './core/findTokenSpan'

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
