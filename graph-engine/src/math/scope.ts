// What a compiled expression can see besides its own bound variables (K2): the
// user's functions and constants, the spec's parameters, and the angle unit.
// Pure and engine-agnostic: space builds one per spec, and track 4 can build
// one for 2D calculus.

import type { Expr } from '../parser/types'

// A user definition. `params` is empty for a constant ("k = 5",
// "u = <1, 2, 3>"). A tuple body is vector-valued ("r(t) = <cos t, sin t, t>").
export interface MathFunction {
  params: readonly string[]
  body: Expr | readonly [Expr, Expr, Expr]
}

export interface MathScope {
  functions: ReadonlyMap<string, MathFunction>
  // Parameters (@param) are read from `values[index.get(name)]` at call time,
  // so changing one needs no recompile: the kernel writes the slot.
  params: { index: ReadonlyMap<string, number>; values: Float64Array }
  angle: 'radians' | 'degrees'
}

export function isVectorBody(body: MathFunction['body']): body is readonly [Expr, Expr, Expr] {
  return Array.isArray(body)
}

// Builds a scope from definitions and parameter values. Later definitions of
// the same name replace earlier ones (the caller reports duplicates, since it
// knows the lines). Parameters take slots in the order given.
export function makeScope(
  options: {
    functions?: Iterable<readonly [string, MathFunction]>
    params?: Iterable<readonly [string, number]>
    angle?: 'radians' | 'degrees'
  } = {}
): MathScope {
  const functions = new Map<string, MathFunction>()
  for (const [name, fn] of options.functions ?? []) functions.set(name, fn)
  const index = new Map<string, number>()
  const initial: number[] = []
  for (const [name, value] of options.params ?? []) {
    if (index.has(name)) continue
    index.set(name, initial.length)
    initial.push(value)
  }
  return { functions, params: { index, values: Float64Array.from(initial) }, angle: options.angle ?? 'radians' }
}
