// path: on f along (x(t), y(t)) for t in [a, b] [toward (x0, y0)] (S4b, B3;
// OpenStax 4.2, limits along paths).
//
// Draws the space curve (x(t), y(t), f(x(t), y(t))) with a pick (r and r',
// symbolic), and its shadow on the box floor, dashed. With toward, the point
// (x0, y0) is marked on the floor and a ring marks where the path is heading:
// (x0, y0, L), where L is f along the path at t = end + h (b - a) for
// h = 1e-2, 1e-3, ..., 1e-8 toward the end nearest (x0, y0), the last finite
// value. It is shown with ≈: a readout of this path, not a proof of a limit.

import type { Expr, Statement } from '../../../parser/types'
import { compileVector } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { substitute } from '../../../math/expr'
import { simplify } from '../../../math/simplify'
import { formatApprox, formatPoint } from '../../pick/format'
import type { LabelAnchor, LineMark, Mark } from '../../scene/types'
import { boundNames, constant, CURVE_WIDTH, Reads, renameBound, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, lineMark, part, pointMark, toolBox } from './box'
import { compileOver, preparePoint, prepareDomain, requireArity, resolveTarget } from './target'

const DEFAULT_SEGMENTS = 512
const SHADOW_WIDTH = 1.5
// The approach offsets, as fractions of the parameter interval.
const APPROACH = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]

function preparePath(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'path') throw new Error(`not a path: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'path')
  requireArity(target, 2, 'path')
  const f = compileOver(target.body, target, scope)

  // x(t) and y(t) over $0, then f composed with them.
  const t = form.t.param
  const [xt, yt] = form.along.map((e) => {
    reads.add(e, [t])
    return renameBound(e, [t])
  })
  const zt = substitute(target.body, new Map<string, Expr>([['$0', xt], ['$1', yt]]))
  const vars = boundNames(1)
  const components: [Expr, Expr, Expr] = [xt, yt, zt]
  const r = compileVector(components, vars, scope)
  const dr = compileVector(components.map((e) => simplify(diff(e, vars[0], scope))) as [Expr, Expr, Expr], vars, scope)
  reads.add(form.t.from).add(form.t.to)
  const from = constant(form.t.from, scope)
  const to = constant(form.t.to, scope)
  const toward = form.toward ? preparePoint(form.toward, scope, reads) : null
  const domain = prepareDomain(null, config, scope, reads)
  const segments = resolution(form.style.res, config, DEFAULT_SEGMENTS)

  const build = (): BuildResult => {
    const a = from()
    const b = to()
    const floor = toolBox(context, domain(), (x, y) => f(x, y)).z.min
    const runs: number[][] = []
    const runParams: number[][] = []
    let run: number[] = []
    let params: number[] = []
    const p = new Float64Array(3)
    const close = () => {
      // A run of one point draws nothing.
      if (params.length > 1) {
        runs.push(run)
        runParams.push(params)
      }
      run = []
      params = []
    }
    for (let i = 0; i <= segments; i++) {
      const s = a + (b - a) * (i / segments)
      r(p, s)
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
        close()
        continue
      }
      run.push(p[0], p[1], p[2])
      params.push(s)
    }
    close()

    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    if (runs.length > 0) {
      const curve: LineMark = {
        ...lineMark(context.source, runs, context, { width: form.style.width ?? CURVE_WIDTH, params: Float64Array.from(runParams.flat()) }),
        pick: {
          param: t,
          r: (s) => {
            const out = r(new Float64Array(3), s)
            return [out[0], out[1], out[2]]
          },
          dr: (s) => {
            const out = dr(new Float64Array(3), s)
            return [out[0], out[1], out[2]]
          },
        },
      }
      marks.push(curve)
      const shadow = runs.map((points) => points.map((v, i) => (i % 3 === 2 ? floor : v)))
      marks.push(lineMark(part(context, 'shadow'), shadow, context, { width: SHADOW_WIDTH, dashed: true }))
    }

    if (toward) {
      const [x0, y0] = toward()
      const ends = [a, b].map((s) => r(new Float64Array(3), s))
      const nearA = Math.hypot(ends[0][0] - x0, ends[0][1] - y0) <= Math.hypot(ends[1][0] - x0, ends[1][1] - y0)
      const [end, inward] = nearA ? [a, b - a] : [b, a - b]
      let value = Number.NaN
      for (const h of APPROACH) {
        r(p, end + h * inward)
        if (Number.isFinite(p[2])) value = p[2]
      }
      marks.push(pointMark(part(context, 'toward'), [[x0, y0, floor]], context))
      if (Number.isFinite(value)) {
        marks.push(pointMark(part(context, 'limit'), [[x0, y0, value]], context, 'ring', 12))
        labels.push(annotation(part(context, 'readout'), [x0, y0, value], `along this path, f → ${formatApprox(value)}`))
      } else {
        labels.push(annotation(part(context, 'readout'), [x0, y0, floor], `along this path, f has no finite value near ${formatPoint([x0, y0])}`))
      }
    }
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const PATH: BuilderEntry = { draws: true, prepare: preparePath }
