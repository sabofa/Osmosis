// critical: f [over <rect>] (S4b, B8; OpenStax 4.7, the second-derivative
// test).
//
// seededRoots solves ∇f = 0 with the Hessian as its Jacobian, from 12 seeds
// per axis over the domain, deduplicated and in lexicographic order. Each
// point is classified by symEig2 of the Hessian, with tolerance
// 1e-9 · max(1, the Hessian's largest |eigenvalue|):
// - both eigenvalues > 0: local min (a dot);
// - both < 0: local max (a diamond);
// - opposite signs: saddle (a cross);
// - either within tolerance of zero, or not resolved (below): degenerate —
//   the second-derivative test is inconclusive (a ring, labelled "?").
// Each is drawn at (x, y, f(x, y)) with one readout: its kind, the point and
// f, all ≈ (Newton). None found is a note, not an error.
//
// Resolution. At a degenerate critical point Newton converges only linearly,
// and S1's stops with its residual under tolerance some 1e-5 from the root
// (measured: (x - y)^2 + x^4 stops at 5e-5 to 7e-5 from the origin, from six
// seeds). There the Hessian's small eigenvalue is not zero but an artefact of
// that distance — any fixed threshold on it is beaten by some function. So a
// root's smallest-magnitude eigenvalue counts only when one more exact Newton
// step from the root changes it by less than UNRESOLVED of itself: at a
// nondegenerate root the step is at rounding level and nothing changes; at a
// stalled one the step is a fraction of the distance left and moves the
// eigenvalue by as much (a half along a cubic direction, 5/9 along a quartic).
// Degenerate roots are known only to that distance, so they merge within
// sqrt(ROOT_DEDUP_REL) of the domain's diagonal; the one with the smallest
// |∇f| stands (in practice some seed lands on the root exactly).

import type { Statement } from '../../../parser/types'
import { solve2, symEig2 } from '../../../math/linalg'
import { seededRoots } from '../../../math/roots'
import { ROOT_DEDUP_REL } from '../../../math/tolerance'
import type { LabelAnchor, Mark, PointShape, Vec3 } from '../../scene/types'
import { Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, part, pointMark, toolBox } from './box'
import { approx, approxPoint } from './readout'
import { prepareDomain, requireArity, resolveTarget, surface2 } from './target'

export const SEEDS_PER_AXIS = 12
export const EIGEN_TOLERANCE = 1e-9
// A coordinate below this fraction of the domain's larger span is below what
// the solve resolves, and prints as ≈ 0.
export const RESOLVED = 1e-10

// A root's smallest eigenvalue is unresolved when one more Newton step moves
// it by more than this fraction of itself.
export const UNRESOLVED = 0.1

export type CriticalKind = 'min' | 'max' | 'saddle' | 'degenerate'

export function classify(hessian: readonly (readonly number[])[]): CriticalKind {
  const [low, high] = symEig2(hessian)
  const tolerance = EIGEN_TOLERANCE * Math.max(1, Math.abs(low), Math.abs(high))
  if (Math.abs(low) <= tolerance || Math.abs(high) <= tolerance) return 'degenerate'
  if (low > 0) return 'min'
  if (high < 0) return 'max'
  return 'saddle'
}

type Hessian = (x: number, y: number) => number[][]

// The eigenvalue of least magnitude.
function smallest(h: readonly (readonly number[])[]): number {
  const [low, high] = symEig2(h)
  return Math.abs(low) <= Math.abs(high) ? low : high
}

// classify, with the resolution check (see the header): a root whose
// smallest eigenvalue one more Newton step would move is degenerate.
export function classifyRoot(x: number, y: number, grad: (x: number, y: number) => number[], hessian: Hessian): CriticalKind {
  const h = hessian(x, y)
  const kind = classify(h)
  if (kind === 'degenerate') return kind
  const g = grad(x, y)
  const step = solve2(h, [-g[0], -g[1]])
  if (!step) return 'degenerate'
  const before = smallest(h)
  const after = smallest(hessian(x + step[0], y + step[1]))
  return Math.abs(after - before) <= UNRESOLVED * Math.abs(before) ? kind : 'degenerate'
}

