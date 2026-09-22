# Graph Engine v2 Track 1 — Reading the Graph

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 2D graph readable — feature points derived from the statement's own math instead of scanned off sampled pixels, hover that snaps to exact values, axis labels controllable independently of axes, and tick steps that keep the author's chosen base when you zoom.

**Architecture:** Feature detection moves out of `detectFeaturePoints.ts` (which compares consecutive entries of a sampled array, and therefore emits noise for every marching-squares curve) into three focused modules: a numerical root-finder, an explicit-function feature pass built on it, and an analytic conic pass that recovers conic coefficients numerically and classifies them. Detected features become *typed* scene points carrying a `FeatureKind`, so an x-intercept, a local maximum and a plain plotted point render differently instead of as three identical dots. Grid and hover changes are local to `grid.ts` and `hover.ts`.

**Tech Stack:** TypeScript, React 19, three.js, Vitest (node environment). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 1 — Reading the graph", plus "What v1 got wrong" for the defects being fixed.

## Global Constraints

- **No new runtime dependencies.** Everything here is arithmetic and existing three.js.
- **`@points: intercepts` and `@points: vertices` must keep parsing.** Stored questions in the bank carry these, and `server/src/domain/questions.ts` validates `graph_spec` with this very parser — breaking them rejects existing content. They become aliases, never errors.
- **`resolveStep(fixed, worldSpan, targetDivisions)` keeps its existing 3-argument behaviour.** `graph-engine/src/render/grid.test.ts` pins it; the new mode parameter is optional and defaults to today's behaviour.
- **Determinism.** Same spec text in, same feature points out, every run. No randomness, no time dependence, no iteration-count-dependent output.
- **Geometric step rule is multiply-by-base:** base 8 → 8, 64, 512; base 10 → 10, 100, 1000; base 5 → 5, 25, 125.
- **Test command:** `npm run test --workspace=graph-engine` from the repo root. Single file: `npm run test --workspace=graph-engine -- src/path/to/file.test.ts`.
- **Every task ends with a commit.** Commit messages follow the repo's existing lowercase `type(scope): summary` style.

---

### Task 1: Config surface for the four new directives

**Files:**
- Modify: `graph-engine/src/parser/config.ts`
- Modify: `graph-engine/src/parser/parseConfig.ts:85-104` (the `points` case)
- Create: `graph-engine/src/parser/parseConfig.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type FeatureKind = 'x-intercept' | 'y-intercept' | 'local-max' | 'local-min' | 'inflection' | 'center' | 'focus' | 'conic-vertex' | 'intersection'`
  - `export type LabelMode = 'all' | 'coarse' | 'none'`
  - `export type StepMode = 'nice' | 'geometric' | 'fixed'`
  - `GraphConfig.points: Set<FeatureKind>` (was `Set<FeaturePointKind>`)
  - `GraphConfig.labels: LabelMode`, `GraphConfig.labelEvery: number`, `GraphConfig.stepMode: StepMode`, `GraphConfig.pointLabels: 'off' | 'coords'`

- [ ] **Step 1: Write the failing test**

Create `graph-engine/src/parser/parseConfig.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { parseConfigLine } from './parseConfig'

function parse(line: string) {
  const config = defaultConfig()
  parseConfigLine(line, config)
  return config
}

describe('@points', () => {
  it('accepts the new kind names', () => {
    expect(parse('@points: roots').points).toEqual(new Set(['x-intercept', 'y-intercept']))
    expect(parse('@points: extrema').points).toEqual(new Set(['local-max', 'local-min']))
    expect(parse('@points: inflections').points).toEqual(new Set(['inflection']))
    expect(parse('@points: intersections').points).toEqual(new Set(['intersection']))
  })

  it('accepts several groups at once', () => {
    expect(parse('@points: roots, extrema').points).toEqual(
      new Set(['x-intercept', 'y-intercept', 'local-max', 'local-min'])
    )
  })

  // Stored questions in the bank carry the v1 spelling, and the server
  // validates graph_spec with this parser — rejecting them would reject
  // existing content, so these stay accepted forever.
  it('keeps the v1 names working as aliases', () => {
    expect(parse('@points: intercepts').points).toEqual(new Set(['x-intercept', 'y-intercept']))
    expect(parse('@points: vertices').points).toEqual(new Set(['local-max', 'local-min']))
  })

  it('still handles none and all', () => {
    expect(parse('@points: none').points.size).toBe(0)
    expect(parse('@points: all').points.has('inflection')).toBe(true)
    expect(parse('@points: all').points.has('x-intercept')).toBe(true)
  })

  it('rejects an unknown kind by name', () => {
    expect(() => parse('@points: bananas')).toThrow(/bananas/)
  })
})

describe('@labels and @label-every', () => {
  it('parses the three label modes', () => {
    expect(parse('@labels: none').labels).toBe('none')
    expect(parse('@labels: coarse').labels).toBe('coarse')
    expect(parse('@labels: all').labels).toBe('all')
  })

  it('defaults to all', () => {
    expect(defaultConfig().labels).toBe('all')
  })

  it('parses a positive integer label interval', () => {
    expect(parse('@label-every: 5').labelEvery).toBe(5)
  })

  it('rejects a non-positive or fractional interval', () => {
    expect(() => parse('@label-every: 0')).toThrow()
    expect(() => parse('@label-every: 2.5')).toThrow()
  })
})

describe('@step-mode', () => {
  it('parses the three step modes', () => {
    expect(parse('@step-mode: nice').stepMode).toBe('nice')
    expect(parse('@step-mode: geometric').stepMode).toBe('geometric')
    expect(parse('@step-mode: fixed').stepMode).toBe('fixed')
  })

  it('defaults to nice', () => {
    expect(defaultConfig().stepMode).toBe('nice')
  })
})

describe('@point-labels', () => {
  it('parses off and coords', () => {
    expect(parse('@point-labels: coords').pointLabels).toBe('coords')
    expect(parse('@point-labels: off').pointLabels).toBe('off')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/parser/parseConfig.test.ts`
Expected: FAIL — `labels`, `labelEvery`, `stepMode`, `pointLabels` do not exist on `GraphConfig`, and `@points: roots` throws.

- [ ] **Step 3: Update the config types and defaults**

In `graph-engine/src/parser/config.ts`, replace the `FeaturePointKind` type and extend `GraphConfig`:

```typescript
// A detected feature carries which kind of feature it is, so the renderer can
// mark an x-intercept differently from a local maximum. v1 emitted every
// feature as an identical unlabeled dot, which is why "@points: intercepts"
// and "@points: vertices" looked like the same setting.
export type FeatureKind =
  | 'x-intercept'
  | 'y-intercept'
  | 'local-max'
  | 'local-min'
  | 'inflection'
  | 'center'
  | 'focus'
  | 'conic-vertex'
  | 'intersection'

// Back-compat alias: v1's name for the config value. Kept so existing imports
// and stored specs keep working.
export type FeaturePointKind = FeatureKind

export type LabelMode = 'all' | 'coarse' | 'none'
export type StepMode = 'nice' | 'geometric' | 'fixed'
```

Add to the `GraphConfig` interface:

```typescript
  points: Set<FeatureKind>
  // Tick-label density, independent of `axes`. v1 drew labels only when axes
  // were on, so "a graph with no numbers" was only reachable as "a graph with
  // no axes" — which is not the same picture.
  labels: LabelMode
  // Label every nth gridline. 1 labels every line.
  labelEvery: number
  // How a fixed @xstep/@ystep rescales as the view zooms. See grid.ts.
  stepMode: StepMode
  // Whether a detected feature point prints its coordinates.
  pointLabels: 'off' | 'coords'
```

And in `defaultConfig()`:

```typescript
    labels: 'all',
    labelEvery: 1,
    stepMode: 'nice',
    pointLabels: 'off',
```

- [ ] **Step 4: Parse the new directives**

In `graph-engine/src/parser/parseConfig.ts`, replace the whole `case 'points':` block with:

