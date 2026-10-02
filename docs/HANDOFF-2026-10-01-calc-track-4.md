# Handoff — Track 4 (calc-proofing), P1 complete, 2026-10-01

Written at the end of phase P1 for whoever picks this up next. It records what
is not recoverable from the code: where the work lives, what each task shipped,
what has been agreed with the other sides, and the rules that bind every task.

## Where the work lives

- **Worktree:** `.claude/worktrees/milestone-a-calc`. **Branch:**
  `milestone-a/calc`, cut from `milestone-a/main` at **`d1a8ef4`**. Nothing is
  merged to `milestone-a/main`; it merges only on Ben's go-ahead.
- **Spec (binding):** `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`.
- **Plan for this phase:** `docs/superpowers/plans/2026-10-01-calc-p1-kernel-language.md`.
  The interval twin and the registry triple test are the companion plan **P1b**,
  not yet written.
- **The 3D engines are off-limits** (Ben, 2026-10-01): this track edits nothing
  under `graph-engine/src/space/` or `graph-engine/src/figure/`, nor
  `scene/buildScene3d.ts` or `render/SceneRenderer3D.ts`. Importing from them
  unchanged is fine, and 2D now imports space's `buildScope`.

## What P1 shipped

Seven tasks, in order. The suite went from 4050 tests at `d1a8ef4` to **4370**,
all green; both typechecks and `oxlint src` clean; `figure/cleanGolden.test.ts`
73/73 (figure renders byte-identical); space's scene sweep `identical 49; differ 0`.

1. **Exact rationals and real odd roots.** `x^(1/3)` takes the real root, read
   from the exponent's shape (never a float), exact through `diff` and `simplify`.
2. **Special functions.** `gamma`, `erf`, `erfc`, `cbrt`, `step`, `choose`,
   `perm`, `gcd`, `lcm`, `root`, each with an exact derivative or a refusal.
3. **Reserved constructs.** Conditions, piecewise, factorial and `f'` stored as
   reserved `__…` calls (`math/reserved.ts`, so the `Expr` union never changed);
   names called as products (`x(x + 1)`); `CompileError` in `math/errors.ts`.
4. **Binders.** `sum`, `prod` and `integral` on both compile paths, infinite
   bounds, the Leibniz rule, capture-free substitution.
5. **The parser.** Bars, `n!`, primes, function powers (`sin^2(x)`), piecewise
   braces, conditions (`and`/`or`/`not`/`!=`/chains), the sum/product/integral
   forms; a bare `!=` outside an `if` is refused, not read as a factorial.
6. **`if` on every plot form.** `where?` (a condition as reserved calls) on
   explicit, implicit, region and regionChain statements; bracket-aware relation
   scanning; a scalar multi-parameter definition alone is 2D.
