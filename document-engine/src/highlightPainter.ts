// Paints highlight/anchor ranges via the browser's own CSS Custom Highlight
// API (window.Highlight + CSS.highlights) instead of wrapping matching text
// in <mark>/<span> DOM elements. The old DOM-splitting approach fragmented
// text at every highlight/anchor boundary, and each fragment's own
// padding/border-radius rendered as a visible gap mid-word (e.g. "inspector"
// splitting into "in" "spe" "ctor" with air between them) whenever a
// boundary landed off a word edge — the Custom Highlight API paints ranges
// as pure overlay, with zero DOM mutation and zero layout impact, so there's
// nothing to fragment.
//
// Ranges are found by walking every "leaf" element tagged data-start="N" —
// each leaf's rendered textContent must be exactly the source text's
// slice(N, N + textContent.length) for this to resolve correctly (both
// TextContent's spans and PdfLayer's pdfjs-backed text divs satisfy this).

export interface RangeSpec {
  start: number
  end: number
}

interface Leaf {
  start: number
  end: number
  textNode: Text
}

function collectLeaves(root: HTMLElement): Leaf[] {
  const leaves: Leaf[] = []
  const els = root.querySelectorAll<HTMLElement>('[data-start]')
  els.forEach((el) => {
    const textNode = el.firstChild
    if (!(textNode instanceof Text)) return
    const start = Number(el.dataset.start)
    if (Number.isNaN(start)) return
    leaves.push({ start, end: start + textNode.length, textNode })
  })
  leaves.sort((a, b) => a.start - b.start)
  return leaves
}

function locate(leaves: Leaf[], offset: number, preferLeafEnd: boolean): { node: Text; offset: number } | null {
  for (const leaf of leaves) {
    if (offset > leaf.end || (offset === leaf.end && !preferLeafEnd)) continue
    if (offset < leaf.start) return null
    return { node: leaf.textNode, offset: Math.min(Math.max(offset - leaf.start, 0), leaf.textNode.length) }
  }
  return null
}

export function createRangeForOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null
  const leaves = collectLeaves(root)
  if (leaves.length === 0) return null
  const startLoc = locate(leaves, start, false)
  const endLoc = locate(leaves, end, true)
  if (!startLoc || !endLoc) return null
  const range = document.createRange()
  try {
    range.setStart(startLoc.node, startLoc.offset)
    range.setEnd(endLoc.node, endLoc.offset)
  } catch {
    return null
  }
  return range.collapsed ? null : range
}

// Registers (or clears) one named highlight group. Call once per distinct
// visual group (the anchor, and one per highlight color in use) — grouping
// by color rather than by individual highlight id keeps the number of
// `::highlight()` CSS rules fixed regardless of how many highlights exist.
export function paintHighlightGroup(root: HTMLElement, name: string, ranges: RangeSpec[]): void {
  const built = ranges
    .map((r) => createRangeForOffsets(root, r.start, r.end))
    .filter((r): r is Range => r !== null)
  if (built.length === 0) {
    CSS.highlights.delete(name)
    return
  }
  CSS.highlights.set(name, new Highlight(...built))
}

export function clearHighlightGroup(name: string): void {
  CSS.highlights.delete(name)
}

import { useEffect, type RefObject } from 'react'
import { HIGHLIGHT_PALETTE, DEFAULT_HIGHLIGHT_COLOR } from './highlightPalette'
import type { DocumentHighlight } from './types'

// Shared by TextContent and PdfLayer — repaints the anchor group plus one
// group per palette color actually in use, keyed under `groupPrefix`
// (unique per DocumentViewer instance, since CSS.highlights is a single
// document-wide registry two mounted viewers would otherwise collide in).
// `readySignal` lets a caller force a repaint once its DOM is actually
// available (e.g. PdfLayer's text divs, built asynchronously after the PDF
// loads) — the effect can't know that on its own.
export function usePaintHighlights(
  rootRef: RefObject<HTMLElement | null>,
  groupPrefix: string,
  anchor: RangeSpec | null,
  highlights: DocumentHighlight[],
  showOverlays: boolean,
  readySignal: unknown
): void {
  useEffect(() => {
    const root = rootRef.current
    const anchorName = `${groupPrefix}-anchor`
    const colorNames = HIGHLIGHT_PALETTE.map((c) => `${groupPrefix}-${c.id}`)

    if (root && showOverlays && anchor) paintHighlightGroup(root, anchorName, [anchor])
    else clearHighlightGroup(anchorName)

    for (const color of HIGHLIGHT_PALETTE) {
      const name = `${groupPrefix}-${color.id}`
      if (!root || !showOverlays) {
        clearHighlightGroup(name)
        continue
      }
      const ranges = highlights.filter((h) => (h.color ?? DEFAULT_HIGHLIGHT_COLOR) === color.id)
      paintHighlightGroup(root, name, ranges)
    }

    return () => {
      clearHighlightGroup(anchorName)
      for (const name of colorNames) clearHighlightGroup(name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, groupPrefix, anchor?.start, anchor?.end, highlights, showOverlays, readySignal])
}
