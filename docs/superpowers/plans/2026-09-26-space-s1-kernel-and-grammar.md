# Space S1 — Math Kernel, Grammar and Scene Builder

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** everything space needs in order to **compute** a scene, with no renderer change:
- `math/`: compiling, differentiating and simplifying expressions, plus roots, quadrature and small linear algebra;
- the space grammar: multi-parameter and vector definitions, surface domains, style clauses, the space directives and `@param`;
- a kernel that turns a parsed spec into the `SpaceScene` contract (typed arrays, analytic normals, exact domains, colour scales, dependency-tracked rebuilds);
- the import-boundary test.

**Architecture:**
- **`math/`** is engine-agnostic and pure.
- **`space/grammar/`** is reached from the shared parser through two hooks. Keyword forms are claimed first. Unkeyed forms are claimed just before the function-definition branch.
- **`space/kernel/`** holds a registry of builders, one per statement form. Each builder emits marks; `createSpaceKernel` assembles a scene and rebuilds only what a parameter touches.
- **The old code stays.** `buildScene3d` and `SceneRenderer3D` stay in place and in use until S2 swaps the renderer.

**Tech Stack:** TypeScript, Vitest (node environment). **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 3 "Revised 2026-09-26 — space is a hand-made engine". Read SP1, SP2, SP3, SP6 (parameters only), SP7, SP8, SP9 (the core forms), SP10 and SP11. Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first: "Worktrees, milestones and parallel agents", "How the engine is put together", and "Lessons that cost real time".

**The contract is already committed. Build against it; do not redesign it:**
- `graph-engine/src/space/scene/types.ts`: `SpaceScene`, the marks, `MarkSource`, `ColorSpec`, `ColorScale`, `SurfacePick`, `CurvePick`.
- `graph-engine/src/space/config.ts`: `SpaceConfig`, `Binding`, `TickStep`, `defaultSpaceConfig()`.
- `graph-engine/src/space/kernel/api.ts`: `SpaceKernel`, and `CreateSpaceKernel(statements, config, lines)`.

A change to any of these files is a ruling, recorded in the ledger. It must not break a consumer, and the S2 implementer builds against these files in parallel. Adding optional fields is allowed. Renaming or retyping is not, unless you ask first.

**Prior work to consume:**
- `parser/parseExpr.ts`: `parseExprString`, `ExprParser`. Calls already take any number of arguments.
- `parser/types.ts`: `Expr`, `Statement` (`surface`, `parametricSurface`, `parametric`, `point`, `segment`, `ray`, `vector`, `explicit`, `implicit`, `polar`, `functionDef`, `constantDef`).
- `parser/parseStatement.ts`: `parseStatementCore` (the order of its branches matters; see K5), `stripComment`, `parseForRange`, `splitTopLevelComma`, `parseTuple`.
- `parser/parseConfig.ts`: `parseConfigLine` and its `@key: value` rule.
- `scene/mode.ts`: `isThreeD`, `PLOTTED`, and `resolveMode`'s ordering (SOLID_FIGURE first; **do not reorder**).
- `render/marchingSquares.ts`: `traceImplicitCurve`, pure, for lifting 2D implicit curves.
- `scene/buildScene3d.ts`: what v1 draws, to be matched or exceeded form by form.

## Global Constraints

- **No new runtime dependencies.** No `new Function` or `eval`.
- **Do not edit `graph-engine/src/figure/**`.** It belongs to the solid-figure agent. Say "space" or "solid figures", never "3D engine" alone.
- **Shared files** (`parser/parseStatement.ts`, `parser/types.ts`, `parser/config.ts`, `parser/parseConfig.ts`, `parser/parseSpec.ts`, `scene/mode.ts`, `examples.ts`, `examples.test.ts`) get **additive changes at the hook points named in K5–K7 only**.
- **Every pre-existing spec parses to exactly the statements it did before.** The regression cases in Task 5 are the minimum. The byte-identity sweep in Verification is the proof.
- **Errors are returned, not thrown, past the kernel.** One bad statement never blanks the scene. Every error names its 1-based source line.
- **Determinism.** The same spec and parameter values give the same scene, typed arrays included.
- **Exactness is structural, never inferred.** No code inspects a float to guess a rational or a multiple of π. π-multiple ticks come only from an authored step (K9).
- **Proving a test means deleting the behaviour it covers,** not perturbing inputs. Record which deletion proved which test in each commit body. Hand-compute expected values independently of the code under test. Never use finite differences of the code under test as an oracle for `diff`.
- **All three checks clean before every commit,** run from the worktree root:
  - `npm run test --workspace=graph-engine`
  - `npx tsc -b graph-engine/tsconfig.json --noEmit`
  - `npm run lint --workspace=graph-engine`
- **Commits:** one per task, subject lowercase `type(scope): summary` (for example `feat(graph-engine): …`), body ending EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. That is a fixed repo convention, not a statement of which model ran. Stage explicit paths only: `git add <paths>`, never `-A` or `.`. Never `git stash`. Never push.
- **Worktree:** `.claude/worktrees/milestone-a-space`, branch `milestone-a/space`. Other agents' branches, worktrees and stash entries exist; leave them alone. If a file in this worktree changes under you, stop and report it. `cli/bin/osmosis.js` shows a line-ending-only modification from `npm ci`: leave it unstaged.

## Load-bearing decisions

**K1 — The compiler is slot-based and resolves everything at compile time.**
- **Interface** (`math/compile.ts`):
  ```ts
  compileScalar(expr: Expr, vars: readonly string[], scope: MathScope): CompiledFn
  compileVector(exprs: readonly [Expr, Expr, Expr], vars, scope): CompiledVec
  ```
  - `CompiledFn` is `(...args)` over `vars.length ≤ 3` numbers. Expose `fn1`/`fn2`/`fn3` shapes, or one `(a, b?, c?) => number`; either is fine, provided a hot loop allocates nothing per call.
  - `CompiledVec` returns into a caller-supplied `Float64Array(3)`, or returns a `Vec3`. Pick one and use it everywhere.