7. **The 2D engine on the kernel** (this task). `scene/buildScene.ts` and
   `scene/buildTable.ts` compile through `math/compile.ts` with a scope from
   `plot/scope.ts` (space's `buildScope`, unchanged). Errors name their lines; a
   typo in an explicit, polar or parametric statement is a compile error instead
   of a blank plot; `y = f(x) if <condition>` takes any condition on `x` and
   never bridges a gap; `where` restricts implicit curves, regions and chained
   regions; a curve undefined across the whole view says so; the viewer passes
   `parseSpec`'s `statementLines`. Eight new examples in a `Calculus` group.
   `GRAPH-DSL-REFERENCE.md` describes the end state.

What deliberately changed for existing 2D specs: errors carry line numbers; a
typo is an error, not an empty plot; `theta = 1` no longer collapses
`r = 1 + cos(theta)` (a bound variable wins over a constant); a definition
clash is reported on its line; a domain that is not one interval no longer
bridges its gap; a direction-field tick with an undefined (NaN) slope is
skipped instead of pushing NaN vertices. Values for valid existing specs are
unchanged (the same IEEE operations): every pre-existing example and a set of
other specs were compared old engine against new, identical but for those
changes.

A 2D scene's errors depend on the view ("this curve is undefined everywhere in
view" for `y = ln(x)` once the view is left of 0), so `GraphViewer` delivers the
error list on a pan/zoom rebuild too, but only when it differs from the last list
delivered (`viewerErrors.ts`, `createErrorReporter`); a text or theme rebuild
always delivers.

What still evaluates through `parser/evalExpr.ts`, on purpose:
`scene/geometry/buildConstructions.ts` (shared with the figure engine). `animate:`
no longer does: `buildScene` compiles both coordinates through the kernel
(`compileScalar`, so a mistake lands on its statement's line at build time and the
whole language works in the path), the scene's `animatedPoint` object carries the
two closures, and the renderer calls them per frame. A construction error still comes
out of `buildConstructions` with line 0; `buildScene` maps it to its statement's
line by order (the failed constructions are the ones with no
`objectsByStatement` entry), and keeps line 0 if the counts ever disagree.

## Coordination state

**With space** (the session that owns `graph-engine/src/space/`, "Calculus 3D
engine for graphing"):

- **Cadence:** after each task that touches `math/` or `parser/` passes review,
  the controller messages space with the summary and the sweep result; before
  any merge, a summary and a fresh sweep. Space asks to be told before calc
  changes anything it imports, and calc asks space to tell calc before changing
  `space/kernel/scope.ts`'s `buildScope` signature (2D now imports it).
- **Space's pending items, landing on `milestone-a/space-calc-compat` (cut from
  calc's head):** its `where` guard (space keeps it until calc's first merge;
  `where` is live in 2D as of this commit); lifting its refusals of built-in names as definitions
  (`space/grammar/params.ts`, `space/kernel/scope.ts`,
  `space/keywords/integrals.ts`, `space/grammar/unkeyed.ts`) so a document's own
  value shadows a built-in *function* name, with the exact error text for the
  other role; running `paramCallsAsProducts` before its `renameVars` and polar
  substitutions; replacing the wall-clock assertions in its math tests with
  operation counts; printing the reserved names in its expression text. Calc
  merges that branch before going to `milestone-a/main`. When it lands, 2D
  inherits the new scope rule; `plot/scope.test.ts` deliberately pins only
  "a name defined twice is reported on its line", not the old built-in refusal.
- **The mode rule** in `scene/mode.ts` is agreed with space and changes for
  exactly one case (2026-10-01): a spec whose only space statements are scalar
  multi-parameter `function` definitions moves from 3D to 2D, so
  `g(x, a) = a sin(x)` with `y = g(x, 2)` plots. A scalar `function` form alone
  no longer routes a spec to space; a vector function still does. Every other
  spec routes as it always did.
- **When P4 starts,** space adds the two-ratio `@aspect` and the 2D reading of
  `@titles`; calc requests it of space and does not make it here.

**With geometry** (`milestone-a/geometry`): the movement constants of its visual
pass part 2 are pending; this track uses them rather than inventing its own.

## Open items before the merge

- **Fixed in the final-review wave (from space):** `simplify` folded float
  arithmetic into whole numbers and so created an odd-root exponent
  (`x^(0.5*2/3)` became real-rooted after `simplify`), which broke "never
  inferred from a float". An operation with a non-integer operand and an integer
  result is now kept as written, and a literal argument that diff or `f'`
  substitutes into a body is folded to its number, so neither makes a literal
  ratio the author never wrote.
- **Interim, replaced in P3:** `where` on an implicit curve, region or chained
  region keeps a segment by its midpoint and a triangle by its centroid, so a
  cut edge follows the grid. P3 replaces it with exact clipping.
- **Stale condensed reference:** `server/src/domain/bootstrap.ts`'s
  `GRAPH_DSL_REFERENCE` (lines ~48-55) still says there is no `if` clause on a
  region. It is outside `graph-engine/`, so it was not changed here; update it
  with the next server change.
- **Deferred review minors** are listed per task in
  `.superpowers/sdd/2026-10-01-calc-p1-kernel-language/progress.md` for the
  final review to triage.

## Rules that bind every task

- **Never edit** `graph-engine/src/space/`, `graph-engine/src/figure/`,
  `scene/buildScene3d.ts` or `render/SceneRenderer3D.ts`. If a space or figure
  test fails, stop and report it verbatim.
- **`math/` edits are additive;** after any task touching `math/` or `parser/`:
  the full suite green, both typechecks clean, and space's sweep reporting
  `identical 49; differ 0`.
- **The typecheck** is `npx tsc -p tsconfig.app.json --noEmit` and
  `npx tsc -p tsconfig.node.json --noEmit`, from `graph-engine/`. The bare
  `npx tsc --noEmit` checks nothing (the root config is a solution file).
- **Tests:** `npx vitest run <path>`; the whole suite takes about 85 s and,
  on a loaded machine, wants `--maxWorkers=3` (an occasional "Timeout calling
  onTaskUpdate" with no failing test is load; rerun once). Lint: `npx oxlint src`.
- **The sweep** lives in `graph-engine/.sweep/` (local, never committed; excluded
  in `.git/info/exclude`): `npx tsx .sweep/scenes.mts` from `graph-engine/`
  compares space's 49 example scenes at `d1a8ef4` against the current tree.
- **Commits:** stage explicit paths only (never `-A` or `.`), never `git stash`,
  and every message ends with exactly `Co-Authored-By: Claude Opus 5
  <noreply@anthropic.com>` (a fixed repo convention, not a model name).
- **Compile-time refusals are `CompileError`s** thrown inside compile, never per
  sample. Derivative rules are exact or refuse. No `Math.random`, `Date` or
  clock in `math/` or `plot/`. Reserved names and shapes are stable.
- **Other agents work in other worktrees** at the same time; leave their
  branches, worktrees and stash entries alone. No browser tools and no review
  servers in P1.

## What is next

1. **P1b — the interval twin** (`math/interval.ts`) and the registry triple test
   (every built-in has its scalar implementation, its interval twin and its
   derivative rule, registered together). Written as its own plan; the twin is
   consumed only from P2 on.
2. **P2 — the adaptive curve sampler,** structural singularities, bands and the
   new curve marks, with the renderer adapted; it replaces the window-relative
   jump rule in `sampleExplicit`.
3. Then P3 (implicit and region quadtree), P4 (frame), P5 (features, hover and
   `@param` in 2D, which today reads as a constant with no slider), and the
   vocabulary V1–V6.
