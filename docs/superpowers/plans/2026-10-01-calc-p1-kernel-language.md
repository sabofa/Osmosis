# Calc P1 — The Kernel Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make space's shared `math/` kernel the 2D engine's language — real odd roots, special functions, piecewise and conditions, `n!`, `f'(x)`, `sum`/`prod`/`integral`, absolute-value bars and the notation fixes — and switch every 2D sampling path off `parser/evalExpr.ts` onto it, with compile errors reported on their lines.

**Architecture:** New constructs are encoded as **reserved call nodes** (`__piecewise`, `__sum`, …) so the `Expr` union never changes and space's code compiles untouched. Every built-in and reserved construct works on **both** compile paths in `math/compile.ts` (closures and the `compileMany` register program) with an exact derivative rule or a `CompileError` refusal. The parser turns the new syntax into those nodes; `scene/buildScene.ts` compiles through `math/compile.ts` with a scope built by space's own `buildScope`.

**Tech Stack:** TypeScript 6, Vitest, the existing `graph-engine` package. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-calc-proofing-design.md` — sections "The kernel (P1)", "Architecture", "Coordination". This plan covers P1's language and the 2D switch. **The interval twin and the registry triple test are the companion plan P1b** (`2026-10-0x-calc-p1b-interval-twin.md`, written next), because the twin is consumed only from P2 on.

## Global Constraints

- **Working tree:** `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, branch `milestone-a/calc`. Run commands from `graph-engine/` unless a step says otherwise.
- **Never edit** anything under `graph-engine/src/space/` or `graph-engine/src/figure/`, nor `graph-engine/src/scene/buildScene3d.ts` or `graph-engine/src/render/SceneRenderer3D.ts` (Ben, 2026-10-01). Importing from them unchanged is fine.
- **`math/` edits are additive:** existing behaviour unchanged. After every task that touches `math/` or `parser/`: the full suite green, both typechecks clean, and space's scene sweep (Task 1, Step 1) reporting `identical 49; differ 0` — or, if it shows diffs, **stop and report the exact diff lines to the controller** (do not "fix" space's expectations).
- **The typecheck** is `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`. The bare `npx tsc --noEmit` checks nothing here.
- **Tests:** `npx vitest run <path>` for one file; `npx vitest run` for the suite (~70 s, 4050 tests at the start of P1). Lint: `npx oxlint src`.
- **Compile-time refusals are `CompileError`s** thrown inside compile (`math/compile.ts`), never thrown per sample.
- **Both compile paths agree:** for every built-in and reserved construct, `compileMany` returns exactly what `compileScalar` returns.
- **Derivative rules are exact or refuse** with a `CompileError`. diff/simplify results are cached per scope.
- **Deterministic:** no `Math.random`, `Date` or clock anywhere in `math/` or `plot/`.
- **Reserved names and shapes are stable** (space prints them by name). They are documented in `math/reserved.ts` (Task 3). Never change a shape without the controller.
- **Real odd roots are structural:** only an integer-literal ratio p/q in lowest terms with q odd (q > 1) takes the real root. Never infer from a float: `x^0.333` and `x^0.5` stay principal.
- **Commits:** stage explicit paths only (`git add <paths>`, never `-A` or `.`); never `git stash`. Every commit message ends with exactly `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` — a fixed repo convention, not a model name; do not change it.
- **Other agents work at the same time** in other worktrees (geometry, space). Unexpected branches, worktrees or stash entries are normal; do not touch them. If a file in *this* worktree changes under you, stop and report.
- **No browser tools** and no review servers in P1.
- **Appended tests that begin with imports:** move those imports into the file's import block at the top.

---

### Task 1: Exact rationals and real odd roots

**Files:**
- Create: `graph-engine/src/math/rational.ts`
- Create: `graph-engine/src/math/rational.test.ts`
- Modify: `graph-engine/src/math/compile.ts` (the `'binary'` case of `compileNode`; the `'binary'` case of `programNode`; two opcodes)
- Modify: `graph-engine/src/math/simplify.ts` (the literal fold in `binary`)
- Local only (not committed): `graph-engine/.sweep/`

**Interfaces:**
- Produces: `rationalLiteral(expr: Expr): Rational | null`, `oddRootExponent(expr: Expr): Rational | null`, `realOddPow(x: number, e: number, pOdd: boolean): number`, `gcdInt(a: number, b: number): number`, `interface Rational { readonly p: number; readonly q: number }` — all from `math/rational.ts`.

- [ ] **Step 1: Set up space's scene sweep (local, never committed)**

```bash
cd /c/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc/graph-engine
mkdir -p .sweep
git archive d1a8ef4 graph-engine/src | tar -x -C .sweep
grep -qx 'graph-engine/.sweep/' /c/Users/benif/Osmosis/.git/info/exclude || echo 'graph-engine/.sweep/' >> /c/Users/benif/Osmosis/.git/info/exclude
cp "C:/Users/benif/AppData/Local/Temp/claude/C--Users-benif-Osmosis/62922336-0adb-4fad-84cc-c1ecb60fcb27/scratchpad/verify-main/scenes.mts" .sweep/scenes.mts
```

Edit the `roots` object at the top of `.sweep/scenes.mts` to exactly:

```ts
const roots = {
  space: 'file:///C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc/graph-engine/.sweep/graph-engine/src',
  main: 'file:///C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc/graph-engine/src',
}
```

Run: `npx tsx .sweep/scenes.mts`
Expected (last line): `examples: 49 space / 49 main; identical 49; differ 0`. `git status --short` must not list `.sweep`.

- [ ] **Step 2: Write the failing tests**

Create `graph-engine/src/math/rational.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { oddRootExponent, rationalLiteral, realOddPow } from './rational'
import { makeScope } from './scope'
import { simplify } from './simplify'

const scope = makeScope()
const one = new Float64Array(1)

function both(text: string, x: number): number {
  const closure = compileScalar(p(text), ['x'], scope)(x)
  const program = compileMany([p(text)], ['x'], scope)(one, x)[0]
  expect(Object.is(program, closure), `${text} at ${x}: compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

describe('rationalLiteral reads integer-literal arithmetic exactly', () => {
  it.each([
    ['1/3', { p: 1, q: 3 }],
    ['2/6', { p: 1, q: 3 }],
    ['-1/3', { p: -1, q: 3 }],
    ['1/3 - 1', { p: -2, q: 3 }],
    ['2^3/4', { p: 2, q: 1 }],
    ['(1/2)^-2', { p: 4, q: 1 }],
    ['5', { p: 5, q: 1 }],
  ])('%s', (text, want) => {
    expect(rationalLiteral(p(text))).toEqual(want)
  })

  it.each(['0.5', 'x/3', '1/0', 'pi/3', 'sqrt(1)/3', '2^0.5', '9007199254740993/3'])('%s is not one', (text) => {
    expect(rationalLiteral(p(text))).toBeNull()
  })
})

describe('oddRootExponent: lowest terms, odd denominator above 1', () => {
  it.each([
    ['1/3', { p: 1, q: 3 }],
    ['2/3', { p: 2, q: 3 }],
    ['2/6', { p: 1, q: 3 }],
    ['-1/3', { p: -1, q: 3 }],
    ['1/3 - 1', { p: -2, q: 3 }],
  ])('%s', (text, want) => {
    expect(oddRootExponent(p(text))).toEqual(want)
  })

  it.each(['1/2', '3', '4/2', '0.3333333333333333', 'x'])('%s is not', (text) => {
    expect(oddRootExponent(p(text))).toBeNull()
  })
})

describe('realOddPow', () => {
  it('a negative base takes the real root; odd p keeps the sign', () => {
    expect(realOddPow(-8, 1 / 3, true)).toBeCloseTo(-2, 14)
    expect(realOddPow(-8, 2 / 3, false)).toBeCloseTo(4, 13)
  })

  it('a non-negative base is Math.pow bit for bit', () => {
    for (const x of [0, 0.5, 2, 8, 1e10]) expect(realOddPow(x, 1 / 3, true)).toBe(Math.pow(x, 1 / 3))
  })

  it('NaN stays NaN', () => {
    expect(realOddPow(Number.NaN, 1 / 3, true)).toBeNaN()
  })
})

describe('real odd roots on both compile paths', () => {
  it('x^(1/3) at -8 is -2', () => {
    expect(both('x^(1/3)', -8)).toBeCloseTo(-2, 14)
  })

  it('x^(2/3) at -8 is 4, the same as at 8, never negative', () => {
    expect(both('x^(2/3)', -8)).toBeCloseTo(4, 13)
    expect(both('x^(2/3)', -8)).toBe(both('x^(2/3)', 8))
  })

  it('x^(-1/3) at -8 is -1/2', () => {
    expect(both('x^(-1/3)', -8)).toBeCloseTo(-0.5, 14)
  })

  it('a non-negative base is exactly what Math.pow gave before', () => {
    for (const x of [0, 0.5, 2, 8, 1e10]) expect(both('x^(1/3)', x)).toBe(Math.pow(x, 1 / 3))
  })

  it('(-8)^(1/3) is -2', () => {
    expect(compileScalar(p('(-8)^(1/3)'), [], scope)()).toBeCloseTo(-2, 14)
  })

  it('a float or even-denominator exponent stays principal', () => {
    expect(both('x^0.5', -4)).toBeNaN()
    expect(both('x^(1/2)', -4)).toBeNaN()
    expect(both('x^0.3333333333333333', -8)).toBeNaN()
  })
})

