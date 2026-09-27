// tangent-plane: f at (a, b) [normal], and F at (x0, y0, z0) (S4b, B5;
// OpenStax 4.4, tangent planes and linear approximation).
//
// Two variables: L(x, y) = f(a, b) + f_x(a, b)(x − a) + f_y(a, b)(y − b),
// drawn over the square [a − s, a + s] x [b − s, b + s] with s = 0.2 x the
// domain's larger span, cut to the domain and clipped to the box, at opacity
// 0.5 with an outline, plus the point. "normal" adds the unit normal
// (−f_x, −f_y, 1) x 0.18 of the box's largest span. The readout is L, written
// with its coefficients: "L(x, y) = −3 + 2(x − 1) − 4(y − 2)".
//
// Three variables: the plane through the point with normal ∇F, as a square of
// side 2s (s = 0.2 x the box's largest span) in that plane, clipped to the
// box. Whether the point is on a level surface of interest is not checked;
// the readout shows the plane and F at the point. ∇F = 0 is refused.
//
// A readout sits at the patch's corner nearest the default camera (the
// greatest x + y), not at the point, where an author's own label for the
// point (P = (a, b, f(a, b))) would sit on top of it.

import type { Statement } from '../../../parser/types'
import type { LabelAnchor, Mark, Vec3 } from '../../scene/types'
import { formatNumber } from '../../pick/format'
import { Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, arrowMark, clipPolygon, largestSpan, lineMark, part, pointMark, polygonMesh, toolBox } from './box'
import { affineText, pointText } from './readout'
import { preparePoint, prepareDomain, resolveTarget, surface2, surface3 } from './target'

const PATCH = 0.2
const NORMAL = 0.18
const OPACITY = 0.5
const OUTLINE_WIDTH = 1.5

// Two unit vectors spanning the plane with normal n (unit): the first is n
// crossed with the coordinate axis least aligned with it.
function planeFrame(n: Vec3): [Vec3, Vec3] {
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) < Math.abs(n[best]) ? i : best), 0)
  const axis: Vec3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0]
  const c: Vec3 = [n[1] * axis[2] - n[2] * axis[1], n[2] * axis[0] - n[0] * axis[2], n[0] * axis[1] - n[1] * axis[0]]
  const len = Math.hypot(...c)
  const e1: Vec3 = [c[0] / len, c[1] / len, c[2] / len]
  const e2: Vec3 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]]
  return [e1, e2]
}

// The patch corner the readout sits at, or the point when the patch is empty.
function readoutAnchor(polygon: readonly Vec3[], at: Vec3): Vec3 {
  return polygon.reduce<Vec3>((best, p) => (p[0] + p[1] > best[0] + best[1] ? p : best), polygon[0] ?? at)
}

function closed(polygon: readonly Vec3[]): number[] {
  return [...polygon, polygon[0]].flatMap((p) => [...p])
}

