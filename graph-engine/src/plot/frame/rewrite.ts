// Log axes as a change of variable. The samplers are linear-pixel machines; for a log axis they run over
// (u, v) = (log10 x, log10 y) and see g(u) = v(f(10^u)). This file is the pure expression half of that:
// rewrite the free x / y of an expression to 10^x / 10^y, and take log10 of a whole expression.
import { call, num, pow, substitute, variable, varNames } from '../../math/expr'
import type { Expr } from '../../parser/types'
import type { AxisScale } from './scale'

// `expr` with every free `name` replaced by `replacement`; the same object when `name` is not free in it.
// Binder names (sum / prod / integral) are respected and call names are not variables (math/expr.ts substitute).
export function substituteVar(expr: Expr, name: string, replacement: Expr): Expr {
  if (!varNames(expr).has(name)) return expr
  return substitute(expr, new Map([[name, replacement]]))
}

// The expression as seen from (u, v) over the given scales: a log axis's variable v becomes 10^v.
// Both linear: `expr` itself.
export function throughScales(expr: Expr, scales: { x: AxisScale; y: AxisScale }, vars: { x: string; y: string } = { x: 'x', y: 'y' }): Expr {
  const map = new Map<string, Expr>()
  if (scales.x === 'log') map.set(vars.x, pow(num(10), variable(vars.x)))
  if (scales.y === 'log') map.set(vars.y, pow(num(10), variable(vars.y)))
  if (map.size === 0) return expr
  const free = varNames(expr)
  if (![...map.keys()].some((k) => free.has(k))) return expr
  return substitute(expr, map)
}

// log10(expr): the kernel's one-argument `log` is base 10 (`ln` is natural).
export function logOf(expr: Expr): Expr {
  return call('log', expr)
}
