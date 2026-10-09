import { Suspense } from 'react'
import { useMemo } from 'react'
import { useDocumentTokens } from '../theme/useDocumentTokens'
import { DocumentViewer, renderGraph, textAsset } from './documentViewerShared'

// The document viewer over inline markdown text (no asset id, no header).
// Highlights live in the session only; nothing is persisted here.
export default function DocumentTextView({
  text,
  interaction = 'annotate',
  chrome = 'full',
}: {
  text: string
  interaction?: 'view' | 'annotate'
  chrome?: 'full' | 'embedded'
}) {
  const tokens = useDocumentTokens()
  const asset = useMemo(() => textAsset(text), [text])
  return (
    <div className="document-text-view">
      <Suspense fallback={<div className="panel-loading">Loading document…</div>}>
        <DocumentViewer
          asset={asset}
          tokens={tokens}
          interaction={interaction}
          chrome={chrome}
          layers={[]}
          onErrors={(errors) => {
            if (errors.length > 0) console.warn('document render errors', errors)
          }}
          renderGraph={renderGraph}
        />
      </Suspense>
    </div>
  )
}
