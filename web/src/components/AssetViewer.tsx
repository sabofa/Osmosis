import { XIcon } from './icons'
import DocumentView from './DocumentView'
import './AssetViewer.css'

// Full-size document viewer for an asset, opened from Settings → Documents
// by double-clicking a row. Uses DocumentView (annotate) (highlights,
// markers, PDF pages) rather than the compact panel the Take screen shows.
export default function AssetViewer({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="question-detail-backdrop" onClick={onClose}>
      <div className="asset-viewer" onClick={(e) => e.stopPropagation()}>
        <button className="asset-viewer-close" onClick={onClose} aria-label="Close">
          <XIcon size={14} />
        </button>
        <div className="asset-viewer-body">
          <DocumentView documentId={id} interaction="annotate" />
        </div>
      </div>
    </div>
  )
}
