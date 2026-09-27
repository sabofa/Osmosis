// "plane:" (plan A3): the exact polygon plane ∩ box, fan-triangulated, as a
// MeshMark at opacity 0.35 (no pick) with a 1.5 px outline.
//
// - The equation form is checked affine in x, y, z by evaluating it at the
//   origin, the three unit points, (1, 1, 1) and (2, -1, 3), as the solid
//   figures' plane does (an independent re-implementation: the engines share
//   no code). A non-linear equation and an all-zero normal are refused.
// - Three collinear points and a zero normal are refused.
// - The polygon (3 to 6 vertices) is the box corners on the plane and the
//   strict crossings of the box edges, ordered by angle about their centroid
//   in the plane's own frame, so it winds counter-clockwise about the normal.
//   A plane that meets the box in less than a polygon is refused.
// - It is built in box.ts's box (@bounds3d, else [-5, 5] per axis).

import type { Statement } from '../../../parser/types'
import { compileScalar, type CompiledFn } from '../../../math/compile'
import { sub as subExpr } from '../../../math/expr'
import type { PlaneForm } from '../../grammar/keywords/geometryForms'
import type { Box3, LineMark, MeshMark } from '../../scene/types'
import { Reads } from '../common'
import { boxOf, type BuildContext, type BuildResult, type BuilderEntry, type PreparedStatement } from '../registry'
import { largestSpan } from './box'
import { XYZ } from './implicit'
import { prepareVector, preparePoint } from './operands'
import { add, cross, dot, isFiniteV, norm, scale, sub, unit, type V3 } from './vec'

export const PLANE_OPACITY = 0.35
export const OUTLINE_WIDTH = 1.5

// n . p = k
export interface Plane {
  n: V3
  k: number
}

// The affine test's tolerance, relative to the equation's own scale.
const AFFINE_REL = 1e-9
// |n| below this fraction of the equation's scale is a zero normal.
const ZERO_NORMAL_REL = 1e-12
// A corner within this fraction of |n| times the box span is on the plane.
const ON_PLANE_REL = 1e-12
// Three points are collinear when |(Q - P) x (R - P)| is below this fraction
// of |Q - P| |R - P|.
const COLLINEAR_REL = 1e-12

// The plane G(x, y, z) = 0 of an equation G = left - right, refused unless G
// is affine.
export function affinePlane(g: CompiledFn, text: string): Plane {
  const d0 = g(0, 0, 0)
  const a = g(1, 0, 0) - d0
  const b = g(0, 1, 0) - d0
  const c = g(0, 0, 1) - d0
  const size = Math.max(1, Math.abs(d0), Math.abs(a), Math.abs(b), Math.abs(c))
  const checks: [number, number, number, number][] = [
    [1, 1, 1, d0 + a + b + c],
    [2, -1, 3, d0 + 2 * a - b + 3 * c],
  ]
  const linear = [d0, a, b, c].every(Number.isFinite) && checks.every(([x, y, z, want]) => Math.abs(g(x, y, z) - want) <= AFFINE_REL * size)
  if (!linear) throw new Error(`The plane ${text} is not linear in x, y, z`)
  if (Math.abs(a) + Math.abs(b) + Math.abs(c) <= ZERO_NORMAL_REL * size) throw new Error(`The plane ${text} has no x, y or z term — its normal is zero`)
  return { n: [a, b, c], k: -d0 }
}

function corners(box: Box3): V3[] {
  return Array.from({ length: 8 }, (_, c) => [c & 1 ? box.x.max : box.x.min, c & 2 ? box.y.max : box.y.min, c & 4 ? box.z.max : box.z.min])
}

