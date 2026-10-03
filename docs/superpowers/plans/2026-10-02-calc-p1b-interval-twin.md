# Calc P1b — The Interval Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every built-in and every reserved construct of the shared `math/` kernel an interval twin — an enclosure of what the scalar compile can produce over an input box, plus a verdict (continuous / defined / partial / unknown) — and tie each built-in's scalar implementation, twin and derivative rule together in one registry the tests hold complete.

**Architecture:** A new directory `math/interval/`. `core.ts` (the decorated interval, verdicts, outward widening), `arith.ts` (+ − × ÷ and powers), `elementary.ts` (trig, inverse trig, hyperbolic, exp/log, roots), `stepwise.ts` (floor/ceil/round/sign/mod/step, min/max/hypot), `special.ts` (gamma, factorial, erf/erfc, the integer functions) — each twin has the uniform signature `(out, args, angle) => void`. `math/registry.ts` maps every built-in name to its twin and its derivative class. `math/interval/compile.ts` compiles an `Expr` to closures over intervals, resolving names exactly as `math/compile.ts` does, after first running `compileScalar` so the compile errors are identical.

**Tech Stack:** TypeScript 6, Vitest. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-calc-proofing-design.md` — "The kernel (P1)" → "The interval twin" and "One rule that keeps the kernel lasting". Companion to the P1 plan (`2026-10-01-calc-p1-kernel-language.md`, complete). Nothing consumes the twin until P2.

## Global Constraints

- **Working tree:** `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, branch `milestone-a/calc`. Run commands from `graph-engine/`.
- **Never edit** anything under `graph-engine/src/space/` or `graph-engine/src/figure/`, nor `scene/buildScene3d.ts` or `render/SceneRenderer3D.ts`. Do not edit `server/` or `web/`.
- **`math/` edits are additive.** P1b adds files; the only existing `math/` file it may touch is `math/compile.ts`, and only to export a helper the twin compiler needs (`namesValue`), with no behaviour change. After every task: the full suite green, both typechecks clean, and space's scene sweep `npx tsx .sweep/scenes.mts` reporting `identical 49; differ 0`.
- **The typecheck** is `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`.
- **Tests:** `npx vitest run <path>`; the suite alone with `npx vitest run --maxWorkers=3` (the machine is loaded; rerun once on an RPC timeout). Lint: `npx oxlint src`.
- **Soundness is the contract.** For every input box and every point inside it, the scalar compile's value `y` at that point satisfies: if `y` is finite, `lo ≤ y ≤ hi`; if `y` is NaN, the verdict is `PARTIAL` or `UNKNOWN`; if `y` is ±Infinity, the result is non-empty and the bound on that side is that infinity, whatever the verdict (an excused infinity becomes a wrong finite value once another operation consumes it). A `CONTINUOUS` verdict never covers a NaN. **Signed zeros:** a box end that is a zero is that signed zero; a zero strictly inside the box may be either sign. **Overflow is not undefinedness:** a finite input whose result overflows keeps its verdict (the bound becomes infinite); `PARTIAL` means a NaN or a pole.
- **Tightness is tested too.** Soundness alone is met by always answering `UNKNOWN`; every family's tests also pin tight answers on simple boxes.
- **Outward widening:** every bound computed with IEEE arithmetic is widened by 2 ulps; every bound computed with a library function (`Math.sin`, `gamma`, …) by 4 ulps; `gamma` and its derived functions by a relative `1e-13` (measured non-monotonicity 1.26e-14); `erf`/`erfc` by a relative `8e-15` plus an absolute `8e-15` (measured: erfc's `1 − erf` branch is 3.6e-12 relative just under 2.5 — 4 ulps is not enough). Do not narrow these back to LIB.
- **Twins read every input before writing `out`**, so `out` may alias an input.
- **Deterministic:** no `Math.random`, `Date` or clock in `math/` (tests included — the property tests use a seeded generator).
- **Commits:** explicit `git add <paths>`; never `git stash`; every commit message ends with exactly `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Other agents** work in other worktrees; leave their branches, worktrees and stash entries alone.
- **No browser tools.** Write regexes with the Edit/Write tools, never Bash heredocs.

---

### Task 1: The interval core and arithmetic

**Files:**
- Create: `graph-engine/src/math/interval/core.ts`
- Create: `graph-engine/src/math/interval/arith.ts`
- Create: `graph-engine/src/math/interval/testkit.ts` (test helpers: the seeded generator and the soundness checker)
- Create: `graph-engine/src/math/interval/arith.test.ts`

**Interfaces:**
- Produces (`core.ts`): `UNKNOWN = 0`, `PARTIAL = 1`, `DEFINED = 2`, `CONTINUOUS = 3`, `type Verdict = 0 | 1 | 2 | 3`, `interface Iv { lo: number; hi: number; v: Verdict }`, `iv(lo?, hi?, v?)`, `worst(a, b)`, `down(x, rel?)`, `up(x, rel?)`, `ULP2`, `LIB`, `set(out, lo, hi, v)`, `setEmpty(out)`, `setUnknown(out)`, `setPoint(out, x)`, `setBox(out, lo, hi)`, `isEmpty(a)`, `copy(out, a)`, `hull(out, a)`.
- Produces (`arith.ts`): `add`, `sub`, `mul`, `div` `(out, a, b) => Iv`; `neg(out, a)`; `powInt(out, a, n)`, `powReal(out, a, e)`, `powOddRoot(out, a, e, pOdd)`, `powGeneral(out, a, b)`; `sides(out, a, f, at0, v?)`.
- Produces (`testkit.ts`): `mulberry32(seed): () => number`, `randomBox(rand): [number, number]`, `soundViolations(...)` (signature below).

- [ ] **Step 1: Write `core.ts`**

```ts
// Decorated intervals for the kernel's interval twin (calc P1b; spec "The
// kernel": the interval twin). An Iv encloses every value the scalar compile
// can produce over an input box, and says one thing about the box:
//
//   CONTINUOUS (3)  defined and continuous on the whole box: the sampler may
//                   connect across it
//   DEFINED    (2)  defined everywhere on the box, but it may jump (floor,
//                   mod, step, piecewise seams)
//   PARTIAL    (1)  undefined somewhere inside (a NaN, a pole)
//   UNKNOWN    (0)  no cheap enclosure (integral); bounds are [-inf, inf]
//
// Verdicts combine by the weakest (the smaller number). An empty Iv (lo > hi)
// is "undefined everywhere on the box" and always carries PARTIAL.
//
// JavaScript has no directed rounding, so every bound is widened outward after
// it is computed: by 2 ulps for IEEE arithmetic (ULP2), 4 for a library function
// (LIB). The twin is robust rather than formally rigorous; the property tests
// hold every twin to soundness against the scalar compile.

export const UNKNOWN = 0
export const PARTIAL = 1
export const DEFINED = 2
export const CONTINUOUS = 3
export type Verdict = 0 | 1 | 2 | 3

export interface Iv {
  lo: number
  hi: number
  v: Verdict
}

export function iv(lo = 0, hi = 0, v: Verdict = CONTINUOUS): Iv {
  return { lo, hi, v }
}

export function worst(a: Verdict, b: Verdict): Verdict {
  return a < b ? a : b
}

// 2^-51 and 2^-50: two and four ulps of any normal double, as a relative step.
export const ULP2 = 4.440892098500626e-16
export const LIB = 8.881784197001252e-16

export function down(x: number, rel: number = ULP2): number {
  if (x === Infinity || x === -Infinity) return x
  return x - (Math.abs(x) * rel + Number.MIN_VALUE)
}

export function up(x: number, rel: number = ULP2): number {
  if (x === Infinity || x === -Infinity) return x
  return x + (Math.abs(x) * rel + Number.MIN_VALUE)
}

// Writes [lo, hi] with verdict v. A NaN bound is no bound: -inf below, +inf
// above.
export function set(out: Iv, lo: number, hi: number, v: Verdict): Iv {
  out.lo = Number.isNaN(lo) ? -Infinity : lo
  out.hi = Number.isNaN(hi) ? Infinity : hi
  out.v = v
  return out
}

export function setEmpty(out: Iv): Iv {
  out.lo = Infinity
  out.hi = -Infinity
  out.v = PARTIAL
  return out
}

export function setUnknown(out: Iv): Iv {
  out.lo = -Infinity
  out.hi = Infinity
  out.v = UNKNOWN
  return out
}

// The single value x: a NaN is empty, anything else is [x, x], continuous.
export function setPoint(out: Iv, x: number): Iv {
  if (Number.isNaN(x)) return setEmpty(out)
  out.lo = x
  out.hi = x
  out.v = CONTINUOUS
  return out
}

// An input box: empty when either end is NaN or lo > hi.
export function setBox(out: Iv, lo: number, hi: number): Iv {
  if (!(lo <= hi)) return setEmpty(out)
  out.lo = lo
  out.hi = hi
  out.v = CONTINUOUS
  return out
}

export function isEmpty(a: Iv): boolean {
  return !(a.lo <= a.hi)
}

export function copy(out: Iv, a: Iv): Iv {
  out.lo = a.lo
  out.hi = a.hi
  out.v = a.v
  return out
}

// Widens out to include a (a set union); the verdict is the weaker.
export function hull(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) {
    out.v = worst(out.v, a.v)
    return out
  }
  if (isEmpty(out)) {
    const v = worst(out.v, a.v)
    copy(out, a)
    out.v = v
    return out
  }
  out.lo = Math.min(out.lo, a.lo)
  out.hi = Math.max(out.hi, a.hi)
  out.v = worst(out.v, a.v)
  return out
}
```

Note on `hull` with an empty `out`: an empty Iv carries `PARTIAL`, so a hull that starts empty is at most `PARTIAL`. Callers that build a union from nothing start from `iv(Infinity, -Infinity, CONTINUOUS)` instead (an empty *accumulator* that has not yet seen an undefined value) — see Task 4's piecewise.

- [ ] **Step 2: Write `testkit.ts`**

```ts
// Test helpers for the interval twin: a seeded generator (math/ never uses
// Math.random) and the soundness check every twin is held to.

