import DocumentPanel from '../components/DocumentPanel'
import GraphPanel from '../components/GraphPanel'
import type { FileViewProps } from './fileTypes'

// The built-in web file types that are thin wrappers over a panel the app
// already has. (markdown has its own file, MarkdownFile.)

export function GraphView({ body }: FileViewProps) {
  return <GraphPanel spec={body ?? ''} />
}

export function AssetView({ assetId }: FileViewProps) {
  if (!assetId) return <div className="ws-note">This upload no longer exists.</div>
  return <DocumentPanel documentId={assetId} anchorLabel={null} anchorStart={null} anchorEnd={null} mode="full" />
}