describe('the rule survives diff and simplify', () => {
  it("d/dx x^(1/3) = (1/3) x^(-2/3): 1/12 at x = -8 and at x = 8", () => {
    const d = simplify(diff(p('x^(1/3)'), 'x', scope))
    const f = compileScalar(d, ['x'], scope)
    expect(f(-8)).toBeCloseTo(1 / 12, 14)
    expect(f(8)).toBeCloseTo(1 / 12, 14)
    expect(compileMany([d], ['x'], scope)(one, -8)[0]).toBe(f(-8))
  })

  it('d/dx x^(2/3) at -8 is -1/3', () => {
    const d = simplify(diff(p('x^(2/3)'), 'x', scope))
    expect(compileScalar(d, ['x'], scope)(-8)).toBeCloseTo(-1 / 3, 14)
  })

  it('simplify keeps a non-whole integer quotient, and still folds whole ones', () => {
    expect(simplify(p('1/3'))).toEqual(p('1/3'))
    expect(simplify(p('6/3'))).toEqual({ kind: 'num', value: 2 })
    expect(simplify(p('1/2 + 0'))).toEqual(p('1/2'))
  })

  it('a kept quotient compiles to the same double folding used to give', () => {
    expect(compileScalar(simplify(p('2*(1/3)')), [], scope)()).toBe(2 * (1 / 3))
    expect(compileScalar(simplify(p('1/2 + 1/4')), [], scope)()).toBe(1 / 2 + 1 / 4)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/math/rational.test.ts`
Expected: FAIL — `Cannot find module './rational'`.

- [ ] **Step 4: Write `math/rational.ts`**

```ts
// Exact rationals read structurally from integer literals (calc P1, spec "The
// kernel": real odd roots). A literal exponent p/q in lowest terms with q odd
// takes the real root, so x^(1/3) is defined for x < 0. The rule is read from
// the expression's SHAPE — integer literals combined by + - * / and integer
// powers — and never inferred from a float: x^0.333 and x^0.5 stay principal
// (agreed with space, 2026-10-01).

import type { Expr } from '../parser/types'

export interface Rational {
  // In lowest terms, q > 0, both safe integers.
  readonly p: number
  readonly q: number
}

export function gcdInt(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

function make(p: number, q: number): Rational | null {
  if (q === 0 || !Number.isSafeInteger(p) || !Number.isSafeInteger(q)) return null
  if (q < 0) {
    p = -p
    q = -q
  }
  const g = gcdInt(p, q) || 1
  // + 0 turns a -0 numerator into 0.
  return { p: p / g + 0, q: q / g }
}

// The largest integer power folded exactly; beyond it the subtree is not read.
const MAX_POWER = 64

function power(base: Rational, n: number): Rational | null {
  if (n < 0) {
    if (base.p === 0) return null
    const inverse = make(base.q, base.p)
    return inverse && power(inverse, -n)
  }
  let p = 1
  let q = 1
  for (let i = 0; i < n; i++) {
    p *= base.p
    q *= base.q
    if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q)) return null
  }
  return make(p, q)
}

// The exact rational an integer-literal subtree denotes, or null when the
// subtree reads a name, calls a function, holds a non-integer literal,
// divides by zero, or leaves the safe-integer range on the way.
export function rationalLiteral(expr: Expr): Rational | null {
  switch (expr.kind) {
    case 'num':
      return Number.isSafeInteger(expr.value) ? make(expr.value, 1) : null
    case 'unary': {
      const a = rationalLiteral(expr.arg)
      return a ? make(-a.p, a.q) : null
    }
    case 'binary': {
      const a = rationalLiteral(expr.left)
      if (!a) return null
      if (expr.op === '^') {
        const n = rationalLiteral(expr.right)
        if (!n || n.q !== 1 || Math.abs(n.p) > MAX_POWER) return null
        return power(a, n.p)
      }
      const b = rationalLiteral(expr.right)
      if (!b) return null
      switch (expr.op) {
        case '+':
          return make(a.p * b.q + b.p * a.q, a.q * b.q)
        case '-':
          return make(a.p * b.q - b.p * a.q, a.q * b.q)
        case '*':
          return make(a.p * b.p, a.q * b.q)
        case '/':
          return make(a.p * b.q, a.q * b.p)
      }
      return null
    }
    default:
      return null
  }
}

// The exponent's rational when it calls for a real root: lowest terms with an
// odd denominator above 1. An integer exponent needs no rule (Math.pow already
// takes a negative base to an integer power); an even denominator is the
// principal root, undefined below zero.
export function oddRootExponent(expr: Expr): Rational | null {
  const r = rationalLiteral(expr)
  return r && r.q > 1 && r.q % 2 === 1 ? r : null
}

// x^e where e is a literal p/q with q odd, evaluated at run time exactly as
// the plain Math.pow path evaluates it — so a non-negative base gives, bit for
// bit, what it always did. A negative base takes the real root: -|x|^e when p
// is odd, |x|^e when p is even.
export function realOddPow(x: number, e: number, pOdd: boolean): number {
  if (x < 0) {
    const m = Math.pow(-x, e)
    return pOdd ? -m : m
  }
  return Math.pow(x, e)
}
```

- [ ] **Step 5: Teach both compile paths**

In `graph-engine/src/math/compile.ts`, add the import beside the existing ones:

```ts
import { oddRootExponent, realOddPow } from './rational'
```

Replace the `'binary'` case of `compileNode`:

```ts
    case 'binary': {
      // A literal p/q exponent with q odd takes the real root (math/rational.ts).
      if (expr.op === '^') {
        const odd = oddRootExponent(expr.right)
        if (odd) {
          const base = compileNode(expr.left, env, ctx)
          const exponent = compileNode(expr.right, env, ctx)
          const pOdd = Math.abs(odd.p) % 2 === 1
          return (f) => realOddPow(base(f), exponent(f), pOdd)
        }
      }
      return binaryNode(expr.op, compileNode(expr.left, env, ctx), compileNode(expr.right, env, ctx), ctx.scope.params.values)
    }
```

Add two opcodes after `const OP_COPY = 21`:

```ts
const OP_RPOW_ODD = 22
const OP_RPOW_EVEN = 23
```

Replace the `'binary'` case of `programNode`:

```ts
    case 'binary': {
      const l = programNode(expr.left, bound, ctx)
      const rr = programNode(expr.right, bound, ctx)
      const odd = expr.op === '^' ? oddRootExponent(expr.right) : null
      if (odd) {
        r = ctx.program.emit(Math.abs(odd.p) % 2 === 1 ? OP_RPOW_ODD : OP_RPOW_EVEN, l, rr)
        break
      }
      const op = expr.op === '+' ? OP_ADD : expr.op === '-' ? OP_SUB : expr.op === '*' ? OP_MUL : expr.op === '/' ? OP_DIV : OP_POW
      r = ctx.program.emit(op, l, rr)
      break
    }
```

In the `run` loop's `switch (code[pc])`, after `case OP_COPY:`'s `break`, add:

```ts
        case OP_RPOW_ODD:
          reg[d] = realOddPow(reg[x], reg[y], true)
          break
        case OP_RPOW_EVEN:
          reg[d] = realOddPow(reg[x], reg[y], false)
          break
```

- [ ] **Step 6: Keep non-whole integer quotients in `simplify`**

In `graph-engine/src/math/simplify.ts`, replace the first block of `binary` (the `if (isNum(left) && isNum(right))` block) with:

```ts
  if (isNum(left) && isNum(right)) {
    // A non-whole quotient of two integers stays a quotient, so a literal
    // exponent such as 1/3 keeps its shape through diff and simplify and the
    // real-odd-root rule (math/rational.ts) still sees it. The value does not
    // change: the compiled 1/3 is the same IEEE division, done at run time.
    const keep = op === '/' && Number.isInteger(left.value) && Number.isInteger(right.value) && right.value !== 0 && !Number.isInteger(left.value / right.value)
    if (!keep) {
      const value = fold(op, left.value, right.value)
      // A non-finite result stays as written, so it fails where it is used.
      if (Number.isFinite(value)) return { kind: 'num', value }
    }
  }
```

Update the header comment's first sentence to say literals fold "except a non-whole quotient of two integers, which stays a quotient (calc P1)".

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run src/math/rational.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything that must not move**

Run, in order:
- `npx vitest run` — expected: all pass (4050 + the new ones). If any **space** or **figure** test fails, stop and report its name and message to the controller; do not edit it.
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` — expected: no output.
- `npx oxlint src` — expected: no new warnings in the touched files.
- `npx tsx .sweep/scenes.mts` — expected: `identical 49; differ 0`. Any `DIFF` lines: copy them verbatim into your report (space has asked for before/after strings of any readout that changes shape).

- [ ] **Step 9: Commit**

```bash
git add src/math/rational.ts src/math/rational.test.ts src/math/compile.ts src/math/simplify.ts
git commit -m "feat(math): real odd roots for literal p/q exponents, kept exact through diff and simplify

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message the space session ("Calculus 3D engine for graphing") with the task summary and the sweep result.

---

### Task 2: Special functions and the new built-ins

**Files:**
- Create: `graph-engine/src/math/special.ts`
- Create: `graph-engine/src/math/special.test.ts`
- Modify: `graph-engine/src/math/compile.ts` (`BUILTINS`, `UNARY_TABLE` / `UNARY_INDEX`, `BINARY_TABLE`, `programCall`)
- Modify: `graph-engine/src/math/diff.ts` (`differentiateCall`)

**Interfaces:**
- Consumes: `gcdInt` from `math/rational.ts`.
- Produces (from `math/special.ts`): `gamma(x)`, `factorial(x)` (= `gamma(x + 1)`), `erf(x)`, `erfc(x)`, `choose(n, k)`, `perm(n, k)`, `gcd(a, b)`, `lcm(a, b)`, `root(n, x)`, `step(x)` — all `(…: number) => number`. New built-in names: `gamma erf erfc cbrt step` (one argument) and `choose perm gcd lcm root` (two).

- [ ] **Step 1: Write the failing tests**

Create `graph-engine/src/math/special.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { CompileError, compileMany, compileScalar } from './compile'
import { diff } from './diff'
import { makeScope } from './scope'
import { simplify } from './simplify'
import { choose, erf, erfc, factorial, gamma, gcd, lcm, perm, root, step } from './special'

const SQRT_PI = Math.sqrt(Math.PI)
const scope = makeScope()

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
}

describe('gamma', () => {
  it('is (n - 1)! exactly at positive integers', () => {
    expect(gamma(1)).toBe(1)
    expect(gamma(5)).toBe(24)
    expect(gamma(11)).toBe(3628800)
  })

  it('half-integers to 1e-14', () => {
    expect(rel(gamma(0.5), SQRT_PI)).toBeLessThan(1e-14)
    expect(rel(gamma(1.5), SQRT_PI / 2)).toBeLessThan(1e-14)
    expect(rel(gamma(-0.5), -2 * SQRT_PI)).toBeLessThan(1e-14)
  })

  it('has poles at 0 and the negative integers, and overflows past 171', () => {
    expect(gamma(0)).toBeNaN()
    expect(gamma(-1)).toBeNaN()
    expect(gamma(-7)).toBeNaN()
    expect(Number.isFinite(gamma(171))).toBe(true)
    expect(gamma(172)).toBe(Infinity)
    expect(Number.isFinite(gamma(170.5))).toBe(true)
  })

  it('factorial is gamma(x + 1)', () => {
    expect(factorial(5)).toBe(120)
    expect(factorial(0)).toBe(1)
    expect(rel(factorial(0.5), SQRT_PI / 2)).toBeLessThan(1e-14)
    expect(factorial(-1)).toBeNaN()
  })
})

describe('erf and erfc', () => {
  it.each([
    [0.5, 0.5204998778130465],
    [1, 0.8427007929497149],
    [2, 0.9953222650189527],
    [3, 0.9999779095030014],
  ])('erf(%s)', (x, want) => {
    expect(rel(erf(x), want)).toBeLessThan(1e-14)
    expect(rel(erf(-x), -want)).toBeLessThan(1e-14)
  })

  it('erf(0) is 0, erfc(0) is 1', () => {
    expect(erf(0)).toBe(0)
    expect(erfc(0)).toBe(1)
  })

  it('erfc keeps relative precision in the tail', () => {
    expect(rel(erfc(3), 2.209049699858544e-5)).toBeLessThan(1e-12)
    expect(rel(erfc(5), 1.5374597944280349e-12)).toBeLessThan(1e-12)
    expect(rel(erfc(-1), 1.8427007929497149)).toBeLessThan(1e-14)
  })
})

describe('combinatorics, integers and roots', () => {
  it('choose and perm are exact on integers and 0 outside the range', () => {
    expect(choose(5, 2)).toBe(10)
    expect(choose(50, 25)).toBe(126410606437752)
    expect(choose(5, 7)).toBe(0)
    expect(choose(5, -1)).toBe(0)
    expect(perm(5, 2)).toBe(20)
    expect(perm(5, 0)).toBe(1)
    expect(perm(5, 6)).toBe(0)
  })

  it('choose of non-integers goes through gamma', () => {
    // C(0.5, 1) = Γ(1.5) / (Γ(2) Γ(0.5)) = 0.5
    expect(rel(choose(0.5, 1), 0.5)).toBeLessThan(1e-14)
  })

  it('gcd and lcm take integers only', () => {
    expect(gcd(12, 18)).toBe(6)
    expect(gcd(-12, 18)).toBe(6)
    expect(gcd(0, 0)).toBe(0)
    expect(lcm(4, 6)).toBe(12)
    expect(lcm(4, 0)).toBe(0)
    expect(gcd(1.5, 3)).toBeNaN()
  })

  it('root(n, x): odd n is real below zero, even n is not', () => {
    expect(root(3, -27)).toBe(-3)
    expect(root(2, 9)).toBe(3)
    expect(root(2, -9)).toBeNaN()
    expect(rel(root(5, -32), -2)).toBeLessThan(1e-15)
    expect(rel(root(-2, 4), 0.5)).toBeLessThan(1e-15)
    expect(root(0, 4)).toBeNaN()
    expect(root(2.5, 4)).toBeNaN()
  })

  it('step is Heaviside with step(0) = 1', () => {
    expect(step(-1e-300)).toBe(0)
    expect(step(0)).toBe(1)
    expect(step(2)).toBe(1)
    expect(step(Number.NaN)).toBeNaN()
  })
})

describe('the new built-ins compile on both paths', () => {
  const one = new Float64Array(1)
  it.each(['gamma(x)', 'erf(x)', 'erfc(x)', 'cbrt(x)', 'step(x)', 'choose(x, 2)', 'perm(x, 2)', 'gcd(x, 4)', 'lcm(x, 4)', 'root(3, x)'])('%s', (text) => {
    for (const x of [-2.5, -1, 0, 0.5, 3, 6]) {
      const closure = compileScalar(p(text), ['x'], scope)(x)
      expect(Object.is(compileMany([p(text)], ['x'], scope)(one, x)[0], closure), `${text} at ${x}`).toBe(true)
    }
  })
})

describe('derivatives of the new built-ins', () => {
  const at = (text: string, x: number) => compileScalar(simplify(diff(p(text), 'x', scope)), ['x'], scope)(x)

  it('cbrt and root: 1/12 at -8 and at 8', () => {
    expect(at('cbrt(x)', -8)).toBeCloseTo(1 / 12, 14)
    expect(at('cbrt(x)', 8)).toBeCloseTo(1 / 12, 14)
    expect(at('root(3, x)', -8)).toBeCloseTo(1 / 12, 14)
  })

  it('erf is 2/sqrt(pi) at 0; erfc is its negative', () => {
    expect(at('erf(x)', 0)).toBeCloseTo(2 / SQRT_PI, 15)
    expect(at('erfc(x)', 0)).toBeCloseTo(-2 / SQRT_PI, 15)
  })

  it('step is 0 where it has a derivative and NaN at 0', () => {
    expect(at('step(x)', 1)).toBe(0)
    expect(at('step(x)', 0)).toBeNaN()
  })

  it('gamma, choose, perm, gcd and lcm refuse, naming why', () => {
    for (const text of ['gamma(x)', 'choose(x, 2)', 'perm(x, 2)', 'gcd(x, 2)', 'lcm(x, 2)']) {
      expect(() => diff(p(text), 'x', scope), text).toThrow(CompileError)
    }
    expect(() => diff(p('gamma(x)'), 'x', scope)).toThrow(/digamma/)
  })

  it('root refuses an index that depends on the variable', () => {
    expect(() => diff(p('root(x, 8)'), 'x', scope)).toThrow(CompileError)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/math/special.test.ts`
Expected: FAIL — `Cannot find module './special'`.

- [ ] **Step 3: Write `math/special.ts`**

```ts
// Special functions for the kernel (calc P1): gamma, erf, erfc and the
// combinatorial and integer functions. Pure and deterministic. Accuracy is
// ~1e-14 relative or better; each method says why.

import { gcdInt } from './rational'

// Lanczos coefficients, g = 7, n = 9 (the widely published set; ~1e-15
// relative over the positive reals).
const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
]
const SQRT_2PI = Math.sqrt(2 * Math.PI)

// Γ(x). Exact products at positive integers (so gamma(5) is 24, not
// 23.999…); poles (NaN) at 0 and the negative integers; reflection below 1/2;
// Lanczos elsewhere, with the power split in two so Γ(170.5) does not
// overflow on the way to a finite answer.
export function gamma(x: number): number {
  if (Number.isNaN(x) || x === -Infinity) return Number.NaN
  if (x === Infinity) return Infinity
  if (Number.isInteger(x)) {
    if (x <= 0) return Number.NaN
    if (x > 171) return Infinity
    let r = 1
    for (let k = 2; k < x; k++) r *= k
    return r
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x))
  const z = x - 1
  let a = LANCZOS[0]
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i)
  const t = z + LANCZOS_G + 0.5
  const half = Math.pow(t, (z + 0.5) / 2)
  return SQRT_2PI * half * (half * Math.exp(-t)) * a
}

// x! = Γ(x + 1): exact at whole numbers, NaN at the negative integers.
export function factorial(x: number): number {
  return gamma(x + 1)
}

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI)
const ERF_SWITCH = 2.5

// erf by the all-positive series erf(x) = (2/√π) e^(-x²) Σ 2^n x^(2n+1) /
// (1·3·…·(2n+1)) (no cancellation) below 2.5; above, 1 − erfc by the
// continued fraction.
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x < 0) return -erf(-x)
  if (x < ERF_SWITCH) return erfSeries(x)
  return 1 - erfcFraction(x)
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x < ERF_SWITCH) return 1 - erf(x)
  return erfcFraction(x)
}

function erfSeries(x: number): number {
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1)
    sum += term
    if (term < sum * 1e-17) break
  }
  return TWO_OVER_SQRT_PI * Math.exp(-x2) * sum
}

// erfc(x) = e^(-x²) / (√π · (x + (1/2)/(x + (2/2)/(x + (3/2)/(x + …))))),
// evaluated by modified Lentz; converges quickly for x ≥ 2.5.
function erfcFraction(x: number): number {
  const tiny = 1e-300
  let f = x
  let c = x
  let d = 0
  for (let n = 1; n < 500; n++) {
    const a = n / 2
    d = x + a * d
    d = d === 0 ? 1 / tiny : 1 / d
    c = x + a / c
    if (c === 0) c = tiny
    const delta = c * d
    f *= delta
    if (Math.abs(delta - 1) < 1e-16) break
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f)
}

// C(n, k). Exact on integers with n ≥ 0 (each partial product is itself a
// binomial coefficient, so it stays whole); 0 outside 0 ≤ k ≤ n; through Γ
// otherwise.
export function choose(n: number, k: number): number {
  if (Number.isNaN(n) || Number.isNaN(k)) return Number.NaN
  if (Number.isInteger(n) && Number.isInteger(k) && n >= 0) {
    if (k < 0 || k > n) return 0
    const m = Math.min(k, n - k)
    let r = 1
    for (let i = 1; i <= m; i++) r = (r * (n - m + i)) / i
    return r
  }
  return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1))
}

// P(n, k) = n! / (n − k)!. Exact on integers with n ≥ 0; 0 outside the range.
export function perm(n: number, k: number): number {
  if (Number.isNaN(n) || Number.isNaN(k)) return Number.NaN
  if (Number.isInteger(n) && Number.isInteger(k) && n >= 0) {
    if (k < 0 || k > n) return 0
    let r = 1
    for (let i = n - k + 1; i <= n; i++) r *= i
    return r
  }
  return gamma(n + 1) / gamma(n - k + 1)
}

export function gcd(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return Number.NaN
  return gcdInt(a, b)
}

export function lcm(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return Number.NaN
  if (a === 0 || b === 0) return 0
  return Math.abs((a / gcdInt(a, b)) * b)
}

// The n-th root of x, for a nonzero whole n: real below zero when n is odd,
// NaN there when n is even; 1/root(−n, x) for negative n.
export function root(n: number, x: number): number {
  if (!Number.isInteger(n) || n === 0 || Number.isNaN(x)) return Number.NaN
  if (n < 0) return 1 / root(-n, x)
  if (n === 1) return x
  if (n === 2) return Math.sqrt(x)
  if (n === 3) return Math.cbrt(x)
  if (x < 0) return n % 2 === 1 ? -Math.pow(-x, 1 / n) : Number.NaN
  return Math.pow(x, 1 / n)
}

// The Heaviside step, step(0) = 1.
export function step(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  return x >= 0 ? 1 : 0
}
```

- [ ] **Step 4: Register the built-ins on both compile paths**

In `graph-engine/src/math/compile.ts`, add the import:

```ts
import { choose, erf, erfc, gamma, gcd, lcm, perm, root, step } from './special'
```

Add a helper after `variadic`:

```ts
// A two-argument built-in that is a plain function of both.
function binary2(fn: (a: number, b: number) => number): Builtin {
  return {
    min: 2,
    max: 2,
    make: ([a, b]) => (f) => fn(a(f), b(f)),
  }
}
```

Append these entries to the `BUILTINS` map (after `'hypot'`):

```ts
  // Special and integer functions (calc P1, math/special.ts).
  ['gamma', unary(gamma)],
  ['erf', unary(erf)],
  ['erfc', unary(erfc)],
  ['cbrt', unary(Math.cbrt)],
  ['step', unary(step)],
  ['choose', binary2(choose)],
  ['perm', binary2(perm)],
  ['gcd', binary2(gcd)],
  ['lcm', binary2(lcm)],
  ['root', binary2(root)],
```

Extend the register program. Append to `UNARY_TABLE`, in this order: `gamma, erf, erfc, Math.cbrt, step`, and extend the name list given to `UNARY_INDEX` with `'gamma', 'erf', 'erfc', 'cbrt', 'step'` at the end (the two lists must stay index-aligned). Replace `BINARY_TABLE` with:

```ts
const BINARY_TABLE: readonly ((x: number, y: number) => number)[] = [(x, y) => Math.log(x) / Math.log(y), floorMod, choose, perm, gcd, lcm, root]
```

In `programCall`'s `switch (name)`, add before `default:`:

```ts
    case 'choose':
      return p.emit(OP_CALL2, a, b, 2)
    case 'perm':
      return p.emit(OP_CALL2, a, b, 3)
    case 'gcd':
      return p.emit(OP_CALL2, a, b, 4)
    case 'lcm':
      return p.emit(OP_CALL2, a, b, 5)
    case 'root':
      return p.emit(OP_CALL2, a, b, 6)
