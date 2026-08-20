import { useEffect, useState } from 'react'
import { DownloadIcon, TrashIcon, TagIcon, ClockIcon, RefreshIcon } from './icons'
import TagDetail from './TagDetail'
import { useTagPopout } from '../hooks/useTagPopout'
import {
  getTemplates,
  getTemplateQuestions,
  downloadTemplate,
  deleteLocalTemplate,
  getStatus,
  type TemplateSummary,
  type TemplateQuestionPreview,
  type NodeStatus,
} from '../lib/api'
import './Library.css'

const TYPE_LABEL: Record<TemplateQuestionPreview['type'], string> = { mc: 'MC', written: 'Written' }

type SortMode =
  | 'name-asc'
  | 'name-desc'
  | 'questions-most'
  | 'questions-fewest'
  | 'difficulty-hardest'
  | 'difficulty-easiest'
  | 'subject'
  | 'newest'
  | 'oldest'

const SORT_LABEL: Record<SortMode, string> = {
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
  'questions-most': 'Questions (most first)',
  'questions-fewest': 'Questions (fewest first)',
  'difficulty-hardest': 'Difficulty (hardest first)',
  'difficulty-easiest': 'Difficulty (easiest first)',
  subject: 'Subject',
  newest: 'Newest first',
  oldest: 'Oldest first',
}

function avgDifficulty(t: TemplateSummary): number {
  return ((t.difficulty_min ?? 1) + (t.difficulty_max ?? 5)) / 2
}

function subjectOf(t: TemplateSummary): string {
  const first = t.tag_query.all?.[0] ?? t.tag_query.any?.[0]
  // Whole-bank templates (no tag_query) have no subject to group by — push
  // them to the end rather than clumping them arbitrarily at the front.
  if (!first) return '￿'
  return first.split(':')[0]
}

