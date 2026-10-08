# Calc P4: the frame — implementation plan

> **For agents:** this plan runs under Learn `build/osmosis/AGENT-SYSTEM.md`. The main chat splits each task into the subtasks below in the ledger, dispatches fresh Sonnet implementers (≤2 in parallel, batches of 1–3 subtasks on the same files), runs one Sonnet review per task on its commit range, and does at most two fix rounds. Subtasks are about ≤150 lines and ≤4 files, test-first.

**Goal:** the plot's frame, as the spec's "The frame (P4)" says: aspect and bounds (including space's two-ratio `@aspect a:b`), precise labels, π ticks, labels that follow the view, axis titles, log axes, and deep zoom. Spec: `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`, "The frame (P4)" and its acceptance table.

**Written:** 2026-10-08 (night shift), plan only. Branch `milestone-a/calc`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, P3 closed at `4d45486`.

---

## What P4 builds on, and what it must not duplicate

**The 2D handling model** (geometry's `milestone-a/geometry`, `graph-engine/src/view2d/`; spec `docs/superpowers/specs/2026-10-04-2d-handling-design.md`, handoff `docs/handoffs/HANDOFF-2026-10-07-2d-handling.md` in that worktree). It is built and waiting for Ben's re-check on :5181 before it merges into `milestone-a/main`. Read for this plan: `feel.ts`, `limits.ts`, `camera.ts`, `types.ts`, `index.ts`, and the spec's section on the plot variant.

What it gives P4:
- **`feel.ts`:** every movement and zoom constant (`SMOOTH_TAU`, `COAST_*`, `EASE_DURATION`, `WHEEL_SENSITIVITY`, `PINCH_WHEEL_SENSITIVITY`, `KEY_*`, `ZOOM_MIN/MAX`, `PAN_MARGIN`). Calc's spec already says P4 uses these constants and invents none (the interaction budget paragraph).
- **`limits.ts`:** `LimitsPolicy { zoomMin, zoomMax, panMargin }` and `clampCamera`. Deep zoom is a different policy, not a fork.
- **`motion.ts`, `input.ts`, `pointing.ts`, `readout.ts`:** smoothing, coasting, eased resets, wheel/pinch/key decoding, hit tolerance and the coordinate readout formatting.
- **`camera.ts`:** one camera `{ cx, cy, zoom }` with **one isotropic scale** (`basePxPerUnit`, `zoomAbout`, `panByScreen`).

What it says about plots (its spec, "Later, not now"): "the 2D graphing engine gets a **custom variant** of this model later: the same core and feel, but its camera changes the plotted window rather than magnifying a drawing." **P4's camera work is that variant.** It extends the core and must not fork it.

What today's plot camera is: `render/camera2d.ts` (87 lines, calc's worktree): an orthographic camera with one `viewHeight`, equal aspect only, zoom clamped to 1e-3..1e6, its own pan and zoom maths, and `SceneRenderer`'s own wheel and drag handlers. P4 replaces it.

**The gap, and the ruling this plan proposes (subtask 5.0 confirms it):** view2d's camera is isotropic; the plot needs a different pixels-per-unit per axis (`@bounds` stretch, `@aspect a:b`, `auto`) and log axes. Plan: the plot camera works in **"frame space"**: content coordinates `X = a·u(x)`, `Y = b·v(y)`, where `u` and `v` are the axis scales (identity or log10) and `a:b` is the aspect (the number of px a unit of x and a unit of y are drawn at zoom 1; `equal` is 1:1; `auto` is whatever fits the bounds to the screen). In frame space the view2d camera is isotropic, so view2d's `zoomAbout`, `panByScreen`, `clampCamera`, motion and input work **unchanged**. A one-axis zoom (modifier + wheel) changes `a` or `b`, not the camera. If 5.0 finds the core cannot be used this way without an edit, the edit is a small additive change to view2d that geometry signs off (gate below).

## Dependencies on 2D handling merging into `milestone-a/main`

| Tasks | Needs view2d? | Can start before the merge? |
|---|---|---|
| T1 directives and config (1.2, 1.3) | no | yes |
| T1.1 `@aspect a:b` | no, but **space's agreement** (it edits space's directive parser) | after space says yes |
| T2 the pure frame (labels, π, log ticks, `frameTicks`) | no | yes |
| T3 the frame renderer (grid, titles, svgScene axes) | no | yes |
| T4 log scales in the samplers | no | yes |
| **T5 the camera (all of 5.0–5.6)** | **yes** | **no: starts after the merge** |
| T6 corpus, examples, docs | rows 1–3 and 5 of the acceptance table need no view2d; row 4's no-jitter half needs 5.5 | partly |