```typescript
    case 'points': {
      // Group names expand to the concrete kinds they cover. "intercepts" and
      // "vertices" are v1's spellings, kept as aliases because stored
      // questions carry them and the server validates graph_spec with this
      // parser.
      const GROUPS: Record<string, FeatureKind[]> = {
        roots: ['x-intercept', 'y-intercept'],
        intercepts: ['x-intercept', 'y-intercept'],
        extrema: ['local-max', 'local-min'],
        vertices: ['local-max', 'local-min'],
        inflections: ['inflection'],
        intersections: ['intersection'],
        conic: ['center', 'focus', 'conic-vertex'],
      }
      const names = value.split(',').map((v) => v.trim())
      if (names.length === 1 && names[0] === 'none') {
        config.points = new Set()
        return
      }
      if (names.length === 1 && names[0] === 'all') {
        config.points = new Set<FeatureKind>(Object.values(GROUPS).flat())
        return
      }
      const next = new Set<FeatureKind>()
      for (const n of names) {
        const expanded = GROUPS[n]
        if (!expanded) {
          throw new Error(
            `@points entries must be "roots", "extrema", "inflections", "intersections", "conic", "all", or "none", got "${n}"`
          )
        }
        for (const kind of expanded) next.add(kind)
      }
      config.points = next
      return
    }
    case 'labels': {
      if (value !== 'all' && value !== 'coarse' && value !== 'none') {
        throw new Error(`@labels must be "all", "coarse", or "none", got "${value}"`)
      }
      config.labels = value
      return
    }
    case 'label-every': {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n < 1 || String(n) !== value) {
        throw new Error(`@label-every must be a positive whole number, got "${value}"`)
      }
      config.labelEvery = n
      return
    }
    case 'step-mode': {
      if (value !== 'nice' && value !== 'geometric' && value !== 'fixed') {
        throw new Error(`@step-mode must be "nice", "geometric", or "fixed", got "${value}"`)
      }
      config.stepMode = value
      return
    }
    case 'point-labels': {
      if (value !== 'off' && value !== 'coords') {
        throw new Error(`@point-labels must be "off" or "coords", got "${value}"`)
      }
      config.pointLabels = value
      return
    }
```

Update the import at the top of the file to `import type { FeatureKind, GraphConfig } from './config'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine`
Expected: PASS — the new file passes and nothing existing regresses. `detectFeaturePoints.test.ts` still passes because `FeaturePointKind` remains exported as an alias and `detectFeaturePoints` is untouched.

- [ ] **Step 6: Commit**

```bash
git add graph-engine/src/parser/config.ts graph-engine/src/parser/parseConfig.ts graph-engine/src/parser/parseConfig.test.ts
git commit -m "feat(graph-engine): typed feature kinds, @labels, @label-every and @step-mode directives"
```

---

### Task 2: Axis label modes

**Files:**
- Modify: `graph-engine/src/render/grid.ts:110-170` (the label block inside `draw`)
- Modify: `graph-engine/src/render/grid.test.ts`

**Interfaces:**
- Consumes: `GraphConfig.labels`, `GraphConfig.labelEvery` from Task 1.
- Produces: `export function shouldLabel(index: number, config: GraphConfig): boolean` — whether the nth gridline from the drawing start gets a label.

Extracting the decision as a pure function is what makes this testable at all; `GridRenderer.draw` needs a live WebGL-free three.js scene, but the rule does not.

- [ ] **Step 1: Write the failing test**

Append to `graph-engine/src/render/grid.test.ts`:

```typescript
import { defaultConfig } from '../parser/config'
import { shouldLabel } from './grid'

describe('shouldLabel', () => {
  it('labels every gridline by default', () => {
    const config = defaultConfig()
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(true)
    expect(shouldLabel(7, config)).toBe(true)
  })

  it('labels nothing when @labels is none', () => {
    const config = { ...defaultConfig(), labels: 'none' as const }
    expect(shouldLabel(0, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(false)
  })

  it('labels only every 5th line under @label-every: 5', () => {
    const config = { ...defaultConfig(), labelEvery: 5 }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
    expect(shouldLabel(10, config)).toBe(true)
  })

  // "coarse" means the major gridlines, which grid.ts already draws every
  // 5th step — so it is exactly @label-every: 5 without having to say so.
  it('coarse labels the major gridlines', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
  })

  it('label-every wins over coarse when both are set', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const, labelEvery: 2 }
    expect(shouldLabel(2, config)).toBe(true)
    expect(shouldLabel(5, config)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/render/grid.test.ts`
Expected: FAIL — `shouldLabel` is not exported from `./grid`.

- [ ] **Step 3: Implement shouldLabel and use it**

Add to `graph-engine/src/render/grid.ts`, above the `GridRenderer` class:

```typescript
// The major gridline interval grid.ts draws (see draw()'s majorStepX) — reused
// so "@labels: coarse" means exactly "the lines that are already drawn
// stronger", rather than a second, unrelated notion of coarse.
const MAJOR_EVERY = 5

// Whether the nth gridline (counting from the first one drawn in the current
// view) gets a tick label. Pure, so the rule is testable without standing up a
// three.js scene.
export function shouldLabel(index: number, config: GraphConfig): boolean {
  if (config.labels === 'none') return false
  const every = config.labelEvery > 1 ? config.labelEvery : config.labels === 'coarse' ? MAJOR_EVERY : 1
  return index % every === 0
}
```

In `draw`, replace `if (config.axes) {` (the label block, `grid.ts:110`) with `if (config.axes && config.labels !== 'none') {`, and gate each label placement. The x-label loop becomes:

```typescript
        let xIndex = 0
        let xTick = 0
        if (showXLabels) {
          for (let x = startX; x <= bounds.xMax; x += stepX, xTick++) {
            if (Math.abs(x) < stepX / 1e6) continue // "0" comes from the y-axis pass below
            if (!shouldLabel(xTick, config)) continue
            this.xLabels.place(xIndex++, formatCoord(x), x, -labelOffsetY, labelScaleX, labelScaleY)
          }
        }
```

and the y-label loop:

```typescript
        let yIndex = 0
        let yTick = 0
        if (showYLabels) {
          for (let y = startY; y <= bounds.yMax; y += stepY, yTick++) {
            if (!shouldLabel(yTick, config)) continue
            const text = Math.abs(y) < stepY / 1e6 ? '0' : formatCoord(y)
            this.yLabels.place(yIndex++, text, -labelOffsetX, y, labelScaleX, labelScaleY)
          }
        }
```

Replace the two literal `stepX * 5` / `stepY * 5` major-step expressions in `draw` with `stepX * MAJOR_EVERY` / `stepY * MAJOR_EVERY` so the constant has one home.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine`
Expected: PASS.

- [ ] **Step 5: Verify in the review harness**

Start the review server if it is not running: `npm run review`, open `http://localhost:5180#graph`, and paste into the spec box:

```
@labels: none
y = x^2 - 4
```

Expected: axes and gridlines still drawn, no numbers anywhere. Then change to `@label-every: 5` and confirm numbers reappear on every fifth line only.

- [ ] **Step 6: Commit**

```bash
git add graph-engine/src/render/grid.ts graph-engine/src/render/grid.test.ts
git commit -m "feat(graph-engine): @labels and @label-every control tick labels independently of axes"
```

---

### Task 3: Geometric step scaling

**Files:**
- Modify: `graph-engine/src/render/grid.ts:35-47` (`resolveStep`)
- Modify: `graph-engine/src/render/grid.test.ts`

**Interfaces:**
- Consumes: `StepMode` from Task 1.
- Produces: `resolveStep(fixed: number | null, worldSpan: number, targetDivisions: number, mode?: StepMode): number` — the fourth parameter is optional and defaults to `'nice'`, so every existing call site and test is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `graph-engine/src/render/grid.test.ts`:

```typescript
describe('resolveStep in geometric mode', () => {
  // The author's step multiplies by its own base as the view grows, instead of
  // being replaced by the universal 1-2-5 ladder. A spec written in 8s shows
  // 8s, then 64s, then 512s — never 10s.
  it('multiplies the step by its own base when zooming out', () => {
    expect(resolveStep(8, 60, 6, 'geometric')).toBe(8)
    expect(resolveStep(8, 500, 6, 'geometric')).toBe(64)
    expect(resolveStep(8, 4000, 6, 'geometric')).toBe(512)
  })

  it('divides by the base when zooming in', () => {
    expect(resolveStep(8, 6, 6, 'geometric')).toBe(1)
    expect(resolveStep(8, 0.7, 6, 'geometric')).toBeCloseTo(0.125, 10)
  })

  it('runs 10 -> 100 -> 1000 for a base of 10', () => {
    expect(resolveStep(10, 70, 6, 'geometric')).toBe(10)
    expect(resolveStep(10, 700, 6, 'geometric')).toBe(100)
    expect(resolveStep(10, 7000, 6, 'geometric')).toBe(1000)
  })

  it('runs 5 -> 25 -> 125 for a base of 5', () => {
    expect(resolveStep(5, 35, 6, 'geometric')).toBe(5)
    expect(resolveStep(5, 175, 6, 'geometric')).toBe(25)
    expect(resolveStep(5, 875, 6, 'geometric')).toBe(125)
  })

  it('falls back to nice when no fixed step was given', () => {
    expect(resolveStep(null, 10, 6, 'geometric')).toBe(niceStep(10, 6))
  })
})

describe('resolveStep in fixed mode', () => {
  it('never rescales while the division count stays sane', () => {
    expect(resolveStep(0.25, 200, 6, 'fixed')).toBe(0.25)
  })

  // Without a guard this would ask for 40,000 gridlines and lock the tab.
  it('falls back to nice rather than drawing a pathological number of lines', () => {
    expect(resolveStep(0.25, 100000, 6, 'fixed')).toBe(niceStep(100000, 6))
  })
})

describe('resolveStep defaults', () => {
  it('behaves exactly as before when no mode is passed', () => {
    expect(resolveStep(0.25, 200, 6)).toBe(resolveStep(0.25, 200, 6, 'nice'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/render/grid.test.ts`
