import type { DocumentLayer } from 'document-engine'

// The test-taking overlay for a document: the question's anchored range plus
// the other questions' markers. Pure, so it is testable without the viewer.
export function testLayerFor({
  anchorStart,
  anchorEnd,
  anchorLabel,
  markers,
  onJump,
}: {
  anchorStart: number | null
  anchorEnd: number | null
  anchorLabel: string | null
  markers: { id: string; document_marker_offset: number }[]
  onJump?: (questionId: string) => void
}): DocumentLayer {
  const hasAnchor = anchorStart !== null && anchorEnd !== null
  return {
    anchor: hasAnchor ? { start: anchorStart!, end: anchorEnd!, label: anchorLabel } : null,
    markers: markers.map((m) => ({ id: m.id, offset: m.document_marker_offset })),
    onMarkerActivate: onJump,
  }
}
