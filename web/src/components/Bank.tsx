import { useEffect, useState } from 'react'
import { TagIcon, ChevronRightIcon, ChevronDownIcon, ChartIcon, CalcIcon, BookIcon } from './icons'
import { getTags, getQuestions, type TagSummary, type QuestionSummary } from '../lib/api'
import TagDetail from './TagDetail'
import QuestionDetail from './QuestionDetail'
import RichText from './RichText'
import './Bank.css'

const TYPE_LABEL: Record<QuestionSummary['type'], string> = { mc: 'MC', written: 'Written' }

export default function Bank({ initialTag }: { initialTag?: string | null } = {}) {
  const [tags, setTags] = useState<TagSummary[] | null>(null)
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Folded parent tags (a subject with a hundred children folds to one row).
  // Remembered per slug so the bank opens the way it was left.
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('osmosis:bank-folded') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })

  function toggleFold(slug: string) {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      try {
        localStorage.setItem('osmosis:bank-folded', JSON.stringify([...next]))
      } catch {
        /* a private window forgets; the bank still works */
      }
      return next
    })
  }

  function setAllFolded(fold: boolean) {
    const next = fold ? new Set((tags ?? []).filter((t) => hasChildren.has(t.slug)).map((t) => t.slug)) : new Set<string>()
    setFolded(next)
    try {
      localStorage.setItem('osmosis:bank-folded', JSON.stringify([...next]))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    getTags()
      .then((r) => setTags(r.tags))
      .catch((err) => setError(String(err)))
  }, [])

  // The command line can point the bank at a tag while it is already open.
  useEffect(() => {
    if (initialTag !== undefined) setSelectedTag(initialTag)
  }, [initialTag])

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

  // A tag is hidden when any ancestor is folded. Parents are recognised by
  // slug prefix, so this needs no extra field from the server.
  const hasChildren = new Set<string>()
  for (const t of tags ?? []) {
    const parts = t.slug.split(':')
    for (let i = 1; i < parts.length; i++) hasChildren.add(parts.slice(0, i).join(':'))
  }
  function hiddenByFold(slug: string): boolean {
    const parts = slug.split(':')
    for (let i = 1; i < parts.length; i++) if (folded.has(parts.slice(0, i).join(':'))) return true
    return false
  }
  const visibleTags = (tags ?? []).filter((t) => !hiddenByFold(t.slug))

  return (
    <div className="bank">
      <div className="panel bank-tags-panel">
        <div className="bank-panel-header">
          <h1>Bank</h1>
          <span className="bank-count">{tags ? `${tags.length} tags` : '…'}</span>
          {tags && hasChildren.size > 0 && (
            <div className="bank-fold-all">
              <button className="bank-fold-btn" onClick={() => setAllFolded(true)} title="Fold every group">
                Fold all
              </button>
              <button className="bank-fold-btn" onClick={() => setAllFolded(false)} title="Unfold every group">
                Unfold all
              </button>
            </div>
          )}
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
          {visibleTags.map((t, i) => {
            const isParent = hasChildren.has(t.slug)
            const isFolded = folded.has(t.slug)
            return (
              <div
                key={t.slug}
                className={`bank-tag-row${t.slug === selectedTag ? ' selected' : ''}${isFolded ? ' folded' : ''}`}
                style={{ paddingLeft: 6 + (t.slug.split(':').length - 1) * 14, animationDelay: `${Math.min(i, 12) * 22}ms` }}
                onClick={() => setSelectedTag((cur) => (cur === t.slug ? null : t.slug))}
                onDoubleClick={() => setOpenTag(t.slug)}
                title="Click to filter, double-click to open"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelectedTag((cur) => (cur === t.slug ? null : t.slug))
                  if (isParent && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    if ((e.key === 'ArrowLeft') !== isFolded) toggleFold(t.slug)
                  }
                }}
              >
                {isParent ? (
                  <button
                    className="bank-fold-toggle"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFold(t.slug)
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={isFolded ? `Unfold ${t.label}` : `Fold ${t.label}`}
                    aria-expanded={!isFolded}
                  >
                    {isFolded ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                  </button>
                ) : (
                  <span className="bank-fold-spacer" />
                )}
                <span className="bank-tag-name">{t.label}</span>
                {isFolded && (
                  <span className="bank-tag-folded-count">
                    {(tags ?? []).filter((c) => c.slug.startsWith(t.slug + ':')).length} inside
                  </span>
                )}
                <span className="bank-tag-count">{t.question_count}</span>
                <span className="bank-tag-chevron">
                  <ChevronRightIcon size={12} />
                </span>
              </div>
            )
          })}
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
              <RichText className="bank-question-prompt" text={q.prompt} />
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
