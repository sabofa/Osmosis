// trace: f at x = a [tangent at y = b], and with x and y swapped (S4b, B4;
// OpenStax 4.3, partial derivatives).
//
// Draws, for "at x = a":
// - the trace (a, y, f(a, y)) over the domain's y range, with a pick;
// - the slicing plane x = a where it meets the box, a patch at opacity 0.2;
// - the trace's copy on the back wall x = box x min, dashed: the curve "in
//   the plane", as a textbook draws it. The back wall is the one the default
//   camera (azimuth 40°) sees behind the data.
// With "tangent at y = b": the tangent line through (a, b, f(a, b)) with
// direction (0, 1, f_y(a, b)), clipped to the box, the point, and the slope
// ∂f/∂y (a, b) as its readout. "at y = b" is the same with the roles swapped.

import type { Statement } from '../../../parser/types'
import type { LabelAnchor, LineMark, Mark, Vec3 } from '../../scene/types'
import { constant, CURVE_WIDTH, Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, clipLine, lineMark, part, pointMark, polygonMesh, toolBox } from './box'
import { pointText } from './readout'
import { formatNumber } from '../../pick/format'
import { prepareDomain, requireArity, resolveTarget, surface2 } from './target'

const SEGMENTS = 512
const PLANE_OPACITY = 0.2
const WALL_WIDTH = 1.5
const TANGENT_WIDTH = 2

function prepareTrace(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'trace') throw new Error(`not a trace: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'trace')
  requireArity(target, 2, 'trace')
  const { f, fx, fy } = surface2(target, scope)
  reads.add(form.at)
  const at = constant(form.at, scope)
  const tangentAt = form.tangentAt ? (reads.add(form.tangentAt), constant(form.tangentAt, scope)) : null
  const domain = prepareDomain(form.over, config, scope, reads)
  const alongX = form.axis === 'y'
  const free = alongX ? 'x' : 'y'
  // The trace's point and derivative at the free coordinate s.
  const point = (c: number, s: number): Vec3 => (alongX ? [s, c, f(s, c)] : [c, s, f(c, s)])
  const slope = (c: number, s: number) => (alongX ? fx(s, c) : fy(c, s))

  const build = (): BuildResult => {
    const rect = domain()
    const box = toolBox(context, rect, (x, y) => f(x, y))
    const c = at()
    const fixed = alongX ? rect.y : rect.x
    if (!(c >= fixed.min && c <= fixed.max)) {
      throw new Error(`trace: ${form.axis} = ${formatNumber(c)} is outside the domain's ${form.axis} range [${formatNumber(fixed.min)}, ${formatNumber(fixed.max)}]`)
    }
    const range = alongX ? rect.x : rect.y

    const runs: number[][] = []
    const params: number[] = []
    let run: number[] = []
    let runParams: number[] = []
    const close = () => {
      if (runParams.length > 1) {
        runs.push(run)
        params.push(...runParams)
      }
      run = []
      runParams = []
    }
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = range.min + ((range.max - range.min) * i) / SEGMENTS
      const p = point(c, s)
      if (!Number.isFinite(p[2])) {
        close()
        continue
      }
      run.push(...p)
      runParams.push(s)
    }
    close()

    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    const width = form.style.width ?? CURVE_WIDTH
    if (runs.length > 0) {
      const curve: LineMark = {
        ...lineMark(context.source, runs, context, { width, params: Float64Array.from(params) }),
        pick: {
          param: free,
          r: (s) => point(c, s),
          dr: (s) => (alongX ? [1, 0, slope(c, s)] : [0, 1, slope(c, s)]),
        },
      }
      marks.push(curve)
      // The copy on the back wall parallel to the slicing plane.
      const wall = alongX ? box.y.min : box.x.min
      marks.push(lineMark(part(context, 'wall'), runs.map((r) => r.map((v, i) => (i % 3 === (alongX ? 1 : 0) ? wall : v))), context, { width: WALL_WIDTH, dashed: true }))
    }
    const corners: Vec3[] = alongX
      ? [
          [range.min, c, box.z.min],
          [range.max, c, box.z.min],
          [range.max, c, box.z.max],
          [range.min, c, box.z.max],
        ]
      : [
          [c, range.min, box.z.min],
          [c, range.max, box.z.min],
          [c, range.max, box.z.max],
          [c, range.min, box.z.max],
        ]
    const plane = polygonMesh(part(context, 'plane'), corners, alongX ? [0, 1, 0] : [1, 0, 0], context, form.style.opacity ?? PLANE_OPACITY)
    if (plane) marks.push(plane)

    if (tangentAt) {
      const s = tangentAt()
      const p = point(c, s)
      const m = slope(c, s)
      const xy = alongX ? [s, c] : [c, s]
      if (!Number.isFinite(p[2]) || !Number.isFinite(m)) {
        throw new Error(`trace: the surface has no tangent at ${pointText(xy)} — f or its partial derivative is undefined there`)
      }
      const direction: Vec3 = alongX ? [1, 0, m] : [0, 1, m]
      const span = clipLine(p, direction, box)
      if (span) {
        const ends = span.flatMap((u) => [p[0] + u * direction[0], p[1] + u * direction[1], p[2] + u * direction[2]])
        marks.push(lineMark(part(context, 'tangent'), [ends], context, { width: TANGENT_WIDTH }))
      }
      marks.push(pointMark(part(context, 'point'), [p], context))
      labels.push(annotation(part(context, 'slope'), p, `∂f/∂${free} ${pointText(xy)} = ${formatNumber(m)}`))
    }
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const TRACE: BuilderEntry = { draws: true, prepare: prepareTrace }
