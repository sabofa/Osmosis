import { useEffect, useState } from 'react'
import { TagIcon, ChevronRightIcon, ChartIcon, CalcIcon, BookIcon } from './icons'
import { getTags, getQuestions, type TagSummary, type QuestionSummary } from '../lib/api'
import TagDetail from './TagDetail'
import QuestionDetail from './QuestionDetail'
import './Bank.css'

const TYPE_LABEL: Record<QuestionSummary['type'], string> = { mc: 'MC', written: 'Written' }

export default function Bank() {
  const [tags, setTags] = useState<TagSummary[] | null>(null)
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTags()
      .then((r) => setTags(r.tags))
      .catch((err) => setError(String(err)))
  }, [])

  // Clearing immediately (rather than leaving the previous tag's results on
  // screen until the new ones arrive) is what stops the "flash the old tag,
  // then flash the new one" glitch — the list shows a loading state instead
  // of briefly showing results that don't match the tag that's now selected.
  useEffect(() => {
    setQuestions(null)
  }, [selectedTag, search])

  useEffect(() => {
    // A tag click is a single discrete action, not a stream of keystrokes —
    // debouncing it just adds a flat 150ms of extra latency on top of the
    // actual fetch for no reason. Only free-text typing needs the debounce.
    const handle = setTimeout(
      () => {
        getQuestions({ tag: selectedTag ?? undefined, text: search || undefined })
          .then((r) => {
            setQuestions(r.questions)
            setTotal(r.total)
          })
          .catch((err) => setError(String(err)))
      },
      search ? 150 : 0
    )
    return () => clearTimeout(handle)
  }, [selectedTag, search])

  const openTagSummary = tags?.find((t) => t.slug === openTag)

  return (
    <div className="bank">
      <div className="panel bank-tags-panel">
        <div className="bank-panel-header">
          <h1>Bank</h1>
          <span className="bank-count">{tags ? `${tags.length} tags` : '…'}</span>
        </div>
        <div className="bank-tags-list no-scrollbar">
          <button
            className={`bank-tag-row${selectedTag === null ? ' selected' : ''}`}
            onClick={() => setSelectedTag(null)}
          >
            <span className="bank-tag-icon">
              <TagIcon size={14} />
            </span>
            <span className="bank-tag-name">All tags</span>
          </button>
          {tags?.map((t, i) => (
            <button
              key={t.slug}
              className={`bank-tag-row${t.slug === selectedTag ? ' selected' : ''}`}
              style={{ paddingLeft: 14 + (t.slug.split(':').length - 1) * 14, animationDelay: `${Math.min(i, 12) * 22}ms` }}
              onClick={() => setSelectedTag((cur) => (cur === t.slug ? null : t.slug))}
              onDoubleClick={() => setOpenTag(t.slug)}
              title="Click to filter, double-click to open"
            >
              <span className="bank-tag-name">{t.label}</span>
              <span className="bank-tag-count">{t.question_count}</span>
              <span className="bank-tag-chevron">
                <ChevronRightIcon size={12} />
              </span>
            </button>
          ))}
          {tags === null && !error && <div className="bank-empty">Loading…</div>}
          {tags && tags.length === 0 && <div className="bank-empty">No tags yet — write some over MCP.</div>}
        </div>
      </div>

      <div className="panel bank-questions-panel">
        <div className="bank-panel-header">
          <input
            className="bank-search"
            placeholder="Search prompts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="bank-count">{questions ? `${total} question${total === 1 ? '' : 's'}` : '…'}</span>
        </div>
        <div className="bank-questions-list no-scrollbar" key={selectedTag ?? 'all'}>
          {error && <div className="bank-empty">Could not reach the local node: {error}</div>}
          {questions === null && !error && <div className="bank-empty">Loading…</div>}
          {questions?.map((q, i) => (
            <div
              className="bank-question-row"
              key={q.id}
              style={{ animationDelay: `${Math.min(i, 10) * 20}ms` }}
              onDoubleClick={() => setOpenQuestionId(q.id)}
              title="Double-click to view"
            >
              <div className="bank-question-top">
                <span className={`bank-type-badge ${q.type}`}>{TYPE_LABEL[q.type]}</span>
                <span className="bank-difficulty">difficulty {q.difficulty}</span>
                {q.calculator_policy !== 'n_a' && (
                  <span className="bank-calc">{q.calculator_policy === 'forbidden' ? 'no calculator' : 'calculator ok'}</span>
                )}
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
              <div className="bank-question-prompt">{q.prompt}</div>
              <div className="bank-question-tags">{q.tags.join(' · ')}</div>
            </div>
          ))}
          {questions && questions.length === 0 && (
            <div className="bank-empty">Nothing here yet — write questions over MCP, or wait for a pull to sync this slice.</div>
          )}
        </div>
      </div>

      {openTagSummary && tags && (
        <TagDetail
          key={openTagSummary.slug}
          tag={openTagSummary}
          allTags={tags}
          onClose={() => setOpenTag(null)}
          onOpenTag={setOpenTag}
        />
      )}

      {openQuestionId && (
        <QuestionDetail id={openQuestionId} onClose={() => setOpenQuestionId(null)} onJumpToQuestion={setOpenQuestionId} />
      )}
    </div>
  )
}
