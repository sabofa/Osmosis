import { describe, expect, it } from 'vitest'
import { BUILTIN_NAMES } from '../../math/compile'
import { isClassicBuiltin, SHADOWABLE_BUILTINS } from './shadowable'

// The built-ins at calc's base commit d1a8ef4, before calc's additions.
const CLASSIC = [
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'ceil', 'cos', 'cosh', 'cot', 'csc', 'exp', 'floor', 'hypot', 'ln', 'log', 'max', 'min', 'mod', 'round', 'sec', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh',
]

describe('which built-in names a spec may take', () => {
  it("only calc's ten new names, each a built-in today", () => {
    expect([...SHADOWABLE_BUILTINS].sort()).toEqual(['cbrt', 'choose', 'erf', 'erfc', 'gamma', 'gcd', 'lcm', 'perm', 'root', 'step'])
    for (const name of SHADOWABLE_BUILTINS) expect(BUILTIN_NAMES.has(name), name).toBe(true)
  })

  it('every other built-in is a classic one, from calc\'s base: a name calc adds later is a decision made in shadowable.ts, not a quiet default', () => {
    expect([...BUILTIN_NAMES].filter(isClassicBuiltin).sort()).toEqual(CLASSIC)
  })

  it('isClassicBuiltin: true for sin and hypot, false for gamma and for a name that is no built-in', () => {
    expect(isClassicBuiltin('sin')).toBe(true)
    expect(isClassicBuiltin('hypot')).toBe(true)
    expect(isClassicBuiltin('gamma')).toBe(false)
    expect(isClassicBuiltin('k')).toBe(false)
  })
})
