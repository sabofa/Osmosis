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

## What P2 shipped (the adaptive curve sampler)

P2 replaced the 400-uniform-sample curve path with an adaptive sampler in `graph-engine/src/plot/sample/`, wired into `scene/buildScene.ts` (`buildScene(statements, bounds, config, resolution?, lines?, { widthPx, heightPx, quality, budget? })`): it works in screen pixels, `quality` is `'coarse'` while a gesture runs and `'full'` at settle, and `Scene.stats` counts the evaluations. Nothing is connected unless certified, by the interval twin or the pixel-scale jump test; the structure walk (`structure.ts`, `locate.ts`, `limits.ts`) finds and types poles, jumps, holes and edges; `band.ts` draws oscillation faster than a pixel as the extent it sweeps; the scene contract (`scene/types.ts`) carries chains with their parameters, typed breaks, `mark`s (hole, endpoint, value; open or filled by the condition's operator, irrational seams included), `band`s and asymptote `line`s, and `render/renderItems.ts` draws them. Settled rulings: a capped curve says `drawn coarsely:` (something drew) or `not drawn:` (nothing did), a depth-limited steep stretch says `too steep to draw here:`, and polar's default range is a full turn in the current angle unit. The acceptance test is the torture corpus (`plot/testing/corpus.ts`: 62 cases with pinned evaluation ceilings, run by `corpus.test.ts` in about 25 s, which also samples the true curve densely over every segment and fails one that spans a jump (`plot/testing/dense.ts`); every later phase adds its cases there), and it is seen headlessly with `npx vite-node graph-engine/scripts/calc-contact-sheet.ts <out dir>` (SVG pages from `plot/testing/svgScene.ts`, screenshotted with headless Edge as that script's header says, never in the browser pane). Three known limits are pinned as cases whose expectations encode today's behaviour, each with its reason in the case: an uncertified (UNKNOWN-twin) curve's dip into the view about a pixel wide can be culled off screen (`farOff`); `gamma` left of about -11 reads its weak poles as holes; `x + 0.1 sin(500x)` at COARSE draws as an aliased slow wave (about a 95 px period, 4 px high: the 8 px start grid steps 100 rad of the wave, -0.53 rad a sample), not as a line, and not as bands. (`(1 - x^2)^0.1`, a root too slow to draw to, still stops short of its tips on a grid-aligned view: it is not a case.) The corpus also made one tuning change: the spike test is now asked only `spikeDepth` (3) halvings below the start grid (`tuning.ts`, `adaptive.ts`), because a form the twin cannot enclose tightly (`exp(x^2) - exp(x^2) + x`) was refined to the floor and capped the FULL budget (39036 points, 30133 intervals, "drawn coarsely"), and is now 25417 and 8933 with no note. Two defects the corpus's cases exposed were fixed in review: a cancelling form such as `(x + 1)^2 - x^2 - 2x` (the line y = 1) had its rounding noise (about 1e-14) read as an oscillation and was drawn as bands 1e-14 px tall, which the viewer fills at 0.18 and so shows as nothing, over 92 % of its width, with no message (a column whose samples span under `flatPx` is now flat and not a band: `bandColumn` in `adaptive.ts`; it is one chain, 20 of 20 units); and `ln x` stopped a floor's width short of its edge (142 px short of the bottom of [-10, 10], `log x` 288), because a diverging edge was a singular end (it is a free end now, so the core samples to the edge, refines it on definedness and the sink cuts the curve at the clip box; the classified edge break is kept and the core's repeat of it dropped). The log of a quadratic (`ln(1 - x^2)`, `ln(x^2 - 4x + 3)`) still stopped a floor short, because the twin's enclosure is loose next to the zero and refuses the last stretch whole: that stretch is now walked in certified pieces (`walkEdge`, `CORE.edgePieces`, `edgeSplits`), and an interval the twin leaves unbounded is bisected below the floor and what it certifies is drawn (an enclosure that is still unbounded at 1/1024 px is where a pole may sit, and is lifted with its jump as before), which also removes the jump break a floor and a half from `ln(x^2 - 4x + 3)`'s edge at 3. The suite is 7189 tests, green, with both typechecks, lint and the space sweep (`identical 49; differ 0`) clean.

The whole-branch review's fix wave (report: `.superpowers/sdd/2026-10-03-calc-p2-adaptive-sampler/final-fix-report.md`, commits 264fced to 4f12168) changed these things a later phase should know. The exemption for the last stretch to an anchor is certified by the floor test asked of every half (a dense staircase was bridged to the anchor of its jump). A zero of a denominator or a built-in's pole that is not an exact double is asked of the twin (`pointAt`): `sin(x)/sin(x)` has a hole at every k pi. (A guard that opened both ends of an irrational seam where a natural spot shares it was tried and removed: it was wrong for `{x^2 <= 2: sqrt(2 - x^2) + 1, 0}` and six other forms, and the comparison owns its seam as before; `{x^2 <= 2: sin(x^2 - 2)/(x^2 - 2), 5}` and `{x^2 <= 2: floor(x^2), 5}` fill an end the curve is not at, a pinned known limit.) The anchored depth-limit leaf of the floor test is asked of the twin too, so a staircase denser than the leaves (`floor(100000x)`) is not drawn to the anchor of its jump. A singular end is walked to the clip box (poles reach the top and bottom at any zoom), and a steep root's tip that settles without converging (`limits.ts` `approaching`, `LIMITS.settlePx`) is an edge with its extrapolated limit. A curve in view that draws nothing always says why (`blankInView`, the new "could not be certified anywhere in view" note), a curve defined only at points is those points (filled value marks), and "drawn coarsely" counts only drawing in view. The budget counts what an integral costs: `math/binders.ts` exports `integrandEvaluations()` (additive; the one `math/` change P2 made), `CurveFns.work` carries it to the core, a point costs `max(1, inner / CORE.innerPerPoint)` points (100), and the columns of an UNKNOWN twin are screened by their midpoint before they are tried as bands. COARSE chords are 16 px (with `spikeFactor` 4 so that 4 x 16 keeps the old 8 x 8 bound: at 8 an oscillation aliased into chords), `LOCATE.maxZeros` is 256, the walk's and locator's caps live in `tuning.ts`, and runs of the core's jump breaks a floor apart are one. The corpus is 62 cases, checks the notes of every view, and checks every segment against the true curve sampled densely (`plot/testing/dense.ts`); `plot/testing/rationals.test.ts` is the seeded property test of random rationals against their analytic poles and holes. Open: the start grid of an integral that costs tens of thousands of integrand evaluations a point is still evaluated whatever the budget (seconds, not minutes), and a negative power base is not asked by the twin check (its reason is a root's).

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
   jump rule in `sampleExplicit`. (Built: see "What P2 shipped".)
3. Then P3 (implicit and region quadtree), P4 (frame), P5 (features, hover and
   `@param` in 2D, which today reads as a constant with no slider), and the
   vocabulary V1–V6.
