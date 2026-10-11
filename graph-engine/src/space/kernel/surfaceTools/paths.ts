// path: on f along (x(t), y(t)) for t in [a, b] [toward (x0, y0)] (S4b, B3;
// OpenStax 4.2, limits along paths).
//
// Draws the space curve (x(t), y(t), f(x(t), y(t))) with a pick (r and r',
// symbolic), and its shadow on the box floor, dashed. With toward, the point
// (x0, y0) is marked on the floor and a ring marks where the path is heading,
// at (x0, y0, L). It is a readout of this path, not a proof of a limit:
// - t* is the parameter where the path comes nearest (x0, y0): the nearest of
//   the drawn samples, refined by Gauss-Newton on |(x, y)(t) - (x0, y0)|. A
//   path that does not reach (x0, y0) (within REACH of the domain's span) is
//   refused on the line; the curve still draws.
// - Each side of t* that exists is approached at t* ± h |b - a|, h = 1e-2,
//   1e-3, ..., 1e-8 (approachSide). A side's value is the one where
//   successive values differ least, with that difference as its error; its
//   digits follow the error (formatApprox), and a value within its error of 0
//   prints ≈ 0. Rounding makes the smallest h the worst ((1 - cos x)/x^2 at
//   x = 1e-8 is 0), which is why the last value is not simply taken.
// - |f| growing at least twofold at every step, whatever the sign (cos(1/x)/x^2
//   swings from 8623 to -3.6e15), grows without bound: no ring, and "f grows
//   without bound along this path". Not "the last few steps": rounding makes
//   a limit of 0 grow in its tail ((1 - cos x)/x^2 - 1/2 runs 4e-6, 4e-8,
//   then 1e-6, 1e-4, 0.02, 0.5), after shrinking first.
// - A limit is reported only where the successive differences shrink toward
//   the small-h end: they must not grow from the first up to the smallest,
//   and the smallest must be a tenth of the first or less. Otherwise f does
//   not settle (sin(1/x); sin(1/x)/x). Two sides that disagree beyond their
//   errors both show, with "no limit along this path".

import type { Expr, Statement } from '../../../parser/types'
import { compileVector } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { substitute } from '../../../math/expr'
import { simplify } from '../../../math/simplify'
import { formatNumber, formatPoint } from '../../pick/format'
import type { LabelAnchor, LineMark, Mark, SceneError, Vec3 } from '../../scene/types'
import { boundNames, constant, CURVE_WIDTH, Reads, renameBound, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, clipToZ, lineMark, part, pointMark, toolBox } from './box'
import { approxWithin, approxWithinFull } from './readout'
import { preparePoint, prepareDomain, requireArity, resolveTarget } from './target'

const DEFAULT_SEGMENTS = 512
const SHADOW_WIDTH = 1.5
// The approach offsets, as fractions of the parameter interval.
const APPROACH = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]
// A path reaches (x0, y0) when it comes within this fraction of the domain's
// larger span.
export const REACH = 1e-9
// Growth of |f| by this factor at every approach step is unbounded.
const GROWTH = 2
// Values settle when the successive differences shrink, from the first to the
// smallest, to this fraction of the first or less.
const SETTLE = 0.1

export type Side = { kind: 'value'; value: number; error: number } | { kind: 'unbounded' } | { kind: 'unsettled' } | { kind: 'undefined' }

// One side's estimate from the values f takes at h = 1e-2, ..., 1e-8 (NaN
// where undefined, or where the side runs out of path), in that order.
export function approachSide(values: readonly number[]): Side {
  const finite = values.filter(Number.isFinite)
  const n = finite.length
  if (n < 3) return { kind: 'undefined' }
  const grows = (k: number) => Math.abs(finite[k - 1]) > 0 && Math.abs(finite[k]) >= GROWTH * Math.abs(finite[k - 1])
  if (n >= 4 && finite.every((_, k) => k === 0 || grows(k))) return { kind: 'unbounded' }
  const d = finite.slice(1).map((v, k) => Math.abs(v - finite[k]))
  let best = 0
  for (let k = 1; k < d.length; k++) if (d[k] <= d[best]) best = k
  const shrinking = d.slice(1, best + 1).every((dk, k) => dk <= d[k])
  if (!shrinking || d[best] > SETTLE * d[0]) return { kind: 'unsettled' }
  return { kind: 'value', value: finite[best + 1], error: d[best] }
}

