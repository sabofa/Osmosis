# Calc-Proofing the 2D Engine — Design (Track 4)

*2026-10-01. The implementation spec for Track 4 of
`2026-09-21-graph-engine-v2-design.md` ("Calc-proofing the 2D engine"),
written just-in-time as that spec prescribes. It widens Track 4 from the
thirteen-row table there to what Ben asked for: a 2D engine that is right, and
complete, for Calc 1–2, differential equations, linear algebra, Physics C and
the rest of a math major. Where this document and the master spec disagree
about Track 4, this one wins; the master spec still owns the document model.*

## What this is for

Track 4 has two goals, each its own sub-project with its own spec, plan and
build:

1. **Calc-proofing (this document).** The 2D engine must never draw anything
   mathematically wrong, and must carry the vocabulary a math major plots.
2. **The 2D visual pass (a separate spec, written later).** The graphing
   engine takes on the hand-drawn look the geometry figures already have,
   through the shared `style/` module. This document fixes only what goal 2
   needs from goal 1: the scene contract in "Architecture".

The scope is a whole major, not a calculus course, because of where Ben is
headed: a UIUC math major, Calc 3, Physics C, then quant work. The engine
serves his authored, durable work in a workspace, not only test figures.

## Decisions already taken with Ben

- **Correctness first, then vocabulary.** The correctness layer (phases P1–P5)
  is built before any vocabulary statement.
- **Vocabulary order:** Calc 1–2, then differential equations and dynamics,
  then linear algebra, then Physics C, then analysis, probability and complex
  (phases V1–V6).
- **Approach: shared kernel + adaptive sampler + interval arithmetic as the
  correctness oracle.** Chosen over a heuristics-only sampler (whose
  thresholds are the same kind of rule that fails today) and over patching v1
  in place (two evaluators, a weak foundation under every later phase).
- **The 2D engine builds on space's `math/` kernel.** One evaluator for every
  engine; no second kernel.
- **Base branch.** `milestone-a/calc` starts from `milestone-a/main` at
  `d1a8ef4`, the geometry + space integration merge Ben called on 2026-10-01
  so this track could use both track 1 / `style/` and `math/` / `@param`.
- **Looks are a per-engine setting.** Ben will add a Settings → Appearance
  choice of look per engine (figures, graphs, 3D), with a spec able to
  override it; both clean and hand-drawn are first-class. Anything this track
  draws must be drawable by `style/` (goal 2).

## The rules that don't bend

1. **Nothing is connected unless certified.** A curve is joined across an
   interval only when the interval twin proves it defined and continuous
   there, or the pixel-scale jump test (below) shows the gap closing. This is
   the guarantee against false asymptote lines.
2. **Errors are never silent.** A spec that compiles to nothing visible says
   why. No blank plot without a message.
3. **Deterministic.** The same spec and the same view produce the same scene,
   hash for hash. No `Math.random`, no clock, in `math/` or `plot/`.
4. **Generic marks only.** Every statement — correctness layer and vocabulary
   alike — emits the scene marks below, each with an identity, so any
   renderer and any look can draw it.
5. **Nothing else moves.** Figure renders stay byte-identical (the
   clean-golden hashes); space's own output is untouched until space opts in
   to anything here; every existing test stays green except tests that pinned
   the defects this track removes, each replaced with a note.

## What is wrong today

From an inventory of `milestone-a/geometry` at `a892d5f` (unchanged in 2D by
the merge). File references are to `graph-engine/src/`.

- **The language is thin and the evaluator is split.** `parser/evalExpr.ts`
  knows `sin cos tan sqrt abs exp ln log`, `pi` and `e`, and nothing else: no
  inverse trig, hyperbolic, floor/ceil, gamma, factorial. Functions take one
  argument. `compileExpr` resolves user constants *before* bound variables, so
  `theta = 1` silently turns `r = 1 + cos(theta)` into a circle. An unbound
  name in an explicit, polar or parametric plot is swallowed per sample: the
  plot is blank, with no error.
- **`x^(1/3)` and `x^(2/3)` lose their left halves** (`Math.pow` of a negative
  base is NaN).
- **Explicit curves are 400 uniform samples** over the visible range
  (`scene/buildScene.ts`), with no refinement. `sin(1/x)` and `sin(50x)`
  alias; `ln x` stops mid-screen near y ≈ −3; a removable hole shows only if a
  sample lands on it, and never as an open circle.
- **Asymptotes are guessed relative to the window, not the function.** A jump
  larger than 3× the view's height splits the curve (`buildScene.ts:141`):
  guides flicker under pan, parabolas get false guides zoomed out, `1/x^2`
  with symmetric samples gets none, and `y = 1000x` — which jumps between
  every pair of samples — vanishes.
- **Polar and parametric curves skip non-finite samples instead of
  splitting**, drawing a chord across every pole. Polar's default range is
  `2*pi` even under `@angle: degrees`.
- **Implicit curves and regions are marching squares on a fixed 140×140
  grid** (45 while dragging), emitted as loose two-point segments, with a
  fixed saddle pairing; the region fill disagrees with the boundary in saddle
  cells.
- **The view is always 1:1** (`render/camera2d.ts`), so `0..2π × −1..1`
  cannot be shown; `@bounds` is read once; tick labels round to two decimals;
  there are no π ticks and no log axes; zoom bottoms out at a view height of
  1e-3 and positions are float32.
