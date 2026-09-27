// Curve frames, the osculating circle, and motion (plan A6; SP9 rows 3.1-3.4).
// r' and r'' are symbolic (diff per component), evaluated at the statement's
// parameter value, which may read bindings.
//
//   T = r'/|r'|,  N = (r'' - (r''·T)T) / |that|,  B = T × N,
//   κ = |r' × r''| / |r'|^3
//
// frame: r at t = 1
//   s<line>         T, N and B as arrows from r(t), each 0.18 × the box's
//                   largest span long (box.ts) so they are visible, labelled
//   s<line>.point   r(t)
//   |r'| = 0 is refused ("r′(1) = 0: the curve has no tangent there"); κ = 0
//   draws T alone and reports N and B undefined.
// osculating: r at t = 1
//   s<line>         the circle of radius 1/κ about r + N/κ in the plane of T
//                   and N, 256 segments, starting and ending at r(t)
//   s<line>.point, s<line>.centre (a ring); labels κ and the radius. κ = 0 is
//   refused.
// motion: r at t = 1 [components]
//   s<line>         v = r' and a = r'' as arrows from r(t), at true length
//   labels          v and a at their tips, and one readout at r(t):
//                   "|v| = ... · a_T = a·T (signed) · |a_N| = ..."
//   with components, a_T = (a·T)T and a_N = a - a_T as dashed arrows: a
//   dashed shaft (s<line>.components) and a head with no shaft of its own
//   (s<line>.componentHeads), since an ArrowMark has no dash. A zero part
//   draws nothing.

import type { Expr, Statement } from '../../../parser/types'
import { compileMany } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { substitute, variable } from '../../../math/expr'
import { isVectorBody, type MathScope } from '../../../math/scope'
import { simplify } from '../../../math/simplify'
import type { CurveFrameForm } from '../../grammar/keywords/geometryForms'
import { formatNumber } from '../../pick/format'
import type { LabelAnchor, Mark, PointMark, SceneError } from '../../scene/types'
import { boundNames, constant, Reads, renameBound } from '../common'
import { largestSpan, spaceBox } from '../geometry/box'
import { add, cross, dot, isFiniteV, norm, scale, sub, unit, type V3 } from '../geometry/vec'
import { arrowMark, label, polylines } from '../geometry/vectorOps'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'

export const FRAME_SPAN = 0.18
export const CIRCLE_SEGMENTS = 256
const POINT_SIZE = 8
const CURVE_WIDTH = 2
// κ = 0 when |r' × r''| is below this fraction of |r'||r''| (a straight line
// gives exactly 0).
const STRAIGHT_REL = 1e-12
// r' = 0 when |r'| is below this fraction of the summed sizes of the terms
// of its components (a cancellation, not a speed).
export const STATIONARY_REL = 1e-9

// The terms of a sum as written: a - b + c gives a, b and c (a negated term
// is the same size).
function terms(e: Expr): Expr[] {
  if (e.kind === 'binary' && (e.op === '+' || e.op === '-')) return [...terms(e.left), ...terms(e.right)]
  if (e.kind === 'unary') return terms(e.arg)
  return [e]
}

export interface Frame {
  T: V3
  N: V3 | null
  B: V3 | null
  kappa: number
}

// The frame from r' and r'' (|r'| > 0). N and B are null where κ = 0.
export function curveFrame(d1: V3, d2: V3): Frame {
  const T = unit(d1)
  const speed = norm(d1)
  const c = norm(cross(d1, d2))
  if (!(c > STRAIGHT_REL * speed * norm(d2))) return { T, N: null, B: null, kappa: 0 }
  const N = unit(sub(d2, scale(T, dot(d2, T))))
  return { T, N, B: cross(T, N), kappa: c / speed ** 3 }
}

function curveForm(statement: Statement): CurveFrameForm {
  if (statement.kind === 'space' && (statement.form.form === 'frame' || statement.form.form === 'osculating' || statement.form.form === 'motion')) {
    return statement.form
  }
  throw new Error(`not a curve frame: ${statement.kind}`)
}

// The curve's components over the bound name $0.
function curveComponents(form: CurveFrameForm, scope: MathScope, reads: Reads): [Expr, Expr, Expr] {
  const curve = form.curve
  if (curve.kind === 'inline') {
    return curve.components.map((e) => {
      reads.add(e, [form.param])
      return renameBound(e, [form.param])
    }) as [Expr, Expr, Expr]
  }
  const name = curve.name
  const fn = scope.functions.get(name)
  if (!fn || !isVectorBody(fn.body)) throw new Error(`"${name}" is not a curve — define it with "${name}(t) = <cos(t), sin(t), t>"`)
  if (fn.params.length === 0) throw new Error(`"${name}" is a vector, not a curve — a curve is "${name}(t) = <cos(t), sin(t), t>"`)
  if (fn.params.length > 1) throw new Error(`"${name}" is a function of (${fn.params.join(', ')}), not a curve r(t)`)
  const [param] = fn.params
  const at = new Map([[param, variable(boundNames(1)[0])]])
  return fn.body.map((e) => {
    reads.add(e, [param])
    return substitute(e, at)
  }) as [Expr, Expr, Expr]
}

