// Maps the browser's native window.getSelection() back to absolute char
// offsets in the underlying document text. Works uniformly for TextContent's
// plain-text spans and PdfLayer's selectable text-layer spans because both
// tag every leaf text-bearing element with data-start = that element's own
// absolute start offset, and its textContent is always exactly
// text.slice(start, end) — no extra whitespace or reflow in between, so a
// DOM Selection's per-node offset can be added directly onto data-start.
import { snapRangeToMath } from './mathSelection'

export function getSelectionOffsetRange(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  function resolve(node: Node, offset: number, side: 'start' | 'end'): number | null {
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)) as HTMLElement | null
    // Inside rendered math there is no glyph-to-source mapping: snap to the
    // node's whole TeX source (start side -> its start, end side -> its end).
    const mathEl = el?.closest<HTMLElement>('[data-math]')
    if (mathEl && root.contains(mathEl)) {
      return side === 'start' ? Number(mathEl.dataset.start) : Number(mathEl.dataset.mathEnd)
    }
    const span = el?.closest<HTMLElement>('[data-start]')
    if (!span || span.dataset.start === undefined) return null
    return Number(span.dataset.start) + offset
  }

  const startAbs = resolve(range.startContainer, range.startOffset, 'start')
  const endAbs = resolve(range.endContainer, range.endOffset, 'end')
  if (startAbs === null || endAbs === null || startAbs === endAbs) return null

  const math = Array.from(root.querySelectorAll<HTMLElement>('[data-math]')).map((m) => ({
    start: Number(m.dataset.start),
    end: Number(m.dataset.mathEnd),
  }))
  const ordered = startAbs < endAbs ? { start: startAbs, end: endAbs } : { start: endAbs, end: startAbs }
  return snapRangeToMath(ordered, math)
}

// Bounding rect of the current selection, in viewport coordinates — used to
// position the floating "Highlight" action button next to it.
export function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  return rect.width === 0 && rect.height === 0 ? null : rect
}
