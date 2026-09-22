# Graph DSL Reference

A complete reference for `graph_spec` — the text DSL that drives `graph-engine`
and renders as a 2D/3D graph, table, or diagram attached to a question. This
is the full picture; the condensed version embedded in `bootstrap()`'s
`graph_dsl_reference` field (`server/src/domain/bootstrap.ts`) is deliberately
a token-cheap subset of what's here, meant for a live authoring session rather
than a from-scratch read.

Source of truth for everything below is `graph-engine/src/parser/` — this
document is a human-readable expansion of that code's own comments, not an
independent spec. If the two ever disagree, the parser wins; treat that as a
bug in this document.

## What `graph_spec` is

A question's `graph_spec` field is a plain string: one statement per line,
`#` starts a line comment. It's parsed by `parseSpec` (`graph-engine/src/parser/parseSpec.ts`)
and validated the same way at write time — `create_questions`/`edit_question`
run it through the real parser (not a heuristic) and reject with
`invalid_graph_spec` and the parser's own line-numbered message on failure
(`server/src/domain/questions.ts`). A rejected `graph_spec` doesn't corrupt
anything; the question just doesn't get written until it's fixed.

Empty/whitespace-only lines and `#`-comment lines are skipped. Everything
else must parse as exactly one of the statement forms below, optionally
followed by a same-line `color:`/`name:` clause (see "Color and name").

## Expression grammar

Every `<expr>` placeholder below is a small recursive-descent arithmetic
expression: `+ - * / ^`, unary minus, parentheses, implicit multiplication
(`2x`, `3(x+1)`, `2 sin(x)`), and function calls.

**Operator precedence**, loosest to tightest: `+`/`-`, then `*`/`/` (and
implicit multiplication, same tier), then unary `-`, then `^` (right-
associative). Unary minus binds *looser* than `^` on purpose — `-2^2` parses
as `-(2^2) = -4`, matching Desmos/WolframAlpha/graphing calculators/Python's
`**`, not `(-2)^2 = 4`. This matters for real specs: `y = -x^2` is a
downward-opening parabola.

**Built-in functions:** `sin`, `cos`, `tan` (angle-mode aware — see `@angle`
below), `sqrt`, `abs`, `exp`, `ln` (natural log), `log` (one argument = log
base 10; two arguments `log(x, b)` = log base `b`).

**Built-in constants:** `pi`, `e`.

**User-defined names** — a `<name>(<param>) = <expr>` or `<name> = <expr>`
statement anywhere in the spec (see below) makes `<name>` callable/referenceable
in every other statement, regardless of where in the spec the definition sits
relative to its use.

## Statement catalog

Every entry is a full line (or, for parametric forms, the shape before the
`for ... in [...]` clause).

### 2D functions and curves

```
y = <expr(x)> [if <condition>]
```
Explicit function of `x`. The optional `if <condition>` makes it piecewise —
`x < 0`, `x >= 2`, or a two-sided range `-1 <= x < 1` (both bounds must use
`<`/`<=`, never `>`/`>=`).
```
y = x^2 - 4
y = 1/x if x > 0
y = -x + 1 if -2 <= x < 3
```

```
x = <expr(y)> [if <condition>]
```
Explicit function of `y` — same condition grammar as above, mirrored to the
`y` axis.
```
x = y^2
```

```
r = <expr(theta)> [for theta in [a, b]]
```
Polar curve. `theta` defaults to `[0, 2*pi]` when the `for` clause is omitted.
```
r = 1 + cos(theta)
r = theta for theta in [0, 4*pi]
```

```
<expr(x,y)> = <expr(x,y)>
```
Implicit curve — anything that isn't `y = ...`, `x = ...`, `z = ...`, or a
labeled point falls here. Covers conics, circles-by-equation, etc.
```
x^2/9 + y^2/4 = 1
```

```
<expr(x,y)> <|<=|>|>= <expr(x,y)>
```
Shaded inequality region. **No `if <condition>` clause here** — that's only
valid on `y=`/`x=` explicit function statements (see above), not on a
region. To shade a function over a bounded interval, restrict the function
itself instead: `y = x^2 if 0 <= x <= 3`, not `y > 0 if 0 <= x <= 3`. Writing
`if` on a region statement is rejected with an explicit error naming this
mistake.
```
y > x^2 - 1
x^2 + y^2 <= 4
```