```

(`gamma`, `erf`, `erfc`, `cbrt` and `step` go through the existing `default:` → `OP_CALL1` via `unaryIndex`.)

- [ ] **Step 5: Add the derivative rules**

In `graph-engine/src/math/diff.ts`, in `differentiateCall`'s `switch (name)`, add before the closing `}` of the switch:

```ts
    case 'cbrt':
      // d cbrt(a) = a' / (3 cbrt(a)^2)
      return div(d(a), mul(num(3), pow(call('cbrt', a), TWO)))
    case 'root': {
      // root(n, a) = a^(1/n), so d/dv = root(n, a) / (n a) · a' for n constant in v.
      if (dependsOn(a, v, scope)) throw new CompileError(`No derivative rule for "root" when its index depends on "${v}"`, ['root'])
      return mul(div(expr, mul(a, b)), d(b))
    }
    case 'erf':
      // d erf(a) = (2/√π) e^(-a²) a'
      return mul(mul(div(TWO, call('sqrt', variable('pi'))), call('exp', neg(pow(a, TWO)))), d(a))
    case 'erfc':
      return neg(mul(mul(div(TWO, call('sqrt', variable('pi'))), call('exp', neg(pow(a, TWO)))), d(a)))
    case 'step':
      // 0 wherever the step has a derivative, NaN at 0 (0/a is NaN only there).
      return mul(div(ZERO, a), d(a))
    case 'gamma':
    case 'choose':
    case 'perm':
      throw new CompileError(`No derivative rule for "${name}": its derivative needs the digamma function, which the kernel does not have yet`, [name])
    case 'gcd':
    case 'lcm':
      throw new CompileError(`No derivative rule for "${name}": it is defined on whole numbers only`, [name])
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/math/special.test.ts src/math/compile.test.ts src/math/diff.test.ts`
Expected: PASS, including the existing "compileMany covers every registered built-in" test.

- [ ] **Step 7: Run everything that must not move**

The same four checks as Task 1 Step 8 (suite, both typechecks, oxlint, sweep). Note: the new names join `BUILTIN_NAMES`, which space's grammar treats as reserved (`space/grammar/unkeyed.ts`) and space's scope builder refuses as definition names. If the sweep or a space test changes because an example used one of the ten new names as its own definition, stop and report it.

- [ ] **Step 8: Commit**

```bash
git add src/math/special.ts src/math/special.test.ts src/math/compile.ts src/math/diff.ts
git commit -m "feat(math): gamma, erf, erfc, cbrt, step, choose, perm, gcd, lcm and root on both compile paths, with exact derivatives or refusals

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space with the summary, the ten new names and the sweep result.

---

### Task 3: Reserved constructs — conditions, piecewise, factorial, primes, products

**Files:**
- Create: `graph-engine/src/math/reserved.ts`
- Create: `graph-engine/src/math/prime.ts`
- Create: `graph-engine/src/math/reserved.test.ts`
- Modify: `graph-engine/src/math/compile.ts` (`compileCall`, `compileVar`, `programCall`, `freeVariablesDeep`, two table entries, one opcode)
- Modify: `graph-engine/src/math/diff.ts` (`differentiateCall`)
- Modify: `graph-engine/src/math/expr.ts` (`substitute`, `varNames` leave `__prime`'s function name alone)

**Interfaces:**
- Consumes: `factorial` from `math/special.ts`.
- Produces (from `math/reserved.ts`): name constants and constructors used by the parser in Task 5 —
  `type ComparisonOp = '<' | '<=' | '>' | '>=' | '=' | '!='`,
  `compare(op: ComparisonOp, a: Expr, b: Expr): Expr`, `and(a, b)`, `or(a, b)`, `not(a)`,
  `piecewise(pieces: readonly (readonly [Expr, Expr])[], otherwise: Expr | null): Expr`,
  `factorialOf(a: Expr): Expr`, `prime(fn: string, order: number, args: readonly Expr[]): Expr`,
  `isReserved(name: string): boolean`, `MAX_PRIME_ORDER = 5`, `MAX_TERMS = 100_000`, and the value helpers `compareValue`, `pick`, `andValue`, `orValue`, `notValue`.
- Produces (from `math/prime.ts`): `derivativeBody(name: string, fn: MathFunction, order: number, scope: MathScope): Expr`, `expandPrime(expr: Expr & { kind: 'call' }, scope: MathScope): Expr`.

- [ ] **Step 1: Write `math/reserved.ts`** (the documented shapes; tests in Step 2 use it)

```ts
// The reserved call names (calc P1). New expression constructs are encoded as
// calls with these names, so the Expr union in parser/types.ts never changes
// and every engine that switches on Expr.kind compiles untouched (agreed with
// space, 2026-10-01). The shapes are STABLE — space prints them by name in its
// readouts — so change one only together with space.
//
//   __lt(a, b) __le __gt __ge __eq __ne   1 when the comparison holds, 0 when
//                                          not, NaN when either side is NaN
//   __and(a, b) __or(a, b) __not(a)       on truth values: nonzero is true;
//                                          NaN in, NaN out
//   __piecewise(c1, v1, …, cn, vn[, o])   the value of the first piece whose
//                                          condition is true; a NaN condition
//                                          met on the way makes the value NaN;
//                                          with no piece true, o, or NaN if
//                                          there is no o
//   __factorial(a)                        a! = gamma(a + 1)
//   __prime(f, k, a1, …, an)              the k-th derivative of user function
//                                          f (a var node naming it) at a1…an;
//                                          k a whole literal
//   __sum(k, lo, hi, body)                Σ body for k = lo…hi, k a var node
//   __prod(k, lo, hi, body)               Π body; bound inside body only
//   __integral(t, lo, hi, body)           ∫ body dt from lo to hi (t bound)

import type { Expr } from '../parser/types'
import { call, num, variable } from './expr'

export type ComparisonOp = '<' | '<=' | '>' | '>=' | '=' | '!='

export const COMPARISON_NAMES: Readonly<Record<ComparisonOp, string>> = {
  '<': '__lt',
  '<=': '__le',
  '>': '__gt',
  '>=': '__ge',
  '=': '__eq',
  '!=': '__ne',
}

const COMPARISON_OPS: ReadonlyMap<string, ComparisonOp> = new Map(Object.entries(COMPARISON_NAMES).map(([op, name]) => [name, op as ComparisonOp]))

export const BINDERS: ReadonlySet<string> = new Set(['__sum', '__prod', '__integral'])

const RESERVED: ReadonlySet<string> = new Set([
  ...Object.values(COMPARISON_NAMES),
  '__and',
  '__or',
  '__not',
  '__piecewise',
  '__factorial',
  '__prime',
  ...BINDERS,
])

export const MAX_PRIME_ORDER = 5
export const MAX_TERMS = 100_000

export function isReserved(name: string): boolean {
  return RESERVED.has(name)
}

export function comparisonOp(name: string): ComparisonOp | null {
  return COMPARISON_OPS.get(name) ?? null
}

// --- constructors (the parser builds these; nothing else should hand-roll them)

export function compare(op: ComparisonOp, a: Expr, b: Expr): Expr {
  return call(COMPARISON_NAMES[op], a, b)
}

export const and = (a: Expr, b: Expr): Expr => call('__and', a, b)
export const or = (a: Expr, b: Expr): Expr => call('__or', a, b)
export const not = (a: Expr): Expr => call('__not', a)

export function piecewise(pieces: readonly (readonly [Expr, Expr])[], otherwise: Expr | null): Expr {
  const args: Expr[] = []
  for (const [condition, value] of pieces) args.push(condition, value)
  if (otherwise) args.push(otherwise)
  return call('__piecewise', ...args)
}

export const factorialOf = (a: Expr): Expr => call('__factorial', a)

export function prime(fn: string, order: number, args: readonly Expr[]): Expr {
  return call('__prime', variable(fn), num(order), ...args)
}

export function sum(k: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__sum', variable(k), lo, hi, body)
}

export function prod(k: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__prod', variable(k), lo, hi, body)
}

export function integral(t: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__integral', variable(t), lo, hi, body)
}

// --- values (shared by both compile paths so they agree exactly)

export function compareValue(op: ComparisonOp, a: number, b: number): number {
  if (a !== a || b !== b) return Number.NaN
  switch (op) {
    case '<':
      return a < b ? 1 : 0
    case '<=':
      return a <= b ? 1 : 0
    case '>':
      return a > b ? 1 : 0
    case '>=':
      return a >= b ? 1 : 0
    case '=':
      return a === b ? 1 : 0
    case '!=':
      return a !== b ? 1 : 0
  }
}

export function andValue(a: number, b: number): number {
  return a !== a || b !== b ? Number.NaN : a !== 0 && b !== 0 ? 1 : 0
}

export function orValue(a: number, b: number): number {
  return a !== a || b !== b ? Number.NaN : a !== 0 || b !== 0 ? 1 : 0
}

export function notValue(a: number): number {
  return a !== a ? Number.NaN : a !== 0 ? 0 : 1
}

// One step of __piecewise from the back: the condition c's value, its piece's
// value v, and what follows. Evaluated eagerly by compileMany and lazily by
// the closures; both give the same number because nothing has a side effect.
export function pick(c: number, v: number, rest: number): number {
  return c !== c ? Number.NaN : c !== 0 ? v : rest
}

// The bound variable's name of a binder call, or of __prime's function: the
// first argument must be a var node.
export function nameArgument(expr: Expr & { kind: 'call' }, what: string): string {
  const first = expr.args[0]
  if (!first || first.kind !== 'var') throw new Error(`${expr.name}: the first argument must name the ${what}`)
  return first.name
}
```

- [ ] **Step 2: Write the failing tests**

Create `graph-engine/src/math/reserved.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { CompileError, compileMany, compileScalar, freeVariablesDeep } from './compile'
import { diff } from './diff'
import { num, renameVars, varNames, variable } from './expr'
import { compare, factorialOf, not, or, and, piecewise, prime } from './reserved'
import { makeScope, type MathFunction } from './scope'
import { simplify } from './simplify'

const x = variable('x')
const one = new Float64Array(1)

function fn(params: string[], body: string): MathFunction {
  return { params, body: p(body) }
}

function both(expr: Expr, at: number, scope = makeScope()): number {
  const closure = compileScalar(expr, ['x'], scope)(at)
  const program = compileMany([expr], ['x'], scope)(one, at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure} at ${at}`).toBe(true)
  return closure
}

describe('comparisons and logic', () => {
  it('compare gives 1, 0, and NaN for a NaN side', () => {
    expect(both(compare('<', x, num(0)), -1)).toBe(1)
    expect(both(compare('<', x, num(0)), 0)).toBe(0)
    expect(both(compare('<=', x, num(0)), 0)).toBe(1)
    expect(both(compare('!=', x, num(0)), 0)).toBe(0)
    expect(both(compare('=', x, num(2)), 2)).toBe(1)
    expect(both(compare('<', p('ln(x)'), num(0)), -1)).toBeNaN()
  })

  it('and, or, not', () => {
    const inside = and(compare('>', x, num(0)), compare('<', x, num(1)))
    expect(both(inside, 0.5)).toBe(1)
    expect(both(inside, 2)).toBe(0)
    expect(both(or(compare('<', x, num(0)), compare('>', x, num(1))), 2)).toBe(1)
    expect(both(not(compare('<', x, num(0))), 2)).toBe(1)
  })
})

describe('__piecewise', () => {
  const f = piecewise(
    [
      [compare('<', x, num(0)), p('x^2')],
      [compare('<=', x, num(2)), p('2x + 1')],
    ],
    num(5)
  )

  it('takes the first true piece, then the otherwise', () => {
    expect(both(f, -3)).toBe(9)
    expect(both(f, 0)).toBe(1)
    expect(both(f, 2)).toBe(5)
    expect(both(f, 7)).toBe(5)
  })

  it('with no otherwise, is NaN where no piece holds', () => {
    const g = piecewise([[compare('<', x, num(0)), p('x^2')]], null)
    expect(both(g, 1)).toBeNaN()
  })

  it('a NaN condition makes the value NaN', () => {
    const g = piecewise([[compare('<', p('ln(x)'), num(0)), num(1)]], num(2))
    expect(both(g, -1)).toBeNaN()
  })

  it('differentiates piece by piece with the same conditions', () => {
    const d = compileScalar(simplify(diff(f, 'x', makeScope())), ['x'], makeScope())
    expect(d(-1)).toBe(-2)
    expect(d(1)).toBe(2)
    expect(d(3)).toBe(0)
  })
})

describe('__factorial', () => {
  it('is gamma(a + 1)', () => {
    expect(both(factorialOf(x), 5)).toBe(120)
    expect(both(factorialOf(x), -1)).toBeNaN()
    expect(both(factorialOf(x), 0.5)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 14)
  })

  it('has no derivative rule yet', () => {
    expect(() => diff(factorialOf(x), 'x', makeScope())).toThrow(CompileError)
  })
})

describe("__prime: f'(x), f''(x)", () => {
  const scope = makeScope({ functions: [['f', fn(['t'], 't^3 - 3t')], ['g', fn(['a', 'b'], 'a b')], ['s', fn(['t'], 'sin(t)')]] })

  it("f'(2) = 9 and f''(2) = 12 for f(t) = t^3 - 3t", () => {
    expect(both(prime('f', 1, [x]), 2, scope)).toBe(9)
    expect(both(prime('f', 2, [x]), 2, scope)).toBe(12)
  })

  it("s'(0) = cos 0 = 1", () => {
    expect(both(prime('s', 1, [x]), 0, scope)).toBe(1)
  })

  it('refuses an unknown function and a function of two variables', () => {
    expect(() => compileScalar(prime('h', 1, [x]), ['x'], scope)).toThrow(/Unknown function "h"/)
    expect(() => compileScalar(prime('g', 1, [x]), ['x'], scope)).toThrow(CompileError)
  })

  it("d/dx f'(x) is f''(x)", () => {
    const d = compileScalar(simplify(diff(prime('f', 1, [x]), 'x', scope)), ['x'], scope)
    expect(d(2)).toBe(12)
  })

  it("a rename never touches the function's name", () => {
    expect(renameVars(prime('f', 1, [variable('f')]), new Map([['f', 'u']]))).toEqual(prime('f', 1, [variable('u')]))
    expect(varNames(prime('f', 1, [x]))).toEqual(new Set(['x']))
  })

  it('freeVariablesDeep follows the function, not its name', () => {
    const withParam = makeScope({ functions: [['q', fn(['t'], 'a t^2')]], params: [['a', 2]] })
    expect(freeVariablesDeep(prime('q', 1, [x]), withParam, new Set(['x']))).toEqual(new Set(['a']))
  })
})

describe('a name that is a value, called, is a product', () => {
  const scope = makeScope({ functions: [['k', fn([], '5')]] })

  it('x(x + 1) at 2 is 6; k(x + 1) at 1 is 10; pi(2) is 2 pi', () => {
    expect(both(p('x(x + 1)'), 2, scope)).toBe(6)
    expect(both(p('k(x + 1)'), 1, scope)).toBe(10)
    expect(compileScalar(p('pi(2)'), [], scope)()).toBe(2 * Math.PI)
  })

  it('differentiates as a product', () => {
    expect(compileScalar(simplify(diff(p('x(x + 1)'), 'x', scope)), ['x'], scope)(2)).toBe(5)
  })

  it('an unknown name is still an unknown function', () => {
    expect(() => compileScalar(p('q(x)'), ['x'], scope)).toThrow(/Unknown function "q"/)
  })
})

