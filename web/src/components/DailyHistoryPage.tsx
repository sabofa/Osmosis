import { useEffect, useState } from 'react'
import { getDailyDayDetail, type DailyDayDetail, type DailyResultStat } from '../lib/api'
import RichText from './RichText'
import './ResultsPages.css'

const OUTCOME_LABEL: Record<string, string> = {
  correct: 'correct',
  partial: 'partial',
  incorrect: 'incorrect',
  dont_know: "didn't know",
  ungraded: 'ungraded',
}

function formatDrawDate(drawDate: string): string {
  const [y, m, d] = drawDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Every day of daily history on the left, one day in detail on the right:
// what was asked, what was answered, and which tags moved.
export default function DailyHistoryPage({
  history,
  initialDate,
  onBack,
  onOpenTag,
}: {
  history: DailyResultStat[]
  initialDate: string
  onBack: () => void
  onOpenTag: (slug: string) => void
}) {
  const [date, setDate] = useState(initialDate)
  const [detail, setDetail] = useState<DailyDayDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One row per day; the list from the results page has one per draw.
  const days = [...new Set(history.map((h) => h.draw_date))]

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    getDailyDayDetail(date)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [date])

  return (
    <div className="results-page">
      <div className="results-page-header">
        <button className="results-back-btn" onClick={onBack}>
          &larr; Results
        </button>
        <div className="results-page-heading">Daily history</div>
      </div>

      <div className="results-page-body daily">
        <div className="panel results-page-list">
          <div className="results-kicker">Every day</div>
          <div className="results-daily-list no-scrollbar">
            {days.map((d) => {
              const draws = history.filter((h) => h.draw_date === d)
              return (
                <button
                  key={d}
                  className={`results-day-row${d === date ? ' selected' : ''}`}
                  onClick={() => setDate(d)}
                >
                  <span className="results-daily-date">{formatDrawDate(d)}</span>
                  <span className="results-day-scores">
                    {draws.map((x) => (
                      <span key={x.kind} className={`results-daily-kind-badge ${x.kind}`}>
                        {x.kind === 'quiz' ? 'quiz' : 'q'} {x.completed && x.score !== null ? x.score.toFixed(2) : '—'}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
            {days.length === 0 && <div className="results-page-empty">No daily history yet.</div>}
          </div>
        </div>

        <div className="panel results-page-detail no-scrollbar">
          {error && <div className="results-page-empty">Could not load: {error}</div>}
          {!detail && !error && <div className="results-page-empty">Loading…</div>}
          {detail && (
            <>
              <div className="results-page-title">{formatDrawDate(detail.draw_date)}</div>

              {detail.tags_touched.length > 0 && (
                <>
                  <div className="results-kicker">Tags touched that day</div>
                  <div className="results-touched">
                    {detail.tags_touched.map((t) => {
                      const delta =
                        t.day_mean !== null && t.overall_mean !== null ? t.day_mean - t.overall_mean : null
                      return (
                        <button key={t.tag_slug} className="results-touched-row" onClick={() => onOpenTag(t.tag_slug)}>
                          <span className="results-subject-name">{t.tag_slug}</span>
                          <span className="results-child-meta">
                            {t.responses} {t.responses === 1 ? 'item' : 'items'}
                          </span>
                          <span className="results-subject-score">
                            {t.day_mean === null ? '—' : t.day_mean.toFixed(2)}
                            {delta !== null && (
                              <span className={`results-delta${delta >= 0 ? ' up' : ' down'}`}>
                                {delta >= 0 ? '+' : ''}
                                {delta.toFixed(2)} vs usual
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {detail.draws.map((draw) => (
                <div key={draw.kind} className="results-draw">
                  <div className="results-draw-head">
                    <span className={`results-daily-kind-badge ${draw.kind}`}>{draw.kind}</span>
                    <span className="results-draw-score">
                      {draw.attempt_id === null
                        ? 'not completed'
                        : draw.mean_score === null
                          ? 'ungraded'
                          : draw.mean_score.toFixed(2)}
                    </span>
                  </div>
                  {draw.responses.map((r, i) => (
                    <div key={r.question_id} className={`results-q ${r.outcome}`}>
                      <div className="results-q-top">
                        <span className="results-q-n">{i + 1}</span>
                        <span className={`results-q-outcome ${r.outcome}`}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</span>
                        <span className="results-q-tags">{r.tags.join(' · ')}</span>
                      </div>
                      <RichText className="results-q-prompt" text={r.prompt} />
                      <div className="results-q-answers">
                        <div>
                          <span className="results-q-label">You</span>
                          <RichText inline text={r.answer || '(blank)'} />
                        </div>
                        {r.correct_answer && r.outcome !== 'correct' && (
                          <div>
                            <span className="results-q-label">Key</span>
                            <RichText inline text={r.correct_answer} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