```
field: dy/dx = <expr(x,y)>
```
Slope/direction field for a differential equation.
```
field: dy/dx = x - y
```

```
scatter: (x1,y1), (x2,y2), ...
```
Scatter points, with an automatic linear regression line.
```
scatter: (1,2), (2,3.5), (3,5), (4,7)
```

### 3D

```
z = <expr(x,y)>
```
Explicit surface.
```
z = x^2 + y^2
```

```
(fx(u,v), fy(u,v), fz(u,v)) for u in [a,b], v in [c,d]
```
Parametric surface — needs exactly two `for` clauses.
```
(u*cos(v), u*sin(v), v) for u in [0, 3], v in [0, 6.283]
```

Any of the point/segment/ray/vector/parametric-curve forms below become 3D
automatically when given a `z` component — see each entry.

### Points, segments, rays, vectors

```
label = (x, y[, z])   |   (x, y[, z])
```
A point. The label is optional; give it a `label = (...)` form to have
something to reference later (in `angle:`/`tick:`/`right-angle:`, or by name
in a later expression). **The label must be letters only** — no digits, no
underscore (e.g. `A`, `P`, `AB`, not `A1` or `2`). A digit/underscore-
containing left-hand side is parsed as a **named constant** instead (see
below), not a point, and then fails elsewhere with an unrelated-looking
error — this is a real, sharp edge, not a hypothetical one. A 3-tuple makes
it a 3D point.
```
A = (2, 3)
(1, 1)
peak = (0, 4, 2)
```

```
(x1,y1[,z1]) -- (x2,y2[,z2])
```
Segment.
```
(-2,0) -- (8,0)
```

```
(x1,y1[,z1]) -> (x2,y2[,z2])
```
Ray.
```
(0,0) -> (5,5)
```

```
vector: (x1,y1[,z1]) -> (x2,y2[,z2])
```
Same shape as a ray, additionally labeled with its own magnitude.
```
vector: (0,0) -> (3,4)
```

### Parametric and animated curves

```
(fx(t), fy(t)[, fz(t)]) for t in [a, b]
```
Parametric curve. A 3-tuple makes it a 3D curve.
```
(cos(t), sin(t)) for t in [0, 6.283]
```

```
animate: (fx(t), fy(t)[, fz(t)]) for t in [a, b]
```
Same shape, rendered as a point continuously tracing the path rather than a
static curve.
```
animate: (3*cos(t), 3*sin(t)) for t in [0, 6.283]
```

```
tangent: <expr(x)> at x = <value>
```
A tangent line to the given function at the given `x`, plus a point marking
the tangency.
```
tangent: x^2 - 1 at x = 2
```

### Named functions and constants

```
<name>(<param>) = <expr(param)>
```
Named, reusable function — usable in later statements as `<name>(...)`,
including composed with itself or other named functions.
```
k(x) = x^2 + 1
y = k(k(x))
```

```
<name> = <expr>
```
Named constant, usable as a bare variable in later statements. Note the same
letters-only-vs-general-identifier split as point labels doesn't apply here —
`<name>` here follows the general identifier rule (letters, digits,
underscore, not starting with a digit), same as `name:`'s `<id>` below.
```
a = 5
y = a*x + 1
```

### Circles, polygons, and geometry markers

```
circle: (cx, cy), r
```
Circle by center and radius.
```
circle: (0, 0), 3
```

```
polygon: A(x,y), B(x,y), C(x,y), ...
```
Closed shape from 3+ labeled vertices. Each vertex also registers as a named
point — usable by `angle:`/`tick:`/`right-angle:` and by name in later
statements' expressions, exactly as if you'd written `A = (x, y)` separately.
```
polygon: A(0,0), B(4,0), C(2,3)
```

```
angle: A-B-C [label: <text>]
```
Interior-angle arc at `B`, between rays `B->A` and `B->C`. `A`/`B`/`C` must
be names of points defined elsewhere (a plain point statement or a polygon
vertex). The optional `label:` clause shows arbitrary text (e.g. `"60°"`)
near the arc — if combining with `color:`/`name:`, `label:` must come last,
since those two are stripped from the true end of the line first.
```
angle: A-B-C label: 60°
```

```
tick: A-B [count: <n>]
```
Congruence tick mark(s) across segment `A-B`. `count` defaults to `1`; give
two `tick:` statements the same count to mark their segments congruent.
```
tick: A-B
tick: C-D count: 2
```

