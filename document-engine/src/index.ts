// Package entry point (see graph-engine/src/index.ts for the pattern this
// mirrors) — consumed by web/src/components/DocumentPanel.tsx.
export { default as DocumentViewer } from './DocumentViewer'
export type { DocumentViewerProps } from './DocumentViewer'
export type {
  DocumentViewerAsset,
  DocumentAnchor,
  DocumentMarker,
  DocumentHighlight,
  DocumentRenderError,
} from './types'
