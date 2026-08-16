import type { GraphConfig } from '../parser/config'
import { compileExpr, evalExpr, type Bindings, type FunctionTable } from '../parser/evalExpr'
import type { Condition, Statement } from '../parser/types'
import { traceImplicitCurve, traceImplicitRegion, type Bounds } from '../render/marchingSquares'
import { detectFeaturePoints } from './detectFeaturePoints'
import { formatCoord } from './format'
import type { Scene, SceneObject, Vec2 } from './types'

const SAMPLES = 400
// Full-quality marching-squares resolution for a settled view; buildScene's
// caller passes a lower value while the user is actively dragging (see
// GraphViewer.tsx) so the expensive region/implicit-curve sampling backs off
// during interaction and sharpens back up once it stops.
const IMPLICIT_RESOLUTION = 140
const FIELD_DIVISIONS = 18
// A jump between consecutive samples bigger than this multiple of the
// visible height is treated as a blow-up (an asymptote), not a steep-but-
// continuous stretch of the function.
const ASYMPTOTE_JUMP_FACTOR = 3

// One pass over the statements to collect every "k(x) = ..." / "a = 5"
// definition into a lookup table, before anything else gets built — a
// definition can be referenced by a statement anywhere else in the spec,
// not just ones that come after it textually.
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

// Same "collect everything up front, order doesn't matter" pass as
// collectFunctions above, for angle:/tick:/right-angle:'s A/B/C point-name
// references — a labeled point ("A = (x, y)") or a polygon vertex can be
// referenced by a geometry-mark statement anywhere else in the spec, not
// just ones that come after it textually. A point whose own coordinates
// fail to evaluate (e.g. an unbound variable) is silently skipped here —
// that failure gets reported once, when the point/polygon statement itself
// is processed in the main loop below, rather than duplicated for every
// mark statement that happens to reference it.
function collectNamedPoints(statements: Statement[], config: GraphConfig, functions: FunctionTable): Map<string, Vec2> {
  const points = new Map<string, Vec2>()
  for (const statement of statements) {
    if (statement.kind === 'point' && statement.label) {
      try {
        points.set(statement.label, { x: evalExpr(statement.x, {}, config.angle, functions), y: evalExpr(statement.y, {}, config.angle, functions) })
      } catch {
        // reported when the point statement itself is processed below
      }
    } else if (statement.kind === 'polygon') {
      for (const vertex of statement.vertices) {
        try {
          points.set(vertex.label, { x: evalExpr(vertex.x, {}, config.angle, functions), y: evalExpr(vertex.y, {}, config.angle, functions) })
        } catch {
          // reported when the polygon statement itself is processed below
        }
      }
    }
  }
  return points
}

// Compiles a condition's bound expression(s) to plain numbers once, up front
// — they're constants with respect to the sampling loop's variable, so
// re-evaluating them on every one of ~400 samples (as a naive per-sample
// evalExpr call would) is pure waste.
type CompiledCondition =
  | { kind: 'compare'; op: '<' | '<=' | '>' | '>='; value: number }
  | { kind: 'range'; lowOp: '<' | '<='; low: number; highOp: '<' | '<='; high: number }

function compileCondition(condition: Condition | null, config: GraphConfig, functions: FunctionTable): CompiledCondition | null {
  if (!condition) return null
  if (condition.kind === 'compare') {
    return { kind: 'compare', op: condition.op, value: evalExpr(condition.value, {}, config.angle, functions) }
  }
  return {
    kind: 'range',
    lowOp: condition.lowOp,
    low: evalExpr(condition.low, {}, config.angle, functions),
    highOp: condition.highOp,
    high: evalExpr(condition.high, {}, config.angle, functions),
  }
}

function satisfiesCondition(condition: CompiledCondition | null, t: number): boolean {
  if (!condition) return true
  if (condition.kind === 'compare') {
    switch (condition.op) {
      case '<':
        return t < condition.value
      case '<=':
        return t <= condition.value
      case '>':
        return t > condition.value
      case '>=':
        return t >= condition.value
    }
  }
  const lowOk = condition.lowOp === '<=' ? t >= condition.low : t > condition.low
  const highOk = condition.highOp === '<=' ? t <= condition.high : t < condition.high
  return lowOk && highOk
}

// Wraps a sampled curve's points as a SceneObject, plus any requested
// intercept/vertex feature points detected along it (see
// scene/detectFeaturePoints.ts for the numerical approach). Feature points
// keep their own default outline styling regardless of a custom curve color,
// so they stay visually distinct from the curve itself.
function curveWithFeatures(points: Vec2[], config: GraphConfig, color: string | null): SceneObject[] {
  const objects: SceneObject[] = [{ kind: 'curve', points, color }]
  for (const p of detectFeaturePoints(points, config.points)) {
    objects.push({ kind: 'point', label: null, position: p, style: 'outline' })
  }
  return objects
}

