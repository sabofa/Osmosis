import { useEffect, useMemo, useState } from 'react'
import { getResultsTags, listAttempts, timeAgo, type AttemptSummary, type TagResultStat } from '../lib/api'
import { attemptsHeatmap } from '../lib/activity'
import Heatmap from './Heatmap'
import './Results.css'

const PAD_LEFT = 38
const PAD_RIGHT = 10
const PAD_TOP = 10
const PAD_BOTTOM = 24
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1]
const HEAT_WEEKS = 10
const HEAT_DAYS = 7

export default function Results() {
  const [tags, setTags] = useState<TagResultStat[] | null>(null)
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [chartEl, setChartEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 340, h: 140 })

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
  }, [])

  useEffect(() => {
    if (!chartEl) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    ro.observe(chartEl)
    return () => ro.disconnect()
  }, [chartEl])

  const subject = tags?.find((t) => t.tag_slug === selected) ?? tags?.[0] ?? null
  const heat = useMemo(() => attemptsHeatmap(attempts, HEAT_WEEKS, HEAT_DAYS), [attempts])

  const { w: W, h: H } = size
  const innerW = Math.max(1, W - PAD_LEFT - PAD_RIGHT)
  const innerH = Math.max(1, H - PAD_TOP - PAD_BOTTOM)
  const barY = PAD_TOP + innerH / 2
  const barX = (v: number) => PAD_LEFT + v * innerW

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
                <span className="results-hero-score">{subject.mean_score.toFixed(2)}</span>
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

              <div className="results-hero-chart" ref={setChartEl}>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                  {Y_TICKS.map((tick) => (
                    <g key={tick}>
                      <line
                        x1={barX(tick)}
                        x2={barX(tick)}
                        y1={PAD_TOP}
                        y2={H - PAD_BOTTOM}
                        stroke="var(--line)"
                        strokeWidth={1}
                        strokeDasharray={tick === 0 ? undefined : '3 3'}
                      />
                      <text x={barX(tick)} y={H - PAD_BOTTOM + 14} className="chart-axis-label" textAnchor="middle">
                        {tick.toFixed(2)}
                      </text>
                    </g>
                  ))}
                  <line x1={PAD_LEFT} x2={W - PAD_RIGHT} y1={barY} y2={barY} stroke="var(--line)" strokeWidth={1} />
                  <line
                    x1={barX(0)}
                    x2={barX(subject.mean_score)}
                    y1={barY}
                    y2={barY}
                    stroke="var(--accent)"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <circle cx={barX(subject.mean_score)} cy={barY} r={5} fill="var(--accent)" />
                </svg>
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
                  className={`results-subject-row${t.tag_slug === selected ? ' selected' : ''}${t.mean_score < 0.5 ? ' weak' : ''}`}
                  onClick={() => setSelected(t.tag_slug)}
                >
                  <span className="results-subject-name">{t.tag_slug}</span>
                  <span className="results-subject-score">{t.mean_score.toFixed(2)}</span>
                </button>
              ))}
              {tags !== null && tags.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>No results yet.</div>
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
