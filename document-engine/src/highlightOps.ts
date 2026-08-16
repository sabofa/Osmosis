import type { DocumentHighlight } from './types'

// Selecting a range that overlaps existing highlight(s) toggles: whatever
// portion is already highlighted gets removed (split the existing
// highlight around the overlap), whatever portion isn't yet highlighted
// gets added in the chosen color. Selecting a range with no existing
// overlap just adds it. Selecting exactly an existing highlight (or a range
// fully inside one) removes it — that's the "highlighting inside a
// highlight unhighlights it" behavior.
export function toggleHighlightRange(
  highlights: DocumentHighlight[],
  start: number,
  end: number,
  color: string,
  makeId: () => string
): DocumentHighlight[] {
  const untouched: DocumentHighlight[] = []
  const remainders: DocumentHighlight[] = []
  const covered: { start: number; end: number }[] = []

  for (const h of highlights) {
    const overlapStart = Math.max(h.start, start)
    const overlapEnd = Math.min(h.end, end)
    if (overlapStart >= overlapEnd) {
      untouched.push(h)
      continue
    }
    covered.push({ start: overlapStart, end: overlapEnd })
    if (h.start < overlapStart) remainders.push({ id: makeId(), start: h.start, end: overlapStart, color: h.color })
    if (overlapEnd < h.end) remainders.push({ id: makeId(), start: overlapEnd, end: h.end, color: h.color })
  }

  covered.sort((a, b) => a.start - b.start)
  const additions: DocumentHighlight[] = []
  let cursor = start
  for (const c of covered) {
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
