import { compileScalar, freeVariablesDeep } from '../math/compile'
import { variable } from '../math/expr'
import { and, compare } from '../math/reserved'
import type { MathScope } from '../math/scope'
import type { GraphConfig } from '../parser/config'
import type { FunctionTable } from '../parser/evalExpr'
import type { Expr, Statement } from '../parser/types'
import { logOf, throughScales } from '../plot/frame/rewrite'
import { type CurveSpec, sampleCurve, type View } from '../plot/sample/curve'
import { buildPlotScope } from '../plot/scope'
import { FULL } from '../plot/sample/tuning'
import { sampleImplicit } from '../plot/implicit/implicit'
import { comparisonsOf } from '../plot/implicit/region'
import { sampleRegion } from '../plot/implicit/regions'
import type { Sampled, StatementOptions } from '../plot/implicit/types'
import { chainOf } from './chains'
import { explicitFeatures, intersectionFeatures, type FeaturePoint } from './featurePoints'
import { buildConstructions } from './geometry/buildConstructions'
import { circleCurve, polygonObjects } from './geometry/sceneObjects'
import { formatCoord } from './format'
import type { Bounds, Scene, SceneObject, Vec2 } from './types'

const FIELD_DIVISIONS = 18
// A config built by hand (a test, a tool) may not say its scales: both linear.
const LINEAR_SCALES = { x: 'linear', y: 'linear' } as const
// The viewport's width, in px, for a caller that does not give one (a test, a tool): the curve sampler
// works in screen space (a sample per 4 px, a flatness of a quarter of a pixel), so it is told how big the
// view is. The height then follows the bounds' aspect.
const DEFAULT_WIDTH_PX = 800
// What the scene says of a curve whose drawing budget ran out: it is drawn, from what the sampler had, and
// the author is told it is not the whole picture (spec: "At the cap the curve coarsens and a note says so;
// it never blanks").
const BUDGET_NOTE = 'drawn coarsely: this curve needs more detail than its drawing budget allows'
// And of one the budget left with nothing at all to draw (a curve the twin cannot certify has nothing
// the cap can keep): the same cause, said as what it is. "drawn coarsely" over a blank would be false.
const NOT_DRAWN_NOTE = 'not drawn: this curve needs more detail than its drawing budget allows'
// And of one that is in view and not drawn, with the budget not spent and nothing steep to blame: the sampler could not certify any
// of it (a staircase of a thousand steps a unit has treads a hundredth of a pixel wide). A blank always says why.
const NOT_CERTIFIED_NOTE = 'not drawn: this curve could not be certified anywhere in view'
// A curve that is smooth and rises faster than the sampler can certify (past about 1024:1 on screen, where the twin
// has nothing to say about it): it is broken wherever that is so, and nothing else says why.
const TOO_STEEP_NOTE = 'too steep to draw here: the curve rises faster than the sampler can certify'

// One pass over the statements to collect every "k(x) = ..." / "a = 5"
// definition into a lookup table, before anything else gets built — a
// definition can be referenced by a statement anywhere else in the spec,
// not just ones that come after it textually. This is the evalExpr-side table,
// kept for the one user that still evaluates through parser/evalExpr.ts
// (buildConstructions, shared with the figure engine); everything else in this
// file, "animate:" paths included, reads the MathScope from plot/scope.ts
// instead.
function collectFunctions(statements: Statement[]): FunctionTable {
  const functions: FunctionTable = {}
  for (const statement of statements) {
    if (statement.kind === 'functionDef') {
      functions[statement.name] = { param: statement.param, body: statement.body }
    } else if (statement.kind === 'constantDef') {
      functions[statement.name] = { param: null, body: statement.value }
    }
  }
  return functions
}

// A number from an expression with no variables (a bound, a coordinate, a
// radius), through the kernel.
function constant(expr: Expr, scope: MathScope): number {
  return compileScalar(expr, [], scope)()
}

