// Points, segments, rays and vectors (K8), in space or lifted onto z = 0 when
// written with two coordinates. Coordinates are expressions, so they may read
// parameters (a point that follows a slider).

import type { Expr, Statement } from '../../parser/types'
import type { CompiledFn } from '../../math/compile'
import { formatCoord } from '../../scene/format'
import type { ArrowMark, LabelAnchor, LineMark, PointMark } from '../scene/types'
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

function preparePoint(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'point') throw new Error(`not a point: ${statement.kind}`)
  const reads = new Reads(context.scope)
  const [x, y, z] = coordinates([statement.x, statement.y, statement.z], context, reads)
  const build = (): BuildResult => {
    const position = [x(), y(), z()] as const
    const mark: PointMark = {
      kind: 'points',
      source: context.source,
      positions: Float64Array.from(position),
      style: { color: context.color, size: POINT_SIZE, shape: 'dot' },
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
