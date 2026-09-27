// Implicit surfaces (plan A1; SP9): "x^2 + y^2 - z^2 = 1", and the forced
// reading "implicit: x^2 + y^2 = 4" (a cylinder). The level set
// left - right = 0 over the box (box.ts: @bounds3d, else [-5, 5] on each
// axis — an implicit surface cannot size the box from its own extent), meshed
// by marching tetrahedra at res^3 cubes (default 64; res: and @resolution
// override).
//
// Normals are the compiled simplify(diff) gradient of F, normalised, with the
// mesh-normal fallback (normals.ts) where the gradient is zero or not finite
// (a cone's apex). The pick re-evaluates F and its gradient. The default look
// is a flat colour by slot at opacity 1; "colormap: height" or an expression
// colours it as a parametric surface is coloured.

import type { Expr, Statement } from '../../../parser/types'
import { compileMany, compileScalar, type CompiledFn, type CompiledMany } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { sub } from '../../../math/expr'
import type { MathScope } from '../../../math/scope'
import { simplify } from '../../../math/simplify'
import type { ColormapClause, SpaceStyle } from '../../grammar/types'
import type { ColorScale, MeshMark, SurfacePick, Vec3 } from '../../scene/types'
import { boundNames, checkBudget, colorScale, Reads, renameBound } from '../common'
import { finishMesh } from '../mesh'
import { normalizeAt } from '../normals'
import { boxOf, type BuildContext, type BuildResult, type BuilderEntry, type PreparedStatement } from '../registry'
import { countTriangles, heldRes, implicitRes, marchingTets, sampleGrid, type Field, type Grid } from './marchingTets'

export const DEFAULT_IMPLICIT_RES = 64

export const XYZ: readonly string[] = ['x', 'y', 'z']

const NONE: ColormapClause = { by: { kind: 'none' }, map: null, diverging: false }

// F over (x, y, z) with its gradient, written into `out` with no allocation
// per call: what the mesher's normals and the pick read. S4b's level
// surfaces (surfaceTools/levelSurface.ts) pass their own compiled gradient.
export interface LevelField {
  f: Field
  grad: (out: Float64Array, x: number, y: number, z: number) => Float64Array
}

// F over (x, y, z), compiled with its gradient. x, y and z are renamed to the
// kernel's bound names before diff, as every builder does (common.ts).
export interface CompiledField extends LevelField {
  grad: CompiledMany
}

export function compileField(F: Expr, scope: MathScope): CompiledField {
  const vars = boundNames(3)
  const renamed = renameBound(F, XYZ)
  const f = compileScalar(renamed, vars, scope)
  const grad = compileMany(
    vars.map((v) => simplify(diff(renamed, v, scope))),
    vars,
    scope
  )
  return { f: (x, y, z) => f(x, y, z), grad }
}

export interface LevelMesh {
  positions: Float64Array
  normals: Float64Array
  indices: Uint32Array
}

// The level set F = level as a finished mesh, or null when it has no
// triangle in the box.
export function levelMesh(field: LevelField, grid: Grid, level: number): LevelMesh | null {
  const iso = marchingTets(field.f, grid, level)
  if (iso.indices.length === 0) return null
  const count = iso.positions.length / 3
  const normals = new Float64Array(3 * count)
  const g = new Float64Array(3)
  for (let v = 0; v < count; v++) {
    field.grad(g, iso.positions[3 * v], iso.positions[3 * v + 1], iso.positions[3 * v + 2])
    normals[3 * v] = g[0]
    normals[3 * v + 1] = g[1]
    normals[3 * v + 2] = g[2]
  }
  // uv is a placeholder (marching tetrahedra has no 2D domain): parameterized: false.
  const mesh = finishMesh({ positions: iso.positions, normals, uv: new Float64Array(2 * count), indices: iso.indices }, false, false)
  if (mesh.indices.length === 0) return null
  foldedNormals(mesh.positions, mesh.normals, mesh.indices)
  return { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices }
}