const KINDS: readonly { kind: CriticalKind; shape: PointShape; label: string }[] = [
  { kind: 'min', shape: 'dot', label: 'min' },
  { kind: 'max', shape: 'diamond', label: 'max' },
  { kind: 'saddle', shape: 'cross', label: 'saddle' },
  { kind: 'degenerate', shape: 'ring', label: '?' },
]

function prepareCritical(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'critical') throw new Error(`not a critical: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'critical')
  requireArity(target, 2, 'critical')
  const { f, fx, fy, fxx, fxy, fyy } = surface2(target, scope)
  const domain = prepareDomain(form.over, config, scope, reads)

  const build = (): BuildResult => {
    const rect = domain()
    const roots = seededRoots(
      (v) => [fx(v[0], v[1]), fy(v[0], v[1])],
      (v) => {
        const b = fxy(v[0], v[1])
        return [
          [fxx(v[0], v[1]), b],
          [b, fyy(v[0], v[1])],
        ]
      },
      { min: [rect.x.min, rect.y.min], max: [rect.x.max, rect.y.max] },
      SEEDS_PER_AXIS
    )
    const hessian: Hessian = (x, y) => {
      const b = fxy(x, y)
      return [
        [fxx(x, y), b],
        [b, fyy(x, y)],
      ]
    }
    const grad = (x: number, y: number) => [fx(x, y), fy(x, y)]
    const span = Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
    const wide = Math.sqrt(ROOT_DEDUP_REL) * Math.hypot(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
    const classified: { at: Vec3; kind: CriticalKind; residual: number }[] = []
    for (const [x, y] of roots) {
      const z = f(x, y)
      if (!Number.isFinite(z) || !hessian(x, y).flat().every(Number.isFinite)) continue
      classified.push({ at: [x, y, z], kind: classifyRoot(x, y, grad, hessian), residual: Math.hypot(...grad(x, y)) })
    }
    // Degenerate roots within the wide radius of each other are one root: the
    // one with the smallest |∇f| stands.
    const found: { at: Vec3; kind: CriticalKind }[] = []
    const byResidual = [...classified].sort((a, b) => a.residual - b.residual)
    for (const root of classified) {
      if (root.kind !== 'degenerate') {
        found.push(root)
        continue
      }
      const near = byResidual.filter((r) => r.kind === 'degenerate' && Math.hypot(r.at[0] - root.at[0], r.at[1] - root.at[1]) <= wide)
      if (near[0] === root) found.push(root)
    }

    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    if (found.length === 0) {
      const floor = toolBox(context, rect, (x, y) => f(x, y)).z.min
      const centre: Vec3 = [(rect.x.min + rect.x.max) / 2, (rect.y.min + rect.y.max) / 2, floor]
      labels.push(annotation(part(context, 'note'), centre, 'no critical points found in the domain'))
      return { marks, labels, errors: [], colorScale: null }
    }
    for (const { kind, shape } of KINDS) {
      const points = found.filter((p) => p.kind === kind).map((p) => p.at)
      if (points.length > 0) marks.push(pointMark(part(context, kind), points, context, shape, 10))
    }
    const floor = RESOLVED * span
    const valueFloor = RESOLVED * Math.max(1, ...found.map((p) => Math.abs(p.at[2])))
    found.forEach(({ at, kind }, k) => {
      const label = KINDS.find((entry) => entry.kind === kind)!.label
      const why = kind === 'degenerate' ? ': the second-derivative test is inconclusive' : ''
      labels.push(annotation(part(context, `p${k}`), at, `${label} ${approxPoint([at[0], at[1]], floor)}, f ${approx(at[2], valueFloor)}${why}`))
    })
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const CRITICAL: BuilderEntry = { draws: true, prepare: prepareCritical }