import type { Iv } from './core'
import { PARTIAL } from './core'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A random box: a centre on a log-ish scale up to ±1e3, a width from 1e-9 to
// 40, sometimes degenerate, sometimes touching an integer or zero.
export function randomBox(rand: () => number): [number, number] {
  const r = rand()
  const sign = rand() < 0.5 ? -1 : 1
  const centre = r < 0.15 ? Math.round(sign * rand() * 6) : sign * Math.pow(10, rand() * 4 - 1) * rand()
  const width = rand() < 0.08 ? 0 : Math.pow(10, rand() * 10.6 - 9)
  const lo = rand() < 0.1 ? centre : centre - width * rand()
  return [lo, lo + width]
}

// Points to test inside [lo, hi]: both ends and `count` interior points.
export function pointsIn(lo: number, hi: number, rand: () => number, count: number): number[] {
  const out = [lo, hi]
  for (let i = 0; i < count; i++) out.push(lo + (hi - lo) * rand())
  return out
}

// Whether the scalar value y at a point of the box is allowed by the twin's
// answer `r` (the soundness contract in the plan's Global Constraints).
export function admits(r: Iv, y: number): boolean {
  if (Number.isNaN(y)) return r.v <= PARTIAL
  if (y === Infinity) return r.v <= PARTIAL || r.hi === Infinity
  if (y === -Infinity) return r.v <= PARTIAL || r.lo === -Infinity
  return r.lo <= y && y <= r.hi
}
```

- [ ] **Step 3: Write the failing tests**

Create `graph-engine/src/math/interval/arith.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONTINUOUS, DEFINED, iv, PARTIAL, setBox, type Iv } from './core'
import { add, div, mul, neg, powGeneral, powInt, powOddRoot, powReal, sub } from './arith'
import { realOddPow } from '../rational'
import { admits, mulberry32, pointsIn, randomBox } from './testkit'

const box = (lo: number, hi: number): Iv => setBox(iv(), lo, hi)
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b))

