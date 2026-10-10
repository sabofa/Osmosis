// Clean highlight and selection bars for PDF pages. pdfjs text-layer spans are
// uneven, overlapping, scaled boxes, so painting highlights or the native
// selection straight onto them looks ragged. Instead the spans' text rects
// are merged into one bar per line (lineRects) and drawn as overlay divs that
// live inside each page's transformed "inner" wrapper, between the canvas and
// the text layer (so they scale with the instant CSS rescale and never
// intercept pointer events).

import { createRangeForOffsets, type RangeSpec } from './highlightPainter'
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_PALETTE } from './highlightPalette'
import { mergeRects, type Box } from './lineRects'
import { HIGHLIGHT_ALPHA } from './tokenVars'
import type { DocumentHighlight } from './types'

export const HIGHLIGHT_LAYER_CLASS = 'document-viewer-pdf-highlights'
export const SELECTION_LAYER_CLASS = 'document-viewer-pdf-selection'

const alphaPct = Math.round(HIGHLIGHT_ALPHA * 100)

function tint(varName: string): string {
  return `color-mix(in srgb, var(${varName}) ${alphaPct}%, transparent)`
}

function highlightVar(colorId: string | undefined): string {
  const i = HIGHLIGHT_PALETTE.findIndex((c) => c.id === (colorId ?? DEFAULT_HIGHLIGHT_COLOR))
  return `--de-highlight-${(i < 0 ? 0 : i % 4) + 1}`
}

function textSpans(textDiv: HTMLElement): HTMLElement[] {
  return Array.from(textDiv.querySelectorAll<HTMLElement>('[data-start]')).filter((el) => el.firstChild instanceof Text)
}

// Client rects of only the text inside `range`, one sub-range per text-layer
// span (a plain range.getClientRects() would also return whole span boxes).
function textRects(textDiv: HTMLElement, range: Range): DOMRect[] {
  const out: DOMRect[] = []
  for (const span of textSpans(textDiv)) {
    if (!range.intersectsNode(span)) continue
    const node = span.firstChild as Text
    const sub = document.createRange()
    try {
      sub.setStart(node, range.startContainer === node ? range.startOffset : 0)
      sub.setEnd(node, range.endContainer === node ? range.endOffset : node.length)
    } catch {
      continue
    }
    if (sub.collapsed) continue
    out.push(...Array.from(sub.getClientRects()))
  }
  return out
}

function ensureLayer(inner: HTMLElement, textDiv: HTMLElement, cls: string): HTMLElement {
  let layer = inner.querySelector<HTMLElement>(`:scope > .${cls}`)
  if (!layer) {
    layer = document.createElement('div')
    layer.className = cls
    inner.insertBefore(layer, textDiv)
  }
  return layer
}

function drawBars(layer: HTMLElement, inner: HTMLElement, groups: { rects: Box[]; color: string }[]): void {
  const origin = inner.getBoundingClientRect()
  // Undo any instant-rescale transform so bars are in the inner's own space
  // (the layer is inside it and gets scaled together with the page).
  const f = inner.offsetWidth > 0 && origin.width > 0 ? origin.width / inner.offsetWidth : 1
  const frag = document.createDocumentFragment()
  for (const g of groups) {
    const local = g.rects.map((r) => ({
      left: (r.left - origin.left) / f,
      right: (r.right - origin.left) / f,
      top: (r.top - origin.top) / f,
      bottom: (r.bottom - origin.top) / f,
    }))
    for (const b of mergeRects(local)) {
      const d = document.createElement('div')
      d.style.cssText = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;background:${g.color}`
      frag.appendChild(d)
    }
  }
  layer.replaceChildren(frag)
}

function pages(root: HTMLElement): { inner: HTMLElement; textDiv: HTMLElement }[] {
  const out: { inner: HTMLElement; textDiv: HTMLElement }[] = []
  root.querySelectorAll<HTMLElement>('.document-viewer-pdf-inner').forEach((inner) => {
    const textDiv = inner.querySelector<HTMLElement>(':scope > .document-viewer-pdf-text-layer')
    if (textDiv) out.push({ inner, textDiv })
  })
  return out
}

function spanBounds(textDiv: HTMLElement): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const el of textSpans(textDiv)) {
    const s = Number(el.dataset.start)
    if (Number.isNaN(s)) continue
    min = Math.min(min, s)
    max = Math.max(max, s + (el.firstChild as Text).length)
  }
  return min <= max ? { min, max } : null
}

export function paintPdfHighlights(
  root: HTMLElement,
  anchors: RangeSpec[],
  highlights: DocumentHighlight[],
  showOverlays: boolean
): void {
  for (const { inner, textDiv } of pages(root)) {
    const layer = ensureLayer(inner, textDiv, HIGHLIGHT_LAYER_CLASS)
    const bounds = showOverlays ? spanBounds(textDiv) : null
    if (!bounds) {
      layer.replaceChildren()
      continue
    }
    const groups: { rects: Box[]; color: string }[] = []
    const add = (r: RangeSpec, color: string) => {
      const start = Math.max(r.start, bounds.min)
      const end = Math.min(r.end, bounds.max)
      if (end <= start) return
      const range = createRangeForOffsets(textDiv, start, end)
      if (range) groups.push({ rects: textRects(textDiv, range), color })
    }
    for (const h of highlights) add(h, tint(highlightVar(h.color)))
    for (const a of anchors) add(a, tint('--de-highlight-1'))
    drawBars(layer, inner, groups)
  }
}

export function paintPdfSelection(root: HTMLElement): void {
  const sel = typeof document !== 'undefined' ? document.getSelection() : null
  const ranges: Range[] = []
  if (sel && !sel.isCollapsed) for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i))
  for (const { inner, textDiv } of pages(root)) {
    const layer = ensureLayer(inner, textDiv, SELECTION_LAYER_CLASS)
    const rects = ranges.filter((r) => r.intersectsNode(textDiv)).flatMap((r) => textRects(textDiv, r))
    if (rects.length === 0) layer.replaceChildren()
    else drawBars(layer, inner, [{ rects, color: tint('--de-selection') }])
  }
}
