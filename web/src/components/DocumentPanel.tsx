import React, { Suspense, useEffect, useState } from 'react'
import { getAsset, assetDownloadUrl, getDocumentMarkers, type Asset, type DocumentMarker as ApiDocumentMarker } from '../lib/api'
import { useTheme } from '../hooks/useTheme'
import { DownloadIcon } from './icons'
import type { DocumentRenderError } from 'document-engine'
// document-engine's Vite library build extracts CSS into its own file rather
// than injecting it via the JS bundle (same convention as graph-engine — see
// GraphPanel.tsx's comment) — without this, DocumentViewer has no
// display/sizing/theme rules at all.
import 'document-engine/style.css'

// document-engine pulls in pdfjs-dist, real weight for the PDF renderer —
// lazy-load it so pages that never show a document question don't pay for it.
const DocumentViewer = React.lazy(() => import('document-engine').then((m) => ({ default: m.DocumentViewer })))

export default function DocumentPanel({
  documentId,
  anchorLabel,
  anchorStart,
  anchorEnd,
  mode = 'full',
  onJumpToQuestion,
}: {
  documentId: string
  anchorLabel: string | null
  anchorStart: number | null
  anchorEnd: number | null
  mode?: 'full' | 'simple'
  onJumpToQuestion?: (questionId: string) => void
}) {
  const [asset, setAsset] = useState<Asset | null>(null)
  const [markers, setMarkers] = useState<ApiDocumentMarker[]>([])
  const [error, setError] = useState<string | null>(null)
  const { resolvedMode } = useTheme()

  useEffect(() => {
    setAsset(null)
    setMarkers([])
    setError(null)
    getAsset(documentId)
      .then(setAsset)
      .catch((err) => setError(String(err)))
    if (mode === 'full') {
      getDocumentMarkers(documentId)
        .then((r) => setMarkers(r.markers))
        .catch(() => {}) // markers are a nice-to-have overlay, not core to the document loading
    }
  }, [documentId, mode])

  if (error) return <div className="panel-placeholder">Could not load document: {error}</div>
  if (!asset) return <div className="panel-placeholder">Loading document…</div>

  const downloadUrl = assetDownloadUrl(asset.id)
  const hasAnchor = anchorStart !== null && anchorEnd !== null

  function handleErrors(errors: DocumentRenderError[]) {
    if (errors.length > 0) console.warn('document render errors', errors)
  }

  if (asset.type === 'url') {
    return (
      <div className="document-panel">
        <div className="document-panel-frame-wrap">
          <iframe className="document-panel-frame" src={asset.content ?? undefined} title={asset.title} />
          <a className="document-panel-fallback-link" href={asset.content ?? undefined} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
        </div>
      </div>
    )
  }

  const engineAsset = {
    type: asset.type as 'text' | 'file',
    mime: asset.mime,
    content: asset.content,
    extractedText: asset.extracted_text,
    url: asset.type === 'file' ? downloadUrl : null,
  }

  return (
    <div className="document-panel">
      <div className="document-panel-header">
        <span className="document-panel-title">{asset.title}</span>
        {asset.type === 'file' && (
          <a className="document-panel-download" href={downloadUrl} download>
            <DownloadIcon size={12} />
            Download
          </a>
        )}
      </div>
      <div className="document-panel-viewer">
        <Suspense fallback={<div className="panel-loading">Loading document…</div>}>
          <DocumentViewer
            asset={engineAsset}
            theme={resolvedMode}
            mode={mode}
            anchor={hasAnchor ? { start: anchorStart!, end: anchorEnd!, label: anchorLabel } : null}
            markers={markers.map((m) => ({ id: m.id, offset: m.document_marker_offset }))}
            onJumpToQuestion={onJumpToQuestion}
            onErrors={handleErrors}
          />
        </Suspense>
      </div>
    </div>
  )
}
