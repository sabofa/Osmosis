import type { GraphConfig } from '../parser/config'
import { compileExpr, evalExpr, type FunctionTable } from '../parser/evalExpr'
import type { Expr, Statement } from '../parser/types'
import { traceImplicitCurve } from '../render/marchingSquares'
import type { Scene3D, SceneObject3D, Vec3 } from './types3d'

// Unlike the 2D view, orbiting/zooming a 3D camera doesn't change what
// world-space region should be sampled, so — unlike buildScene (2D) — there's
// no camera-bounds input here: surfaces and lifted 2D curves sample over a
// fixed default domain.
const DEFAULT_DOMAIN = { min: -5, max: 5 }
const CURVE_SAMPLES = 400
const SURFACE_RESOLUTION = 40
const IMPLICIT_RESOLUTION = 100

function evalZ(expr: Expr | null, bindings: Record<string, number>, functions: FunctionTable): number {
  return expr === null ? 0 : evalExpr(expr, bindings, 'radians', functions)
}

function collectFunctions(statements: Statement[]): FunctionTable {
  const functions: FunctionTable = {}
  for (const statement of statements) {
    if (statement.kind === 'functionDef') functions[statement.name] = { param: statement.param, body: statement.body }
    else if (statement.kind === 'constantDef') functions[statement.name] = { param: null, body: statement.value }
  }
  return functions
}

// Sampling loops below use compileExpr rather than evalExpr — same
// hot-per-sample-loop rationale as buildScene.ts (2D); see evalExpr.ts's
// comment on compileExpr. A surface alone samples (n+1)^2 grid points, each
// evaluating 1-3 sub-expressions, so it's worth compiling once up front
// rather than re-walking the AST from the root on every sample. One-off
// evaluations (a curve's "for t in [a, b]" bounds, a lone point/segment/ray)
// stay on evalExpr below, same as the 2D file.
function buildExplicitSurface(statement: Statement & { kind: 'surface' }, functions: FunctionTable): SceneObject3D[] {
  const n = SURFACE_RESOLUTION
  const body = compileExpr(statement.body, 'radians', functions)
  const positions: Vec3[] = []
  for (let j = 0; j <= n; j++) {
    const y = DEFAULT_DOMAIN.min + ((DEFAULT_DOMAIN.max - DEFAULT_DOMAIN.min) * j) / n
    for (let i = 0; i <= n; i++) {
      const x = DEFAULT_DOMAIN.min + ((DEFAULT_DOMAIN.max - DEFAULT_DOMAIN.min) * i) / n
      let z: number
      try {
        z = body({ x, y })
      } catch {
        z = NaN
      }
      positions.push({ x, y, z })
    }
  }
  return [{ kind: 'surface3d', rows: n + 1, cols: n + 1, positions }]
}

function buildParametricSurface(statement: Statement & { kind: 'parametricSurface' }, functions: FunctionTable): SceneObject3D[] {
  const n = SURFACE_RESOLUTION
  const uFrom = evalExpr(statement.uFrom, {}, 'radians', functions)
  const uTo = evalExpr(statement.uTo, {}, 'radians', functions)
  const vFrom = evalExpr(statement.vFrom, {}, 'radians', functions)
  const vTo = evalExpr(statement.vTo, {}, 'radians', functions)
  const fx = compileExpr(statement.fx, 'radians', functions)
  const fy = compileExpr(statement.fy, 'radians', functions)
  const fz = compileExpr(statement.fz, 'radians', functions)
  const positions: Vec3[] = []
  for (let j = 0; j <= n; j++) {
    const v = vFrom + ((vTo - vFrom) * j) / n
    for (let i = 0; i <= n; i++) {
      const u = uFrom + ((uTo - uFrom) * i) / n
      const bindings = { [statement.paramU]: u, [statement.paramV]: v }
      let point: Vec3
      try {
        point = { x: fx(bindings), y: fy(bindings), z: fz(bindings) }
      } catch {
        point = { x: NaN, y: NaN, z: NaN }
      }
      positions.push(point)
    }
  }
  return [{ kind: 'surface3d', rows: n + 1, cols: n + 1, positions }]
}

function buildParametricCurve(statement: Statement & { kind: 'parametric' }, functions: FunctionTable): SceneObject3D[] {
  const from = evalExpr(statement.from, {}, 'radians', functions)
  const to = evalExpr(statement.to, {}, 'radians', functions)
  const fx = compileExpr(statement.fx, 'radians', functions)
  const fy = compileExpr(statement.fy, 'radians', functions)
  const fz = statement.fz === null ? null : compileExpr(statement.fz, 'radians', functions)
  const points: Vec3[] = []
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = from + ((to - from) * i) / CURVE_SAMPLES
    try {
      const bindings = { [statement.param]: t }
      const point = { x: fx(bindings), y: fy(bindings), z: fz === null ? 0 : fz(bindings) }
      if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) points.push(point)
    } catch {
      // skip undefined points
    }
  }
  return [{ kind: 'curve3d', points }]
}

