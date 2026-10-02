// An expression written back as text, for a refusal that names a bound
// ("the bound sqrt(x - 0.5) is not a number at x = 0.4"). Parentheses only
// where precedence needs them; + and - spaced, * / ^ tight, as authors write.

import type { Expr } from '../../../parser/types'

const PRECEDENCE: Record<'+' | '-' | '*' | '/' | '^', number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }

export function exprText(expr: Expr, parent = 0, rightOperand = false): string {
  switch (expr.kind) {
    case 'num':
      return expr.value < 0 && parent > 0 ? `(${expr.value})` : String(expr.value)
    case 'var':
      return expr.name
    case 'unary': {
      const text = `-${exprText(expr.arg, 4)}`
      return parent > 1 || (parent === 1 && rightOperand) ? `(${text})` : text
    }
    case 'binary': {
      const p = PRECEDENCE[expr.op]
      // ^ groups to the right; the others to the left.
      const left = exprText(expr.left, expr.op === '^' ? p + 1 : p, false)
      const right = exprText(expr.right, expr.op === '^' ? p : p + (expr.op === '-' || expr.op === '/' ? 1 : 0), true)
      const text = p === 1 ? `${left} ${expr.op} ${right}` : `${left}${expr.op}${right}`
      return p < parent ? `(${text})` : text
    }
    case 'call':
      return `${expr.name}(${expr.args.map((a) => exprText(a)).join(', ')})`
  }
}
