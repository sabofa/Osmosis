// A tag's score over time as a graph-engine spec: one point per day the tag
// was practised, joined by segments, x = days before today (0 is today),
// y = the day's mean score. The frame is held fixed so a redraw with one more
// day does not jump.

export interface HistoryPoint {
  date: string // YYYY-MM-DD
  mean_score: number
  responses: number
}

const MS_PER_DAY = 86_400_000

export function daysAgo(date: string, today: Date): number {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((now - t) / MS_PER_DAY)
}

export function historySpec(points: HistoryPoint[], opts: { days?: number; today?: Date } = {}): string {
  const today = opts.today ?? new Date()
  const days = opts.days ?? 90
  const xs = points
    .map((p) => ({ x: -daysAgo(p.date, today), y: Math.round(p.mean_score * 100) / 100, n: p.responses }))
    .filter((p) => p.x >= -days && p.x <= 0)
    .sort((a, b) => a.x - b.x)
  // The window starts a little before the first point (or the full range
  // when there is one), and always ends today.
  const xMin = xs.length ? Math.min(-7, xs[0].x - 2) : -days
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