function sampleExplicit(statement: Statement & { kind: 'explicit' }, bounds: Bounds, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const [lo, hi] = statement.independent === 'x' ? [bounds.xMin, bounds.xMax] : [bounds.yMin, bounds.yMax]
  const viewSpan = statement.independent === 'x' ? bounds.yMax - bounds.yMin : bounds.xMax - bounds.xMin
  const body = compileExpr(statement.body, config.angle, functions)
  const condition = compileCondition(statement.condition, config, functions)
  const bindings: Bindings = {}

  // Segments split apart wherever the function is undefined OR jumps by a
  // blow-up-sized amount between adjacent samples — without this, a vertical
  // asymptote (1/x, tan(x), ...) draws a fake near-vertical line connecting
  // +infinity to -infinity across the gap instead of an open break.
  const segments: Vec2[][] = [[]]
  const asymptoteXs: number[] = []
  let lastOther: number | null = null
  let lastT: number | null = null

  for (let i = 0; i <= SAMPLES; i++) {
    const t = lo + ((hi - lo) * i) / SAMPLES
    if (!satisfiesCondition(condition, t)) continue
    try {
      bindings[statement.independent] = t
      const other = body(bindings)
      if (!Number.isFinite(other)) throw new Error('non-finite')

      if (lastOther !== null && Math.abs(other - lastOther) > viewSpan * ASYMPTOTE_JUMP_FACTOR) {
        if (segments[segments.length - 1].length > 0) segments.push([])
        if (statement.independent === 'x' && lastT !== null) asymptoteXs.push((lastT + t) / 2)
      }

      const point = statement.independent === 'x' ? { x: t, y: other } : { x: other, y: t }
      segments[segments.length - 1].push(point)
      lastOther = other
      lastT = t
    } catch {
      if (segments[segments.length - 1].length > 0) segments.push([])
      lastOther = null
      lastT = null
    }
  }

  const objects: SceneObject[] = []
  for (const segment of segments) {
    if (segment.length < 2) continue
    objects.push(...curveWithFeatures(segment, config, statement.color))
  }
  if (config.asymptotes) {
    // A pole's approach can itself jump by more than the threshold across
    // 2-3 adjacent samples (value swings from very-negative to very-positive
    // in a handful of steps), which without merging shows up as several
    // near-identical dashed lines stacked right on top of each other instead
    // of one.
    const dt = (hi - lo) / SAMPLES
    const merged: number[] = []
    for (const x of asymptoteXs) {
      const last = merged[merged.length - 1]
      if (last !== undefined && Math.abs(x - last) < dt * 3) merged[merged.length - 1] = (last + x) / 2
      else merged.push(x)
    }
    if (merged.length > 0) {
      const pairs: [Vec2, Vec2][] = merged.map((x) => [{ x, y: bounds.yMin }, { x, y: bounds.yMax }])
      objects.push({ kind: 'segments', pairs, dashed: true, color: statement.color ?? 'gray' })
    }
  }
  return objects
}

function samplePolar(statement: Statement & { kind: 'polar' }, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const from = evalExpr(statement.from, {}, config.angle, functions)
  const to = evalExpr(statement.to, {}, config.angle, functions)
  const body = compileExpr(statement.body, config.angle, functions)
  const bindings: Bindings = {}
  const points: Vec2[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const theta = from + ((to - from) * i) / SAMPLES
    const thetaRad = config.angle === 'degrees' ? (theta * Math.PI) / 180 : theta
    try {
      bindings.theta = theta
      const r = body(bindings)
      const point = { x: r * Math.cos(thetaRad), y: r * Math.sin(thetaRad) }
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point)
    } catch {
      // skip undefined points
    }
  }
  return curveWithFeatures(points, config, statement.color)
}

function sampleParametric(statement: Statement & { kind: 'parametric' }, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const from = evalExpr(statement.from, {}, config.angle, functions)
  const to = evalExpr(statement.to, {}, config.angle, functions)
  const fx = compileExpr(statement.fx, config.angle, functions)
  const fy = compileExpr(statement.fy, config.angle, functions)
  const bindings: Bindings = {}
  const points: Vec2[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const t = from + ((to - from) * i) / SAMPLES
    try {
      bindings[statement.param] = t
      const point = { x: fx(bindings), y: fy(bindings) }
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point)
    } catch {
      // skip undefined points
    }
  }
  return curveWithFeatures(points, config, statement.color)
}

