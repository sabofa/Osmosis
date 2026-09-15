import { useState } from 'react'
import GraphPanel from './GraphPanel'
import DesmosPanel from './DesmosPanel'
import DocumentPanel from './DocumentPanel'
import './QuestionPanel.css'

type PanelMode = 'graph' | 'desmos' | 'document'

const PANEL_LABEL: Record<PanelMode, string> = {
  graph: 'Graph',
  desmos: 'Desmos',
  document: 'Document',
}

interface QuestionPanelProps {
  graphSpec?: string | null
  desmosAllowed?: boolean
  documentId?: string | null
  documentAnchorLabel?: string | null
  documentAnchorStart?: number | null
  documentAnchorEnd?: number | null
  onJumpToQuestion?: (questionId: string) => void
}

export default function QuestionPanel({
  graphSpec,
  desmosAllowed,
  documentId,
  documentAnchorLabel,
  documentAnchorStart,
  documentAnchorEnd,
  onJumpToQuestion,
}: QuestionPanelProps) {
  const available: PanelMode[] = []
  if (graphSpec) available.push('graph')
  if (desmosAllowed) available.push('desmos')
  if (documentId) available.push('document')

  const [mode, setMode] = useState<PanelMode | null>(null)
  const activeMode = mode !== null && available.includes(mode) ? mode : available[0]

  if (available.length === 0) return null

  return (
    <div className="question-panel">
      {available.length > 1 && (
        <div className="panel-mode-tabs">
          {available.map((m) => (
            <button
              key={m}
              type="button"
              className={`panel-mode-tab${m === activeMode ? ' active' : ''}`}
              onClick={() => setMode(m)}
            >
              {PANEL_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <div className="question-panel-body">
        {/* Keyed by spec so each question gets its own viewer (fresh canvas,
            fresh camera) instead of inheriting the previous question's. */}
        {activeMode === 'graph' && graphSpec && <GraphPanel key={graphSpec} spec={graphSpec} />}
        {activeMode === 'desmos' && <DesmosPanel />}
        {activeMode === 'document' && documentId && (
          <DocumentPanel
            documentId={documentId}
            anchorLabel={documentAnchorLabel ?? null}
            anchorStart={documentAnchorStart ?? null}
            anchorEnd={documentAnchorEnd ?? null}
            onJumpToQuestion={onJumpToQuestion}
          />
        )}
      </div>
    </div>
  )
}
