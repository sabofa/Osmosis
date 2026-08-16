import { describe, expect, it } from 'vitest'
import { parseExprString } from './parseExpr'
import { evalExpr } from './evalExpr'

function evalStr(s: string, bindings: Record<string, number> = {}): number {
  return evalExpr(parseExprString(s), bindings)
}

describe('parseExpr / evalExpr', () => {
  it('respects standard operator precedence', () => {
    expect(evalStr('2 + 3 * 4')).toBe(14)
    expect(evalStr('(2 + 3) * 4')).toBe(20)
  })

  it('right-associates power', () => {
    expect(evalStr('2^3^2')).toBe(2 ** (3 ** 2))
  })

  // Unary minus binds looser than "^" — "-2^2" is -(2^2) = -4, matching
  // Desmos/WolframAlpha/TI calculators/Python, not (-2)^2 = 4. This matters
  // for real specs: "y = -x^2" must be a downward-opening parabola.
  it('binds unary minus looser than power', () => {
    expect(evalStr('-2^2')).toBe(-4)
    expect(evalStr('-x^2', { x: 3 })).toBe(-9)
    expect(evalStr('(-2)^2')).toBe(4) // explicit parens still override
  })

  it('allows a negative exponent', () => {
    expect(evalStr('2^-2')).toBe(0.25)
    expect(evalStr('-2^-2')).toBe(-0.25)
  })

  it('supports implicit multiplication', () => {
    expect(evalStr('2x', { x: 5 })).toBe(10)
    expect(evalStr('3(x+1)', { x: 1 })).toBe(6)
    expect(evalStr('2 sin(x)', { x: 0 })).toBe(0)
  })

  it('evaluates builtin functions', () => {
    expect(evalStr('sqrt(16)')).toBe(4)
    expect(evalStr('abs(-3)')).toBe(3)
    expect(evalStr('sin(x)^2', { x: 0 })).toBe(0)
  })

  it('throws on unbound variables', () => {
    expect(() => evalStr('x')).toThrow(/Unbound variable/)
  })

  it('treats adjacent numbers as implicit multiplication rather than a parse error', () => {
    // "2 3" is not ambiguous under this grammar's implicit-multiplication
    // rule (see parseTerm) — it's 2*3, same as "2 sin(x)" is 2*sin(x).
    expect(evalStr('1 + 2 3')).toBe(7)
  })

  it('throws on genuinely unconsumed trailing tokens', () => {
    expect(() => parseExprString('1 + 2)')).toThrow(/trailing tokens/)
  })

  it('resolves named constants pi and e', () => {
    expect(evalStr('pi')).toBeCloseTo(Math.PI)
    expect(evalStr('e')).toBeCloseTo(Math.E)
  })
})
