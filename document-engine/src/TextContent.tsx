import { useRef, type ElementType, type ReactNode } from 'react'
import type { ResolvedMarker } from './viewerModel'
import { findTokenSpan } from './core/findTokenSpan'
import { usePaintHighlights } from './highlightPainter'
import { parseBlocks, parseInline, BLOCK_TAG, BLOCK_CLASS, type InlineRun } from './markdown'
import type { DocumentAnchor, DocumentHighlight } from './types'

interface Leaf extends InlineRun {
  marker?: ResolvedMarker
}

export default function TextContent({
  text,
  anchors,
  markers,
  highlights = [],
  showOverlays = true,
  groupPrefix,
}: {
  text: string
  anchors: DocumentAnchor[]
  markers: ResolvedMarker[]
  highlights?: DocumentHighlight[]
  showOverlays?: boolean
  groupPrefix: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  usePaintHighlights(rootRef, groupPrefix, anchors, highlights, showOverlays, text)

  // Anchor and highlight ranges are painted via the CSS Custom Highlight API
  // (see highlightPainter.ts) rather than wrapped in their own elements, so
  // they can never fragment a word into multiple padded/rounded pieces with
  // visible gaps between them — only markdown formatting and marker
  // boundaries split the DOM into separate elements here.
  const markerSpans = markers
    .map((marker) => ({ marker, span: findTokenSpan(text, marker.offset) }))
    .filter((m): m is { marker: ResolvedMarker; span: { start: number; end: number } } => m.span !== null)
    .sort((a, b) => a.span.start - b.span.start)

  function leavesFor(runs: InlineRun[]): Leaf[] {
    const leaves: Leaf[] = []
    for (const run of runs) {
      const overlapping = markerSpans.filter((m) => m.span.end > run.start && m.span.start < run.end)
      let cursor = run.start
      for (const { marker, span } of overlapping) {
        const s = Math.max(span.start, run.start)
        const e = Math.min(span.end, run.end)
        if (s < cursor) continue // overlapping marker tokens — keep the first
        if (s > cursor) leaves.push({ start: cursor, end: s, bold: run.bold, italic: run.italic, code: run.code })
        leaves.push({ start: s, end: e, bold: run.bold, italic: run.italic, code: run.code, marker })
        cursor = e
      }
      if (cursor < run.end) leaves.push({ start: cursor, end: run.end, bold: run.bold, italic: run.italic, code: run.code })
    }
    return leaves
  }

  function renderLeaf(leaf: Leaf): ReactNode {
    const content = text.slice(leaf.start, leaf.end)
    const marker = leaf.marker
    const shared = marker
      ? {
          'data-start': leaf.start,
          className: 'document-viewer-marker',
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => marker.activate(),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') marker.activate()
          },
        }
      : { 'data-start': leaf.start }
    if (leaf.code) return <code key={leaf.start} {...shared}>{content}</code>
    if (leaf.bold) return <strong key={leaf.start} {...shared}>{content}</strong>
    if (leaf.italic) return <em key={leaf.start} {...shared}>{content}</em>
    return <span key={leaf.start} {...shared}>{content}</span>
  }

  const blocks = parseBlocks(text)

  return (
    <div className="document-viewer-text document-viewer-markdown" ref={rootRef}>
      {blocks.map((block) => {
        const Tag = BLOCK_TAG[block.type] as ElementType
        const runs = parseInline(text.slice(block.start, block.end), block.start)
        return (
          <Tag key={block.start} className={BLOCK_CLASS[block.type] || undefined}>
            {leavesFor(runs).map(renderLeaf)}
          </Tag>
        )
      })}
    </div>
  )
}