describe('arithmetic is tight on simple boxes', () => {
  it('add, sub, neg, mul', () => {
    const r = add(iv(), box(1, 2), box(10, 20))
    expect(near(r.lo, 11) && near(r.hi, 22) && r.v === CONTINUOUS).toBe(true)
    const s = sub(iv(), box(1, 2), box(10, 20))
    expect(near(s.lo, -19) && near(s.hi, -8)).toBe(true)
    expect(neg(iv(), box(1, 2))).toEqual({ lo: -2, hi: -1, v: CONTINUOUS })
    const m = mul(iv(), box(-1, 2), box(3, 4))
    expect(near(m.lo, -4) && near(m.hi, 8)).toBe(true)
  })

  it('div away from zero is continuous; across or touching zero is partial', () => {
    const d = div(iv(), box(1, 2), box(4, 8))
    expect(near(d.lo, 0.125) && near(d.hi, 0.5) && d.v === CONTINUOUS).toBe(true)
    expect(div(iv(), box(1, 2), box(-1, 1))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const touch = div(iv(), box(1, 2), box(0, 1))
    expect(near(touch.lo, 1) && touch.hi === Infinity && touch.v === PARTIAL).toBe(true)
  })

  it('integer powers', () => {
    const sq = powInt(iv(), box(-1, 2), 2)
    expect(near(sq.lo, 0) && near(sq.hi, 4) && sq.v === CONTINUOUS).toBe(true)
    const cube = powInt(iv(), box(-2, 1), 3)
    expect(near(cube.lo, -8) && near(cube.hi, 1)).toBe(true)
    expect(powInt(iv(), box(-1, 1), -1).v).toBe(PARTIAL)
    const inv = powInt(iv(), box(1, 4), -2)
    expect(near(inv.lo, 1 / 16) && near(inv.hi, 1)).toBe(true)
    expect(powInt(iv(), box(-3, 5), 0)).toMatchObject({ lo: 1, hi: 1, v: CONTINUOUS })
  })

  it('a real exponent needs a non-negative base', () => {
    const r = powReal(iv(), box(4, 9), 0.5)
    expect(near(r.lo, 2) && near(r.hi, 3) && r.v === CONTINUOUS).toBe(true)
    const clipped = powReal(iv(), box(-4, 9), 0.5)
    expect(near(clipped.lo, 0) && near(clipped.hi, 3) && clipped.v === PARTIAL).toBe(true)
    expect(powReal(iv(), box(0, 1), -0.5)).toMatchObject({ hi: Infinity, v: PARTIAL })
  })

  it('a real odd root crosses zero continuously', () => {
    const r = powOddRoot(iv(), box(-8, 27), 1 / 3, true)
    expect(near(r.lo, -2) && near(r.hi, 3) && r.v === CONTINUOUS).toBe(true)
    const even = powOddRoot(iv(), box(-8, 1), 2 / 3, false)
    expect(near(even.lo, 0) && near(even.hi, 4) && even.v === CONTINUOUS).toBe(true)
    expect(powOddRoot(iv(), box(-1, 1), -1 / 3, true).v).toBe(PARTIAL)
  })

  it('an interval exponent over a positive base takes the corners', () => {
    const r = powGeneral(iv(), box(2, 3), box(1, 2))
    expect(near(r.lo, 2) && near(r.hi, 9) && r.v === CONTINUOUS).toBe(true)
    expect(powGeneral(iv(), box(-1, 3), box(1, 2)).v).toBe(PARTIAL)
  })

  it('verdicts propagate as the weakest', () => {
    expect(add(iv(), iv(0, 1, DEFINED), box(0, 1)).v).toBe(DEFINED)
    expect(mul(iv(), iv(0, 1, PARTIAL), box(0, 1)).v).toBe(PARTIAL)
  })

  it('an empty operand gives an empty, partial result', () => {
    const r = add(iv(), iv(Infinity, -Infinity, PARTIAL), box(0, 1))
    expect(r.lo > r.hi && r.v === PARTIAL).toBe(true)
  })

  it('out may alias an input', () => {
    const a = box(1, 2)
    add(a, a, box(10, 20))
    expect(near(a.lo, 11) && near(a.hi, 22)).toBe(true)
  })
})

describe('arithmetic is sound over random boxes', () => {
  const rand = mulberry32(20261002)
  const cases: [string, (a: Iv, b: Iv) => Iv, (x: number, y: number) => number][] = [
    ['add', (a, b) => add(iv(), a, b), (x, y) => x + y],
    ['sub', (a, b) => sub(iv(), a, b), (x, y) => x - y],
    ['mul', (a, b) => mul(iv(), a, b), (x, y) => x * y],
    ['div', (a, b) => div(iv(), a, b), (x, y) => x / y],
    ['pow', (a, b) => powGeneral(iv(), a, b), (x, y) => Math.pow(x, y)],
  ]
  for (const [name, twin, scalar] of cases) {
    it(name, () => {
      for (let i = 0; i < 400; i++) {
        const [al, ah] = randomBox(rand)
        const [bl, bh] = randomBox(rand)
        const r = twin(box(al, ah), box(bl, bh))
        for (const x of pointsIn(al, ah, rand, 4)) {
          for (const y of pointsIn(bl, bh, rand, 4)) {
            expect(admits(r, scalar(x, y)), `${name} [${al}, ${ah}] [${bl}, ${bh}] at (${x}, ${y}) gives ${scalar(x, y)} outside ${JSON.stringify(r)}`).toBe(true)
          }
        }
      }
    })
  }

  it('powInt, powReal and powOddRoot', () => {
    for (let i = 0; i < 400; i++) {
      const [lo, hi] = randomBox(rand)
      const n = Math.round(rand() * 10 - 5)
      const e = rand() * 6 - 3
      const q = [3, 5, 7][Math.floor(rand() * 3)]
      const p = Math.round(rand() * 8 - 4) || 1
      const ri = powInt(iv(), box(lo, hi), n)
      const rr = powReal(iv(), box(lo, hi), e)
      const ro = powOddRoot(iv(), box(lo, hi), p / q, Math.abs(p) % 2 === 1)
      for (const x of pointsIn(lo, hi, rand, 8)) {
        expect(admits(ri, Math.pow(x, n)), `x^${n} at ${x}`).toBe(true)
        expect(admits(rr, Math.pow(x, e)), `x^${e} at ${x}`).toBe(true)
        expect(admits(ro, realOddPow(x, p / q, Math.abs(p) % 2 === 1)), `x^(${p}/${q}) at ${x}`).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run src/math/interval/arith.test.ts`
Expected: FAIL — `Cannot find module './arith'`.

- [ ] **Step 5: Write `arith.ts`**

```ts
// Interval arithmetic for the twin (calc P1b). Each operation reads its
// operands before writing `out`, so `out` may alias either.

import { CONTINUOUS, down, isEmpty, type Iv, LIB, PARTIAL, set, setEmpty, up, type Verdict, worst } from './core'

function unbounded(a: Iv): boolean {
  return a.lo === -Infinity || a.hi === Infinity
}

function hasZero(a: Iv): boolean {
  return a.lo <= 0 && 0 <= a.hi
}

export function neg(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  return set(out, -a.hi, -a.lo, a.v)
}

export function add(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  // inf + -inf is NaN in the scalar compile: only possible when both sides reach
  // opposite infinities.
  const clash = (a.hi === Infinity && b.lo === -Infinity) || (a.lo === -Infinity && b.hi === Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(a.lo + b.lo), up(a.hi + b.hi), v)
}

export function sub(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const clash = (a.hi === Infinity && b.hi === Infinity) || (a.lo === -Infinity && b.lo === -Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(a.lo - b.hi), up(a.hi - b.lo), v)
}

// 0 · inf is 0 for an enclosure of products (the scalar NaN case is flagged
// separately, below).
function times(x: number, y: number): number {
  const p = x * y
  return p !== p ? 0 : p
}

export function mul(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const p1 = times(a.lo, b.lo)
  const p2 = times(a.lo, b.hi)
  const p3 = times(a.hi, b.lo)
  const p4 = times(a.hi, b.hi)
  // 0 · inf is NaN in the scalar compile when an operand really is infinite.
  const clash = (unbounded(a) && hasZero(b)) || (unbounded(b) && hasZero(a))
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(Math.min(p1, p2, p3, p4)), up(Math.max(p1, p2, p3, p4)), v)
}

export function div(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const v = worst(a.v, b.v)
  if (b.lo > 0 || b.hi < 0) {
    const q1 = a.lo / b.lo
    const q2 = a.lo / b.hi
    const q3 = a.hi / b.lo
    const q4 = a.hi / b.hi
    if (q1 !== q1 || q2 !== q2 || q3 !== q3 || q4 !== q4) return set(out, -Infinity, Infinity, worst(v, PARTIAL))
    return set(out, down(Math.min(q1, q2, q3, q4)), up(Math.max(q1, q2, q3, q4)), v)
  }
  // The divisor reaches zero: undefined there.
  const p = worst(v, PARTIAL)
  if (b.lo === 0 && b.hi === 0) return setEmpty(out)
  if (hasZero(a) || (b.lo < 0 && b.hi > 0)) return set(out, -Infinity, Infinity, p)
  if (b.lo === 0) return a.lo > 0 ? set(out, down(a.lo / b.hi), Infinity, p) : set(out, -Infinity, up(a.hi / b.hi), p)
  return a.lo > 0 ? set(out, -Infinity, up(a.lo / b.lo), p) : set(out, down(a.hi / b.lo), Infinity, p)
}

// f monotone on (-inf, 0] and on [0, inf) (either direction on each side), with
// f(0) = at0, or at0 NaN for a pole or a hole at 0. Bounds come from the ends
// and, when 0 is strictly inside, from f(0). A non-finite end value marks the
// result partial (a pole or an overflow at that end).
export function sides(out: Iv, a: Iv, f: (x: number) => number, at0: number, rel: number = LIB): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const x = f(a.lo)
  const y = f(a.hi)
  let v: Verdict = a.v
  if (a.lo < 0 && 0 < a.hi) {
    if (Number.isNaN(at0)) return set(out, -Infinity, Infinity, worst(v, PARTIAL))
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) v = worst(v, PARTIAL)
  let lo = Math.min(x, y)
  let hi = Math.max(x, y)
  if (a.lo < 0 && 0 < a.hi) {
    lo = Math.min(lo, at0)
    hi = Math.max(hi, at0)
  }
  if (Number.isNaN(x) || Number.isNaN(y)) return set(out, -Infinity, Infinity, worst(v, PARTIAL))
  return set(out, down(lo, rel), up(hi, rel), v)
}

// x^n for a whole n (the scalar compile's Math.pow).
export function powInt(out: Iv, a: Iv, n: number): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (n === 0) return set(out, 1, 1, a.v)
  return sides(out, a, (x) => Math.pow(x, n), n > 0 ? 0 : Number.NaN)
}

// x^e for a real, non-integer e that is not a literal odd root: defined for
// x >= 0 only.
export function powReal(out: Iv, a: Iv, e: number): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (a.hi < 0) return setEmpty(out)
  let v: Verdict = a.v
  let lo = a.lo
  if (lo < 0) {
    lo = 0
    v = worst(v, PARTIAL)
  }
  const x = Math.pow(lo, e)
  const y = Math.pow(a.hi, e)
  if (!Number.isFinite(x) || !Number.isFinite(y)) v = worst(v, PARTIAL)
  return set(out, down(Math.min(x, y), LIB), up(Math.max(x, y), LIB), v)
}

// x^(p/q) for a literal ratio with q odd: realOddPow, monotone on each side of 0.
export function powOddRoot(out: Iv, a: Iv, e: number, pOdd: boolean): Iv {
  const f = (x: number) => (x < 0 ? (pOdd ? -Math.pow(-x, e) : Math.pow(-x, e)) : Math.pow(x, e))
  return sides(out, a, f, e > 0 ? 0 : Number.NaN)
}

// x^y with an interval exponent. For x > 0, x^y is monotone in each variable,
// so the four corners bound it; otherwise it is not defined everywhere and no
// cheap enclosure is attempted.
export function powGeneral(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  if (b.lo === b.hi) {
    const e = b.lo
    const v0 = worst(a.v, b.v)
    if (Number.isInteger(e)) return withVerdict(powInt(out, a, e), v0)
    return withVerdict(powReal(out, a, e), v0)
  }
  if (!(a.lo > 0)) return set(out, -Infinity, Infinity, worst(worst(a.v, b.v), PARTIAL))
  const c1 = Math.pow(a.lo, b.lo)
  const c2 = Math.pow(a.lo, b.hi)
  const c3 = Math.pow(a.hi, b.lo)
  const c4 = Math.pow(a.hi, b.hi)
  let v = worst(a.v, b.v)
  if (![c1, c2, c3, c4].every(Number.isFinite)) v = worst(v, PARTIAL)
  return set(out, down(Math.min(c1, c2, c3, c4), LIB), up(Math.max(c1, c2, c3, c4), LIB), v)
}

function withVerdict(out: Iv, v: Verdict): Iv {
  out.v = worst(out.v, v)
  return out
}

export { CONTINUOUS }
```

Remove the stray `export { CONTINUOUS }` if oxlint flags it as an unused re-export; nothing needs it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/math/interval/arith.test.ts`
Expected: PASS. If the random soundness sweep finds a violation, the message names the box and point: fix the twin (never loosen `admits`).

- [ ] **Step 7: Run everything that must not move**

The full suite (alone, `--maxWorkers=3`), both typechecks, `npx oxlint src`, the sweep (`identical 49; differ 0`).

- [ ] **Step 8: Commit**

```bash
git add src/math/interval/core.ts src/math/interval/arith.ts src/math/interval/testkit.ts src/math/interval/arith.test.ts
git commit -m "feat(math): the interval twin's core — decorated intervals, outward widening, arithmetic and powers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space ("Calculus 3D engine for graphing") — additive files, sweep result.

---

### Task 2: Elementary twins

**Files:**
- Create: `graph-engine/src/math/interval/elementary.ts`
- Create: `graph-engine/src/math/interval/elementary.test.ts`

**Interfaces:**
- Consumes: `core.ts`, `arith.ts` (`mul`, `div`, `sides`), `realOddPow` not needed.
- Produces: twins with the uniform signature `type Twin = (out: Iv, args: readonly Iv[], angle: 'radians' | 'degrees') => void`, exported as `sinT, cosT, tanT, secT, cscT, cotT, asinT, acosT, atanT, atan2T, sinhT, coshT, tanhT, asinhT, acoshT, atanhT, sqrtT, absT, expT, lnT, logT, cbrtT, rootT`, plus `export type Twin`. Each twin computes exactly what the scalar compile computes (`math/compile.ts`'s `BUILTINS`), including degrees: trig multiplies its argument by `Math.PI / 180` first; inverse trig and atan2 multiply their result by `180 / Math.PI`.

- [ ] **Step 1: Write the failing tests**

Create `graph-engine/src/math/interval/elementary.test.ts`. It has two parts: **tightness/verdict** cases written out, and a **soundness sweep** of every twin against the scalar compile.

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../../parser/parseExpr'
import { compileScalar } from '../compile'
import { makeScope } from '../scope'
import { CONTINUOUS, iv, PARTIAL, setBox, type Iv } from './core'
import * as E from './elementary'
import { admits, mulberry32, pointsIn, randomBox } from './testkit'

const box = (lo: number, hi: number): Iv => setBox(iv(), lo, hi)
const run1 = (t: E.Twin, lo: number, hi: number, angle: 'radians' | 'degrees' = 'radians') => {
  const out = iv()
  t(out, [box(lo, hi)], angle)
  return out
}
const within = (r: Iv, lo: number, hi: number, tol = 1e-12) => r.lo >= lo - tol && r.lo <= lo + tol && r.hi >= hi - tol && r.hi <= hi + tol

describe('elementary twins are tight and honest on simple boxes', () => {
  it('sin and cos find their extremes', () => {
    expect(within(run1(E.sinT, 0, 1), 0, Math.sin(1))).toBe(true)
    expect(within(run1(E.sinT, 1, 2), Math.sin(1), 1)).toBe(true)
    expect(within(run1(E.cosT, 3, 3.5), -1, Math.cos(3.5) > Math.cos(3) ? Math.cos(3.5) : Math.cos(3))).toBe(true)
    expect(run1(E.sinT, -10, 10)).toMatchObject({ lo: -1, hi: 1, v: CONTINUOUS })
    expect(within(run1(E.sinT, 0, 30, 'degrees'), 0, 0.5, 1e-12)).toBe(true)
  })

  it('tan is partial across a pole and monotone between', () => {
    expect(run1(E.tanT, 1, 2)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const r = run1(E.tanT, 0, 1)
    expect(within(r, 0, Math.tan(1)) && r.v === CONTINUOUS).toBe(true)
  })

  it('sec, csc and cot are partial only at their own poles', () => {
    expect(run1(E.secT, 1, 2).v).toBe(PARTIAL)
    expect(run1(E.secT, -1, 1).v).toBe(CONTINUOUS)
    expect(run1(E.cscT, -1, 1).v).toBe(PARTIAL)
    expect(run1(E.cotT, 1, 2).v).toBe(CONTINUOUS)
    expect(run1(E.cotT, 3, 3.5).v).toBe(PARTIAL)
  })

  it('domain edges make a twin partial and clip its bounds', () => {
    expect(run1(E.sqrtT, -1, 4)).toMatchObject({ v: PARTIAL })
    expect(within(run1(E.sqrtT, -1, 4), 0, 2)).toBe(true)
    expect(run1(E.lnT, -1, 1)).toMatchObject({ lo: -Infinity, v: PARTIAL })
    expect(run1(E.asinT, 0.5, 2).v).toBe(PARTIAL)
    expect(run1(E.acoshT, 0, 2).v).toBe(PARTIAL)
    expect(run1(E.atanhT, -1, 0).v).toBe(PARTIAL)
    const empty = run1(E.lnT, -3, -1)
    expect(empty.lo > empty.hi && empty.v === PARTIAL).toBe(true)
  })

  it('abs and cosh bottom out at 0', () => {
    expect(within(run1(E.absT, -2, 1), 0, 2)).toBe(true)
    expect(within(run1(E.coshT, -1, 2), 1, Math.cosh(2))).toBe(true)
  })

  it('atan2 is defined but may jump across the negative x-axis and at the origin', () => {
    const t = (yl: number, yh: number, xl: number, xh: number) => {
      const out = iv()
      E.atan2T(out, [box(yl, yh), box(xl, xh)], 'radians')
      return out
    }
    expect(t(1, 2, 1, 2).v).toBe(CONTINUOUS)
    expect(t(-1, 1, -2, -1).v).toBeLessThan(CONTINUOUS)
    expect(t(-1, 1, -1, 1).v).toBeLessThan(CONTINUOUS)
  })

  it('cbrt and root(n, x)', () => {
    expect(within(run1(E.cbrtT, -8, 27), -2, 3)).toBe(true)
    const out = iv()
    E.rootT(out, [box(3, 3), box(-27, 8)], 'radians')
    expect(within(out, -3, 2) && out.v === CONTINUOUS).toBe(true)
    E.rootT(out, [box(2, 2), box(-1, 4)], 'radians')
    expect(out.v).toBe(PARTIAL)
  })
})

// The scalar each twin must enclose: the kernel's own compile of the built-in.
const UNARY = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sqrt', 'abs', 'exp', 'ln', 'log', 'cbrt'] as const
const TWINS: Record<(typeof UNARY)[number], E.Twin> = {
  sin: E.sinT, cos: E.cosT, tan: E.tanT, sec: E.secT, csc: E.cscT, cot: E.cotT,
  asin: E.asinT, acos: E.acosT, atan: E.atanT,
  sinh: E.sinhT, cosh: E.coshT, tanh: E.tanhT, asinh: E.asinhT, acosh: E.acoshT, atanh: E.atanhT,
  sqrt: E.sqrtT, abs: E.absT, exp: E.expT, ln: E.lnT, log: E.logT, cbrt: E.cbrtT,
}

describe('elementary twins are sound over random boxes', () => {
  for (const angle of ['radians', 'degrees'] as const) {
    for (const name of UNARY) {
      it(`${name} (${angle})`, () => {
        const rand = mulberry32(name.length * 7919 + (angle === 'degrees' ? 1 : 0))
        const f = compileScalar(p(`${name}(x)`), ['x'], makeScope({ angle }))
        for (let i = 0; i < 500; i++) {
          const [lo, hi] = randomBox(rand)
          const r = run1(TWINS[name], lo, hi, angle)
          for (const x of pointsIn(lo, hi, rand, 6)) {
            expect(admits(r, f(x)), `${name} [${lo}, ${hi}] at ${x} gives ${f(x)}, twin ${JSON.stringify(r)}`).toBe(true)
          }
        }
      })
    }
  }

  it('log(a, b), atan2(y, x) and root(n, x)', () => {
    const rand = mulberry32(31337)
    const scope = makeScope()
    const log2 = compileScalar(p('log(x, y)'), ['x', 'y'], scope)
    const at2 = compileScalar(p('atan2(x, y)'), ['x', 'y'], scope)
    const rt = compileScalar(p('root(x, y)'), ['x', 'y'], scope)
    for (let i = 0; i < 300; i++) {
      const [al, ah] = randomBox(rand)
      const [bl, bh] = randomBox(rand)
      const n = Math.round(rand() * 8 - 4)
      const rl = iv()
      E.logT(rl, [box(al, ah), box(bl, bh)], 'radians')
      const ra = iv()
      E.atan2T(ra, [box(al, ah), box(bl, bh)], 'radians')
      const rr = iv()
      E.rootT(rr, [box(n, n), box(bl, bh)], 'radians')
      for (const x of pointsIn(al, ah, rand, 3)) {
        for (const y of pointsIn(bl, bh, rand, 3)) {
          expect(admits(rl, log2(x, y)), `log(${x}, ${y})`).toBe(true)
          expect(admits(ra, at2(x, y)), `atan2(${x}, ${y})`).toBe(true)
        }
      }
      for (const y of pointsIn(bl, bh, rand, 6)) expect(admits(rr, rt(n, y)), `root(${n}, ${y})`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/math/interval/elementary.test.ts`
Expected: FAIL — `Cannot find module './elementary'`.

- [ ] **Step 3: Write `elementary.ts`**

```ts
// Interval twins of the kernel's elementary built-ins (calc P1b). Each encloses
// exactly what math/compile.ts's BUILTINS compute — including degrees: trig
// scales its argument by pi/180 first, inverse trig scales its result by
// 180/pi. Library-function bounds are widened by LIB (4 ulps).

import { CONTINUOUS, DEFINED, down, isEmpty, type Iv, iv, LIB, PARTIAL, set, setEmpty, up, type Verdict, worst } from './core'
import { div, mul, sides } from './arith'

export type Twin = (out: Iv, args: readonly Iv[], angle: 'radians' | 'degrees') => void

const DEG = Math.PI / 180
const TO_DEG = 180 / Math.PI
const TWO_PI = 2 * Math.PI
const HALF_PI = Math.PI / 2
// Past this magnitude the k-of-the-period arithmetic is not trusted: the twin
// answers the function's whole range.
const LARGE = 2 ** 20

const ONE = iv(1, 1)
const DEG_IV = iv(DEG, DEG)
const TO_DEG_IV = iv(TO_DEG, TO_DEG)
const SCRATCH_A = iv()
const SCRATCH_B = iv()

// The argument in radians: the input itself, or input · pi/180 under degrees.
function radians(a: Iv, angle: 'radians' | 'degrees', into: Iv): Iv {
  return angle === 'degrees' ? mul(into, a, DEG_IV) : a
}

// Whether some phase + k·period lies in [lo, hi]. Generous: a near miss counts,
// which only widens the answer, never narrows it.
function hits(lo: number, hi: number, phase: number, period: number): boolean {
  const k = Math.ceil((lo - phase) / period - 1e-9)
  return phase + k * period <= hi + 1e-9 * Math.max(1, Math.abs(hi))
}

function mono(out: Iv, a: Iv, f: (x: number) => number, increasing: boolean, v: Verdict = a.v): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const x = f(a.lo)
  const y = f(a.hi)
  return set(out, down(increasing ? x : y, LIB), up(increasing ? y : x, LIB), v)
}

// a clipped to [min, max]; a part outside the domain makes the result partial.
function clip(a: Iv, min: number, max: number, into: Iv): Iv {
  if (isEmpty(a) || a.hi < min || a.lo > max) return setEmpty(into)
  const outside = a.lo < min || a.hi > max
  return set(into, Math.max(a.lo, min), Math.min(a.hi, max), outside ? worst(a.v, PARTIAL) : a.v)
}

function sinRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (!(a.hi - a.lo < TWO_PI) || Math.abs(a.lo) > LARGE || Math.abs(a.hi) > LARGE) return set(out, -1, 1, a.v)
  let lo = Math.min(Math.sin(a.lo), Math.sin(a.hi))
  let hi = Math.max(Math.sin(a.lo), Math.sin(a.hi))
  if (hits(a.lo, a.hi, HALF_PI, TWO_PI)) hi = 1
  if (hits(a.lo, a.hi, -HALF_PI, TWO_PI)) lo = -1
  return set(out, Math.max(-1, down(lo, LIB)), Math.min(1, up(hi, LIB)), a.v)
}

function cosRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (!(a.hi - a.lo < TWO_PI) || Math.abs(a.lo) > LARGE || Math.abs(a.hi) > LARGE) return set(out, -1, 1, a.v)
  let lo = Math.min(Math.cos(a.lo), Math.cos(a.hi))
  let hi = Math.max(Math.cos(a.lo), Math.cos(a.hi))
  if (hits(a.lo, a.hi, 0, TWO_PI)) hi = 1
  if (hits(a.lo, a.hi, Math.PI, TWO_PI)) lo = -1
  return set(out, Math.max(-1, down(lo, LIB)), Math.min(1, up(hi, LIB)), a.v)
}

function tanRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (!(a.hi - a.lo < Math.PI) || Math.abs(a.lo) > LARGE || Math.abs(a.hi) > LARGE || hits(a.lo, a.hi, HALF_PI, Math.PI)) {
    return set(out, -Infinity, Infinity, worst(a.v, PARTIAL))
  }
  return mono(out, a, Math.tan, true)
}

export const sinT: Twin = (out, [a], angle) => void sinRad(out, radians(a, angle, SCRATCH_A))
export const cosT: Twin = (out, [a], angle) => void cosRad(out, radians(a, angle, SCRATCH_A))
export const tanT: Twin = (out, [a], angle) => void tanRad(out, radians(a, angle, SCRATCH_A))
// sec = 1/cos, csc = 1/sin: partial exactly where the divisor reaches zero.
export const secT: Twin = (out, [a], angle) => void div(out, ONE, cosRad(SCRATCH_B, radians(a, angle, SCRATCH_A)))
export const cscT: Twin = (out, [a], angle) => void div(out, ONE, sinRad(SCRATCH_B, radians(a, angle, SCRATCH_A)))
// cot = cos/sin (the scalar is 1/tan; the quotient's widening covers the
// difference), so it is partial only at multiples of pi, not at tan's poles.
export const cotT: Twin = (out, [a], angle) => {
  const r = radians(a, angle, SCRATCH_A)
  const c = cosRad(iv(), r)
  const s = sinRad(SCRATCH_B, r)
  div(out, c, s)
}

function toDegrees(out: Iv, angle: 'radians' | 'degrees'): void {
  if (angle === 'degrees') mul(out, out, TO_DEG_IV)
}

export const asinT: Twin = (out, [a], angle) => {
  mono(out, clip(a, -1, 1, SCRATCH_A), Math.asin, true)
  toDegrees(out, angle)
}
export const acosT: Twin = (out, [a], angle) => {
  mono(out, clip(a, -1, 1, SCRATCH_A), Math.acos, false)
  toDegrees(out, angle)
}
export const atanT: Twin = (out, [a], angle) => {
  mono(out, a, Math.atan, true)
  toDegrees(out, angle)
}

// atan2(y, x): continuous on a box that avoids the origin and the negative
// x-axis, where the corners bound it; across the cut or the origin it is
// defined (JavaScript gives a value everywhere) but may jump.
export const atan2T: Twin = (out, [y, x], angle) => {
  if (isEmpty(y) || isEmpty(x)) {
    setEmpty(out)
    return
  }
  const v = worst(y.v, x.v)
  const yZero = y.lo <= 0 && 0 <= y.hi
  if (yZero && x.lo <= 0) {
    set(out, -Math.PI, Math.PI, worst(v, DEFINED))
  } else {
    const c = [Math.atan2(y.lo, x.lo), Math.atan2(y.lo, x.hi), Math.atan2(y.hi, x.lo), Math.atan2(y.hi, x.hi)]
    set(out, Math.max(-Math.PI, down(Math.min(...c), LIB)), Math.min(Math.PI, up(Math.max(...c), LIB)), v)
  }
  toDegrees(out, angle)
}

export const sinhT: Twin = (out, [a]) => void mono(out, a, Math.sinh, true)
export const tanhT: Twin = (out, [a]) => void mono(out, a, Math.tanh, true)
export const asinhT: Twin = (out, [a]) => void mono(out, a, Math.asinh, true)
export const coshT: Twin = (out, [a]) => void sides(out, a, Math.cosh, 1)
export const acoshT: Twin = (out, [a]) => void mono(out, clip(a, 1, Infinity, SCRATCH_A), Math.acosh, true)
// atanh is infinite at ±1: those ends are poles.
export const atanhT: Twin = (out, [a]) => {
  const c = clip(a, -1, 1, SCRATCH_A)
  mono(out, c, Math.atanh, true, a.lo <= -1 || a.hi >= 1 ? worst(c.v, PARTIAL) : c.v)
}
export const sqrtT: Twin = (out, [a]) => void mono(out, clip(a, 0, Infinity, SCRATCH_A), Math.sqrt, true)
export const absT: Twin = (out, [a]) => void sides(out, a, Math.abs, 0)
export const expT: Twin = (out, [a]) => void mono(out, a, Math.exp, true)
export const cbrtT: Twin = (out, [a]) => void mono(out, a, Math.cbrt, true)

// ln(0) is -inf: a pole, so a box reaching 0 is partial; a box at or below 0
// is empty.
function logOf(out: Iv, a: Iv, f: (x: number) => number): Iv {
  if (isEmpty(a) || a.hi <= 0) return setEmpty(out)
  const v: Verdict = a.lo <= 0 ? worst(a.v, PARTIAL) : a.v
  return set(out, a.lo <= 0 ? -Infinity : down(f(a.lo), LIB), up(f(a.hi), LIB), v)
}

export const lnT: Twin = (out, [a]) => void logOf(out, a, Math.log)
// log(a) is base 10; log(a, b) is ln a / ln b (the scalar's own formula).
export const logT: Twin = (out, [a, b]) => {
  if (!b) {
    logOf(out, a, Math.log10)
    return
  }
  const la = logOf(iv(), a, Math.log)
  const lb = logOf(iv(), b, Math.log)
  div(out, la, lb)
}

// root(n, x) for a whole, nonzero n given as a single value; anything else has
// no cheap enclosure.
export const rootT: Twin = (out, [n, x]) => {
  if (isEmpty(n) || isEmpty(x)) {
    setEmpty(out)
    return
  }
  if (n.lo !== n.hi || !Number.isInteger(n.lo)) {
    set(out, -Infinity, Infinity, 0)
    return
  }
  const k = n.lo
  if (k === 0) {
    setEmpty(out)
    return
  }
  const m = Math.abs(k)
  const r = m % 2 === 1 ? mono(iv(), x, (v) => (v < 0 ? -Math.pow(-v, 1 / m) : Math.pow(v, 1 / m)), true) : mono(iv(), clip(x, 0, Infinity, iv()), (v) => Math.pow(v, 1 / m), true)
  if (k < 0) div(out, ONE, r)
  else set(out, r.lo, r.hi, r.v)
  out.v = worst(out.v, n.v)
}

export { CONTINUOUS }
```

Implementation notes (part of the requirement):
- `rootT` must enclose the scalar `root` exactly as `math/special.ts` computes it (it uses `Math.sqrt` for n = 2 and `Math.cbrt` for n = 3, `Math.pow(x, 1/n)` otherwise). The `LIB` widening covers the differences between those paths; the soundness sweep is the judge. If it finds a violation, mirror `special.ts`'s branches exactly.
- `set(out, …, 0)` in `rootT` is `UNKNOWN`; write it with the `UNKNOWN` constant (import it) rather than the literal.
- Remove the stray `export { CONTINUOUS }` if unused.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/math/interval/elementary.test.ts`
Expected: PASS. A soundness violation names the box and point: fix the twin, never `admits`.

- [ ] **Step 5: Run everything that must not move**

Suite (alone, `--maxWorkers=3`), both typechecks, oxlint, sweep.

- [ ] **Step 6: Commit**

```bash
git add src/math/interval/elementary.ts src/math/interval/elementary.test.ts
git commit -m "feat(math): interval twins of the elementary built-ins — trig with degrees, inverse trig, hyperbolic, exp/log, roots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space with the sweep result.

---

### Task 3: Stepwise and special twins, and the registry triple

**Files:**
- Create: `graph-engine/src/math/interval/stepwise.ts`
- Create: `graph-engine/src/math/interval/special.ts`
- Create: `graph-engine/src/math/registry.ts`
- Create: `graph-engine/src/math/interval/stepwise.test.ts`, `graph-engine/src/math/interval/special.test.ts`, `graph-engine/src/math/registry.test.ts`

**Interfaces:**
- Consumes: `Twin` from `elementary.ts`; `core.ts`; `arith.ts`; `math/special.ts` (`gamma`, `erf`, `erfc`, `choose`, `perm`, `gcd`, `lcm`, `step`); `floorMod`, `roundHalfAway`, `BUILTIN_NAMES` from `math/compile.ts`; `diff` from `math/diff.ts`.
- Produces: `stepwise.ts` — `floorT, ceilT, roundT, signT, stepT, modT, minT, maxT, hypotT`; `special.ts` — `gammaT, erfT, erfcT, chooseT, permT, gcdT, lcmT`, `gammaOf(out, a)` (used by Task 4's `__factorial`); `registry.ts` — `interface BuiltinEntry { readonly twin: Twin; readonly derivative: 'rule' | 'refuses' }`, `BUILTIN_REGISTRY: ReadonlyMap<string, BuiltinEntry>`.

- [ ] **Step 1: Write `stepwise.ts`**

```ts
// Interval twins of the piecewise-constant and order built-ins (calc P1b).
// floor, ceil, round, sign and step are non-decreasing and integer-valued: the
// ends bound them exactly, and the box is CONTINUOUS only when both ends give
// the same value (no jump inside), DEFINED otherwise.

import { floorMod, roundHalfAway } from '../compile'
import { step } from '../special'
import { CONTINUOUS, DEFINED, down, isEmpty, type Iv, iv, set, setEmpty, up, type Verdict, worst } from './core'
import { div, mul, sub } from './arith'
import type { Twin } from './elementary'

function stepwise(out: Iv, a: Iv, f: (x: number) => number): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const x = f(a.lo)
  const y = f(a.hi)
  return set(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED))
}

export const floorT: Twin = (out, [a]) => void stepwise(out, a, Math.floor)
export const ceilT: Twin = (out, [a]) => void stepwise(out, a, Math.ceil)
export const roundT: Twin = (out, [a]) => void stepwise(out, a, roundHalfAway)
export const signT: Twin = (out, [a]) => void stepwise(out, a, Math.sign)
export const stepT: Twin = (out, [a]) => void stepwise(out, a, step)

// mod(a, b) = a - b·floor(a/b), composed from the twins (sound; the dependency
// between the a's widens it).
export const modT: Twin = (out, [a, b]) => {
  const q = div(iv(), a, b)
  const f = stepwise(iv(), q, Math.floor)
  const t = mul(iv(), b, f)
  sub(out, a, t)
  void floorMod
}

export const minT: Twin = (out, args) => {
  if (args.some(isEmpty)) {
    setEmpty(out)
    return
  }
  let lo = Infinity
  let hi = Infinity
  let v: Verdict = CONTINUOUS
  for (const a of args) {
    lo = Math.min(lo, a.lo)
    hi = Math.min(hi, a.hi)
    v = worst(v, a.v)
  }
  set(out, lo, hi, v)
}

export const maxT: Twin = (out, args) => {
  if (args.some(isEmpty)) {
    setEmpty(out)
    return
  }
  let lo = -Infinity
  let hi = -Infinity
  let v: Verdict = CONTINUOUS
  for (const a of args) {
    lo = Math.max(lo, a.lo)
    hi = Math.max(hi, a.hi)
    v = worst(v, a.v)
  }
  set(out, lo, hi, v)
}

// hypot is non-decreasing in each |argument|.
export const hypotT: Twin = (out, args) => {
  if (args.some(isEmpty)) {
    setEmpty(out)
    return
  }
  const smallest = args.map((a) => (a.lo <= 0 && 0 <= a.hi ? 0 : Math.min(Math.abs(a.lo), Math.abs(a.hi))))
  const largest = args.map((a) => Math.max(Math.abs(a.lo), Math.abs(a.hi)))
  let v: Verdict = CONTINUOUS
  for (const a of args) v = worst(v, a.v)
  set(out, down(Math.hypot(...smallest)), up(Math.hypot(...largest)), v)
}
```

Remove the `void floorMod` line and its import if nothing needs it; it is only there to remind that `modT` must match the scalar `floorMod(a, b) = a - b·floor(a/b)`.

- [ ] **Step 2: Write `special.ts`**

```ts
// Interval twins of gamma, erf, erfc and the integer functions (calc P1b).
// gamma: poles at 0 and the negative integers; on (0, inf) it falls to its
// minimum at x0 ≈ 1.4616 then rises; below 0 the reflection formula
// Γ(x) = π / (sin(πx) Γ(1 − x)) is evaluated with the interval arithmetic.
// gamma's bounds are widened by a relative 1e-13 (Lanczos is ~1e-15, the
// reflection adds error).

import { choose, erf, erfc, gamma, gcd, lcm, perm } from '../special'
import { CONTINUOUS, down, isEmpty, type Iv, iv, LIB, PARTIAL, set, setEmpty, setPoint, UNKNOWN, up, type Verdict, worst } from './core'
import { div, mul, sub } from './arith'
import { sinT, type Twin } from './elementary'

const G_REL = 1e-13
const X0 = 1.4616321449683623
const GMIN = 0.8856031944108887
const PI_IV = iv(Math.PI, Math.PI)
const ONE = iv(1, 1)

function gammaPositive(out: Iv, lo: number, hi: number, v: Verdict): Iv {
  const glo = gamma(lo)
  const ghi = gamma(hi)
  let a: number
  let b: number
  if (lo <= X0 && X0 <= hi) {
    a = GMIN
    b = Math.max(glo, ghi)
  } else if (hi < X0) {
    a = ghi
    b = glo
  } else {
    a = glo
    b = ghi
  }
  const vv = Number.isFinite(b) ? v : worst(v, PARTIAL)
  return set(out, down(a, G_REL), up(b, G_REL), vv)
}

export function gammaOf(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  // A pole is any whole k <= 0 in the box.
  if (a.lo <= 0 && Math.ceil(a.lo) <= Math.min(Math.floor(a.hi), 0)) return set(out, -Infinity, Infinity, worst(a.v, PARTIAL))
  if (a.lo > 0) return gammaPositive(out, a.lo, a.hi, a.v)
  // Strictly between two poles, below 0: the reflection.
  const s = iv()
  sinT(s, [mul(iv(), a, PI_IV)], 'radians')
  const oneMinus = sub(iv(), ONE, a)
  const g = gammaPositive(iv(), oneMinus.lo, oneMinus.hi, oneMinus.v)
  const r = div(out, PI_IV, mul(iv(), s, g))
  return set(out, down(r.lo, G_REL), up(r.hi, G_REL), r.v)
}

export const gammaT: Twin = (out, [a]) => void gammaOf(out, a)

function mono(out: Iv, a: Iv, f: (x: number) => number, increasing: boolean): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const x = f(a.lo)
  const y = f(a.hi)
  return set(out, down(increasing ? x : y, LIB), up(increasing ? y : x, LIB), a.v)
}

export const erfT: Twin = (out, [a]) => void mono(out, a, erf, true)
export const erfcT: Twin = (out, [a]) => void mono(out, a, erfc, false)

// The integer functions on single values are exact; on any wider box no cheap
// enclosure is attempted.
function pointsOnly(f: (a: number, b: number) => number): Twin {
  return (out, [a, b]) => {
    if (isEmpty(a) || isEmpty(b)) {
      setEmpty(out)
      return
    }
    if (a.lo !== a.hi || b.lo !== b.hi) {
      set(out, -Infinity, Infinity, UNKNOWN)
      return
    }
    setPoint(out, f(a.lo, b.lo))
    if (!isEmpty(out)) out.v = worst(worst(a.v, b.v), Number.isFinite(out.lo) ? CONTINUOUS : PARTIAL)
  }
}

export const chooseT = pointsOnly(choose)
export const permT = pointsOnly(perm)
export const gcdT = pointsOnly(gcd)
export const lcmT = pointsOnly(lcm)
```

- [ ] **Step 3: Write `registry.ts`**

```ts
// The built-in registry (calc P1b; spec "One rule that keeps the kernel
// lasting"). A built-in exists only as a triple: its scalar implementation
// (math/compile.ts's BUILTINS, on both compile paths), its interval twin, and
// its derivative class in math/diff.ts — an exact rule, or a refusal. The
// registry tests fail if any built-in is missing a member, so a built-in added
// later arrives sampled, certified and differentiable.

import type { Twin } from './interval/elementary'
import * as E from './interval/elementary'
import * as S from './interval/stepwise'
import * as X from './interval/special'

export interface BuiltinEntry {
  readonly twin: Twin
  // 'rule': diff differentiates it exactly. 'refuses': diff throws a
  // CompileError when an argument depends on the variable.
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
```

Check every name against `BUILTIN_NAMES` in `math/compile.ts`; the registry test (Step 4) enforces equality, so add or correct entries until it passes. `step`'s derivative is a rule (0 where it exists, NaN at 0); `root`'s is a rule (it refuses only when the index depends on the variable — the test treats an index-dependent call as a refusal case, see below).

- [ ] **Step 4: Write the failing tests**

`graph-engine/src/math/interval/stepwise.test.ts` and `graph-engine/src/math/interval/special.test.ts` follow `elementary.test.ts`'s pattern: tightness/verdict cases, then a 500-box soundness sweep per twin against `compileScalar(p('<name>(x)'), …)` (two-argument twins over box pairs, as in Task 2). Required tightness/verdict cases:

```ts
// stepwise.test.ts
expect(run1(S.floorT, 0.2, 0.8)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
expect(run1(S.floorT, 0.5, 1)).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
expect(run1(S.ceilT, 0.5, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
expect(run1(S.stepT, 0, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
expect(run1(S.stepT, -1, 0)).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
expect(run1(S.signT, -1, 1).v).toBe(DEFINED)
// mod(x, 3) over [1, 2] is x itself, continuous; over [2, 4] it jumps at 3
// min/max/hypot over simple boxes: exact componentwise bounds

// special.test.ts
expect(run1(X.gammaT, -0.5, 0.5).v).toBe(PARTIAL)            // pole at 0
expect(run1(X.gammaT, -3, -2.5).v).toBe(PARTIAL)             // pole at -3 (an end)
const g = run1(X.gammaT, 1, 3)                                // min inside: [GMIN, 2]
expect(g.v === CONTINUOUS && Math.abs(g.lo - 0.8856031944108887) < 1e-12 && Math.abs(g.hi - 2) < 1e-12).toBe(true)
const neg = run1(X.gammaT, -0.9, -0.1)                        // reflection branch, continuous, negative
expect(neg.v === CONTINUOUS && neg.hi < 0).toBe(true)
// erf over [0, 1] is [0, erf(1)]; erfc over [0, 1] is [erfc(1), 1]
// choose over a single point is that value; over a wider box UNKNOWN
```

`graph-engine/src/math/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExprString as p } from '../parser/parseExpr'
import { BUILTIN_NAMES, builtinArity, CompileError, compileScalar } from './compile'
import { diff } from './diff'
import { call, variable } from './expr'
import { BUILTIN_REGISTRY } from './registry'
import { makeScope } from './scope'
import { simplify } from './simplify'
import { mulberry32 } from './interval/testkit'

describe('the registry triple', () => {
  it('names exactly the built-ins, each with a twin', () => {
    expect([...BUILTIN_REGISTRY.keys()].sort()).toEqual([...BUILTIN_NAMES].sort())
    for (const [name, entry] of BUILTIN_REGISTRY) expect(typeof entry.twin, name).toBe('function')
  })

  // Each argument position is differentiated in turn, the others held at
  // constants; 'refuses' throws a CompileError, 'rule' agrees with a central
  // difference wherever the function is smooth there.
  const scope = makeScope()
  const rand = mulberry32(4242)
  for (const name of [...BUILTIN_NAMES].sort()) {
    it(`${name}: its derivative class holds`, () => {
      const entry = BUILTIN_REGISTRY.get(name)!
      const { min } = builtinArity(name)!
      const arity = Math.max(min, 1)
      const constants = [0.7, 2, 3].slice(0, arity)
      for (let position = 0; position < arity; position++) {
        const args = constants.map((c, i) => (i === position ? variable('x') : p(String(c))))
        // root's index and the integer functions take whole numbers there.
        if (name === 'root' && position === 0) {
          expect(() => diff(call(name, ...args), 'x', scope)).toThrow(CompileError)
          continue
        }
        const expr = call(name, ...args)
        if (entry.derivative === 'refuses') {
          expect(() => diff(expr, 'x', scope), `${name} position ${position}`).toThrow(CompileError)
          continue
        }
        const f = compileScalar(expr, ['x'], scope)
        const d = compileScalar(simplify(diff(expr, 'x', scope)), ['x'], scope)
        let checked = 0
        for (let i = 0; i < 200 && checked < 20; i++) {
          const x = (rand() * 2 - 1) * 3
          const h = 1e-6 * Math.max(1, Math.abs(x))
          const fd = (f(x + h) - f(x - h)) / (2 * h)
          const second = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
          // skip points where f is undefined, jumps, or bends too sharply for
          // a central difference to judge
          if (![f(x - h), f(x), f(x + h), d(x)].every(Number.isFinite) || Math.abs(second) * h > 1e-3 * Math.max(1, Math.abs(fd))) continue
          expect(Math.abs(d(x) - fd), `${name}'(${x}) = ${d(x)} vs ${fd}`).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(fd)))
          checked++
        }
        expect(checked, `${name}: too few smooth points to judge`).toBeGreaterThan(0)
      }
    })
  }
})
```

If a built-in has no smooth points under these constants (for example a stepwise function whose central difference is always 0 — that still counts as smooth: f′ = 0 = the rule), adjust the constants for that built-in only, with a comment; never skip a built-in.

- [ ] **Step 5: Run them to verify they fail, then implement until they pass**

Run: `npx vitest run src/math/interval/ src/math/registry.test.ts`
Expected first: FAIL (missing modules). Then PASS. A soundness violation names box and point — fix the twin.

- [ ] **Step 6: Run everything that must not move**

Suite (alone, `--maxWorkers=3`), both typechecks, oxlint, sweep.

- [ ] **Step 7: Commit**

```bash
git add src/math/interval/stepwise.ts src/math/interval/special.ts src/math/registry.ts src/math/interval/stepwise.test.ts src/math/interval/special.test.ts src/math/registry.test.ts
git commit -m "feat(math): stepwise and special interval twins, and the registry that holds every built-in to its triple

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space — the registry exists; a built-in space adds later must join it (twin + derivative class) or the registry test fails.