- **Names resolve at compile time:** a bound variable, a parameter slot, a user constant, a user function, `pi` or `e`, else an error naming the variable. Unknown names are compile errors, never per-sample throws.
- **Parameters** (`@param`) are read from `scope.params.values[slot]`, a shared `Float64Array`. Changing a parameter needs no recompile.
- **User functions are inlined** at compile time. Arguments are evaluated once, into let-slots. A cycle (`f` calls `g` calls `f`) is a compile error naming both. Arity is checked.
- **Built-ins** are the existing eight plus `asin acos atan atan2 sinh cosh tanh asinh acosh atanh sec csc cot floor ceil round sign min max hypot mod`.
  - `mod(a, b)` is floor-mod: `a - b*floor(a/b)`, which has the sign of `b`.
  - `round` rounds half away from zero.
  - `min`, `max` and `hypot` take two or more arguments.
  - `log(a, b)` keeps its existing meaning: log of `a` in base `b`.
- **Angle mode.** Under `@angle: degrees`, trig functions take degrees and inverse trig functions return degrees. `atan2` returns degrees.
- **The 2D evaluator is not touched.** `parser/evalExpr.ts` is unchanged.

**K2 — `MathScope` and function tables.**
```ts
interface MathFunction { params: readonly string[]; body: Expr | readonly [Expr, Expr, Expr] }  // tuple = vector-valued
interface MathScope {
  functions: ReadonlyMap<string, MathFunction>
  params: { index: ReadonlyMap<string, number>; values: Float64Array }
  angle: 'radians' | 'degrees'
}
```
- **Where the table comes from.** The kernel builds it from three sources: the existing `functionDef` (one parameter), `constantDef` (no parameters), and the new space definitions.
- **Using a vector function.** A vector-valued function used where a scalar is expected is a compile error. Components are reached through the space forms that consume vectors (S4), not through `.x` syntax in S1.

**K3 — Symbolic differentiation and simplification.**
- **`diff(expr, v, scope)`** returns an `Expr`. It covers every built-in and applies the chain rule through inlined user functions.
  - Non-smooth built-ins differentiate almost everywhere: `abs` gives `sign`; `floor`, `ceil`, `round`, `sign` and `mod` in its first argument give 0.
  - `min`/`max` differentiate through a `sign`-based selection.
  - `x^y` uses the general rule. When the exponent is constant in `v`, it uses the power rule so `x^2` at x = 0 does not produce `0 * ln(0)`.
- **`simplify(expr)`** is deterministic and structural:
  - constant folding of literals (π and e stay symbolic unless the whole subtree is numeric);
  - `0 + a`, `a + 0`, `a - 0`, `0 * a`, `a * 0`, `1 * a`, `a * 1`, `a / 1`, `a ^ 1`, `a ^ 0` (→ 1), `-(-a)`, `0 - a` → `-a`.
  - No factoring, expansion or reordering.
- **Consumers.** Gradients, normals and readouts compile `simplify(diff(…))`.

**K4 — Numerics.**
- **`linalg.ts`:** `det2`, `det3`, `solve2`, `solve3` (null when singular below a relative tolerance), and `symEig2`/`symEig3` (eigenvalues ascending, by closed form for 2×2 and Jacobi for 3×3).
- **`roots.ts`:** `newton(F, J, x0, opts)` in 1 to 3 dimensions, damped by backtracking, with a `converged` flag. Also `seededRoots(F, J, box, seedsPerAxis, opts)`: Newton from a grid of seeds, keeping converged points inside the box and deduplicating within `1e-7 × box diagonal`, returned in lexicographic order (determinism).
- **`quadrature.ts`:** `integrate1(f, a, b, tol)` is adaptive Gauss–Kronrod 7–15 and returns `{ value, error }`. `integrate2` and `integrate3` nest it for iterated integrals whose inner limits are functions of outer variables. Every result carries `error`, and a display that shows it prints the digits the error supports, prefixed `≈`.
- **One tolerance module.** Every tolerance is a named constant in `math/tolerance.ts`, with a comment saying what it bounds. `GEOM_EPS` (solid figures) is not used here.

**K5 — The two grammar hooks and what they claim.**
- **`parseSpaceKeyword(line): Statement | null`** is called **first** in `parseStatementCore`.
  - In S1 it claims only `implicit: <equation>` (the forced implicit-surface reading).
  - It is structured as a keyword table, so S4 and S5 add rows.
  - It returns `null` for `plane: A-B-C` and every point-list plane form. In S1 it does not claim `plane:` at all.
- **`parseSpaceUnkeyed(line): Statement | null`** is called **immediately before the `functionDefMatch` branch** in `parseStatementCore`, the earliest branch that could misread an unkeyed space form. It claims only a line carrying one of these signals:
  1. `NAME(p1, p2[, p3]) = <expr>` with **two or three** parameters → a multi-parameter scalar function.
  2. `NAME(p) = <v>` or `NAME(p1, …) = <v>`, where `<v>` is `<a, b, c>` or `⟨a, b, c⟩` → a vector function. **A tuple `(a, b, c)` on the right of a one-parameter definition is also a vector function.** Today it is a parse error, so no existing spec changes.
  3. `NAME = <a, b, c>` or `NAME = ⟨a, b, c⟩` → a vector constant. `NAME = (a, b, c)` stays a labelled point and is **not** claimed.
  4. `z = <expr> for x in [a, b], y in [c, d]` (either order), or `z = <expr> over <domain>` → an explicit surface with a domain.
  5. `z = <expr>`, a 3-component `(…) for t in […]` curve, or a `(…) for u in […], v in […]` surface, **followed by at least one SP8 style clause** → the same form with style. Without a clause these stay `surface`, `parametric` and `parametricSurface`, untouched.
  6. **An equation whose free variables include `z`** (after removing the names of defined functions and constants, `pi` and `e`), where the left side is **not** `z` alone and **not** a bare name other than `x` or `y` → an implicit surface. So `x = y^2 + z^2` and `x^2 + y^2 + z^2 = 4` are claimed; `k = z + 1` is not (it stays a `constantDef`). The defined-name exclusion needs the whole spec, so this rule is decided on free variables alone: `z` and the three names `x`, `y`, `z`. A line whose only `z` is inside a call to a user function is still claimed, which is correct: `f(x, y, z) = 1` has already been claimed by rule 1.