// The last fallback, where both the gradient and the area-weighted mean of
// the faces around a vertex vanish. That happens at a centrally symmetric
// singular point: the Kuhn split is symmetric under p -> -p, so at the apex of
// x^2 + y^2 = z^2 every face has an opposite whose normal cancels it. The
// normal there is the sum of the incident face normals, each flipped into the
// first one's hemisphere: its dot with the first is at least that face's
// |normal|, so it is never zero. Which direction an apex shades toward is a
// convention; it is deterministic.
function foldedNormals(positions: Float64Array, normals: Float64Array, indices: Uint32Array): void {
  const zero = new Set<number>()
  for (let v = 0; v < normals.length / 3; v++) {
    if (normals[3 * v] === 0 && normals[3 * v + 1] === 0 && normals[3 * v + 2] === 0) zero.add(v)
  }
  if (zero.size === 0) return
  const first = new Map<number, [number, number, number]>()
  const sums = new Map<number, [number, number, number]>()
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    if (!zero.has(a) && !zero.has(b) && !zero.has(c)) continue
    const e1 = [positions[3 * b] - positions[3 * a], positions[3 * b + 1] - positions[3 * a + 1], positions[3 * b + 2] - positions[3 * a + 2]]
    const e2 = [positions[3 * c] - positions[3 * a], positions[3 * c + 1] - positions[3 * a + 1], positions[3 * c + 2] - positions[3 * a + 2]]
    const n: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    for (const v of new Set([a, b, c])) {
      if (!zero.has(v)) continue
      const f = first.get(v) ?? n
      first.set(v, f)
      const sign = n[0] * f[0] + n[1] * f[1] + n[2] * f[2] < 0 ? -1 : 1
      const sum = sums.get(v) ?? [0, 0, 0]
      sums.set(v, [sum[0] + sign * n[0], sum[1] + sign * n[1], sum[2] + sign * n[2]])
    }
  }
  for (const [v, sum] of sums) {
    normals.set(sum, 3 * v)
    normalizeAt(normals, v)
  }
}

export function implicitPick(field: LevelField, level: number): SurfacePick {
  return {
    kind: 'implicit',
    F: (x, y, z) => field.f(x, y, z) - level,
    grad: (x, y, z): Vec3 => {
      const g = field.grad(new Float64Array(3), x, y, z)
      return [g[0], g[1], g[2]]
    },
  }
}

// mesh: on asks for lines at a parametrisation's steps; a level set has none.
export function refuseMeshLines(style: SpaceStyle, what: string): void {
  if (style.mesh === true) throw new Error(`mesh: on needs a parametrisation — ${what} has none`)
}

function implicitForm(statement: Statement): { left: Expr; right: Expr; style: SpaceStyle } {
  if (statement.kind === 'space' && statement.form.form === 'implicitSurface') return statement.form
  throw new Error(`not an implicit surface: ${statement.kind}`)
}

function prepareImplicit(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  const { left, right, style } = implicitForm(statement)
  refuseMeshLines(style, 'an implicit surface')
  const n = implicitRes(style.res, config.space.resolution, DEFAULT_IMPLICIT_RES)
  const F = sub(left, right)
  const reads = new Reads(scope).add(F, XYZ)
  const field = compileField(F, scope)
  const clause = style.colormap ?? NONE
  let paint: CompiledFn | null = null
  if (clause.by.kind === 'expr') {
    reads.add(clause.by.expr, XYZ)
    paint = compileScalar(clause.by.expr, XYZ, scope)
  }

  const build = (): BuildResult => {
    // S6 plan V11: a play or a drag can trigger this every frame — while
    // held (context.held, set by the kernel: the box is frozen for the same
    // reason), mesh at half the resolution (heldRes), then once more at the
    // full one when it releases (kernel/index.ts's builtHeld forces that
    // rebuild even if the box itself never moved).
    const activeRes = heldRes(n, context.held)
    const grid = sampleGrid(field.f, boxOf(context), activeRes)
    // The budget is checked before anything is meshed.
    checkBudget(countTriangles(grid, 0), activeRes)
    const mesh = levelMesh(field, grid, 0)
    if (!mesh) {
      return {
        marks: [],
        labels: [],
        errors: [{ line: context.line, message: 'The implicit surface has no points in the box — check the equation, or widen @bounds3d' }],
        colorScale: null,
      }
    }
    let scalars: Float64Array | null = null
    let scale: ColorScale | null = null
    if (clause.by.kind !== 'none' && context.colorScaleId !== null) {
      const vertices = mesh.positions.length / 3
      scalars = new Float64Array(vertices)
      for (let k = 0; k < vertices; k++) {
        const [x, y, z] = [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]]
        scalars[k] = paint ? paint(x, y, z) : z
      }
      scale = colorScale(clause, scalars, config, context.colorScaleId)
    }
    const mark: MeshMark = {
      kind: 'mesh',
      source: context.source,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      scalars,
      uv: null,
      style: { color: context.color, opacity: style.opacity ?? 1, colorScale: scale ? scale.id : null, meshLines: null },
      pick: implicitPick(field, 0),
    }
    return { marks: [mark], labels: [], errors: [], colorScale: scale }
  }

  return { reads: reads.names, build }
}

export const IMPLICIT_SURFACE: BuilderEntry = {
  draws: true,
  prepare: prepareImplicit,
  colorScale: (statement) => (implicitForm(statement).style.colormap ?? NONE).by.kind !== 'none',
}
