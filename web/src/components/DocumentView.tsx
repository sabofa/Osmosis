import { Suspense, useEffect, useState } from 'react'
import { getAsset, assetDownloadUrl, type Asset } from '../lib/api'
import { useDocumentTokens } from '../theme/useDocumentTokens'
import { DownloadIcon } from './icons'
import { DocumentViewer, renderGraph } from './documentViewerShared'
import type { DocumentRenderError, DocumentLayer } from 'document-engine'

// A plain document viewer: loads an asset and shows it. Knows nothing about
// questions, markers or attempts; callers compose behaviour through `layers`.
export default function DocumentView({
  documentId,
  interaction = 'annotate',
  chrome = 'full',
  layers,
}: {
  documentId: string
  interaction?: 'view' | 'annotate'
  chrome?: 'full' | 'embedded'
  layers?: DocumentLayer[]
}) {
  const [asset, setAsset] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The document face and colours come from the active theme via tokens.
  const tokens = useDocumentTokens()

  useEffect(() => {
    let cancelled = false
    setAsset(null)
    setError(null)
    getAsset(documentId)
      .then((a) => {
        if (!cancelled) setAsset(a)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [documentId])

  if (error) return <div className="panel-placeholder">Could not load document: {error}</div>
  if (!asset) return <div className="panel-placeholder">Loading document…</div>

  const downloadUrl = assetDownloadUrl(asset.id)

  function handleErrors(errors: DocumentRenderError[]) {
    if (errors.length > 0) console.warn('document render errors', errors)
  }

  if (asset.type === 'url') {
    return (
      <div className="document-panel no-scrollbar">
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
    <div className="document-panel no-scrollbar">
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
            tokens={tokens}
            interaction={interaction}
            chrome={chrome}
            layers={layers ?? []}
            onErrors={handleErrors}
            renderGraph={renderGraph}
          />
        </Suspense>
      </div>
    </div>
  )
}