// Same "collect everything up front, order doesn't matter" pass as
// collectFunctions above, for angle:/tick:/right-angle:'s A/B/C point-name
// references — a labeled point ("A = (x, y)") or a polygon vertex can be
// referenced by a geometry-mark statement anywhere else in the spec, not
// just ones that come after it textually. A point whose own coordinates
// fail to evaluate (e.g. an unbound variable) is silently skipped here —
// that failure gets reported once, when the point/polygon statement itself
// is processed in the main loop below, rather than duplicated for every
// mark statement that happens to reference it.
function collectNamedPoints(statements: Statement[], scope: MathScope): Map<string, Vec2> {
  const points = new Map<string, Vec2>()
  for (const statement of statements) {
    if (statement.kind === 'point' && statement.label) {
      try {
        points.set(statement.label, { x: constant(statement.x, scope), y: constant(statement.y, scope) })
      } catch {
        // reported when the point statement itself is processed below
      }
    } else if (statement.kind === 'polygon') {
      for (const vertex of statement.vertices) {
        try {
          points.set(vertex.label, { x: constant(vertex.x, scope), y: constant(vertex.y, scope) })
        } catch {
          // reported when the polygon statement itself is processed below
        }
      }
    }
  }
  return points
}

// The statement's own domain as a condition Expr, for the sampler: its calc P1 "where" as it
// is, else its old-shape clause (parser/types.ts Condition) written in the same language — a
// comparison of the independent variable with the bound, or the two comparisons of a range
// joined with `and`. The sampler compiles it over the independent variable alone, so a test on
// the dependent one ("y = x if y > 0") is a compile error on its line, not a silent filter.
function domainOf(statement: Statement & { kind: 'explicit' }): Expr | null {
  if (statement.where) return statement.where
  const clause = statement.condition
  if (!clause) return null
  const t = variable(statement.independent)
  if (clause.kind === 'compare') return compare(clause.op, t, clause.value)
  // low <(=) t <(=) high
  return and(compare(clause.lowOp, clause.low, t), compare(clause.highOp, t, clause.high))
}

// The range of a polar or parametric statement as two numbers, low to high. A range written the
// wrong way round ("for t in [5, 2]") is the same curve traced backwards, and the sampler (which
// takes low to high) draws what v1 did. A range that is not a number, or has nothing in it, says
// so on its own line, which "undefined everywhere in view" would not. The exception is an empty
// range that a @param made (`for t in [0, a]` with the slider at 0): a slider's position is not a
// mistake in the text, so there is nothing to draw and nothing to say (null). A range written as
// empty, or made so by a constant, is still the author's to fix.
function rangeOf(from: Expr, to: Expr, scope: MathScope, param: string): [number, number] | null {
  const a = constant(from, scope)
  const b = constant(to, scope)
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`the range of ${param} is not a number`)
  if (a === b) {
    if (readsParam(from, scope) || readsParam(to, scope)) return null
    throw new Error(`the range of ${param} is empty`)
  }
  return a < b ? [a, b] : [b, a]
}

// Whether an expression reads a @param, directly or through the functions and constants it uses.
function readsParam(expr: Expr, scope: MathScope): boolean {
  for (const name of freeVariablesDeep(expr, scope)) if (scope.params.index.has(name)) return true
  return false
}

// What the sampler needs besides the statement: the viewport, how fine to be, and where to put
// what it says (the work it did, and the notes on the statement's line).
interface CurveContext {
  view: View
  scope: MathScope
  config: GraphConfig
  quality: 'full' | 'coarse'
  budget: { points: number; intervals: number } | undefined
  stats: { points: number; intervals: number }
  errors: Scene['errors']
}

