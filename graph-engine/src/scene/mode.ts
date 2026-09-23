import type { GraphConfig } from '../parser/config'
import type { Statement } from '../parser/types'

// A spec is rendered in 3D as soon as any statement has depth to it — an
// explicit/parametric surface, or a z component on a point/segment/ray/curve.
// Everything else (2D-shaped statements) still plots fine inside a 3D scene,
// lifted onto the z=0 plane, so mixed specs "just work".
export function isThreeD(statements: Statement[]): boolean {
  return statements.some((s) => {
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
])

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
  // A measure label draws nothing on its own, but a spec that is nothing but
  // labels is still a figure rather than a graph.
  'measureLabel',
  'given',
])

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