// Lifts a 2D explicit function (y=f(x) or x=f(y)) onto the z=0 plane.
function buildLiftedExplicit(statement: Statement & { kind: 'explicit' }, functions: FunctionTable): SceneObject3D[] {
  const body = compileExpr(statement.body, 'radians', functions)
  const points: Vec3[] = []
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = DEFAULT_DOMAIN.min + ((DEFAULT_DOMAIN.max - DEFAULT_DOMAIN.min) * i) / CURVE_SAMPLES
    try {
      const other = body({ [statement.independent]: t })
      const point =
        statement.independent === 'x' ? { x: t, y: other, z: 0 } : { x: other, y: t, z: 0 }
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point)
    } catch {
      // skip undefined points
    }
  }
  return [{ kind: 'curve3d', points }]
}

// Lifts a 2D implicit curve (conics, etc.) onto the z=0 plane via the same
// marching-squares tracer the 2D renderer uses.
function buildLiftedImplicit(statement: Statement & { kind: 'implicit' }, functions: FunctionTable): SceneObject3D[] {
  const left = compileExpr(statement.left, 'radians', functions)
  const right = compileExpr(statement.right, 'radians', functions)
  const bindings: Record<string, number> = { x: 0, y: 0 }
  const f = (x: number, y: number) => {
    bindings.x = x
    bindings.y = y
    return left(bindings) - right(bindings)
  }
  const bounds = { xMin: DEFAULT_DOMAIN.min, xMax: DEFAULT_DOMAIN.max, yMin: DEFAULT_DOMAIN.min, yMax: DEFAULT_DOMAIN.max }
  const segments = traceImplicitCurve(f, bounds, IMPLICIT_RESOLUTION)
  return segments.map(([from, to]) => ({
    kind: 'segment3d' as const,
    from: { x: from.x, y: from.y, z: 0 },
    to: { x: to.x, y: to.y, z: 0 },
  }))
}

// Builds the full 3D scene from parsed statements. 2D-shaped statements
// (points, segments, rays, curves, conics without a z component) are lifted
// onto the z=0 plane so a spec can freely mix 2D and 3D statements.
export function buildScene3d(statements: Statement[], config: GraphConfig): Scene3D {
  const objects: SceneObject3D[] = []
  const errors: Scene3D['errors'] = []
  const functions = collectFunctions(statements)

  for (const statement of statements) {
    // See buildScene.ts (2D) for why this only skips rendering, not
    // collectFunctions's use of the statement above.
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    try {
      if (statement.kind === 'surface') {
        objects.push(...buildExplicitSurface(statement, functions))
      } else if (statement.kind === 'parametricSurface') {
        objects.push(...buildParametricSurface(statement, functions))
      } else if (statement.kind === 'parametric') {
        objects.push(...buildParametricCurve(statement, functions))
      } else if (statement.kind === 'explicit') {
        objects.push(...buildLiftedExplicit(statement, functions))
      } else if (statement.kind === 'implicit') {
        objects.push(...buildLiftedImplicit(statement, functions))
      } else if (statement.kind === 'point') {
        objects.push({
          kind: 'point3d',
          label: statement.label,
          position: { x: evalExpr(statement.x, {}, 'radians', functions), y: evalExpr(statement.y, {}, 'radians', functions), z: evalZ(statement.z, {}, functions) },
        })
      } else if (statement.kind === 'segment') {
        objects.push({
          kind: 'segment3d',
          from: { x: evalExpr(statement.x1, {}, 'radians', functions), y: evalExpr(statement.y1, {}, 'radians', functions), z: evalZ(statement.z1, {}, functions) },
          to: { x: evalExpr(statement.x2, {}, 'radians', functions), y: evalExpr(statement.y2, {}, 'radians', functions), z: evalZ(statement.z2, {}, functions) },
        })
      } else if (statement.kind === 'ray') {
        objects.push({
          kind: 'ray3d',
          from: { x: evalExpr(statement.x1, {}, 'radians', functions), y: evalExpr(statement.y1, {}, 'radians', functions), z: evalZ(statement.z1, {}, functions) },
          to: { x: evalExpr(statement.x2, {}, 'radians', functions), y: evalExpr(statement.y2, {}, 'radians', functions), z: evalZ(statement.z2, {}, functions) },
        })
      }
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { objects, errors }
}