```
right-angle: A-B-C
```
Small square marker at vertex `B` indicating a 90° angle between rays `B->A`
and `B->C`.
```
right-angle: A-B-C
```

```
segment: A-B [dashed]
```
A segment between two *named* points, resolved the same way as `angle:`/
`tick:`'s points. Distinct from the coordinate form `(x1,y1) -- (x2,y2)`,
which cannot reference a constructed point — a construction has no
coordinates to type.
```
segment: A-D dashed
```

### Geometry constructions

Figures can be built by *construction* rather than by hand-solved
coordinates. Every construction below binds its left-hand name into the
geometry namespace **and** draws its result.

Geometry names are **letters only** (`A`, `P`, `m`, `AB`) — the same rule
point labels already follow, which keeps them distinct from the general
identifier rule a named constant (`a = 5`) uses. **A name that is already
bound is an error**, not a silent rebinding: silent rebinding would make a
figure depend on statement order in a way nothing in the spec text signals.

Constructions are **definition-before-use**, in source order. A construction
may only reference names defined on an earlier line. (Plain `A = (x, y)`
points and polygon vertices stay order-independent, as they always were.)
That makes a dependency cycle unrepresentable rather than something to detect
after the fact — the forward reference fails by name instead.

```
m = line through P parallel to A-B
n = line through P perpendicular to A-B
p = perpendicular bisector of A-B
b = bisector of angle A-B-C
```
The first three produce **infinite** lines; the angle bisector produces a
**ray** from the vertex, since the backward half of that line would bisect
the vertical angle instead. An infinite line is stored unclipped and clipped
to the view when drawn, so panning and zooming reveal more of the same line.

```
M = midpoint A-B
D = foot C to A-B
D = divide A-B at 2:3
R = reflect P over m
R = rotate P about O by 90
T = translate P by (3, -4)
E = dilate P from O by 1.5
```
Derived points. `divide` measures its ratio **from the first point**, so
`2:3` sits two fifths of the way along. `rotate` turns counter-clockwise for
a positive angle and reads its unit from `@angle`.

```
X = intersect m, n
P, Q = intersect circle O, line B-C
O = circle P, 5
```
Intersections dispatch on the kinds of their operands — line x line, line x
circle, circle x circle — and respect each line's extent, so a crossing past
a segment's end or behind a ray's origin is not a solution. An operand is a
bound name, or a line written inline as `A-B` (infinite), `segment A-B`, or
`ray A-B`; `circle O` is an optional readability prefix on a name.

When two points are found they are returned **sorted by x ascending, then y
ascending**, which is what makes `P, Q = ...` reproducible between runs.
Binding a number of names that does not match the number of solutions found
is an error — silently dropping one is how a figure becomes subtly wrong.

```
G = centroid ABC
O = circumcenter ABC
I = incenter ABC
H = orthocenter ABC
K = incircle of ABC
J = circumcircle of ABC
incircle of ABC
circumcircle of ABC
```
Triangle centres, and the two centre circles as **real circles** carrying
`r = Area/s` and `R = abc/(4*Area)` — a centre point without its circle is
not usable. The last two forms draw the circle without binding a name. `of`
is optional throughout. Three collinear points are rejected rather than
approximated.

```
triangle ABC: AB = 8, angle A = 90, AC = 6
```
A triangle solved in closed form from exactly three measurements — SSS, SAS,
ASA, AAS or RHS. Its three vertices become named points, like a polygon's do.

**Placement is fixed by convention**: the first named vertex sits at the
origin, the second on the positive x-axis, and the third in the upper
half-plane. Without that, "deterministic" would not be achievable — the
measurements fix a triangle's shape but neither its position nor its
orientation.

**SSA is deliberately refused.** Two sides and a non-included angle can admit
zero, one or two triangles, so there is no single figure to draw. Draw it as
a construction instead: place the angle at its vertex, draw a ray along one
arm, and intersect a circle centred on the far endpoint with that ray. That
yields both triangles at once, which is precisely the picture that answers
"why can't this be determined?".

A full worked figure — a right triangle with the altitude drawn to its
hypotenuse, which was unauthorable without solving for the foot by hand:
```
@angle: degrees
triangle ABC: angle A = 90, AB = 6, AC = 8
D = foot A to B-C
segment: A-D dashed
right-angle: A-D-B
```

### Tables

