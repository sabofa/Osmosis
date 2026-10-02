// Curves (K8). Every curve is one parameter's image, so each form is written
// as three expressions over one parameter and sampled by one builder:
//   (fx, fy, fz) for t in [a, b], and space's styled curve  -> itself
//   (fx, fy) for t in [a, b]                              -> (fx, fy, 0)
//   y = f(x) [if ...]                                      -> (x, f, 0) over the box's x
//   x = f(y) [if ...]                                      -> (f, y, 0) over the box's y
//   r = f(theta) for theta in [a, b]                       -> (f cos theta, f sin theta, 0)
// Each is a LineMark with its parameter per vertex and a pick with r and r'
// (symbolic). A non-finite sample, or one outside an "if" clause, splits the
// polyline. A lifted 2D implicit curve is traced on z = 0 by the 2D
// marching-squares tracer and chained into polylines.

import type { GraphConfig } from '../../parser/config'
import type { Condition as IfClause, Expr, Statement } from '../../parser/types'
import { compileScalar, compileVector, type CompiledFn } from '../../math/compile'
import { diff } from '../../math/diff'
import { call, mul, num, variable } from '../../math/expr'
import type { MathScope } from '../../math/scope'
import { simplify } from '../../math/simplify'
import { traceImplicitCurve } from '../../render/marchingSquares'
import type { LineMark } from '../scene/types'
import { boundNames, boxX, boxY, constant, CURVE_WIDTH, lineStyle, Reads, refuseWhere, renameBound, resolution } from './common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from './registry'

const DEFAULT_SEGMENTS = 512
const IMPLICIT_RES = 200

interface CurveParts {
  f: [Expr, Expr, Expr]
  param: string
  from: Expr
  to: Expr
  condition: IfClause | null
  width: number
  dashed: boolean
  res: number | null
}

const ZERO = num(0)

function curveParts(statement: Statement, config: GraphConfig): CurveParts {
  const plain = { condition: null, width: CURVE_WIDTH, dashed: false, res: null }
  switch (statement.kind) {
    case 'parametric':
      return { ...plain, f: [statement.fx, statement.fy, statement.fz ?? ZERO], param: statement.param, from: statement.from, to: statement.to }
    case 'explicit': {
      const along = statement.independent
      const range = along === 'x' ? boxX(config) : boxY(config)
      const f: [Expr, Expr, Expr] = along === 'x' ? [variable('x'), statement.body, ZERO] : [statement.body, variable('y'), ZERO]
      return { ...plain, f, param: along, from: num(range.min), to: num(range.max), condition: statement.condition }
    }
    case 'polar': {
      const theta = variable('theta')
      return {
        ...plain,
        f: [mul(statement.body, call('cos', theta)), mul(statement.body, call('sin', theta)), ZERO],
        param: 'theta',
        from: statement.from,
        to: statement.to,
      }
    }
    case 'space':
      if (statement.form.form === 'curve') {
        const { fx, fy, fz, t, style } = statement.form
        return { f: [fx, fy, fz], param: t.param, from: t.from, to: t.to, condition: null, width: style.width ?? CURVE_WIDTH, dashed: style.dashed, res: style.res }
      }
      break
  }
  throw new Error(`not a curve: ${statement.kind}`)
}

// The "if" clause of y = f(x) as a test of the parameter.
function prepareCondition(condition: IfClause | null, scope: MathScope, reads: Reads): (t: number) => boolean {
  if (!condition) return () => true
  const compare = (op: '<' | '<=' | '>' | '>=', a: number, b: number) =>
    op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b
  if (condition.kind === 'compare') {
    reads.add(condition.value)
    const value = constant(condition.value, scope)
    return (t) => compare(condition.op, t, value())
  }
  reads.add(condition.low).add(condition.high)
  const low = constant(condition.low, scope)
  const high = constant(condition.high, scope)
  return (t) => compare(condition.lowOp, low(), t) && compare(condition.highOp, t, high())
}

