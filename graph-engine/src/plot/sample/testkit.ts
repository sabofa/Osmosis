// Test helpers for the sampler's stages: an expression from text, and a
// MathScope from definition lines. Neither is used outside tests. Both throw on
// a bad line, so a test that mistypes its setup fails there and not three
// assertions later.

import { compileScalar } from '../../math/compile'
import type { MathScope } from '../../math/scope'
import { parseExprString } from '../../parser/parseExpr'
import { parseSpec } from '../../parser/parseSpec'
import type { Expr } from '../../parser/types'
import { buildPlotScope } from '../scope'
import type { PointFn } from './types'

export function expr(text: string): Expr {
  return parseExprString(text)
}

// The curve y = f(x) as a PointFn: the parameter is x, the value is y.
export function pointFnOf(text: string, param: string, scope: MathScope): PointFn {
  const f = compileScalar(expr(text), [param], scope)
  return (t, out) => {
    out[0] = t
    out[1] = f(t)
  }
}

// `defs` is the lines of a spec ("f(x) = 1/(x - a)", "@param a = 2 range [0, 5]");
// `angle` is the document's @angle, radians when not given.
export function scopeOf(defs = '', angle: 'radians' | 'degrees' = 'radians'): MathScope {
  const parsed = parseSpec(`@angle: ${angle}\n${defs}`)
  if (parsed.errors.length > 0) throw new Error(`scopeOf: ${parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`)
  const { scope, errors } = buildPlotScope(parsed.statements, parsed.config, parsed.statementLines)
  if (errors.length > 0) throw new Error(`scopeOf: ${errors.map((e) => e.message).join('; ')}`)
  return scope
}
