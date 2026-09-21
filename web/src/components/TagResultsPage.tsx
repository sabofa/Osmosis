import { useEffect, useMemo, useState } from 'react'
import { getTagHistory, timeAgo, type TagHistory } from '../lib/api'
import { historySpec } from '../lib/resultsGraph'
import GraphPanel from './GraphPanel'
import './ResultsPages.css'

const WINDOWS = [30, 90, 365] as const

// One tag in full: its stats and children on the left, its score over time
// on the right, drawn by the graph engine. Opened by double-clicking a row
// on the results page; a child row opens the same page for that child.
export default function TagResultsPage({
  slug,
  onBack,
  onOpenTag,
}: {
  slug: string
  onBack: () => void
  onOpenTag: (slug: string) => void
}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90)
  const [history, setHistory] = useState<TagHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHistory(null)
    setError(null)
    getTagHistory(slug, days)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [slug, days])

  const spec = useMemo(() => (history ? historySpec(history.points, { days }) : null), [history, days])
  const crumbs = slug.split(':')

  return (
    <div className="results-page">
      <div className="results-page-header">
        <button className="results-back-btn" onClick={onBack}>
          &larr; Results
        </button>
        <div className="results-crumbs">
          {crumbs.map((part, i) => {
            const target = crumbs.slice(0, i + 1).join(':')
            const last = i === crumbs.length - 1
            return (
              <span key={target} className="results-crumb-wrap">
                {i > 0 && <span className="results-crumb-sep">:</span>}
                {last ? (
                  <span className="results-crumb current">{part}</span>
                ) : (
                  <button className="results-crumb" onClick={() => onOpenTag(target)}>
                    {part}
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <div className="results-window">
          {WINDOWS.map((w) => (
            <button key={w} className={`results-window-btn${days === w ? ' active' : ''}`} onClick={() => setDays(w)}>
              {w === 365 ? '1y' : `${w}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="results-page-body">
        <div className="panel results-page-info">
          {error && <div className="results-page-empty">Could not load: {error}</div>}
          {!history && !error && <div className="results-page-empty">Loading…</div>}
          {history && (
            <>
              <div className="results-page-title">{history.tag.label}</div>
              {history.tag.description && <div className="results-page-desc">{history.tag.description}</div>}
              <div className="results-page-score">
                {history.overall.mean_score === null ? '—' : history.overall.mean_score.toFixed(2)}
              </div>
              <div className="results-page-stats">
                <Stat value={history.overall.responses} label="responses" />
                <Stat value={history.overall.graded} label="graded" />
                <Stat value={history.overall.misses} label="misses" />
                <Stat value={history.overall.last_seen ? timeAgo(history.overall.last_seen) : '—'} label="last seen" small />
              </div>

              <div className="results-kicker" style={{ marginTop: 18 }}>
                {history.children.length ? 'Inside this tag, worst first' : 'No child tags'}
              </div>
              <div className="results-children no-scrollbar">
                {history.children.map((c) => (
                  <button
                    key={c.tag_slug}
                    className={`results-subject-row${c.mean_score !== null && c.mean_score < 0.5 ? ' weak' : ''}`}
                    onClick={() => onOpenTag(c.tag_slug)}
                    title="Open this tag"
                  >
                    <span className="results-subject-name">{c.label}</span>
                    <span className="results-child-meta">{c.responses} · {c.misses} missed</span>
                    <span className="results-subject-score">{c.mean_score === null ? '—' : c.mean_score.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel results-page-graph">
          <div className="results-kicker">
            Score by day, last {days === 365 ? 'year' : `${days} days`}
            {history && history.points.length === 0 && ' — nothing practised in this window'}
          </div>
          <div className="results-page-graph-fill">{spec && <GraphPanel spec={spec} />}</div>
          <div className="results-page-graph-foot">x: days before today · y: mean score that day</div>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, small }: { value: string | number; label: string; small?: boolean }) {
  return (
    <div className="results-stat">
      <div className="results-stat-value" style={small ? { fontSize: 14 } : undefined}>
        {value}
      </div>
      <div className="results-stat-label">{label}</div>
    </div>
  )
}
