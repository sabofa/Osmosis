import type { AttemptSummary } from './api'

// Builds a real activity heatmap (cols x rows cells, oldest first, one cell
// per day) from actual submitted attempts — replaces the old mockHeatmap
// random-number generator. With zero attempts this legitimately returns all
// zeros, which the UI should render as an honest "no activity yet" state
// rather than being padded with fake data.
export function attemptsHeatmap(
  attempts: AttemptSummary[],
  cols: number,
  rows: number,
  filter?: (a: AttemptSummary) => boolean
): number[] {
  const days = cols * rows
  const counts = new Array<number>(days).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const relevant = filter ? attempts.filter(filter) : attempts
  for (const a of relevant) {
    if (!a.submitted_at) continue
    const submitted = new Date(a.submitted_at.endsWith('Z') ? a.submitted_at : `${a.submitted_at}Z`)
    submitted.setHours(0, 0, 0, 0)
    const dayIndex = Math.round((today.getTime() - submitted.getTime()) / 86400000)
    const cellFromEnd = days - 1 - dayIndex
    if (cellFromEnd >= 0 && cellFromEnd < days) counts[cellFromEnd]++
  }

  // Map raw attempt counts for a day to a 0-4 activity level, same visual
  // scale the old mock heatmap used.
  return counts.map((c) => (c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4))
}
