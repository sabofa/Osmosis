import type { StyleLayer } from '../style/resolve'

// Per-spec configuration, set via "@key: value" directive lines anywhere in
// the spec text (order doesn't matter; last value for a repeated key wins).
// Threaded from parseSpec -> GraphViewer -> the renderers/scene builders, so
// a test writer controls presentation without touching code.

import { defaultSpaceConfig, type Binding, type SpaceConfig } from '../space/config'
export interface GraphBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export type HoverMode = 'all' | 'points' | 'features' | 'none'

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

export const GIVENS_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'] as const

export type GivensPosition = (typeof GIVENS_POSITIONS)[number]

// The named viewpoints a solid can be drawn from. Mirrors figure/project3d.ts's
// ViewName; duplicated rather than imported so the parser stays standalone,
// exactly as GeometryExtent is in types.ts.
//
// A NAME, never a camera. Free orbit stays rejected — these are drawings — but
// one fixed direction is degenerate for a solid whose features line up with
// it, and a name preserves determinism while letting an author escape that.
export const VIEW_NAMES = ['standard', 'isometric', 'front', 'top', 'side'] as const

export type ViewName = (typeof VIEW_NAMES)[number]

export type LabelMode = 'all' | 'coarse' | 'none'
export type StepMode = 'nice' | 'geometric' | 'fixed'
export type AxisScale = 'linear' | 'log'

export interface GraphConfig {
  theme: 'light' | 'dark'
  hover: HoverMode
  xstep: number | null
  ystep: number | null
  bounds: GraphBounds | null
  grid: boolean
  axes: boolean
  angle: 'degrees' | 'radians'
  // Whether the figure is drawn to scale. False under "@scale: false", the
  // "figure not drawn to scale" flag, which suppresses the check an asserting
  // measure label performs (see figure/measure.ts). The flag and the
  // assertion are designed together: without the assertion the flag means
  // nothing, and without the flag a deliberately-not-to-scale figure could
  // not be authored at all.
  toScale: boolean
  // Where the boxed givens panel sits, when a spec states any givens. A
  // corner or a side of the composed figure — see figure/document.ts's
  // layoutGivensBox, which places it outside the drawing rather than over it.
  givens: GivensPosition
  // The givens table's own heading, from "@givens-title: <text>". Null when
  // the spec states none, which is the default: the table already labels its
  // sections ("Given", "Find"), so a title is what an author adds when the
  // box needs to say something else ("Problem 14", "Known").
  //
  // A directive rather than a statement because it is chrome, like the
  // position above: where the box sits and what it is called belong together,
  // and the rows stay "given:"/"find:" lines.
  givensTitle: string | null
  // Which renderer draws this spec. `figure` is the SVG figure renderer —
  // its own renderer, selected the way `table` already selects TableView,
  // not the plot renderer with its axes switched off.
  mode: 'graph' | 'figure' | 'table'
  // Whether the spec said `@mode:` itself. An explicit value always wins
  // over inference (see scene/mode.ts's resolveMode), so the two have to be
  // distinguishable — `mode: 'graph'` alone cannot say whether the author
  // asked for a graph or simply did not ask for anything.
  modeDeclared: boolean
  points: Set<FeatureKind>
  // Tick-label density, independent of `axes`. v1 drew labels only when axes
  // were on, so "a graph with no numbers" was only reachable as "a graph with
  // no axes" — which is not the same picture.
  labels: LabelMode
  // Label every nth gridline. 1 labels every line.
  labelEvery: number
  // How a fixed @xstep/@ystep rescales as the view zooms. See grid.ts.
  stepMode: StepMode
  // Per-axis scale, from "@xscale:" / "@yscale:". A log axis needs a positive
  // range (checked against @bounds in parseConfig).
  scales: { x: AxisScale; y: AxisScale }
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
  // Which named viewpoint a solid is drawn from, set by "@view:". The default
  // is "standard", a view in general position: exact isometric looks along a
  // cube's space diagonal and puts two of its corners on one point, so it is
  // kept by name but no longer the default (decided 2026-09-26).
  view: ViewName
  // Whether a table built from a "table: y = f(x) for ..." generator
  // statement (see scene/buildTable.ts) shows its generating formula
  // alongside the table. Off by default so an existing spec's table looks
  // the same until asked for; header/row-only tables have no formula to show
  // regardless of this setting.
  tableFormulas: boolean
  // The figure's own style layer, from its "@style…" directives (see
  // style/resolve.ts). A LAYER, not a resolved style: the renderer resolves
  // it over the host's base style (the viewer's theme, a document's pinned
  // look), and that base is not known here. Empty when the spec says nothing,
  // which draws clean — today's figure, byte for byte.
  style: StyleLayer
  // Space's own directives (@bounds3d, @camera, @ticks3d, ...; SP7), parsed by
  // space/grammar/directives.ts. @view above stays the solid-figure camera.
  space: SpaceConfig
  // The spec's @param bindings, in source order (SP6). Space-only for now:
  // the 2D renderer ignores bindings until track 4 adopts them.
  bindings: Binding[]
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
    toScale: true,
    givens: 'top-left',
    givensTitle: null,
    mode: 'graph',
    modeDeclared: false,
    points: new Set(),
    labels: 'all',
    labelEvery: 1,
    stepMode: 'nice',
    scales: { x: 'linear', y: 'linear' },
    pointLabels: 'off',
    asymptotes: true,
    hidden: new Set(),
    view: 'standard',
    tableFormulas: false,
    style: {},
    space: defaultSpaceConfig(),
    bindings: [],
  }
}
