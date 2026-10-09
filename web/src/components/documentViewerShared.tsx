import React from 'react'
import GraphPanel from './GraphPanel'
// document-engine's Vite library build extracts CSS into its own file (same
// convention as graph-engine, see GraphPanel.tsx): without this the viewer has
// no display/sizing/theme rules at all.
import 'document-engine/style.css'

// document-engine pulls in pdfjs-dist, real weight for the PDF renderer, so
// lazy-load it for pages that never show a document.
export const DocumentViewer = React.lazy(() => import('document-engine').then((m) => ({ default: m.DocumentViewer })))

// Inline ```graph fences: the engine stays graph-agnostic, we hand it the
// lazy graph viewer.
export const renderGraph = (spec: string, ctx: { onErrors(msgs: string[]): void }) => (
  <GraphPanel spec={spec} onErrors={ctx.onErrors} />
)

// Inline markdown text as the engine's asset shape; the engine reads the text
// exactly as given.
export function textAsset(text: string) {
  return { type: 'text' as const, mime: 'text/markdown', content: text, extractedText: text, url: null }
}