// One curve statement through the adaptive sampler (plot/sample/curve.ts), and what the scene says of
// the result, in the sampler's own terms:
//  - tested but defined nowhere in the range: "undefined everywhere in view" (the statement's error). A
//    curve that was never tested (its domain misses the view) says nothing; a curve that is defined but
//    wholly off screen is not this either.
//  - nothing drawn in the picture (no chain or band in view, no isolated point) of a curve that has a
//    point in view (`blankInView`): "not drawn", at ANY quality, and a blank must say why. The cause is
//    the sampler's: the budget ran out (capped: what the cap leaves of a curve the twin cannot certify,
//    an integral, is nothing), or it is too steep (said below), or else it could not certify any of it. The
//    same note over a curve that is not in view would be false, which is why the sampler says whether
//    there was anything to draw.
//  - tooSteep (smooth, and steeper than the sampler can certify, somewhere in view): "too steep to draw
//    here", at FULL always and at COARSE only if nothing drew in view, as the budget notes. A jump the walk did
//    not find is not this; nor is a steep stretch that is only in the overscan.
//  - capped, and something drawn in view: the curve is drawn from what the sampler had, and the line says
//    "drawn coarsely", at FULL only. A coarse pass is coarse on purpose (the settled pass says whether
//    the curve fits its budget), and the message would flash on every drag frame. A chain that is only
//    in the overscan is not drawing.
// The objects are the sampler's: the curve, its bands, its marks, its asymptote guides.
function sampleStatement(spec: CurveSpec, statementIndex: number, color: string | null, line: number, ctx: CurveContext): SceneObject[] {
  const sampled = sampleCurve(spec, ctx.view, ctx.scope, {
    statement: statementIndex,
    color,
    asymptotes: ctx.config.asymptotes,
    quality: ctx.quality,
    budget: ctx.budget,
  })
  ctx.stats.points += sampled.stats.points
  ctx.stats.intervals += sampled.stats.intervals
  if (sampled.tested && !sampled.defined) throw new Error('this curve is undefined everywhere in view')
  // too steep to certify, somewhere in view: at FULL always, at COARSE only if nothing drew in view (as the budget notes: a chain
  // only in the overscan is not drawing)
  const steep = sampled.tooSteep && (ctx.quality === 'full' || !sampled.drawnInView)
  if (steep) ctx.errors.push({ line, message: TOO_STEEP_NOTE })
  if (sampled.blankInView) {
    // by cause: the budget, else steepness (said already), else that nothing could be certified
    if (sampled.capped) ctx.errors.push({ line, message: NOT_DRAWN_NOTE })
    else if (!steep) ctx.errors.push({ line, message: NOT_CERTIFIED_NOTE })
  } else if (sampled.capped && ctx.quality === 'full' && sampled.drawnInView) ctx.errors.push({ line, message: BUDGET_NOTE })
  return sampled.objects
}

function sampleExplicit(statement: Statement & { kind: 'explicit' }, statementIndex: number, line: number, ctx: CurveContext): SceneObject[] {
  const scales = ctx.config.scales ?? LINEAR_SCALES
  if (scales.x === 'linear' && scales.y === 'linear') {
    return sampleStatement({ kind: 'explicit', independent: statement.independent, body: statement.body, domain: domainOf(statement) }, statementIndex, statement.color, line, ctx)
  }
  // A log axis is a change of variable: the independent variable now means u (or v), the body reads the
  // world value 10^u, and a log output axis takes the log of what it gives (calc P4 4.3).
  const domain = domainOf(statement)
  const outputScale = statement.independent === 'x' ? scales.y : scales.x
  const through = throughScales(statement.body, scales)
  const body = outputScale === 'log' ? logOf(through) : through
  return sampleStatement({ kind: 'explicit', independent: statement.independent, body, domain: domain ? throughScales(domain, scales) : null }, statementIndex, statement.color, line, ctx)
}

// The parameter is theta in the statement's own angle unit (the variable the body is written in, not
// the radians it is plotted at; the sampler reads the unit off the scope). A range the author did not
// write is a full turn in that unit: 360 under @angle: degrees, 2 pi otherwise (the parser's default,
// flagged `fullTurn`, is in radians).
function samplePolar(statement: Statement & { kind: 'polar' }, statementIndex: number, line: number, ctx: CurveContext): SceneObject[] {
  if (ctx.config.scales?.x === 'log' || ctx.config.scales?.y === 'log') throw new Error('polar curves need linear axes; write the curve parametrically')
  const range = statement.fullTurn && ctx.config.angle === 'degrees' ? ([0, 360] as [number, number]) : rangeOf(statement.from, statement.to, ctx.scope, 'theta')
  if (range === null) return []
  return sampleStatement({ kind: 'polar', body: statement.body, from: range[0], to: range[1] }, statementIndex, statement.color, line, ctx)
}

function sampleParametric(statement: Statement & { kind: 'parametric' }, statementIndex: number, line: number, ctx: CurveContext): SceneObject[] {
  const range = rangeOf(statement.from, statement.to, ctx.scope, statement.param)
  if (range === null) return []
  const { x, y } = ctx.config.scales ?? LINEAR_SCALES
  const fx = x === 'log' ? logOf(statement.fx) : statement.fx
  const fy = y === 'log' ? logOf(statement.fy) : statement.fy
  return sampleStatement({ kind: 'parametric', param: statement.param, fx, fy, from: range[0], to: range[1] }, statementIndex, statement.color, line, ctx)
}

function featureLabel(feature: FeaturePoint, config: GraphConfig): string | null {
  if (config.pointLabels !== 'coords') return null
  return `(${formatCoord(feature.position.x)}, ${formatCoord(feature.position.y)})`
}