---

### Task 4: The interval compiler

**Files:**
- Create: `graph-engine/src/math/interval/compile.ts`
- Create: `graph-engine/src/math/interval/index.ts` (the public surface)
- Create: `graph-engine/src/math/interval/compile.test.ts`
- Modify: `graph-engine/src/math/compile.ts` (export `namesValue`'s logic as `namesValueIn(name, bound: ReadonlySet<string>, scope)`; no behaviour change)
- Modify: `docs/superpowers/specs/2026-10-01-calc-proofing-design.md` (three wording corrections, Step 6)

**Interfaces:**
- Consumes: everything above; `compileScalar`, `builtinShadowError` from `math/compile.ts`; `isReserved`, `comparisonOp`, `BINDERS`, `MAX_TERMS`, `nameArgument` from `math/reserved.ts`; `primeFunction`, `derivativeFunction` from `math/prime.ts`; `oddRootExponent` from `math/rational.ts`; `BUILTIN_REGISTRY` from `math/registry.ts`; `gammaOf` from `interval/special.ts`.
- Produces: `compileInterval(expr: Expr, vars: readonly string[], scope: MathScope): CompiledInterval`, with `type CompiledInterval = (out: Iv, xLo?: number, xHi?: number, yLo?: number, yHi?: number, zLo?: number, zHi?: number) => Iv`. `math/interval/index.ts` re-exports `compileInterval`, `CompiledInterval`, `Iv`, `iv`, `Verdict`, `UNKNOWN`, `PARTIAL`, `DEFINED`, `CONTINUOUS`.

**Design (binding):**
- `compileInterval` first calls `compileScalar(expr, vars, scope)`, discarding the result, so every compile error is exactly the scalar compile's. It then builds a tree of nodes `{ out: Iv; run: () => void }` allocated once: a node's `run` evaluates its children and writes its own `out`. Evaluation allocates nothing.
- **Names resolve exactly as `math/compile.ts`'s `compileVar`/`compileCall`** (read them): a bound variable, a parameter (a single value read from `scope.params.values` at call time; NaN gives empty), a user constant (its body inlined with no bound variables, as compile does), `pi`, `e`, `inf` (single values). Calls: reserved name → the reserved twin; `builtinShadowError` → throw it (unreachable after validation, mirrored for clarity); a user function other than a constant called with one argument → inlined (its parameters alias the argument nodes' outputs; the argument nodes run first); a built-in → its registry twin (arguments run first, then `twin(out, argOuts, scope.angle)`); a value name called with one argument → `mul` of the value and the argument.
- `^`: when `oddRootExponent(expr.right)` is non-null → `powOddRoot(out, base, exponent.lo, pOdd)` (the exponent node is a single value at run time); otherwise `powGeneral`.
- **Reserved:**
  - comparisons → a truth interval: `[1, 1]` when decided true, `[0, 0]` when decided false, `[0, 1]` otherwise; verdict `CONTINUOUS` when decided, `DEFINED` when not, and never better than the operands' verdicts. Decisions use the widened bounds (only ever more cautious). `<`: true when `a.hi < b.lo`, false when `a.lo >= b.hi`. `<=`: true when `a.hi <= b.lo`, false when `a.lo > b.hi`. `>`/`>=` mirror. `=`: true when all four bounds are equal, false when the boxes don't overlap. `!=`: the negation of `=`.
  - `__and`/`__or`/`__not` on truth intervals: a value is *surely true* when `lo > 0 || hi < 0`, *surely false* when `lo === 0 && hi === 0`, else unsure. `and` is surely true when both are, surely false when either is; `or` dually; `not` swaps. Unsure gives `[0, 1]` with `DEFINED`.
  - `__piecewise(c1, v1, …[, o])`: walk the pieces in order with an accumulator that starts empty and `CONTINUOUS`. A condition that is surely false contributes nothing. A surely-true condition contributes its value (hull) and ends the walk. An unsure condition contributes its value, makes the result at most `DEFINED` (it may jump) and the walk continues. If the walk never met a surely-true piece, the otherwise contributes (hull), or — with no otherwise — the result is at most `PARTIAL` (somewhere no piece holds). Every condition's verdict below `CONTINUOUS` (a partial condition) also bounds the result's verdict.
  - `__factorial` → `gammaOf(add(a, [1, 1]))`.
  - `__prime` → inline `derivativeFunction(name, fn, order, scope)` like a user function.
  - `__sum`/`__prod`: run the bound nodes; when both are single safe integers and the count is within the budget, iterate with the bound variable set to `[i, i]` (`CONTINUOUS`), accumulating with `add`/`mul` from `[0, 0]` / `[1, 1]`; otherwise `UNKNOWN`. The budget is a module-level counter reset by the compiled function at each call; each loop adds its term count before iterating; past `MAX_TERMS` the loop answers `UNKNOWN`.
  - `__integral` → `UNKNOWN` (bounds `[-inf, inf]`).