function prepareTangentPlane(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'tangentPlane') throw new Error(`not a tangent plane: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'tangent-plane')
  if (form.point.length !== target.arity) {
    throw new Error(
      target.arity === 2
        ? `tangent-plane: a function of x and y takes a point (a, b), got ${form.point.length} coordinates`
        : `tangent-plane: a function of x, y and z takes a point (x0, y0, z0), got ${form.point.length} coordinates`
    )
  }
  const point = preparePoint(form.point, scope, reads)
  const domain = prepareDomain(form.over, config, scope, reads)
  const opacity = form.style.opacity ?? OPACITY
  const outline = (polygon: Vec3[]) => lineMark(part(context, 'outline'), [closed(polygon)], context, { width: OUTLINE_WIDTH })

  if (target.arity === 2) {
    const { f, fx, fy } = surface2(target, scope)
    const build = (): BuildResult => {
      const [a, b] = point()
      const f0 = f(a, b)
      const p = fx(a, b)
      const q = fy(a, b)
      if (![f0, p, q].every(Number.isFinite)) {
        throw new Error(`tangent-plane: f has no tangent plane at ${pointText([a, b])} — f or a partial derivative is undefined there`)
      }
      const rect = domain()
      const box = toolBox(context, rect, (x, y) => f(x, y))
      const s = PATCH * Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
      const [x0, x1] = [Math.max(a - s, rect.x.min), Math.min(a + s, rect.x.max)]
      const [y0, y1] = [Math.max(b - s, rect.y.min), Math.min(b + s, rect.y.max)]
      if (!(x0 < x1 && y0 < y1)) throw new Error(`tangent-plane: ${pointText([a, b])} is outside the domain`)
      const L = (x: number, y: number) => f0 + p * (x - a) + q * (y - b)
      const square: Vec3[] = [
        [x0, y0, L(x0, y0)],
        [x1, y0, L(x1, y0)],
        [x1, y1, L(x1, y1)],
        [x0, y1, L(x0, y1)],
      ]
      const polygon = clipPolygon(square, box)
      const marks: Mark[] = []
      const mesh = polygonMesh(context.source, polygon, [-p, -q, 1], context, opacity)
      if (mesh) marks.push(mesh, outline(polygon))
      const at: Vec3 = [a, b, f0]
      marks.push(pointMark(part(context, 'point'), [at], context))
      if (form.normal) {
        const k = (NORMAL * largestSpan(box)) / Math.hypot(p, q, 1)
        marks.push(arrowMark(part(context, 'normal'), [{ tail: at, vector: [-p * k, -q * k, k] }], context))
      }
      const text = `L(x, y) = ${affineText(f0, [
        { coef: p, variable: 'x', at: a },
        { coef: q, variable: 'y', at: b },
      ])}`
      const labels: LabelAnchor[] = [annotation(part(context, 'readout'), readoutAnchor(polygon, at), text)]
      return { marks, labels, errors: [], colorScale: null }
    }
    return { reads: reads.names, build }
  }

  const { F, grad } = surface3(target, scope)
  const build = (): BuildResult => {
    const [x0, y0, z0] = point()
    const g: Vec3 = [grad[0](x0, y0, z0), grad[1](x0, y0, z0), grad[2](x0, y0, z0)]
    const length = Math.hypot(...g)
    if (!Number.isFinite(length)) throw new Error(`tangent-plane: ∇F is undefined at ${pointText([x0, y0, z0])}`)
    if (length === 0) throw new Error(`tangent-plane: ∇F is zero at ${pointText([x0, y0, z0])}; the tangent plane is undefined`)
    const box = toolBox(context, domain(), null)
    const s = PATCH * largestSpan(box)
    const n: Vec3 = [g[0] / length, g[1] / length, g[2] / length]
    const [e1, e2] = planeFrame(n)
    const corner = (u: number, v: number): Vec3 => [x0 + s * (u * e1[0] + v * e2[0]), y0 + s * (u * e1[1] + v * e2[1]), z0 + s * (u * e1[2] + v * e2[2])]
    const polygon = clipPolygon([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], box)
    const marks: Mark[] = []
    const mesh = polygonMesh(context.source, polygon, n, context, opacity)
    if (mesh) marks.push(mesh, outline(polygon))
    const at: Vec3 = [x0, y0, z0]
    marks.push(pointMark(part(context, 'point'), [at], context))
    if (form.normal) {
      const k = NORMAL * largestSpan(box)
      marks.push(arrowMark(part(context, 'normal'), [{ tail: at, vector: [n[0] * k, n[1] * k, n[2] * k] }], context))
    }
    const plane = `${affineText(null, [
      { coef: g[0], variable: 'x', at: x0 },
      { coef: g[1], variable: 'y', at: y0 },
      { coef: g[2], variable: 'z', at: z0 },
    ])} = 0`
    const labels: LabelAnchor[] = [annotation(part(context, 'readout'), readoutAnchor(polygon, at), `${plane}, F${pointText(at)} = ${formatNumber(F(x0, y0, z0))}`)]
    return { marks, labels, errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

export const TANGENT_PLANE: BuilderEntry = { draws: true, prepare: prepareTangentPlane }
