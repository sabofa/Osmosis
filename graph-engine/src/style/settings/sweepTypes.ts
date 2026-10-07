// The settings sweep's file (docs/styles/sweep.json): how much each registry setting moves the
// picture, measured by tools/settings-sweep.mts and read by the guide builder (guideDocs.ts).
// Entries are sorted by path. The file holds no timing, so the same code gives the same file.

export type SweepEngine = 'paint' | 'figures' | 'media' | 'backgrounds'

// What the change is measured in: colour (OKLab ΔE), geometry (px of path-point displacement, stroke width or
// length) or structure (a share: the change in how many strokes there are, or in the edge classes' shares). A
// paint entry's measure is the one of its dimensions that rates strongest (the others are in `detail`).
export type SweepMeasure = 'colour' | 'geometry' | 'structure'

// 'render-only' for a setting only the renderer's shader reads: its measured numbers stay, but the sweep's per-frame
// model cannot rate it. 'not-drawn-yet' for a setting whose meaning says "Not drawn yet:" (registered, wired to nothing).
export type SweepRating = 'none' | 'subtle' | 'moderate' | 'strong' | 'not-drawn-yet' | 'render-only'

export interface SweepEntry {
  path: string
  engine: SweepEngine
  measure: SweepMeasure
  // The values swept, in order: 9 evenly spaced for a number; the allowed values for an integer
  // or a choice when there are fewer; the 3 shapes ('identity', 'raised', 'lowered') for a curve.
  values: (number | string)[]
  // The change against the default at each value, in the measure's unit (the headline metric).
  change: number[]
  rating: SweepRating
  // The smallest sub-range of `values` holding 80% of the cumulative change; null when nothing moves.
  activeRange: [number | string, number | string] | null
  // The last two steps add less than 5% of the change.
  saturates: boolean
  // The other metrics, per engine (p95 ΔE, stroke-count ratio, element-count ratio, L sd change ...).
  detail: Record<string, number[]>
}

export interface SweepFile {
  header: {
    // The fixtures each engine was measured on (e.g. paint: ['sphere-on-table'], figures: three example names).
    fixtures: Record<string, string[]>
    themes: string[]
    steps: number
    note: string
  }
  entries: SweepEntry[]
}
