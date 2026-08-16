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

export interface DocumentMarker {
  id: string
  offset: number
}

export interface DocumentAnchor {
  start: number
  end: number
  label?: string | null
}

// A user-created highlight — distinct from DocumentAnchor (one author-set
// excerpt range) and DocumentMarker (one author-set clickable point):
// highlights are created interactively by selecting text in the viewer
// itself, so there can be any number of them, and the host app owns
// persisting them (see DocumentViewerProps.onHighlightsChange).
export interface DocumentHighlight {
  id: string
  start: number
  end: number
  // One of HIGHLIGHT_PALETTE's ids (see highlightPalette.ts); defaults to
  // the palette's first color when omitted.
  color?: string
}

export interface DocumentRenderError {
  message: string
}