- **Feature points** use finite differences, see only `y = f(x)`, ignore
  `if` domains, miss double roots, and are recomputed on every drag frame.
  The `conic` kinds are accepted by `@points` but nothing emits them.
- **No parameters in 2D.** Space's `@param` is parsed into `config.bindings`
  and ignored by the 2D renderer.

What space already built and this track reuses: `math/compile.ts`
(slot-indexed closures over a `Float64Array` frame, compile-time name
resolution, cycle detection, arity checks, ~30 more built-ins), `math/diff.ts`
+ `math/simplify.ts` (symbolic derivatives), `math/quadrature.ts` (adaptive
Gauss–Kronrod with honest error bounds and divergence detection),
`math/roots.ts` (damped Newton in 1–4 dimensions), `math/linalg.ts`,
`math/scope.ts` (`MathScope`, with `@param` slots), the tokenizer's
scientific notation, space's rational-π tick steps and `@titles`, and its
parameter panel `space/ui/params.ts`.

## Architecture

### The pipeline

```
source → parser → compile (math/) → sample (plot/) → scene marks → renderer
```

### Where code lives

- **`math/` — the shared kernel, extended.** New built-ins, the language
  additions of P1, and `math/interval/`: a decorated interval twin of every
  built-in (see "The kernel"). Space may use the twin as well (empty-cell
  culling for implicit surfaces) but is not required to.
- **`plot/` — new, the 2D counterpart of `space/`.**
  - `plot/sample/` — the adaptive curve sampler (P2) and the implicit/region
    quadtree (P3).
  - `plot/frame/` — aspect, scales, ticks, labels and titles (P4).
  - `plot/features/` — feature points rebuilt on the kernel (P5).
  - `plot/grammar/` — Track 4's statements, hooked into
    `parser/parseStatement.ts` the way space's grammar is (see
    "Coordination").
  - `plot/vocab/<area>/` — one folder per vocabulary area (V1–V6).
  - `plot/testing/` — the torture corpus and the contact-sheet script.
- **`scene/buildScene.ts`** becomes a thin dispatcher for 2D plot statements,
  calling into `plot/`. Its geometry branches (graph-mode circles, polygons,
  marks) stay where they are, emitting the new mark shapes.
- **`parser/evalExpr.ts`** leaves every 2D sampling path. It stays for the
  figure engine only, so figure renders remain byte-identical; retiring it
  entirely is a later cleanup, not this track's.
- **`render/`** stays three.js for now and is adapted to the new scene
  contract (chains, outlines, typed marks). Its long-term form is goal 2's
  decision.

### The scene contract (the seam goal 2 plugs into)

The 2D `SceneObject` union (`scene/types.ts`) changes for plot objects:

```ts
// A run of connected vertices, in float64 world coordinates.
interface Chain {
  xy: Float64Array        // x0, y0, x1, y1, …
  param: Float64Array     // the curve parameter at each vertex: x, y, t or theta
  closed: boolean
}

type BreakKind = 'pole' | 'jump' | 'edge'
interface Break { at: number; kind: BreakKind }   // `at` in the curve's parameter

| { kind: 'curve'; id: MarkId; chains: Chain[]; breaks: Break[]; dashed?: boolean; color?: string | null }
| { kind: 'mark';  id: MarkId; at: Vec2; role: MarkRole; fill: 'open' | 'filled'; exact: boolean; color?: string | null }
| { kind: 'band';  id: MarkId; outline: Chain[]; color?: string | null }     // sub-pixel oscillation
| { kind: 'region'; id: MarkId; outline: Chain[]; boundary: MarkId[]; color?: string | null }  // even-odd
| { kind: 'line';  id: MarkId; through: Vec2; direction: Vec2; extent: 'infinite' | 'ray'; role?: 'asymptote'; color?: string | null }
```

- **`MarkId`** is `{ statement: number; object: string }`, the same identity
  the figure pen uses (`figure/render.ts` `Identity`), keyed as
  `"<statement>/<object>"` — e.g. `"3/curve"`, `"3/hole.0"`,
  `"5/riemann.rect.7"`. The tutor layer addresses both engines the same way,
  and goal 2's styled pen seeds each object's wobble from it.
- **The parameter at each vertex** lets goal 2 pin wobble to the mathematics
  rather than to screen samples (so lines do not boil when a pan resamples),
  and lets hover report t and vocabulary sweep a point along a curve.
- **Regions are exact outlines**, not triangle soup, so a renderer can fill,
  hatch or scribble them clipped to the true boundary — `style/`'s fills need
  exactly that. The three.js renderer triangulates outlines itself.
- **`MarkRole`** covers `hole`, `endpoint` (piecewise and domain endpoints),
  `feature` (with the existing `FeatureKind`), and the vocabulary's point
  roles as they arrive.
- **Float64 throughout the scene.** The renderer converts to float32
  relative to the view centre, so precision is not lost far from the origin.
- Existing kinds the plot path no longer emits (`curve` with `points: Vec2[]`,
  `segments` for traced boundaries, `region` with `triangles`) are migrated in
  P2/P3, including graph-mode geometry's circles. The graph renderer is WebGL,
  so no byte-identity guard covers graph mode; its tests are updated.

### The interaction budget

During a pan, zoom or slider drag, the viewer transforms the last rendered
result (and, for a slider, runs a coarse pass with no feature detection).
When the gesture settles it resamples: a coarse pass first, then the refined
one. Adaptive subdivision, interval culling and feature detection run only at
settle. The same mechanism keeps goal 2's wobble from boiling. Movement feel
(momentum, zoom toward the cursor, eased steps) is geometry's visual pass
part 2; this track uses its constants when they land and does not invent its
own.