describe('the "did you mean x*y?" hint', () => {
  it('names the product when every letter is a bound variable', () => {
    expect(() => compileScalar(p('xy'), ['x', 'y'], makeScope())).toThrow(/did you mean x\*y\?/)
  })

  it('stays quiet otherwise', () => {
    expect(() => compileScalar(p('xz'), ['x', 'y'], makeScope())).toThrow(/^Unknown variable "xz"$/)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/math/reserved.test.ts`
Expected: FAIL — compile errors such as `Unknown function "__lt"`.

- [ ] **Step 4: Write `math/prime.ts`**

```ts
// f'(x), f''(x), … (calc P1): the k-th derivative of a one-variable user
// function, as an expression over the function's own parameter, computed once
// per (scope, function, order) by symbolic diff and simplify.

import type { Expr } from '../parser/types'
import { CompileError } from './compile'
import { diff } from './diff'
import { substitute } from './expr'
import { MAX_PRIME_ORDER, nameArgument } from './reserved'
import { isVectorBody, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const CACHE = new WeakMap<MathScope, Map<string, Expr>>()

// The highest order the kernel computes. Authors write at most
// MAX_PRIME_ORDER primes; diff of f^(k) may ask for one more.
const KERNEL_ORDER_LIMIT = MAX_PRIME_ORDER + 3

export function primeFunction(expr: Expr & { kind: 'call' }, scope: MathScope): { name: string; fn: MathFunction; order: number } {
  const name = nameArgument(expr, 'function')
  const orderArg = expr.args[1]
  if (!orderArg || orderArg.kind !== 'num' || !Number.isInteger(orderArg.value) || orderArg.value < 1 || orderArg.value > KERNEL_ORDER_LIMIT) {
    throw new CompileError(`"${name}" with that many primes is not supported`, [name])
  }
  const fn = scope.functions.get(name)
  if (!fn) throw new CompileError(`Unknown function "${name}"`, [name])
  if (isVectorBody(fn.body)) throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
  if (fn.params.length !== 1) {
    throw new CompileError(`"${name}${"'".repeat(orderArg.value)}" needs a function of one variable; "${name}" takes ${fn.params.length}`, [name])
  }
  if (expr.args.length !== 3) {
    throw new CompileError(`"${name}${"'".repeat(orderArg.value)}" takes 1 argument, got ${expr.args.length - 2}`, [name])
  }
  return { name, fn, order: orderArg.value }
}

export function derivativeBody(name: string, fn: MathFunction, order: number, scope: MathScope): Expr {
  let cache = CACHE.get(scope)
  if (!cache) {
    cache = new Map()
    CACHE.set(scope, cache)
  }
  const key = `${name}#${order}`
  const known = cache.get(key)
  if (known) return known
  const below = order === 1 ? (fn.body as Expr) : derivativeBody(name, fn, order - 1, scope)
  const result = simplify(diff(below, fn.params[0], scope))
  cache.set(key, result)
  return result
}

// __prime(f, k, a) written out: f^(k)'s body with its parameter replaced by a.
export function expandPrime(expr: Expr & { kind: 'call' }, scope: MathScope): Expr {
  const { name, fn, order } = primeFunction(expr, scope)
  return substitute(derivativeBody(name, fn, order, scope), new Map([[fn.params[0], expr.args[2]]]))
}
```

- [ ] **Step 5: Teach the closure compiler**

In `graph-engine/src/math/compile.ts`, add imports:

```ts
import { derivativeBody, primeFunction } from './prime'
import { andValue, comparisonOp, compareValue, isReserved, notValue, orValue } from './reserved'
import { factorial } from './special'
```

(`math/prime.ts` imports `CompileError` from this file and `diff`, which imports this file: the cycle is safe because every use is inside a function, never at module load.)

Add, before `compileCall`:

```ts
// Whether `name` denotes a value here — a bound variable, a parameter, a user
// constant, pi, e or inf — so that "name(arg)" is a product, x(x + 1).
function namesValue(name: string, env: Env, ctx: Ctx): boolean {
  if (env.bound.has(name) || ctx.scope.params.index.has(name)) return true
  const fn = ctx.scope.functions.get(name)
  if (fn) return fn.params.length === 0
  return name === 'pi' || name === 'e' || name === 'inf'
}

function compileReserved(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): Node {
  const { name } = expr
  const args = () => expr.args.map((arg) => compileNode(arg, env, ctx))
  const op = comparisonOp(name)
  if (op) {
    if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
    const [a, b] = args()
    return (f) => compareValue(op, a(f), b(f))
  }
  switch (name) {
    case '__and':
    case '__or': {
      if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
      const [a, b] = args()
      return name === '__and' ? (f) => andValue(a(f), b(f)) : (f) => orValue(a(f), b(f))
    }
    case '__not': {
      if (expr.args.length !== 1) throw new CompileError(`"__not" takes 1 argument, got ${expr.args.length}`, [name])
      const [a] = args()
      return (f) => notValue(a(f))
    }
    case '__factorial': {
      if (expr.args.length !== 1) throw new CompileError(`"__factorial" takes 1 argument, got ${expr.args.length}`, [name])
      const [a] = args()
      return (f) => factorial(a(f))
    }
    case '__piecewise': {
      if (expr.args.length < 2) throw new CompileError('A piecewise definition needs at least one condition and its value', [name])
      const nodes = args()
      const pieces = Math.floor(nodes.length / 2)
      const conditions = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 0)
      const values = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 1)
      const otherwise = nodes.length % 2 === 1 ? nodes[nodes.length - 1] : null
      return (f) => {
        for (let i = 0; i < conditions.length; i++) {
          const c = conditions[i](f)
          if (c !== c) return Number.NaN
          if (c !== 0) return values[i](f)
        }
        return otherwise ? otherwise(f) : Number.NaN
      }
    }
    case '__prime': {
      const { name: fnName, fn, order } = primeFunction(expr, ctx.scope)
      const body = derivativeBody(fnName, fn, order, ctx.scope)
      return inlineBody(fnName, { params: fn.params, body }, [compileNode(expr.args[2], env, ctx)], ctx)
    }
  }
  throw new CompileError(`"${name}" is reserved and not supported here`, [name])
}
```

At the top of `compileCall`, right after `const { name } = expr`, add:

```ts
  if (isReserved(name)) return compileReserved(expr, env, ctx)
```

Change the user-function branch of `compileCall` so a constant called with one argument is a product. Replace `if (fn) {` … through its closing `}` with:

```ts
  if (fn && !(fn.params.length === 0 && expr.args.length === 1)) {
    if (expr.args.length !== fn.params.length) {
      throw new CompileError(`"${name}" takes ${arityText(fn.params.length, fn.params.length)}, got ${expr.args.length}`, [name])
    }
    if (isVectorBody(fn.body)) {
      throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
    }
    if (ctx.stack.includes(name)) throw cycleError(ctx.stack, name)
    const args = expr.args.map((arg) => compileNode(arg, env, ctx))
    return inlineBody(name, fn, args, ctx)
  }
```

and replace the line `if (!builtin) throw new CompileError(\`Unknown function "${name}"\`, [name])` with:

```ts
  if (!builtin) {
    if (expr.args.length === 1 && namesValue(name, env, ctx)) {
      return binaryNode('*', compileVar(name, env, ctx), compileNode(expr.args[0], env, ctx), ctx.scope.params.values)
    }
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
```

In `compileVar`, add `inf` beside `pi` and `e`, and the hint on the final error. Replace its last three lines with:

```ts
  if (name === 'pi') return constantLeaf(Math.PI)
  if (name === 'e') return constantLeaf(Math.E)
  if (name === 'inf') return constantLeaf(Infinity)
  throw new CompileError(`Unknown variable "${name}"${productHint(name, env)}`, [name])
}

// "xy" with x and y both bound reads as a product the author forgot to mark.
function productHint(name: string, env: { readonly bound: ReadonlyMap<string, number> }): string {
  if (name.length < 2 || ![...name].every((c) => env.bound.has(c))) return ''
  return ` — did you mean ${[...name].join('*')}?`
}
```

- [ ] **Step 6: Teach the register program**

In `compile.ts`, add one opcode after `OP_RPOW_EVEN`:

```ts
const OP_PICK = 24
```

Append to `UNARY_TABLE`: `notValue, factorial` and to the `UNARY_INDEX` name list: `'__not', '__factorial'` (index-aligned). Append to `BINARY_TABLE`, in this order:

```ts
  (a, b) => compareValue('<', a, b),
  (a, b) => compareValue('<=', a, b),
  (a, b) => compareValue('>', a, b),
  (a, b) => compareValue('>=', a, b),
  (a, b) => compareValue('=', a, b),
  (a, b) => compareValue('!=', a, b),
  andValue,
  orValue,
```

so `__lt` … `__ne` are indices 7–12, `__and` 13, `__or` 14. Add the comparison-name map for the program:

```ts
const BINARY_INDEX: ReadonlyMap<string, number> = new Map([
  ['__lt', 7],
  ['__le', 8],
  ['__gt', 9],
  ['__ge', 10],
  ['__eq', 11],
  ['__ne', 12],
  ['__and', 13],
  ['__or', 14],
])
```

Add `programReserved` before `programCall`:

```ts
function programReserved(expr: Expr & { kind: 'call' }, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): number {
  const { name } = expr
  const p = ctx.program
  const binaryIndex = BINARY_INDEX.get(name)
  if (binaryIndex !== undefined) {
    if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
    const [a, b] = expr.args.map((arg) => programNode(arg, bound, ctx))
    return p.emit(OP_CALL2, a, b, binaryIndex)
  }
  switch (name) {
    case '__not':
    case '__factorial': {
      if (expr.args.length !== 1) throw new CompileError(`"${name}" takes 1 argument, got ${expr.args.length}`, [name])
      return p.emit(OP_CALL1, programNode(expr.args[0], bound, ctx), unaryIndex(name))
    }
    case '__piecewise': {
      if (expr.args.length < 2) throw new CompileError('A piecewise definition needs at least one condition and its value', [name])
      const regs = expr.args.map((arg) => programNode(arg, bound, ctx))
      const pieces = Math.floor(regs.length / 2)
      let rest = regs.length % 2 === 1 ? regs[regs.length - 1] : p.constant(Number.NaN)
      for (let i = pieces - 1; i >= 0; i--) rest = p.emit(OP_PICK, regs[2 * i], regs[2 * i + 1], rest)
      return rest
    }
    case '__prime': {
      const { name: fnName, fn, order } = primeFunction(expr, ctx.scope)
      const body = derivativeBody(fnName, fn, order, ctx.scope)
      return programInline(fnName, { params: fn.params, body }, [programNode(expr.args[2], bound, ctx)], ctx)
    }
  }
  throw new CompileError(`"${name}" is reserved and not supported here`, [name])
}
```

`p.constant(Number.NaN)`: the constant cache keys by `String(value)`, so NaN is cached under `"NaN"` — fine.

In `programCall`, right after `const p = ctx.program`, add:

```ts
  if (isReserved(name)) return programReserved(expr, bound, ctx)
```

Make the same two product changes as Step 5 in `programCall`: the user-function branch becomes `if (fn && !(fn.params.length === 0 && expr.args.length === 1)) {`, and replace `if (!builtin) throw new CompileError(\`Unknown function "${name}"\`, [name])` with:

```ts
  if (!builtin) {
    if (expr.args.length === 1 && programNamesValue(name, bound, ctx)) {
      return p.emit(OP_MUL, programVar(name, bound, ctx), programNode(expr.args[0], bound, ctx))
    }
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
```

with, before `programCall`:

```ts
function programNamesValue(name: string, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): boolean {
  if (bound.has(name) || ctx.scope.params.index.has(name)) return true
  const fn = ctx.scope.functions.get(name)
  if (fn) return fn.params.length === 0
  return name === 'pi' || name === 'e' || name === 'inf'
}
```

In `programVar`, add `if (name === 'inf') return ctx.program.constant(Infinity)` after the `e` line, and give its final error the same hint: `throw new CompileError(\`Unknown variable "${name}"${productHint(name, { bound })}\`, [name])`.

In the run loop, add:

```ts
        case OP_PICK:
          reg[d] = pick(reg[x], reg[y], reg[code[pc + 4]])
          break
```

and import `pick` from `./reserved`.

- [ ] **Step 7: Teach `freeVariablesDeep` and `expr.ts`**

In `freeVariablesDeep`'s `walk`, replace the `'call'` case with:

```ts
      case 'call': {
        // __prime's first argument names a function, not a variable.
        if (e.name === '__prime') {
          const target = e.args[0]
          const fn = target?.kind === 'var' ? scope.functions.get(target.name) : undefined
          if (target?.kind === 'var' && fn) follow(target.name, fn, into)
          for (const arg of e.args.slice(2)) walk(arg, local, into)
          return
        }
        for (const arg of e.args) walk(arg, local, into)
        const fn = scope.functions.get(e.name)
        if (fn && !(fn.params.length === 0 && e.args.length === 1)) {
          follow(e.name, fn, into)
          return
        }
        // A name used as a factor, x(x + 1), is read like a variable.
        if (e.args.length === 1 && !BUILTINS.has(e.name) && !isReserved(e.name)) walk({ kind: 'var', name: e.name }, local, into)
        return
      }
```

and in its `'var'` case, extend the constants rule to `inf`: `if (!fn && (e.name === 'pi' || e.name === 'e' || e.name === 'inf') && !scope.params.index.has(e.name)) return`.

In `graph-engine/src/math/expr.ts`, `substitute` and `varNames` leave `__prime`'s first argument alone. In `substitute`'s `'call'` case:

```ts
    case 'call':
      // __prime(f, k, …): f names a function, never a variable.
      if (expr.name === '__prime') return { kind: 'call', name: expr.name, args: expr.args.map((a, i) => (i === 0 ? a : substitute(a, map))) }
      return { kind: 'call', name: expr.name, args: expr.args.map((a) => substitute(a, map)) }
```

In `varNames`'s `'call'` case:

```ts
    case 'call':
      for (const [i, a] of expr.args.entries()) if (!(expr.name === '__prime' && i === 0)) varNames(a, into)
      break
```

- [ ] **Step 8: Teach diff**

In `graph-engine/src/math/diff.ts`, add imports:

```ts
import { expandPrime } from './prime'
import { comparisonOp, isReserved, piecewise } from './reserved'
```

At the top of `differentiateCall`, after `const { name, args } = expr`, add:

```ts
  if (isReserved(name)) return differentiateReserved(expr, v, scope, ctx)
```

Change its user-function branch the same way as compile's: `if (fn && !(fn.params.length === 0 && args.length === 1)) {`. Replace `if (!arity) throw new CompileError(\`Unknown function "${name}"\`, [name])` with:

```ts
  if (!arity) {
    // name(arg) with name a value is a product, x(x + 1).
    if (args.length === 1) return differentiate(mul(variable(name), args[0]), v, scope, ctx)
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
```

Add, after `differentiateCall`:

```ts
function differentiateReserved(expr: Expr & { kind: 'call' }, v: string, scope: MathScope, ctx: Ctx): Expr {
  const { name, args } = expr
  // Conditions are piecewise constant: 0 wherever they have a derivative.
  if (comparisonOp(name) || name === '__and' || name === '__or' || name === '__not') return ZERO
  switch (name) {
    case '__piecewise': {
      const pieces = Math.floor(args.length / 2)
      const parts: [Expr, Expr][] = []
      for (let i = 0; i < pieces; i++) parts.push([args[2 * i], differentiate(args[2 * i + 1], v, scope, ctx)])
      const otherwise = args.length % 2 === 1 ? differentiate(args[args.length - 1], v, scope, ctx) : null
      return piecewise(parts, otherwise)
    }
    case '__factorial':
      throw new CompileError('No derivative rule for "!": its derivative needs the digamma function, which the kernel does not have yet', ['__factorial'])
    case '__prime':
      return differentiate(expandPrime(expr, scope), v, scope, ctx)
  }
  throw new CompileError(`No derivative rule for "${name}"`, [name])
}
```

(`__sum`, `__prod` and `__integral` are Task 4; until then they reach the final refusal.)

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/math/`
Expected: PASS (reserved, rational, special, and every existing math test).

- [ ] **Step 10: Run everything that must not move**

The four checks of Task 1 Step 8.

- [ ] **Step 11: Commit**

```bash
git add src/math/reserved.ts src/math/prime.ts src/math/reserved.test.ts src/math/compile.ts src/math/diff.ts src/math/expr.ts
git commit -m "feat(math): reserved constructs for conditions, piecewise, factorial and f', names called as products, the x*y hint

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space with the summary, the documented shapes (point at `math/reserved.ts`'s header) and the sweep result.

---

### Task 4: Binders — `sum`, `prod`, `integral`

**Files:**
- Create: `graph-engine/src/math/binders.ts`
- Create: `graph-engine/src/math/binders.test.ts`
- Modify: `graph-engine/src/math/compile.ts` (`compileReserved`, `programReserved`, `freeVariablesDeep`, one opcode, an exported closure helper)
- Modify: `graph-engine/src/math/diff.ts` (`differentiateReserved`)
- Modify: `graph-engine/src/math/expr.ts` (`substitute`, `varNames` become binder-aware)

**Interfaces:**
- Consumes: `sum`, `prod`, `integral`, `BINDERS`, `MAX_TERMS`, `nameArgument` from `math/reserved.ts`; `integrate1`, `quadBudget`, `QuadratureError` from `math/quadrature.ts`; `QUAD_TOL` from `math/tolerance.ts`.
- Produces: `integrateValue(g: (t: number) => number, a: number, b: number): number` from `math/binders.ts` (NaN for a divergent or failed integral; infinite bounds by change of variables).

- [ ] **Step 1: Write the failing tests**

Create `graph-engine/src/math/binders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import type { Expr } from '../parser/types'
import { CompileError, compileMany, compileScalar, freeVariablesDeep } from './compile'
import { diff } from './diff'
import { num, substitute, varNames, variable } from './expr'
import { integrateValue } from './binders'
import { integral, prod, sum } from './reserved'
import { makeScope } from './scope'
import { simplify } from './simplify'

const k = variable('k')
const t = variable('t')
const x = variable('x')
const one = new Float64Array(1)

function both(expr: Expr, vars: string[], at: number[], scope = makeScope()): number {
  const closure = compileScalar(expr, vars, scope)(...at)
  const program = compileMany([expr], vars, scope)(one, ...at)[0]
  expect(Object.is(program, closure), `compileMany ${program} vs compileScalar ${closure}`).toBe(true)
  return closure
}

describe('__sum and __prod', () => {
  it('sum(k = 1 to 10, k) is 55; prod(k = 1 to 5, k) is 120', () => {
    expect(both(sum('k', num(1), num(10), k), [], [])).toBe(55)
    expect(both(prod('k', num(1), num(5), k), [], [])).toBe(120)
  })

  it('an empty sum is 0 and an empty product is 1', () => {
    expect(both(sum('k', num(3), num(2), k), [], [])).toBe(0)
    expect(both(prod('k', num(3), num(2), k), [], [])).toBe(1)
  })

  it('the Taylor partial sum of e^x at x = 1 with n = 15 is e to 1e-12', () => {
    // n! syntax arrives in Task 5, so the factorial is spelled gamma(k + 1).
    const scope = makeScope({ params: [['n', 15]] })
    const s = sum('k', num(0), variable('n'), p('x^k / gamma(k + 1)'))
    expect(Math.abs(both(s, ['x'], [1], scope) - Math.E)).toBeLessThan(1e-12)
  })

  it('reads the outer variables around it', () => {
    // Σ_{k=1}^{3} k·x = 6x
    expect(both(sum('k', num(1), num(3), p('k x')), ['x'], [2])).toBe(12)
  })

  it('refuses a constant bound that is not whole, and too many terms', () => {
    expect(() => compileScalar(sum('k', num(0.5), num(3), k), [], makeScope())).toThrow(CompileError)
    expect(() => compileScalar(sum('k', num(0), num(200000), k), [], makeScope())).toThrow(/100000/)
  })

  it('is NaN at run time when a parameter bound is not whole', () => {
    const scope = makeScope({ params: [['n', 2.5]] })
    expect(both(sum('k', num(0), variable('n'), k), [], [], scope)).toBeNaN()
  })

  it('d/dx sum(k = 1 to 3, x^k) at 1 is 1 + 2 + 3', () => {
    const d = simplify(diff(sum('k', num(1), num(3), p('x^k')), 'x', makeScope()))
    expect(compileScalar(d, ['x'], makeScope())(1)).toBe(6)
  })

  it('a product has no derivative rule yet', () => {
    expect(() => diff(prod('k', num(1), num(3), p('x + k')), 'x', makeScope())).toThrow(CompileError)
  })
})

describe('__integral', () => {
  it('integral(t = 0 to x, 2t) at 3 is 9', () => {
    expect(Math.abs(both(integral('t', num(0), x, p('2t')), ['x'], [3]) - 9)).toBeLessThan(1e-12)
  })

  it('Si(1), the integral of sin(t)/t from 0 to 1', () => {
    expect(Math.abs(both(integral('t', num(0), num(1), p('sin(t)/t')), [], []) - 0.946083070367183)).toBeLessThan(1e-12)
  })

  it('infinite bounds by a change of variables', () => {
    expect(Math.abs(both(integral('t', num(1), variable('inf'), p('1/t^2')), [], []) - 1)).toBeLessThan(1e-9)
    expect(Math.abs(both(integral('t', p('-inf'), variable('inf'), p('exp(-t^2)')), [], []) - Math.sqrt(Math.PI))).toBeLessThan(1e-9)
  })

  it('a divergent integral is NaN', () => {
    expect(both(integral('t', num(1), variable('inf'), p('1/t')), [], [])).toBeNaN()
  })

  it('reversed bounds change the sign', () => {
    expect(Math.abs(both(integral('t', num(3), num(0), p('2t')), [], []) + 9)).toBeLessThan(1e-12)
  })

  it('integrateValue: equal bounds are 0, NaN bounds are NaN', () => {
    expect(integrateValue((u) => u, 2, 2)).toBe(0)
    expect(integrateValue((u) => u, Number.NaN, 2)).toBeNaN()
  })

  it('Leibniz: d/dx integral(t = 0 to x, sin t) is sin x; d/dx integral(t = 0 to x^2, t) is 2x^3', () => {
    const scope = makeScope()
    const a = compileScalar(simplify(diff(integral('t', num(0), x, p('sin(t)')), 'x', scope)), ['x'], scope)
    expect(a(1)).toBeCloseTo(Math.sin(1), 14)
    const b = compileScalar(simplify(diff(integral('t', num(0), p('x^2'), t), 'x', scope)), ['x'], scope)
    expect(b(2)).toBeCloseTo(16, 12)
  })

  it('Leibniz under the sign: d/da integral(t = 0 to 1, a t) is 1/2', () => {
    const scope = makeScope({ params: [['a', 3]] })
    const d = compileScalar(simplify(diff(integral('t', num(0), num(1), p('a t')), 'a', scope)), [], scope)
    expect(d()).toBeCloseTo(0.5, 12)
  })
})

describe('binders bind', () => {
  it('a substitution never reaches the bound variable', () => {
    const s = sum('k', num(0), num(3), p('k x'))
    expect(substitute(s, new Map([['k', num(5)]]))).toEqual(s)
  })

  it('a substituted value that mentions the bound name does not get captured', () => {
    // Σ_{j=0}^{3} j · k with the outer k = 2 is 12
    const s = substitute(sum('k', num(0), num(3), p('k x')), new Map([['x', variable('k')]]))
    expect(compileScalar(s, ['k'], makeScope())(2)).toBe(12)
  })

  it('varNames and freeVariablesDeep leave the bound name out', () => {
    expect(varNames(sum('k', num(0), variable('n'), p('k x')))).toEqual(new Set(['n', 'x']))
    const scope = makeScope({ params: [['a', 1]] })
    expect(freeVariablesDeep(integral('t', num(0), x, p('a t')), scope, new Set(['x']))).toEqual(new Set(['a']))
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/math/binders.test.ts`
Expected: FAIL — `Cannot find module './binders'`.

- [ ] **Step 3: Write `math/binders.ts`**

```ts
// The integral behind __integral (calc P1): space's adaptive Gauss–Kronrod
// (math/quadrature.ts), with infinite bounds mapped onto finite ones. A
// divergent or failed integral is NaN — undefined, never a wrong number.

import { integrate1, QuadratureError, quadBudget, type QuadResult } from './quadrature'
import { QUAD_TOL } from './tolerance'

// Evaluations one integral may spend. Every sample of a plotted F(x) is one
// integral, so this is per sample, far below a whole-scene budget.
export const INTEGRAL_BUDGET = 100_000

// An error estimate above this fraction of max(1, |value|) means the
// quadrature never settled.
const UNSETTLED = 1e-6

export function integrateValue(g: (t: number) => number, a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  if (a === b) return 0
  if (a > b) return -integrateValue(g, b, a)
  try {
    const budget = quadBudget(INTEGRAL_BUDGET)
    let result: QuadResult
    if (a === -Infinity && b === Infinity) {
      // t = s / (1 - s²), dt = (1 + s²) / (1 - s²)² ds, s in (-1, 1)
      result = integrate1(
        (s) => {
          const d = 1 - s * s
          return (g(s / d) * (1 + s * s)) / (d * d)
        },
        -1,
        1,
        QUAD_TOL,
        budget
      )
    } else if (b === Infinity) {
      // t = a + s / (1 - s), dt = ds / (1 - s)², s in [0, 1)
      result = integrate1(
        (s) => {
          const d = 1 - s
          return g(a + s / d) / (d * d)
        },
        0,
        1,
        QUAD_TOL,
        budget
      )
    } else if (a === -Infinity) {
      // t = b - s / (1 - s)
      result = integrate1(
        (s) => {
          const d = 1 - s
          return g(b - s / d) / (d * d)
        },
        0,
        1,
        QUAD_TOL,
        budget
      )
    } else {
      result = integrate1(g, a, b, QUAD_TOL, budget)
    }
    if (!Number.isFinite(result.value)) return Number.NaN
    // A settled result's error is within the quadrature's own target; one
    // far outside it never settled (a slowly divergent integrand, ∫ 1/t to
    // infinity) and is undefined, not a number to plot.
    if (!(result.error <= UNSETTLED * Math.max(1, Math.abs(result.value)))) return Number.NaN
    return result.value
  } catch (err) {
    if (err instanceof QuadratureError) return Number.NaN
    throw err
  }
}
```

If `QuadratureError` or `QuadResult` is not exported by `math/quadrature.ts` under those names, use the exported names (`grep -n "^export" src/math/quadrature.ts`) — do not edit `quadrature.ts`.

- [ ] **Step 4: Teach the closure compiler**

In `compile.ts`, import `integrateValue` from `./binders` and `BINDERS, MAX_TERMS, nameArgument` from `./reserved`. Add to `compileReserved`'s `switch (name)`:

```ts
    case '__sum':
    case '__prod':
      return compileLoop(expr, env, ctx, name === '__prod')
    case '__integral':
      return compileIntegral(expr, env, ctx)
```

and add these functions before `compileReserved`:

```ts
// A binder's pieces: its bound name, its bounds compiled outside the binding,
// and its body compiled with the name bound to a fresh slot.
function binderParts(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx, what: string) {
  if (expr.args.length !== 4) throw new CompileError(`"${expr.name}" takes 4 arguments, got ${expr.args.length}`, [expr.name])
  let bound: string
  try {
    bound = nameArgument(expr, what)
  } catch (err) {
    throw new CompileError((err as Error).message, [expr.name])
  }
  const lo = compileNode(expr.args[1], env, ctx)
  const hi = compileNode(expr.args[2], env, ctx)
  const slot = ctx.slots++
  const inner = new Map(env.bound)
  inner.set(bound, slot)
  const body = compileNode(expr.args[3], { bound: inner }, ctx)
  return { bound, lo, hi, slot, body }
}

const LOOP_WORD: Record<string, string> = { __sum: 'sum', __prod: 'prod' }

function compileLoop(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx, product: boolean): Node {
  const { lo, hi, slot, body } = binderParts(expr, env, ctx, 'index')
  const word = LOOP_WORD[expr.name]
  // Constant bounds are checked now; a bound that reads a parameter is checked
  // per evaluation, giving NaN.
  for (const [end, node] of [['lower', lo], ['upper', hi]] as const) {
    if (node.constant !== undefined && !Number.isInteger(node.constant)) {
      throw new CompileError(`${word}: the ${end} bound ${node.constant} is not a whole number`, [expr.name])
    }
  }
  if (lo.constant !== undefined && hi.constant !== undefined && hi.constant - lo.constant + 1 > MAX_TERMS) {
    throw new CompileError(`${word}: ${hi.constant - lo.constant + 1} terms is past the limit of ${MAX_TERMS}`, [expr.name])
  }
  return (f) => {
    const a = lo(f)
    const b = hi(f)
    if (!Number.isInteger(a) || !Number.isInteger(b) || b - a + 1 > MAX_TERMS) return Number.NaN
    let acc = product ? 1 : 0
    for (let i = a; i <= b; i++) {
      f[slot] = i
      acc = product ? acc * body(f) : acc + body(f)
    }
    return acc
  }
}

function compileIntegral(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): Node {
  const { lo, hi, slot, body } = binderParts(expr, env, ctx, 'variable of integration')
  // One frame per compiled function, so the integrand can be made once.
  let frame: Float64Array = new Float64Array(0)
  const g = (t: number) => {
    frame[slot] = t
    return body(frame)
  }
  return (f) => {
    frame = f
    return integrateValue(g, lo(f), hi(f))
  }
}
```

The integrand reuses the caller's frame and writes only its own slot, so outer variables (x) and nested binders (each with its own slot) are preserved.

- [ ] **Step 5: Teach the register program (an extern call into a closure)**

A binder loops or calls quadrature, which a straight-line register program cannot express, so `compileMany` runs it as a closure compiled by the closure compiler — the same code, so the two paths agree exactly.

Export a helper near `compileScalar`:

```ts
// The closure compiler over any number of named variables in slots 0..n-1:
// what compileMany calls for a construct it runs as a closure (a binder).
export function closureOver(expr: Expr, vars: readonly string[], scope: MathScope): { run: (frame: Float64Array) => number; frame: Float64Array } {
  const bound = new Map<string, number>()
  vars.forEach((v, i) => bound.set(v, i))
  const ctx: Ctx = { scope, slots: vars.length, stack: [] }
  const run = compileNode(expr, { bound }, ctx)
  return { run, frame: new Float64Array(Math.max(ctx.slots, 1)) }
}
```

Add the opcode `const OP_EXTERN = 25`. Give `ProgramBuilder` an extern list:

```ts
  readonly externs: { run: (frame: Float64Array) => number; frame: Float64Array }[] = []
```

In `programReserved`, add:

```ts
    case '__sum':
    case '__prod':
    case '__integral': {
      // The variables the binder reads that are bound here (top-level inputs
      // or an inlined function's parameters), copied into the closure's frame.
      const names = [...varNames(expr)].filter((n) => bound.has(n))
      const extern = closureOver(expr, names, ctx.scope)
      const first = p.block(names.length)
      names.forEach((n, i) => p.copy(first + i, bound.get(n) as number))
      p.externs.push(extern)
      return p.emit(OP_EXTERN, first, names.length, p.externs.length - 1)
    }
```

(import `varNames` from `./expr`). In `compileMany`, after building the program, capture `const externs = program.externs`, and in the run loop add:

```ts
        case OP_EXTERN: {
          const extern = externs[code[pc + 4]]
          for (let i = 0; i < y; i++) extern.frame[i] = reg[x + i]
          reg[d] = extern.run(extern.frame)
          break
        }
```

A binder that also reads a user *constant* or a parameter needs nothing copied: the closure resolves those itself, exactly as compileScalar does.

- [ ] **Step 6: Binder-aware `expr.ts` and `freeVariablesDeep`**

In `graph-engine/src/math/expr.ts`, add:

```ts
const BINDER_NAMES: ReadonlySet<string> = new Set(['__sum', '__prod', '__integral'])

// A name not used in `taken`, derived from `base` deterministically. "#" never
// reaches an Expr from text, so no author can write it.
function freshName(base: string, taken: ReadonlySet<string>): string {
  for (let i = 1; ; i++) {
    const candidate = `#${base}.${i}`
    if (!taken.has(candidate)) return candidate
  }
}
```

and replace `substitute`'s `'call'` case (keeping Task 3's `__prime` line first) with:

```ts
    case 'call': {
      if (expr.name === '__prime') return { kind: 'call', name: expr.name, args: expr.args.map((a, i) => (i === 0 ? a : substitute(a, map))) }
      const first = expr.args[0]
      if (BINDER_NAMES.has(expr.name) && first?.kind === 'var' && expr.args.length === 4) {
        // The bounds are outside the binding; the body is inside it.
        let name = first.name
        let body = expr.args[3]
        const inner = new Map(map)
        inner.delete(name)
        // A replacement that mentions the bound name would be captured: rename
        // the binder first.
        const mentions = [...inner.values()].some((e) => varNames(e).has(name))
        if (mentions) {
          const taken = new Set<string>([...varNames(body), ...[...inner.values()].flatMap((e) => [...varNames(e)])])
          const fresh = freshName(name, taken)
          body = substitute(body, new Map([[name, { kind: 'var', name: fresh }]]))
          name = fresh
        }
        return { kind: 'call', name: expr.name, args: [{ kind: 'var', name }, substitute(expr.args[1], map), substitute(expr.args[2], map), substitute(body, inner)] }
      }
      return { kind: 'call', name: expr.name, args: expr.args.map((a) => substitute(a, map)) }
    }
```

and `varNames`'s `'call'` case with:

```ts
    case 'call': {
      const first = expr.args[0]
      if (BINDER_NAMES.has(expr.name) && first?.kind === 'var' && expr.args.length === 4) {
        varNames(expr.args[1], into)
        varNames(expr.args[2], into)
        const inner = varNames(expr.args[3])
        inner.delete(first.name)
        for (const n of inner) into.add(n)
        break
      }
      for (const [i, a] of expr.args.entries()) if (!(expr.name === '__prime' && i === 0)) varNames(a, into)
      break
    }
```

Update `substitute`'s header comment: "An Expr has no binders except the reserved __sum, __prod and __integral (math/reserved.ts), which bind their first argument in their body; substitution respects that and never captures."

In `compile.ts`'s `freeVariablesDeep` `walk`, add at the start of the `'call'` case:

```ts
        if (BINDERS.has(e.name) && e.args[0]?.kind === 'var' && e.args.length === 4) {
          walk(e.args[1], local, into)
          walk(e.args[2], local, into)
          walk(e.args[3], new Set([...local, e.args[0].name]), into)
          return
        }
```

- [ ] **Step 7: Teach diff**

In `diff.ts`'s `differentiateReserved`, add before the final refusal:

```ts
    case '__sum': {
      const [binder, lo, hi, body] = args
      if (dependsOn(lo, v, scope) || dependsOn(hi, v, scope)) {
        throw new CompileError(`No derivative rule for a sum whose bounds depend on "${v}"`, ['__sum'])
      }
      if (binder.kind !== 'var' || binder.name === v) return ZERO
      return call('__sum', binder, lo, hi, differentiate(body, v, scope, ctx))
    }
    case '__prod':
      throw new CompileError('No derivative rule for a product of terms yet', ['__prod'])
    case '__integral': {
      // Leibniz: d/dv ∫_a^b g(t) dt = g(b) b' − g(a) a' + ∫_a^b ∂g/∂v dt
      const [binder, lo, hi, body] = args
      if (binder.kind !== 'var') throw new CompileError('__integral: the first argument must name the variable of integration', ['__integral'])
      const at = (bound: Expr) => substitute(body, new Map([[binder.name, bound]]))
      let result: Expr = ZERO
      if (dependsOn(hi, v, scope)) result = add(result, mul(at(hi), differentiate(hi, v, scope, ctx)))
      if (dependsOn(lo, v, scope)) result = sub(result, mul(at(lo), differentiate(lo, v, scope, ctx)))
      if (binder.name !== v && freeVariablesDeep(body, scope, new Set([binder.name])).has(v)) {
        result = add(result, call('__integral', binder, lo, hi, differentiate(body, v, scope, ctx)))
      }
      return result
    }
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/math/`
Expected: PASS.

- [ ] **Step 9: Run everything that must not move**

The four checks of Task 1 Step 8.

- [ ] **Step 10: Commit**

```bash
git add src/math/binders.ts src/math/binders.test.ts src/math/compile.ts src/math/diff.ts src/math/expr.ts
git commit -m "feat(math): sum, prod and integral as binders on both compile paths, infinite bounds, Leibniz rule, capture-free substitution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space with the summary (binder shapes, `inf`, `closureOver`/`OP_EXTERN`) and the sweep result.

---

### Task 5: Expression syntax

**Files:**
- Modify: `graph-engine/src/parser/tokenize.ts`
- Modify: `graph-engine/src/parser/parseExpr.ts` (rewritten in full below)
- Modify: `graph-engine/src/parser/parseExpr.test.ts` (append)
- Modify: `GRAPH-DSL-REFERENCE.md` (repo root of the worktree; a new section)

**Interfaces:**
- Consumes: `BUILTIN_NAMES` from `math/compile.ts`; `call`, `variable` from `math/expr.ts`; `compare`, `and`, `or`, `not`, `piecewise`, `factorialOf`, `prime`, `sum`, `prod`, `integral`, `MAX_PRIME_ORDER`, `type ComparisonOp` from `math/reserved.ts`.
- Produces: `parseConditionString(input: string): Expr` (a condition as reserved calls) — used by Task 6. `parseExprString` and `parseExprTokens` keep their signatures.

**What must not move:** every input that parsed before parses to the same tree (figure renders stay byte-identical — `figure/cleanGolden.test.ts`). The new tokens are characters that used to throw.

- [ ] **Step 1: Write the failing tests**

Append to `graph-engine/src/parser/parseExpr.test.ts`:

```ts
import { call, num, variable } from '../math/expr'
import { compare, factorialOf, integral, piecewise, prime, sum, and, or, not } from '../math/reserved'
import { parseConditionString } from './parseExpr'

const v = variable

describe('calc P1 syntax', () => {
  it('absolute-value bars', () => {
    expect(parseExprString('|x - 1|')).toEqual(call('abs', parseExprString('x - 1')))
    expect(parseExprString('2|x|')).toEqual({ kind: 'binary', op: '*', left: num(2), right: call('abs', v('x')) })
    expect(parseExprString('||x| - 1|')).toEqual(call('abs', parseExprString('abs(x) - 1')))
    expect(parseExprString('|(2|x|)|')).toEqual(call('abs', { kind: 'binary', op: '*', left: num(2), right: call('abs', v('x')) }))
  })

  it('postfix ! binds tighter than ^ and unary minus', () => {
    expect(parseExprString('n!')).toEqual(factorialOf(v('n')))
    expect(parseExprString('-3!')).toEqual({ kind: 'unary', op: '-', arg: factorialOf(num(3)) })
    expect(parseExprString('2^3!')).toEqual({ kind: 'binary', op: '^', left: num(2), right: factorialOf(num(3)) })
    expect(parseExprString('(2k+1)!')).toEqual(factorialOf(parseExprString('2k+1')))
  })

  it("primes: f'(x), f''(x + 1)", () => {
    expect(parseExprString("f'(x)")).toEqual(prime('f', 1, [v('x')]))
    expect(parseExprString("f''(x + 1)")).toEqual(prime('f', 2, [parseExprString('x + 1')]))
    expect(() => parseExprString("f''''''(x)")).toThrow(/At most 5/)
  })

  it('sin^2(x) is (sin x)^2; sin^-1(x) is asin(x); sec^-1 is refused', () => {
    expect(parseExprString('sin^2(x)')).toEqual({ kind: 'binary', op: '^', left: call('sin', v('x')), right: num(2) })
    expect(parseExprString('sin^-1(x)')).toEqual(call('asin', v('x')))
    expect(parseExprString('cosh^-1(x)')).toEqual(call('acosh', v('x')))
    expect(() => parseExprString('sec^-1(x)')).toThrow(/acos/)
    // a variable's power is untouched: x^2(x + 1) is still x^2 · (x + 1)
    expect(parseExprString('x^2(x + 1)')).toEqual({ kind: 'binary', op: '*', left: parseExprString('x^2'), right: parseExprString('x + 1') })
  })

  it('piecewise in braces, with an otherwise', () => {
    expect(parseExprString('{x < 0: x^2, x <= 2: 2x + 1, 5}')).toEqual(
      piecewise(
        [
          [compare('<', v('x'), num(0)), parseExprString('x^2')],
          [compare('<=', v('x'), num(2)), parseExprString('2x + 1')],
        ],
        num(5)
      )
    )
    expect(parseExprString('{x < 0: -1}')).toEqual(piecewise([[compare('<', v('x'), num(0)), parseExprString('-1')]], null))
  })

  it('conditions: chains, and, or, not, !=, =', () => {
    expect(parseConditionString('0 < x < 1')).toEqual(and(compare('<', num(0), v('x')), compare('<', v('x'), num(1))))
    expect(parseConditionString('x < 0 or x > 1 and y != 2')).toEqual(or(compare('<', v('x'), num(0)), and(compare('>', v('x'), num(1)), compare('!=', v('y'), num(2)))))
    expect(parseConditionString('not x = 0')).toEqual(not(compare('=', v('x'), num(0))))
  })

  it('piecewise errors are legible', () => {
    expect(() => parseExprString('{5, x < 0: 1}')).toThrow(/last piece/)
    expect(() => parseExprString('{x: 1}')).toThrow(/comparison/)
    expect(() => parseExprString('{x < 0 1}')).toThrow(/":"/)
  })

  it('sum, prod and integral forms', () => {
    expect(parseExprString('sum(k = 0 to n, x^k)')).toEqual(sum('k', num(0), v('n'), parseExprString('x^k')))
    expect(parseExprString('integral(t = 0 to x, sin(t)/t)')).toEqual(integral('t', num(0), v('x'), parseExprString('sin(t)/t')))
    // a user function named sum, called normally, is still a call
    expect(parseExprString('sum(x)')).toEqual(call('sum', v('x')))
    expect(() => parseExprString('sum(k = 0, x)')).toThrow(/"to"/)
  })

  it('a comparison outside braces is not an expression', () => {
    expect(() => parseExprString('x < 1')).toThrow()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/parser/parseExpr.test.ts`
Expected: FAIL — `Unexpected character "|"` and similar.

- [ ] **Step 3: Extend the tokenizer**

In `graph-engine/src/parser/tokenize.ts`, change the `op` member of `Token` to:

```ts
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '=' | ',' | '(' | ')' | '[' | ']' | '{' | '}' | ':' | '|' | '!' | "'" | '<' | '<=' | '>' | '>=' | '!=' }
```

and replace the operator block (the `if ('+-*/^=,()[]'.includes(c))` branch) with:

```ts
    // Comparators and "!": two characters when followed by "=" ("<=", ">=",
    // "!="); a lone "!" is the factorial (calc P1).
    if (c === '<' || c === '>' || c === '!') {
      if (input[i + 1] === '=') {
        tokens.push({ kind: 'op', value: `${c}=` as '<=' | '>=' | '!=' })
        i += 2
        continue
      }
      tokens.push({ kind: 'op', value: c })
      i++
      continue
    }
    if ("+-*/^=,()[]{}:|'".includes(c)) {
      tokens.push({ kind: 'op', value: c as OpValue })
      i++
      continue
    }
```

with, under the `Token` type:

```ts
type OpValue = (Token & { kind: 'op' })['value']
```

Run `grep -rn "tokenize(" src --include=*.ts | grep -v "\.test\."` and confirm `parseExpr.ts` is the only caller outside tests; if another file switches on `Token` op values, list it in your report.

- [ ] **Step 4: Rewrite `parseExpr.ts`**

Replace the whole file with:

```ts
import { BUILTIN_NAMES } from '../math/compile'
import { call, variable } from '../math/expr'
import { and, compare, factorialOf, integral, MAX_PRIME_ORDER, not, or, piecewise, prime, prod, sum, type ComparisonOp } from '../math/reserved'
import { tokenize, type Token } from './tokenize'
import type { Expr } from './types'

// "^-1" on these names means the inverse function, as textbooks write it.
const INVERSES: Readonly<Record<string, string>> = { sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' }
const NO_INVERSE: Readonly<Record<string, string>> = { sec: 'acos(1/x)', csc: 'asin(1/x)', cot: 'atan(1/x)' }

const COMPARISONS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '=', '!='])

class ExprParser {
  private tokens: Token[]
  private pos = 0
  // Inside |…|: a bar after an operand closes rather than multiplies.
  private absDepth = 0
  // Words that end an operand here instead of multiplying it: "to" inside a
  // sum's bounds, "and"/"or" inside a condition. Empty everywhere else, so a
  // variable named "to" still multiplies as it always did.
  private stops: string[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private next(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('Unexpected end of expression')
    this.pos++
    return t
  }

  private isOp(t: Token | undefined, value: string): t is Token & { kind: 'op' } {
    return !!t && t.kind === 'op' && t.value === value
  }

  private isWord(word: string): boolean {
    const t = this.peek()
    return !!t && t.kind === 'ident' && t.name === word
  }

  private isComparison(t: Token | undefined): t is Token & { kind: 'op' } {
    return !!t && t.kind === 'op' && COMPARISONS.has(t.value)
  }

  // Parentheses, call arguments, braces and bars start a fresh context: no
  // stop words, no open bar.
  private fresh<T>(run: () => T): T {
    const stops = this.stops
    const depth = this.absDepth
    this.stops = []
    this.absDepth = 0
    try {
      return run()
    } finally {
      this.stops = stops
      this.absDepth = depth
    }
  }

  private stoppingAt<T>(words: string[], run: () => T): T {
    const before = this.stops
    this.stops = [...before, ...words]
    try {
      return run()
    } finally {
      this.stops = before
    }
  }

  private startsImplicitFactor(t: Token | undefined): boolean {
    if (!t) return false
    if (t.kind === 'num') return true
    if (t.kind === 'ident') return !this.stops.includes(t.name)
    if (t.value === '(' || t.value === '{') return true
    if (t.value === '|') return this.absDepth === 0
    return false
  }

  // expr := term (('+'|'-') term)*
  parseExpr(): Expr {
    let left = this.parseTerm()
    while (this.isOp(this.peek(), '+') || this.isOp(this.peek(), '-')) {
      const op = this.next() as Token & { kind: 'op' }
      const right = this.parseTerm()
      left = { kind: 'binary', op: op.value as '+' | '-', left, right }
    }
    return left
  }

  // term := unary (('*'|'/') unary | <implicit multiplication>)*
  private parseTerm(): Expr {
    let left = this.parseUnary()
    for (;;) {
      if (this.isOp(this.peek(), '*') || this.isOp(this.peek(), '/')) {
        const op = this.next() as Token & { kind: 'op' }
        const right = this.parseUnary()
        left = { kind: 'binary', op: op.value as '*' | '/', left, right }
      } else if (this.startsImplicitFactor(this.peek())) {
        // implicit multiplication: "2x", "3(x+1)", "2 sin(x)", "2|x|"
        const right = this.parseUnary()
        left = { kind: 'binary', op: '*', left, right }
      } else {
        break
      }
    }
    return left
  }

  // unary := '-' unary | power
  //
  // Sits ABOVE power so unary minus binds looser than "^": "-2^2" is -(2^2) =
  // -4, as every standard reference reads it, and "y = -x^2" opens downward.
  private parseUnary(): Expr {
    if (this.isOp(this.peek(), '-')) {
      this.next()
      return { kind: 'unary', op: '-', arg: this.parseUnary() }
    }
    return this.parsePower()
  }

  // power := postfix ('^' unary)?  (right-associative; the exponent side
  // recurses through unary so "2^-1" parses)
  private parsePower(): Expr {
    const base = this.parsePostfix()
    if (this.isOp(this.peek(), '^')) {
      this.next()
      const exp = this.parseUnary()
      return { kind: 'binary', op: '^', left: base, right: exp }
    }
    return base
  }

  // postfix := primary '!'*   ("!" binds tighter than "^" and unary minus)
  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    while (this.isOp(this.peek(), '!')) {
      this.next()
      e = factorialOf(e)
    }
    return e
  }

  private parseArgs(name: string): Expr[] {
    this.next() // (
    return this.fresh(() => {
      const args: Expr[] = []
      if (!this.isOp(this.peek(), ')')) {
        args.push(this.parseExpr())
        while (this.isOp(this.peek(), ',')) {
          this.next()
          args.push(this.parseExpr())
        }
      }
      if (!this.isOp(this.peek(), ')')) throw new Error(`Expected ")" after arguments to "${name}"`)
      this.next()
      return args
    })
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (!t) throw new Error('Unexpected end of expression')

    if (t.kind === 'num') {
      this.next()
      return { kind: 'num', value: t.value }
    }

    if (t.kind === 'ident') {
      this.next()
      const name = t.name
      if ((name === 'sum' || name === 'prod' || name === 'integral') && this.isOp(this.peek(), '(') && this.peek(1)?.kind === 'ident' && this.isOp(this.peek(2), '=')) {
        return this.parseBinder(name)
      }
      if (this.isOp(this.peek(), "'")) return this.parsePrime(name)
      if (BUILTIN_NAMES.has(name) && this.isOp(this.peek(), '^')) return this.parseFunctionPower(name)
      // Not validated against the built-ins here: a call to a user function
      // looks identical, and definitions may come anywhere in the spec.
      // math/compile.ts resolves both, and reads "x(x + 1)" as a product when
      // x is a value.
      if (this.isOp(this.peek(), '(')) return call(name, ...this.parseArgs(name))
      return variable(name)
    }

    if (this.isOp(t, '(')) {
      this.next()
      const inner = this.fresh(() => this.parseExpr())
      if (!this.isOp(this.peek(), ')')) throw new Error('Expected ")"')
      this.next()
      return inner
    }

    if (this.isOp(t, '|')) {
      this.next()
      const inner = this.fresh(() => {
        this.absDepth = 1
        return this.parseExpr()
      })
      if (!this.isOp(this.peek(), '|')) throw new Error('Expected a closing "|"')
      this.next()
      return call('abs', inner)
    }

    if (this.isOp(t, '{')) {
      this.next()
      return this.fresh(() => this.parsePiecewise())
    }

    throw new Error(`Unexpected token in expression`)
  }

  // f'(x), f''(x), …
  private parsePrime(name: string): Expr {
    let order = 0
    while (this.isOp(this.peek(), "'")) {
      this.next()
      order++
    }
    const written = `${name}${"'".repeat(order)}`
    if (order > MAX_PRIME_ORDER) throw new Error(`At most ${MAX_PRIME_ORDER} primes: "${written}"`)
    if (!this.isOp(this.peek(), '(')) throw new Error(`"${written}" needs its argument: ${written}(x)`)
    return prime(name, order, this.parseArgs(written))
  }

  // sin^2(x) is (sin x)^2; sin^-1(x) is asin(x).
  private parsePowerExponentIsMinusOne(e: Expr): boolean {
    return (e.kind === 'unary' && e.arg.kind === 'num' && e.arg.value === 1) || (e.kind === 'num' && e.value === -1)
  }

  private parseFunctionPower(name: string): Expr {
    this.next() // ^
    const power = this.parseUnary()
    if (!this.isOp(this.peek(), '(')) throw new Error(`"${name}^…" needs its argument in parentheses, as in ${name}^2(x)`)
    const args = this.parseArgs(name)
    if (this.parsePowerExponentIsMinusOne(power)) {
      const inverse = INVERSES[name]
      if (inverse) return call(inverse, ...args)
      const instead = NO_INVERSE[name]
      if (instead) throw new Error(`"${name}^-1" has no built-in; write ${instead}`)
    }
    return { kind: 'binary', op: '^', left: call(name, ...args), right: power }
  }

  // sum(k = a to b, body), prod(…), integral(t = a to b, body)
  private parseBinder(name: 'sum' | 'prod' | 'integral'): Expr {
    this.next() // (
    return this.fresh(() => {
      const bound = this.next() as Token & { kind: 'ident' }
      this.next() // =
      const lo = this.stoppingAt(['to'], () => this.parseExpr())
      if (!this.isWord('to')) throw new Error(`Expected "to" in ${name}(${bound.name} = a to b, …)`)
      this.next()
      const hi = this.parseExpr()
      if (!this.isOp(this.peek(), ',')) throw new Error(`Expected "," after the bounds in ${name}(${bound.name} = a to b, …)`)
      this.next()
      const body = this.parseExpr()
      if (!this.isOp(this.peek(), ')')) throw new Error(`Expected ")" to close ${name}(…)`)
      this.next()
      const make = name === 'sum' ? sum : name === 'prod' ? prod : integral
      return make(bound.name, lo, hi, body)
    })
  }

  // {c1: v1, c2: v2, …, otherwise}
  private parsePiecewise(): Expr {
    const pieces: [Expr, Expr][] = []
    let otherwise: Expr | null = null
    for (;;) {
      if (otherwise) throw new Error('Only the last piece of a piecewise definition may be a bare value (the "otherwise")')
      const piece = this.parseConditionOrExpr()
      if (piece.condition) {
        if (!this.isOp(this.peek(), ':')) throw new Error('Expected ":" after a piece\'s condition, as in {x < 0: x^2, 5}')
        this.next()
        pieces.push([piece.expr, this.parseExpr()])
      } else {
        if (this.isOp(this.peek(), ':')) throw new Error("A piece's condition must be a comparison, as in {x < 0: x^2}")
        otherwise = piece.expr
      }
      if (this.isOp(this.peek(), ',')) {
        this.next()
        continue
      }
      if (this.isOp(this.peek(), '}')) {
        this.next()
        break
      }
      throw new Error('Expected "," or "}" in a piecewise definition')
    }
    if (pieces.length === 0) throw new Error('A piecewise definition needs at least one "condition: value" piece')
    return piecewise(pieces, otherwise)
  }

  private parseOperand(): Expr {
    return this.stoppingAt(['and', 'or'], () => this.parseExpr())
  }

  // condition := conj ('or' conj)*; conj := neg ('and' neg)*;
  // neg := 'not' neg | chain; chain := operand (cmp operand)+
  parseCondition(): Expr {
    let left = this.parseConj()
    while (this.isWord('or')) {
      this.next()
      left = or(left, this.parseConj())
    }
    return left
  }

  private parseConj(): Expr {
    let left = this.parseNeg()
    while (this.isWord('and')) {
      this.next()
      left = and(left, this.parseNeg())
    }
    return left
  }

  private parseNeg(): Expr {
    if (this.isWord('not')) {
      this.next()
      return not(this.parseNeg())
    }
    return this.parseChainFrom(this.parseOperand())
  }

  private parseChainFrom(first: Expr): Expr {
    if (!this.isComparison(this.peek())) throw new Error('Expected a comparison (<, <=, >, >=, =, !=)')
    let result: Expr | null = null
    let left = first
    while (this.isComparison(this.peek())) {
      const op = (this.next() as Token & { kind: 'op' }).value as ComparisonOp
      const right = this.parseOperand()
      const c = compare(op, left, right)
      result = result ? and(result, c) : c
      left = right
    }
    return result as Expr
  }

  // A piece is "condition: value" or the bare otherwise value.
  private parseConditionOrExpr(): { condition: boolean; expr: Expr } {
    if (this.isWord('not')) return { condition: true, expr: this.parseCondition() }
    const first = this.parseOperand()
    if (!this.isComparison(this.peek())) return { condition: false, expr: first }
    let conj = this.parseChainFrom(first)
    while (this.isWord('and')) {
      this.next()
      conj = and(conj, this.parseNeg())
    }
    let disj = conj
    while (this.isWord('or')) {
      this.next()
      disj = or(disj, this.parseConj())
    }
    return { condition: true, expr: disj }
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }
}

// Parses one full expression from a token slice; throws on leftover tokens or errors.
export function parseExprTokens(tokens: Token[]): Expr {
  const parser = new ExprParser(tokens)
  const expr = parser.parseExpr()
  if (!parser.atEnd()) throw new Error('Unexpected trailing tokens in expression')
  return expr
}

export function parseExprString(input: string): Expr {
  return parseExprTokens(tokenize(input))
}

// A condition — "x < 0", "0 < x <= 1", "y > 0 and x != 2" — as reserved calls
// (math/reserved.ts). Used by "if" clauses (parser/parseStatement.ts).
export function parseConditionString(input: string): Expr {
  const parser = new ExprParser(tokenize(input))
  const expr = parser.parseCondition()
  if (!parser.atEnd()) throw new Error(`Unexpected trailing text in the condition "${input.trim()}"`)
  return expr
}

export { ExprParser }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/parser/`
Expected: PASS, including every existing parser test. If an existing test pinned an error message that has changed (for example `Unexpected character "<"` → `Unexpected trailing tokens`), update **that 2D parser test** to the new message and say so in your report. Do not change any test under `src/space/` or `src/figure/`; if one fails, stop and report.

- [ ] **Step 6: Document the syntax**

In `GRAPH-DSL-REFERENCE.md` (the worktree's repo root), add a section after the existing expression-language section, titled `## Expressions: the calculus kernel (calc P1)`, covering, with one example each: real odd roots (`x^(1/3)`, `x^(2/3)`; a float exponent stays principal); the new built-ins (`gamma erf erfc cbrt step choose perm gcd lcm root`, plus the inverse trig and hyperbolic families, `floor ceil round sign mod min max hypot`, which came with the shared kernel); `|x|`; `n!`; `f'(x)` up to five primes; `sin^2(x)` and `sin^-1(x)`; `x(x + 1)` as a product; piecewise braces `{x < 0: x^2, x <= 2: 2x + 1, 5}`; conditions with `and`, `or`, `not`, `=`, `!=` and chains; `sum(k = 0 to n, …)`, `prod(…)`, `integral(t = a to b, …)` with `inf`; and that names starting with `__` are reserved.

- [ ] **Step 7: Run everything that must not move**

The four checks of Task 1 Step 8. The figure clean-golden test is the guard that no previously valid input changed.

- [ ] **Step 8: Commit**

```bash
git add src/parser/tokenize.ts src/parser/parseExpr.ts src/parser/parseExpr.test.ts ../GRAPH-DSL-REFERENCE.md
git commit -m "feat(parser): bars, factorial, primes, function powers, piecewise braces, conditions, sum/prod/integral forms

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space with the summary and the sweep result.

---

### Task 6: Statement syntax — `if` everywhere, bracket-aware scanning, the mode rule

**Files:**
- Modify: `graph-engine/src/parser/types.ts` (optional `where` on four statement shapes)
- Modify: `graph-engine/src/parser/grammarUtil.ts` (`splitTopLevelComma` counts braces)
- Modify: `graph-engine/src/parser/parseStatement.ts` (`findComparator`, `findTopLevelRelation`, the explicit, region, regionChain and implicit branches)
- Modify: `graph-engine/src/parser/parseStatement.test.ts` (append; update the one test that pinned the old refusal)
- Modify: `graph-engine/src/scene/mode.ts` (`isThreeD`)
- Modify: `graph-engine/src/scene/mode.test.ts` (append space's four cases)

**Interfaces:**
- Consumes: `parseConditionString` from Task 5.
- Produces: `where?: Expr` on the `explicit`, `implicit`, `region` and `regionChain` statement shapes — a condition as reserved calls. **Rule:** an explicit `if` clause that the old `Condition` shape can express keeps producing exactly the old object (`condition` set, **no** `where` key), so existing parse results — including those space's tests check — are unchanged. A clause the old shape cannot express gives `condition: null` and `where`. Implicit, region and regionChain lines get `where` when they carry an `if` clause (new syntax only).

- [ ] **Step 1: Write the failing tests**

Append to `graph-engine/src/parser/parseStatement.test.ts`:

```ts
import { num, variable } from '../math/expr'
import { and, compare, or, piecewise } from '../math/reserved'

describe('calc P1 statements', () => {
  const x = variable('x')
  const y = variable('y')

  it('an old-shape if clause produces exactly the old statement, with no where', () => {
    const s = parseStatement('y = x^2 if x < 0')
    expect(s).toMatchObject({ kind: 'explicit', condition: { kind: 'compare', op: '<' } })
    expect('where' in s).toBe(false)
  })

  it('a new-shape clause sets where and leaves condition null', () => {
    const s = parseStatement('y = x^2 if x < -1 or x > 1')
    expect(s).toMatchObject({ kind: 'explicit', condition: null, where: or(compare('<', x, { kind: 'unary', op: '-', arg: num(1) }), compare('>', x, num(1))) })
  })

  it('if on implicit and region lines', () => {
    expect(parseStatement('x^2 + y^2 = 4 if y > 0')).toMatchObject({ kind: 'implicit', where: compare('>', y, num(0)) })
    expect(parseStatement('x^2 + y^2 < 9 if y > 0 and x > -1')).toMatchObject({
      kind: 'region',
      op: '<',
      where: and(compare('>', y, num(0)), compare('>', x, { kind: 'unary', op: '-', arg: num(1) })),
    })
    expect(parseStatement('1 < x^2 + y^2 < 4 if x > 0')).toMatchObject({ kind: 'regionChain', where: compare('>', x, num(0)) })
  })

  it('a comparator or "=" inside brackets is not the statement\'s relation', () => {
    expect(parseStatement('y = {x < 0: -1, 1}')).toMatchObject({ kind: 'explicit', body: piecewise([[compare('<', x, num(0)), { kind: 'unary', op: '-', arg: num(1) }]], num(1)) })
    expect(parseStatement('y < sum(k = 1 to 3, x^k)')).toMatchObject({ kind: 'region', op: '<' })
    expect(parseStatement('f(x) = {x < 0: x^2, x}')).toMatchObject({ kind: 'functionDef', name: 'f' })
  })

  it('a tuple with a piecewise component still splits at its top-level comma', () => {
    expect(parseStatement('({t < 0: -t, t}, t) for t in [-1, 1]')).toMatchObject({ kind: 'parametric', param: 't' })
  })
})
```

Append to `graph-engine/src/scene/mode.test.ts` (adapt the helper to however that file already parses a spec — it likely calls `parseSpec(...).statements` and `isThreeD`):

```ts
describe('a scalar multi-parameter definition alone is not 3D (agreed with space, 2026-10-01)', () => {
  const three = (spec: string) => isThreeD(parseSpec(spec).statements)

  it('g(x, a) = a sin(x) with y = g(x, 2) is 2D', () => {
    expect(three('g(x, a) = a sin(x)\ny = g(x, 2)')).toBe(false)
  })

  it('f(x, y) = x^2 - y^2 with z = f(x, y) is 3D', () => {
    expect(three('f(x, y) = x^2 - y^2\nz = f(x, y)')).toBe(true)
  })

  it('f(x, y) = x^2 - y^2 alone is 2D', () => {
    expect(three('f(x, y) = x^2 - y^2')).toBe(false)
  })

  it('a vector function r(t) = (cos t, sin t, t) alone stays 3D', () => {
    expect(three('r(t) = (cos t, sin t, t)')).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/parser/parseStatement.test.ts src/scene/mode.test.ts`
Expected: FAIL (the `if` refusal on regions; the mode cases).

- [ ] **Step 3: Add `where` to the statement shapes**

In `graph-engine/src/parser/types.ts`, change the four shapes to:

```ts
  | { kind: 'explicit'; independent: 'x' | 'y'; body: Expr; condition: Condition | null; where?: Expr }
  | { kind: 'implicit'; left: Expr; right: Expr; where?: Expr }
  | { kind: 'region'; left: Expr; op: '<' | '<=' | '>' | '>='; right: Expr; where?: Expr }
  | { kind: 'regionChain'; low: Expr; lowOp: '<' | '<='; mid: Expr; highOp: '<' | '<='; high: Expr; where?: Expr }
```

and add one comment line above the `explicit` member: `// where: an "if" condition in the calc P1 language (reserved calls, math/reserved.ts) — set only when the clause is new syntax; an old-shape clause sets condition alone.`

- [ ] **Step 4: Brace-aware comma splitting**

In `graph-engine/src/parser/grammarUtil.ts`'s `splitTopLevelComma`, count braces with the other brackets:

```ts
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
```

and update its comment to "at paren/bracket/brace depth 0".

- [ ] **Step 5: Bracket-aware relation scanning and `if` clauses**

In `graph-engine/src/parser/parseStatement.ts`, import `parseConditionString` from `./parseExpr` (beside `parseExprString`). Replace `findComparator` and `findTopLevelRelation` with:

```ts
// Finds the earliest comparator at bracket depth 0, preferring "<=" over "<".
// A comparator inside parentheses, brackets or braces — a piecewise
// {x < 0: …} — belongs to an expression, not to the statement.
function findComparator(line: string): { op: '<' | '<=' | '>' | '>='; idx: number } | null {
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && (c === '<' || c === '>')) {
      return { op: (line[i + 1] === '=' ? `${c}=` : c) as '<' | '<=' | '>' | '>=', idx: i }
    }
  }
  return null
}

type Relation = { type: 'equals'; idx: number } | { type: 'comparator'; op: '<' | '<=' | '>' | '>='; idx: number }

// Scans left to right, at bracket depth 0, for whichever comes first: a
// standalone "=" or a comparator. A "=" inside brackets — sum(k = 0 to n, …) —
// is not the statement's.
function findTopLevelRelation(line: string): Relation | null {
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0) {
      if (c === '<' || c === '>') {
        const twoChar = line[i + 1] === '='
        return { type: 'comparator', op: (twoChar ? c + '=' : c) as '<' | '<=' | '>' | '>=', idx: i }
      }
      if (c === '=' && line[i - 1] !== '!') return { type: 'equals', idx: i }
    }
  }
  return null
}

// The index of " if " at bracket depth 0, or -1.
function topLevelIf(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && text.startsWith(' if ', i)) return i
  }
  return -1
}
```

In the **comparator** branch of `parseStatementCore`, replace the `if (/\bif\b/.test(right)) { throw … }` block, and the code below it, so the clause is split off first:

```ts
    // An "if" clause restricts where the inequality is shaded (calc P1).
    const ifAt = topLevelIf(right)
    const where = ifAt === -1 ? undefined : parseConditionString(right.slice(ifAt + ' if '.length))
    const core = ifAt === -1 ? right : right.slice(0, ifAt).trim()
    const withWhere = where ? { where } : {}
```

then use `core` everywhere the old code used `right` in that branch (`findComparator(core)`, `core.slice(…)`), and spread `...withWhere` into both returned objects (`regionChain` and `region`).

In the **equals** branch, replace the explicit-statement block with:

```ts
    if (lhs === 'y' || lhs === 'x') {
      const independent = lhs === 'y' ? 'x' : 'y'
      const ifIdx = topLevelIf(rhs)
      if (ifIdx === -1) return { kind: 'explicit', independent, body: parseExprString(rhs), condition: null }
      const body = parseExprString(rhs.slice(0, ifIdx).trim())
      const clause = rhs.slice(ifIdx + ' if '.length).trim()
      // The old shape (x < c, or lo <= x < hi) stays exactly as it was, so
      // every existing parse result is unchanged; anything else is the calc
      // P1 condition language.
      try {
        return { kind: 'explicit', independent, body, condition: parseCondition(clause, independent) }
      } catch {
        return { kind: 'explicit', independent, body, condition: null, where: parseConditionString(clause) }
      }
    }
```

and replace the final implicit-curve return with:

```ts
    // Implicit curve: "x^2/9 + y^2/4 = 1", optionally "… if y > 0"
    const ifAt = topLevelIf(rhs)
    if (ifAt !== -1) {
      return { kind: 'implicit', left: parseExprString(lhs), right: parseExprString(rhs.slice(0, ifAt).trim()), where: parseConditionString(rhs.slice(ifAt + ' if '.length)) }
    }
    return { kind: 'implicit', left: parseExprString(lhs), right: parseExprString(rhs) }
```

Update the existing parseStatement test that expected the "`if` clauses are only valid on explicit…" refusal: that line is now valid. Rewrite it to assert the new `region` result with its `where`, and note in the test name that calc P1 made it valid.

- [ ] **Step 6: The mode rule**

In `graph-engine/src/scene/mode.ts`'s `isThreeD`, replace `if (s.kind === 'space') return true` with:

```ts
    // Every space form routes the spec to space (track 3, SP9) — except a
    // scalar multi-parameter definition, which draws nothing and is as much a
    // 2D helper as a 3D one (agreed with space, 2026-10-01). A vector function
    // stays 3D intent.
    if (s.kind === 'space') return s.form.form !== 'function'
```

If TypeScript cannot see `s.form.form` (check how `SpaceForm` is exported from `space/grammar/types.ts`), use the same narrowing `space/kernel/scope.ts` uses (`statement.form.form === 'function'`).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/parser/ src/scene/mode.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything that must not move**

The four checks of Task 1 Step 8 — the sweep must stay 49/49 (every space example draws something, so none is affected by the mode change).

- [ ] **Step 9: Commit**

```bash
git add src/parser/types.ts src/parser/grammarUtil.ts src/parser/parseStatement.ts src/parser/parseStatement.test.ts src/scene/mode.ts src/scene/mode.test.ts
git commit -m "feat(parser): if clauses on every plot form, bracket-aware relation scanning; a scalar multi-parameter definition alone is not 3D

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space: the `where` field is live (shape, and that old-shape explicit clauses are unchanged), the mode-rule change landed with its four tests, and the sweep result. Remind space of its `where` guard before calc's first merge.

---

### Task 7: The 2D engine on the kernel

**Files:**
- Create: `graph-engine/src/plot/scope.ts`
- Create: `graph-engine/src/plot/scope.test.ts`
- Modify: `graph-engine/src/scene/buildScene.ts`
- Modify: `graph-engine/src/scene/buildScene.test.ts` (append)
- Modify: `graph-engine/src/scene/buildTable.ts`
- Modify: `graph-engine/src/GraphViewer.tsx` (pass statement lines to `buildScene`)
- Modify: `graph-engine/src/examples.ts` (a `Calculus` group, appended last)
- Create: `docs/HANDOFF-2026-10-01-calc-track-4.md`

**Interfaces:**
- Consumes: everything above; `buildScope` from `space/kernel/scope.ts` (imported unchanged).
- Produces: `buildPlotScope(statements: readonly Statement[], config: GraphConfig, lines?: readonly number[]): { scope: MathScope; errors: SceneError[] }`; `buildScene(statements, bounds, config, resolution?, lines?: readonly number[])` — the new optional last parameter carries `parseSpec`'s `statementLines` so errors name their lines.

**What changes for existing 2D specs, deliberately:** errors now carry real line numbers; a typo in an explicit, polar or parametric statement is a compile error instead of a blank plot; `theta = 1` no longer collapses `r = 1 + cos(theta)` (bound variables win, as in math/compile); a definition named after a built-in is refused, as space refuses it; `if` domains that are not one interval no longer bridge their gap. Values for valid existing specs are unchanged (the same IEEE operations).

**What stays on `parser/evalExpr.ts`:** `scene/geometry/buildConstructions.ts` (shared with the figure engine) and the renderer's per-frame `animate:` evaluation. Do not change either.

- [ ] **Step 1: Write the failing tests**

Create `graph-engine/src/plot/scope.test.ts`:

```ts
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

  it('reports a definition named after a built-in on its line', () => {
    const { errors } = scopeOf('y = x\nstep(x) = x')
    expect(errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('"step" is a built-in') })])
  })
})
```

Append to `graph-engine/src/scene/buildScene.test.ts` (reuse the file's existing helper for bounds and parsing if it has one; otherwise use the helper below):

```ts
import { parseSpec } from '../parser/parseSpec'

