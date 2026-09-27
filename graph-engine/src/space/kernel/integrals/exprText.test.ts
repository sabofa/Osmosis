import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../../parser/parseExpr'
import { exprText } from './exprText'

describe('exprText', () => {
  it('writes expressions back as authors write them, parentheses only where needed', () => {
    const cases: [string, string][] = [
      ['sqrt(x - 0.5)', 'sqrt(x - 0.5)'],
      ['1 - x - y', '1 - x - y'],
      ['1 - (x - y)', '1 - (x - y)'],
      ['(1 + x)*y', '(1 + x)*y'],
      ['x^2 + y^2', 'x^2 + y^2'],
      ['-sqrt(1 - x^2)', '-sqrt(1 - x^2)'],
      ['a/(b*c)', 'a/(b*c)'],
      ['(x^2)^3', '(x^2)^3'],
      ['atan2(y, x)', 'atan2(y, x)'],
    ]
    for (const [input, text] of cases) expect(exprText(parseExprString(input))).toBe(text)
  })

  it('round-trips: the text parses back to the same tree', () => {
    for (const input of ['1/(x - 0.3)^2', '-x^2', '2*x*y - 3', 'sin(x)^2 + cos(-y)', '1 - x - y - z']) {
      const tree = parseExprString(input)
      expect(parseExprString(exprText(tree))).toEqual(tree)
    }
  })
})
