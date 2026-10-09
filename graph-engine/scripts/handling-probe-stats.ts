// The pure side of the handling probe (scripts/handling-probe.ts): turns the
// requestAnimationFrame timestamps a page recorded into frame-time numbers.
// No DOM, no clock, so a node test reaches it.

export interface FrameSummary {
  // Number of frame intervals (timestamps - 1).
  frames: number
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
  // Intervals longer than 10 ms (a missed frame at 144 Hz), 20 ms and 50 ms.
  over10: number
  over20: number
  over50: number
  // Frames per second over the whole span (frames / seconds).
  fps: number
}

// Linear-interpolated percentile of an ascending array; q in [0, 1].
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// The gaps between consecutive timestamps (ms).
export function frameDeltas(timestamps: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < timestamps.length; i++) out.push(timestamps[i] - timestamps[i - 1])
  return out
}

export function summariseDeltas(deltas: readonly number[]): FrameSummary {
  if (deltas.length === 0) return { frames: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0, over10: 0, over20: 0, over50: 0, fps: 0 }
  const sorted = [...deltas].sort((a, b) => a - b)
  const total = deltas.reduce((a, b) => a + b, 0)
  return {
    frames: deltas.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: total / deltas.length,
    over10: deltas.filter((d) => d > 10).length,
    over20: deltas.filter((d) => d > 20).length,
    over50: deltas.filter((d) => d > 50).length,
    fps: total > 0 ? (deltas.length / total) * 1000 : 0,
  }
}

export function summariseFrames(timestamps: readonly number[]): FrameSummary {
  return summariseDeltas(frameDeltas(timestamps))
}

// Trace events (Chrome trace format) summed by name for one group of threads.
export interface TraceEvent {
  name: string
  ph: string
  ts: number
  dur?: number
  tid: number
  pid: number
  args?: Record<string, unknown>
}

// Total duration (ms) per event name for complete ('X') events inside [from, to] (trace µs).
export function sumByName(events: readonly TraceEvent[], from: number, to: number): Map<string, { ms: number; count: number }> {
  const out = new Map<string, { ms: number; count: number }>()
  for (const e of events) {
    if (e.ph !== 'X' || e.dur === undefined || e.ts < from || e.ts > to) continue
    const row = out.get(e.name) ?? { ms: 0, count: 0 }
    row.ms += e.dur / 1000
    row.count += 1
    out.set(e.name, row)
  }
  return out
}
