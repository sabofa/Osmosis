import type { ReactNode } from 'react'

export interface DocumentViewerAsset {
  type: 'text' | 'file'
  mime?: string | null
  content?: string | null
  // Full extracted text — for `type: 'text'` this is the same as `content`;
  // for PDFs it's the server's document-engine/core-extracted text (offsets
  // line up with what the PDF renderer computes at render time); for images
  // it's a verbatim transcription with no positional/bounding-box data.
  extractedText?: string | null
  // Where to fetch the rendered bytes from (PDF/image `file` assets). Unused
  // for `type: 'text'`.
  url?: string | null
}

// All offsets in this file are CODEPOINT indices into the document text
// (not UTF-16 code units); the engine converts at its edges.
export interface DocumentMarker {
  id: string
  offset: number // codepoint index
  // Optional re-anchoring context: when `quote` is set the viewer re-finds
  // it in the current text before painting and skips (and reports) it if gone.
  quote?: string
  prefix?: string
  suffix?: string
}

export interface DocumentAnchor {
  start: number // codepoint index, inclusive
  end: number // codepoint index, exclusive
  // Optional re-anchoring context: when `quote` is set the viewer re-finds
  // it in the current text before painting and skips (and reports) it if gone.
  quote?: string
  prefix?: string
  suffix?: string
  label?: string | null
}

// A user-created highlight — distinct from DocumentAnchor (one author-set
// excerpt range) and DocumentMarker (one author-set clickable point):
// highlights are created interactively by selecting text in the viewer
// itself, so there can be any number of them, and the host app owns
// persisting them (see DocumentViewerProps.onHighlightsChange).
export interface DocumentHighlight {
  id: string
  start: number // codepoint index, inclusive
  end: number // codepoint index, exclusive
  // Optional re-anchoring context: when `quote` is set the viewer re-finds
  // it in the current text before painting and skips (and reports) it if gone.
  quote?: string
  prefix?: string
  suffix?: string
  // One of HIGHLIGHT_PALETTE's ids (see highlightPalette.ts); defaults to
  // the palette's first color when omitted.
  color?: string
}

export interface DocumentRenderError {
  message: string
}

// How much the viewer lets the reader do. 'edit' is a stub until the editing
// mode lands; it still shows the content read-only.
export type Interaction = 'view' | 'annotate' | 'edit'

// 'full': content + zoom + settings menu. 'embedded': content + zoom buttons
// only (no settings menu, no highlighting) for small inline use.
export type Chrome = 'full' | 'embedded'

// A layer composes over the viewer: it contributes an anchored range and/or
// clickable markers. The viewer knows nothing about what the layer is for.
export interface DocumentLayer {
  anchor?: DocumentAnchor | null
  markers?: DocumentMarker[]
  onMarkerActivate?(id: string): void
}

// Host-supplied renderer for ```graph fences (the engine does not depend on
// the graph engine). Called with the fence body; report parse/render errors
// through ctx.onErrors.
export type RenderGraph = (spec: string, ctx: { onErrors(messages: string[]): void }) => ReactNode
