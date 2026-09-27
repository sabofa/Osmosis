// "cross:" and "project:" (plan A4). Every tail sits at P (the origin unless
// "at" names a point).
//
// cross: u x v
//   s<line>                u × v, an arrow in the statement's colour
//   s<line>.operands       u and v, grey arrows
//   s<line>.parallelogram  P, P+u, P+u+v, P+v at opacity 0.3, wound about u × v
//   s<line>.outline        its outline
//   s<line>.right          right-angle marks between u × v and u, and u × v
//                          and v: the corner of a square in the plane each
//                          pair spans
//   labels                 u, v and u × v at their tips, and the readout
//                          "area = |u × v| = ..."
//   Parallel operands are refused: u × v = 0.
//
// project: u onto v
//   s<line>                proj_v u = (u·v / v·v) v, a bold arrow (3 px)
//   s<line>.operands       u and v, grey arrows
//   s<line>.perpendicular  u − proj_v u, dashed, from the projection's tip to u's
//   s<line>.right          a right-angle mark at the projection's tip
//   labels                 u and v at their tips, and one readout at the
//                          projection's midpoint: "comp_v u = u·v/|v| · θ = ...",
//                          the angle in degrees or radians per @angle, as a
//                          decimal (one label, so the numbers never overprint)
//   A zero u or v is refused.
//
// A right-angle mark's side is 0.08 × the box's largest span (box.ts), but
// never more than a quarter of the shorter leg it sits on, so the mark stays
// inside the figure when the box is much larger than the vectors.
//
// Operand names label the drawing when the operands are named ("a × b");
// literals are called u and v.