Expected: FAIL — `resolveStep` takes three arguments and ignores the fourth.

- [ ] **Step 3: Implement the modes**

In `graph-engine/src/render/grid.ts`, replace `resolveStep` and add the geometric helper. Add `import type { GraphConfig, StepMode } from '../parser/config'` (extending the existing type import):

```typescript
// How many gridlines a view may hold before "fixed" gives up and falls back to
// a nice step. Well past unreadable — this exists only to stop a pathological
// spec from asking for tens of thousands of lines, not to second-guess an
// author who wants a dense grid.
const FIXED_MAX_DIVISIONS = 400

// The author's step scaled by whole powers of its own base, so the step family
// survives zoom: 8 -> 64 -> 512, 10 -> 100 -> 1000, 5 -> 25 -> 125. This is the
// difference from `nice`, which would replace an author's 8 with a 10.
function geometricStep(base: number, worldSpan: number, targetDivisions: number): number {
  const ideal = worldSpan / targetDivisions
  // How many times to multiply `base` by itself to land nearest the ideal
  // spacing. base^k * base == base^(k+1), so exponent search is a log.
  const k = Math.round(Math.log(ideal) / Math.log(base))
  const exponent = Math.max(k, 1)
  return Math.pow(base, exponent)
}

// An author's fixed @xstep/@ystep is the step at the zoom the spec was written
// for, not a promise to draw a line every 0.25 units at any zoom. What happens
// outside that band depends on @step-mode.
const MIN_DIVISIONS = 3
const MAX_DIVISIONS = 14
export function resolveStep(
  fixed: number | null,
  worldSpan: number,
  targetDivisions: number,
  mode: StepMode = 'nice'
): number {
  if (fixed === null || !(fixed > 0) || !(worldSpan > 0)) return niceStep(worldSpan, targetDivisions)

  if (mode === 'fixed') {
    return worldSpan / fixed <= FIXED_MAX_DIVISIONS ? fixed : niceStep(worldSpan, targetDivisions)
  }

  if (mode === 'geometric') {
    // A base of 1 has no geometric progression to walk (1^k is always 1), so
    // there is nothing this mode can do that `nice` does not do better.
    if (fixed === 1) return niceStep(worldSpan, targetDivisions)
    return geometricStep(fixed, worldSpan, targetDivisions)
  }

  const divisions = worldSpan / fixed
  if (divisions >= MIN_DIVISIONS && divisions <= MAX_DIVISIONS) return fixed
  return niceStep(worldSpan, targetDivisions)
}
```

In `draw`, pass the mode through:

```typescript
      const stepX = resolveStep(config.xstep, bounds.xMax - bounds.xMin, 6, config.stepMode)
      const stepY = resolveStep(config.ystep, bounds.yMax - bounds.yMin, 6, config.stepMode)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine`
Expected: PASS — including the pre-existing `resolveStep` tests, which pass no mode and therefore get `'nice'`.

- [ ] **Step 5: Verify in the review harness**

At `http://localhost:5180#graph`, paste:

```
@xstep: 8
@ystep: 8
@step-mode: geometric
y = x^2
```

Scroll to zoom out and confirm the gridline spacing goes 8 → 64 → 512 and never becomes 10 or 100.

- [ ] **Step 6: Commit**

```bash
git add graph-engine/src/render/grid.ts graph-engine/src/render/grid.test.ts
git commit -m "feat(graph-engine): @step-mode geometric keeps the author's step base across zoom"
```

---

### Task 4: Numerical root finding

**Files:**
- Create: `graph-engine/src/scene/roots.ts`
- Create: `graph-engine/src/scene/roots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function derivative(f: (x: number) => number, x: number, h?: number): number`
  - `export function secondDerivative(f: (x: number) => number, x: number, h?: number): number`
  - `export function findRoots(f: (x: number) => number, lo: number, hi: number, samples?: number): number[]` — ascending, de-duplicated.

This is the module the whole feature engine stands on. v1 decided "is this a maximum?" by comparing three consecutive samples of a 400-point array, which is why it fires on numerical noise and misses anything between samples. Finding roots of f′ instead is both more accurate and indifferent to sample spacing.

- [ ] **Step 1: Write the failing test**

Create `graph-engine/src/scene/roots.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { derivative, findRoots, secondDerivative } from './roots'

describe('derivative', () => {
  it('matches the analytic derivative of a polynomial', () => {
    const f = (x: number) => x * x * x - 3 * x
    expect(derivative(f, 2)).toBeCloseTo(9, 4) // 3x^2 - 3 at x=2
    expect(derivative(f, 0)).toBeCloseTo(-3, 4)
  })

  it('matches the analytic derivative of sin', () => {
    expect(derivative(Math.sin, 0)).toBeCloseTo(1, 5)
    expect(derivative(Math.sin, Math.PI / 2)).toBeCloseTo(0, 5)
  })
})

describe('secondDerivative', () => {
  it('matches the analytic second derivative', () => {
    const f = (x: number) => x * x * x
    expect(secondDerivative(f, 2)).toBeCloseTo(12, 2) // 6x at x=2
  })

  it('is zero at an inflection', () => {
    const f = (x: number) => x * x * x
    expect(Math.abs(secondDerivative(f, 0))).toBeLessThan(1e-3)
  })
})

describe('findRoots', () => {
  it('finds both roots of a quadratic', () => {
    const roots = findRoots((x) => x * x - 4, -10, 10)
    expect(roots).toHaveLength(2)
    expect(roots[0]).toBeCloseTo(-2, 6)
    expect(roots[1]).toBeCloseTo(2, 6)
  })

  it('finds roots to far better precision than the sample spacing', () => {
    // 200 samples over [-10, 10] is a spacing of 0.1; the root is nowhere near
    // a sample point, so a sample-scanning approach would report ~0.1 off.
    const roots = findRoots((x) => x - Math.SQRT2, -10, 10, 200)
    expect(roots[0]).toBeCloseTo(Math.SQRT2, 8)
  })

  it('finds the three roots of a cubic', () => {
    const roots = findRoots((x) => x * x * x - x, -5, 5)
    expect(roots).toHaveLength(3)
    expect(roots[0]).toBeCloseTo(-1, 6)
    expect(roots[1]).toBeCloseTo(0, 6)
    expect(roots[2]).toBeCloseTo(1, 6)
  })

  it('returns nothing when the function never crosses zero', () => {
    expect(findRoots((x) => x * x + 1, -10, 10)).toEqual([])
  })

  // A pole is a sign change without a root. Reporting x=0 as a root of 1/x
  // would put a marker on a vertical asymptote.
  it('does not report a pole as a root', () => {
    expect(findRoots((x) => 1 / x, -5, 5)).toEqual([])
  })

  it('skips intervals where the function is undefined', () => {
    const f = (x: number) => (x < 0 ? NaN : x - 1)
    const roots = findRoots(f, -5, 5)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(1, 6)
  })

  it('de-duplicates roots found from adjacent brackets', () => {
    const roots = findRoots((x) => x, -1, 1)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0, 8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/scene/roots.test.ts`
Expected: FAIL — `Cannot find module './roots'`.

- [ ] **Step 3: Implement**

Create `graph-engine/src/scene/roots.ts`:

```typescript
// Numerical scaffolding for feature detection.
//
// v1 found features by comparing consecutive entries of an already-sampled
// point array (see the deleted detectFeaturePoints.ts): a maximum was "y went
// up then down". That is wrong in two ways at once — it fires on numerical
// noise in flat stretches, and it can only ever report a location that happens
// to be a sample point, so a vertex between samples is reported at the wrong
// place. Finding roots of f' instead is indifferent to sample spacing and
// converges to the true location.

const DEFAULT_SAMPLES = 800
// Central-difference step. Small enough to be accurate, large enough that
// f(x+h) - f(x-h) does not vanish into floating-point cancellation.
const DERIV_H = 1e-5
const SECOND_DERIV_H = 1e-3
const BISECT_ITERATIONS = 60
// Two roots closer together than this are the same root found from adjacent
// brackets.
const DEDUPE_EPSILON = 1e-7
// A bracket whose endpoints differ by more than this factor of the local scale
// is a pole, not a crossing — 1/x changes sign at 0 without ever being 0.
const POLE_RATIO = 1e6

export function derivative(f: (x: number) => number, x: number, h: number = DERIV_H): number {
  return (f(x + h) - f(x - h)) / (2 * h)
}

export function secondDerivative(f: (x: number) => number, x: number, h: number = SECOND_DERIV_H): number {
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

// Plain bisection rather than Newton. Newton converges faster but can fly off
// a bracket entirely near a flat derivative, and these functions come from
// arbitrary user specs — guaranteed convergence inside a known bracket is
// worth more here than iteration count.
function bisect(f: (x: number) => number, a: number, b: number): number {
  let lo = a
  let hi = b
  let flo = f(lo)
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    const fmid = f(mid)
    if (fmid === 0) return mid
    if (!finite(fmid)) return mid
    if (flo < 0 !== fmid < 0) {
      hi = mid
    } else {
      lo = mid
      flo = fmid
    }
  }
  return (lo + hi) / 2
}

// Every x in [lo, hi] where f crosses zero, ascending, de-duplicated.
export function findRoots(
  f: (x: number) => number,
  lo: number,
  hi: number,
  samples: number = DEFAULT_SAMPLES
): number[] {
  const found: number[] = []
  const step = (hi - lo) / samples
  let prevX = lo
  let prevY = safeEval(f, lo)

  for (let i = 1; i <= samples; i++) {
    const x = lo + step * i
    const y = safeEval(f, x)

    if (prevY !== null && y !== null) {
      if (y === 0) {
        push(found, x)
      } else if (prevY < 0 !== y < 0) {
        // A genuine crossing is bounded on both sides; a pole's neighbours
        // blow up. Comparing the jump against the bracket's own magnitude
        // distinguishes them without needing to know where poles are.
        const jump = Math.abs(y - prevY)
        const scale = Math.max(Math.abs(y), Math.abs(prevY), 1)
        if (jump < scale * POLE_RATIO && Math.min(Math.abs(y), Math.abs(prevY)) < scale) {
          push(found, bisect(f, prevX, x))
        }
      }
    }
    prevX = x
    prevY = y
  }
  return found
}

function safeEval(f: (x: number) => number, x: number): number | null {
  try {
    const y = f(x)
    return finite(y) ? y : null
  } catch {
    return null
  }
}

function push(found: number[], x: number): void {
  if (found.length > 0 && Math.abs(found[found.length - 1] - x) < DEDUPE_EPSILON) return
  found.push(x)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine -- src/scene/roots.test.ts`
Expected: PASS, all nine cases.

If the pole test fails, the discriminator is the line comparing `jump` against `scale * POLE_RATIO` — a true crossing has at least one endpoint small relative to the bracket, a pole has both endpoints enormous.

- [ ] **Step 5: Commit**

```bash
git add graph-engine/src/scene/roots.ts graph-engine/src/scene/roots.test.ts
git commit -m "feat(graph-engine): numerical root finding and derivatives for feature detection"
```

---

### Task 5: Features of an explicit function

**Files:**
- Create: `graph-engine/src/scene/featurePoints.ts`
- Create: `graph-engine/src/scene/featurePoints.test.ts`

**Interfaces:**
- Consumes: `findRoots`, `derivative`, `secondDerivative` from Task 4; `FeatureKind` from Task 1.
- Produces:
  - `export interface FeaturePoint { position: Vec2; kind: FeatureKind; exact: boolean }`
  - `export function explicitFeatures(f: (x: number) => number, lo: number, hi: number, wanted: Set<FeatureKind>): FeaturePoint[]`

`exact` records whether the position came from analytic or converged-numerical work (true) rather than from a sampled approximation (false). Task 10's hover snapping shows exact and inexact readings differently.

- [ ] **Step 1: Write the failing test**

Create `graph-engine/src/scene/featurePoints.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { FeatureKind } from '../parser/config'
import { explicitFeatures } from './featurePoints'

const ALL = new Set<FeatureKind>(['x-intercept', 'y-intercept', 'local-max', 'local-min', 'inflection'])

function kinds(features: { kind: FeatureKind }[]): FeatureKind[] {
  return features.map((f) => f.kind).sort()
}

describe('explicitFeatures', () => {
  it('finds the vertex of a parabola as a local minimum, not a generic point', () => {
    // y = x^2 - 2x - 1 has its vertex at (1, -2).
    const features = explicitFeatures((x) => x * x - 2 * x - 1, -10, 10, new Set(['local-min']))
    expect(features).toHaveLength(1)
    expect(features[0].kind).toBe('local-min')
    expect(features[0].position.x).toBeCloseTo(1, 5)
    expect(features[0].position.y).toBeCloseTo(-2, 5)
  })

  it('distinguishes a local maximum from a local minimum', () => {
    // y = x^3 - 3x: max at x=-1, min at x=1.
    const features = explicitFeatures((x) => x ** 3 - 3 * x, -5, 5, new Set(['local-max', 'local-min']))
    const max = features.find((f) => f.kind === 'local-max')
    const min = features.find((f) => f.kind === 'local-min')
    expect(max?.position.x).toBeCloseTo(-1, 4)
    expect(min?.position.x).toBeCloseTo(1, 4)
  })

  it('finds x-intercepts and the y-intercept as separate kinds', () => {
    const features = explicitFeatures((x) => x * x - 4, -10, 10, new Set(['x-intercept', 'y-intercept']))
    expect(kinds(features)).toEqual(['x-intercept', 'x-intercept', 'y-intercept'])
    const y = features.find((f) => f.kind === 'y-intercept')
    expect(y?.position.x).toBe(0)
    expect(y?.position.y).toBeCloseTo(-4, 6)
  })

  it('finds an inflection point', () => {
    const features = explicitFeatures((x) => x ** 3, -5, 5, new Set(['inflection']))
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 3)
  })

  it('returns nothing when nothing is wanted', () => {
    expect(explicitFeatures((x) => x * x, -5, 5, new Set())).toEqual([])
  })

  it('omits the y-intercept when x=0 is outside the range', () => {
    const features = explicitFeatures((x) => x, 1, 5, new Set(['y-intercept']))
    expect(features).toEqual([])
  })

  // The exact defect that made v1's modes indistinguishable: a flat line has
  // no extrema, but comparing consecutive samples on a noisy flat stretch
  // reports them anyway.
  it('reports no extrema for a straight line', () => {
    const features = explicitFeatures((x) => 2 * x + 1, -10, 10, new Set(['local-max', 'local-min']))
    expect(features).toEqual([])
  })

  it('marks everything it finds as exact', () => {
    const features = explicitFeatures((x) => x * x - 4, -10, 10, ALL)
    expect(features.every((f) => f.exact)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/scene/featurePoints.test.ts`
Expected: FAIL — `Cannot find module './featurePoints'`.

- [ ] **Step 3: Implement**

Create `graph-engine/src/scene/featurePoints.ts`:

```typescript
import type { FeatureKind } from '../parser/config'
import { derivative, findRoots, secondDerivative } from './roots'
import type { Vec2 } from './types'

// A detected feature, carrying which kind it is so the renderer can mark an
// intercept differently from a maximum, and whether its position is exact
// (analytic or converged) rather than a sampled approximation.
export interface FeaturePoint {
  position: Vec2
  kind: FeatureKind
  exact: boolean
}

// Below this, a stationary point's second derivative is too close to zero to
// call it a maximum or a minimum — it is a saddle or a higher-order flat spot,
// and claiming either would be a guess.
const CURVATURE_EPSILON = 1e-6

export function explicitFeatures(
  f: (x: number) => number,
  lo: number,
  hi: number,
  wanted: Set<FeatureKind>
): FeaturePoint[] {
  if (wanted.size === 0) return []
  const out: FeaturePoint[] = []

  if (wanted.has('x-intercept')) {
    for (const x of findRoots(f, lo, hi)) {
      out.push({ position: { x, y: 0 }, kind: 'x-intercept', exact: true })
    }
  }

  if (wanted.has('y-intercept') && lo <= 0 && 0 <= hi) {
    try {
      const y = f(0)
      if (Number.isFinite(y)) out.push({ position: { x: 0, y }, kind: 'y-intercept', exact: true })
    } catch {
      // undefined at zero — no y-intercept to report
    }
  }

  if (wanted.has('local-max') || wanted.has('local-min')) {
    // An extremum is a root of f', and its kind is the sign of f'' there.
    // Nothing about this depends on how densely the curve was sampled for
    // drawing, which is the whole point.
    for (const x of findRoots((t) => derivative(f, t), lo, hi)) {
      const curvature = secondDerivative(f, x)
      if (Math.abs(curvature) < CURVATURE_EPSILON) continue
      const kind: FeatureKind = curvature > 0 ? 'local-min' : 'local-max'
      if (!wanted.has(kind)) continue
      const y = f(x)
      if (Number.isFinite(y)) out.push({ position: { x, y }, kind, exact: true })
    }
  }

  if (wanted.has('inflection')) {
    for (const x of findRoots((t) => secondDerivative(f, t), lo, hi)) {
      const y = f(x)
      if (Number.isFinite(y)) out.push({ position: { x, y }, kind: 'inflection', exact: true })
    }
  }

  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine -- src/scene/featurePoints.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add graph-engine/src/scene/featurePoints.ts graph-engine/src/scene/featurePoints.test.ts
git commit -m "feat(graph-engine): typed feature detection for explicit functions from f' and f''"
```

---

### Task 6: Intersections between statements

**Files:**
- Modify: `graph-engine/src/scene/featurePoints.ts`
- Modify: `graph-engine/src/scene/featurePoints.test.ts`

**Interfaces:**
- Consumes: `findRoots` from Task 4, `FeaturePoint` from Task 5.
- Produces: `export function intersectionFeatures(fs: ((x: number) => number)[], lo: number, hi: number): FeaturePoint[]`

This is also the function the tutor's "show me where these cross" tool calls in track 7, so its output is a public shape, not an internal detail.

- [ ] **Step 1: Write the failing test**

Append to `graph-engine/src/scene/featurePoints.test.ts`:

```typescript
import { intersectionFeatures } from './featurePoints'

describe('intersectionFeatures', () => {
  it('finds where a line crosses a parabola', () => {
    // x^2 = x + 2 at x = -1 and x = 2.
    const features = intersectionFeatures([(x) => x * x, (x) => x + 2], -10, 10)
    expect(features).toHaveLength(2)
    expect(features[0].kind).toBe('intersection')
    expect(features[0].position.x).toBeCloseTo(-1, 5)
    expect(features[0].position.y).toBeCloseTo(1, 5)
    expect(features[1].position.x).toBeCloseTo(2, 5)
    expect(features[1].position.y).toBeCloseTo(4, 5)
  })

  it('checks every pair when given three curves', () => {
    // y=0, y=x, y=-x all meet at the origin; pairwise that is three hits at
    // the same place, which de-duplication collapses to one.
    const features = intersectionFeatures([() => 0, (x) => x, (x) => -x], -5, 5)
    expect(features).toHaveLength(1)
    expect(features[0].position.x).toBeCloseTo(0, 6)
  })

  it('finds nothing for parallel lines', () => {
    expect(intersectionFeatures([(x) => x + 1, (x) => x + 3], -10, 10)).toEqual([])
  })

  it('needs at least two curves', () => {
    expect(intersectionFeatures([(x) => x], -10, 10)).toEqual([])
    expect(intersectionFeatures([], -10, 10)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/scene/featurePoints.test.ts`
Expected: FAIL — `intersectionFeatures` is not exported.

- [ ] **Step 3: Implement**

Append to `graph-engine/src/scene/featurePoints.ts`:

```typescript
// Two curves meeting at the same place, found from different pairs, are one
// intersection as far as a reader is concerned.
const SAME_POINT_EPSILON = 1e-5

// Every crossing between every pair of the given curves. An intersection of
// f and g is a root of f - g, so this reuses the same solver as everything
// else rather than introducing a second notion of "where does this happen".
export function intersectionFeatures(
  fs: ((x: number) => number)[],
  lo: number,
  hi: number
): FeaturePoint[] {
  const out: FeaturePoint[] = []
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const f = fs[i]
      const g = fs[j]
      for (const x of findRoots((t) => f(t) - g(t), lo, hi)) {
        const y = f(x)
        if (!Number.isFinite(y)) continue
        if (out.some((p) => Math.hypot(p.position.x - x, p.position.y - y) < SAME_POINT_EPSILON)) continue
        out.push({ position: { x, y }, kind: 'intersection', exact: true })
      }
    }
  }
  out.sort((a, b) => a.position.x - b.position.x)
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=graph-engine -- src/scene/featurePoints.test.ts`
Expected: PASS, all twelve cases.

- [ ] **Step 5: Commit**

```bash
git add graph-engine/src/scene/featurePoints.ts graph-engine/src/scene/featurePoints.test.ts
git commit -m "feat(graph-engine): pairwise intersection detection between plotted statements"
```

---

### Task 7: Typed feature points in the scene

**Files:**
- Modify: `graph-engine/src/scene/types.ts` (the `point` variant of `SceneObject`)
- Modify: `graph-engine/src/scene/buildScene.ts:109-120` (`curveWithFeatures`), `:122-186` (`sampleExplicit`), `:435+` (`buildScene`)
- Delete: `graph-engine/src/scene/detectFeaturePoints.ts`, `graph-engine/src/scene/detectFeaturePoints.test.ts`
- Modify: `graph-engine/src/index.ts` (drops the `detectFeaturePoints` export)
- Modify: `graph-engine/src/scene/buildScene.test.ts`

