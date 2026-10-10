import type { DocumentHighlight } from './types'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlightPalette'

const colorOf = (h: DocumentHighlight) => h.color ?? DEFAULT_HIGHLIGHT_COLOR

// Applying a colour to the selection [start, end):
//  1. Nothing covered -> one new highlight for the whole range.
//  2. Mixed (some covered, some not) -> the colour fills ONLY the uncovered
//     gaps; existing highlights are returned untouched (same objects).
//  3. Entirely covered and every touched highlight already has this colour
//     -> remove highlighting from just [start, end) (split around it).
//  4. Entirely covered, not all this colour -> recolour: split around
//     [start, end) and add ONE highlight of this colour for the whole range.
// Coverage is the union of the existing highlights (order/overlap agnostic).
export function toggleHighlightRange(
  highlights: DocumentHighlight[],
  start: number,
  end: number,
  color: string,
  makeId: () => string
): DocumentHighlight[] {
  if (start >= end) return highlights

  const touching = highlights.filter((h) => Math.max(h.start, start) < Math.min(h.end, end))

  // Gaps of [start, end) not covered by any highlight.
  const clipped = touching
    .map((h) => ({ start: Math.max(h.start, start), end: Math.min(h.end, end) }))
    .sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  let cursor = start
  for (const c of clipped) {
    if (cursor < c.start) gaps.push({ start: cursor, end: c.start })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < end) gaps.push({ start: cursor, end })

  if (touching.length === 0 || gaps.length > 0) {
    return [...highlights, ...gaps.map((g) => ({ id: makeId(), start: g.start, end: g.end, color }))]
  }

  const removing = touching.every((h) => colorOf(h) === color)
  const result = removeHighlightRange(highlights, start, end, makeId)
  if (!removing) result.push({ id: makeId(), start, end, color })
  return result
}

// Used by the click-to-edit affordance: which (if any) highlight contains
// this offset, so a click can open a color/remove popover for it.
export function highlightAtOffset(highlights: DocumentHighlight[], offset: number): DocumentHighlight | null {
  return highlights.find((h) => offset >= h.start && offset < h.end) ?? null
}

// Unconditional "dehighlight" — strips whatever highlight coverage exists
// in [start, end) regardless of color (unlike toggleHighlightRange, which
// only removes a same-color match and recolors everything else). Existing
// highlights touched by the range are split around the overlap so their
// untouched portions keep their original color.
export function removeHighlightRange(
  highlights: DocumentHighlight[],
  start: number,
  end: number,
  makeId: () => string
): DocumentHighlight[] {
  const result: DocumentHighlight[] = []
  for (const h of highlights) {
    const overlapStart = Math.max(h.start, start)
    const overlapEnd = Math.min(h.end, end)
    if (overlapStart >= overlapEnd) {
      result.push(h)
      continue
    }
    if (h.start < overlapStart) result.push({ id: makeId(), start: h.start, end: overlapStart, color: h.color })
    if (overlapEnd < h.end) result.push({ id: makeId(), start: overlapEnd, end: h.end, color: h.color })
  }
  return result
}
