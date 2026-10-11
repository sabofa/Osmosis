# Space S4b — The Calculus of a Surface: Contours, Traces, Tangent Planes, Gradients, Extrema, Lagrange

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the OpenStax Calc Vol. 3 ch. 4 vocabulary for a function of two variables:
- level curves, on the surface and projected onto the floor;
- paths on a surface (for limits along paths);
- traces with their tangent lines (partial derivatives);
- tangent planes and the normal (for `F(x, y, z) = c` as well);
- the gradient with its level curve;
- directional derivatives;
- classified critical points;
- Lagrange multipliers, for two and three variables.

**Architecture:**
- **Grammar and builders.** Each statement is a keyword row in `space/grammar/keywords/surfaceTools.ts`, with builders in `space/kernel/surfaceTools/*.ts`.
- **The target.** Every statement takes a **target**: a defined two-variable function name (`f`), or an inline expression in x and y (`x^2 - y^2`).
- **The domain** is the box's x/y range (`@bounds3d` or [−5, 5]²), unless the statement gives `over <rect>`.
- **The surface is not drawn for you.** Statements do not draw it; the author writes `z = f(x, y)` beside them, which keeps each statement composable.
- **Derivatives** are symbolic (`math/diff`). Roots come from `math/roots`, and eigenvalues from `math/linalg`.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** Track 3 "Revised 2026-09-26", the SP9 rows 4.1–4.8. Read the S1 and S3 plans for `math/*`, the grammar hooks, the registry, `setValue`, `pick/format.ts` and the marks.

**Parallel work:** S4a (surfaces in space) and S5 (integrals) are built at the same time.
- **S4a owns the grammar of `contour:`** (`grammar/keywords/contour.ts`), and dispatches a **two-variable** target to a builder named `contourCurves` that **this phase registers** in `kernel/surfaceTools/contours.ts`.
- **If S4a has not merged when you start,** write the `contourCurves` builder against the `{ form: 'contour', target, levels, floor, labels }` shape given in S4a's plan, A2. The controller merges S4a first.
- **Shared files** (the keyword table, the registry index, `space/examples.ts`): add lines at the end of each list only.

## Global Constraints

- Everything in the S1 plan's Global Constraints still binds.
- The worktree is `.claude/worktrees/milestone-a-space-s4b`, branch `milestone-a/space-s4b`.
- **Every statement:** has an example; refuses legibly in its own words; takes `color:` (and `opacity:` on its meshes); names its marks `s<line>.<part>`.
- **Keyword ownership:** `parseSpaceKeyword`'s uniform rule (S4a) applies, so `path: A-B-C` (a hyphenated point list) is never claimed; add that case to the test. Solid figures reserve `fill:`, `net:`, `shortest:`, `dihedral:`, `angle:`, `right-angle:`, `segment:`, `tick:`, `cut:` and `section:`.
- **Readouts** use `pick/format.ts`. Nothing is inferred exact. Numeric answers from Newton carry `≈`.
- **Parameters work through `setValue` for free.** A statement whose target or point reads a binding rebuilds on a change. A test pins this for `tangent-plane:` at `(a, b)`.
- **Looking at renders:** use a headless Edge screenshot from PowerShell, then Read the PNG:
  `Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -Wait -NoNewWindow -ArgumentList @("--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=$env:TEMP\claude-headless-edge","--window-size=1400,900","--virtual-time-budget=6000","--screenshot=<out.png>","<url>")`
  **Never open a review page in the in-app browser pane or Chrome.** Each load asks the user to approve the site, and they are away.
- **Example groups:** if `Example` has a required `group` (added on the geometry side), space examples use `group: 'Space'`.

## Load-bearing decisions

**B1 — Targets and points.**
- **A target** resolves to a compiled `f(x, y)` with symbolic `f_x`, `f_y`, `f_xx`, `f_xy` and `f_yy`, built once per statement.
- **A point** `(a, b)` is a pair of expressions, which may read bindings (that is how a slider or a drag moves a tangent plane).
- **A target of three variables** (`F(x, y, z)`) is accepted where noted: `tangent-plane:`, `gradient:`, `lagrange:`.

