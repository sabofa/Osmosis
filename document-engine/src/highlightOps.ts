import type { DocumentHighlight } from './types'

// Selecting a range that overlaps existing highlight(s) toggles PER COLOR:
// a portion already highlighted in the SAME color the user just picked gets
// removed (that's "highlighting inside a highlight unhighlights it").
// A portion already highlighted in a DIFFERENT color gets recolored — it's
// unconditionally cut out of the old-color highlight (a character can't be
// two colors at once) and always lands in `additions` below, since only
// same-color overlap is excluded from re-addition. A portion with no
// existing highlight just gets added. Any existing highlight touched by the
// selection is split around the overlap regardless of color, so its
// untouched portions survive with their original color intact.
export function toggleHighlightRange(
  highlights: DocumentHighlight[],
  start: number,
  end: number,
  color: string,
  makeId: () => string
): DocumentHighlight[] {
  const untouched: DocumentHighlight[] = []
  const remainders: DocumentHighlight[] = []
  const sameColorCovered: { start: number; end: number }[] = []

  for (const h of highlights) {
    const overlapStart = Math.max(h.start, start)
    const overlapEnd = Math.min(h.end, end)
    if (overlapStart >= overlapEnd) {
      untouched.push(h)
      continue
    }
    if (h.start < overlapStart) remainders.push({ id: makeId(), start: h.start, end: overlapStart, color: h.color })
    if (overlapEnd < h.end) remainders.push({ id: makeId(), start: overlapEnd, end: h.end, color: h.color })
    if (h.color === color) sameColorCovered.push({ start: overlapStart, end: overlapEnd })
    // else: h's color differs from the target — its overlapped portion is
    // dropped here (already excluded from remainders above) and falls
    // through to `additions` below, i.e. it gets recolored.
  }

  sameColorCovered.sort((a, b) => a.start - b.start)
  const additions: DocumentHighlight[] = []
  let cursor = start
  for (const c of sameColorCovered) {
    if (cursor < c.start) additions.push({ id: makeId(), start: cursor, end: c.start, color })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < end) additions.push({ id: makeId(), start: cursor, end, color })

  return [...untouched, ...remainders, ...additions]
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
