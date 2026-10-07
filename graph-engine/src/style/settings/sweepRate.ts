// Rating the settings sweep (sweepTypes.ts): how a setting's measured change becomes a word, where
// most of the change happens, and where it is safe to drag. Pure, and read by tools/settings-sweep.mts.

import type { SweepMeasure, SweepRating } from './sweepTypes'

// Upper edges of none, subtle and moderate; at or above the last is strong.
const EDGES: Record<SweepMeasure, readonly [number, number, number]> = {
  colour: [0.005, 0.02, 0.06], // OKLab ΔE
  geometry: [0.1, 0.75, 2.5], // px
}

const NEGLIGIBLE = 1e-9

export function rate(measure: SweepMeasure, maxMeanChange: number): Exclude<SweepRating, 'not-drawn-yet'> {
  const [none, subtle, moderate] = EDGES[measure]
  if (maxMeanChange < none) return 'none'
  if (maxMeanChange < subtle) return 'subtle'
  if (maxMeanChange < moderate) return 'moderate'
  return 'strong'
}

// The change added between each pair of neighbouring values.
function steps(change: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < change.length; i++) out.push(Math.abs(change[i + 1] - change[i]))
  return out
}

// The smallest run of neighbouring values holding at least 80% of the cumulative change (the sum of the step
// increments); the earliest such run on a tie. null when nothing moves.
export function activeRange<T>(values: readonly T[], change: readonly number[]): [T, T] | null {
  const inc = steps(change)
  const total = inc.reduce((a, b) => a + b, 0)
  if (inc.length === 0 || total < NEGLIGIBLE) return null
  const need = 0.8 * total - NEGLIGIBLE * total
  let best: [number, number] | null = null
  for (let start = 0; start < inc.length; start++) {
    let sum = 0
    for (let end = start; end < inc.length; end++) {
      sum += inc[end]
      if (sum >= need) {
        if (best === null || end - start < best[1] - best[0]) best = [start, end]
        break
      }
    }
  }
  return best === null ? null : [values[best[0]], values[best[1] + 1]]
}

// The last two steps add less than 5% of the total change.
export function saturates(change: readonly number[]): boolean {
  const inc = steps(change)
  const total = inc.reduce((a, b) => a + b, 0)
  if (inc.length < 3 || total < NEGLIGIBLE) return false
  return inc[inc.length - 1] + inc[inc.length - 2] < 0.05 * total
}

// The active range widened by one step each side, clamped to the values.
export function safeRange<T>(values: readonly T[], active: [T, T] | null): [T, T] | null {
  if (active === null || values.length === 0) return null
  const lo = Math.max(0, values.indexOf(active[0]) - 1)
  const hi = Math.min(values.length - 1, values.lastIndexOf(active[1]) + 1)
  return [values[lo], values[hi]]
}
