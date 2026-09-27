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
// - either within tolerance of zero: degenerate — the second-derivative test
//   is inconclusive (a ring, labelled "?").
// Each is drawn at (x, y, f(x, y)) with one readout: its kind, the point and
// f, all ≈ (Newton). None found is a note, not an error.

import type { Statement } from '../../../parser/types'
import { symEig2 } from '../../../math/linalg'
import { seededRoots } from '../../../math/roots'
import type { LabelAnchor, Mark, PointShape, Vec3 } from '../../scene/types'
import { Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, part, pointMark, surfaceBox } from './box'
import { approx, approxPoint } from './readout'
import { prepareDomain, requireArity, resolveTarget, surface2 } from './target'

export const SEEDS_PER_AXIS = 12
export const EIGEN_TOLERANCE = 1e-9
// A coordinate below this fraction of the domain's larger span is below what
// the solve resolves, and prints as ≈ 0.
export const RESOLVED = 1e-10

export type CriticalKind = 'min' | 'max' | 'saddle' | 'degenerate'

export function classify(hessian: readonly (readonly number[])[]): CriticalKind {
  const [low, high] = symEig2(hessian)
  const tolerance = EIGEN_TOLERANCE * Math.max(1, Math.abs(low), Math.abs(high))
  if (Math.abs(low) <= tolerance || Math.abs(high) <= tolerance) return 'degenerate'
  if (low > 0) return 'min'
  if (high < 0) return 'max'
  return 'saddle'
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
    const found: { at: Vec3; kind: CriticalKind }[] = []
    for (const [x, y] of roots) {
      const z = f(x, y)
      const b = fxy(x, y)
      const hessian = [
        [fxx(x, y), b],
        [b, fyy(x, y)],
      ]
      if (!Number.isFinite(z) || !hessian.flat().every(Number.isFinite)) continue
      found.push({ at: [x, y, z], kind: classify(hessian) })
    }

    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    if (found.length === 0) {
      const floor = surfaceBox(config, rect, (x, y) => f(x, y)).z.min
      const centre: Vec3 = [(rect.x.min + rect.x.max) / 2, (rect.y.min + rect.y.max) / 2, floor]
      labels.push(annotation(part(context, 'note'), centre, 'no critical points found in the domain'))
      return { marks, labels, errors: [], colorScale: null }
    }
    for (const { kind, shape } of KINDS) {
      const points = found.filter((p) => p.kind === kind).map((p) => p.at)
      if (points.length > 0) marks.push(pointMark(part(context, kind), points, context, shape, 10))
    }
    const floor = RESOLVED * Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)
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
