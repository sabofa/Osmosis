// Points, segments, rays and vectors (K8), in space or lifted onto z = 0 when
// written with two coordinates. Coordinates are expressions, so they may read
// parameters (a point that follows a slider).
//
// A point whose coordinates read one or two bindings is draggable (S3): its
// mark carries `drag`, the position and its Jacobian with respect to those
// bindings at any values, from symbolic derivatives. Both evaluate by writing
// the given values into the bindings' slots, evaluating, and restoring the
// live values, so user functions that read a binding follow it too. They are
// called only from input handlers, never inside a kernel build.

import type { Expr, Statement } from '../../parser/types'
import type { CompiledFn } from '../../math/compile'
import { diff } from '../../math/diff'
import type { MathScope } from '../../math/scope'
import { simplify } from '../../math/simplify'
import { formatCoord } from '../../scene/format'
import type { ArrowMark, LabelAnchor, LineMark, PointDrag, PointMark, Vec3 } from '../scene/types'
import { constant, lineStyle, Reads, SEGMENT_WIDTH } from './common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from './registry'

const POINT_SIZE = 8
const SHAFT_WIDTH = 2
const HEAD_SIZE = 10

function coordinates(exprs: readonly (Expr | null)[], context: BuildContext, reads: Reads): CompiledFn[] {
  return exprs.map((e) => {
    if (e === null) return () => 0
    reads.add(e)
    return constant(e, context.scope)
  })
}

// The drag descriptor for coordinates that read `params` (one or two bindings).
function pointDrag(exprs: readonly (Expr | null)[], params: readonly string[], scope: MathScope): PointDrag {
  const slots = params.map((p) => scope.params.index.get(p)!)
  const coords = exprs.map((e) => (e ? constant(e, scope) : () => 0))
  const partials = exprs.map((e) => params.map((p) => (e ? constant(simplify(diff(e, p, scope)), scope) : () => 0)))
  const at = <T>(values: Float64Array, evaluate: () => T): T => {
    const live = scope.params.values
    const saved = slots.map((s) => live[s])
    slots.forEach((s, i) => (live[s] = values[i]))
    try {
      return evaluate()
    } finally {
      slots.forEach((s, i) => (live[s] = saved[i]))
    }
  }
  const k = params.length
  return {
    params,
    position: (values) => at(values, (): Vec3 => [coords[0](), coords[1](), coords[2]()]),
    jacobian: (values) =>
      at(values, () => {
        const out = new Float64Array(3 * k)
        for (let r = 0; r < 3; r++) for (let c = 0; c < k; c++) out[r * k + c] = partials[r][c]()
        return out
      }),
  }
}

function preparePoint(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'point') throw new Error(`not a point: ${statement.kind}`)
  const reads = new Reads(context.scope)
  const exprs = [statement.x, statement.y, statement.z]
  const [x, y, z] = coordinates(exprs, context, reads)
  // Draggable when it reads one or two bindings (in source order); three or
  // more would leave the drag underdetermined on a 2D screen.
  const names = new Set(reads.names)
  const params = context.config.bindings.map((b) => b.name).filter((n) => names.has(n))
  const drag = params.length >= 1 && params.length <= 2 ? pointDrag(exprs, params, context.scope) : undefined
  const build = (): BuildResult => {
    const position = [x(), y(), z()] as const
    const mark: PointMark = {
      kind: 'points',
      source: context.source,
      positions: Float64Array.from(position),
      style: { color: context.color, size: POINT_SIZE, shape: 'dot' },
      ...(drag ? { drag } : {}),
    }
    const labels: LabelAnchor[] = statement.label
      ? [{ source: { ...context.source, object: `${context.source.object}.label` }, position, text: statement.label, kind: 'point' }]
      : []
    return { marks: [mark], labels, errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

function prepareSegment(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'segment') throw new Error(`not a segment: ${statement.kind}`)
  const reads = new Reads(context.scope)
  const c = coordinates([statement.x1, statement.y1, statement.z1, statement.x2, statement.y2, statement.z2], context, reads)
  const build = (): BuildResult => {
    const mark: LineMark = {
      kind: 'lines',
      source: context.source,
      positions: Float64Array.from(c.map((f) => f())),
      starts: Uint32Array.from([0]),
      params: null,
      style: lineStyle(context.color, SEGMENT_WIDTH, false),
      pick: null,
    }
    return { marks: [mark], labels: [], errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

// A ray is an arrow; a vector is an arrow labelled with its magnitude, the
// way the 2D renderer labels one ("|v| = 3").
function prepareArrow(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'ray' && statement.kind !== 'vector') throw new Error(`not an arrow: ${statement.kind}`)
  const reads = new Reads(context.scope)
  const c = coordinates([statement.x1, statement.y1, statement.z1, statement.x2, statement.y2, statement.z2], context, reads)
  const labelled = statement.kind === 'vector'
  const build = (): BuildResult => {
    const [x1, y1, z1, x2, y2, z2] = c.map((f) => f())
    const vector = [x2 - x1, y2 - y1, z2 - z1]
    const mark: ArrowMark = {
      kind: 'arrows',
      source: context.source,
      tails: Float64Array.from([x1, y1, z1]),
      vectors: Float64Array.from(vector),
      style: { color: context.color, shaftWidth: SHAFT_WIDTH, headSize: HEAD_SIZE, hidden: 'dashed' },
    }
    const labels: LabelAnchor[] = labelled
      ? [
          {
            source: { ...context.source, object: `${context.source.object}.label` },
            position: [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2],
            text: `|v| = ${formatCoord(Math.hypot(vector[0], vector[1], vector[2]))}`,
            kind: 'annotation',
          },
        ]
      : []
    return { marks: [mark], labels, errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

export const POINT: BuilderEntry = { draws: true, prepare: preparePoint }
export const SEGMENT: BuilderEntry = { draws: true, prepare: prepareSegment }
export const ARROW: BuilderEntry = { draws: true, prepare: prepareArrow }