**Ben's rule for tonight: the build starts after 2D handling merges.** If Ben wants calc's independent half earlier, T1–T4 can run before it; T5 cannot.

**Before T5 starts:** merge `milestone-a/main` (with 2D handling in it) into `milestone-a/calc`. Expected conflicts: `GraphViewer.tsx` (geometry put it on view2d for figures; calc's T5/T6 edited the plot path), `parseConfig.test.ts`, `config.ts`. Resolve keeping both, then run the full checks and the sweep (it must still print `identical 49; differ 0`). Do this as its own step in the ledger ("T5.pre"), not inside a subtask.

## Global constraints

**Where you may work**
- Working tree: the calc worktree, branch `milestone-a/calc`. Run commands from `graph-engine/`.
- **Never edit** `src/space/` (except 1.1 once space agrees, and only that one parser branch), `src/figure/`, `scene/buildScene3d.ts`, `render/SceneRenderer3D.ts`, `server/`, `web/`, `render/marchingSquares.ts`. `math/` is read-only. **Never edit `view2d/`** without geometry's sign-off; a needed change is requested in a message, with the exact additive change, and waits.
- Shared files (`parser/*`, `examples.ts`, `GraphViewer.tsx`, `GRAPH-DSL-REFERENCE.md`) are edited additively. Statements that parse today keep their meaning.

**The rules that don't bend** (spec): 1 nothing connected unless certified (log axes change coordinates, not this); 2 errors are never silent and notes are true; 3 deterministic (no `Math.random`, `Date`, `performance.now` in `math/` or `plot/`, tests included); 4 generic marks with identity; 5 nothing else moves (figure goldens, space, existing tests green; `identical 49; differ 0`).

**Checks** after every task:
- `npx vitest run --maxWorkers=2` (never more workers);
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`;
- `npx oxlint src`;
- `npx tsx .sweep/scenes.mts` → `identical 49; differ 0`;
- from the repo root, `npx vite-node graph-engine/scripts/calc-contact-sheet.ts <dir>` exits 0.

**Working rules:** Sonnet for every agent; stage only your own paths with explicit `git add` (never `-A`); never `git stash`; no merges into main or `milestone-a/main`, no pushes; commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` unless the session's attribution says otherwise; Edit/Write for repo files; no browser tools in agents (the controller takes headless screenshots); Edge always with a timeout, never kill other processes.

**Numbers** live in one place: `plot/frame/tuning.ts` (new in 2.1) for the frame's, view2d's `feel.ts` for movement. No tuned literal elsewhere.

---

## Task 1: Directives and config (parse only)

Files: `parser/config.ts`, `parser/parseConfig.ts` (+ tests), and for 1.1 `space/grammar/directives.ts`, `space/config.ts`.

- **1.1 `@aspect a:b`** (gated on space). Today `parseAspect` accepts `equal | auto | a:b:c`. Add the two-ratio form `a:b` as a second variant of `SpaceConfig['aspect']` in the same parser, not a fork. Request to the space session first (message, with the exact diff: one new branch in `parseAspect`, one union member). Test: `@aspect: 2:1` parses to `{ kind: 'xy', x: 2, y: 1 }` (shape per space's existing representation); 3-ratio, `equal`, `auto` unchanged; zero or negative refused with the existing message style; space's own tests green. **Acceptance:** space's directives tests and the sweep stay green, and space signed off the diff.
- **1.2 `@xscale` / `@yscale: linear | log`.** New `GraphConfig.scales: { x: 'linear' | 'log'; y: 'linear' | 'log' }`, default linear. Anything else is a parse error naming the key and the choices. Test: both forms parse; `@xscale: ln` refused with its message; default unchanged.
- **1.3 Log bounds validation.** A log axis with a bound ≤ 0 (explicit `@bounds`) is a config error on the directive's line ("log axis needs a positive range"). With no `@bounds`, the default window on a log axis is a positive one (x: 0.1..10 unless `@bounds` says otherwise; decide with 5.1's fit). Test: `@bounds: [0, 10] x [1, 5]` with `@xscale: log` errors; `[0.1, 10]` doesn't.

Review: one Sonnet review on the task's range; space's sign-off on 1.1 stands in for geometry-style gating.

## Task 2: The pure frame (labels, π, log ticks)

Files: new `plot/frame/{tuning,labels,pi,logTicks,ticks}.ts` and tests. All pure functions, no DOM, no three.

- **2.1 Precise labels** (`labels.ts`, `tuning.ts`). `formatTick(value, step, neighbours)`: the fewest digits that tell a label from its neighbours; scientific notation (`1.2×10⁻⁵`, superscripts) when the largest label's magnitude reaches 10⁵ or the step falls below 10⁻⁴; U+2212 for minus; never `−0`. Test (table): step 0.2 → `0.2, 0.4`; step 1e-5 around 1.0000 → `1.00001, 1.00002`; 10⁵-magnitude labels in scientific form; `-0` prints `0`. **Acceptance:** the table, and no two neighbouring labels equal at any step in a property loop (200 seeded cases).
- **2.2 π ticks** (`pi.ts`). Reuses space's `TickStep { value, pi: {num, den} | null }` (import the type; do not copy it). `piLabel(k, step)` labels the k-th tick as an exact rational multiple (`π/2, π, 3π/2, 2π`, `0`, `−π/2`) from the numerator and denominator, never inferred from the float. `piStepFor(span, target, base)` keeps the π family under `@step-mode nice` as the view zooms (π/4 → π/2 → π → 2π, and so on). Test: the label table for `pi/2` and `pi/6`; the step ladder across spans 0.5π..40π is monotone and always a member of {1,2,5}-style π ladder `{π/12, π/6, π/4, π/3, π/2, π, 2π, 5π…}` (pin the ladder in the test). **Acceptance:** the table and the ladder.
- **2.3 Log ticks** (`logTicks.ts`). `logTicks(lo, hi)` for a positive range: decade ticks labelled `10³` (superscript digits), minor ticks 2–9 within each decade, and a drop to decades only when minors would be closer than a tuned px gap (`tuning.ts`). Test: range 1..1e4 → decades 1, 10, 10², 10³, 10⁴ and minors 2–9 per decade; range 1e-3..1e9 → decades only; a range inside one decade (3..8) → minors with plain labels (`3, 4, 5…`). **Acceptance:** the three cases.
- **2.4 `frameTicks`** (`ticks.ts`). One pure function `frameTicks(view, config): { x: Tick[]; y: Tick[] }` with `Tick { value, label, kind: 'major' | 'minor', position }`; it picks linear / π / log per axis, applies `shouldLabel` density rules (`@labels`, `@label-every`; move the rule's logic here, `grid.ts` re-exports `shouldLabel` so nothing else changes), and **pins labels to the nearest edge** when the axis line is off-screen (`position` is the world coordinate of the label's anchor on the axis, clamped to the view minus a margin). Test: the acceptance row "panned so the y-axis is off-screen" → y labels have `position.x` = the view's left edge (plus the tuned margin); on-screen axis → at the axis. **Acceptance:** that row and the three scale/step kinds produce the right tick lists. (If this exceeds 150 lines, split: 2.4a the tick lists, 2.4b the pinning.)

## Task 3: The frame renderer (consumes `frameTicks`)

Files: `render/grid.ts`, `render/axisLabelPool.ts`, `render/labelLayout.ts`, `plot/testing/svgScene.ts` (+ tests).

- **3.1 GridRenderer reads `frameTicks`.** `drawGrid` takes its gridlines and labels from `frameTicks` (major lines, faint minor lines for log, labels pinned), instead of its own `resolveStep`/`niceStep` loop. `niceStep`, `resolveStep` keep their exports and behaviour (tests pin them; `frameTicks` calls them). Test: `render/grid.test.ts` extended: a linear view produces the same gridlines as before (golden over the existing cases); a log view produces decade lines. **Acceptance:** existing grid tests green unchanged, plus the log case.
- **3.2 Axis titles.** `@titles: x "t (s)", y "v (m/s)"` (space's directive; 2D reads `config.space.titles.x/.y`; empty means none) drawn at the axis ends in the textbook way (x title under the right end, y title at the top, away from tick labels; layout is a pure function in `labelLayout.ts`). Test: layout does not overlap the tick labels for a 800×600 and a 300×200 view; empty title draws nothing. **Acceptance:** the layout tests.
- **3.3 svgScene draws the frame.** `sceneToSvg` gains an optional `frame` argument (the `frameTicks` result plus titles) drawing axes, ticks and labels, so the contact sheet and corpus show them. Test: a `frame` with π ticks puts `π/2` text at the right x; without `frame` the output is byte-identical to today's (the existing corpus and sheet unchanged). **Acceptance:** that pair.

## Task 4: Log scales in the samplers

Files: `plot/sample/types.ts`, `plot/sample/curve.ts` (+ its helpers), `plot/implicit/{statement,types}.ts`, tests. The spec's rule: "the scale is a transform the sampler works through: explicit curves subdivide evenly in log x; the quadtree evaluates at transformed coordinates. A value ≤ 0 on a log axis is a domain edge, not an error."

- **4.1 `View` carries the scales.** `View { bounds, widthPx, heightPx, xScale?, yScale? }` (default linear; every existing caller unaffected). One module `plot/frame/scale.ts` (pure): `Scale { forward(x), inverse(u), domainLo }`, with log10 and identity; `worldToScreenPx(view, p)` and `screenPxToWorld` go through it. Test: round trips to 1e-12; identity scale leaves every existing sampler test byte-equal (full suite green). **Acceptance:** the suite plus the round-trip table.
- **4.2 Explicit curves through the transform.** The sampler's x range is sampled evenly in `u = log10 x` (screen px), and flatness is measured in screen px of the transformed y. A y log axis does the same for y. A point with x ≤ 0 on a log x axis is outside the domain: an edge break, as `ln x` today (no error). Test (the acceptance rows): `y = e^(-x)` with `@yscale: log` is straight: every chain vertex within 0.25 px of the chord through the ends, and the vertex count is ≤ 8; `y = x^3` log-log is a line of slope 3 in screen px (±0.5°); `y = ln(x)` with x log has a break at ≤ 0. **Acceptance:** those three.
- **4.3 Polar and parametric on log axes.** Their parameter samples are unchanged; only the px mapping goes through the scale. Test: a parametric `(10^t, 10^(2t))` on log-log is a line of slope 2. **Acceptance:** that test. (If 4.2 already covers it through the shared mapping, record that and close this one with the test only.)
- **4.4 The quadtree at transformed coordinates.** `plot/implicit` cells live in `(u, v)`; H is evaluated at `(inverse(u), inverse(v))`; the twin's boxes map through the monotone `inverse` (interval hull); leaf size is in screen px as today. Region fill and outline come out in world coordinates. Test: `x*y = 1` on log-log is a straight line; `1 < x*y < 10` on log-log is a band between two parallel lines; `y < ln(x)` on x-log has no fill at x ≤ 0; determinism. **Acceptance:** those, plus P3's whole implicit suite unchanged on linear scales.
- **4.5 Overscan and gesture on log axes.** The overscan box (25 %) is in `u`-space; `viewChangeAction`'s scale test compares spans in `u`/`v`. Test: `viewChangeAction` for a log view; a pan of 10 % of the decades skips. **Acceptance:** that test.

## Task 5: The camera (depends on 2D handling being merged)

Files: new `render/plotCamera.ts` (+ test), `render/SceneRenderer.ts`, `render/camera2d.ts` (retired), `GraphViewer.tsx`. Imports `view2d/` (feel, limits, camera, motion, input, readout).

- **5.pre** Merge `milestone-a/main` into `milestone-a/calc` (see Dependencies). Checks, sweep.
- **5.0 Decide the adapter (no code).** Read `view2d/motion.ts`, `input.ts`, `pointing.ts`, `readout.ts` and the spec's plot-variant notes. Write the ruling into the ledger: (a) confirm "frame space" (`X = a·u(x)`, `Y = b·v(y)`) lets view2d's functions run unchanged, or list exactly the one additive change needed in view2d (to request from geometry); (b) the modifier for one-axis zoom (taken from geometry's constants, or a request for one); (c) what the plot variant exports (`PlotView`, `plotCameraOf(bounds, aspect, scales, screen)`, `boundsOf(camera, …)`). **Acceptance:** the ruling is in the ledger with signatures; no code.
- **5.1 `plotCamera.ts` (pure).** `boundsToCamera` / `cameraToBounds` / `aspectScales(aspect, bounds, screen)`:
  - **equal** (default when `@bounds` gives at most one range): 1 px per unit on both axes at the fit, so circles are round;
  - **both ranges given:** both honoured exactly; the plot stretches (aspect derived from the screen);
  - **`a:b`:** px per unit in x : px per unit in y = a : b at zoom 1; **`auto`:** fills the screen like both-ranges;
  - log axes enter through `Scale.forward`.
  Test: round trip bounds → camera → bounds to 1e-9 for each aspect and scale; `equal` makes a circle's px width = height; `2:1` gives px-per-unit ratio 2; the acceptance row `@bounds: [0, 2pi] x [-1.2, 1.2]` fits one period of `sin x` to the view exactly. **Acceptance:** those.
- **5.2 SceneRenderer on the plot camera.** `SceneRenderer`'s own pan and zoom maths (and `Camera2D`) are replaced by the plot camera driven by view2d's input decoding, smoothing, coasting and eased reset, all with `feel.ts`'s constants; the three orthographic camera is set from `cameraToBounds`. The P3 gesture hooks (`builtBounds`, `viewChangeAction`, `refreshPixelSizes`, settle) keep working unchanged. Test: a pure test of the renderer's view bookkeeping (a scripted wheel and drag sequence over the plot camera gives the bounds a hand calculation says); the rest is typecheck + sweep + the controller's headless check. **Acceptance:** the scripted test; the contact sheet unchanged; Ben's feel check on a plot (not a review gate).
- **5.3 One-axis zoom.** With a non-equal aspect, the modifier (from 5.0) plus the wheel zooms one axis: changes `a` or `b` about the cursor, keeping the point under it still. Test: modifier + wheel at a point changes the x span only, the point under the cursor stays within 1e-9. **Acceptance:** that test.
- **5.4 `@bounds` is live.** Editing `@bounds` in the spec re-applies it (today the camera is built once). The rule: re-apply only when the parsed `@bounds`/`@aspect`/`@xscale`/`@yscale` differ from the previous parse (the user's own pan and zoom survive edits to other lines). Pure `frameChanged(prev, next)` decides; `GraphViewer` calls it. Test: editing a curve's text doesn't move the view; editing `@bounds` does. **Acceptance:** the test.
- **5.5 Deep zoom.** (a) A `LimitsPolicy` for plots: zoom range so the view height spans 1e-9..1e12 (spec; from 1e-3..1e6), from the 5.1 fit, as numbers in `plot/frame/tuning.ts`. (b) Renderer-relative float32: scene geometry is built in float64 world coordinates and sent to the GPU relative to the build window's origin (subtract in float64 when writing positions; the camera translates by the origin), so a 1e-8 window around x = 1000 doesn't quantise. Test: positions written for a curve in a 1e-8 window around x = 1000 are distinct float32 values at sub-pixel steps (max jitter < 0.1 px against the exact curve); the zoom clamp keeps the limits; `viewChangeAction` unaffected. **Acceptance:** that test, and the acceptance row (distinct labels from 2.1, smooth curve). May split into 5.5a (policy) and 5.5b (origin-relative positions), which touch `geometryGroup.ts`/`renderItems.ts` (calc's; keep P3's quad-index reuse).
- **5.6 Readouts and feature coordinates.** Hover readouts and feature-point labels print enough digits for the current zoom (view2d's readout formatting if it fits, else the 2.1 formatter): replace `scene/format.ts` `formatCoord`'s fixed two decimals with `formatForSpan(value, span)`. Test: at span 1e-8 around 1000 the readout shows ≥ 9 significant digits; at the default view the existing outputs are unchanged (existing tests). **Acceptance:** both.

## Task 6: Corpus, examples, docs, handoff

- **6.1 Corpus** (`plot/testing/corpus.ts` + test): the five acceptance rows as cases, using `frameTicks` for the label expectations (extend `expect` with `ticks?: { x?: string[]; y?: string[] }`, non-vacuous: must be non-empty); log cases check straightness in px; the deep-zoom window checks distinct labels and no float32 jitter; pinned ceilings as before.
- **6.2 Contact sheet and examples:** the sheet draws the frame (3.3); a "Frame" group of examples in Calculus (π ticks, semi-log, log-log, a deep zoom, an anisotropic `@aspect: 2:1`).
- **6.3 Docs:** `GRAPH-DSL-REFERENCE.md` (`@aspect`, `@xscale/@yscale`, `@xstep: pi/2`, `@titles`, live `@bounds`), the spec's "As built (P4)", the handoff, and the Learn sync (spec copy, DSL reference, PROJECTS row).
- **6.4 Final whole-branch review** (Sonnet) on the P4 range: seams (camera ↔ sampler scales ↔ frameTicks ↔ renderer ↔ svgScene), leftovers (Camera2D gone), tuning, rules; then the Learn sync.

## Order and batches

1. `T1.2–1.3`, `T2` (2.1 → 2.2, 2.3 in parallel), `T4.1`: no view2d, no space.
2. `T1.1` when space agrees; `T2.4`; `T3`; `T4.2–4.5`.
3. After the merge and 5.pre: `5.0` → `5.1` → `5.2` → `5.3`, `5.4`, `5.5`, `5.6`; then `T6`.
Max 2 implementers in parallel; one review per task; hand off at ~400k context.

## Risks and open questions for Ben

- **Space's agreement** to a two-ratio `@aspect` in its directive parser (1.1). If space refuses, the plot parses `@aspect: a:b` itself in 2D config only, which forks the key — the spec says not to; ask first.
- **Geometry's agreement** if 5.0 finds one additive change is needed in `view2d/` (per-axis scale). The plan is shaped so none is needed.
- **The modifier key for one-axis zoom:** chosen from geometry's movement constants (shift is multi-select in figures; plots have none). Ben's call if the constants have none.
- **Cost on log axes:** the quadtree's leaf sizes are in screen px, so a log axis over many decades puts many cells where the curve is; the budget and notes apply as in P3, and 4.4 pins the cost in the corpus.
- **View2d's own pending merge:** geometry's phase 13 and open items #2 and #5 come before it merges; T5 waits for all of it, and for Ben's re-check.
