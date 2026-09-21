// A tag's score over time as a graph-engine spec: one point per submitted
// attempt, joined by segments, x = days before now (0 is now, fractional
// within a day), y = that attempt's mean score on the tag. The frame is
// held fixed so a redraw with one more attempt does not jump.

export interface HistoryPoint {
  at: string // 'YYYY-MM-DD HH:MM:SS' (UTC, as SQLite stores it) or ISO
  mean_score: number
  responses: number
}

const MS_PER_DAY = 86_400_000

// Days between `at` and `now`, fractional; positive when `at` is in the past.
export function daysAgo(at: string, now: Date): number {
  const hasZone = /Z$/.test(at) || /[+-]\d\d:\d\d$/.test(at)
  const iso = hasZone ? at : at.replace(' ', 'T') + 'Z'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return (now.getTime() - t) / MS_PER_DAY
}

export function historySpec(points: HistoryPoint[], opts: { days?: number; now?: Date } = {}): string {
  const now = opts.now ?? new Date()
  const days = opts.days ?? 90
  const xs = points
    .map((p) => ({ x: -Math.round(daysAgo(p.at, now) * 1000) / 1000, y: Math.round(p.mean_score * 100) / 100 }))
    .filter((p) => p.x >= -days && p.x <= 0)
    .sort((a, b) => a.x - b.x)
  // The window starts a little before the first point (or the full range
  // when there is none), and always ends now.
  const xMin = xs.length ? Math.min(-7, Math.floor(xs[0].x) - 2) : -days
  const lines: string[] = [
    `@bounds: ${xMin},1,-0.05,1.05`,
    `@xstep: ${xMin <= -60 ? 14 : xMin <= -21 ? 7 : 1}`,
    `@ystep: 0.25`,
    `@hover: points`,
  ]
  for (let i = 1; i < xs.length; i++) {
    lines.push(`(${xs[i - 1].x},${xs[i - 1].y}) -- (${xs[i].x},${xs[i].y})`)
  }
  for (const p of xs) lines.push(`(${p.x},${p.y})`)
  return lines.join('\n')
}