// One pass over every explicit statement, after the curves are built. Explicit
// y = f(x) statements are the only ones that expose a callable f, which is
// what the analytic feature work needs; other statement kinds contribute
// nothing here yet (conic features are a later task).
function buildFeaturePoints(
  statements: Statement[],
  bounds: Bounds,
  config: GraphConfig,
  scope: MathScope
): SceneObject[] {
  if (config.points.size === 0) return []

  const callables: ((x: number) => number)[] = []
  const found: FeaturePoint[] = []

  for (const statement of statements) {
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    if (statement.kind !== 'explicit' || statement.independent !== 'x') continue
    let f: (x: number) => number
    try {
      f = compileScalar(statement.body, ['x'], scope)
      // A statement whose if clause does not compile draws nothing, so it
      // marks nothing either: domainOf gives whichever shape of clause the
      // statement has, the old condition (x < k) or the new where, as the
      // one condition the sampler compiles.
      const domain = domainOf(statement)
      if (domain) compileScalar(domain, ['x'], scope)
    } catch {
      // reported by the statement itself
      continue
    }
    callables.push(f)
    found.push(...explicitFeatures(f, bounds.xMin, bounds.xMax, config.points))
  }

  if (config.points.has('intersection')) {
    found.push(...intersectionFeatures(callables, bounds.xMin, bounds.xMax))
  }

  // No `style` here on purpose: a feature point's appearance is chosen from
  // its kind by the renderer (see render/featureMarker.ts), not set here. The
  // scene layer must not import from render/.
  return found.map((feature) => ({
    kind: 'point' as const,
    label: featureLabel(feature, config),
    position: feature.position,
    feature: feature.kind,
    exact: feature.exact,
  }))
}

// An implicit curve or a region through the quadtree (plot/implicit), and what the scene says of the
// result, as sampleStatement says it for the curves: "undefined everywhere in view" when it was tested and
// defined nowhere; "not drawn" when something in view is blank (the budget's, else not certified); "drawn
// coarsely" when capped or leaves were left out and something drew, at FULL only (a coarse pass would flash
// it on every drag frame). A view the sampler cannot work in says nothing here.
function sayImplicit(sampled: Sampled, what: 'curve' | 'region', line: number, ctx: CurveContext): SceneObject[] {
  ctx.stats.points += sampled.stats.points
  ctx.stats.intervals += sampled.stats.intervals
  if (sampled.tested && !sampled.defined) throw new Error(`this ${what} is undefined everywhere in view`)
  const say = (note: string): string => (what === 'curve' ? note : note.replace('this curve', `this ${what}`))
  if (sampled.blankInView) {
    if (sampled.capped) ctx.errors.push({ line, message: say(NOT_DRAWN_NOTE) })
    else ctx.errors.push({ line, message: say(NOT_CERTIFIED_NOTE) })
  } else if ((sampled.capped || sampled.leftOut > 0) && ctx.quality === 'full' && sampled.drawnInView && !sampled.badView) {
    ctx.errors.push({ line, message: say(BUDGET_NOTE) })
  }
  return sampled.objects
}

function sampleImplicitStatement(statement: Statement & { kind: 'implicit' }, statementIndex: number, line: number, ctx: CurveContext): SceneObject[] {
  // On a log axis the view is (u, v) and the sampler reads H(10^u, 10^v): every free x or y is rewritten (calc P4 4.4).
  const scales = ctx.config.scales ?? LINEAR_SCALES
  const through = (e: Expr): Expr => throughScales(e, scales)
  const where = statement.where ? through(statement.where) : null
  const sampled = sampleImplicit(through(statement.left), through(statement.right), where, ctx.view, ctx.scope, optionsOf(statement.color, statementIndex, ctx))
  return sayImplicit(sampled, 'curve', line, ctx)
}

function optionsOf(color: string | null, statement: number, ctx: CurveContext): StatementOptions {
  return { statement, color, quality: ctx.quality, budget: ctx.budget }
}

