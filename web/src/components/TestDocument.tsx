import { useEffect, useMemo, useState } from 'react'
import { getDocumentMarkers, type DocumentMarker as ApiDocumentMarker } from '../lib/api'
import DocumentView from './DocumentView'
import { testLayerFor } from './testLayer'

// The test-taking wrapper around DocumentView: adds the question's anchored
// range and the other questions' markers as a layer.
export default function TestDocument({
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
  const [markers, setMarkers] = useState<ApiDocumentMarker[]>([])

  useEffect(() => {
    setMarkers([])
    if (mode === 'full') {
      getDocumentMarkers(documentId)
        .then((r) => setMarkers(r.markers))
        .catch(() => {}) // markers are a nice-to-have overlay, not core to the document loading
    }
  }, [documentId, mode])

  const layers = useMemo(
    () =>
      mode === 'simple'
        ? []
        : [testLayerFor({ anchorStart, anchorEnd, anchorLabel, markers, onJump: onJumpToQuestion })],
    [mode, anchorStart, anchorEnd, anchorLabel, markers, onJumpToQuestion],
  )

  return (
    <DocumentView
      documentId={documentId}
      interaction={mode === 'simple' ? 'view' : 'annotate'}
      chrome={mode === 'simple' ? 'embedded' : 'full'}
      layers={layers}
    />
  )
}
