import { describe, expect, it } from 'vitest'
import { compileScalar } from '../math/compile'
import { parseExprString as p } from '../parser/parseExpr'
import { parseSpec } from '../parser/parseSpec'
import { buildPlotScope } from './scope'

function scopeOf(spec: string) {
  const parsed = parseSpec(spec)
  return buildPlotScope(parsed.statements, parsed.config, parsed.statementLines)
}

describe('buildPlotScope', () => {
  it('collects one- and multi-parameter definitions, constants and @param values', () => {
    const { scope, errors } = scopeOf('@param a = 2 range [0, 5]\nk = 3\nf(x) = x^2\ng(x, b) = b x\ny = f(x)')
    expect(errors).toEqual([])
    expect(compileScalar(p('f(2) + g(2, 5) + k + a'), [], scope)()).toBe(4 + 10 + 3 + 2)
  })

  // Space's own scope builder reports clashes on the definition's line; the 2D
  // engine inherits that unchanged, so a name defined twice is named on the
  // later line and the later definition wins, as it always has in 2D.
  it('reports a name defined twice on its later line, and uses the later definition', () => {
    const { scope, errors } = scopeOf('f(x) = x\nf(x) = x + 1\ny = f(x)')
    expect(errors).toEqual([expect.objectContaining({ line: 2, message: '"f" is defined twice (lines 1 and 2) — the later definition is used' })])
    expect(compileScalar(p('f(2)'), [], scope)()).toBe(3)
  })

  it('carries a definition regardless of the order its statements are written in', () => {
    const { scope, errors } = scopeOf('y = f(x)\nf(x) = x^2 + 1')
    expect(errors).toEqual([])
    expect(compileScalar(p('f(3)'), [], scope)()).toBe(10)
  })

  it('works without statement lines, naming every error line 0', () => {
    const parsed = parseSpec('f(x) = x\nf(x) = x + 1')
    const { errors } = buildPlotScope(parsed.statements, parsed.config)
    expect(errors).toEqual([expect.objectContaining({ line: 0 })])
  })
})
