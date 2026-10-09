import DocumentView from '../components/DocumentView'
import GraphPanel from '../components/GraphPanel'
import type { FileViewProps } from './fileTypes'

// The built-in web file formats that are thin wrappers over a panel the app
// already has. (markdown has its own file, MarkdownFile.)

export function GraphView({ body }: FileViewProps) {
  return <GraphPanel spec={body ?? ''} />
}

// The "upload" format: a file that wraps an uploaded asset (an uploaded document).
export function AssetView({ assetId }: FileViewProps) {
  if (!assetId) return <div className="ws-note">This upload no longer exists.</div>
  return <DocumentView documentId={assetId} interaction="annotate" />
}
