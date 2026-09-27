// gradient: f at (a, b) [lifted], and F at (x0, y0, z0) [surface] (S4b, B6;
// OpenStax 4.6).
//
// Two variables: ∇f(a, b) = (f_x, f_y, 0) as an arrow at true length from
// (a, b) on the box floor; the level curve of f through (a, b) on the floor
// (contours.ts at the single level f(a, b)); and a small right-angle mark
// where they meet, in the floor plane. "lifted" puts all three in the
// horizontal plane z = f(a, b) instead, where the level curve lies on the
// surface. The readout is ∇f, |∇f| and the direction of steepest ascent as
// an angle, in @angle's unit.
//
// Three variables: ∇F at true length from the point; "surface" adds the level
// surface through it (levelSurface.ts: S4a's marching tetrahedra, at S4a's
// resolution), or, when the level set meets no cell of the grid, says so on
// the line: at a strict extremum of F it is the point alone, and otherwise it
// is smaller than a cell and a finer res: finds it.
//
// A zero gradient is drawn as the point with the readout "∇f = 0 (a
// critical point)".

import type { Statement } from '../../../parser/types'
import { formatNumber } from '../../pick/format'
import type { LabelAnchor, Mark, MeshMark, SceneError, Vec3 } from '../../scene/types'
import { Reads, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, arrowMark, lineMark, part, pointMark, toolBox } from './box'
import { LEVEL_RES, levelCurves, lift } from './contours'
import { levelSurfaceRes, MESH_LEVEL_SURFACE } from './levelSurface'
import { pointText } from './readout'
import { preparePoint, prepareDomain, requireInside, resolveTarget, surface2, surface3 } from './target'

// The right-angle mark's side, as a fraction of the domain's larger span.
const SQUARE = 0.04
const LEVEL_WIDTH = 2
const SQUARE_WIDTH = 1.5

function angleText(radians: number, unit: 'radians' | 'degrees'): string {
  return unit === 'degrees' ? `${formatNumber((radians * 180) / Math.PI)}°` : `${formatNumber(radians)} rad`
}

function prepareGradient(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'gradient') throw new Error(`not a gradient: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'gradient')
  if (form.point.length !== target.arity) {
    throw new Error(
      target.arity === 2
        ? `gradient: a function of x and y takes a point (a, b), got ${form.point.length} coordinates`
        : `gradient: a function of x, y and z takes a point (x0, y0, z0), got ${form.point.length} coordinates`
    )
  }
  const point = preparePoint(form.point, scope, reads)
  const domain = prepareDomain(form.over, context, reads)

  if (target.arity === 2) {
    const { f, fx, fy } = surface2(target, scope)
    const res = resolution(form.style.res, config, LEVEL_RES)
    const build = (): BuildResult => {
      const [a, b] = point()
      const rect = domain()
      requireInside('gradient', [a, b], [rect.x, rect.y])
      const c = f(a, b)
      const p = fx(a, b)
      const q = fy(a, b)
      if (![c, p, q].every(Number.isFinite)) throw new Error(`gradient: ∇f is undefined at ${pointText([a, b])}`)
      const box = toolBox(context, rect)
      const z = form.lifted ? c : box.z.min
      const tail: Vec3 = [a, b, z]
      const marks: Mark[] = []
      const labels: LabelAnchor[] = []
      const length = Math.hypot(p, q)
      if (length === 0) {
        marks.push(pointMark(part(context, 'point'), [tail], context))
        labels.push(annotation(part(context, 'readout'), tail, '∇f = 0 (a critical point)'))
        return { marks, labels, errors: [], colorScale: null }
      }
      marks.push(arrowMark(context.source, [{ tail, vector: [p, q, 0] }], context))
      const level = levelCurves((x, y) => f(x, y) - c, rect, res)
      if (level.length > 0) marks.push(lineMark(part(context, 'level'), level.map((l) => lift(l, () => z)), context, { width: LEVEL_WIDTH }))
      // The mark's corner is the tail; its sides run along the level curve's
      // tangent (∇f turned a quarter) and along ∇f.
      const m = SQUARE * Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
      const g = [p / length, q / length]
      const t = [-g[1], g[0]]
      const square = [
        [a + m * t[0], b + m * t[1], z],
        [a + m * (t[0] + g[0]), b + m * (t[1] + g[1]), z],
        [a + m * g[0], b + m * g[1], z],
      ].flat()
      marks.push(lineMark(part(context, 'square'), [square], context, { width: SQUARE_WIDTH }))
      const text = `∇f = ${pointText([p, q])}, |∇f| = ${formatNumber(length)}, steepest ascent at θ = ${angleText(Math.atan2(q, p), scope.angle)}`
      labels.push(annotation(part(context, 'readout'), tail, text))
      return { marks, labels, errors: [], colorScale: null }
    }
    return { reads: reads.names, build }
  }

  const { F, grad } = surface3(target, scope)
  // Checked here, so a res: over S4a's limit is refused before any build.
  const surfaceRes = form.surface ? levelSurfaceRes(form.style.res, config) : 0
  const build = (): BuildResult => {
    const [x0, y0, z0] = point()
    const box = toolBox(context, domain())
    requireInside('gradient', [x0, y0, z0], [box.x, box.y, box.z], 'the box')
    const g: Vec3 = [grad[0](x0, y0, z0), grad[1](x0, y0, z0), grad[2](x0, y0, z0)]
    const length = Math.hypot(...g)
    if (!Number.isFinite(length)) throw new Error(`gradient: ∇F is undefined at ${pointText([x0, y0, z0])}`)
    const at: Vec3 = [x0, y0, z0]
    const marks: Mark[] = [pointMark(part(context, 'point'), [at], context)]
    const labels: LabelAnchor[] = []
    const errors: SceneError[] = []
    if (length === 0) {
      labels.push(annotation(part(context, 'readout'), at, '∇F = 0 (a critical point)'))
    } else {
      marks.unshift(arrowMark(context.source, [{ tail: at, vector: g }], context))
      labels.push(annotation(part(context, 'readout'), at, `∇F = ${pointText(g)}, |∇F| = ${formatNumber(length)}`))
    }
    if (form.surface) {
      const mesh = MESH_LEVEL_SURFACE({ F, grad }, F(x0, y0, z0), box, surfaceRes)
      if (!mesh) {
        errors.push({
          line: context.line,
          message: `gradient: the level set through ${pointText(at)} meets no cell at res ${surfaceRes} — at an extremum of F it is a single point; otherwise raise res:`,
        })
      } else {
        const surface: MeshMark = {
          kind: 'mesh',
          source: part(context, 'surface'),
          ...mesh,
          scalars: null,
          uv: null,
          style: { color: context.color, opacity: 0.45, colorScale: null, meshLines: null },
        }
        marks.push(surface)
      }
    }
    return { marks, labels, errors, colorScale: null }
  }
  return { reads: reads.names, build }
}

export const GRADIENT: BuilderEntry = { draws: true, prepare: prepareGradient }