- **Never claimed:** `NAME = …` whose right side begins with a solid-figure word (`solid`, `midpoint`, `divide`, `foot`, `intersect`, `centroid`, `center of`, `plane`, `circumsphere`, `insphere`, `incircle`, `circumcircle`, …) or is a coordinate tuple. An equation with no `z` stays what it was: `x^2 + y^2 = 25` remains the 2D implicit curve.
- **Style clauses (SP8)** are stripped by the space grammar **only on a line a hook has claimed**. The shared trailing-clause loop in `parseStatement` is untouched. `color:` and `name:` are already stripped by the shared loop before the hooks run, and keep working on space lines.
- **The grammar's home.** It lives in `space/grammar/`. It may import `parser/parseExpr.ts`, `parser/tokenize.ts`, `parser/types.ts` (types), `math/`, `space/config.ts` and `space/scene/types.ts`. **It never imports `parser/parseStatement.ts`**, which imports it. Helpers it needs from `parseStatement.ts` (`parseForRange`, `splitTopLevelComma`, `parseTuple`) are either moved to a new `parser/grammarUtil.ts`, re-exported from `parseStatement.ts` so nothing else changes, or re-implemented in the grammar. Moving is preferred; it is a pure move with no behaviour change.

**K6 — Statement shape.** `parser/types.ts` gains one union member:
```ts
| { kind: 'space'; form: SpaceForm }
```
- `SpaceForm` is defined in `space/grammar/types.ts`. Its S1 members:
  ```ts
  | { form: 'function'; name: string; params: string[]; body: Expr }
  | { form: 'vectorFunction'; name: string; params: string[]; body: [Expr, Expr, Expr] }   // params may be []
  | { form: 'surface'; body: Expr; domain: Domain | null; style: SpaceStyle }
  | { form: 'parametricSurface'; fx: Expr; fy: Expr; fz: Expr; u: ParamRange; v: ParamRange; style: SpaceStyle }
  | { form: 'curve'; fx: Expr; fy: Expr; fz: Expr; t: ParamRange; style: SpaceStyle }
  | { form: 'implicitSurface'; left: Expr; right: Expr; forced: boolean; style: SpaceStyle }
  ```
  with
  ```ts
  ParamRange = { param: string; from: Expr; to: Expr }
  Domain =
    | { kind: 'rect'; x: ParamRange; y: ParamRange }
    | { kind: 'iterated'; coords: 'cartesian' | 'polar'; outer: ParamRange; inner: ParamRange }
    | { kind: 'inequality'; conditions: RegionCondition[] }   // conjunction, 'and' or ','
    | { kind: 'named'; name: string }                          // parsed now, resolved in S5
  ```
- **`SpaceStyle`** is `{ opacity: number | null; colormap: ColormapClause | null; mesh: boolean | null; res: number | null; width: number | null; dashed: boolean }`. A `null` field means "the form's default".
- **Each form validates which clauses apply.** For example, `width:` on a surface is refused with "width: applies to curves and lines, not to a surface".
- **The iterated domain's order.** The variable whose bounds are constant is the outer one. If both bounds are constant, the outer one is the variable written first. If each variable's bounds reference the other, the domain is refused.
- **Polar domains** use `r` and `theta`.
- **Inequalities:** `RegionCondition` reuses the shape of the existing `region`/`regionChain` statements (`left op right` or `low op mid op high`). Several are joined by `and` or `,`.

**K7 — Config, bindings and line numbers.**
- **Two fields and one delegation.** `GraphConfig` gains `space: SpaceConfig` and `bindings: Binding[]`, and `defaultConfig()` fills both. `parseConfigLine` delegates every key in SP7's table to `parseSpaceDirective(key, value, config)` in `space/grammar/directives.ts`, via one `case` list, or one `if` before the `switch`.
- **`@param` has no colon.** `@param a = 1 range [0, 5] step 0.1` and `@param n = 8 range [1, 30] integer`. `parseConfigLine` checks `/^@param\s/` before its `@key: value` split and delegates it. `@param: a = …` is also accepted.
- **Binding refusals:**
  - a malformed range;
  - `min ≥ max`;
  - `value` outside `[min, max]`;
  - a non-positive step;
  - a name that is `x`, `y`, `z`, `t`, `u`, `v`, `r`, `theta`, `rho`, `phi`, a built-in, `pi` or `e`;
  - a duplicate `@param`.

  A clash with a defined function or constant is a **kernel** error (it needs the whole spec).
- **`@param` is space-only for now.** The 2D renderer ignores bindings until track 4; a note in `config.ts` says so.
- **Directive syntax:**
  - `@bounds3d: x [-3, 3], y [-3, 3], z [0, 10]`: any subset, any order, and `min < max`.
  - `@aspect: equal | auto | a:b:c`: positive ratios.
  - `@projection: orthographic | perspective`.
  - `@camera: azimuth <deg>, elevation <deg>, zoom <k>`: any subset. Elevation within [-89.5, 89.5]; zoom > 0.
  - `@frame: box | axes | none`.
  - `@ticks3d: x <step>, …`. A step is an expression. When it is a rational multiple of `pi`, `TickStep.pi` is set. This is detected **structurally** from the parsed `Expr` (`pi`, `k*pi`, `pi/k`, `k*pi/m`, `(k/m)*pi`), never from the float.
  - `@titles: x "…", y "…", z "…"`.
  - `@colormap: <map>`.
  - `@resolution: <int 8–400>`.
  - `@depthcue: on | off`.
- **Line numbers.** `ParseResult` gains `statementLines: number[]`, parallel to `statements`, holding the 1-based source line of each. `parseSpec` fills it. That is the whole change to `parseSpec`.