function traceImplicit(statement: Statement & { kind: 'implicit' }, bounds: Bounds, config: GraphConfig, resolution: number, functions: FunctionTable): SceneObject[] {
  const left = compileExpr(statement.left, config.angle, functions)
  const right = compileExpr(statement.right, config.angle, functions)
  const bindings: Bindings = { x: 0, y: 0 }
  const f = (x: number, y: number) => {
    bindings.x = x
    bindings.y = y
    return left(bindings) - right(bindings)
  }
  const raw = traceImplicitCurve(f, bounds, resolution)
  if (raw.length === 0) return []
  const pairs: [Vec2, Vec2][] = raw.map(([from, to]) => [from, to])
  return [{ kind: 'segments', pairs, color: statement.color }]
}

// Fills the inequality and draws its boundary in one marching-squares pass
// (see render/marchingSquares.ts's traceImplicitRegion) — the fill's edge is
// built from the exact same per-cell corner/crossing math as the boundary
// line, so they can't visibly disagree the way an independently-resolved
// coarse mask could.
function buildRegion(statement: Statement & { kind: 'region' }, bounds: Bounds, config: GraphConfig, resolution: number, functions: FunctionTable): SceneObject[] {
  const left = compileExpr(statement.left, config.angle, functions)
  const right = compileExpr(statement.right, config.angle, functions)
  const flip = statement.op === '<' || statement.op === '<='
  const bindings: Bindings = { x: 0, y: 0 }
  const f = (x: number, y: number) => {
    bindings.x = x
    bindings.y = y
    const d = left(bindings) - right(bindings)
    // traceImplicitRegion fills where f > 0; for ">"/">=" that's already
    // "left > right" (d > 0), for "<"/"<=" flip the sign so "inside" still
    // means "the inequality holds".
    return flip ? -d : d
  }
  const { triangles, boundarySegments } = traceImplicitRegion(f, bounds, resolution)
  const dashed = statement.op === '<' || statement.op === '>'
  const objects: SceneObject[] = []
  if (triangles.length > 0) objects.push({ kind: 'region', triangles, color: statement.color })
  if (boundarySegments.length > 0) {
    const pairs: [Vec2, Vec2][] = boundarySegments.map(([from, to]) => [from, to])
    objects.push({ kind: 'segments', pairs, dashed, color: statement.color })
  }
  return objects
}

// One short tick per grid point, angled by the local slope — a direction
// field for dy/dx = f(x,y).
function buildField(statement: Statement & { kind: 'field' }, bounds: Bounds, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const dx = (bounds.xMax - bounds.xMin) / FIELD_DIVISIONS
  const dy = (bounds.yMax - bounds.yMin) / FIELD_DIVISIONS
  const tickLen = Math.min(dx, dy) * 0.7
  const body = compileExpr(statement.body, config.angle, functions)
  const bindings: Bindings = { x: 0, y: 0 }
  const pairs: [Vec2, Vec2][] = []
  for (let j = 0; j <= FIELD_DIVISIONS; j++) {
    const y = bounds.yMin + j * dy
    for (let i = 0; i <= FIELD_DIVISIONS; i++) {
      const x = bounds.xMin + i * dx
      try {
        bindings.x = x
        bindings.y = y
        const slope = body(bindings)
        const angle = Math.atan(slope)
        const hx = (Math.cos(angle) * tickLen) / 2
        const hy = (Math.sin(angle) * tickLen) / 2
        pairs.push([{ x: x - hx, y: y - hy }, { x: x + hx, y: y + hy }])
      } catch {
        // skip undefined slopes
      }
    }
  }
  return pairs.length > 0 ? [{ kind: 'segments', pairs, color: statement.color }] : []
}

// Numeric tangent (central difference) to `body` at x = at, drawn across the
// visible domain.
function buildTangent(statement: Statement & { kind: 'tangent' }, bounds: Bounds, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const a = evalExpr(statement.at, {}, config.angle, functions)
  const fa = evalExpr(statement.body, { x: a }, config.angle, functions)
  const h = 1e-4
  const slope = (evalExpr(statement.body, { x: a + h }, config.angle, functions) - evalExpr(statement.body, { x: a - h }, config.angle, functions)) / (2 * h)
  const color = statement.color ?? 'orange'
  const line: Vec2[] = [
    { x: bounds.xMin, y: fa + slope * (bounds.xMin - a) },
    { x: bounds.xMax, y: fa + slope * (bounds.xMax - a) },
  ]
  return [
    { kind: 'curve', points: line, color },
    { kind: 'point', label: null, position: { x: a, y: fa }, color },
  ]
}