```
[<name>.]header: cell | cell | ...
[<name>.]row: cell | cell | ...
[<name>.]table: y = <expr(x)> for x in [a, b] step s
```
Three ways to build a value table. `header:`/`row:` are manual; `table:` is
an auto-generated value table from a function over a stepped range. The
optional `<name>.` prefix targets one specific table when a spec defines
more than one — every unprefixed `header:`/`row:`/`table:` line belongs to
the same default (unnamed) table.
```
header: x | y
row: 0 | 0
row: 1 | 1
row: 2 | 4

scores.table: y = x^2 for x in [0, 5] step 1
```

## Color and name

**Any statement may end, on the same line as the statement — not a separate
line** — with `color: <name-or-#hex>` and/or `name: <id>`, in either order:

```
y = x^2 color: blue name: parabola1
```

This is easy to get wrong because the `@key: value` config directives (see
below) *do* stand alone on their own line — `color:`/`name:` are a different
kind of thing, a trailing modifier on the statement they're attached to, not
an independent directive.

- **`color:`** — a named color (`red orange yellow green teal blue purple
  pink brown black gray grey cyan` — `gray`/`grey` are aliases for the same
  color, case-insensitive) or `#rrggbb` hex.
- **`name:`** — a plain identifier (letters, digits, underscore, not
  starting with a digit) that `@hide: <id>` / `@show: <id>` can later target.
  Independent of a function/constant's own name (`k` in `k(x) = ...`), so a
  plotted statement that *uses* a function can share that function's name on
  purpose: `y = k(x) name: k` lets `@hide: k` hide this specific curve
  without touching `k`'s definition.

## Config directives

One per line, anywhere in the spec, `@key: value`. Order doesn't matter for
different keys; for a repeated key, the last one wins.