import type { Statement } from '../../../parser/types'
import type { VectorOpForm, VectorOperand } from '../../grammar/keywords/geometryForms'
import { formatNumber } from '../../pick/format'
import type { ArrowMark, ColorSpec, LabelAnchor, LineMark, Mark, MeshMark } from '../../scene/types'
import { DASH, Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { largestSpan, spaceBox } from './box'
import { preparePoint, prepareVector } from './operands'
import { add, cross, dot, isFiniteV, norm, scale, sub, unit, type V3 } from './vec'

export const PARALLELOGRAM_OPACITY = 0.3
export const RIGHT_ANGLE_SPAN = 0.08
const RIGHT_ANGLE_LEG = 0.25
const SHAFT = 2
const BOLD_SHAFT = 3
const HEAD = 10
const THIN = 1.5
// u and v are parallel when |u × v| is below this fraction of |u||v|.
const PARALLEL_REL = 1e-12

export const GREY = 'gray'

function grey(color: ColorSpec): ColorSpec {
  return { author: GREY, slot: color.slot }
}

function vectorOpForm(statement: Statement): VectorOpForm {
  if (statement.kind === 'space' && (statement.form.form === 'cross' || statement.form.form === 'project')) return statement.form
  throw new Error(`not a vector operation: ${statement.kind}`)
}

// How an operand is called in the drawing: its name, or u / v.
function nameOf(op: VectorOperand, fallback: string): string {
  return op.kind === 'named' && op.args === null ? op.name : fallback
}

export function arrowMark(context: BuildContext, part: string | null, color: ColorSpec, tail: V3, vectors: V3[], shaftWidth = SHAFT): ArrowMark {
  return {
    kind: 'arrows',
    source: part ? { ...context.source, object: `${context.source.object}.${part}` } : context.source,
    tails: Float64Array.from(vectors.flatMap(() => tail)),
    vectors: Float64Array.from(vectors.flat()),
    style: { color, shaftWidth, headSize: HEAD, hidden: 'dashed' },
  }
}

export function polylines(context: BuildContext, part: string, color: ColorSpec, lines: V3[][], width: number, dashed: boolean): LineMark {
  const starts: number[] = []
  const positions: number[] = []
  for (const line of lines) {
    starts.push(positions.length / 3)
    for (const p of line) positions.push(...p)
  }
  return {
    kind: 'lines',
    source: { ...context.source, object: `${context.source.object}.${part}` },
    positions: Float64Array.from(positions),
    starts: Uint32Array.from(starts),
    params: null,
    style: { color, width, dash: dashed ? DASH : null, hidden: 'dashed' },
    pick: null,
  }
}

// The corner of a square of side s at `at`, along unit vectors a and b.
export function rightAngle(at: V3, a: V3, b: V3, s: number): V3[] {
  return [add(at, scale(a, s)), add(at, add(scale(a, s), scale(b, s))), add(at, scale(b, s))]
}

export function rightAngleSide(context: BuildContext, legs: readonly number[]): number {
  return Math.min(RIGHT_ANGLE_SPAN * largestSpan(spaceBox(context.config)), RIGHT_ANGLE_LEG * Math.min(...legs))
}

export function label(context: BuildContext, part: string, position: V3, text: string, kind: LabelAnchor['kind']): LabelAnchor {
  return { source: { ...context.source, object: `${context.source.object}.${part}` }, position, text, kind }
}

function prepareVectorOp(statement: Statement, context: BuildContext): PreparedStatement {
  const form = vectorOpForm(statement)
  const reads = new Reads(context.scope)
  const U = prepareVector(form.u, context, reads)
  const V = prepareVector(form.v, context, reads)
  const at = form.at ? preparePoint(form.at, context, reads) : () => [0, 0, 0] as V3
  const [u, v] = [nameOf(form.u, 'u'), nameOf(form.v, 'v')]
  const build = form.form === 'cross' ? () => buildCross(form, context, U(), V(), at(), u, v) : () => buildProject(form, context, U(), V(), at(), u, v)
  return { reads: reads.names, build }
}

function finite(form: VectorOpForm, ...vs: V3[]): void {
  if (!vs.every(isFiniteV)) throw new Error(`${form.form}: ${form.u.text}, ${form.v.text} is not finite`)
}

function buildCross(form: VectorOpForm, context: BuildContext, U: V3, V: V3, P: V3, u: string, v: string): BuildResult {
  finite(form, U, V, P)
  const W = cross(U, V)
  const area = norm(W)
  if (!(area > PARALLEL_REL * norm(U) * norm(V))) throw new Error(`${u} and ${v} are parallel; ${u} × ${v} = 0`)
  const color = context.color
  const n = unit(W)
  const corners: V3[] = [P, add(P, U), add(P, add(U, V)), add(P, V)]
  const face: MeshMark = {
    kind: 'mesh',
    source: { ...context.source, object: `${context.source.object}.parallelogram` },
    positions: Float64Array.from(corners.flat()),
    normals: Float64Array.from(corners.flatMap(() => n)),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    scalars: null,
    uv: null,
    style: { color, opacity: form.style.opacity ?? PARALLELOGRAM_OPACITY, colorScale: null, meshLines: null },
    pick: null,
  }
  const side = rightAngleSide(context, [norm(U), norm(V), area])
  const marks: Mark[] = [
    arrowMark(context, null, color, P, [W]),
    arrowMark(context, 'operands', grey(color), P, [U, V]),
    face,
    polylines(context, 'outline', color, [[...corners, P]], THIN, false),
    polylines(context, 'right', grey(color), [rightAngle(P, unit(U), n, side), rightAngle(P, unit(V), n, side)], THIN, false),
  ]
  const labels = [
    label(context, 'u', add(P, U), u, 'point'),
    label(context, 'v', add(P, V), v, 'point'),
    label(context, 'result', add(P, W), `${u} × ${v}`, 'point'),
    label(context, 'area', add(P, scale(add(U, V), 0.5)), `area = |${u} × ${v}| = ${formatNumber(area)}`, 'annotation'),
  ]
  return { marks, labels, errors: [], colorScale: null }
}

function buildProject(form: VectorOpForm, context: BuildContext, U: V3, V: V3, P: V3, u: string, v: string): BuildResult {
  finite(form, U, V, P)
  if (norm(V) === 0) throw new Error(`${form.v.text} is the zero vector — there is nothing to project onto`)
  if (norm(U) === 0) throw new Error(`${form.u.text} is the zero vector — its projection and its angle with ${v} are undefined`)
  const color = context.color
  const proj = scale(V, dot(U, V) / dot(V, V))
  const perp = sub(U, proj)
  const tip = add(P, proj)
  const marks: Mark[] = []
  // A zero projection (u ⟂ v) or a zero perpendicular part (u ∥ v) draws
  // nothing of its own. Zero is relative to |u|: (0.1, 0.2, 0.3) onto
  // (0.3, 0.6, 0.9) leaves a perpendicular part of ~1e-17 from rounding.
  const projZero = norm(proj) <= PARALLEL_REL * norm(U)
  const perpZero = norm(perp) <= PARALLEL_REL * norm(U)
  if (!projZero) marks.push(arrowMark(context, null, color, P, [proj], BOLD_SHAFT))
  marks.push(arrowMark(context, 'operands', grey(color), P, [U, V]))
  if (!perpZero) marks.push(polylines(context, 'perpendicular', grey(color), [[tip, add(P, U)]], THIN, true))
  if (!projZero && !perpZero) {
    const side = rightAngleSide(context, [norm(proj), norm(perp)])
    marks.push(polylines(context, 'right', grey(color), [rightAngle(tip, unit(scale(proj, -1)), unit(perp), side)], THIN, false))
  } else if (projZero) {
    const side = rightAngleSide(context, [norm(U), norm(V)])
    marks.push(polylines(context, 'right', grey(color), [rightAngle(P, unit(V), unit(U), side)], THIN, false))
  }
  // atan2(|u × v|, u·v) keeps a small angle that acos(u·v / |u||v|) rounds
  // to 0 (<1, 1e-8, 0> onto <1, 0, 0>); |u × v| from rounding alone is 0.
  const sine = norm(cross(U, V))
  const theta = Math.atan2(sine <= PARALLEL_REL * norm(U) * norm(V) ? 0 : sine, dot(U, V))
  const angle = context.config.angle === 'degrees' ? `${formatNumber((theta * 180) / Math.PI)}°` : formatNumber(theta)
  const readout = `comp_${v} ${u} = ${formatNumber(dot(U, V) / norm(V))} · θ = ${angle}`
  const labels = [
    label(context, 'u', add(P, U), u, 'point'),
    label(context, 'v', add(P, V), v, 'point'),
    label(context, 'readout', add(P, scale(proj, 0.5)), readout, 'annotation'),
  ]
  return { marks, labels, errors: [], colorScale: null }
}

export const VECTOR_OP: BuilderEntry = { draws: true, prepare: prepareVectorOp }
