// Resolving S4a's point and vector operands (grammar/keywords/operands.ts)
// to closures that read the current parameter values.
//
// - A point is a tuple of expressions, or the name of a point statement
//   ("P = (1, 2, 3)") anywhere in the spec, hidden or not. An unknown name
//   is refused.
// - A vector is a literal, a vector constant ("u = <1, 2, 3>"), or a vector
//   function at a point ("F(1, 0, 2)": the arguments are substituted for its
//   parameters in each component).

import type { Expr, Statement } from '../../../parser/types'
import { paramCallsAsProducts } from '../../../math/compile'
import { num, substitute } from '../../../math/expr'
import { isVectorBody } from '../../../math/scope'
import type { PointOperand, VectorOperand } from '../../grammar/keywords/geometryForms'
import { constant, type Reads } from '../common'
import type { BuildContext } from '../registry'
import type { V3 } from './vec'

export interface NamedPoint {
  x: Expr
  y: Expr
  z: Expr | null
}

// Every labelled point statement, by name; a later one of the same name wins,
// as a later definition does.
export function namedPoints(statements: readonly Statement[]): Map<string, NamedPoint> {
  const points = new Map<string, NamedPoint>()
  for (const s of statements) if (s.kind === 'point' && s.label) points.set(s.label, { x: s.x, y: s.y, z: s.z })
  return points
}

function compileThree(exprs: readonly Expr[], context: BuildContext, reads: Reads): () => V3 {
  const [x, y, z] = exprs.map((e) => {
    reads.add(e)
    return constant(e, context.scope)
  })
  return () => [x(), y(), z()]
}

export function preparePoint(op: PointOperand, context: BuildContext, reads: Reads): () => V3 {
  if (op.kind === 'tuple') return compileThree(op.coords, context, reads)
  const point = context.points?.get(op.name)
  if (!point) throw new Error(`"${op.name}" is not a point — define it first, e.g. "${op.name} = (1, 2, 3)"`)
  return compileThree([point.x, point.y, point.z ?? num(0)], context, reads)
}

export function prepareVector(op: VectorOperand, context: BuildContext, reads: Reads): () => V3 {
  if (op.kind === 'literal') return compileThree(op.components, context, reads)
  const fn = context.scope.functions.get(op.name)
  if (!fn || !isVectorBody(fn.body)) throw new Error(`"${op.name}" is not a vector — define it first, e.g. "${op.name} = <1, 2, 3>"`)
  const args = op.args ?? []
  if (fn.params.length !== args.length) {
    if (fn.params.length === 0) throw new Error(`"${op.name}" is a vector, not a function — write "${op.name}", not "${op.text}"`)
    const example = `${op.name}(${fn.params.map(() => '1').join(', ')})`
    throw new Error(`"${op.name}" is a vector function of (${fn.params.join(', ')}) — evaluate it at a point, e.g. "${example}"`)
  }
  const at = new Map(fn.params.map((p, i) => [p, args[i]] as const))
  return compileThree(
    fn.body.map((e) => substitute(paramCallsAsProducts(e, fn.params, context.scope), at)),
    context,
    reads
  )
}