**Interfaces:**
- Consumes: `explicitFeatures`, `intersectionFeatures`, `FeaturePoint` from Tasks 5-6.
- Produces: `SceneObject` `point` variant gains `feature?: FeatureKind | null` and `exact?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `graph-engine/src/scene/buildScene.test.ts`:

```typescript
describe('feature points', () => {
  it('marks a parabola vertex as a local minimum at the true vertex', () => {
    const { scene } = build('@points: extrema\ny = x^2 - 2x - 1')
    const points = scene.objects.filter((o) => o.kind === 'point')
    expect(points).toHaveLength(1)
    if (points[0].kind !== 'point') throw new Error('unreachable')
    expect(points[0].feature).toBe('local-min')
    expect(points[0].position.x).toBeCloseTo(1, 4)
    expect(points[0].position.y).toBeCloseTo(-2, 4)
  })

  it('distinguishes roots from extrema instead of emitting identical dots', () => {
    const { scene } = build('@points: roots, extrema\ny = x^2 - 4')
    const features = scene.objects
      .filter((o) => o.kind === 'point')
      .map((o) => (o.kind === 'point' ? o.feature : null))
      .sort()
    expect(features).toEqual(['local-min', 'x-intercept', 'x-intercept', 'y-intercept'])
  })

  it('emits nothing when @points is absent', () => {
    const { scene } = build('y = x^2 - 4')
    expect(scene.objects.filter((o) => o.kind === 'point')).toHaveLength(0)
  })

  it('finds intersections between two statements', () => {
    const { scene } = build('@points: intersections\ny = x^2\ny = x + 2')
    const points = scene.objects.filter((o) => o.kind === 'point')
    expect(points).toHaveLength(2)
    if (points[0].kind !== 'point') throw new Error('unreachable')
    expect(points[0].feature).toBe('intersection')
  })

  // The v1 defect: a circle comes from marching squares, whose output is not
  // in path order, so scanning consecutive entries produced a scatter of
  // meaningless "vertices" all over the curve.
  it('does not scatter spurious extrema over an implicit circle', () => {
    const { scene } = build('@points: extrema\nx^2 + y^2 = 25')
    expect(scene.objects.filter((o) => o.kind === 'point').length).toBeLessThanOrEqual(2)
  })

  it('labels coordinates when @point-labels is coords', () => {
    const { scene } = build('@points: extrema\n@point-labels: coords\ny = x^2 - 2x - 1')
    const point = scene.objects.find((o) => o.kind === 'point')
    if (point?.kind !== 'point') throw new Error('unreachable')
    expect(point.label).toMatch(/1/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/scene/buildScene.test.ts`
Expected: FAIL — `feature` is not a property of a `point` scene object, and `@points: extrema` produces no points.

- [ ] **Step 3: Extend the scene point type**

In `graph-engine/src/scene/types.ts`, add two fields to the `point` variant and import the kind:

```typescript
import type { FeatureKind } from '../parser/config'
```

```typescript
  | {
      kind: 'point'
      label: string | null
      position: Vec2
      style?: 'solid' | 'outline'
      color?: string | null
      labelDirection?: Vec2 | null
      maxLabelOffset?: number | null
      // Which kind of detected feature this point is, or null/absent for an
      // ordinary plotted point. The renderer marks each kind differently —
      // v1 drew all of them as the same anonymous outline dot, which is why
      // the @points modes were indistinguishable on screen.
      feature?: FeatureKind | null
      // True when the position is analytic or converged rather than a sampled
      // approximation. Hover reports exact values differently (see hover.ts).
      exact?: boolean
    }
```

- [ ] **Step 4: Rewire buildScene**

In `graph-engine/src/scene/buildScene.ts`, replace the `detectFeaturePoints` import with:

```typescript
import { explicitFeatures, intersectionFeatures, type FeaturePoint } from './featurePoints'
```

Replace `curveWithFeatures` with a plain wrapper — feature detection no longer happens per sampled curve, because it needs the function, not the samples:

```typescript
// Features are no longer derived from a curve's sampled points (see
// featurePoints.ts for why), so this is now just "wrap the samples".
function curveObject(points: Vec2[], color: string | null): SceneObject {
  return { kind: 'curve', points, color }
}
```

Replace all three `curveWithFeatures(...)` call sites (at `:165`, `:206`, `:226`) with `curveObject(segment, statement.color)` / `curveObject(points, statement.color)`, changing `objects.push(...curveWithFeatures(...))` to `objects.push(curveObject(...))` and `return curveWithFeatures(...)` to `return [curveObject(...)]`.

Add a feature pass that runs once over the whole statement list, and a formatter for coordinate labels:

```typescript
function featureLabel(feature: FeaturePoint, config: GraphConfig): string | null {
  if (config.pointLabels !== 'coords') return null
  return `(${formatCoord(feature.position.x)}, ${formatCoord(feature.position.y)})`
}

// One pass over every explicit statement, after the curves are built. Explicit
// y = f(x) statements are the only ones that expose a callable f, which is
// what the analytic feature work needs; other statement kinds contribute
// nothing here yet (conic features are a later task).
function buildFeaturePoints(
  statements: Statement[],
  bounds: Bounds,
  config: GraphConfig,
  functions: FunctionTable
): SceneObject[] {
  if (config.points.size === 0) return []

  const callables: ((x: number) => number)[] = []
  const found: FeaturePoint[] = []

  for (const statement of statements) {
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    if (statement.kind !== 'explicit' || statement.independent !== 'x') continue
    const body = compileExpr(statement.body, config.angle, functions)
    const f = (x: number) => body({ x })
    callables.push(f)
    found.push(...explicitFeatures(f, bounds.xMin, bounds.xMax, config.points))
  }

  if (config.points.has('intersection')) {
    found.push(...intersectionFeatures(callables, bounds.xMin, bounds.xMax))
  }

  // No `style` here on purpose: a feature point's appearance is chosen from
  // its kind by the renderer (see render/featureMarker.ts), not set here. The
  // scene layer must not import from render/.
  return found.map((feature) => ({
    kind: 'point' as const,
    label: featureLabel(feature, config),
    position: feature.position,
    feature: feature.kind,
    exact: feature.exact,
  }))
}
```

In `buildScene`, after the main statement loop and before the `return`, add:

```typescript
  objects.push(...buildFeaturePoints(statements, bounds, config, functions))
```

- [ ] **Step 5: Delete the old detector**

```bash
git rm graph-engine/src/scene/detectFeaturePoints.ts graph-engine/src/scene/detectFeaturePoints.test.ts
```

Remove `export { detectFeaturePoints } from './scene/detectFeaturePoints'` from `graph-engine/src/index.ts`.

- [ ] **Step 6: Run the full suite**

Run: `npm run test --workspace=graph-engine`
Expected: PASS. If `buildScene3d.ts` fails to compile, it does not import the deleted module — check `graph-engine/src/index.ts` first for a stale export.

Also run the type check: `npx tsc -b graph-engine/tsconfig.json --noEmit` from the repo root. Expected: no errors.

- [ ] **Step 7: Verify in the review harness**

At `http://localhost:5180#graph`, paste:

```
@points: roots, extrema
@point-labels: coords
y = x^3 - 3x
```

Expected: two extrema and three x-intercepts marked, each labelled with its coordinates, and no spurious markers along the flat stretches. Then click the "Circle" example button with `@points: extrema` prepended and confirm no scatter of markers around the circle.

- [ ] **Step 8: Commit**

```bash
git add -A graph-engine/src graph-engine/src/index.ts
git commit -m "feat(graph-engine): feature points derived from statement math, replacing the sampled-array scan"
```

---

### Task 8: Distinct markers per feature kind

**Files:**
- Modify: `graph-engine/src/render/SceneRenderer.ts` (the point builder, around the `POINT_OUTLINE_INNER_PX` constants at `:76-80`)
- Create: `graph-engine/src/render/featureMarker.ts`
- Create: `graph-engine/src/render/featureMarker.test.ts`

**Interfaces:**
- Consumes: `FeatureKind` from Task 1.
- Produces: `export function markerShape(feature: FeatureKind | null | undefined): MarkerShape` where `export type MarkerShape = 'dot' | 'ring' | 'square' | 'diamond' | 'triangle-up' | 'triangle-down'`.

Keeping the mapping in its own pure module means the *decision* is testable without a WebGL context, which `SceneRenderer` requires.

- [ ] **Step 1: Write the failing test**

Create `graph-engine/src/render/featureMarker.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { markerShape } from './featureMarker'

describe('markerShape', () => {
  it('gives a plain plotted point the default dot', () => {
    expect(markerShape(null)).toBe('dot')
    expect(markerShape(undefined)).toBe('dot')
  })

  // The whole point of the rework: these must not look alike.
  it('gives every feature kind a shape distinct from its neighbours', () => {
    expect(markerShape('x-intercept')).not.toBe(markerShape('local-max'))
    expect(markerShape('local-max')).not.toBe(markerShape('local-min'))
    expect(markerShape('inflection')).not.toBe(markerShape('local-max'))
    expect(markerShape('intersection')).not.toBe(markerShape('x-intercept'))
  })

  it('points a maximum up and a minimum down', () => {
    expect(markerShape('local-max')).toBe('triangle-up')
    expect(markerShape('local-min')).toBe('triangle-down')
  })

  it('uses the same shape for both intercept kinds, since both are roots', () => {
    expect(markerShape('x-intercept')).toBe('ring')
    expect(markerShape('y-intercept')).toBe('ring')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/render/featureMarker.test.ts`
Expected: FAIL — `Cannot find module './featureMarker'`.

- [ ] **Step 3: Implement the mapping**

Create `graph-engine/src/render/featureMarker.ts`:

```typescript
import type { FeatureKind } from '../parser/config'

export type MarkerShape = 'dot' | 'ring' | 'square' | 'diamond' | 'triangle-up' | 'triangle-down'

// One shape per feature kind, so a reader can tell what a marker means without
// hovering it. v1 drew every feature as an identical outline dot, which is the
// real reason "@points: intercepts" and "@points: all" looked the same.
//
// The pairings are meant to be readable rather than arbitrary: a maximum
// points up, a minimum points down, both intercept kinds share a ring because
// both are roots, and an intersection gets the shape that reads as two things
// crossing.
const SHAPES: Record<FeatureKind, MarkerShape> = {
  'x-intercept': 'ring',
  'y-intercept': 'ring',
  'local-max': 'triangle-up',
  'local-min': 'triangle-down',
  inflection: 'square',
  intersection: 'diamond',
  center: 'dot',
  focus: 'diamond',
  'conic-vertex': 'triangle-up',
}

export function markerShape(feature: FeatureKind | null | undefined): MarkerShape {
  if (!feature) return 'dot'
  return SHAPES[feature] ?? 'dot'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=graph-engine -- src/render/featureMarker.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the shapes**

In `graph-engine/src/render/SceneRenderer.ts`, import the mapping:

```typescript
import { markerShape, type MarkerShape } from './featureMarker'
```

Add a geometry helper near the other marker constants. **Every marker geometry
is built at unit radius**, because `applyPointSizes` (`SceneRenderer.ts:547`)
sizes points by `scale.setScalar(...)` on a unit mesh rather than by rebuilding
geometry — returning a pre-sized geometry here would be scaled a second time
and come out wrong:

```typescript
// three.js's CircleGeometry with a low segment count is a regular polygon, so
// every shape is one call with a different segment count and start angle — no
// per-shape geometry code, and all of them stay centred on the point.
//
// Unit radius, always: applyPointSizes scales these meshes rather than
// rebuilding them (see its comment), so anything pre-sized here gets sized
// twice.
function markerGeometry(shape: MarkerShape): THREE.CircleGeometry {
  switch (shape) {
    // Segment counts below 24 inscribe a smaller area than a circle of the
    // same radius, so the polygons are nudged outward to read as the same
    // visual weight as a dot next to them.
    case 'square':
      return new THREE.CircleGeometry(1.15, 4, Math.PI / 4)
    case 'diamond':
      return new THREE.CircleGeometry(1.25, 4)
    case 'triangle-up':
      return new THREE.CircleGeometry(1.3, 3, Math.PI / 2)
    case 'triangle-down':
      return new THREE.CircleGeometry(1.3, 3, -Math.PI / 2)
    default:
      return new THREE.CircleGeometry(1, 24)
  }
}
```

In `buildObject`'s `if (obj.kind === 'point')` branch (`SceneRenderer.ts:650`),
replace the `const outline = obj.style === 'outline'` line with a shape-driven
pair. A `'ring'` marker *is* the existing outline treatment, so intercepts route
into the branch that already exists rather than growing a new one:

```typescript
      // A feature point's appearance comes from its kind; an ordinary plotted
      // point still honours its own `style`. 'ring' and "outline" are the same
      // picture, so they share a branch.
      const shape: MarkerShape = obj.feature ? markerShape(obj.feature) : obj.style === 'outline' ? 'ring' : 'dot'
      const outline = shape === 'ring'
```

In the non-outline branch of that same block, both meshes are built with
`new THREE.CircleGeometry(1, 24)`. Change **both** to `markerGeometry(shape)` —
the halo and the fill must be the same shape or the halo reads as a mismatched
backing plate.

**Then fix the reuse path, or a changed shape will not take effect.**
`updatePointObject` (`:510`) reuses an existing `Group` in place and updates
only position, colours, sizes and label — it never touches geometry. Today the
reuse condition at `:436` is:

```typescript
      if (obj.kind === 'point' && prev && prev.kind === 'point' && prev.outline === outline && prev.hasLabel === hasLabel) {
```

Editing a spec from `@points: extrema` to `@points: roots` keeps the entry at
the same index, so without a shape check the group is reused and keeps its old
triangle. Add `shape` to the cached entry and to the condition. In the
`MiscEntry` interface (near `:105`, alongside `hasLabel: boolean`) add:

```typescript
  shape: MarkerShape
```

In `updateMiscGroup`, compute the shape alongside `outline` and `hasLabel`:

```typescript
      const shape: MarkerShape =
        obj.kind !== 'point' ? 'dot' : obj.feature ? markerShape(obj.feature) : obj.style === 'outline' ? 'ring' : 'dot'
      const outline = obj.kind === 'point' && shape === 'ring'
      const hasLabel = obj.kind === 'point' && !!obj.label
      const prev = this.miscEntries[i]
      if (
        obj.kind === 'point' &&
        prev &&
        prev.kind === 'point' &&
        prev.outline === outline &&
        prev.hasLabel === hasLabel &&
        prev.shape === shape
      ) {
```

and add `shape` to both `next.push({ ... })` calls at `:454` and `:465`.

- [ ] **Step 6: Run the full suite and type check**

Run: `npm run test --workspace=graph-engine`
Run: `npx tsc -b graph-engine/tsconfig.json --noEmit`
Expected: both clean.

- [ ] **Step 7: Verify in the review harness**

At `http://localhost:5180#graph`:

```
@points: roots, extrema, inflections
y = x^3 - 3x
```

Expected: rings at the three x-intercepts, a triangle pointing up at the maximum, a triangle pointing down at the minimum, a square at the inflection. Take a screenshot — this is the task whose whole purpose is that the marks look different.

Then, **without reloading the page**, edit the first line in place from
`@points: roots, extrema, inflections` to `@points: extrema`. The remaining
markers must be triangles. If any of them is still a ring or a square, the
reuse condition from Step 5 is not checking `shape` — the group was reused with
its old geometry. This cannot be unit-tested (it needs a live WebGL context),
so this manual check is the only thing guarding it.

- [ ] **Step 8: Commit**

```bash
git add graph-engine/src/render/featureMarker.ts graph-engine/src/render/featureMarker.test.ts graph-engine/src/render/SceneRenderer.ts
git commit -m "feat(graph-engine): a distinct marker shape per feature kind"
```

---

### Task 9: Hover snapping to features

**Files:**
- Modify: `graph-engine/src/render/hover.ts:39-120` (`resolve`)
- Modify: `graph-engine/src/render/hover.test.ts`
- Modify: `graph-engine/src/parser/config.ts` (extend `HoverMode`)
- Modify: `graph-engine/src/parser/parseConfig.ts` (the `hover` case)

**Interfaces:**
- Consumes: `SceneObject.feature` / `.exact` from Task 7.
- Produces: `HoverInfo` gains `exact: boolean` and `feature?: FeatureKind | null`. `HoverMode` gains `'features'`.

- [ ] **Step 1: Write the failing test**

Append to `graph-engine/src/render/hover.test.ts`:

```typescript
describe('feature snapping', () => {
  // The bug: hovering near a parabola's vertex reports the nearest *sampled*
  // point, so you read 1.9993 instead of 2. A feature carries its exact
  // position, and hover should prefer it.
  it('snaps to a feature point instead of the nearest curve sample', () => {
    const camera = new Camera2D(CANVAS, CANVAS)
    const scene: Scene = {
      objects: [
        { kind: 'curve', points: [{ x: 0.9, y: 0.81 }, { x: 1.1, y: 1.21 }] },
        { kind: 'point', label: null, position: { x: 1, y: 1 }, feature: 'local-min', exact: true },
      ],
      errors: [],
      regression: null,
    }
    const resolver = new HoverResolver()
    const info = resolveAt(resolver, scene, camera, 1.02, 1.02)
    expect(info).not.toBeNull()
    expect(info?.worldX).toBeCloseTo(1, 10)
    expect(info?.worldY).toBeCloseTo(1, 10)
    expect(info?.exact).toBe(true)
    expect(info?.feature).toBe('local-min')
  })

  it('reports a plain curve reading as inexact', () => {
    const camera = new Camera2D(CANVAS, CANVAS)
    const scene: Scene = {
      objects: [{ kind: 'curve', points: [{ x: -5, y: 2 }, { x: 5, y: 2 }] }],
      errors: [],
      regression: null,
    }
    const resolver = new HoverResolver()
    const info = resolveAt(resolver, scene, camera, 0, 2)
    expect(info?.exact).toBe(false)
  })

  // Snapping must not teleport the readout across the screen: a feature far
  // from the cursor loses to a curve directly under it.
  it('does not snap to a feature outside the snap radius', () => {
    const camera = new Camera2D(CANVAS, CANVAS)
    const scene: Scene = {
      objects: [
        { kind: 'curve', points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] },
        { kind: 'point', label: null, position: { x: 5, y: 5 }, feature: 'local-max', exact: true },
      ],
      errors: [],
      regression: null,
    }
    const resolver = new HoverResolver()
    const info = resolveAt(resolver, scene, camera, 0, 0)
    expect(info?.exact).toBe(false)
    expect(info?.worldY).toBeCloseTo(0, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=graph-engine -- src/render/hover.test.ts`
Expected: FAIL — `exact` and `feature` are not on `HoverInfo`.

- [ ] **Step 3: Add the 'features' hover mode**

In `graph-engine/src/parser/config.ts`:

```typescript
export type HoverMode = 'all' | 'points' | 'features' | 'none'
```

In `graph-engine/src/parser/parseConfig.ts`, change the `hover` case:

```typescript
    case 'hover': {
      if (value !== 'all' && value !== 'points' && value !== 'features' && value !== 'none') {
        throw new Error(`@hover must be "all", "points", "features", or "none", got "${value}"`)
      }
      config.hover = value
      return
    }
```

- [ ] **Step 4: Implement snapping**

In `graph-engine/src/render/hover.ts`, extend the info type and import the kind:

```typescript
import type { FeatureKind, HoverMode } from '../parser/config'

export interface HoverInfo {
  worldX: number
  worldY: number
  screenX: number
  screenY: number
  label?: string
  // True when the reported position is a feature's exact location rather than
  // an interpolated point on a sampled curve. The marker is drawn differently
  // so an exact reading is visibly not a guess.
  exact: boolean
  feature?: FeatureKind | null
}
```

Add the snap constants above the class:

```typescript
// How close the cursor must be, in screen pixels, for a feature to capture the
// readout. Deliberately smaller than HOVER_MAX_SCREEN_DIST: snapping should
// feel like magnetism near the feature, not like the readout teleporting.
const SNAP_SCREEN_DIST = 22
// A feature within the snap radius beats a curve point this much nearer, so
// you can land on a vertex that sits directly on the curve you are tracing.
const FEATURE_BIAS_PX = 14
```

In `resolve`, extend the candidate record and the `consider` helper to carry the feature data, then apply the bias:

```typescript
    let best: {
      point: Vec2
      label?: string
      showGuide: boolean
      dist: number
      exact: boolean
      feature?: FeatureKind | null
    } | null = null

    const consider = (
      point: Vec2,
      label: string | undefined,
      showGuide: boolean,
      exact = false,
      feature: FeatureKind | null = null
    ) => {
      const screen = camera2d.worldToScreen(point.x, point.y, rectWidth, rectHeight)
      const raw = Math.hypot(screen.x - cursorScreen.x, screen.y - cursorScreen.y)
      if (raw > HOVER_MAX_SCREEN_DIST) return
      // A feature close enough to snap competes at a discounted distance, so a
      // vertex sitting on the curve wins against the curve sample beside it.
      const dist = feature && raw <= SNAP_SCREEN_DIST ? Math.max(raw - FEATURE_BIAS_PX, 0) : raw
      if (!best || dist < best.dist) {
        best = { point, label, showGuide, dist, exact, feature }
      }
    }
```

Change the `point` branch of the object loop to pass the new fields, and skip non-feature points in `'features'` mode:

```typescript
      if (obj.kind === 'point') {
        if (mode === 'features' && !obj.feature) continue
        consider(obj.position, obj.label ?? undefined, false, obj.exact ?? false, obj.feature ?? null)
      } else if (mode === 'all' && obj.kind === 'curve') {
```

Return the new fields:

```typescript
    return {
      worldX: target.point.x,
      worldY: target.point.y,
      screenX: screen.x,
      screenY: screen.y,
      label: target.label,
      exact: target.exact,
      feature: target.feature,
    }
```

- [ ] **Step 5: Run the full suite and type check**

Run: `npm run test --workspace=graph-engine`
Run: `npx tsc -b graph-engine/tsconfig.json --noEmit`

`SceneRenderer3D.ts`'s `HoverInfo3D` is a separate interface and is unaffected. If `GraphViewer.tsx` fails to compile, it is reading `hover.label` only and needs no change — check the error before editing it.

- [ ] **Step 6: Verify in the review harness**

At `http://localhost:5180#graph`:

```
@points: extrema
y = x^2 - 2x - 1
```

Hover near the vertex and confirm the readout locks to exactly `(1, -2)` rather than drifting through nearby decimals as you move the cursor.

- [ ] **Step 7: Commit**

```bash
git add graph-engine/src/render/hover.ts graph-engine/src/render/hover.test.ts graph-engine/src/parser/config.ts graph-engine/src/parser/parseConfig.ts
git commit -m "feat(graph-engine): hover snaps to feature points and reports exact values"
```

---

### Task 10: Update the review harness and the DSL reference

**Files:**
- Modify: `graph-engine/src/App.tsx:5-8` (the `POINTS_MODES` constant and `pointsModeFromConfig`)
- Modify: `GRAPH-DSL-REFERENCE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing downstream.

The harness's Points toggle still offers v1's four modes and maps them through `pointsModeFromConfig`, which reads `points.has('intercepts')` — a kind that no longer exists. Left alone, the toggle silently stops reflecting the spec.

- [ ] **Step 1: Fix the harness toggle**

In `graph-engine/src/App.tsx`, replace the points-mode plumbing:

```typescript
const POINTS_MODES = ['none', 'roots', 'extrema', 'all'] as const
type PointsMode = (typeof POINTS_MODES)[number]

// The parsed config only carries the expanded Set of concrete kinds — this
// maps it back to whichever toggle button should read as active.
function pointsModeFromConfig(points: Set<string>): PointsMode {
  if (points.size === 0) return 'none'
  const hasRoots = points.has('x-intercept')
  const hasExtrema = points.has('local-max')
  if (hasRoots && hasExtrema) return 'all'
  return hasRoots ? 'roots' : 'extrema'
}
```

Add example buttons exercising the new directives. In the `EXAMPLES` array, replace the `Vertices/intercepts` entry and add two more:

```typescript
  {
    label: 'Feature points',
    spec: `@points: roots, extrema, inflections
@point-labels: coords
y = x^3 - 3x`,
  },
  {
    label: 'Intersections',
    spec: `@points: intersections
y = x^2
y = x + 2`,
  },
  {
    label: 'No numbers',
    spec: `@labels: none
y = x^2 - 4`,
  },
  {
    label: 'Steps of 8',
    spec: `@xstep: 8
@ystep: 8
@step-mode: geometric
y = x^2   # zoom out: 8 -> 64 -> 512, never 10`,
  },
```

- [ ] **Step 2: Verify every example still renders**

Run `npm run review`, open `http://localhost:5180#graph`, and click through all example buttons. Expected: no parse errors in the error list under the textarea, and the four new examples behave as described.

- [ ] **Step 3: Update the DSL reference**

In `GRAPH-DSL-REFERENCE.md`, update the config-directive table: change the `@points` row's values to `roots`, `extrema`, `inflections`, `intersections`, `conic`, `all`, `none` with a note that `intercepts` and `vertices` remain accepted aliases; change `@hover` to include `features`; and add rows for `@labels`, `@label-every`, `@step-mode` and `@point-labels`. In the "Common mistakes" section, add the geometric-step rule as documented behaviour:

```markdown
5. **Expecting `@xstep` to survive a zoom.** By default it does not — outside
   3 to 14 visible divisions the step falls back to the universal 1-2-5 ladder,
   so a spec written in 8s shows 10s when zoomed out. Use
   `@step-mode: geometric` to keep the author's base: 8 → 64 → 512.
```

Update the "Where the source of truth lives" list: `detectFeaturePoints.ts` is gone, replaced by `graph-engine/src/scene/featurePoints.ts` and `graph-engine/src/scene/roots.ts`.

- [ ] **Step 4: Run the full suite one last time**

Run: `npm run test --workspace=graph-engine`
Run: `npx tsc -b graph-engine/tsconfig.json --noEmit`
Run: `npm run lint --workspace=graph-engine`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add graph-engine/src/App.tsx GRAPH-DSL-REFERENCE.md
git commit -m "docs(graph-engine): review harness and DSL reference for the track 1 directives"
```

---

## Deferred from this plan

The spec's Track 1 table lists feature derivation for five statement families.
This plan implements two of them — explicit `y = f(x)` and pairwise
intersections — and **deliberately does not implement the other three**. Named
here so the gap is a decision rather than an oversight:

| Spec row | Status | Consequence |
|---|---|---|
| Conics / implicit, solved analytically | **Not implemented** | `x^2/9 + y^2/4 = 1` produces no centre, foci or vertices. It also produces no *garbage*, which is an improvement on v1 — but `center`, `focus` and `conic-vertex` exist in `FeatureKind` with nothing emitting them |
| Polar: r = 0 crossings and extrema of r | **Not implemented** | `r = 2 + 2sin(3θ)` gets no feature points |
| Parametric: extrema of x(t) and y(t) | **Not implemented** | A parametric curve gets no feature points |

The three share a shape — each needs its own callable extracted from a
different statement kind, then feeds the *same* `findRoots` and
`explicitFeatures` machinery this plan builds. They are additive follow-up
tasks against a finished foundation, not a redesign.

Also absent from `FeatureKind` entirely, and therefore from the whole track:
`asymptote`, `hole`, and `endpoint`. The spec names them as feature kinds;
adding them means both a new kind and a detector, and neither is started here.

Nothing in this plan forecloses any of it.

## Verification

After all tasks, the following must hold:

1. `npm run test --workspace=graph-engine` passes.
2. `npx tsc -b graph-engine/tsconfig.json --noEmit` is clean.
3. `npm run lint --workspace=graph-engine` is clean.
4. An existing spec using `@points: intercepts` still parses — check with
   `node -e "const {parseSpec}=require('./graph-engine/dist/parser/index.js'); console.log(parseSpec('@points: intercepts\ny=x^2').errors)"`
   after a `npm run build:lib --workspace=graph-engine`, or simply confirm
   `parseConfig.test.ts`'s alias test passes.
5. In the review harness at `http://localhost:5180#graph`, the four new example
   buttons each render as described in their task's verification step.