**K8 — Scene building.**
- **`createSpaceKernel(statements, config, lines)`** is the `CreateSpaceKernel` from `kernel/api.ts`, exported from `space/kernel/index.ts`.
- **Setup.** It builds the `MathScope` once, compiles every statement once, and records each statement's parameter dependencies: the free variables that are bindings, followed transitively through the user functions it calls.
- **`setValue(name, v)`** clamps `v` to the binding's range and rounds it for an `integer` binding. It writes the slot, re-samples only the dependent statements, and returns a new `SpaceScene`. Marks of statements that do not depend on `name` are the **same objects** (`toBe`), which is what makes a drag cheap. An unknown name leaves the scene unchanged and changes nothing.
- **Registry.** Builders register by statement kind and space form in `kernel/registry.ts` as `(statement, context) => BuildResult`, where `BuildResult = { marks, labels, errors }` and `context` holds the scope, config, line, `MarkSource` and colour slot.
- **Colour slots** are handed out in source order to statements that draw, and are **stable across `setValue`**. The slot is a property of the statement, not of its output.
- **Hidden statements** (`@hide`) build nothing but still define functions.
- **Forms S1 builds**, meeting or exceeding v1 in each case:

  | Statement | Marks |
  |---|---|
  | `surface` (`z = f`) and space `surface` | `MeshMark` over the domain (K10), `scalars` = z, `uv` = (x, y), `colorScale` = height unless style says otherwise, `meshLines` at the x/y nice steps (K9), `pick: graph` with compiled `f`, `fx`, `fy` |
  | `parametricSurface` and space `parametricSurface` | `MeshMark`, `uv` = (u, v), mesh lines at the u/v nice steps, flat colour (slot) by default, `pick: parametric` |
  | `parametric` with `fz`, and space `curve` | `LineMark` with `params` = t, `pick` with `r` and `dr` (symbolic) |
  | lifted 2D `explicit`, `parametric` (no `fz`), `polar` | `LineMark` on z = 0 over the x extent (explicit) or the parameter range |
  | lifted 2D `implicit` | `LineMark`, polylines from `traceImplicitCurve` on z = 0 |
  | `point` | `PointMark`, plus a `LabelAnchor` when it has a label |
  | `segment` | `LineMark`, 2 vertices |
  | `ray`, `vector` | `ArrowMark`. `vector` also gets a magnitude `LabelAnchor`, as 2D does |
  | space `implicitSurface` | not built in S1: an error "implicit surfaces are drawn from phase S4" on its line. It still routes the spec to space |
  | space `function` and `vectorFunction` | nothing (definitions) |
  | any other statement in a space spec | error "`<kind>` is not drawn in space" (definitions, tables and `@hide`-hidden statements excepted) |
- **Defaults.** Line width 2.5 px for curves and 2 px for segments. Points are 8 px dots. `hidden: 'dashed'` for lines and arrows. Opacity 1 unless styled.
- **Resolution.** `res:` wins, then `@resolution`, then 96 per surface axis and 512 curve segments. Anything over 1,000,000 triangles is refused with a message that names the resolution.

**K9 — Nice steps and mesh lines.**
- **`space/frame/nice.ts`** exports `niceStep(span, target)`: the value on the 1-2-5 × 10ⁿ ladder **nearest to `span / target` in log scale**, with a tie going to the larger. It also exports `stepFor(span, target, authored: TickStep | null)`, where an authored step wins.
- **This is the module S2's ticks use.** It is created here so mesh lines and ticks agree.
- **For `z = f`:** mesh lines at `u0 = 0`, `du` = the x step (the authored `@ticks3d` x step, else `niceStep(domain x span, 8)`), and likewise for y.
- **For parametric surfaces:** steps on the u and v spans with target 12.

**K10 — Surface domains are exact.**
- **Rectangle and iterated domains** are the image of the unit square under the exact map:
  - rectangle: (s, t) → (a + (b−a)s, c + (d−c)t);
  - type I: x = a + (b−a)s, y = g1(x) + (g2(x) − g1(x))t;
  - type II: the same with the roles swapped;
  - polar: (θ, r) with inner bounds as functions of the outer variable, then (r cos θ, r sin θ).
- **Degenerate triangles are dropped.** Where inner bounds meet (y ∈ [x², x] at x = 0 and x = 1), the collapsed triangles go.
- **Crossing inner bounds are refused.** If `g2 − g1` changes sign across the outer range, the domain is refused: "the inner bounds cross near x = …".
- **Inequality domains** are sampled on the rectangle given by `@bounds3d` x/y, else [-5, 5]².
  - Triangles entirely inside are kept.
  - A triangle crossing the boundary is clipped. Each crossing point is found by bisection on the **true** condition along the grid edge (to `1e-10 ×` the edge length), and the clipped polygon is fan-triangulated.
  - Crossing points are **shared by edge key**, so the mesh has no cracks.
  - Vertex z is `f` at the new point.
  - A conjunction is clipped against each condition in turn.