function prepareCurveFrame(statement: Statement, context: BuildContext): PreparedStatement {
  const form = curveForm(statement)
  const { scope } = context
  const reads = new Reads(scope)
  const vars = boundNames(1)
  const r = curveComponents(form, scope, reads)
  const d1 = r.map((e) => simplify(diff(e, vars[0], scope)))
  const d2 = d1.map((e) => simplify(diff(e, vars[0], scope)))
  const sample = compileMany([...r, ...d1, ...d2], vars, scope)
  const termList = d1.flatMap(terms)
  const sizes = compileMany(termList, vars, scope)
  const sized = new Float64Array(termList.length)
  // r' is 0 when it is below STATIONARY_REL of the sizes of the terms it is
  // the sum of: at the cycloid's cusp 1 - cos(2 pi) cancels two terms of
  // size 1 to 2.4e-16, which is not a speed.
  const stationary = (v: V3, t: number) => {
    sizes(sized, t)
    let size = 0
    for (const term of sized) size += Math.abs(term)
    return norm(v) <= STATIONARY_REL * size
  }
  reads.add(form.at)
  const at = constant(form.at, scope)
  const name = form.curve.kind === 'named' ? form.curve.name : 'r'

  const build = (): BuildResult => {
    const t = at()
    const s = sample(new Float64Array(9), t)
    const p: V3 = [s[0], s[1], s[2]]
    const a: V3 = [s[6], s[7], s[8]]
    const v: V3 = stationary([s[3], s[4], s[5]], t) ? [0, 0, 0] : [s[3], s[4], s[5]]
    const where = `${form.param} = ${formatNumber(t)}`
    if (!isFiniteV(p) || !isFiniteV(v) || !isFiniteV(a)) throw new Error(`${name} is not defined at ${where}`)
    const noTangent = () => new Error(`${name}′(${formatNumber(t)}) = 0: the curve has no tangent there`)
    const point: PointMark = {
      kind: 'points',
      source: { ...context.source, object: `${context.source.object}.point` },
      positions: Float64Array.from(p),
      style: { color: context.color, size: POINT_SIZE, shape: 'dot' },
    }

    if (form.form === 'motion') return buildMotion(form, context, p, v, a, point, noTangent)
    if (norm(v) === 0) throw noTangent()
    const frame = curveFrame(v, a)

    if (form.form === 'frame') {
      const L = FRAME_SPAN * largestSpan(spaceBox(context.config))
      const axes: [string, V3][] = frame.N && frame.B ? [['T', frame.T], ['N', frame.N], ['B', frame.B]] : [['T', frame.T]]
      const vectors = axes.map(([, u]) => scale(u, L))
      const labels = axes.map(([text], i) => label(context, text, add(p, vectors[i]), text, 'point'))
      const errors: SceneError[] = frame.N ? [] : [{ line: context.line, message: `The curvature is zero at ${where}; N and B are undefined` }]
      return { marks: [arrowMark(context, null, context.color, p, vectors), point], labels, errors, colorScale: null }
    }

    // osculating
    if (!frame.N) throw new Error(`The curvature is zero at ${where} — there is no osculating circle`)
    const radius = 1 / frame.kappa
    const centre = add(p, scale(frame.N, radius))
    const circle: V3[] = []
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const angle = (2 * Math.PI * i) / CIRCLE_SEGMENTS
      circle.push(add(centre, scale(add(scale(frame.N, -Math.cos(angle)), scale(frame.T, Math.sin(angle))), radius)))
    }
    circle.push(circle[0])
    const line = polylines(context, 'circle', context.color, [circle], form.style.width ?? CURVE_WIDTH, form.style.dashed)
    const marks: Mark[] = [
      { ...line, source: context.source },
      point,
      { ...point, source: { ...context.source, object: `${context.source.object}.centre` }, positions: Float64Array.from(centre), style: { ...point.style, shape: 'ring' } },
    ]
    const labels: LabelAnchor[] = [
      label(context, 'kappa', p, `κ = ${formatNumber(frame.kappa)}`, 'annotation'),
      label(context, 'radius', centre, `radius = ${formatNumber(radius)}`, 'annotation'),
    ]
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

function buildMotion(form: CurveFrameForm, context: BuildContext, p: V3, v: V3, a: V3, point: PointMark, noTangent: () => Error): BuildResult {
  const drawn: [string, V3][] = (
    [
      ['v', v],
      ['a', a],
    ] as [string, V3][]
  ).filter(([, u]) => norm(u) > 0)
  const marks: Mark[] = []
  if (drawn.length > 0) {
    marks.push(
      arrowMark(
        context,
        null,
        context.color,
        p,
        drawn.map(([, u]) => u)
      )
    )
  }
  marks.push(point)
  const labels: LabelAnchor[] = drawn.map(([text, u]) => label(context, text, add(p, u), text, 'point'))
  const speed = norm(v)
  // One readout, so the numbers never print over each other.
  const readout = label(context, 'readout', p, `|v| = ${formatNumber(speed)}`, 'annotation')
  labels.push(readout)
  if (speed > 0) {
    const T = unit(v)
    const tangential = dot(a, T)
    const aT = scale(T, tangential)
    const aN = sub(a, aT)
    readout.text += ` · a_T = ${formatNumber(tangential)} · |a_N| = ${formatNumber(norm(aN))}`
    if (form.components) {
      const parts = (
        [
          ['a_T', aT],
          ['a_N', aN],
        ] as [string, V3][]
      ).filter(([, u]) => norm(u) > 0)
      if (parts.length > 0) {
        marks.push(
          polylines(
            context,
            'components',
            context.color,
            parts.map(([, u]) => [p, add(p, u)]),
            CURVE_WIDTH,
            true
          )
        )
        marks.push(
          arrowMark(
            context,
            'componentHeads',
            context.color,
            p,
            parts.map(([, u]) => u),
            0
          )
        )
        for (const [text, u] of parts) labels.push(label(context, text, add(p, u), text, 'point'))
      }
    }
  } else if (form.components) {
    throw noTangent()
  }
  return { marks, labels, errors: [], colorScale: null }
}

export const CURVE_FRAME: BuilderEntry = { draws: true, prepare: prepareCurveFrame }
