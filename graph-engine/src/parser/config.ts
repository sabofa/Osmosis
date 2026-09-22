// Per-spec configuration, set via "@key: value" directive lines anywhere in
// the spec text (order doesn't matter; last value for a repeated key wins).
// Threaded from parseSpec -> GraphViewer -> the renderers/scene builders, so
// a test writer controls presentation without touching code.
export interface GraphBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export type HoverMode = 'all' | 'points' | 'none'

// A detected feature carries which kind of feature it is, so the renderer can
// mark an x-intercept differently from a local maximum. v1 emitted every
// feature as an identical unlabeled dot, which is why "@points: intercepts"
// and "@points: vertices" looked like the same setting.
export type FeatureKind =
  | 'x-intercept'
  | 'y-intercept'
  | 'local-max'
  | 'local-min'
  | 'inflection'
  | 'center'
  | 'focus'
  | 'conic-vertex'
  | 'intersection'

// Back-compat alias: v1's name for the config value. Kept so existing imports
// and stored specs keep working.
export type FeaturePointKind = FeatureKind

export type LabelMode = 'all' | 'coarse' | 'none'
export type StepMode = 'nice' | 'geometric' | 'fixed'

export interface GraphConfig {
  theme: 'light' | 'dark'
  hover: HoverMode
  xstep: number | null
  ystep: number | null
  bounds: GraphBounds | null
  grid: boolean
  axes: boolean
  angle: 'degrees' | 'radians'
  mode: 'graph' | 'table'
  points: Set<FeatureKind>
  // Tick-label density, independent of `axes`. v1 drew labels only when axes
  // were on, so "a graph with no numbers" was only reachable as "a graph with
  // no axes" — which is not the same picture.
  labels: LabelMode
  // Label every nth gridline. 1 labels every line.
  labelEvery: number
  // How a fixed @xstep/@ystep rescales as the view zooms. See grid.ts.
  stepMode: StepMode
  // Whether a detected feature point prints its coordinates.
  pointLabels: 'off' | 'coords'
  // Dashed vertical guide at a detected vertical asymptote. Splitting the
  // curve there (so it doesn't draw a fake near-vertical connector line
  // across the discontinuity) always happens — this only toggles the guide line.
  asymptotes: boolean
  // Names hidden via "@hide: <name>" — see parser/types.ts's Statement.name
  // and buildScene.ts. "@show: <name>" removes a name from this set, so a
  // later directive always wins for that specific name regardless of order
  // (same "last value wins" spirit as every other directive here, just
  // per-name instead of a single scalar). A name can belong to a plotted
  // statement or a named table; hiding either just skips rendering it —
  // function/constant *definitions* are always collected and stay usable in
  // other statements' expressions regardless of hidden state.
  hidden: Set<string>
  // Whether a table built from a "table: y = f(x) for ..." generator
  // statement (see scene/buildTable.ts) shows its generating formula
  // alongside the table. Off by default so an existing spec's table looks
  // the same until asked for; header/row-only tables have no formula to show
  // regardless of this setting.
  tableFormulas: boolean
}

export function defaultConfig(): GraphConfig {
  return {
    theme: 'light',
    hover: 'all',
    xstep: null,
    ystep: null,
    bounds: null,
    grid: true,
    axes: true,
    angle: 'radians',
    mode: 'graph',
    points: new Set(),
    labels: 'all',
    labelEvery: 1,
    stepMode: 'nice',
    pointLabels: 'off',
    asymptotes: true,
    hidden: new Set(),
    tableFormulas: false,
  }
}