function sampleRegionStatement(written: Expr, color: string | null, statementIndex: number, line: number, ctx: CurveContext): SceneObject[] {
  // the whole condition, its if clause included, is read at (10^u, 10^v) on a log axis (calc P4 4.4)
  const condition = throughScales(written, ctx.config.scales ?? LINEAR_SCALES)
  const sampled = sampleRegion(condition, comparisonsOf(condition),ctx.view, ctx.scope, optionsOf(color, statementIndex, ctx))
  const objects = sayImplicit(sampled, 'region', line, ctx)
  // A region with an empty outline (x^2 + y^2 < 0) is nothing to fill, and has no boundary to stroke.
  return objects.filter((o) => o.kind !== 'region' || o.outline.length > 0)
}

// "left op right [if where]" is the one condition, "low lowOp mid highOp high" the two joined with `and`.
function withWhere(condition: Expr, where: Expr | undefined): Expr {
  return where ? and(condition, where) : condition
}

// One short tick per grid point, angled by the local slope — a direction
// field for dy/dx = f(x,y).
function buildField(statement: Statement & { kind: 'field' }, bounds: Bounds, scope: MathScope): SceneObject[] {
  const dx = (bounds.xMax - bounds.xMin) / FIELD_DIVISIONS
  const dy = (bounds.yMax - bounds.yMin) / FIELD_DIVISIONS
  const tickLen = Math.min(dx, dy) * 0.7
  const body = compileScalar(statement.body, ['x', 'y'], scope)
  const pairs: [Vec2, Vec2][] = []
  // The grid keeps the view's own lattice and runs on past it by the overscan
  // (P2's 25 % of the span on each side, rounded up to whole ticks), so the
  // field pans with the rest and a column at x = 0 stays a column.
  const extra = Math.ceil(FULL.overscan * FIELD_DIVISIONS)
  for (let j = -extra; j <= FIELD_DIVISIONS + extra; j++) {
    const y = bounds.yMin + j * dy
    for (let i = -extra; i <= FIELD_DIVISIONS + extra; i++) {
      const x = bounds.xMin + i * dx
      const slope = body(x, y)
      // An undefined slope (NaN) has no direction to draw; an infinite one is
      // a vertical tick, as it always was.
      if (Number.isNaN(slope)) continue
      const angle = Math.atan(slope)
      const hx = (Math.cos(angle) * tickLen) / 2
      const hy = (Math.sin(angle) * tickLen) / 2
      pairs.push([{ x: x - hx, y: y - hy }, { x: x + hx, y: y + hy }])
    }
  }
  return pairs.length > 0 ? [{ kind: 'segments', pairs, color: statement.color }] : []
}

// Numeric tangent (central difference) to `body` at x = at, drawn across the
// visible domain: a curve of one two-vertex chain from the left edge of the
// view to the right (the parameter is x), so it keeps the thin curve ribbon
// and stays hoverable like any curve.
function buildTangent(statement: Statement & { kind: 'tangent' }, statementIndex: number, bounds: Bounds, scope: MathScope): SceneObject[] {
  const a = constant(statement.at, scope)
  const f = compileScalar(statement.body, ['x'], scope)
  const fa = f(a)
  const h = 1e-4
  const slope = (f(a + h) - f(a - h)) / (2 * h)
  const color = statement.color ?? 'orange'
  const line: Vec2[] = [
    { x: bounds.xMin, y: fa + slope * (bounds.xMin - a) },
    { x: bounds.xMax, y: fa + slope * (bounds.xMax - a) },
  ]
  return [
    {
      kind: 'curve',
      id: { statement: statementIndex, object: 'tangent' },
      chains: [chainOf(line, [bounds.xMin, bounds.xMax])],
      breaks: [],
      color,
    },
    { kind: 'point', label: null, position: { x: a, y: fa }, color },
  ]
}

// A circle by center + radius, sampled as one closed chain and reused as a
// plain 'curve' SceneObject — the ribbon renderer draws a closed chain as a
// loop (renderItems.ts closes it), so no new render path is needed just for
// this. The sampling itself lives in geometry/sceneObjects.ts so an
// incircle/circumcircle draws identically.
function buildCircle(statement: Statement & { kind: 'circle' }, statementIndex: number, scope: MathScope): SceneObject[] {
  const cx = constant(statement.cx, scope)
  const cy = constant(statement.cy, scope)
  const radius = constant(statement.radius, scope)
  if (radius <= 0) throw new Error('circle radius must be positive')
  return [circleCurve({ x: cx, y: cy }, radius, statement.color, { statement: statementIndex, object: 'curve' })]
}

