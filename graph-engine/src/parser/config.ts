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
export type FeaturePointKind = 'intercepts' | 'vertices'

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
  points: Set<FeaturePointKind>
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
    asymptotes: true,
    hidden: new Set(),
    tableFormulas: false,
  }
}