function sceneOf(spec: string) {
  const parsed = parseSpec(spec)
  return buildScene(parsed.statements, { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }, parsed.config, 140, parsed.statementLines)
}

function curvePoints(scene: ReturnType<typeof sceneOf>) {
  return scene.objects.flatMap((o) => (o.kind === 'curve' ? o.points : []))
}

describe('the 2D engine on the kernel (calc P1)', () => {
  it('reports a typo as a compile error on its line, not a blank plot', () => {
    const scene = sceneOf('y = x\ny = sinn(x)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('Unknown function "sinn"') })])
  })

  it('x^(1/3) draws both halves', () => {
    const xs = curvePoints(sceneOf('y = x^(1/3)')).map((pt) => pt.x)
    expect(Math.min(...xs)).toBeLessThan(-9)
    expect(Math.max(...xs)).toBeGreaterThan(9)
  })

  it('a bound variable wins over a user constant of the same name', () => {
    const cardioid = curvePoints(sceneOf('theta = 1\nr = 1 + cos(theta)'))
    const radii = cardioid.map((pt) => Math.hypot(pt.x, pt.y))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1.5)
  })

  it('piecewise, sums, integrals, primes and multi-parameter functions plot', () => {
    for (const spec of [
      'f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}\ny = f(x)',
      '@param n = 4 range [0, 12] integer\ny = sum(k = 0 to n, (-1)^k x^(2k+1)/(2k+1)!)',
      'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)',
      "f(x) = x^3 - 3x\ny = f'(x)",
      'g(x, a) = a sin(x)\ny = g(x, 2)',
    ]) {
      const scene = sceneOf(spec)
      expect(scene.errors, spec).toEqual([])
      expect(curvePoints(scene).length, spec).toBeGreaterThan(10)
    }
  })

  it('a two-interval if domain does not bridge its gap', () => {
    const scene = sceneOf('y = 1 if x < -1 or x > 1')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(2)
    for (const c of curves) if (c.kind === 'curve') for (const pt of c.points) expect(Math.abs(pt.x)).toBeGreaterThanOrEqual(1)
  })

  it('a curve undefined across the whole view says so', () => {
    const scene = sceneOf('y = ln(-x^2 - 1)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
  })

  it('an if clause on a region keeps the shading inside it', () => {
    const scene = sceneOf('x^2 + y^2 < 9 if y > 0')
    const tris = scene.objects.flatMap((o) => (o.kind === 'region' ? o.triangles : []))
    expect(tris.length).toBeGreaterThan(0)
    for (let i = 0; i < tris.length; i += 3) expect((tris[i].y + tris[i + 1].y + tris[i + 2].y) / 3).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/plot/scope.test.ts src/scene/buildScene.test.ts`
Expected: FAIL (`Cannot find module './scope'`; `buildScene` ignores the new syntax and lines).

- [ ] **Step 3: Write `plot/scope.ts`**

```ts
// The 2D engine's MathScope (calc P1). Built by space's own scope builder,
// imported unchanged, so a definition means the same thing in every engine:
// one-parameter and multi-parameter definitions, constants, @param values,
// and the same refusals — a name defined twice, a @param that is also a
// definition, a definition named after a built-in, pi or e. Definitions are
// order-independent, as they always were in 2D.

import type { MathScope } from '../math/scope'
import type { GraphConfig } from '../parser/config'
import type { Statement } from '../parser/types'
import type { SceneError } from '../scene/types'
import { buildScope } from '../space/kernel/scope'

export function buildPlotScope(statements: readonly Statement[], config: GraphConfig, lines?: readonly number[]): { scope: MathScope; errors: SceneError[] } {
  return buildScope(statements, lines ?? statements.map(() => 0), config.bindings, config.angle)
}
```

If `buildScope`'s signature differs from `(statements, lines, bindings, angle)`, adapt this wrapper to it — do not edit `space/kernel/scope.ts`.

- [ ] **Step 4: Switch `buildScene.ts` to the kernel**

Make these changes in `graph-engine/src/scene/buildScene.ts`:

1. Imports: keep `evalExpr`/`FunctionTable` (still needed for `buildConstructions` and `animatedPoint`), drop `compileExpr` and `Bindings`, and add:

```ts
import { compileScalar } from '../math/compile'
import type { MathScope } from '../math/scope'
import type { Expr } from '../parser/types'
import { buildPlotScope } from '../plot/scope'
```

2. Add a constant evaluator under `collectFunctions`:

```ts
// A number from an expression with no variables (a bound, a coordinate, a
// radius), through the kernel.
function constant(expr: Expr, scope: MathScope): number {
  return compileScalar(expr, [], scope)()
}
```

3. In `collectNamedPoints`, `compileCondition`, `samplePolar`, `sampleParametric`, `buildTangent`, `buildCircle`, `buildPolygon`, `buildScatter` and the `point`/`segment`/`ray`/`vector`/`animatedPoint` branches of the main loop, replace each `evalExpr(e, {}, config.angle, functions)` with `constant(e, scope)`, and change those functions' `functions: FunctionTable` parameter to `scope: MathScope`. In `buildTangent`, compile the body once: `const f = compileScalar(statement.body, ['x'], scope)`, then `fa = f(a)` and the slope from `f(a + h)` and `f(a - h)` exactly as before (the tangent becomes symbolic in V1, not here).

4. Replace `sampleExplicit` with:

```ts
// Whether t is inside the statement's own domain: its calc P1 "where"
// condition when it has one, else its old-shape condition.
function domainTest(statement: Statement & { kind: 'explicit' }, scope: MathScope): (t: number) => boolean {
  if (statement.where) {
    const where = compileScalar(statement.where, [statement.independent], scope)
    return (t) => where(t) === 1
  }
  const condition = compileCondition(statement.condition, scope)
  return (t) => satisfiesCondition(condition, t)
}

function sampleExplicit(statement: Statement & { kind: 'explicit' }, bounds: Bounds, config: GraphConfig, scope: MathScope): SceneObject[] {
  const [lo, hi] = statement.independent === 'x' ? [bounds.xMin, bounds.xMax] : [bounds.yMin, bounds.yMax]
  const viewSpan = statement.independent === 'x' ? bounds.yMax - bounds.yMin : bounds.xMax - bounds.xMin
  const body = compileScalar(statement.body, [statement.independent], scope)
  const inDomain = domainTest(statement, scope)

  // Segments split wherever the function is undefined, leaves its domain, or
  // jumps by a blow-up-sized amount between adjacent samples (the
  // window-relative rule P2 replaces with certified continuity).
  const segments: Vec2[][] = [[]]
  const asymptoteXs: number[] = []
  let lastOther: number | null = null
  let lastT: number | null = null
  let tested = 0
  let finite = 0
  const breakHere = () => {
    if (segments[segments.length - 1].length > 0) segments.push([])
    lastOther = null
    lastT = null
  }

  for (let i = 0; i <= SAMPLES; i++) {
    const t = lo + ((hi - lo) * i) / SAMPLES
    // Outside the statement's own domain is a break, never a bridge: an
    // "x < -1 or x > 1" domain must not join its two pieces.
    if (!inDomain(t)) {
      breakHere()
      continue
    }
    tested++
    const other = body(t)
    if (!Number.isFinite(other)) {
      breakHere()
      continue
    }
    finite++
    if (lastOther !== null && Math.abs(other - lastOther) > viewSpan * ASYMPTOTE_JUMP_FACTOR) {
      if (segments[segments.length - 1].length > 0) segments.push([])
      if (statement.independent === 'x' && lastT !== null) asymptoteXs.push((lastT + t) / 2)
    }
    segments[segments.length - 1].push(statement.independent === 'x' ? { x: t, y: other } : { x: other, y: t })
    lastOther = other
    lastT = t
  }
  if (tested > 0 && finite === 0) throw new Error('this curve is undefined everywhere in view')

  // …the rest of the old function from `const objects: SceneObject[] = []`
  // through its `return objects`, unchanged.
}
```

Keep the old function's tail (curve objects, the asymptote merging and the dashed `segments`) verbatim after the new loop.

5. In `samplePolar` and `sampleParametric`, compile with `compileScalar(statement.body, ['theta'], scope)` and `compileScalar(statement.fx, [statement.param], scope)` / `fy`, drop the `bindings` objects and `try/catch`, keep the sampling loop otherwise unchanged, count finite points, and `throw new Error('this curve is undefined everywhere in view')` when none are finite.

6. In `traceImplicit`, `buildRegion`, `buildRegionChain` and `buildField`, compile each side once over `['x', 'y']` (`const left = compileScalar(statement.left, ['x', 'y'], scope)`) and evaluate as `left(x, y)` instead of through a `bindings` object. Then apply `where` (implicit, region, regionChain only) by filtering the output with the compiled condition — P3 replaces this with exact clipping:

```ts
  const where = statement.where ? compileScalar(statement.where, ['x', 'y'], scope) : null
  const keepAt = (x: number, y: number) => !where || where(x, y) === 1
```

— keep a segment pair when `keepAt` holds at its midpoint, and a region triangle when it holds at its centroid. In `buildField`, skip a tick whose slope is not finite (today a NaN slope pushes NaN vertices).

7. Rename the `functions` argument of `buildFeaturePoints` to `scope: MathScope`, and inside it replace the `compileExpr` line and the `f` wrapper with:

```ts
    let f: (x: number) => number
    try {
      f = compileScalar(statement.body, ['x'], scope)
    } catch {
      // reported by the statement itself
      continue
    }
```

8. Change `buildScene`'s signature and setup:

```ts
export function buildScene(statements: Statement[], bounds: Bounds, config: GraphConfig, resolution: number = IMPLICIT_RESOLUTION, lines?: readonly number[]): Scene {
  const objects: SceneObject[] = []
  const errors: Scene['errors'] = []
  let regression: Scene['regression'] = null
  const lineOf = (index: number) => lines?.[index] ?? 0
  const functions = collectFunctions(statements)
  const plotScope = buildPlotScope(statements, config, lines)
  const scope = plotScope.scope
  errors.push(...plotScope.errors)
  const namedPoints = collectNamedPoints(statements, scope)
```

pass `scope` (instead of `functions`) to every builder you converted, keep `functions` for `buildConstructions(...)` and the `animatedPoint` scene object, and change the catch at the bottom of the loop to `errors.push({ line: lineOf(statementIndex), message: err instanceof Error ? err.message : String(err) })`.

- [ ] **Step 5: Pass the lines from the viewer**

In `graph-engine/src/GraphViewer.tsx`, change the 2D call to `buildScene(parsed.statements, renderer2d.getBounds(), parsed.config, resolution, parsed.statementLines)`. Run `grep -rn "buildScene(" src --include=*.ts --include=*.tsx` and leave every other caller as it is (the parameter is optional).

- [ ] **Step 6: Switch `buildTable.ts`**

Replace its hand-built `FunctionTable` with `const { scope } = buildPlotScope(statements, config)`, evaluate `from`/`to`/`step` with `compileScalar(e, [], scope)()`, and compile the generator body once per statement:

```ts
      let cellAt: (x: number) => string
      try {
        const body = compileScalar(statement.body, [statement.independent], scope)
        cellAt = (x) => formatNumber(body(x))
      } catch {
        cellAt = () => 'undefined'
      }
```

using `cellAt(x)` for each row's second cell. Keep everything else (headers, formula, row cap, step check) unchanged.

- [ ] **Step 7: A `Calculus` examples group**

In `graph-engine/src/examples.ts`, append `'Calculus'` as the **last** entry of `EXAMPLE_GROUPS` (do not reorder existing groups — the review page's slugs depend on titles and order), and append these examples at the end of `EXAMPLES`:

```ts
  {
    label: 'Cube roots, both halves',
    group: 'Calculus',
    spec: `y = x^(1/3)
y = x^(2/3) color: blue`,
  },
  {
    label: 'Piecewise',
    group: 'Calculus',
    spec: `f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}
y = f(x)`,
  },
  {
    label: 'Taylor partial sums of sin',
    group: 'Calculus',
    spec: `@param n = 3 range [0, 12] step 1 integer
y = sin(x)
y = sum(k = 0 to n, (-1)^k x^(2k+1)/(2k+1)!) color: red`,
  },
  {
    label: 'Accumulation: the sine integral',
    group: 'Calculus',
    spec: `F(x) = integral(t = 0 to x, sin(t)/t)
y = F(x)
y = sin(x)/x color: gray`,
  },
  {
    label: "Derivatives by primes",
    group: 'Calculus',
    spec: `f(x) = x^3 - 3x
y = f(x)
y = f'(x) color: red
y = f''(x) color: blue`,
  },
  {
    label: 'Special functions',
    group: 'Calculus',
    spec: `@bounds: [-4, 6] x [-4, 6]
y = gamma(x)
y = erf(x) color: blue
y = |x - 1| - 2 color: gray`,
  },
  {
    label: 'Conditions on a region',
    group: 'Calculus',
    spec: `x^2 + y^2 < 9 if y > 0 and x > -1`,
  },
  {
    label: 'A two-argument helper',
    group: 'Calculus',
    spec: `g(x, a) = a sin(x)
y = g(x, 2)
y = g(x, 0.5) color: blue`,
  },
```

Check the `@param` and `@bounds` syntax against `GRAPH-DSL-REFERENCE.md` and space's examples (`src/space/examples.ts`) and adjust if the accepted form differs (for example `@bounds: x [-4, 6], y [-4, 6]`). `examples.test.ts` renders every example and fails on any error — that is the check.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/plot/ src/scene/ src/examples.test.ts`
Expected: PASS. Existing 2D tests that pinned `line: 0` errors or the old silent-blank behaviour are tests of the defects this task removes: update each to the new behaviour with a comment naming calc P1, and list them in your report. Do not change tests under `src/space/` or `src/figure/`.

- [ ] **Step 9: Write the handoff**

Create `docs/HANDOFF-2026-10-01-calc-track-4.md` with: where the work lives (worktree, branch, base `d1a8ef4`); the spec and this plan; what P1 shipped (one line per task) and the test count; the coordination state with space (the cadence: a message per task touching `math/` or `parser/` after review, plus a summary and fresh sweep before any merge; space's pending `where` guard; the agreed mode rule; the two-ratio `@aspect` it will add when P4 starts) and with geometry (movement constants pending); the rules that bind every task (no edits under `space/` or `figure/`, the typecheck commands, the fixed trailer, the sweep in `graph-engine/.sweep/`); and what is next (P1b, the interval twin, then P2).

- [ ] **Step 10: Run everything that must not move**

The four checks of Task 1 Step 8, plus `npx vitest run src/figure/cleanGolden.test.ts` explicitly (figure renders byte-identical).

- [ ] **Step 11: Commit**

```bash
git add src/plot/scope.ts src/plot/scope.test.ts src/scene/buildScene.ts src/scene/buildScene.test.ts src/scene/buildTable.ts src/GraphViewer.tsx src/examples.ts ../docs/HANDOFF-2026-10-01-calc-track-4.md
git commit -m "feat(graph-engine): the 2D engine compiles through the shared kernel — errors on their lines, the new syntax plots, a Calculus examples group

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Add any updated 2D test files to the `git add` list explicitly.)

- [ ] **Controller step:** message space that 2D now imports `space/kernel/scope.ts`'s `buildScope` unchanged (ask it to tell calc before changing that signature), with the sweep result.