// A closed shape from >= 3 labeled vertices — the edges reuse 'segments'
// (straight, constant weight, matching a geometry diagram's crisp corners
// rather than the curvature-driven ribbon a 'curve' would give a polygon's
// sharp turns), plus one 'point' per vertex so labels/dots render exactly
// like a plain "A = (x, y)" statement would. Vertex *names* are resolved to
// coordinates separately, in collectNamedPoints, so angle:/tick:/
// right-angle: can reference them.
//
// Both the edge batch and the "push each vertex label away from the shape's
// own centroid, capped" rule now live in geometry/sceneObjects.ts, because a
// solved "triangle ABC:" statement has to draw as exactly the same picture —
// a hand-typed polygon and a solved triangle should not be two shapes that
// merely resemble each other.
function buildPolygon(statement: Statement & { kind: 'polygon' }, scope: MathScope): SceneObject[] {
  const vertices = statement.vertices.map((v) => ({
    label: v.label,
    position: { x: constant(v.x, scope), y: constant(v.y, scope) },
  }))
  return polygonObjects(vertices, statement.color)
}

function linearRegression(points: Vec2[]) {
  const n = points.length
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (const p of points) {
    const dx = p.x - meanX
    const dy = p.y - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  const slope = varX === 0 ? 0 : cov / varX
  const intercept = meanY - slope * meanX
  const r = varX === 0 || varY === 0 ? 0 : cov / Math.sqrt(varX * varY)
  return { slope, intercept, r }
}

function buildScatter(statement: Statement & { kind: 'scatter' }, statementIndex: number, bounds: Bounds, scope: MathScope): { objects: SceneObject[]; regression: Scene['regression'] } {
  const points: Vec2[] = statement.points.map(([xExpr, yExpr]) => ({
    x: constant(xExpr, scope),
    y: constant(yExpr, scope),
  }))
  const objects: SceneObject[] = points.map((p) => ({ kind: 'point', label: null, position: p, color: statement.color }))
  if (points.length < 2) return { objects, regression: null }

  // The fitted line across the visible domain, as a tangent is: one two-vertex
  // chain from the left edge of the view to the right (the parameter is x).
  const regression = linearRegression(points)
  const line: Vec2[] = [
    { x: bounds.xMin, y: regression.slope * bounds.xMin + regression.intercept },
    { x: bounds.xMax, y: regression.slope * bounds.xMax + regression.intercept },
  ]
  objects.push({
    kind: 'curve',
    id: { statement: statementIndex, object: 'regression' },
    chains: [chainOf(line, [bounds.xMin, bounds.xMax])],
    breaks: [],
    color: statement.color,
  })
  return { objects, regression }
}

// Rebuilds the full scene from parsed statements. `bounds` is the current
// camera viewport — functions, implicit curves, regions, and fields are
// sampled over it, so the scene is rebuilt on pan/zoom as well as on spec
// edits. `resolution` is ignored since P3: implicit curves and regions are
// sampled by the quadtree at the `quality` option below. It stays in the signature so
// callers keep compiling.
//
// Curves (y = f(x), x = f(y), polar, parametric) go through the adaptive sampler
// (plot/sample/curve.ts), which works in screen space, so `options` says how big the
// viewport is and how fine the sampling should be:
//   widthPx, heightPx  the viewport in CSS px (defaults: 800 wide, and the height the
//                      bounds' aspect gives);
//   quality            'full' for a settled view (the default), 'coarse' while a
//                      gesture runs: a looser curve for about a quarter of the work;
//   budget             for tests: the sampler's budget of evaluations, to force a curve
//                      to its cap.
// `Scene.stats` is the work every sampled curve did, summed.
export interface SceneOptions {
  widthPx?: number
  heightPx?: number
  quality?: 'full' | 'coarse'
  budget?: { points: number; intervals: number }
}

// The viewport the sampler is given: the width, and the height that keeps the bounds' aspect unless
// the caller says. Each is a finite number of pixels, at least one: a canvas that is not displayed
// reports 0, and the sampler answers a scale of no pixels with "undefined everywhere in view", which
// would be a false message about a curve that is only unseen. A size that is not a number at all
// (NaN, an infinity) is the default.
function viewOf(bounds: Bounds, options: SceneOptions | undefined): View {
  const px = (given: number | undefined, otherwise: number) => (given !== undefined && Number.isFinite(given) ? Math.max(1, given) : otherwise)
  const widthPx = px(options?.widthPx, DEFAULT_WIDTH_PX)
  const natural = Math.round((widthPx * (bounds.yMax - bounds.yMin)) / (bounds.xMax - bounds.xMin))
  const heightPx = px(options?.heightPx, Number.isFinite(natural) ? Math.max(1, natural) : widthPx)
  return { bounds, widthPx, heightPx }
}

export function buildScene(
  statements: Statement[],
  bounds: Bounds,
  config: GraphConfig,
  _resolution?: number,
  lines?: readonly number[],
  options?: SceneOptions
): Scene {
  const objects: SceneObject[] = []
  const errors: Scene['errors'] = []
  const stats = { points: 0, intervals: 0 }
  let regression: Scene['regression'] = null
  const lineOf = (index: number) => lines?.[index] ?? 0
  const functions = collectFunctions(statements)
  const plotScope = buildPlotScope(statements, config, lines)
  const scope = plotScope.scope
  errors.push(...plotScope.errors)
  const namedPoints = collectNamedPoints(statements, scope)
  const curves: CurveContext = { view: viewOf(bounds, options), scope, config, quality: options?.quality ?? 'full', budget: options?.budget, stats, errors }

  // Geometry constructions resolve in one pass up front, in source order (see
  // geometry/buildConstructions.ts for why definition-before-use rather than
  // the order-independent treatment function/constant definitions get). The
  // points they produce join the named-point table, so a constructed point is
  // referenceable by angle:/tick:/right-angle: exactly like a polygon vertex.
  const constructions = buildConstructions(statements, config, functions, namedPoints)
  for (const [name, position] of constructions.points) namedPoints.set(name, position)
  // buildConstructions (shared with the figure engine) reports its errors in
  // statement order but not which statement failed, and gives every statement
  // that succeeded an entry in objectsByStatement. So the failed statements
  // are the constructions and triangles without one, in the same order as the
  // errors; if the counts ever disagree the errors keep line 0.
  const failedConstructions = statements.flatMap((s, i) => ((s.kind === 'construction' || s.kind === 'triangle') && !constructions.objectsByStatement.has(i) ? [i] : []))
  const namesTheirLine = failedConstructions.length === constructions.errors.length
  constructions.errors.forEach((error, k) => errors.push(namesTheirLine ? { ...error, line: lineOf(failedConstructions[k]) } : error))

  function resolvePoint(name: string): Vec2 {
    const point = namedPoints.get(name)
    if (!point) throw new Error(`Unknown point "${name}" — define it with a point statement (e.g. "${name} = (x, y)") or as a polygon vertex first`)
    return point
  }

  for (let statementIndex = 0; statementIndex < statements.length; statementIndex++) {
    const statement = statements[statementIndex]
    // "@hide: <name>" skips rendering only — collectFunctions above already
    // ran, so a hidden "k(x) = ..." (or a hidden "y = k(x) name: k") stays
    // fully usable by other statements' expressions; hiding just means this
    // statement's own SceneObjects aren't emitted.
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    try {
      if (statement.kind === 'explicit') {
        objects.push(...sampleExplicit(statement, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'polar') {
        objects.push(...samplePolar(statement, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'parametric') {
        objects.push(...sampleParametric(statement, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'implicit') {
        objects.push(...sampleImplicitStatement(statement, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'region') {
        objects.push(...sampleRegionStatement(withWhere(compare(statement.op, statement.left, statement.right), statement.where), statement.color, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'regionChain') {
        const chain = and(compare(statement.lowOp, statement.low, statement.mid), compare(statement.highOp, statement.mid, statement.high))
        objects.push(...sampleRegionStatement(withWhere(chain, statement.where), statement.color, statementIndex, lineOf(statementIndex), curves))
      } else if (statement.kind === 'field') {
        objects.push(...buildField(statement, bounds, scope))
      } else if (statement.kind === 'tangent') {
        objects.push(...buildTangent(statement, statementIndex, bounds, scope))
      } else if (statement.kind === 'scatter') {
        const built = buildScatter(statement, statementIndex, bounds, scope)
        objects.push(...built.objects)
        if (built.regression) regression = built.regression
      } else if (statement.kind === 'animatedPoint') {
        // Both coordinates compile through the kernel here, so a mistake lands
        // on this statement's line now rather than failing silently on every
        // frame, and the whole language (n!, |t|, sums, piecewise, f', multi-
        // parameter functions, @params) works in the path. The renderer calls
        // the closures per frame.
        objects.push({
          kind: 'animatedPoint',
          fx: compileScalar(statement.fx, [statement.param], scope),
          fy: compileScalar(statement.fy, [statement.param], scope),
          param: statement.param,
          from: constant(statement.from, scope),
          to: constant(statement.to, scope),
          color: statement.color,
        })
      } else if (statement.kind === 'point') {
        objects.push({
          kind: 'point',
          label: statement.label,
          position: { x: constant(statement.x, scope), y: constant(statement.y, scope) },
          color: statement.color,
          // The author typed these coordinates; nothing about them was
          // sampled or converged to, so this is the most literal position
          // the scene contains (see `exact` in types.ts).
          exact: true,
        })
      } else if (statement.kind === 'segment') {
        objects.push({
          kind: 'segment',
          from: { x: constant(statement.x1, scope), y: constant(statement.y1, scope) },
          to: { x: constant(statement.x2, scope), y: constant(statement.y2, scope) },
          color: statement.color,
        })
      } else if (statement.kind === 'ray') {
        objects.push({
          kind: 'ray',
          from: { x: constant(statement.x1, scope), y: constant(statement.y1, scope) },
          to: { x: constant(statement.x2, scope), y: constant(statement.y2, scope) },
          color: statement.color,
        })
      } else if (statement.kind === 'vector') {
        const from = { x: constant(statement.x1, scope), y: constant(statement.y1, scope) }
        const to = { x: constant(statement.x2, scope), y: constant(statement.y2, scope) }
        const magnitude = Math.hypot(to.x - from.x, to.y - from.y)
        objects.push({ kind: 'ray', from, to, label: `|v| = ${formatCoord(magnitude)}`, color: statement.color })
      } else if (statement.kind === 'circle') {
        objects.push(...buildCircle(statement, statementIndex, scope))
      } else if (statement.kind === 'polygon') {
        objects.push(...buildPolygon(statement, scope))
      } else if (statement.kind === 'construction' || statement.kind === 'triangle') {
        // Already solved in the construction pass above; emitted here so the
        // draw order follows the spec text and "@hide" still applies. A
        // hidden construction keeps its binding, same as a hidden function
        // definition stays callable.
        objects.push(...(constructions.objectsByStatement.get(statementIndex) ?? []))
      } else if (statement.kind === 'angle') {
        objects.push({
          kind: 'angleMark',
          from: resolvePoint(statement.from),
          vertex: resolvePoint(statement.vertex),
          to: resolvePoint(statement.to),
          label: statement.label,
          color: statement.color,
        })
      } else if (statement.kind === 'namedSegment') {
        objects.push({
          kind: 'segment',
          from: resolvePoint(statement.from),
          to: resolvePoint(statement.to),
          dashed: statement.style === 'dashed',
          color: statement.color,
        })
      } else if (statement.kind === 'circleShape' || statement.kind === 'centralAngle' || statement.kind === 'inscribedAngle') {
        // The plot renderer has no answer for these: an arc drawn there would
        // be a sampled polyline, which is the shape the figure renderer exists
        // to avoid. Saying so is the point — a statement that silently drew
        // nothing would leave an author staring at a figure missing the piece
        // the problem is about.
        const what = statement.kind === 'circleShape' ? statement.shape : statement.kind === 'centralAngle' ? 'central angle' : 'inscribed angle'
        throw new Error(`"${what}" draws in figure mode — add "@mode: figure", or remove the plotted statement that made this a graph`)
      } else if (statement.kind === 'fill') {
        // Phase 12 (F4) — a shaded region is drawn as one exact path of
        // segments and arcs, which only the figure renderer draws.
        throw new Error('fill: draws in figures — declare @mode: figure')
      } else if (statement.kind === 'tick') {
        objects.push({ kind: 'tickMark', from: resolvePoint(statement.from), to: resolvePoint(statement.to), count: statement.count, color: statement.color })
      } else if (statement.kind === 'rightAngle') {
        objects.push({
          kind: 'rightAngleMark',
          from: resolvePoint(statement.from),
          vertex: resolvePoint(statement.vertex),
          to: resolvePoint(statement.to),
          color: statement.color,
        })
      }
    } catch (err) {
      errors.push({ line: lineOf(statementIndex), message: err instanceof Error ? err.message : String(err) })
    }
  }

  objects.push(...buildFeaturePoints(statements, bounds, config, scope))

  return { objects, errors, regression, stats }
}