| Directive | Values | Default | Notes |
|---|---|---|---|
| `@bounds` | `xMin,xMax,yMin,yMax` | auto | axis window; `xMin < xMax` and `yMin < yMax` required |
| `@xstep`, `@ystep` | positive number | auto | gridline spacing |
| `@grid` | `on`\|`off` | `on` | |
| `@axes` | `on`\|`off` | `on` | |
| `@angle` | `degrees`\|`radians` | `radians` | affects `sin`/`cos`/`tan` argument interpretation |
| `@mode` | `graph`\|`table` | `graph` | force table-only rendering |
| `@points` | `roots`,`extrema`,`inflections`,`intersections`,`conic`,`all`,`none` (comma list) | none marked | auto-mark these feature points; `intercepts` and `vertices` (v1's names for `roots` and `extrema`) remain accepted as permanent aliases, since stored questions carry them and the server validates `graph_spec` with this same parser — see "Known limitations" below |
| `@point-labels` | `off`\|`coords` | `off` | print a detected feature point's coordinates next to its marker |
| `@labels` | `all`\|`coarse`\|`none` | `all` | tick-label density, independent of `@axes` — `coarse` labels only the major (every-5th) gridline, `none` gives a numberless graph with the axes and grid still drawn |
| `@label-every` | positive integer | `1` | label every nth gridline; overrides `@labels: coarse`'s implicit every-5th when set |
| `@step-mode` | `nice`\|`geometric`\|`fixed` | `nice` | how a fixed `@xstep`/`@ystep` rescales when the view is zoomed outside its 3-14 division comfort band — see mistake 5 below |
| `@asymptotes` | `on`\|`off` | `on` | dashed guide at a detected vertical asymptote (curve-splitting there always happens; this only toggles the guide line itself) |
| `@formulas` | `on`\|`off` | `off` | show a `table:` generator's formula alongside its table |
| `@theme` | `light`\|`dark` | `light` | |
| `@hover` | `all`\|`points`\|`features`\|`none` | `all` | `features` restricts hover snapping to detected feature points only (skipping curves, segments, and plain plotted points); a snapped feature reports its exact analytic value, not an interpolated sample |
| `@hide` | `<name>[,<name>...]` | — | hide specific named statements/tables (by their `name:` clause) |
| `@show` | `<name>[,<name>...]` | — | un-hide — a later directive always wins for that specific name, regardless of order |

## `desmos_allowed` vs `calculator_policy` — two independent axes

Easy to conflate, don't:

- **`calculator_policy`** (`'allowed'|'forbidden'|'n_a'`, default `'n_a'`) is
  a **draw-time gate** templates filter on. `'forbidden'` means the question
  must be doable by hand; `'allowed'` means tool use doesn't change what's
  being tested; `'n_a'` (default) means the axis doesn't apply at all
  (history, reading, most arithmetic) and renders nothing in the UI, not a
  struck-through symbol.
- **`desmos_allowed`** (boolean, default `false`) is a separate,
  **per-question** signal for whether a graphing calculator specifically
  would meaningfully help *this* question — set `true` only when plotting or
  exploring a function actually helps (graphing/algebra/precalc/calc/stats),
  not just because one would be technically permitted under
  `calculator_policy`.

A question can be `calculator_policy: 'allowed'` and `desmos_allowed: false`
at the same time — e.g. an allowed-calculator arithmetic question a graphing
tool adds nothing to.

## Common mistakes

These cost real failed round trips in a live authoring session
(2026-08-20) before this document existed — now documented up front instead
of discoverable only via a validator error:

1. **`color:`/`name:` on their own line.** They must share the line with the
   statement they modify — see "Color and name" above.
2. **A digit/underscore in a point label.** `2 = (2, 3)` doesn't error
   cleanly — it falls through to the named-constant grammar (since a point
   label is letters-only but a constant name allows digits/underscore) and
   then fails with an unrelated parse error further down. Use a letters-only
   label: `soln = (2, 3)`.
3. **Assuming the tag/taxonomy conventions apply here too.** They don't —
   `graph_spec` has its own grammar, entirely separate from tag slugs. See
   `readme()`'s `tag_conventions` for that one.
4. **An `if <condition>` clause on an inequality region.** `y > 0 if 0 <= x
   <= 3` is rejected with an explicit error — `if` only exists on `y=`/`x=`
   explicit statements. Restrict the function itself instead: `y = x^2 if 0
   <= x <= 3`. See "Shaded inequality region" above.
5. **Expecting `@xstep` to survive a zoom.** By default it does not — outside
   3 to 14 visible divisions the step falls back to the universal 1-2-5 ladder,
   so a spec written in 8s shows 10s when zoomed out. Use
   `@step-mode: geometric` to keep the author's base: 8 → 64 → 512.

## Known limitations

Real gaps found while building the feature-point/intersection work, not
hypothetical edge cases — worth knowing before authoring around them:

- **`@points: intersections` does not find tangencies.** Intersection finding
  looks for sign changes of `f - g` across the visible range. Where two curves
  *touch* without crossing — a tangent line meeting the curve it's tangent to,
  or `y = x^2` against `y = 0` — there's a root of `f - g` but no sign change,
  so nothing is reported at that point. Plain crossings are unaffected; this
  is specifically the touch-without-cross case. Don't rely on this directive
  to mark a point of tangency.
- **Explicit `x = f(y)` statements get no feature points.** Feature detection
  (`roots`, `extrema`, `inflections`, and the curves fed into `intersections`)
  only runs over explicit `y = f(x)` statements — a sideways parabola written
  as `x = y^2` will show no intercepts or extrema even with `@points: all`
  set. Write the curve as `y = f(x)` (or accept no markers) if feature points
  matter for it.
- **`@points: conic` is accepted but currently marks nothing.** The parser
  expands it to the `center`/`focus`/`conic-vertex` feature kinds and the
  renderer already knows how to draw them, but no detector populates them yet
  for any statement kind (implicit conics like `x^2/9 + y^2/4 = 1` included) —
  this group is reserved for later work, not a settled no-op you should route
  around by hand.

## Where the source of truth lives

- Grammar: `graph-engine/src/parser/types.ts`'s top comment, `parseStatement.ts`
- Expression grammar: `graph-engine/src/parser/parseExpr.ts`, `evalExpr.ts` (builtins/constants)
- Config directives: `graph-engine/src/parser/parseConfig.ts`, `config.ts`
- Feature point / intersection detection: `graph-engine/src/scene/featurePoints.ts`,
  `graph-engine/src/scene/roots.ts` (the old `detectFeaturePoints.ts` sampled-array
  scan is gone, replaced by these two)
- Colors: `graph-engine/src/parser/colors.ts`
- Server-side validation entry point: `server/src/domain/questions.ts`'s `validateQuestionInput` (calls `parseSpec`)
- Condensed in-tool version Claude actually reads mid-session: `server/src/domain/bootstrap.ts`'s `GRAPH_DSL_REFERENCE`
