import { useEffect, useState } from 'react'

// The results "bar": a 0–1 axis with the mean score marked on it. Fixed
// height, width from the container — the height never feeds back into the
// container's size, which is what made the earlier flex-sized version grow
// without bound in portrait. The graph-engine history plot returns as a
// later project.
const PAD_LEFT = 38
const PAD_RIGHT = 10
const PAD_TOP = 10
const PAD_BOTTOM = 24
const H = 110
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1]

export default function ScoreBar({ score }: { score: number | null }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(340)

  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width
      if (width > 0) setW(width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  const innerW = Math.max(1, w - PAD_LEFT - PAD_RIGHT)
  const barY = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) / 2
  const barX = (v: number) => PAD_LEFT + v * innerW
  const value = score ?? 0

  return (
    <div className="score-bar" ref={setEl} style={{ height: H, width: '100%' }}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
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
        <line x1={PAD_LEFT} x2={w - PAD_RIGHT} y1={barY} y2={barY} stroke="var(--line)" strokeWidth={1} />
        {score !== null && (
          <>
            <line
              x1={barX(0)}
              x2={barX(value)}
              y1={barY}
              y2={barY}
              stroke="var(--accent)"
              strokeWidth={6}
              strokeLinecap="round"
            />
            <circle cx={barX(value)} cy={barY} r={5} fill="var(--accent)" />
          </>
        )}
      </svg>
    </div>
  )
}