// The polygon plane ∩ box, counter-clockwise about n, or [] when the plane
// meets the box in less than a polygon.
export function planeBoxPolygon(n: readonly number[], k: number, box: Box3): V3[] {
  const cs = corners(box)
  const s = cs.map((p) => dot(n, p) - k)
  const tol = ON_PLANE_REL * norm(n) * largestSpan(box)
  const points: V3[] = []
  cs.forEach((p, i) => {
    if (Math.abs(s[i]) <= tol) points.push(p)
  })
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue
      const j = i | bit
      const crosses = (s[i] < -tol && s[j] > tol) || (s[i] > tol && s[j] < -tol)
      if (!crosses) continue
      // Only the edge's own axis moves; the other two coordinates are the
      // corners' exactly.
      points.push(add(cs[i], scale(sub(cs[j], cs[i]), s[i] / (s[i] - s[j]))))
    }
  }
  if (points.length < 3) return []
  const centre = scale(
    points.reduce((acc, p) => add(acc, p), [0, 0, 0] as V3),
    1 / points.length
  )
  // The plane's frame: u along the plane, v = n x u, so u x v = n.
  const m = unit(n)
  const least = [0, 1, 2].reduce((best, a) => (Math.abs(m[a]) < Math.abs(m[best]) ? a : best), 0)
  const axis: V3 = [0, 0, 0]
  axis[least] = 1
  const u = unit(cross(axis, m))
  const v = cross(m, u)
  const angle = (p: V3) => {
    const r = sub(p, centre)
    return Math.atan2(dot(r, v), dot(r, u))
  }
  return points
    .map((p) => ({ p, a: angle(p) }))
    .sort((x, y) => x.a - y.a)
    .map((e) => e.p)
}

function planeForm(statement: Statement): PlaneForm {
  if (statement.kind === 'space' && statement.form.form === 'plane') return statement.form
  throw new Error(`not a plane: ${statement.kind}`)
}

function preparePlane(statement: Statement, context: BuildContext): PreparedStatement {
  const form = planeForm(statement)
  const def = form.def
  const reads = new Reads(context.scope)
  let planeOf: () => Plane
  if (def.kind === 'equation') {
    const G = subExpr(def.left, def.right)
    reads.add(G, XYZ)
    const g = compileScalar(G, XYZ, context.scope)
    planeOf = () => affinePlane(g, form.text)
  } else if (def.kind === 'pointNormal') {
    const point = preparePoint(def.point, context, reads)
    const normal = prepareVector(def.normal, context, reads)
    planeOf = () => {
      const n = normal()
      if (norm(n) === 0) throw new Error(`The normal ${def.normal.text} is zero — a plane needs one`)
      return { n, k: dot(n, point()) }
    }
  } else {
    const [p, q, r] = def.points.map((op) => preparePoint(op, context, reads))
    planeOf = () => {
      const [P, Q, R] = [p(), q(), r()]
      const n = cross(sub(Q, P), sub(R, P))
      if (!(norm(n) > COLLINEAR_REL * norm(sub(Q, P)) * norm(sub(R, P)))) {
        const [a, b, c] = def.points.map((op) => op.text)
        throw new Error(`${a}, ${b} and ${c} are collinear — three points on one line do not fix a plane`)
      }
      return { n, k: dot(n, P) }
    }
  }

  const build = (): BuildResult => {
    const { n, k } = planeOf()
    if (!isFiniteV(n) || !Number.isFinite(k)) throw new Error(`The plane ${form.text} is not finite`)
    const polygon = planeBoxPolygon(n, k, boxOf(context))
    if (polygon.length < 3) throw new Error(`The plane ${form.text} does not meet the box — widen @bounds3d`)
    const m = unit(n)
    const count = polygon.length
    const indices: number[] = []
    for (let i = 1; i + 1 < count; i++) indices.push(0, i, i + 1)
    const mesh: MeshMark = {
      kind: 'mesh',
      source: context.source,
      positions: Float64Array.from(polygon.flat()),
      normals: Float64Array.from(polygon.flatMap(() => m)),
      indices: Uint32Array.from(indices),
      scalars: null,
      uv: null,
      style: { color: context.color, opacity: form.style.opacity ?? PLANE_OPACITY, colorScale: null, meshLines: null },
      pick: null,
    }
    const outline: LineMark = {
      kind: 'lines',
      source: { ...context.source, object: `${context.source.object}.outline` },
      positions: Float64Array.from([...polygon.flat(), ...polygon[0]]),
      starts: Uint32Array.from([0]),
      params: null,
      style: { color: context.color, width: OUTLINE_WIDTH, dash: null, hidden: 'dashed' },
      pick: null,
    }
    return { marks: [mesh, outline], labels: [], errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const PLANE: BuilderEntry = { draws: true, prepare: preparePlane }