- Degrees reach the twins through `scope.angle`.

- [ ] **Step 1: Export the value-name rule from compile.ts**

In `math/compile.ts`, add (beside `namesValue`, which keeps its current body and callers):

```ts
// namesValue for a caller that tracks bound names as a set (the interval
// compiler, math/interval/compile.ts).
export function namesValueIn(name: string, bound: ReadonlySet<string>, scope: MathScope): boolean {
  if (bound.has(name) || scope.params.index.has(name)) return true
  const fn = scope.functions.get(name)
  if (fn) return fn.params.length === 0
  return name === 'pi' || name === 'e' || name === 'inf'
}
```

- [ ] **Step 2: Write the failing tests**

Create `graph-engine/src/math/interval/compile.test.ts` with:

1. **Errors mirror compile:** `compileInterval(p('q(x)'), ['x'], scope)` throws `Unknown function "q"`; `compileInterval(p('xy'), ['x', 'y'], scope)` throws the `did you mean x*y?` CompileError.
2. **Tightness and verdicts** (each a written case): `x^2 - 1` over `[-1, 2]` → `[-1, 3]` within 1e-12, `CONTINUOUS`; `1/x` over `[-1, 1]` → `PARTIAL`; `sqrt(x - 1)` over `[0, 2]` → `PARTIAL`, bounds `[0, 1]`; `x^(1/3)` over `[-8, 8]` → `[-2, 2]`, `CONTINUOUS`; `x^(2/3)` over `[-8, 1]` → `[0, 4]`; under `@angle: degrees` `sin(x)` over `[0, 90]` → `[0, 1]`; a parameter `a = 2` in `a x` over `[1, 2]` → `[2, 4]`; a user function `f(t) = t^2` in `f(x + 1)` over `[0, 1]` → `[1, 4]`; a user constant `k = 3` in `k(x + 1)` (a product) over `[0, 1]` → `[3, 6]`.
3. **Reserved:** `{x < 0: -1, 1}` over `[1, 2]` → `[1, 1]` `CONTINUOUS`; over `[-1, 1]` → `[-1, 1]` `DEFINED`; `{x < 0: -1}` over `[-1, 1]` → at most `PARTIAL`; `x < 2 and x > 0` over `[0.5, 1]` → `[1, 1]` `CONTINUOUS`; `x!` over `[1, 3]` → `[GMIN, 6]`-ish, `CONTINUOUS`; `sum(k = 1 to 3, k x)` over `[0, 1]` → `[0, 6]` `CONTINUOUS`; `sum(k = 1 to n, 1)` with `@param n = 2.5` → `UNKNOWN`; `integral(t = 0 to x, t)` over `[0, 1]` → `UNKNOWN`; `f'(x)` with `f(t) = t^3` over `[1, 2]` → `[3, 12]`.
4. **Soundness over composite expressions** — for each expression in this list, 300 random boxes (1-variable expressions; for `x`/`y` expressions, box pairs), each checked at interior points against `compileScalar` with `admits`:
   `x^3 - 2x + 1`, `(x^2 - 1)/(x - 1)`, `sin(x)/x`, `tan(x) + sec(x)`, `ln(x^2 - 4)`, `sqrt(1 - x^2)`, `x^(1/3) - x^(2/3)`, `floor(x) + x`, `abs(x - 2) * sign(x)`, `gamma(x) * erf(x)`, `{x < 0: x^2, x <= 2: 2x + 1, 5}`, `{x < -1 or x > 1: 1/x, 0}`, `sum(k = 0 to 6, x^k / k!)`, `step(x) * exp(-x)`, `atan2(x, x^2 - 1)`, `mod(x, 3)`, `x y - sin(x + y)`, `x^2 + y^2 - 4`, `hypot(x, y) - 1`, `max(x, y) - min(x, y)`; plus a scope with `f(t) = t^2 + 1`, `g(t, u) = t u`, `a = 2` (`@param`) and `k = 3` (constant) for `f(g(x, a)) - k(x + 1)`, and `f'(x) * x`. Use `mulberry32` with a fixed seed.