function prepareCurve(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  // y = f(x) if ...: a clause the old shape cannot say is not read in 3D yet.
  refuseWhere(statement)
  const parts = curveParts(statement, config)
  const segments = resolution(parts.res, config, DEFAULT_SEGMENTS)
  const reads = new Reads(scope)
  const vars = boundNames(1)
  const renamed = parts.f.map((e) => {
    reads.add(e, [parts.param])
    return renameBound(e, [parts.param])
  }) as [Expr, Expr, Expr]
  const r = compileVector(renamed, vars, scope)
  const dr = compileVector(renamed.map((e) => simplify(diff(e, vars[0], scope))) as [Expr, Expr, Expr], vars, scope)
  reads.add(parts.from).add(parts.to)
  const from = constant(parts.from, scope)
  const to = constant(parts.to, scope)
  const inside = prepareCondition(parts.condition, scope, reads)

  const build = (): BuildResult => {
    const a = from()
    const b = to()
    const positions: number[] = []
    const params: number[] = []
    const starts: number[] = []
    let run = 0
    const p = new Float64Array(3)
    const endRun = () => {
      // A run of one point draws nothing.
      if (run === 1) {
        positions.length -= 3
        params.length -= 1
        starts.pop()
      }
      run = 0
    }
    for (let i = 0; i <= segments; i++) {
      const t = a + (b - a) * (i / segments)
      r(p, t)
      if (!inside(t) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
        endRun()
        continue
      }
      if (run === 0) starts.push(params.length)
      positions.push(p[0], p[1], p[2])
      params.push(t)
      run++
    }
    endRun()
    if (params.length === 0) return { marks: [], labels: [], errors: [], colorScale: null }

    const mark: LineMark = {
      kind: 'lines',
      source: context.source,
      positions: Float64Array.from(positions),
      starts: Uint32Array.from(starts),
      params: Float64Array.from(params),
      style: lineStyle(context.color, parts.width, parts.dashed),
      pick: {
        param: parts.param,
        r: (t) => {
          const out = r(new Float64Array(3), t)
          return [out[0], out[1], out[2]]
        },
        dr: (t) => {
          const out = dr(new Float64Array(3), t)
          return [out[0], out[1], out[2]]
        },
      },
    }
    return { marks: [mark], labels: [], errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const CURVE: BuilderEntry = { draws: true, prepare: prepareCurve }

// Chains the tracer's independent two-point segments into polylines, joining
// ends that are the same point (the tracer computes a shared cell edge's
// crossing identically from either side). Deterministic in input order.
export function chain(segments: readonly (readonly { x: number; y: number }[])[]): { x: number; y: number }[][] {
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`
  const at = new Map<string, number[]>()
  segments.forEach((s, i) => {
    for (const p of s) {
      const k = key(p)
      const list = at.get(k)
      if (list) list.push(i)
      else at.set(k, [i])
    }
  })
  const used = new Uint8Array(segments.length)
  const next = (p: { x: number; y: number }) => {
    for (const i of at.get(key(p)) ?? []) {
      if (used[i]) continue
      used[i] = 1
      const [a, b] = segments[i]
      return key(a) === key(p) ? b : a
    }
    return null
  }
  const lines: { x: number; y: number }[][] = []
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const line = [segments[i][0], segments[i][1]]
    for (let p = next(line[line.length - 1]); p; p = next(line[line.length - 1])) line.push(p)
    for (let p = next(line[0]); p; p = next(line[0])) line.unshift(p)
    lines.push(line)
  }
  return lines
}

function prepareImplicitCurve(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'implicit') throw new Error(`not an implicit curve: ${statement.kind}`)
  refuseWhere(statement)
  const { scope, config } = context
  const reads = new Reads(scope).add(statement.left, ['x', 'y']).add(statement.right, ['x', 'y'])
  const left: CompiledFn = compileScalar(statement.left, ['x', 'y'], scope)
  const right: CompiledFn = compileScalar(statement.right, ['x', 'y'], scope)
  const res = config.space.resolution ?? IMPLICIT_RES

  const build = (): BuildResult => {
    const x = boxX(config)
    const y = boxY(config)
    const segments = traceImplicitCurve((px, py) => left(px, py) - right(px, py), { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max }, res)
    const lines = chain(segments)
    if (lines.length === 0) return { marks: [], labels: [], errors: [], colorScale: null }
    const positions: number[] = []
    const starts: number[] = []
    for (const line of lines) {
      starts.push(positions.length / 3)
      for (const p of line) positions.push(p.x, p.y, 0)
    }
    const mark: LineMark = {
      kind: 'lines',
      source: context.source,
      positions: Float64Array.from(positions),
      starts: Uint32Array.from(starts),
      params: null,
      style: lineStyle(context.color, CURVE_WIDTH, false),
      pick: null,
    }
    return { marks: [mark], labels: [], errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

export const IMPLICIT_CURVE: BuilderEntry = { draws: true, prepare: prepareImplicitCurve }
