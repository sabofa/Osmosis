import type { GraphConfig } from '../parser/config'
import type { Statement } from '../parser/types'

// A spec is rendered in 3D as soon as any statement has depth to it — an
// explicit/parametric surface, or a z component on a point/segment/ray/curve.
// Everything else (2D-shaped statements) still plots fine inside a 3D scene,
// lifted onto the z=0 plane, so mixed specs "just work".
export function isThreeD(statements: Statement[]): boolean {
  return statements.some((s) => {
    // Every space form routes the spec to space (track 3, SP9).
    if (s.kind === 'space') return true
    if (s.kind === 'surface' || s.kind === 'parametricSurface') return true
    if (s.kind === 'point') return s.z !== null
    if (s.kind === 'segment' || s.kind === 'ray') return s.z1 !== null || s.z2 !== null
    if (s.kind === 'parametric') return s.fz !== null
    return false
  })
}

// ---------------------------------------------------------------------------
// E5 — which renderer draws this spec
// ---------------------------------------------------------------------------

export type RenderMode = 'graph' | 'figure' | 'table'

// Statement kinds that plot a *function* — anything sampled over a domain,
// or read off data. One of these anywhere in the spec means the picture needs
// axes, so it is a graph even if the rest of the spec is pure geometry.
const PLOTTED: ReadonlySet<Statement['kind']> = new Set([
  'explicit',
  'implicit',
  'polar',
  'parametric',
  'parametricSurface',
  'surface',
  'region',
  'regionChain',
  'field',
  'scatter',
  'tangent',
  'animatedPoint',
  // Space's forms (track 3): definitions and surfaces over domains plot on
  // axes, as z = f always has.
  'space',
])

// Whether a statement plots a function (see PLOTTED). The figure renderer
// asks this to refuse a plot legibly in a solid figure rather than drop it.
export function isPlotted(kind: Statement['kind']): boolean {
  return PLOTTED.has(kind)
}

// Whether a statement exists only in a solid figure (see SOLID_FIGURE, S5).
export function isSolidFigureStatement(kind: Statement['kind']): boolean {
  return SOLID_FIGURE.has(kind)
}

// Statement kinds that draw *geometry* — shapes on paper, with no domain
// behind them.
const GEOMETRY: ReadonlySet<Statement['kind']> = new Set([
  'point',
  'segment',
  'ray',
  'vector',
  'circle',
  'polygon',
  'triangle',
  'construction',
  'namedSegment',
  'angle',
  'tick',
  'rightAngle',
  // The circle vocabulary: an arc, a sector, a circular segment and the two
  // angle marks are geometry as much as a polygon is.
  'circleShape',
  'centralAngle',
  'inscribedAngle',
  // A measure label draws nothing on its own, but a spec that is nothing but
  // labels is still a figure rather than a graph.
  'measureLabel',
  'given',
  // A solid is 3D geometry PROJECTED onto paper, not a 3D scene: it is drawn
  // by the figure renderer through a fixed camera, with no axes and no orbit.
  // So it infers `figure`, exactly as a polygon does — and it must not reach
  // isThreeD, which routes real depth to the plot renderer.
  'solid',
  // A cross-section is a plane figure either way: shaded on the projected
  // solid, or lifted out as ordinary 2D geometry.
  'crossSection',
  // A named plane (phase 8) draws nothing, but it exists only among points
  // in space, so it belongs to a solid figure.
  'planeDef',
  // A dihedral angle's mark (phase 10) exists only among points in space.
  'dihedral',
  // A net (phase 11) is a solid unfolded flat: a plane figure of a solid.
  'net',
  // A shortest path over a solid's surface (phase 11) runs between points in
  // space on a solid.
  'shortestPath',
  // A shaded region (phase 12) is plane geometry: drawn only by the figure
  // renderer.
  'fill',
])

// The statements that exist only in a solid figure. Either one settles the
// renderer on its own (S5).
const SOLID_FIGURE: ReadonlySet<Statement['kind']> = new Set(['solid', 'crossSection', 'planeDef', 'dihedral', 'net', 'shortestPath'])

// Which renderer a spec gets.
//
// **An explicit `@mode` always wins, and declaring it is the house rule.**
// Inference is a safety net, not the recommended path, and the reason is
// concrete: under inference alone, adding one plotted function to a figure
// silently changes the whole presentation from paper to plot. A spec that
// declares its mode cannot be surprised by its own content — which includes
// `@mode: graph`, the escape hatch that gives a stored v1 geometry question
// back the presentation it has today.
export function resolveMode(statements: Statement[], config: GraphConfig): RenderMode {
  if (config.modeDeclared) return config.mode

  // S5 — a solid means a solid figure, and this comes BEFORE the depth check
  // below. A solid figure's points have three coordinates by nature, so
  // without this ordering one "A = (0, 0, 0)" beside a prism would silently
  // send the whole spec to the space renderer, which has no solids to draw.
  // A spec with 3-coordinate points and no solid still infers space.
  //
  // It also comes before the PLOTTED check, deliberately: a solid beside
  // "y = x^2" infers figure, and the figure renderer refuses the plot with
  // an error naming it (a solid in the graph renderer would be dropped
  // without a word, which is the worse of the two).
  if (statements.some((s) => SOLID_FIGURE.has(s.kind))) return 'figure'

  // Depth means a 3D scene, which the figure renderer has no answer for: a
  // figure is a flat drawing, and quietly dropping the z would be worse than
  // plotting it.
  if (isThreeD(statements)) return 'graph'

  if (statements.some((s) => PLOTTED.has(s.kind))) return 'graph'
  if (statements.some((s) => GEOMETRY.has(s.kind))) return 'figure'

  // Nothing drawable: definitions, directives, an empty spec. Graph is the
  // status quo, and an empty figure would be a blank sheet with no hint that
  // anything is missing.
  return 'graph'
}

// ---------------------------------------------------------------------------
// F5 — panels
// ---------------------------------------------------------------------------

const TABLE_KINDS: ReadonlySet<Statement['kind']> = new Set(['tableHeader', 'tableRow', 'tableGenerator'])

// What a spec puts on screen: a drawing, a table, or both.
export interface Panels {
  // Which renderer draws the drawable content, or null when the spec has no
  // drawing to show.
  drawable: RenderMode | null
  table: boolean
}

// **A table is additive rather than exclusive.**
//
// `@mode` is one-of, which forces a problem containing both a figure and a
// data table to choose — and real problems contain both. So the renderer
// composes panels: mode still decides which renderer draws the *drawable*
// content, and a table sits beside it.
//
// `@mode: table` keeps its current meaning of "table only", so nothing
// already stored changes. That is the whole compatibility promise, and it is
// why this reads the declaration rather than resolveMode's answer: an
// inferred 'table' does not exist, and only the author's own word suppresses
// the drawing.
//
// The one case with no status quo to preserve is a spec that declares no mode
// and has nothing drawable in it — today that renders an empty graph canvas
// with the table nowhere to be seen. There is no drawing to put beside the
// table, and an empty panel is not a second panel, so the table takes the
// view. An explicit `@mode` is still a statement of intent and is not
// second-guessed.
export function resolvePanels(statements: Statement[], config: GraphConfig): Panels {
  const table = statements.some((s) => TABLE_KINDS.has(s.kind))
  if (config.modeDeclared && config.mode === 'table') return { drawable: null, table: true }

  const drawable = resolveMode(statements, config)
  if (table && !config.modeDeclared && !statements.some((s) => PLOTTED.has(s.kind) || GEOMETRY.has(s.kind))) {
    return { drawable: null, table: true }
  }
  return { drawable, table }
}
