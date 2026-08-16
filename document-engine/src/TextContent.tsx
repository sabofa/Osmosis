import { useRef } from 'react'
import { findTokenSpan } from './core/findTokenSpan'
import { usePaintHighlights } from './highlightPainter'
import type { DocumentAnchor, DocumentHighlight, DocumentMarker } from './types'

interface Segment {
  start: number
  end: number
  marker?: DocumentMarker
}

export default function TextContent({
  text,
  anchor,
  markers,
  highlights = [],
  showOverlays = true,
  groupPrefix,
  onJumpToQuestion,
}: {
  text: string
  anchor: DocumentAnchor | null
  markers: DocumentMarker[]
  highlights?: DocumentHighlight[]
  showOverlays?: boolean
  groupPrefix: string
  onJumpToQuestion?: (id: string) => void
}) {
  const rootRef = useRef<HTMLPreElement | null>(null)
  usePaintHighlights(rootRef, groupPrefix, anchor, highlights, showOverlays, text)

  // Only marker boundaries split the DOM into separate elements — anchor
  // and highlight ranges are painted via the CSS Custom Highlight API
  // (see highlightPainter.ts) rather than wrapped in their own elements, so
  // they can never fragment a word into multiple padded/rounded pieces with
  // visible gaps between them.
  const markerSpans = markers
    .map((marker) => ({ marker, span: findTokenSpan(text, marker.offset) }))
    .filter((m): m is { marker: DocumentMarker; span: { start: number; end: number } } => m.span !== null)
    .sort((a, b) => a.span.start - b.span.start)

  const segments: Segment[] = []
  let cursor = 0
  for (const { marker, span } of markerSpans) {
    if (span.start < cursor) continue // overlapping marker tokens — keep the first
    if (span.start > cursor) segments.push({ start: cursor, end: span.start })
    segments.push({ start: span.start, end: span.end, marker })
    cursor = span.end
  }
  if (cursor < text.length) segments.push({ start: cursor, end: text.length })

  return (
    <pre className="document-viewer-text" ref={rootRef}>
      {segments.map((seg) => {
        const content = text.slice(seg.start, seg.end)
        if (seg.marker) {
          const marker = seg.marker
          return (
            <span
              key={seg.start}
              data-start={seg.start}
              className="document-viewer-marker"
              role="button"
              tabIndex={0}
              onClick={() => onJumpToQuestion?.(marker.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onJumpToQuestion?.(marker.id)
              }}
            >
              {content}
            </span>
          )
        }
        return (
          <span data-start={seg.start} key={seg.start}>
            {content}
          </span>
        )
      })}
    </pre>
  )
}
