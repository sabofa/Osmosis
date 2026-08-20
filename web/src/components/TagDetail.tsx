import { useEffect, useState } from 'react'
import { XIcon, TagIcon, ChartIcon, CalcIcon, BookIcon } from './icons'
import { getQuestions, type TagSummary, type QuestionSummary } from '../lib/api'
import { useTagNotes } from '../hooks/useTagNotes'
import './TagDetail.css'

const TYPE_LABEL: Record<QuestionSummary['type'], string> = { mc: 'MC', written: 'Written' }

export default function TagDetail({
  tag,
  allTags,
  onClose,
  onOpenTag,
}: {
  tag: TagSummary
  allTags: TagSummary[]
  onClose: () => void
  onOpenTag: (slug: string) => void
}) {
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { notes, save } = useTagNotes(tag.slug)
  const [draftNotes, setDraftNotes] = useState(notes)

  useEffect(() => setDraftNotes(notes), [notes])

  useEffect(() => {
    setQuestions(null)
    getQuestions({ tag: tag.slug })
      .then((r) => setQuestions(r.questions))
      .catch((err) => setError(String(err)))
  }, [tag.slug])

  const parent = tag.parent_slug ? allTags.find((t) => t.slug === tag.parent_slug) : undefined
  const children = allTags.filter((t) => t.parent_slug === tag.slug)

  return (
    <div className="tag-detail-backdrop" onClick={onClose}>
      <div className="tag-detail" onClick={(e) => e.stopPropagation()}>
        <div className="tag-detail-header">
          <div>
            {parent && (
              <button className="tag-detail-parent" onClick={() => onOpenTag(parent.slug)}>
                &larr; {parent.label}
              </button>
            )}
            <h2>{tag.label}</h2>
            <div className="tag-detail-slug">{tag.slug}</div>
          </div>
          <button className="tag-detail-close" onClick={onClose} aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>

        <div className="tag-detail-meta">
          <span className="tag-detail-badge">{tag.question_count} questions</span>
          <span className="tag-detail-badge">created {tag.created_at.slice(0, 10)}</span>
          {tag.retired_at && <span className="tag-detail-badge retired">retired {tag.retired_at.slice(0, 10)}</span>}
        </div>

        <div className="tag-detail-body">
          <div className="tag-detail-col no-scrollbar">
            <div className="tag-detail-section">
              <div className="tag-detail-label">Description</div>
              <div className="tag-detail-text">{tag.description || 'No description yet.'}</div>
            </div>

            {children.length > 0 && (
              <div className="tag-detail-section">
                <div className="tag-detail-label">Child tags</div>
                <div className="tag-detail-children">
                  {children.map((c) => (
                    <button key={c.slug} className="tag-detail-child" onClick={() => onOpenTag(c.slug)}>
                      <TagIcon size={11} />
                      {c.label}
                      <span className="tag-detail-child-count">{c.question_count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="tag-detail-section">
              <div className="tag-detail-label">Notes <span className="tag-detail-label-hint">only visible to you, stored on this device</span></div>
              <textarea
                className="tag-detail-notes"
                placeholder="Anything you want to remember about this tag…"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                onBlur={() => save(draftNotes)}
              />
            </div>
          </div>

          <div className="tag-detail-col no-scrollbar">
            <div className="tag-detail-label">Used by</div>
            <div className="tag-detail-questions no-scrollbar">
              {error && <div className="bank-empty">Could not reach the local node: {error}</div>}
              {questions === null && !error && <div className="bank-empty">Loading…</div>}
              {questions?.map((q) => (
                <div className="tag-detail-question" key={q.id}>
                  <span className={`bank-type-badge ${q.type}`}>{TYPE_LABEL[q.type]}</span>
                  <span className="tag-detail-question-prompt">{q.prompt}</span>
                  <div className="bank-panel-badges">
                    {q.has_graph && (
                      <span className="bank-panel-icon" title="Has graph">
                        <ChartIcon size={12} />
                      </span>
                    )}
                    {q.desmos_allowed && (
                      <span className="bank-panel-icon" title="Desmos allowed">
                        <CalcIcon size={12} />
                      </span>
                    )}
                    {q.has_document && (
                      <span className="bank-panel-icon" title="Has document">
                        <BookIcon size={12} />
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {questions && questions.length === 0 && <div className="bank-empty">Nothing tagged with this yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
