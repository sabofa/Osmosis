// "line:" (plan A3): a LineMark clipped exactly to the box (box.ts), so it
// spans the box. The clip is the slab method on the parametric line
// P + t d; each end is set exactly on the face that bounds it. A zero
// direction, one point given twice, and a line that misses the box are
// refused. The pick is the line itself, r(t) = P + t d (t = 0 at the first
// point, and t = 1 at the second when the line is through two).

import type { Statement } from '../../../parser/types'
import type { LineForm } from '../../grammar/keywords/geometryForms'
import type { Box3, LineMark } from '../../scene/types'
import { lineStyle, Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { spaceBox } from './box'
import { prepareVector, preparePoint } from './operands'
import { add, isFiniteV, norm, scale, sub, type V3 } from './vec'

export const LINE_WIDTH = 2

export interface Clip {
  t0: number
  t1: number
  start: V3
  end: V3
}

// The part of P + t d inside the box, or null when it misses it or only
// touches an edge or a corner.
export function clipSegment(p: readonly number[], d: readonly number[], box: Box3): Clip | null {
  const ranges = [box.x, box.y, box.z]
  let t0 = -Infinity
  let t1 = Infinity
  let axis0 = -1
  let face0 = 0
  let axis1 = -1
  let face1 = 0
  for (let a = 0; a < 3; a++) {
    const { min, max } = ranges[a]
    if (d[a] === 0) {
      if (p[a] < min || p[a] > max) return null
      continue
    }
    let lo = (min - p[a]) / d[a]
    let hi = (max - p[a]) / d[a]
    let faceLo = min
    let faceHi = max
    if (lo > hi) {
      ;[lo, hi] = [hi, lo]
      ;[faceLo, faceHi] = [faceHi, faceLo]
    }
    if (lo > t0) {
      t0 = lo
      axis0 = a
      face0 = faceLo
    }
    if (hi < t1) {
      t1 = hi
      axis1 = a
      face1 = faceHi
    }
  }
  if (!(t1 > t0) || axis0 < 0 || axis1 < 0) return null
  const start = add(p, scale(d, t0))
  const end = add(p, scale(d, t1))
  start[axis0] = face0
  end[axis1] = face1
  return { t0, t1, start, end }
}

export function clipLine(p: readonly number[], d: readonly number[], box: Box3): [number, number] | null {
  const clip = clipSegment(p, d, box)
  return clip ? [clip.t0, clip.t1] : null
}

function lineForm(statement: Statement): LineForm {
  if (statement.kind === 'space' && statement.form.form === 'line') return statement.form
  throw new Error(`not a line: ${statement.kind}`)
}

function prepareLine(statement: Statement, context: BuildContext): PreparedStatement {
  const form = lineForm(statement)
  const reads = new Reads(context.scope)
  const through = preparePoint(form.through, context, reads)
  const to = form.to
  const other = to.kind === 'direction' ? prepareVector(to.vector, context, reads) : preparePoint(to.point, context, reads)

  const build = (): BuildResult => {
    const p = through()
    let d: V3
    if (to.kind === 'direction') {
      d = other()
      if (norm(d) === 0) throw new Error(`The direction ${to.vector.text} is zero — a line needs one`)
    } else {
      d = sub(other(), p)
      if (norm(d) === 0) throw new Error(`${form.through.text} and ${to.point.text} are the same point — a line needs two`)
    }
    if (!isFiniteV(p) || !isFiniteV(d)) throw new Error(`The line ${form.text} is not finite`)
    const clip = clipSegment(p, d, spaceBox(context.config))
    if (!clip) throw new Error(`The line ${form.text} does not meet the box — widen @bounds3d`)
    const mark: LineMark = {
      kind: 'lines',
      source: context.source,
      positions: Float64Array.from([...clip.start, ...clip.end]),
      starts: Uint32Array.from([0]),
      params: Float64Array.from([clip.t0, clip.t1]),
      style: lineStyle(context.color, form.style.width ?? LINE_WIDTH, form.style.dashed),
      pick: { param: 't', r: (t) => add(p, scale(d, t)), dr: () => [d[0], d[1], d[2]] },
    }
    return { marks: [mark], labels: [], errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const LINE: BuilderEntry = { draws: true, prepare: prepareLine }
