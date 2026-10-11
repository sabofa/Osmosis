// Which built-in function names a spec may use as its own (calc ruling,
// 2026-10-02, narrowed after review): a @param, a constant, a user function or
// a named region or volume of that name shadows the built-in wherever the spec
// uses it.
//
// Only calc's ten new names. Space draws its polar, cylindrical and spherical
// maps as calls of sin, cos and sqrt, and calc's derivatives emit calls of cos,
// sec, sqrt and the rest, all by name: once a spec owned one of those names
// every such call would resolve to the author's function and draw a silently
// wrong picture (a polar volume that reads 1.5708 instead of pi/4). So every
// classic built-in, each already a built-in at calc's base commit d1a8ef4,
// stays refused as it always was, and so do pi and e.
//
// Written out, not derived, so a name that calc adds later is a decision made
// here (shadowable.test.ts fails until it is).

import { BUILTIN_NAMES } from '../../math/compile'

export const SHADOWABLE_BUILTINS: ReadonlySet<string> = new Set(['gamma', 'erf', 'erfc', 'cbrt', 'step', 'choose', 'perm', 'gcd', 'lcm', 'root'])

// A built-in no spec may take the name of: every one but the ten.
export function isClassicBuiltin(name: string): boolean {
  return BUILTIN_NAMES.has(name) && !SHADOWABLE_BUILTINS.has(name)
}