- **Non-finite values.** A vertex whose z (or any coordinate) is not finite removes every triangle that touches it.
- **Normals:**
  - `z = f`: normal = normalise(−f_x, −f_y, 1) from compiled `simplify(diff)`.
  - Parametric: `r_u × r_v`.
  - Where the analytic normal is non-finite or zero (a sphere's pole), use the area-weighted mean of the incident face normals. Only if that is also zero is the normal the zero vector.
- **Extent and colour domain.** The robust-z rule of the `extent` contract, computed in `space/scene/extent.ts`, supplies both the scene's `extent.z` and a height colour scale's `domain`. When `@bounds3d` z is set, the colour domain is that range instead.

**K11 — Import boundaries are tested.** `src/space/boundary.test.ts` reads every `.ts` file under `src/space/` and `src/math/`, extracts their import specifiers, and asserts:
- no `three`, `react` or anything under `figure/`, anywhere in `space/` or `math/`;
- `math/` imports nothing from `space/`;
- `space/grammar/` imports only `parser/parseExpr`, `parser/tokenize`, `parser/types`, `parser/grammarUtil` (if created), `math/`, `space/config`, `space/scene/types` and its own directory;
- no file under `space/` except `space/gl/` references `WebGL` (a text search for `WebGL2RenderingContext` and `getContext(`);
- nothing under `space/` except `space/ui/` and `space/SpaceRenderer.ts` references `document.` or `window.`. (These directories arrive in S2; the test simply finds nothing to exempt yet.)

---

### Task 1: The compiler (`math/compile.ts`, `math/scope.ts`, `math/tolerance.ts`)

**Files:** Create `graph-engine/src/math/compile.ts`, `math/scope.ts` (MathScope, MathFunction, table building helpers), `math/tolerance.ts`, `math/compile.test.ts`.

**Interfaces:** Produces `compileScalar`, `compileVector`, `MathScope`, `MathFunction`, `CompileError` (an `Error` subclass carrying the offending name), and `freeVariablesDeep(expr, scope)` (free variables, followed through user functions).

- [ ] **Failing tests** (hand-computed):
  - built-ins in radians:
    - `atan2(1, -1)` = 3π/4 = 2.356194490192345;
    - `sec(0)` = 1; `cot(pi/4)` = 1 within 1e-15;
    - `sinh(1)` = 1.1752011936438014; `acosh(1)` = 0;
    - `hypot(3, 4, 12)` = 13; `min(3, -1, 2)` = -1;
    - `mod(-1, 3)` = 2; `mod(7, -3)` = -2;
    - `round(-2.5)` = -3; `sign(-0.5)` = -1; `log(8, 2)` = 3.
  - degrees: `sin(30)` = 0.5 within 1e-15; `asin(1)` = 90; `atan2(1, 1)` = 45.
  - variables: `compileScalar(x^2 - y^2, ['x','y'])` at (1, 2) = -3.
  - user functions:
    - `f(x, y) = x*y`, `g(t) = f(t, t+1)`: `g(2)` = 6;
    - an argument with a side-effect-free but costly expression is evaluated once (instrument with a counting built-in in a test-only scope, or assert the inlined tree binds a let-slot);
    - cycle `f(x) = g(x)`, `g(x) = f(x)` → `CompileError` naming both.
  - parameters: `a*x` with param `a` in slot 0. Set `values[0] = 3` → 6 at x = 2. Set `values[0] = 5` → 10 **with no recompile** (same closure object).
  - errors: an unknown variable `w` → `CompileError` at compile time, not at call; `f(1)` when `f` takes two → arity error; a vector function used as a scalar → error.
  - vector: `compileVector(<cos t, sin t, t>, ['t'])` at t = π → (-1, ~0, π).
- [ ] **Prove it:**
  - delete floor-mod (use JS `%`) → the `mod(-1, 3)` test fails;
  - delete the degrees conversion on inverse trig → `asin(1)` = 90 fails;
  - delete the param slot read (bake the value in at compile) → the no-recompile test fails.
- [ ] **Commit** `feat(graph-engine): math compiler — slot closures, full built-ins, multi-parameter and vector functions`.

### Task 2: Differentiation and simplification (`math/diff.ts`, `math/simplify.ts`)

**Files:** Create `math/diff.ts`, `math/simplify.ts`, and tests.

**Interfaces:** Produces `diff(expr: Expr, v: string, scope: MathScope): Expr`, `simplify(expr: Expr): Expr`, and `gradient(expr, vars, scope): Expr[]`.

- [ ] **Failing tests.** Assert values by compiling the derivative and evaluating it at points. Expected values are derived by hand, never by finite-differencing this code:
  - d/dx (x^2 y^3) = 2x y^3 → at (1, 2): 16; d/dy at (1, 2): 3x²y² = 12;
  - d/dx sin(x y) = y cos(x y) → at (π/2, 1): 0; at (0, 2): 2;
  - d/dx atan2(y, x) = -y/(x²+y²) → at (1, 1): -0.5;
  - d/dx x^x = x^x (ln x + 1) → at 1: 1; at 2: 4(ln 2 + 1) = 6.772588722239781;
  - d/dx x^3 at 0 = 0 and finite (power-rule path, no `ln 0`);
  - d/dx abs(x) at -2 = -1; d/dx floor(x) at 0.5 = 0;
  - chain through a user function: `f(x, y) = x^2 + y`, `g(t) = f(t, 3t)` → g′(t) = 2t + 3 → at 1: 5;
  - degrees mode: d/dx sin(x) = (π/180) cos(x) → at 0: π/180.
- [ ] **Simplify:**
  - `simplify(parse('0 + 1*x^1'))` is structurally `x`;
  - `simplify(parse('2*3 + x*0'))` is `6`;
  - `simplify(parse('-(-x)'))` is `x`;
  - `pi*2` stays symbolic unless numeric folding of `pi` is requested (it is not);
  - simplify is idempotent on a sample of 10 derivative outputs;
  - `diff` of a 3-level nested expression yields a tree smaller after `simplify` than before (a node-count assertion pins the folding).
- [ ] **Prove it:**
  - delete the power-rule shortcut → the x^3-at-0 test fails (NaN);
  - delete the `a*1` rule → the structural `x` test fails.
- [ ] **Commit** `feat(graph-engine): symbolic differentiation and a deterministic simplifier`.

### Task 3: Numerics (`math/linalg.ts`, `math/roots.ts`, `math/quadrature.ts`)

**Files:** Create each module with its test.

**Interfaces:** Produces the K4 signatures:
- `newton(F, J, x0, opts) → { x, converged, iterations }`;
- `seededRoots(F, J, box, seeds, opts) → Float64Array[]` (lexicographic);
- `integrate1/2/3 → { value, error }`;
- `symEig2/3 → number[]` (ascending).

- [ ] **Failing tests:**
  - `det3` of [[2,0,1],[1,3,2],[1,1,1]] = 0 (computed by hand: 2(3−2) − 0 + 1(1−3) = 0), and `solve3` on it returns null;
  - `symEig2([[2,1],[1,2]])` = [1, 3];
  - `symEig3` of diag(3, 1, 2) = [1, 2, 3], and of [[2,-1,0],[-1,2,-1],[0,-1,2]] = [2−√2, 2, 2+√2];
  - Newton on {x² + y² − 4, x − y}: from (1, 0.5) it converges to (√2, √2);
  - seeded roots of ∇(x³ − 3x + y²) = (3x² − 3, 2y) on [-3, 3]² with 6 seeds per axis gives exactly [(-1, 0), (1, 0)], deduplicated and ordered;
  - `integrate1(x², 0, 1)` = 1/3 within 1e-12, with `error` ≤ 1e-10;
  - `integrate1(sqrt(x), 0, 1)` = 2/3 within 1e-8;
  - `integrate2` of x·y over [0,1]² = 1/4;
  - type I ∫₀¹ ∫_{x²}^{x} dy dx = 1/6;
  - `integrate3` of 1 over the tetrahedron x, y, z ≥ 0, x + y + z ≤ 1 = 1/6;
  - the unit ball volume in spherical coordinates, ∫∫∫ ρ² sin φ, = 4π/3.
- [ ] **Prove it:**
  - delete deduplication → two copies of (1, 0) appear;
  - delete Kronrod adaptivity (single panel) → `sqrt` misses its tolerance.
- [ ] **Commit** `feat(graph-engine): numerics for space — Newton, seeded roots, adaptive Gauss-Kronrod, small linear algebra`.

### Task 4: Space grammar (`space/grammar/`)

**Files:** Create `space/grammar/types.ts` (`SpaceForm`, `Domain`, `ParamRange`, `SpaceStyle`, `ColormapClause`, `RegionCondition`), `space/grammar/keyword.ts` (`parseSpaceKeyword`), `space/grammar/unkeyed.ts` (`parseSpaceUnkeyed`), `space/grammar/domain.ts`, `space/grammar/style.ts`, `space/grammar/vector.ts` (vector literal `< >` / `⟨ ⟩` / tuple), and tests. Create `parser/grammarUtil.ts` if you move helpers (K5).

**Interfaces:**
- **Consumes** `parseExprString`, `Expr`, `Statement`.
- **Produces** `parseSpaceKeyword(line: string): Statement | null` and `parseSpaceUnkeyed(line: string): Statement | null`. Both return `{ kind: 'space', form, color: null, statementName: null }`; the shared wrapper overwrites `color` and `statementName` exactly as it does for every statement. Also produces the `SpaceForm` types (K6).

- [ ] **Failing tests** (unit, against the hook functions directly). Each claim rule K5.1–K5.6 gets a positive case:
  - `f(x, y) = x^2 - y^2`;
  - `F(x, y, z) = <-y, x, 0>`;
  - `r(t) = ⟨cos(t), sin(t), t/4⟩`;
  - `r(t) = (cos(t), sin(t), t)`;
  - `u = <1, 2, 3>`;
  - `z = x*y for x in [0, 1], y in [0, 2]`;
  - `z = x + y over x in [0, 1], y in [x^2, x]` → iterated, outer x;
  - `z = 1 over y in [0, 2], x in [0, y/2]` → outer y;
  - `z = r over r in [0, 2], theta in [0, pi]` → polar;
  - `z = 4 - x^2 - y^2 over x^2 + y^2 <= 4`;
  - `z = x over 1 <= x^2 + y^2 <= 4 and y >= 0`;
  - `z = x^2 opacity: 0.5`;
  - `(cos(t), sin(t), t) for t in [0, 6] width: 3`;
  - `x^2 + y^2 - z^2 = 1`;
  - `x = y^2 + z^2`;
  - `implicit: x^2 + y^2 = 4`.
- [ ] **Negative cases (each returns null):**
  - `x^2 + y^2 = 25`, `y = x^2`, `z = x*y` (plain), `k(x) = x^2`, `A = (1, 2, 3)`;
  - `k = z + 1`, `M = midpoint A-B`, `S = solid prism 8 by 5 by 6`, `p = plane x + y + z = 4`;
  - `plane: A-B-C`, `segment: A-B dashed`, `(cos(t), sin(t)) for t in [0, 6]`, `plane = 2`, `net = 5`.
- [ ] **Refusals (throw with the message, as every parse error does):**
  - `width: 3` on a surface;
  - `opacity: 2`;
  - `res: 1000`;
  - `colormap: height map neon` (unknown map);
  - `z = 1 over x in [0, y], y in [0, x]` (mutually dependent);
  - a vector literal with 2 or 4 components.
- [ ] **Prove it:**
  - delete the "not a bare name" guard in K5.6 → `k = z + 1` gets claimed;
  - delete the tuple exclusion in K5.3 → `A = (1, 2, 3)` gets claimed;
  - delete the style-clause requirement in K5.5 → `z = x*y` gets claimed.
- [ ] **Commit** `feat(graph-engine): the space grammar — definitions, domains, style clauses, implicit equations`.

### Task 5: Hooks, config, mode, line numbers (the shared files)

**Files:**
- **Modify** `parser/parseStatement.ts`: the two hook calls. If helpers moved to `grammarUtil.ts`, a re-export.
- **Modify** `parser/types.ts`: the K6 union member, and `statementLines` on `ParseResult`.
- **Modify** `parser/config.ts`: `space` and `bindings` fields and their defaults.
- **Modify** `parser/parseConfig.ts`: the K7 delegation.
- **Modify** `parser/parseSpec.ts`: fill `statementLines`.
- **Modify** `scene/mode.ts`: `'space'` in `PLOTTED`, and `isThreeD` true for `kind === 'space'`.
- **Create** `space/grammar/directives.ts`, `space/grammar/params.ts`.
- **Tests** in the existing `parseStatement.test.ts`, `parseConfig.test.ts`, `mode.test.ts`, `parseSpec.test.ts`, plus new directive and param tests.

**Interfaces:**
- Produces `parseSpaceDirective(key, value, config): boolean` (true when handled) and `parseParamLine(rest, line?): Binding`.
- `GraphConfig.space` and `GraphConfig.bindings`.
- `ParseResult.statementLines`.

- [ ] **Failing tests:**
  - **Every** K5 negative case through `parseStatement` (the full wrapper) yields **exactly** the statement it yielded before this task. Snapshot these by writing the expected objects out by hand, not from the new code. In particular:
    - `segment: A-B dashed` keeps `dashed: true`;
    - `plane: A-B-C` still throws the phase-8 "not drawn" message;
    - `z = x*y` is still `{ kind: 'surface' }`.
  - The K5 positive cases through `parseStatement` are `kind: 'space'`. `color:` and `name:` on a space line land on the statement: `z = x over x^2 + y^2 <= 1 color: purple name: s` → `color: 'purple'`, `statementName: 's'`.
  - `@param a = 1 range [0, 5] step 0.1` → `{ name: 'a', value: 1, min: 0, max: 5, step: 0.1, integer: false }`. Also `@param n = 8 range [1, 30] integer` and `@param: a = 1 range [0, 5]`. Refusals: every K7 case.
  - Directives: each SP7 row, one valid and one invalid.
    - `@ticks3d: x pi/2, z 0.5` → x `{ value: π/2, pi: { num: 1, den: 2 } }`, z `{ value: 0.5, pi: null }`;
    - `@ticks3d: x 1.5707963267948966` → `pi: null` (**no inference**);
    - `@camera: azimuth -30` keeps the default elevation 25 and zoom 1;
    - `@view` is still the solid-figure directive, unchanged.
  - `parseSpec('\n@theme: dark\nz = x*y\n\nA = (1,2,3)').statementLines` = [3, 5].
  - Mode:
    - a spec of only `z = x over x^2 + y^2 <= 1` resolves `graph`;
    - `S = solid prism 8 by 5 by 6` plus `z = x over x^2 + y^2 <= 1` resolves **`figure`** (the solid check stays first);
    - `x^2 + y^2 = 25` alone still resolves `graph` and `isThreeD` false.
- [ ] **Prove it:**
  - move the `parseSpaceUnkeyed` call to the top of `parseStatementCore` → at least one negative case changes (expected: `plane = 2`, `net = 5` or a construction). If none changes, the negative set is too weak; add the case that would have caught it;
  - delete the SOLID_FIGURE ordering → the solid-plus-space test fails;
  - delete the structural π detection → the `@ticks3d` test fails.
- [ ] **Commit** `feat(graph-engine): space hooks in the shared parser, space directives and @param, statement line numbers`.

### Task 6: The scene builder (`space/kernel/`, `space/scene/extent.ts`, `space/frame/nice.ts`)

**Files:** Create `space/kernel/index.ts` (`createSpaceKernel`), `kernel/registry.ts`, `kernel/scope.ts` (builds `MathScope` from the statements and bindings, and detects binding/definition clashes), `kernel/domain.ts` (K10), `kernel/surface.ts`, `kernel/parametric.ts`, `kernel/curves.ts` (space curves and lifted 2D), `kernel/primitives.ts` (points, segments, rays, vectors, labels), `kernel/normals.ts`, `space/scene/extent.ts`, `space/frame/nice.ts`, and tests for each.

**Interfaces:**
- **Consumes** Tasks 1–5 and the contract.
- **Produces** `createSpaceKernel: CreateSpaceKernel`, `niceStep(span: number, target: number): number`, `stepFor(span: number, target: number, authored: TickStep | null): number`, `robustRange(values: Float64Array | number[]): Range | null`, and `sceneExtent(marks: Mark[]): Box3 | null`.

- [ ] **Failing tests:**
  - **Rectangle surface.** `z = x + y for x in [0, 1], y in [0, 2]` at `res: 4`:
    - 25 vertices, 32 triangles;
    - vertex (i=1, j=2) is (0.25, 1.0, 1.25);
    - every normal = (−1, −1, 1)/√3;
    - `scalars` = z;
    - one `ColorScale`, domain [0, 3], map `viridis`;
    - `meshLines.du` = `niceStep(1, 8)` = 0.1 and `dv` = `niceStep(2, 8)` = 0.2, both with origin 0.
  - **Type I.** `z = 1 over x in [0, 1], y in [x^2, x]` at `res: 8`:
    - every vertex satisfies x² − 1e-12 ≤ y ≤ x + 1e-12;
    - the boundary vertices at s = 0.5 are exactly (0.5, 0.25) and (0.5, 0.5);
    - no zero-area triangle survives;
    - the mesh area (sum of triangle areas projected to xy) is within 2% of 1/6 at `res: 32`.
  - **Polar.** `z = 0 over r in [0, 1], theta in [0, 2*pi]`: every vertex has x² + y² ≤ 1 + 1e-12. Projected area → π within 1% at `res: 48`.
  - **Inequality.** `z = 0 over x^2 + y^2 <= 4` on the default [-5, 5]²:
    - every vertex satisfies x² + y² ≤ 4 + 1e-9;
    - every boundary vertex has |x² + y² − 4| ≤ 1e-8;
    - projected area within 1.5% of 4π at `res: 96`;
    - **no cracks**: every edge on the boundary is used by exactly one triangle, and every interior edge by exactly two.
  - **Crossing bounds.** `z = 1 over x in [0, 2], y in [x, 1]` → a scene error on its line mentioning "cross".
  - **Holes.** `z = 1/x for x in [-1, 1], y in [-1, 1]` at `res: 4` (a sample column at x = 0): the 16 triangles touching x = 0 are absent and the other 16 survive. No surviving triangle has a non-finite vertex, and there is no error (a hole is not an error).
  - **Analytic normals.** `z = x^2 - y^2`: the normal at (1, 2) is normalise(−2, 4, 1). The pick descriptor gives `f(1, 2)` = −3, `fx(1, 2)` = 2, `fy(1, 2)` = −4.
  - **Sphere pole fallback.** `(cos(u) sin(v), sin(u) sin(v), cos(v)) for u in [0, 2*pi], v in [0, pi]`: the normal at a pole vertex is (0, 0, ±1) within 1e-6, not zero.
  - **Curves.** `r(t) = <cos(t), sin(t), t>` used as `(cos(t), sin(t), t) for t in [0, 2*pi]`: 513 vertices, `params[0]` = 0 and `params[512]` = 2π, `pick.dr(0)` = (0, 1, 1).
  - **Lifted.** `y = x^2` in a space spec is a `LineMark` with every z = 0. `x^2 + y^2 = 1` is `LineMark` polylines with every vertex at radius 1 ± the tracer's tolerance.
  - **Primitives.** `A = (1, 2, 3)` gives a `PointMark` at (1, 2, 3) and a `LabelAnchor` "A". `vector: (0,0,0) -> (1,2,2)` gives an `ArrowMark` with vector (1, 2, 2) and a label "3" (|v| = 3).
  - **Colour slots.** Two surfaces get slots 0 and 1. `color: purple` on the first gives `author: 'purple'`, and the second keeps slot 1.
  - **Errors carry lines.** A spec whose line 4 is `circle: (0,0), 1`, alongside a surface → error `{ line: 4, message: /not drawn in space/ }`. The surface still builds.
  - **Parameters.** `@param a = 1 range [0, 3]`, `z = a*x for x in [0,1], y in [0,1]`, `A = (0, 0, 1)`:
    - `setValue('a', 2)` doubles the surface's max z;
    - the point's mark is `toBe` the same object as before;
    - `setValue('a', 9)` clamps to 3;
    - an integer binding rounds 2.6 → 3;
    - `setValue('nope', 1)` leaves the scene unchanged.
  - **Transitive dependency.** `f(x, y) = a*x`, `z = f(x, y)`: the surface rebuilds when `a` changes.
  - **Clash.** `@param a …` plus `a = 5` → a kernel error naming `a`.
  - **Robust z.** `z = 1/(x^2 + y^2) for x in [-1, 1], y in [-1, 1]` at `res: 96`: `extent.z.max` is less than 0.2 × the largest finite sample (the percentile rule fired). `z = x for x in [0, 1], y in [0, 1]` has extent z = [0, 1] (the rule does not fire).
  - **Budget.** `res: 400` on a parametric surface is accepted (≈ 320k triangles); a form that would exceed 1,000,000 is refused with a message naming the resolution.
  - **`niceStep`**, the nearest ladder value in log scale: (1, 8) = 0.1; (2, 8) = 0.2; (10, 8) = 1; (7, 8) = 1; (0.3, 8) = 0.05; (2π, 8) = 1.
- [ ] **Prove it:**
  - delete the edge-key sharing → the crack test fails;
  - delete the bisection refinement → the boundary tolerance test fails;
  - delete the pole fallback → the normal is zero;
  - delete the identity reuse in `setValue` → the `toBe` test fails;
  - delete the percentile rule → the robust-z test fails.
- [ ] **Commit** `feat(graph-engine): the space scene builder — exact domains, analytic normals, colour scales, parameter rebuilds`.

### Task 7: Boundary test, examples, and the examples-test branch

**Files:** Create `space/boundary.test.ts` (K11) and `space/examples.ts` (`SPACE_EXAMPLES`). Modify `examples.ts` (concatenate `SPACE_EXAMPLES` after `EXAMPLES`' own entries) and `examples.test.ts` (in its `'graph'` branch, when `isThreeD`, build with `createSpaceKernel(...).scene()` and assert no errors and at least one mark).

**Interfaces:** Produces `SPACE_EXAMPLES: Example[]`, the same `Example` type.

- [ ] **Space examples,** one per new capability, each labelled `Space · …`:
  - a paraboloid over a disk;
  - a saddle over a type I region;
  - a polar-domain surface;
  - a sphere with a named vector function `r(t)` for a helix on it;
  - a surface whose height is `a*x^2 + y^2` with `@param a`;
  - a `@ticks3d: x pi/2` trig surface;
  - `@frame: axes` with points and vectors.

  The existing `3D` example keeps working unchanged.
- [ ] **Failing tests:** the boundary test (it must fail first: temporarily add `import 'three'` to a scratch file under `space/`, see it fail, then remove the scratch file); examples parse and build.
- [ ] **Prove it:** delete the `isThreeD` branch in `examples.test.ts` → a space example with an error in it (introduce one temporarily) is no longer caught. Restore it.
- [ ] **Commit** `test(graph-engine): space import boundaries, and space examples that must build`.

## Verification

- All three checks clean.
- **The byte-identity sweep.** Write it as a scratch script, not a committed test. Parse every spec string in `EXAMPLES` and every string literal passed to `parseSpec(` or `parseStatement(` in `src/**/*.test.ts`, at `63a19d9` (the merge base) and at HEAD. Compare `JSON.stringify` of `{ statements, errors }`, ignoring the new `statementLines` and `config.space` / `config.bindings` fields.
  - Every difference must be a K5 claim of a line that was previously a parse error, or an `implicit` equation containing `z` that is now `kind: 'space'`.
  - List each difference in the phase report.
  - For every figure-mode example, also render `renderFigure` at both commits under each `@view` and diff the SVG strings. These must be identical.
- **Measure** `setValue` on a 128×128 surface with a `vite-node` scratch script (median of 20 runs), and report it. The budget is 8 ms.

## Out of scope

- Any renderer, WebGL, DOM, camera or frame drawing (S2).
- Colormap tables, the colorbar, mesh-line drawing, picking UI and sliders (S3).
- Implicit-surface meshing and every keyword statement beyond `implicit:` (S4, S5).
- `over R` named regions resolve in S5. In S1 a named domain is an error: "named regions arrive with region: (phase S5)".
- The 2D renderer's use of `@param` (track 4).
- `server/src/domain/bootstrap.ts` (deferred by the user).