## The kernel (P1)

### The language

The 2D engine's expression language becomes `math/compile.ts`'s, extended:

| Addition | Syntax | Notes |
|---|---|---|
| Real odd roots | `x^(1/3)`, `x^(2/3)`, `cbrt(x)`, `root(n, x)` | A **literal** rational exponent p/q in lowest terms with q odd takes the real root: `x^(p/q) = sign(x)^p · abs(x)^(p/q)`. A non-literal exponent keeps `Math.pow` semantics. |
| Piecewise | `f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}` | Desmos-style. Pieces are tried in order; a final bare expression is "otherwise"; with no otherwise, the value is undefined where no condition holds. Needs `{`, `}` and `:` as tokens inside expressions; keyword detection in `parseStatement` stays anchored to `^name:` at line start, so it does not see these. |
| Condition language | `and`, `or`, `!=`, chained `0 < x < 1` | Used by piecewise, `if` clauses and regions alike. |
| `if` on every form | `x^2 + y^2 < 4 if y > 0` | Explicit, implicit and region statements (implicit and region reject `if` today). |
| Multi-argument functions | `g(x, a) = a sin(x)` | Through `MathScope`'s `params: string[]`; the 2D parser stops limiting definitions to one argument. |
| Derivatives | `f'(x)`, `f''(x)`, … | Symbolic via `diff.ts` + `simplify.ts`; a prime count up to 5. |
| Accumulation | `F(x) = integral(t = 0 to x, sin(t)/t)` | `math/quadrature.ts`'s `integrate1`. Infinite bounds (`inf`, `-inf`) go through a change of variables in front of it (`integrate1` takes finite bounds). A divergent integral is undefined, with a note. |
| Sums and products | `S(x) = sum(k = 0 to n, x^k / k!)`, `prod(…)` | Bounds may be any expression, including `@param`s; they must evaluate to integers (else a refusal naming the bound). At most 100 000 terms per evaluation; past that, a refusal. |
| Special functions | `n!`, `gamma`, `choose(n, k)`, `perm(n, k)`, `erf`, `erfc`, `gcd`, `lcm`, `step(x)` | `n!` is `gamma(n + 1)` for non-integers. Postfix `!` binds tighter than `^` and unary minus: `-3!` is `-(3!)`, `2^3!` is `2^(3!)`. `step` is the Heaviside function (`step(0) = 1`). |
| Notation | absolute-value bars, `sin^2(x)`, `sin^-1(x)`, `x(x + 1)` | A bar opens after an operator, an opening bracket or at the start, and closes otherwise. `sin^2(x)` is `(sin x)^2` for any built-in power; `^-1` on a trig or hyperbolic name means its inverse. `name(…)` is a call when `name` resolves to a function, multiplication otherwise — decidable now that names resolve at compile time. `xy` is one name; an unknown multi-letter name whose letters are all bound variables gets the hint "did you mean x*y?". |

### Errors