5. **No allocation per call** is not tested directly; the code review checks it.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/math/interval/compile.test.ts`
Expected: FAIL — `Cannot find module './compile'`.

- [ ] **Step 4: Write `math/interval/compile.ts` and `math/interval/index.ts`**

Implement the design above. Shape:

```ts
// Compiles an Expr to its interval twin (calc P1b): closures over decorated
// intervals that enclose every value math/compile.ts's compileScalar can give
// over an input box, with a verdict. Names resolve exactly as compileScalar's
// do; compileScalar runs first, so the compile errors are its own. Nodes are
// allocated once; evaluation allocates nothing.

import type { Expr } from '../../parser/types'
import { builtinShadowError, compileScalar, namesValueIn } from '../compile'
import { derivativeFunction, primeFunction } from '../prime'
import { oddRootExponent } from '../rational'
import { BUILTIN_REGISTRY } from '../registry'
import { BINDERS, comparisonOp, isReserved, MAX_TERMS, nameArgument } from '../reserved'
import { isVectorBody, type MathFunction, type MathScope } from '../scope'
import { add, div, mul, neg, powGeneral, powOddRoot, sub } from './arith'
import { CONTINUOUS, copy, DEFINED, hull, isEmpty, type Iv, iv, PARTIAL, set, setBox, setEmpty, setPoint, setUnknown, UNKNOWN, worst } from './core'
import { gammaOf } from './special'

