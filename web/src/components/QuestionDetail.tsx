import { useEffect, useState } from 'react'
import { XIcon, CheckIcon } from './icons'
import { getQuestion, type QuestionDetail as QuestionDetailType } from '../lib/api'
import QuestionPanel from './QuestionPanel'
import { usePanelWidth } from '../hooks/usePanelWidth'
import './QuestionDetail.css'

export default function QuestionDetail({
  id,
  onClose,
  onJumpToQuestion,
}: {
  id: string
  onClose: () => void
  // Typically wired to the caller's own `id` state setter, so clicking a
  // marker swaps which question this same modal shows in place. Omitted
  // markers/anchors simply aren't clickable when this isn't passed.
  onJumpToQuestion?: (questionId: string) => void
}) {
  const [question, setQuestion] = useState<QuestionDetailType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { width: panelWidth, onPointerDown: onPanelResizeStart } = usePanelWidth(
    'osmosis:panel-width:detail',
    360,
    240,
    Math.round(window.innerWidth * 0.75)
  )

  useEffect(() => {
    setQuestion(null)
    getQuestion(id)
      .then(setQuestion)
      .catch((err) => setError(String(err)))
  }, [id])

  const hasPanel = !!question && (!!question.graph_spec || question.desmos_allowed || !!question.document_id)

  return (
    <div className="question-detail-backdrop" onClick={onClose}>
      <div className={`question-detail no-scrollbar${hasPanel ? ' with-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="question-detail-header">
          {question && <span className={`bank-type-badge ${question.type}`}>{question.type === 'mc' ? 'MC' : 'Written'}</span>}
          <div className="question-detail-spacer" />
          <button className="question-detail-close" onClick={onClose} aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>

        {error && <div className="bank-empty">Could not reach the local node: {error}</div>}
        {!question && !error && <div className="bank-empty">Loading…</div>}

        {question && (
          <div className={`question-detail-layout${hasPanel ? ' split' : ''}`}>
          <div className="question-detail-main">
            <div className="question-detail-prompt">{question.prompt}</div>

            <div className="question-detail-meta">
              <span className="question-detail-badge">difficulty {question.difficulty}</span>
              {question.calculator_policy !== 'n_a' && (
                <span className="question-detail-badge">
                  {question.calculator_policy === 'forbidden' ? 'no calculator' : 'calculator ok'}
                </span>
              )}
              <span className="question-detail-badge">v{question.version}</span>
              {question.retired_at && <span className="question-detail-badge retired">retired</span>}
            </div>

            {question.type === 'mc' ? (
              <div className="question-detail-choices">
                {question.choices.map((c) => (
                  <div className={`question-detail-choice${c.is_correct ? ' correct' : ''}`} key={c.id}>
                    {c.is_correct && <CheckIcon size={13} />}
                    <span>{c.body}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="question-detail-written">
                <div className="question-detail-label">Model answer</div>
                <div className="question-detail-text">{question.model_answer}</div>
                {question.rubric && <div className="question-detail-rubric">Rubric: {question.rubric}</div>}
              </div>
            )}

            {question.explanation && (
              <div className="question-detail-section">
                <div className="question-detail-label">Explanation</div>
                <div className="question-detail-text">{question.explanation}</div>
              </div>
            )}

            <div className="question-detail-tags">
              {question.tags.map((t) => (
                <span className="question-detail-tag" key={t}>
                  {t}
                </span>
              ))}
            </div>

            <div className="question-detail-footer">
              created {question.created_at.slice(0, 10)}
              {question.source_note && ` · ${question.source_note}`}
            </div>
          </div>

          {hasPanel && (
            <>
              <div
                className="panel-resize-handle"
                onPointerDown={onPanelResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
              />
              <div className="question-detail-aside no-scrollbar" style={{ width: panelWidth }}>
                <QuestionPanel
                  graphSpec={question.graph_spec}
                  desmosAllowed={question.desmos_allowed}
                  documentId={question.document_id}
                  documentAnchorLabel={question.document_anchor_label}
                  documentAnchorStart={question.document_anchor_start}
                  documentAnchorEnd={question.document_anchor_end}
                  onJumpToQuestion={onJumpToQuestion}
                />
              </div>
            </>
          )}
          </div>
        )}
      </div>
    </div>
  )
}