const CIRCLE_SAMPLES = 96

// A circle by center + radius, sampled as a closed loop (the last sample at
// t=2*pi coincides with the first at t=0) and reused as a plain 'curve'
// SceneObject — the existing ribbon renderer already draws a closed shape
// correctly as long as the point list closes on itself, so no new render
// path is needed just for this.
function buildCircle(statement: Statement & { kind: 'circle' }, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const cx = evalExpr(statement.cx, {}, config.angle, functions)
  const cy = evalExpr(statement.cy, {}, config.angle, functions)
  const radius = evalExpr(statement.radius, {}, config.angle, functions)
  if (radius <= 0) throw new Error('circle radius must be positive')
  const points: Vec2[] = []
  for (let i = 0; i <= CIRCLE_SAMPLES; i++) {
    const t = (i / CIRCLE_SAMPLES) * 2 * Math.PI
    points.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) })
  }
  return [{ kind: 'curve', points, color: statement.color }]
}

// A closed shape from >= 3 labeled vertices — the edges reuse 'segments'
// (straight, constant weight, matching a geometry diagram's crisp corners
// rather than the curvature-driven ribbon a 'curve' would give a polygon's
// sharp turns), plus one 'point' per vertex so labels/dots render exactly
// like a plain "A = (x, y)" statement would. Vertex *names* are resolved to
// coordinates separately, in collectNamedPoints, so angle:/tick:/
// right-angle: can reference them.
const POLYGON_LABEL_MAX_FRACTION = 0.35