export type CompiledInterval = (out: Iv, xLo?: number, xHi?: number, yLo?: number, yHi?: number, zLo?: number, zHi?: number) => Iv

interface INode {
  readonly out: Iv
  readonly run: () => void
}

const NOOP = () => {}
const leaf = (out: Iv): INode => ({ out, run: NOOP })

// The loop budget for one top-level evaluation (shared by nested loops).
const budget = { used: 0 }

interface Ctx {
  scope: MathScope
}

type Env = ReadonlyMap<string, Iv>

function node(expr: Expr, env: Env, ctx: Ctx): INode { /* switch on expr.kind */ }
// … varNode, callNode, reservedNode, loopNode, piecewiseNode, compareNode, logicNode, inline(fn, argNodes, ctx) …

export function compileInterval(expr: Expr, vars: readonly string[], scope: MathScope): CompiledInterval {
  compileScalar(expr, vars, scope) // the same compile errors, thrown here
  if (vars.length > 3) throw new Error(`An interval twin takes at most three variables, got ${vars.length}`)
  const inputs = vars.map(() => iv())
  const env = new Map(vars.map((v, i) => [v, inputs[i]] as const))
  const root = node(expr, env, { scope })
  return (out, xLo = 0, xHi = 0, yLo = 0, yHi = 0, zLo = 0, zHi = 0) => {
    budget.used = 0
    if (inputs[0]) setBox(inputs[0], xLo, xHi)
    if (inputs[1]) setBox(inputs[1], yLo, yHi)
    if (inputs[2]) setBox(inputs[2], zLo, zHi)
    root.run()
    return copy(out, root.out)
  }
}
```

Write every function in full (each node allocates its `out` with `iv()` at compile time; its `run` calls children's `run` first). Follow `math/compile.ts`'s `compileCall` order exactly for calls (read it before writing). A user function's inlining maps each parameter to the argument node's `out` (the argument nodes run before the body); a constant's body is compiled with an empty env, like compile's `inlineBody(name, fn, [], ctx)`. A vector-valued function never reaches here (validation refuses it).

`index.ts`:

```ts
export { compileInterval, type CompiledInterval } from './compile'
export { CONTINUOUS, DEFINED, iv, type Iv, PARTIAL, UNKNOWN, type Verdict } from './core'
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/math/interval/`
Expected: PASS.

- [ ] **Step 6: Correct the spec's wording**

In `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`, under "The interval twin":
- "`math/interval.ts` compiles the same expression tree" → "`math/interval/` (core, arithmetic, one file per twin family, and the compiler) compiles the same expression tree";
- "`integral` returns `unknown` with sampled bounds" → "`integral` returns `unknown` with bounds `[-inf, inf]` (sampled bounds are not an enclosure, and P3's culling relies on enclosures)";
- "Every arithmetic result is widened outward by 2 ulps per bound" → "Every bound is widened outward — 2 ulps for IEEE arithmetic, 4 for a library function, a relative 1e-13 for gamma and what is built on it".

- [ ] **Step 7: Run everything that must not move**

Suite (alone, `--maxWorkers=3`), both typechecks, oxlint, sweep.

- [ ] **Step 8: Commit**

```bash
git add src/math/interval/compile.ts src/math/interval/index.ts src/math/interval/compile.test.ts src/math/compile.ts ../docs/superpowers/specs/2026-10-01-calc-proofing-design.md
git commit -m "feat(math): the interval compiler — every built-in and reserved construct, names resolved as compile resolves them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Controller step:** message space — `compileInterval` exists (opt-in for space; never assumed), the new `namesValueIn` export, the sweep result.
