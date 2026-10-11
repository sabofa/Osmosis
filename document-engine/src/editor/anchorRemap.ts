// Pure offset remapping through a set of document changes, so highlights and
// anchors can follow edits. Offsets live in ONE index space chosen by the
// caller (the editor passes UTF-16 and converts at its edge).
//
// `changes` are expressed in ORIGINAL document coordinates, ordered by `from`,
// non-overlapping, and applied simultaneously (like CodeMirror's ChangeSet).

export interface TextChange {
  from: number
  to: number
  insertLen: number
}

export interface OffsetRange {
  start: number
  end: number
}

/**
 * Map a position through the changes. `assoc` decides which side of an
 * insertion at exactly `pos` the position sticks to: -1 stays before the
 * inserted text, 1 moves after it. A position inside or on the edge of a
 * replaced span goes to the near edge of the replacement (start side for a
 * position at/inside the front, end side for the back edge), as CodeMirror does.
 */
export function mapOffset(pos: number, changes: readonly TextChange[], assoc: -1 | 1): number {
  let delta = 0
  for (const c of changes) {
    if (pos < c.from) break
    const removed = c.to - c.from
    if (pos > c.to) {
      delta += c.insertLen - removed
      continue
    }
    // pos within [from, to]
    const side = removed === 0 ? assoc : pos === c.from ? -1 : pos === c.to ? 1 : assoc
    return c.from + delta + (side < 0 ? 0 : c.insertLen)
  }
  return pos + delta
}

/**
 * Map a range: start sticks right of an insertion at it (assoc 1), end sticks
 * left (assoc -1), so an insertion at either edge never grows the range.
 * Returns null when the range collapses (fully deleted, or empty to begin with).
 */
export function mapRange(range: OffsetRange, changes: readonly TextChange[]): OffsetRange | null {
  const start = mapOffset(range.start, changes, 1)
  const end = mapOffset(range.end, changes, -1)
  return end > start ? { start, end } : null
}

/** Remap many highlights; the dropped ones collapsed to nothing. */
export function remapHighlights<T extends OffsetRange>(
  items: readonly T[],
  changes: readonly TextChange[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = []
  const dropped: T[] = []
  for (const it of items) {
    const r = mapRange(it, changes)
    if (r) kept.push({ ...it, start: r.start, end: r.end })
    else dropped.push(it)
  }
  return { kept, dropped }
}
