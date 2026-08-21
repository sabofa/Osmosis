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
| `@points` | `intercepts`,`vertices`,`all`,`none` (comma list) | none marked | auto-mark these feature points |
| `@asymptotes` | `on`\|`off` | `on` | dashed guide at a detected vertical asymptote (curve-splitting there always happens; this only toggles the guide line itself) |
| `@formulas` | `on`\|`off` | `off` | show a `table:` generator's formula alongside its table |
| `@theme` | `light`\|`dark` | `light` | |
| `@hover` | `all`\|`points`\|`none` | `all` | |
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

## Where the source of truth lives

- Grammar: `graph-engine/src/parser/types.ts`'s top comment, `parseStatement.ts`
- Expression grammar: `graph-engine/src/parser/parseExpr.ts`, `evalExpr.ts` (builtins/constants)
- Config directives: `graph-engine/src/parser/parseConfig.ts`, `config.ts`
- Colors: `graph-engine/src/parser/colors.ts`
- Server-side validation entry point: `server/src/domain/questions.ts`'s `validateQuestionInput` (calls `parseSpec`)
- Condensed in-tool version Claude actually reads mid-session: `server/src/domain/bootstrap.ts`'s `GRAPH_DSL_REFERENCE`