**B2 — Level curves** (`contourCurves`).
- **Tracing.** Level curves are traced with `render/marchingSquares.ts`'s `traceImplicitCurve` (the existing pure tracer) on `f − c` over the domain, at `res` (default 160). Each crossing is then refined by bisection along its grid edge on the true f, to 1e-10.
- **Placement.** Each level draws on the surface at `z = c` exactly, and, with `floor`, a projected copy on the box floor (dashed, 1 px).
- **Colour.** A line is coloured by its level's value on the spec's colormap (a flat colour when `color:` is given).
- **`labels`** puts a `LabelAnchor` with the value at the point of each level's longest polyline nearest its midpoint.
- **Levels** are as in S4a A2.

**B3 — Paths.**
- **Syntax:** `path: on f along (x(t), y(t)) for t in [a, b]`.
- **Drawn:** the space curve `(x(t), y(t), f(x(t), y(t)))` (a `LineMark` with `pick`), plus its floor shadow (dashed).
- **With `toward (x0, y0)`,** the target point is also marked on the floor, and a ring marks where the path is heading, at `(x0, y0, value)`. The value is the limit **along this path**, estimated by evaluating at `t` approaching the end nearest (x0, y0) over the sequence `1e-2, 1e-3, …, 1e-8` and taking the last finite value. It is shown with `≈` and never asserted exact. It is a readout, not a proof.