function buildPolygon(statement: Statement & { kind: 'polygon' }, config: GraphConfig, functions: FunctionTable): SceneObject[] {
  const vertices = statement.vertices.map((v) => ({
    label: v.label,
    position: { x: evalExpr(v.x, {}, config.angle, functions), y: evalExpr(v.y, {}, config.angle, functions) },
  }))
  const pairs: [Vec2, Vec2][] = vertices.map((v, i) => [v.position, vertices[(i + 1) % vertices.length].position])
  const objects: SceneObject[] = [{ kind: 'segments', pairs, color: statement.color }]

  // Point labels default to a fixed up-right offset, which for a polygon
  // vertex often points straight at whatever else is anchored there (an
  // angle:/right-angle: mark always sits *inside* the shape at its own
  // vertex). Pointing each vertex's label away from the polygon's own
  // centroid instead means it lands outside the shape — away from any
  // interior marks — for every vertex, not just the ones where the default
  // offset happened to already point outward.
  const centroid = { x: 0, y: 0 }
  for (const v of vertices) {
    centroid.x += v.position.x / vertices.length
    centroid.y += v.position.y / vertices.length
  }
  for (const v of vertices) {
    const dx = v.position.x - centroid.x
    const dy = v.position.y - centroid.y
    const len = Math.hypot(dx, dy) || 1
    objects.push({
      kind: 'point',
      label: v.label,
      position: v.position,
      color: statement.color,
      labelDirection: { x: dx / len, y: dy / len },
      // Never push the label further from its vertex than a fraction of
      // that vertex's own distance to the centroid — keeps it from
      // wandering away from (or, at a small enough on-screen size,
      // overlapping *other* vertices' labels near) a polygon that's
      // shrunk to a few screen pixels, same reasoning as the mark clamps.
      maxLabelOffset: len * POLYGON_LABEL_MAX_FRACTION,
    })
  }
  return objects
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

function buildScatter(statement: Statement & { kind: 'scatter' }, bounds: Bounds, config: GraphConfig, functions: FunctionTable): { objects: SceneObject[]; regression: Scene['regression'] } {
  const points: Vec2[] = statement.points.map(([xExpr, yExpr]) => ({
    x: evalExpr(xExpr, {}, config.angle, functions),
    y: evalExpr(yExpr, {}, config.angle, functions),
  }))
  const objects: SceneObject[] = points.map((p) => ({ kind: 'point', label: null, position: p, color: statement.color }))
  if (points.length < 2) return { objects, regression: null }

  const regression = linearRegression(points)
  const line: Vec2[] = [
    { x: bounds.xMin, y: regression.slope * bounds.xMin + regression.intercept },
    { x: bounds.xMax, y: regression.slope * bounds.xMax + regression.intercept },
  ]
  objects.push({ kind: 'curve', points: line, color: statement.color })
  return { objects, regression }
}

// Rebuilds the full scene from parsed statements. `bounds` is the current
// camera viewport — functions, implicit curves, regions, and fields are
// sampled over it, so the scene is rebuilt on pan/zoom as well as on spec
// edits. `resolution` controls the marching-squares grid density for
// implicit curves/regions — the caller (GraphViewer.tsx) passes a reduced
// value while the view is actively being dragged, and the full
// IMPLICIT_RESOLUTION once it settles.
export function buildScene(statements: Statement[], bounds: Bounds, config: GraphConfig, resolution: number = IMPLICIT_RESOLUTION): Scene {
  const objects: SceneObject[] = []
  const errors: Scene['errors'] = []
  let regression: Scene['regression'] = null
  const functions = collectFunctions(statements)
  const namedPoints = collectNamedPoints(statements, config, functions)

  function resolvePoint(name: string): Vec2 {
    const point = namedPoints.get(name)
    if (!point) throw new Error(`Unknown point "${name}" — define it with a point statement (e.g. "${name} = (x, y)") or as a polygon vertex first`)
    return point
  }

  for (const statement of statements) {
    // "@hide: <name>" skips rendering only — collectFunctions above already
    // ran, so a hidden "k(x) = ..." (or a hidden "y = k(x) name: k") stays
    // fully usable by other statements' expressions; hiding just means this
    // statement's own SceneObjects aren't emitted.
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    try {
      if (statement.kind === 'explicit') {
        objects.push(...sampleExplicit(statement, bounds, config, functions))
      } else if (statement.kind === 'polar') {
        objects.push(...samplePolar(statement, config, functions))
      } else if (statement.kind === 'parametric') {
        objects.push(...sampleParametric(statement, config, functions))
      } else if (statement.kind === 'implicit') {
        objects.push(...traceImplicit(statement, bounds, config, resolution, functions))
      } else if (statement.kind === 'region') {
        objects.push(...buildRegion(statement, bounds, config, resolution, functions))
      } else if (statement.kind === 'field') {
        objects.push(...buildField(statement, bounds, config, functions))
      } else if (statement.kind === 'tangent') {
        objects.push(...buildTangent(statement, bounds, config, functions))
      } else if (statement.kind === 'scatter') {
        const built = buildScatter(statement, bounds, config, functions)
        objects.push(...built.objects)
        if (built.regression) regression = built.regression
      } else if (statement.kind === 'animatedPoint') {
        objects.push({
          kind: 'animatedPoint',
          fx: statement.fx,
          fy: statement.fy,
          param: statement.param,
          from: evalExpr(statement.from, {}, config.angle, functions),
          to: evalExpr(statement.to, {}, config.angle, functions),
          color: statement.color,
          functions,
        })
      } else if (statement.kind === 'point') {
        objects.push({
          kind: 'point',
          label: statement.label,
          position: { x: evalExpr(statement.x, {}, config.angle, functions), y: evalExpr(statement.y, {}, config.angle, functions) },
          color: statement.color,
        })
      } else if (statement.kind === 'segment') {
        objects.push({
          kind: 'segment',
          from: { x: evalExpr(statement.x1, {}, config.angle, functions), y: evalExpr(statement.y1, {}, config.angle, functions) },
          to: { x: evalExpr(statement.x2, {}, config.angle, functions), y: evalExpr(statement.y2, {}, config.angle, functions) },
          color: statement.color,
        })
      } else if (statement.kind === 'ray') {
        objects.push({
          kind: 'ray',
          from: { x: evalExpr(statement.x1, {}, config.angle, functions), y: evalExpr(statement.y1, {}, config.angle, functions) },
          to: { x: evalExpr(statement.x2, {}, config.angle, functions), y: evalExpr(statement.y2, {}, config.angle, functions) },
          color: statement.color,
        })
      } else if (statement.kind === 'vector') {
        const from = { x: evalExpr(statement.x1, {}, config.angle, functions), y: evalExpr(statement.y1, {}, config.angle, functions) }
        const to = { x: evalExpr(statement.x2, {}, config.angle, functions), y: evalExpr(statement.y2, {}, config.angle, functions) }
        const magnitude = Math.hypot(to.x - from.x, to.y - from.y)
        objects.push({ kind: 'ray', from, to, label: `|v| = ${formatCoord(magnitude)}`, color: statement.color })
      } else if (statement.kind === 'circle') {
        objects.push(...buildCircle(statement, config, functions))
      } else if (statement.kind === 'polygon') {
        objects.push(...buildPolygon(statement, config, functions))
      } else if (statement.kind === 'angle') {
        objects.push({
          kind: 'angleMark',
          from: resolvePoint(statement.from),
          vertex: resolvePoint(statement.vertex),
          to: resolvePoint(statement.to),
          label: statement.label,
          color: statement.color,
        })
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
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { objects, errors, regression }
}