Compile errors — an unknown name, wrong arity, a cycle, a bad bound — carry
the statement's line and name the offender, and are reported for every plot
form (closing today's silent blank plots). A statement that compiles but is
undefined across the whole visible range gets the note "undefined everywhere
in view" rather than an empty plot. Undefined points inside the view are not
errors: they are domain, and the sampler draws them as such.

### The interval twin

`math/interval/` (core, arithmetic, one file per twin family, and the compiler)
compiles the same expression tree, with the same slot scheme and no code
generation, into closures over intervals. Each evaluation
returns bounds `[lo, hi]` (either may be infinite) and a **verdict**:

| Verdict | Meaning | Sampler treats it as |
|---|---|---|
| `continuous` | defined and continuous on the whole input box | certified: may connect |
| `defined` | defined everywhere on the box, may jump (floor, mod, step, piecewise seams) | not certified |
| `partial` | undefined somewhere inside (ln over [−1, 1], 1/x across 0, gamma near a non-positive integer) | not certified |
| `unknown` | no cheap enclosure (`integral(…)`) | not certified; jump test |

Verdicts combine by taking the weakest. Every bound is widened
outward — 2 ulps for IEEE arithmetic, 4 for a library function, a relative 1e-13
for gamma and what is built on it — because JavaScript has no directed
rounding: the twin is robust, not formally rigorous, and the property tests (see
"Testing") hold it to soundness. Comparisons in conditions are three-valued
(true, false, both) so piecewise and regions evaluate correctly over boxes; a
"both" piecewise result is the union of the live branches with verdict at
most `defined`. `sum` and `prod` enclose term by term; `integral` returns
`unknown` with bounds `[-inf, inf]` (sampled bounds are not an enclosure, and
P3's culling relies on enclosures).

### One rule that keeps the kernel lasting

A built-in exists only as a **triple**: its scalar implementation, its
interval twin and its derivative rule. They are registered together, and a
registry test fails if any member is missing. Every built-in added by a
later phase therefore arrives sampled, certified and differentiable without
anyone remembering to make it so.

### Complex numbers

Arrive with V6 as a separate compile target over the same tree
(`compileComplex`). Nothing in P1 forecloses it: the scalar target stays
number-typed.

## The curve sampler (P2)

Covers `y = f(x)`, `x = f(y)`, polar and parametric curves, all through one
algorithm over the curve's parameter.

### Adaptive subdivision in screen space

1. **Start:** about one sample per 4 px across the visible range plus 25 %
   overscan on each side (so a small pan needs no resample). Polar and
   parametric start from their parameter range at a comparable density.
2. **Each interval between neighbouring samples:**
   - the twin says `continuous` **and** the interval is flat (the midpoint
     lies within ¼ px of the chord) **and** shorter than 8 px on screen →
     accept the segment;
   - `continuous` but not flat or too long → bisect;
   - any other verdict → bisect toward sub-pixel width (below 1/16 px), then
     classify (next section).
3. **Steepness never breaks a curve.** A certified-continuous interval is
   connected however steep it is: `y = 1000x` draws.
4. **Budget:** a per-curve cap on point and interval evaluations (initial
   values chosen in P2 and pinned by the corpus). At the cap the curve
   coarsens and a note says so; it never blanks.

These numbers (4 px, 25 %, ¼ px, 8 px, 1/16 px) are initial values; P2 may
tune them against the corpus, and the corpus pins whatever it settles on.

### Singularities from the expression's structure

Samples alone cannot find a hole no sample lands on. So the sampler also walks
the expression tree for its candidate trouble spots — zeros of denominators,
the edges of the domains of `ln`, `log`, `sqrt` and even real roots, the poles
of `tan`, `sec`, `csc`, `cot` and `gamma`, and piecewise seams — locates each
in the visible range with the interval root finder, and classifies it by
one-sided limits (evaluated at a geometric sequence of offsets, accepted when
they converge):

| Found | Drawn |
|---|---|
| both sides diverge | **pole**: the chain breaks (`Break.kind = 'pole'`); a dashed vertical `line` with `role: 'asymptote'` when `@asymptotes` is on |
| finite limits that differ | **jump**: the chain breaks; at a piecewise seam the two endpoint `mark`s are **filled or open according to the condition** (`x < 0` gives an open end on the left piece, `x <= 0` a filled one) |
| finite limits that agree, point undefined | **hole**: an open `mark` at (x₀, limit), e.g. `sin(x - pi)/(x - pi)` at π |
| one side undefined | **edge**: refined by bisection on definedness to machine precision; the chain runs to the edge (`ln x` dives off-screen, `sqrt` meets its endpoint) |

The interval verdicts are the safety net for anything the structure walk
misses. **The jump test**, used where an interval stays uncertified at
sub-pixel width with no structural candidate: connect when the screen gap is
under 1 px and shrinks over three successive halvings; otherwise break as a
jump.

### Oscillation faster than a pixel

When subdivision reaches pixel width without flattening (`sin(1/x)` near 0,
the Weierstrass function), the sampler emits a **band**: across those pixel
columns, the curve's vertical extent — the min and max of 16 samples per
column, never exceeding the twin's enclosure — as a filled outline. That is
how a careful hand plot shows it, instead of an aliased zig-zag.

### Polar and parametric

The same algorithm over t or θ, with flatness measured on the plotted point.
Breaks split chains, so no chord crosses a pole. Polar's default range is a
full turn in the current angle unit (0 to 360 under `@angle: degrees`), and
negative r plots through the origin, as now.

### Acceptance cases

| Input | Must show |
|---|---|
| `tan x`, `1/x^2`, `1/(x-1)` | poles at the right x, no connectors, guides stable across a pan sequence |
| `(x^2-1)/(x-1)`, `sin(x)/x`, `sin(x - pi)/(x - pi)` | holes at 1, 0 and π |
| `floor(x)`, `{x < 0: x^2, x + 1}`, `{x <= 0: x^2, x + 1}` | jumps; open and filled ends as the conditions say |
| `ln x`, `sqrt(x)`, `x^(1/3)`, `x^(2/3)` | edges reached; both halves of the real roots |
| `sin(1/x)`, `x sin(1/x)`, `sin(50x)` | no aliasing; a band where denser than pixels |
| `y = 1000x`, `y = 1e6 (x - 3)` | drawn |
| `r = 1/cos(theta)` | a vertical line, no chord |
| `y = 2` with `if 0 < x <= 3` | endpoint marks open at 0, filled at 3 |

## Implicit curves and regions (P3)

### Implicit curves: an interval quadtree

For `F = G`, let `H = F − G`. Over the visible area plus overscan, each cell
is evaluated by the twin:

- **zero excluded** → the cell holds no curve and is discarded;
- **zero possible** → subdivide, to about 1 px at settle and 4 px on the
  coarse pass.

Cost therefore follows the curve's length on screen, not the canvas area, and
the fixed 140×140 grid is retired from the 2D path (space keeps importing
`render/marchingSquares.ts` until it chooses otherwise).

At a pixel-sized leaf:

- **sign change across corners** → each crossing is found by **bisection on
  H along the edge**, not linear interpolation, and is keyed by its edge so
  neighbouring cells share it: chains join without cracks and lie on the true
  zero set;
- **a sign change across a pole is not a root.** `y − tan x = 0` changes sign
  across tan's poles without being zero; the twin proves no root on such an
  edge and it is rejected — no false vertical lines;
- **saddles** are paired by the asymptotic decider (the bilinear
  interpolant's value at the cell's saddle point), replacing today's fixed
  pairing;
- **crossings** — a leaf whose saddle value is near zero relative to its
  corner values (threshold set in P3, pinned by the corpus) is drawn as an
  **X through the crossing** (the lemniscate at the origin, `xy = 0`), not two
  near-miss arcs;
- **touching without a sign change** — `(x − y)^2 = 0`, `x^2 + y^2 = 0`. Where
  the twin cannot exclude zero at the minimum size and no corner changes sign,
  a few steps of local minimization on |H| decide: if |H| / |∇H| falls below
  ½ px, the leaf is a touch point, chained into a curve or left as an isolated
  point.

Leaf pieces are joined into connected **chains**, open or closed, emitted as
the same `curve` marks P2 emits — so goal 2's strokes get whole curves.

### Regions: the same quadtree, three-valued

Inequalities, chained inequalities, `and` / `or` and `if` clauses are one
condition evaluated three-valued per cell: **proven inside** cells are kept
whole, **proven outside** cells dropped, ambiguous cells subdivided, and at
the leaf the cell is clipped against each condition in turn using the same
edge crossings as the boundary curves. Consequently:

- **fill and boundary agree exactly** (today's saddle-cell mismatch is gone);
- **undefined is neither inside nor outside** — `y < ln x` shades nothing at
  x ≤ 0;
- any boolean combination, including a system's feasible region, works with
  no polygon booleans;
- the output is an **exact even-odd outline** assembled from the boundary
  chains, the overscan rectangle and the edges of undefined areas — what
  goal 2's hatch and scribble fills clip to.

Boundaries stay dashed for strict operators and solid otherwise, as now.

### Acceptance cases

| Input | Must show |
|---|---|
| `x^2 - y^2 = 1`, `y^2 = x^3 - x` | every branch and component |
| `(x^2+y^2)^2 = 2(x^2-y^2)`, `xy = 0`, `y^2 = x^2` | clean crossings at the origin |
| `(x-y)^2 = 0`, `x^2 + y^2 = 0` | the line; the single point |
| `sin(x) = cos(y)` | the lattice of crossings, saddles correct |
| `y - tan(x) = 0` | no vertical lines at the poles |
| `x^y = y^x` | the line y = x and the curve crossing it at (e, e) |
| `abs(x) + abs(y) = 1` (written with bars) | sharp corners |
| `1 < x^2+y^2 < 4`, `x^2+y^2 < 4 and y > 0`, `y < ln(x)`, `xy > 1` | the annulus (area 3π), the half-disk (2π), no shading where undefined, a dashed strict boundary |

## The frame (P4)

### Aspect and bounds

- When `@bounds` gives **both** an x and a y range, both are honoured
  exactly; the plot stretches. Otherwise the default stays equal, so circles
  stay round.
- `@aspect: equal | auto | a:b` forces either. `@aspect` is space's directive
  key (`space/grammar/directives.ts`, which accepts `equal | auto | a:b:c`);
  2D reads the same `config.space.aspect`, and the two-ratio form `a:b` (a
  unit of x drawn a, a unit of y drawn b) is added to that one parser with
  space's agreement, not forked.
- With a non-equal aspect, a modifier with the wheel zooms one axis (the
  modifier is chosen with geometry's movement constants).
- `@bounds` becomes live: editing it re-applies.

### Ticks and labels

- **π ticks:** a step written as a rational multiple of π (`@xstep: pi/2`)
  labels the axis π/2, π, 3π/2, 2π, reusing space's rational-π `TickStep`;
  under `@step-mode` the π family survives zoom (π/4 → π/2 → π → 2π).
- **Precise labels:** each label shows the fewest digits that tell its
  neighbours apart; scientific notation (1.2×10⁻⁵) when the largest label's
  magnitude reaches 10⁵ or the step falls below 10⁻⁴; a true minus sign;
  never −0.
- **Labels follow the view:** when an axis is off-screen its labels pin to the
  nearest edge, so values stay readable anywhere.
- **Axis titles** use space's directive, `@titles: x "t (s)", y "v (m/s)"`,
  set at the axis ends in the textbook way. (Not `@xlabel`: `@labels` already
  means tick-label density.)

### Log scales

`@xscale: linear | log`, `@yscale: linear | log`: semi-log and log-log, base
10, decade labels (10³) and 2–9 minor ticks. The scale is a transform the
sampler works through: explicit curves subdivide evenly in log x; the
quadtree evaluates at transformed coordinates. A value ≤ 0 on a log axis is a
domain edge, not an error.

### Deep zoom

Float64 scene coordinates, renderer-relative float32, and a zoom range of
about 10⁻⁹ to 10¹² view height (from 10⁻³ to 10⁶). Labels, hover readouts and
feature coordinates print enough digits for the current zoom.

### Acceptance cases

| Input | Must show |
|---|---|
| `@bounds: [0, 2pi] x [-1.2, 1.2]`, `y = sin x`, `@xstep: pi/2` | one period filling the view, π ticks |
| `@yscale: log`, `y = e^(-x)` | a straight line, decade labels |
| `@xscale: log`, `@yscale: log`, `y = x^3` | a straight line of slope 3 |
| a 10⁻⁸-wide window around x = 1000 | distinct labels, a smooth curve, no jitter |
| panned so the y-axis is off-screen | y labels pinned at the left edge |

## Features, hover and parameters (P5)

### Feature points on the kernel

Track 1's model — typed, distinctly marked, exact versus sampled — stays; its
machinery is rebuilt:

- **f′ and f″ are symbolic** (`diff.ts`), replacing finite differences with
  steps of 1e-5 and 1e-3.
- **Roots are certified**: the interval root finder reports a root only where
  the twin proves continuity and a sign change, so a pole is never a root.
- **Double roots** — where f touches zero without crossing — are found as
  roots of f′ at which f ≈ 0, and marked as roots.
- **Extrema by the first-derivative test** (f′ changes sign), so `x^4` gets
  its minimum where the second-derivative test is silent.
- **Domains are respected.** Piecewise and `if` restrictions limit where
  features are sought; the endpoints of a restricted domain are
  **domain-endpoint** features, open or filled to match the condition.
- **The kinds promised and never emitted:** hole and vertical asymptote (from
  P2's classification), horizontal and oblique asymptotes (from end
  behaviour — exact for rational functions by degree, by convergent numeric
  limits otherwise), and conic centre, foci and vertices, read analytically
  from the coefficients of any quadratic implicit equation (a small
  polynomial-extraction pass over the expression tree).
- **Every curve form:** `x = f(y)`; polar (r = 0 crossings, extrema of r);
  parametric (horizontal and vertical tangents where y′(t) or x′(t) is 0);
  implicit (intercepts, and horizontal and vertical tangents where H_x or
  H_y is 0 on the curve, via space's damped Newton).
- **Intersections of any two curves:** chain crossings from the sampler seed a
  2D Newton solve on the two curves' equations — the general "where do these
  cross" Track 7 asks for.
- **Off the drag path:** computed at settle, over the visible range plus
  overscan; never per drag frame.

### Hover

Readouts are evaluated, not interpolated: on `y = f(x)` the readout is
f(cursor x) exactly; on parametric curves the nearest t is refined; on
implicit curves the point is projected onto H = 0 by Newton. Snapping to
features and the exact-versus-ordinary marker distinction stay as Track 1
built them.

### Parameters

2D adopts space's `@param` unchanged — the syntax (`@param a = 1 range [0, 5]
step 0.1`, `integer`), `config.bindings`, and `MathScope`'s parameter slots:

- moving a slider rewrites a slot with no recompile, and only statements that
  read the parameter rebuild (the compile step records what each statement
  reads);
- during a slider drag the interaction budget applies; on release, the full
  pass;
- **the slider panel is space's** (`space/ui/params.ts`, with play and loop),
  so parameters look and behave the same across engines. Lifting it to a
  shared `ui/` folder happens only with space's agreement; until then 2D
  imports it as it is;
- play and loop are how Riemann `n`, Taylor degree and a secant's endpoint
  animate;
- `animate:` stays, unchanged, for existing specs.

## Testing and verification

### The torture corpus

`plot/testing/corpus.ts` holds every acceptance case in this document, and
each later phase adds its own. A case is a spec, one or more views, and
checkable assertions:

- **on the curve** — every chain vertex is within ½ px of the true curve
  (|f(x) − y| for explicit curves, |H| / |∇H| for implicit ones);
- **typed breaks** — poles, jumps, holes and edges at the right parameter,
  within tolerance; no segment crosses a pole;
- **pan sequences** — the same case sampled over a series of shifted views:
  pole positions and asymptote-guide counts must not change (today's flicker,
  as a test);
- **regions** — the outline's even-odd area matches the known area; no fill
  where undefined;
- **features** — kinds and coordinates against known answers.

### Property tests

- **Interval soundness** for every built-in, over seeded random boxes: point
  evaluations inside a box land inside the twin's bounds, and a `continuous`
  verdict never covers a NaN. This is the test that makes rule 1 real.
- **The triple** — scalar, twin and derivative registered for each built-in;
  the derivative checked against finite differences at random points.
- **Seeded random polynomials and rationals** against their analytic roots,
  poles and holes.
- **Determinism** — the same spec and view hash identically.

### The performance budget is counted, not timed

Every corpus case records how many point and interval evaluations it used,
and the test pins a ceiling. Deterministic, so it never flakes; a regression
to brute force fails loudly.

### Nothing else moves

The existing suite stays green (4050 tests at `d1a8ef4`); the figure engine's
clean-golden hashes stay byte-identical; space's lifted 2D curves are
untouched; tests that pinned v1's defects (400 uniform samples, the
window-relative jump rule) are replaced, each with a note saying why.

### Seeing it

A script renders a **contact sheet** of corpus cases to HTML, screenshotted
with headless Edge as the style contact sheet is — never the browser pane.
For Ben's own look, the review harness gets a calc page on **port 5183**
(geometry uses 5181, space 5182), on the Tailscale host, with examples
grouped by phase.

### Definition of done, every phase

- vitest green;
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json
  --noEmit` both clean (the bare `npx tsc --noEmit` checks nothing in
  `graph-engine/`);
- oxlint clean;
- the corpus green within its evaluation budgets;
- an independent review, with fix rounds until it is fixed and scoped
  re-reviews;
- a headless look at the contact sheet.

## The vocabulary (V1–V6)

### Rules every vocabulary statement obeys

- **Generic marks only** — chains, outlines, marks, arrows and labels, each
  with an identity — so goal 2's look covers it for free.
- **Every number is sweepable** — `n`, a degree, an endpoint, ε: any
  expression, `@param`s included.
- **Every value it shows is computed honestly** — areas, sums, errors, δ —
  by the kernel, with real error bounds, and can be labelled on the plot.
- **Refusals are legible** — "riemann: f is undefined at x = 0 inside
  [−1, 1]".
- **Keywords do not collide.** A keyword space also uses (`riemann:`,
  `contour:`) is split by operand shape, agreed with space before the phase
  that introduces it. The solid-figure reserved words (`fill:`, `net:`,
  `shortest:`, `dihedral:`, `angle:`, `right-angle:`, `segment:`, `tick:`,
  `cut:`, `section:`, `solid:`) are never used at line start.
- **Infrastructure arrives with the first phase that needs it** — matrices
  (V4), stacked panels (V5), lists and batched point clouds (V3 and V6), a
  raster layer (V6).
- **Each phase's details are planned just-in-time.** The tables below fix the
  catalogue — statement names and what they draw — not every option.

### V1 — Calc 1

| Statement | Draws |
|---|---|
| `limit: f at a [from left \| right]`, `limit: f at inf` | points converging from each side, the hole or value, one-sided limit readouts |
| `epsilon-delta: f at a, epsilon = 0.5` | the L ± ε band, the largest working δ (computed), the box |
| `secant: f from a to b` | the secant and its slope; sweeping b → a becomes the tangent |
| `tangent:` / `normal: f at x = a` | symbolic; also on implicit (`at (3, 4)`), parametric and polar curves |
| `mvt: f on [a, b]` | the secant and the parallel tangent(s) at each c |
| `newton: f from x0 steps 5` | the tangent-line iterations, each xₙ marked |

### V2 — Calc 2

| Statement | Draws |
|---|---|
| `riemann: f on [a, b] n = 8 method: left \| right \| mid \| trapezoid \| simpson \| upper \| lower` | rectangles or trapezoids, the sum, and the true integral beside it |
| `area: under f on [a, b]`, `area: between f and g [on [a, b]]` | signed or total area; bounds default to the intersections; improper bounds (`inf`) with convergence |
| `revolve: f on [a, b] about x-axis \| y-axis \| y = k \| x = k`, `washer:`, `shell:` | the region, the axis and a representative slice; the 3D solid arrives with multi-page documents (Milestone C) |
| `arc-length: f on [a, b]` | the highlighted arc and its length; optional polygonal approximation |
| `polar-area: r = f on [α, β]`, also between two polar curves | sector shading and its value |
| `taylor: f at a degree n [within 0.01]` | Tₙ (symbolic), the error band, the x-interval where \|f − Tₙ\| < ε |
| `sequence: a(n) = … for n = 1 to 30`, `partial-sums: sum(…)` | discrete points with a limit line |
| `curvature: f at x = a` | the osculating circle and κ |

### V3 — Differential equations and dynamics

| Statement | Draws |
|---|---|
| `field: dy/dx = …` (upgraded) | density control, normalized or scaled glyphs, NaN-safe |
| `solution: dy/dx = … through (x0, y0)` | an adaptive RK45 (Dormand–Prince) curve in both directions, stopping at blow-up or a singularity |
| `euler: … from (x0, y0) h = 0.5 steps 10 method: euler \| heun \| rk4` | the step polylines against the true solution |
| `system: x' = f, y' = g` with `trajectory: from (x0, y0)` | the phase portrait, nullclines (P3), equilibria classified by the Jacobian (node, saddle, spiral, centre; stable or unstable) |
| second-order equations, e.g. `y'' + 2y' + 5y = 0` | rewritten as a system automatically; y(t) or the phase plane |
| `contour: f(x, y) levels: 10` | 2D level curves, labelled |
| `cobweb: x(n+1) = r x(n)(1 - x(n)) from 0.2 steps 30`, `bifurcation: …` | the cobweb diagram; the bifurcation point cloud |

### V4 — Linear algebra

Adds matrix literals (`[[2, 1], [0, 1]]`) and `A*v`, `det`, `inv`,
`transpose`, `A^n` to the kernel, on `math/linalg.ts`.

| Statement | Draws |
|---|---|
| named vectors, `sum: u + v`, `combo: 2u - v` | head-to-tail or parallelogram |
| `span: u, v` | the line or the plane |
| `transform: A` | the deformed grid, the images of î and ĵ, the unit square to a parallelogram labelled \|det\| (with orientation flip), sweepable from I to A |
| `eigen: A`, `svd: A`, `image: A of circle` | eigenvector lines with λ; the ellipse with its singular axes |
| `projection: v onto u`, `least-squares: … fit: line \| quadratic`, `solve: (system)`, `basis: b1, b2` | components with a right-angle mark; residuals; intersecting or parallel lines; a skewed grid |

### V5 — Physics C

Adds stacked panels sharing an axis, for linked graphs.

| Statement | Draws |
|---|---|
| `motion: x(t) = …` | linked x, v and a panels |
| `projectile: v0 = 20, angle = 30deg [, drag]` | the trajectory, component arrows, max height and range |
| `velocity:` / `acceleration: r(t) at t = 1` | vectors along a path, with a_T and a_N |
| `charges: +q at (-1, 0), -q at (1, 0)`, `field-lines:`, `equipotential:` | the E field, field lines seeded by charge, V levels |
| `current: I at (0, 0) out`, `torque: r = …, F = … at O` | B circles; the lever arm with its angle |
| work and impulse as `area:` with `@titles` units; oscillators via `solution:` | composes V2 and V3 |

Free-body diagrams are diagrams, not plots: Track 6 or the figure engine.

### V6 — Analysis, probability and complex

| Statement | Draws |
|---|---|
| `converge: a(n) to L epsilon 0.1` | the ε-strip and N |
| `family: f(n, x) = x^n for n = 1 to 10`, `uniform: … on [a, b] epsilon …` | the fading family; the sup-norm band (pointwise versus uniform) |
| `fourier: f on [-pi, pi] terms n` | partial sums, Gibbs, the periodic extension |
| `bisection:`, `interpolate: … method: lagrange \| spline` | numerical methods with their error |
| `dist: normal(0, 1) [P(a < X < b)]`, binomial, Poisson, …; `histogram:`, `ecdf:` | pdf and cdf, shaded probability, stems; inline lists |
| `paths: gbm(S0, mu, sigma, T) count 200 seed 1`, random walks | a batched, seeded path cloud (quant) |
| `domain-coloring: f(z)`, `conformal: f(z) of grid`, `complex: z = 3 + 4i` | raster hue and modulus; the image grid; Argand points; roots and poles marked |

## Phases

| Phase | Delivers |
|---|---|
| **P1** | the kernel: language additions, errors, the interval twin, the registry triple; 2D sampling switched to `math/compile.ts` |
| **P2** | the adaptive curve sampler, structural singularities, bands, the new curve marks; the renderer adapted |
| **P3** | the implicit/region quadtree, chains, outlines; the renderer triangulating outlines |
| **P4** | aspect, live bounds, π ticks, precise and pinned labels, titles, log scales, deep zoom |
| **P5** | feature points on the kernel, evaluated hover, `@param` in 2D |
| **V1–V6** | the vocabulary, in that order |

Each phase gets its own plan in `docs/superpowers/plans/`, argued from this
spec. P1–P5 are sequential (each stands on the last). **Goal 2 can run in
parallel from the end of P5**: by then everything the engine draws is chains,
outlines and identities, and vocabulary draws only through those.

## Coordination

- **Branch and worktree:** `milestone-a/calc` in
  `.claude/worktrees/milestone-a-calc`, from `milestone-a/main` at `d1a8ef4`.
  It merges into `milestone-a/main` only on Ben's go-ahead.
- **The 3D engines are off-limits (Ben, 2026-10-01: "do not touch the 3d
  engines, they are being worked on").** This track edits nothing under
  `space/` or `figure/`, nor `scene/buildScene3d.ts` or
  `render/SceneRenderer3D.ts`. It may import from them unchanged (space's
  parameter panel, its rational-π `TickStep`). Wherever this spec says a
  change is made "with space's agreement" — the two-ratio `@aspect`, the
  parameter panel's home — the change is requested of the session that owns
  the file and made there, never here.
- **Files shared with the other sides** — edit additively and keep Track 4's
  code in its own modules: `parser/parseStatement.ts`, `parser/types.ts`,
  `parser/config.ts`, `parser/parseConfig.ts`, `parser/tokenize.ts`,
  `scene/mode.ts`, `examples.ts` and its test, `GraphViewer.tsx`, the handoff.
- **Space's invariants hold:** `parseSpaceKeyword` runs first and
  `parseSpaceUnkeyed` just before the function-definition branch; style
  clauses are stripped only on lines space claimed; space's point-list rule
  stays; space's examples and config fields stay intact and in order. Track
  4's keyword hook runs immediately after `parseSpaceKeyword`.
- **Agreements needed from space, each before the phase that needs it:** the
  two-ratio `@aspect` (P4); reading `@titles` in 2D (P4); lifting the
  parameter panel to a shared folder, if ever (P5); each shared keyword's
  operand split (V2 `riemann:`, V3 `contour:`); and whether space adopts the
  new sampler or the interval twin (space's choice, never assumed).
- **From geometry:** the movement constants of its visual pass part 2, which
  this track uses rather than inventing its own.
- **The mode rule in `scene/mode.ts` does not change** for any existing spec,
  with one exception agreed with space on 2026-10-01: a spec whose only space
  statements are scalar multi-parameter `function` definitions (`g(x, a) = a
  sin(x)` beside `y = g(x, 2)`) is 2D, not 3D. Such a definition draws nothing
  on its own and is as much a 2D helper as a 3D one, so a scalar `function`
  form alone no longer routes a spec to space; a vector function
  (`r(t) = <cos t, sin t, t>`) still does.

## Out of scope

- Goal 2, the visual pass — its own spec, after P5.
- 3D solids of revolution on a `space` page — they need multi-page documents
  (Milestone C).
- The container, overlays, and multi-page documents — Milestone C.
- Slider UI beyond space's existing panel; timelines and scrubbing — Track 7.
- Exact and symbolic *values* (showing `√2` rather than 1.41421…) — build
  order step 3 of the master spec.
- Data resources (`@data … from "file.csv"`) — Milestone C; V6 takes inline
  lists only.
- Retiring `parser/evalExpr.ts` from the figure engine.

## Open questions

1. **Hole detection at points the structure walk cannot see.** A removable
   singularity produced by something other than a zero denominator or a
   domain edge (for example inside a user's piecewise definition that leaves
   a single point undefined) is caught only if the interval verdicts and the
   jump test notice it. P2 decides whether that residue matters in practice,
   from the corpus.
2. **Identity stability under edits.** `MarkId` keys on the statement index,
   as the figure pen does, so inserting a statement shifts the identities
   (and, in goal 2, the wobble) of everything below it. Goal 2's spec decides
   whether hand-drawn looks key on content instead.