function preparePath(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'path') throw new Error(`not a path: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'path')
  requireArity(target, 2, 'path')

  // x(t) and y(t) over $0, then f composed with them.
  const t = form.t.param
  const [xt, yt] = form.along.map((e) => {
    reads.add(e, [t])
    return renameBound(e, [t], scope)
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
  const domain = prepareDomain(null, context, reads)
  const segments = resolution(form.style.res, config, DEFAULT_SEGMENTS)
  const q = new Float64Array(3)
  const dq = new Float64Array(3)

  // The parameter where (x(t), y(t)) comes nearest (x0, y0): the nearest
  // sample, then Gauss-Newton on the distance, kept in [a, b].
  const nearest = (a: number, b: number, x0: number, y0: number): { t: number; x: number; y: number; distance: number } | null => {
    let t0 = Number.NaN
    let best = Infinity
    for (let i = 0; i <= segments; i++) {
      const s = a + (b - a) * (i / segments)
      r(q, s)
      const d = Math.hypot(q[0] - x0, q[1] - y0)
      if (d < best) {
        best = d
        t0 = s
      }
    }
    if (!Number.isFinite(best)) return null
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    let s = t0
    for (let k = 0; k < 50; k++) {
      r(q, s)
      dr(dq, s)
      const jj = dq[0] * dq[0] + dq[1] * dq[1]
      if (!(jj > 0)) break
      const next = Math.min(hi, Math.max(lo, s - ((q[0] - x0) * dq[0] + (q[1] - y0) * dq[1]) / jj))
      if (!Number.isFinite(next) || next === s) break
      s = next
    }
    r(q, s)
    const distance = Math.hypot(q[0] - x0, q[1] - y0)
    if (distance <= best) return { t: s, x: q[0], y: q[1], distance }
    r(q, t0)
    return { t: t0, x: q[0], y: q[1], distance: best }
  }

  const build = (): BuildResult => {
    const a = from()
    const b = to()
    const box = toolBox(context, domain())
    const floor = box.z.min
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
    const inside = clipToZ(runs, runParams, box.z)
    if (inside.runs.length > 0) {
      const curve: LineMark = {
        ...lineMark(context.source, inside.runs, context, { width: form.style.width ?? CURVE_WIDTH, params: Float64Array.from(inside.params.flat()) }),
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
    }
    if (runs.length > 0) {
      const shadow = runs.map((points) => points.map((v, i) => (i % 3 === 2 ? floor : v)))
      marks.push(lineMark(part(context, 'shadow'), shadow, context, { width: SHADOW_WIDTH, dashed: true }))
    }

    const errors: SceneError[] = []
    if (toward) {
      const [x0, y0] = toward()
      const here = formatPoint([x0, y0])
      const target: Vec3 = [x0, y0, floor]
      const at = nearest(a, b, x0, y0)
      const rect = domain()
      const reach = REACH * Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
      if (!at || at.distance > reach) {
        const where = at ? `: its nearest point is ${formatPoint([at.x, at.y])}, at ${t} = ${formatNumber(at.t)}` : ''
        errors.push({ line: context.line, message: `path: the path does not reach ${here}${where}` })
        return { marks, labels, errors, colorScale: null }
      }
      marks.push(pointMark(part(context, 'toward'), [target], context))
      const room = 1e-12 * Math.abs(b - a)
      const sides: { name: string; side: Side }[] = []
      for (const [name, dir, open] of [
        ['before', -1, Math.abs(at.t - a) > room],
        ['after', 1, Math.abs(b - at.t) > room],
      ] as const) {
        if (!open) continue
        const values = APPROACH.map((h) => {
          const s = at.t + dir * (b - a) * h
          return (s - a) * (s - b) > 0 ? Number.NaN : r(p, s)[2]
        })
        sides.push({ name, side: approachSide(values) })
      }
      const found: { name: string; value: number; error: number }[] = []
      for (const { name, side } of sides) if (side.kind === 'value') found.push({ name, value: side.value, error: side.error })
      const readout = (position: Vec3, text: string, fullText?: string) => labels.push(annotation(part(context, 'readout'), position, text, fullText))
      if (sides.some((s) => s.side.kind === 'unbounded')) {
        readout(target, 'f grows without bound along this path')
      } else if (sides.some((s) => s.side.kind === 'unsettled')) {
        readout(target, `along this path, f does not settle near ${here}`)
      } else if (found.length === 0) {
        readout(target, `along this path, f has no finite value near ${here}`)
      } else {
        const [one, two] = found
        const slack = 1e-9 * Math.max(1, ...found.map((s) => Math.abs(s.value)))
        if (two && Math.abs(one.value - two.value) > one.error + two.error + slack) {
          marks.push(pointMark(part(context, 'limit'), found.map((s): Vec3 => [x0, y0, s.value]), context, 'ring', 12))
          const text = `along this path, f → ${approxWithin(one.value, one.error)} ${one.name} ${here} and ${approxWithin(two.value, two.error)} ${two.name} it: no limit along this path`
          const fullText = `along this path, f → ${approxWithinFull(one.value, one.error)} ${one.name} ${here} and ${approxWithinFull(two.value, two.error)} ${two.name} it: no limit along this path`
          readout([x0, y0, one.value], text, fullText)
        } else {
          const best = two && two.error < one.error ? two : one
          marks.push(pointMark(part(context, 'limit'), [[x0, y0, best.value]], context, 'ring', 12))
          readout([x0, y0, best.value], `along this path, f → ${approxWithin(best.value, best.error)}`, `along this path, f → ${approxWithinFull(best.value, best.error)}`)
        }
      }
    }
    return { marks, labels, errors, colorScale: null }
  }

  return { reads: reads.names, build }
}

export const PATH: BuilderEntry = { draws: true, prepare: preparePath }