function sortTemplates(list: TemplateSummary[], mode: SortMode): TemplateSummary[] {
  const sorted = [...list]
  switch (mode) {
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name))
    case 'questions-most':
      return sorted.sort((a, b) => b.question_count - a.question_count)
    case 'questions-fewest':
      return sorted.sort((a, b) => a.question_count - b.question_count)
    case 'difficulty-hardest':
      return sorted.sort((a, b) => avgDifficulty(b) - avgDifficulty(a))
    case 'difficulty-easiest':
      return sorted.sort((a, b) => avgDifficulty(a) - avgDifficulty(b))
    case 'subject':
      return sorted.sort((a, b) => subjectOf(a).localeCompare(subjectOf(b)) || a.name.localeCompare(b.name))
    case 'newest':
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    case 'oldest':
      return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Library({ onStart }: { onStart: (templateId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<TemplateQuestionPreview[] | null>(null)
  const tagPopout = useTagPopout()
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')
  const [status, setStatus] = useState<NodeStatus | null>(null)

  useEffect(() => {
    getTemplates()
      .then((r) => setTemplates(r.templates))
      .catch((err) => setError(String(err)))
    getStatus()
      .then(setStatus)
      .catch(() => {})
  }, [])

  // A canonical node holds the whole bank; "downloading" a slice of it is
  // meaningless there and the server rejects it, so hide the controls.
  const isCanonical = status?.canonical === true

  useEffect(() => {
    if (!selectedId) return
    setQuestions(null)
    getTemplateQuestions(selectedId)
      .then((r) => setQuestions(r.questions))
      .catch((err) => setError(String(err)))
  }, [selectedId])

  const selected = templates?.find((t) => t.id === selectedId) ?? null

  const visibleTemplates = templates
    ? sortTemplates(
        templates.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase())),
        sortMode
      )
    : null

  // Download and update are the same underlying call (re-stamp the local
  // marker) — they're presented as separate buttons because they mean
  // different things to the user, but both just need downloaded_at to move
  // forward so update_available re-derives to false.
  async function handleDownload(id: string) {
    setBusy(true)
    try {
      const result = await downloadTemplate(id)
      setTemplates(
        (prev) =>
          prev?.map((t) =>
            t.id === id ? { ...t, downloaded: true, downloaded_at: result.downloaded_at, update_available: false } : t
          ) ?? prev
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true)
    try {
      await deleteLocalTemplate(id)
      setTemplates(
        (prev) =>
          prev?.map((t) =>
            t.id === id ? { ...t, downloaded: false, downloaded_at: null, update_available: false } : t
          ) ?? prev
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="library">
      <div className="panel library-grid-panel">
        <div className="library-panel-header">
          <h1>Library</h1>
          <span className="library-count">{templates ? `${visibleTemplates?.length} of ${templates.length} tests` : '…'}</span>
        </div>

        <div className="library-controls">
          <input
            className="library-search"
            placeholder="Search tests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="library-sort"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            {(Object.keys(SORT_LABEL) as SortMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABEL[mode]}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="library-empty">Could not reach the local node: {error}</div>}
        {templates === null && !error && <div className="library-empty">Loading…</div>}
        {templates && templates.length === 0 && (
          <div className="library-empty">No tests yet — write some over MCP.</div>
        )}
        {templates && templates.length > 0 && visibleTemplates?.length === 0 && (
          <div className="library-empty">No tests match "{search}".</div>
        )}

        <div className="library-grid">
          {visibleTemplates?.map((t, i) => (
            <button
              key={t.id}
              className={`library-card${t.id === selectedId ? ' selected' : ''}`}
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              onClick={() => setSelectedId((cur) => (cur === t.id ? null : t.id))}
              title="Click for details"
            >
              {t.downloaded && (
                <span
                  className={`library-card-downloaded${t.update_available ? ' update-available' : ''}`}
                  title={t.update_available ? 'Update available' : 'Downloaded'}
                >
                  {t.update_available ? <RefreshIcon size={11} /> : <DownloadIcon size={11} />}
                </span>
              )}
              <div className="library-card-name">{t.name}</div>
              <div className="library-card-meta">
                {t.question_count} question{t.question_count === 1 ? '' : 's'} · {formatBytes(t.estimated_bytes)}
              </div>
              <div className="library-card-date">{formatDate(t.created_at)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel library-detail-panel">
        {selected ? (
          <div className="library-detail-content" key={selected.id}>
            <div className="library-detail-header">
              <h2>{selected.name}</h2>
              <div className="library-detail-id">{selected.id}</div>
            </div>

            <div className="library-detail-text">{selected.description || 'No description yet.'}</div>

            <div className="library-detail-meta">
              {[
                `${selected.question_count} questions`,
                `calculator ${selected.calculator_policy === 'any' ? 'any' : selected.calculator_policy}`,
                selected.weighting,
                selected.mc_ratio !== null ? `${Math.round(selected.mc_ratio * 100)}% MC` : null,
                selected.difficulty_min !== null || selected.difficulty_max !== null
                  ? `difficulty ${selected.difficulty_min ?? 1}–${selected.difficulty_max ?? 5}`
                  : null,
                selected.time_limit_sec ? `${Math.round(selected.time_limit_sec / 60)} min limit` : null,
              ]
                .filter((v): v is string => !!v)
                .map((label, i) => (
                  <span className="library-detail-badge" key={label} style={{ animationDelay: `${i * 35}ms` }}>
                    {label}
                  </span>
                ))}
              {selected.frozen && (
                <span
                  className="library-detail-badge frozen"
                  style={{ animationDelay: '210ms' }}
                >
                  frozen
                </span>
              )}
            </div>

            <div className="library-detail-section">
              <div className="library-detail-label">Drawn from</div>
              <div className="library-detail-tags">
                {!selected.tag_query.all?.length && !selected.tag_query.any?.length ? (
                  <span className="library-detail-tag whole-bank">
                    <TagIcon size={11} />
                    whole bank
                  </span>
                ) : (
                  [...(selected.tag_query.all ?? []), ...(selected.tag_query.any ?? [])].map((slug, i) => (
                    <button
                      className="library-detail-tag clickable"
                      key={slug}
                      style={{ animationDelay: `${250 + i * 35}ms` }}
                      onDoubleClick={() => tagPopout.openTag(slug)}
                      title="Double-click to view this tag"
                    >
                      <TagIcon size={11} />
                      {slug}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="library-detail-body">
              <div className="library-detail-download-col">
                <div className="library-detail-label">On this device</div>
                <div className="library-detail-size">{formatBytes(selected.estimated_bytes)}</div>
                {selected.downloaded && selected.downloaded_at && (
                  <div className="library-detail-downloaded-at">
                    <ClockIcon size={10} /> downloaded {formatDate(selected.downloaded_at)}
                  </div>
                )}
                <div className="library-detail-download-spacer" />
                {/* Update and Delete are independent actions — deleting never
                    requires updating first, and once deleted there's nothing
                    local left to update, so the Update button disappears
                    along with the Delete button. */}
                {!isCanonical && selected.downloaded && selected.update_available && (
                  <button
                    className="library-detail-action update"
                    onClick={() => handleDownload(selected.id)}
                    disabled={busy}
                  >
                    <span className={busy ? 'spin' : undefined}>
                      <RefreshIcon size={13} />
                    </span>
                    Update
                  </button>
                )}
                {isCanonical ? (
                  <div className="library-detail-downloaded-at">whole bank held on this node</div>
                ) : selected.downloaded ? (
                  <button
                    className="library-detail-action delete"
                    onClick={() => handleDelete(selected.id)}
                    disabled={busy}
                  >
                    <TrashIcon size={13} />
                    Delete
                  </button>
                ) : (
                  <button
                    className="library-detail-action download"
                    onClick={() => handleDownload(selected.id)}
                    disabled={busy}
                  >
                    <DownloadIcon size={13} />
                    Download
                  </button>
                )}
              </div>

              <div className="library-detail-questions-col">
                <div className="library-detail-label">
                  Questions
                  {!selected.frozen && <span className="library-detail-label-hint">preview — redraws per attempt</span>}
                </div>
                <div className="library-detail-questions">
                  {questions === null && <div className="library-empty">Loading…</div>}
                  {questions?.map((q, i) => {
                    // Only meaningful once there's a prior download to compare
                    // against — a question added to the bank after that point
                    // is new material you haven't actually downloaded yet.
                    const isNew = !!selected.downloaded_at && q.created_at > selected.downloaded_at
                    return (
                      <div
                        className={`library-detail-question${isNew ? ' new' : ''}`}
                        key={q.id}
                        style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
                      >
                        <span className={`library-type-badge ${q.type}`}>{TYPE_LABEL[q.type]}</span>
                        <span className="library-detail-question-prompt">{q.prompt}</span>
                        {isNew && <span className="library-detail-question-new-badge">new</span>}
                      </div>
                    )
                  })}
                  {questions && questions.length === 0 && (
                    <div className="library-empty">No eligible questions match this template yet.</div>
                  )}
                </div>
              </div>
            </div>

            <button className="library-detail-start" onClick={() => onStart(selected.id)}>
              Start &rarr;
            </button>
          </div>
        ) : (
          <div className="library-detail-prompt">Select a test to see details</div>
        )}
      </div>

      {tagPopout.openSlug && tagPopout.tag && (
        <TagDetail
          key={tagPopout.tag.slug}
          tag={tagPopout.tag}
          allTags={tagPopout.tags}
          onClose={tagPopout.closeTag}
          onOpenTag={tagPopout.openTag}
        />
      )}

      {tagPopout.openSlug && !tagPopout.loading && !tagPopout.tag && (
        <div className="tag-detail-backdrop" onClick={tagPopout.closeTag}>
          <div className="tag-detail" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tag "{tagPopout.openSlug}" isn't in the bank.</div>
          </div>
        </div>
      )}
    </div>
  )
}
