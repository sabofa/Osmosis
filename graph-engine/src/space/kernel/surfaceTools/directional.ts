// directional: f at (a, b) toward <u1, u2> (S4b, B7; OpenStax 4.6).
//
// u is normalised. Draws:
// - the unit arrow u on the box floor from (a, b);
// - the vertical plane through (a, b) along u where it meets the box (a
//   rectangle; opacity 0.2);
// - the trace s ↦ (a + s u1, b + s u2, f(…)) across the domain, with a pick;
// - its tangent at s = 0, of slope D_u f = ∇f · u, clipped to the box;
// - the point, and the readout D_u f, u and ∇f.
// A zero u is refused.

import type { Statement } from '../../../parser/types'
import { formatNumber } from '../../pick/format'
import type { LabelAnchor, LineMark, Mark, Vec3 } from '../../scene/types'
import { CURVE_WIDTH, Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, arrowMark, clipLine, clipToZ, lineMark, part, pointMark, polygonMesh, toolBox, verticalPlane } from './box'
import { pointText } from './readout'
import { preparePoint, prepareDomain, requireArity, requireInside, resolveTarget, surface2 } from './target'

const SEGMENTS = 512
const PLANE_OPACITY = 0.2
const TANGENT_WIDTH = 2

function prepareDirectional(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'directional') throw new Error(`not a directional derivative: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'directional')
  requireArity(target, 2, 'directional')
  const { f, fx, fy } = surface2(target, scope)
  const point = preparePoint(form.point, scope, reads)
  const toward = preparePoint(form.toward, scope, reads)
  const domain = prepareDomain(form.over, config, scope, reads)

  const build = (): BuildResult => {
    const [a, b] = point()
    const rect = domain()
    requireInside('directional', [a, b], [rect.x, rect.y])
    const [w1, w2] = toward()
    const norm = Math.hypot(w1, w2)
    if (!(norm > 0) || !Number.isFinite(norm)) {
      throw new Error(`directional: the direction ⟨${formatNumber(w1)}, ${formatNumber(w2)}⟩ has no length — give a nonzero u`)
    }
    const u: [number, number] = [w1 / norm, w2 / norm]
    const f0 = f(a, b)
    const p = fx(a, b)
    const q = fy(a, b)
    if (![f0, p, q].every(Number.isFinite)) throw new Error(`directional: f or ∇f is undefined at ${pointText([a, b])}`)
    const slope = p * u[0] + q * u[1]
    const box = toolBox(context, rect, (x, y) => f(x, y))
    const plane = verticalPlane(a, b, u, box)
    if (!plane) throw new Error(`directional: ${pointText([a, b])} is outside the domain`)

    const at = (s: number): Vec3 => {
      const x = a + s * u[0]
      const y = b + s * u[1]
      return [x, y, f(x, y)]
    }
    const [s0, s1] = plane.s
    const sampled: number[][] = []
    const sampledParams: number[][] = []
    let run: number[] = []
    let runParams: number[] = []
    const close = () => {
      if (runParams.length > 1) {
        sampled.push(run)
        sampledParams.push(runParams)
      }
      run = []
      runParams = []
    }
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = s0 + ((s1 - s0) * i) / SEGMENTS
      const v = at(s)
      if (!Number.isFinite(v[2])) {
        close()
        continue
      }
      run.push(...v)
      runParams.push(s)
    }
    close()
    const inside = clipToZ(sampled, sampledParams, box.z)

    const marks: Mark[] = []
    if (inside.runs.length > 0) {
      const curve: LineMark = {
        ...lineMark(context.source, inside.runs, context, { width: form.style.width ?? CURVE_WIDTH, params: Float64Array.from(inside.params.flat()) }),
        pick: {
          param: 's',
          r: at,
          dr: (s) => {
            const [x, y] = at(s)
            return [u[0], u[1], fx(x, y) * u[0] + fy(x, y) * u[1]]
          },
        },
      }
      marks.push(curve)
    }
    const planeMesh = polygonMesh(part(context, 'plane'), plane.corners, plane.normal, context, form.style.opacity ?? PLANE_OPACITY)
    if (planeMesh) marks.push(planeMesh)
    marks.push(arrowMark(part(context, 'u'), [{ tail: [a, b, box.z.min], vector: [u[0], u[1], 0] }], context))
    const P: Vec3 = [a, b, f0]
    const direction: Vec3 = [u[0], u[1], slope]
    const span = clipLine(P, direction, box)
    if (span) {
      const ends = span.flatMap((s) => [P[0] + s * direction[0], P[1] + s * direction[1], P[2] + s * direction[2]])
      marks.push(lineMark(part(context, 'tangent'), [ends], context, { width: TANGENT_WIDTH }))
    }
    marks.push(pointMark(part(context, 'point'), [P], context))
    const labels: LabelAnchor[] = [annotation(part(context, 'readout'), P, `D_u f = ${formatNumber(slope)}, u = ${pointText(u)}, ∇f = ${pointText([p, q])}`)]
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const DIRECTIONAL: BuilderEntry = { draws: true, prepare: prepareDirectional }
