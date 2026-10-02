// What an expression reads, for the grammar's dependency checks: which
// variable a bound depends on, whether a line's right side reads every one of
// its parameters. math/expr's varNames sees a variable and not a call's name,
// but calc made a name followed by a parenthesis a product, x(1) = x * 1
// (math/compile.ts), so that call reads x too. The grammar has no scope, so it
// cannot tell the product from a user function of that name; it takes the
// product, as the compiler does for a name that is bound.

import type { Expr } from '../../parser/types'
import { paramCallsAsProducts } from '../../math/compile'
import { varNames } from '../../math/expr'
import { makeScope } from '../../math/scope'

const NO_SCOPE = makeScope()

// The free names of `expr`, added to `into`, counting a one-argument call of
// any name in `calling` as a read of that name. Everything else is varNames'.
export function readNames(expr: Expr, calling: readonly string[], into: Set<string> = new Set()): Set<string> {
  return varNames(paramCallsAsProducts(expr, calling, NO_SCOPE), into)
}
