// The built-in registry (calc P1b; spec "One rule that keeps the kernel lasting"). A built-in
// exists only as a triple: its scalar implementation (math/compile.ts's BUILTINS, on both
// compile paths), its interval twin, and its derivative class in math/diff.ts, an exact rule
// or a refusal. The registry tests fail if any built-in is missing a member, so a built-in
// added later arrives sampled, certified and differentiable: it needs a twin here and a
// derivative class that matches diff.ts (the test differentiates it and holds the class to
// it), and the names must equal compile.ts's BUILTIN_NAMES.

import type { Twin } from './interval/elementary'
import * as E from './interval/elementary'
import * as S from './interval/stepwise'
import * as X from './interval/special'

export interface BuiltinEntry {
  readonly twin: Twin
  // 'rule': diff differentiates it exactly (step is 0 where it exists and NaN at its jump;
  // root is a rule too, and refuses only when its INDEX depends on the variable).
  // 'refuses': diff throws a CompileError when an argument depends on the variable (gamma,
  // choose and perm need digamma; gcd and lcm are defined on whole numbers only).
  readonly derivative: 'rule' | 'refuses'
}

const rule = (twin: Twin): BuiltinEntry => ({ twin, derivative: 'rule' })
const refuses = (twin: Twin): BuiltinEntry => ({ twin, derivative: 'refuses' })

export const BUILTIN_REGISTRY: ReadonlyMap<string, BuiltinEntry> = new Map<string, BuiltinEntry>([
  ['sin', rule(E.sinT)],
  ['cos', rule(E.cosT)],
  ['tan', rule(E.tanT)],
  ['sec', rule(E.secT)],
  ['csc', rule(E.cscT)],
  ['cot', rule(E.cotT)],
  ['asin', rule(E.asinT)],
  ['acos', rule(E.acosT)],
  ['atan', rule(E.atanT)],
  ['atan2', rule(E.atan2T)],
  ['sinh', rule(E.sinhT)],
  ['cosh', rule(E.coshT)],
  ['tanh', rule(E.tanhT)],
  ['asinh', rule(E.asinhT)],
  ['acosh', rule(E.acoshT)],
  ['atanh', rule(E.atanhT)],
  ['sqrt', rule(E.sqrtT)],
  ['abs', rule(E.absT)],
  ['exp', rule(E.expT)],
  ['ln', rule(E.lnT)],
  ['log', rule(E.logT)],
  ['floor', rule(S.floorT)],
  ['ceil', rule(S.ceilT)],
  ['round', rule(S.roundT)],
  ['sign', rule(S.signT)],
  ['mod', rule(S.modT)],
  ['min', rule(S.minT)],
  ['max', rule(S.maxT)],
  ['hypot', rule(S.hypotT)],
  ['gamma', refuses(X.gammaT)],
  ['erf', rule(X.erfT)],
  ['erfc', rule(X.erfcT)],
  ['cbrt', rule(E.cbrtT)],
  ['step', rule(S.stepT)],
  ['choose', refuses(X.chooseT)],
  ['perm', refuses(X.permT)],
  ['gcd', refuses(X.gcdT)],
  ['lcm', refuses(X.lcmT)],
  ['root', rule(E.rootT)],
])
