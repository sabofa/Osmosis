import { useEffect, useMemo, useState } from 'react'
import { getResultsDaily, getResultsTags, listAttempts, timeAgo, attemptSourceLabel, type AttemptSummary, type DailyResultStat, type TagResultStat } from '../lib/api'
import { attemptsHeatmap } from '../lib/activity'
import Heatmap from './Heatmap'
import './Results.css'

const HEAT_WEEKS = 10
const HEAT_DAYS = 7
const RECENT_ATTEMPTS = 20

// draw_date is a bare 'YYYY-MM-DD' calendar date computed in the server's
// daily_timezone -- NOT a UTC timestamp. Format it directly from its parts
// (using the local Date constructor, which does not UTC-shift) rather than
// routing it through timeAgo, which would misinterpret it as UTC midnight.
function formatDrawDate(drawDate: string): string {
  const [y, m, day] = drawDate.split('-').map(Number)
  if (!y || !m || !day) return drawDate
  const date = new Date(y, m - 1, day)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Results() {
  const [tags, setTags] = useState<TagResultStat[] | null>(null)
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [daily, setDaily] = useState<DailyResultStat[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    getResultsTags({ limit: 100 })
      .then((r) => {
        setTags(r.tags)
        if (r.tags.length > 0) setSelected(r.tags[0].tag_slug)
      })
      .catch((err) => setError(String(err)))
    listAttempts({ limit: 500 })
      .then((r) => setAttempts(r.attempts))
      .catch(() => {
        /* heatmap just shows all-zero activity if this fails; not fatal */
      })
    getResultsDaily(30)
      .then((r) => setDaily(r.daily))
      .catch(() => {
        /* daily history panel just shows empty state if this fails; not fatal */
      })
  }, [])

  const subject = tags?.find((t) => t.tag_slug === selected) ?? tags?.[0] ?? null
  const heat = useMemo(() => attemptsHeatmap(attempts, HEAT_WEEKS, HEAT_DAYS), [attempts])

  return (
    <div className="results">
      {error && <div style={{ padding: 8, fontSize: 12, color: 'var(--bad, #d33)' }}>Could not reach the local node: {error}</div>}
      {tags !== null && tags.length === 0 && !error && (
        <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)' }}>
          No results yet — take an attempt to start building your stats.
        </div>
      )}
      <div className="results-grid">
        <div className="results-hero">
          {subject ? (
            <>
              <div className="results-hero-top">
                <h1>{subject.tag_slug}</h1>
                <span className="results-hero-score">{subject.mean_score === null ? '—' : subject.mean_score.toFixed(2)}</span>
              </div>
              <div className="results-hero-stats">
                <div className="results-stat">
                  <div className="results-stat-value">{subject.responses}</div>
                  <div className="results-stat-label">responses</div>
                </div>
                <div className="results-stat">
                  <div className="results-stat-value">{subject.misses}</div>
                  <div className="results-stat-label">misses</div>
                </div>
                <div className="results-stat">
                  <div className="results-stat-value">
                    {subject.trend_30d === null ? '—' : `${subject.trend_30d >= 0 ? '+' : ''}${(subject.trend_30d * 100).toFixed(0)}%`}
                  </div>
                  <div className="results-stat-label">30-day trend</div>
                </div>
                <div className="results-stat">
                  <div className="results-stat-value" style={{ fontSize: 14 }}>
                    {timeAgo(subject.last_seen)}
                  </div>
                  <div className="results-stat-label">last seen</div>
                </div>
              </div>

            </>
          ) : (
            <div style={{ margin: 'auto', color: 'var(--muted)', fontSize: 13 }}>
              {tags === null ? 'Loading…' : 'No tag results yet.'}
            </div>
          )}
        </div>

        <div className="results-side">
          <div className="results-panel results-subjects">
            <div className="results-kicker">All tags, worst first</div>
            <div className="results-subject-list no-scrollbar">
              {(tags ?? []).map((t) => (
                <button
                  key={t.tag_slug}
                  className={`results-subject-row${t.tag_slug === selected ? ' selected' : ''}${t.mean_score !== null && t.mean_score < 0.5 ? ' weak' : ''}`}
                  onClick={() => setSelected(t.tag_slug)}
                >
                  <span className="results-subject-name">{t.tag_slug}</span>
                  <span className="results-subject-score">{t.mean_score === null ? '—' : t.mean_score.toFixed(2)}</span>
                </button>
              ))}
              {tags !== null && tags.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>No results yet.</div>
              )}
            </div>
          </div>

          <div className="results-panel results-daily-panel">
            <div className="results-kicker">Daily history</div>
            <div className="results-daily-list no-scrollbar">
              {(daily ?? []).map((d) => {
                const graded = d.completed && d.score !== null
                return (
                  <div key={`${d.draw_date}-${d.kind}`} className="results-daily-row">
                    <span className="results-daily-date">{formatDrawDate(d.draw_date)}</span>
                    <span className={`results-daily-kind-badge ${d.kind}`}>{d.kind === 'quiz' ? 'quiz' : 'question'}</span>
                    <span className={`results-daily-score${graded ? '' : ' incomplete'}`}>
                      {graded ? d.score!.toFixed(2) : 'not completed'}
                    </span>
                  </div>
                )
              })}
              {daily !== null && daily.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>No daily history yet.</div>
              )}
            </div>
          </div>

          <div className="results-panel results-daily-panel results-recent-panel">
            <div className="results-kicker">Recent attempts</div>
            <div className="results-daily-list no-scrollbar">
              {attempts.slice(0, RECENT_ATTEMPTS).map((a) => {
                const source = attemptSourceLabel(a.source_kind)
                return (
                  <div key={a.id} className="results-daily-row">
                    <span className="results-daily-date">
                      {a.template_name ?? (a.source === 'adhoc' ? 'Live item' : 'Attempt')}
                    </span>
                    {/* Only the tutor-driven side is marked: an attempt Ben
                        started himself is the unmarked default. */}
                    {source && <span className="results-daily-kind-badge tutor">{source}</span>}
                    <span className={`results-daily-score${a.submitted_at ? '' : ' incomplete'}`}>
                      {a.submitted_at
                        ? a.mean_score === null
                          ? 'ungraded'
                          : a.mean_score.toFixed(2)
                        : a.abandoned_at
                          ? 'abandoned'
                          : 'in progress'}
                    </span>
                  </div>
                )
              })}
              {attempts.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>No attempts yet.</div>
              )}
            </div>
          </div>

          <div className="results-panel results-heatmap-panel">
            <div className="results-kicker">Activity, {HEAT_WEEKS} weeks</div>
            <div className="results-heatmap-fill">
              <Heatmap levels={heat} weeks={HEAT_WEEKS} days={HEAT_DAYS} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