**B4 — Traces.**
- **`trace: f at x = 2`** draws:
  - the curve `(2, y, f(2, y))` over the domain's y range;
  - the vertical plane x = 2, as a box-clipped patch (reuse S4a's plane ∩ box, or a local rectangle when S4a has not merged; the controller reconciles at merge) at opacity 0.2;
  - a projected 2D copy of the curve on the matching back wall (dashed), which is how a textbook shows "the trace in the plane".
- **`trace: f at y = 1`** is the same with the roles swapped.
- **`… tangent at y = 1`** (for an `x =` trace) adds the tangent line at (2, 1, f(2, 1)) with direction (0, 1, f_y(2, 1)), spanning the box. Readout: slope `∂f/∂y (2, 1)`.

**B5 — Tangent planes.**
- **`tangent-plane: f at (a, b)`** is the plane `L(x, y) = f(a,b) + f_x(a,b)(x − a) + f_y(a,b)(y − b)`. It is drawn over the square `[a − s, a + s] × [b − s, b + s]` with `s = 0.2 ×` the domain's larger span, clipped to the box, at opacity 0.5 with an outline, plus the point.
  - **`normal`** adds the arrow `(−f_x, −f_y, 1)`, normalised, × 0.18 of the box span.
  - **Readout:** `L(x, y) = …`, written with the formatted coefficients (`−3 + 2(x − 1) − 4(y − 2)`), signs folded in (`+ −4` never appears).
- **`tangent-plane: F at (x0, y0, z0)`** for three-variable F is the plane through the point with normal ∇F, drawn as a square patch of the same size in that plane.
  - **Refusal:** ∇F = 0 → "∇F is zero at (…); the tangent plane is undefined".
  - **Refusal:** the point not on a level surface of interest is **not** checked. The plane is through the point, and the readout shows `F(x0, y0, z0)`.

**B6 — Gradients.**
- **`gradient: f at (a, b)`** draws:
  - the arrow ∇f(a, b) = (f_x, f_y, 0) at true length, from (a, b) on the floor;
  - the level curve of f through (a, b) on the floor (B2 at the single level c = f(a, b));
  - a small right-angle mark where they meet, in the floor plane.
  - **`lifted`** puts the arrow at (a, b, f(a, b)) in the horizontal plane instead, and draws the lifted level curve on the surface.
  - **Readout:** ∇f, |∇f|, and the direction of steepest ascent as an angle (per `@angle`).
- **`gradient: F at (x0, y0, z0)`** draws ∇F at true length from the point.
  - **`surface`** adds the level surface through the point (S4a's marching tetrahedra; before S4a merges, this clause is an error on its line).
- **Zero gradient:** drawn as the point plus the readout "∇f = 0 (a critical point)".

**B7 — Directional derivatives.**
- **`directional: f at (a, b) toward <u1, u2>`** normalises u. It draws:
  - the unit arrow u on the floor from (a, b);
  - the vertical plane through (a, b) along u (a box-clipped patch, opacity 0.2);
  - the trace curve `s ↦ (a + s·u1, b + s·u2, f(…))` across the domain;
  - the tangent line to that curve at s = 0 with slope `D_u f = ∇f · u`.
- **Readout:** `D_u f`, u, and ∇f.
- **Refusal:** a zero u.

**B8 — Critical points.**
- **`critical: f`** (optionally `over <rect>`) runs `seededRoots` on ∇f = 0 with the Hessian as Jacobian: 12 seeds per axis over the domain, deduplicated.
- **Classification** by `symEig2` of the Hessian, with tolerance `1e-9 · max(1, |H|)`:
  - both eigenvalues > 0: **local min**;
  - both < 0: **local max**;
  - opposite signs: **saddle**;
  - any eigenvalue within tolerance of zero: **degenerate — the second-derivative test is inconclusive**.
- **Drawn:** each at (x, y, f(x, y)), with shape by kind (min: dot, max: diamond, saddle: cross, degenerate: ring), labelled `min`, `max`, `saddle` or `?`.
- **Readout rows** per point: the kind, the point, and f.
- **None found** → a note, not an error: "no critical points found in the domain".
- **An example** is `x^3 - 3x + y^2`: a saddle at (−1, 0) and a min at (1, 0).

**B9 — Lagrange multipliers.**
- **Syntax:** `lagrange: max f subject to g = c`, `min …`, or `extrema …` (both).
- **Two variables:**
  - trace the constraint curve g = c on the floor (B2 at level c of g);
  - seed from its traced vertices (up to 64, evenly spaced along the polyline);
  - solve `F(x, y, λ) = (f_x − λ g_x, f_y − λ g_y, g − c) = 0` by Newton, with λ seeded by least squares `λ0 = (∇f·∇g)/(∇g·∇g)`;
  - deduplicate, evaluate f at each solution;
  - `max` keeps the solutions with the greatest f (a tie within `1e-9 · scale` keeps all), `min` the least, and `extrema` shows both.
  - **Drawn:**
    - the constraint on the floor;
    - its lift onto the surface z = f;
    - f's level curves through each kept point, on the floor;
    - the kept points on the floor and lifted;
    - ∇f and ∇g arrows at each kept floor point, scaled to a common length of 0.15 × the box span so their parallelism reads.
  - **Readout:** the point, f, and λ.
- **Three variables** (`f(x,y,z)`, `g(x,y,z) = c`): the constraint surface by S4a's marching tetrahedra (before S4a merges, a three-variable Lagrange is an error on its line). Seeds come from the mesh vertices (up to 64). Solve the 4×4 system by Newton (extend `math/linalg` with a 4×4 solve if needed, and test it). Mark the points with ∇f and ∇g arrows.
- **Nothing converges** → an error on the line: "no constrained extremum found; try a tighter @bounds3d".

---

### Task 1: Level curves and paths

**Files:** Create `kernel/surfaceTools/contours.ts` (`contourCurves`), `kernel/surfaceTools/target.ts` (B1), `grammar/keywords/surfaceTools.ts` (`path:`, and the rows for the later tasks' keywords as they arrive), `kernel/surfaceTools/paths.ts`, and tests.

- [ ] **Failing tests:**
  - `contour: x^2 + y^2 levels 1, 4`: two closed polylines at z = 1 and z = 4, of radii 1 and 2 (every vertex within 1e-8 after bisection);
  - with `floor`, two more at the box floor;
  - `labels` gives two anchors;
  - `levels 4` for `x^2 - y^2` on [−2, 2]²: the range is [−4, 4], `niceStep(8, 4)` = 2, so the levels are −2, 0, 2;
  - `path: on x*y/(x^2 + y^2) along (t, t) for t in [0, 1] toward (0, 0)`: every vertex has z = 1/2, the lifted value is ≈ 0.5, and along `(t, 0)` it is 0 (the textbook two-path limit disagreement).
- [ ] **Prove it:** delete the bisection refinement → the 1e-8 radius test fails.
- [ ] **Commit** `feat(graph-engine): space level curves and paths on surfaces`.

### Task 2: Traces and tangent planes

**Files:** Create `kernel/surfaceTools/traces.ts`, `kernel/surfaceTools/tangentPlanes.ts`, a local plane-patch helper if S4a is not merged (documented for the merge), and tests.

- [ ] **Failing tests** (f = x² − y²):
  - `trace: f at x = 1`: every vertex has x = 1 and z = 1 − y²;
  - `… tangent at y = 2`: direction ∝ (0, 1, −4), through (1, 2, −3);
  - `tangent-plane: f at (1, 2)`: the patch vertices satisfy z = −3 + 2(x − 1) − 4(y − 2) within 1e-12, and the readout text is exactly `L(x, y) = −3 + 2(x − 1) − 4(y − 2)`;
  - `normal`: direction ∝ (−2, 4, 1);
  - three-variable: `tangent-plane: x^2 + y^2 + z^2 at (1, 1, 1)` has normal ∝ (1, 1, 1), and the point is on the patch;
  - with parameters: `@param a = 1 range [0, 2]`, `tangent-plane: f at (a, 2)`; `setValue('a', 0)` moves the point to (0, 2, −4).
- [ ] **Prove it:** use `+ −4` formatting → the exact readout test fails.
- [ ] **Commit** `feat(graph-engine): space traces with tangent lines, and tangent planes`.

### Task 3: Gradients and directional derivatives

**Files:** Create `kernel/surfaceTools/gradients.ts`, `kernel/surfaceTools/directional.ts`, and tests.

- [ ] **Failing tests:**
  - `gradient: x^2 - y^2 at (1, 2)`: the arrow is (2, −4, 0) from (1, 2, floor), |∇f| = √20 = 4.472, and the floor level curve passes through (1, 2) and satisfies x² − y² = −3;
  - `lifted`: the tail is at (1, 2, −3);
  - three-variable: `gradient: x*y*z at (1, 2, 3)` gives the arrow (6, 3, 2);
  - `directional: x^2 - y^2 at (1, 2) toward <3, 4>`: u = (0.6, 0.8), D_u f = 2·0.6 + (−4)·0.8 = −2, the trace passes through (1, 2, −3), and the tangent slope is −2;
  - a zero u is refused.
- [ ] **Prove it:** skip normalising u → D_u f = −10 and the test fails.
- [ ] **Commit** `feat(graph-engine): space gradients and directional derivatives`.

### Task 4: Critical points and Lagrange

**Files:** Create `kernel/surfaceTools/critical.ts`, `kernel/surfaceTools/lagrange.ts`, and tests. Extend `math/linalg` with `solve4` if needed.

- [ ] **Failing tests:**
  - `critical: x^3 - 3x + y^2` on [−3, 3]²: exactly [(−1, 0, 2) saddle, (1, 0, −2) min], in that (lexicographic) order;
  - `critical: x^2 + y^2`: a min at the origin;
  - `critical: x^4 + y^4`: the origin is degenerate (Hessian 0);
  - `critical: x*y`: a saddle at the origin;
  - `lagrange: max x + y subject to x^2 + y^2 = 1`: (√2/2, √2/2), f = √2, λ = √2/2;
  - `min` gives (−√2/2, −√2/2);
  - `extrema` gives both;
  - three-variable: `lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9` gives (1, 2, 2), f = 9, λ = 1/2;
  - an infeasible constraint (`x^2 + y^2 = -1`) → the error.
- [ ] **Prove it:**
  - delete the eigen classification (treat everything as min) → the saddle test fails;
  - delete deduplication → repeated points appear.
- [ ] **Commit** `feat(graph-engine): space critical points, classified, and Lagrange multipliers`.

### Task 5: Examples

- [ ] Add `Space · …` examples:
  - a saddle with contours and a floor projection;
  - the two-path limit;
  - traces with tangents;
  - a tangent plane driven by `@param a, b` and a draggable point;
  - a gradient with its level curve;
  - a directional derivative;
  - `x^3 - 3x + y^2` critical points;
  - Lagrange on the unit circle;
  - three-variable Lagrange.
- [ ] **Look at it** on 5182, and list what to check.
- [ ] **Commit** `docs(graph-engine): space examples for the calculus of a surface`.

## Verification

All three checks clean. Every example builds. The byte-identity sweep for figure and 2D output. The controller looks.

## Out of scope

Integrals (S5); vector fields and line/surface integrals (sub-project 3).
