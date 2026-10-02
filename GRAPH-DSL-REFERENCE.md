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

**Errors name their line.** A statement that parses but cannot be drawn is
reported on its own line — in a 2D plot too, since calc P1: a typo in a function name (`y = sinn(x)` is `Unknown
function "sinn"`), an unknown variable, a bad definition (a name defined twice)
and a curve that is undefined across the whole view or range ("this curve is
undefined everywhere in view") are each an error on that statement's line and
leave the other statements drawn. Before calc P1 these in a plot statement
(`y =`, `r =`, a parametric curve) drew nothing and said nothing, and a 2D error
that did appear had no line number.

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

## Expressions: the calculus kernel (calc P1)

The syntax below is read by `parseExprString` and `parseConditionString`
(`graph-engine/src/parser/parseExpr.ts`) and evaluated by the shared calculus
kernel (`graph-engine/src/math/`, shared with the 3D space engine). Everything
the "Expression grammar" section describes still parses to the same tree it
always did, with one exception under "Powers of a function" below. The new
forms (bars, factorial, primes, braces, conditions, and the sum, product and
integral forms) each used to be a syntax error.

**Real odd roots.** A power whose exponent is a ratio of integer literals that
reduces to `p/q` with `q` odd takes the real root, so it is defined for a
negative base:

```
x^(1/3)      # real cube root: -2 at x = -8
x^(2/3)      # the cube root, squared: 4 at x = -8
```

The rule reads the exponent's shape, never a float: `x^0.333`, `x^0.5` and
`x^(1/2)` stay the principal power (undefined for negative `x`).

**More built-ins.** The trig functions read their angle, and the inverse trig
functions return theirs, in the spec's `@angle` unit; the hyperbolic functions
take plain numbers.

| Function | Meaning | Example |
|---|---|---|
| `gamma(x)` | the gamma function; `gamma(n + 1)` is `n!` | `gamma(5)` is 24 |
| `erf(x)`, `erfc(x)` | the error function and `1 - erf(x)` | `erf(1)` is 0.8427 |
| `cbrt(x)` | real cube root, negative `x` included | `cbrt(-8)` is -2 |
| `root(n, x)` | real `n`-th root for a whole `n`; an even root of a negative is undefined | `root(4, 16)` is 2 |
| `step(x)` | Heaviside step: 0 below zero, 1 from zero up | `step(0)` is 1 |
| `choose(n, k)` | binomial coefficient | `choose(5, 2)` is 10 |
| `perm(n, k)` | `n!/(n - k)!`, the ordered selections | `perm(5, 2)` is 20 |
| `gcd(a, b)`, `lcm(a, b)` | greatest common divisor, least common multiple, of whole numbers | `gcd(12, 18)` is 6 |
| `asin`, `acos`, `atan`, `atan2(y, x)` | inverse trig | `atan2(1, 1)` is `pi/4` in radians |
| `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh` | hyperbolic and their inverses | `asinh(1)` is 0.8814 |
| `sec`, `csc`, `cot` | reciprocals of `cos`, `sin`, `tan` | `sec(0)` is 1 |
| `floor`, `ceil`, `round`, `sign` | `round` takes halves away from zero | `round(-2.5)` is -3 |
| `mod(a, b)` | remainder with the sign of `b` | `mod(-1, 3)` is 2 |
| `min(a, b, …)`, `max(a, b, …)` | two or more arguments | `max(1, 2, 3)` is 3 |
| `hypot(a, b, …)` | square root of the sum of squares, two or more arguments | `hypot(3, 4)` is 5 |

`inf` is a constant like `pi` and `e` (∞), meant for the bounds of an integral.

**Absolute value.** `|x - 1|`. A bar where an operand is expected opens a pair;
a bar after an operand closes the open pair, or multiplies when none is open. So
`2|x|` is `2·|x|`, `|x||y|` is `|x|·|y|`, and `||x| - 1|` nests. Parentheses
start over: in `|(2|x|)|` the inner pair multiplies.

**Factorial.** `n!` is postfix and means `gamma(n + 1)`: exact at whole numbers,
undefined at the negative integers. It binds tighter than `^` and than unary
minus, so `-3!` is `-(3!)` = -6 and `2^3!` is `2^(3!)` = 64. Parenthesise to
take the factorial of a sum: `(2k + 1)!`. `!=` is "not equal", so `n!=5` is the
condition `n != 5`; write `n! = 5` with a space when you mean the factorial
equation. A statement that has a bare `!=` outside any bracket (`y != 2`,
`x^2 + y^2 != 1`) is refused, not read as an equation: `!=` is a condition, and
belongs in a piecewise `{…}` (see "Conditions").

**Derivatives by name.** `f'(x)`, `f''(x + 1)`, up to five primes: the exact
derivative of a function the document defines, at that point. Only a user
function can be primed (`sin'(x)` is an error), a function the kernel cannot
differentiate exactly is refused rather than approximated, and six primes is an
error.

**Powers of a function.** `sin^2(x)` is `(sin(x))^2`. `sin^-1(x)` is the
inverse, `asin(x)`, as textbooks write it; the same goes for `cos`, `tan`,
`sinh`, `cosh` and `tanh`. `sec^-1`, `csc^-1` and `cot^-1` have no built-in and
are refused with the spelling to use (`acos(1/x)`, `asin(1/x)`, `atan(1/x)`).
This reads only a built-in's name directly followed by `^`; `x^2(x + 1)` is
still `x^2·(x + 1)`, and a built-in name raised to a power with no parenthesised
argument (`gamma^2`) is the name to a power. The one input that read differently
before is a built-in's name, `^`, an exponent and a parenthesised argument
(`sin^2(x)`), which used to parse as `sin^2·(x)` with `sin` an unknown variable.

**A name before parentheses.** A name that is a value (a variable, a parameter
or a constant) and is called with one argument is a product: `x(x + 1)` is
`x·(x + 1)`, and with `k = 2` defined, `k(x + 1)` is `2·(x + 1)`. Built-in names
are the exception: `sin(x)` is always the function. A document's own value (a
`@param` or a constant) takes its name over a built-in function of the same
name: after `@param gamma = 2`, `gamma` is the parameter, and calling
`gamma(3)` is the error `"gamma" is a parameter in this document; rename it to
use the built-in gamma function`. (A *function* the document defines,
`sin(z) = z^2`, replaces the built-in quietly, as it always has.)

**Piecewise.** `{condition: value, condition: value, …, otherwise}`:

```
{x < 0: x^2, x <= 2: 2x + 1, 5}
```

The value is that of the first piece whose condition holds. A final bare value
is the "otherwise"; without one the expression is undefined where no condition
holds, and an undefined condition reached before any true one makes the whole
value undefined. A bare value anywhere but last, a condition that is not a
comparison (`{x: 1}`) and a missing `:` are errors. Braces multiply like
parentheses (`2{x < 0: 1, 0}`) and may nest.

**Conditions.** The comparisons are `<`, `<=`, `>`, `>=`, `=` and `!=`; a chain
`0 < x <= 1` tests each link and requires all of them; `and`, `or` and `not`
combine them, with `not` binding tightest, then `and`, then `or`:

```
0 < x < 1
x < 0 or x > 1 and y != 2      # x < 0, or both x > 1 and y != 2
not x = 0
```

Parentheses do not group conditions (they start an expression). A comparison
is only valid as a condition: `x < 1` on its own, outside braces, is an error,
and a statement such as `y != 2` is refused rather than read as `y! = 2`.
`and`, `or` and `not` are keywords only inside a condition, and `to` only inside
a sum, product or integral; anywhere else they are ordinary names.

**Sums, products and integrals.**

```
sum(k = 0 to n, x^k)
prod(k = 1 to n, k)
integral(t = 0 to x, sin(t)/t)
integral(t = 0 to inf, exp(-t))
```

The variable (`k`, `t`) exists only inside the body; the bounds are outside it.
A sum or product runs over the whole numbers between its bounds: a literal
bound that is not whole is an error (a bound read from a parameter gives an
undefined value), at most 100000 terms are allowed, and `inf` is not a sum
bound. An integral may have infinite bounds (`inf`, `-inf`) and is computed
numerically; a variable upper bound is differentiable (if the document defines
`F(x) = integral(t = 0 to x, sin(t)/t)`, then `F'(x)` is `sin(x)/x`). `sum(x)`,
with no `=`, is still an ordinary call to a function named `sum`.

**Reserved names.** Names that start with `__` are reserved for the kernel. The
forms above are stored as calls to them (`__piecewise`, `__lt`, `__and`,
`__factorial`, `__prime`, `__sum`, `__prod`, `__integral` and the like) so that
no new expression node was needed; do not define or call one yourself.

## Statement catalog

Every entry is a full line (or, for parametric forms, the shape before the
`for ... in [...]` clause).

### 2D functions and curves

```
y = <expr(x)> [if <condition>]
```
Explicit function of `x`. The optional `if <condition>` restricts where it is
drawn — `x < 0`, `x >= 2`, a chain `-1 <= x < 1`, or any combination with
`and`, `or`, `not` and `!=` (see "Conditions" above). The condition may test
only the independent variable (`x` here): `y = x if y > 0` is an error on its
line (`Unknown variable "y"`), because a test on the value being drawn is a
region, not a domain — shade it with `y > 0` instead. A domain that is not one
interval draws as separate pieces and never joins them across the gap, so
`y = 1 if x < -1 or x > 1` is two half-lines. The bounds in a condition may be
any constant expression, including your own definitions and `@param` values.
```
y = x^2 - 4
y = 1/x if x > 0
y = -x + 1 if -2 <= x < 3
y = 1 if x < -1 or x > 1
y = x if x != 0
```

```
x = <expr(y)> [if <condition>]
```
Explicit function of `y` — same condition grammar as above, mirrored to the
`y` axis (so the condition tests `y`).
```
x = y^2
x = y^2 if y > 0
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
<expr(x,y)> = <expr(x,y)> [if <condition>]
```
Implicit curve — anything that isn't `y = ...`, `x = ...`, `z = ...`, or a
labeled point falls here. Covers conics, circles-by-equation, etc. An optional
`if <condition>` keeps only the part of the curve where the condition holds;
unlike an explicit statement's, it may test both `x` and `y`.
```
x^2/9 + y^2/4 = 1
x^2 + y^2 = 9 if y > 0
```

```
<expr(x,y)> <|<=|>|>= <expr(x,y)> [if <condition>]
<expr> <|<= <expr(x,y)> <|<= <expr> [if <condition>]
```
Shaded inequality region, or a chained region (`-2 < x < 4`) between two
bounds. An optional `if <condition>` restricts the shading (and its edge) to
where the condition holds, with the same grammar as above over both `x` and `y`:
`and`, `or`, `not`, `!=` and chains all work. The `if` belongs to the whole
statement, so `y > 0 if 0 <= x <= 3` shades `y > 0` for `x` between 0 and 3.
```
y > x^2 - 1
x^2 + y^2 <= 4
x^2 + y^2 < 9 if y > 0 and x > -1
y > 0 if 0 <= x <= 3
```
The restriction is applied after the region is traced: each piece of shading
is kept when the condition holds at its centre, and each stretch of edge when
it holds at its midpoint, so the cut edge follows the plotting grid rather
than being exact. Exact clipping to the condition comes later.

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
including composed with itself or other named functions. A definition may take
several parameters, `g(x, a) = a sin(x)`, and is then called with all of them,
`g(x, 2)`. A function the document defines can be primed, `f'(x)`, and used
inside piecewise braces, sums and integrals (see "Expressions: the calculus
kernel" above). A name defined twice is an error on the later line (`"f" is
defined twice (lines 1 and 2) — the later definition is used`).
```
k(x) = x^2 + 1
y = k(k(x))
g(x, a) = a sin(x)
y = g(x, 2)
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

### Circle vocabulary

A circle can be outlined, intersected, **and worked with**: a chord, an arc,
the two regions built on an arc, tangents, a secant, a radius and a diameter,
plus the central and inscribed angle marks. Every one of them names the
circle it is on, because in a figure with two circles "the chord P-Q" means
nothing.

The circle has to be **named**, which `circle: (0,0), 3` does not do — use
the construction form:
```
C = (0, 0)
O = circle C, 5
```

```
c = chord P-Q on O
t = tangent at P on O
t, u = tangent from X to O
k = secant P-Q on O
u = radius O to P
d = diameter P-Q on O
```
All six produce lines, so they bind names and can be intersected, measured
and labelled. Each form also works **without** a name, drawn on its own line
(`chord P-Q on O`), the way `incircle of ABC` does.

`tangent at P on O` needs P **on** the circle and produces the infinite
tangent line there. `tangent from X to O` needs X **outside** it and produces
the **two** tangents, drawn to their touch points — so each one's length is
the tangent length — **ordered by the same rule `intersect` uses** (x
ascending, then y), which is what makes `t, u = ...` reproducible. A point
inside the circle, or a chord endpoint that is not on it, fails with a
message naming the gap it missed by, rather than drawing a "tangent" that
visibly crosses.

`secant P-Q on O` is the line through two points that must cut the circle
twice; a line that misses it, or merely touches it, is refused (the second is
a tangent, and saying so is more useful than drawing it).

```
arc P-Q on O minor
sector P-Q on O major
segment P-Q on O ccw
central angle P-Q on O minor
inscribed angle P-Q-R on O
```

**An arc must say which way it goes.** "The arc from P to Q" is two different
arcs, so every arc form ends with `minor`, `major`, `ccw` or `cw`, and
leaving it out is an error rather than a default — a figure that silently
drew the other arc would look perfectly plausible. `minor`/`major` are
refused on a **diameter**, where both arcs are semicircles and neither is the
smaller one; write `ccw` or `cw` there.

`sector` is the wedge closed through the centre, `segment` the region between
the arc and its own chord. Both are fills and are painted behind every line
and mark. (`segment P-Q on O <direction>` is the circular segment;
`segment: A-B` with a colon is still the segment of a *line*.)

An arc's measure and the central angle drawn for it are **the same number,
computed once**, so they cannot disagree:
```
label: arc PQ on O minor       # prints the measure, honouring @angle
label: arc PQ on O minor = 60  # prints 60, and fails if the figure disagrees
given: arc PQ on O minor = 60  # the same, in the givens table
central angle P-Q on O minor   # the mark at the centre, printing that measure
```

A worked circle figure — a chord, its minor arc shaded, the tangent at one
end of the chord and a secant through the other:
```
@mode: figure
@angle: degrees
C = (0, 0)
O = circle C, 5
P = (5, 0)
Q = (0, 5)
R = (-3, 4)
chord P-Q on O
segment P-Q on O minor
t = tangent at P on O
k = secant Q-R on O
label: arc PQ on O minor
```

These draw in **figure mode**. In graph mode the arc forms say so rather than
drawing nothing; the six line-producing constructions work in both.

### The givens table

A dense figure reaches a point where inline labelling makes it worse rather
than better. The renderer draws an optional **boxed table** beside the
drawing instead — the convention competition figures already use, and the
pressure valve for label density: when placement gets hard, move some of it
out of the drawing.

```
given: AB = 8
given: angle ABC = 90
given: AB parallel CD
find: BC
```

Each row is a **subject, a relation and a value**, set as three aligned
columns — subjects share a left edge, relations share theirs, values share
theirs — because that is what a statement of givens is, and a ragged stack of
lines stops being readable at the length a real problem reaches. The subject
is written in geometry notation (an overbar on a segment, the angle and
triangle signs, the arc mark), and the columns are measured on the
**rendered** run, so a row carrying an overbar sits level with one that does
not.

A stated value is checked against the figure exactly as an inline label is,
and suppressed the same way by `@scale: false`. The relation form takes a
keyword or the symbol: `congruent`/`cong`/`≅`, `similar`/`sim`/`~`,
`parallel`/`par`/`∥`, `perpendicular`/`perp`/`⊥`.

`find:` is the same row in the table's other section. A problem states what
it is given and then asks for something, and the two are sections of one
table rather than two boxes. `GIVEN` comes before `FIND` however the lines
were typed. `@givens-title:` adds a heading above both, and `@givens:` says
which corner or side of the figure the box sits on — always outside the
drawing, never over it.

```
@givens: bottom-right
@givens-title: Problem 14
```

This is **not** the `@mode: table` data table, which presents rows of data and
is a different part of the engine. A givens table is part of the figure,
sized and placed with it, inside the same SVG.

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
| `@mode` | `graph`\|`figure`\|`table` | inferred | which renderer draws the spec: the plot canvas, the SVG figure renderer (geometry on bare paper — no axes, grid, pan or zoom), or a plain HTML table. **State it explicitly, including `@mode: graph`** — see below |
| `@points` | `roots`,`extrema`,`inflections`,`intersections`,`conic`,`all`,`none` (comma list) | none marked | auto-mark these feature points; `intercepts` and `vertices` (v1's names for `roots` and `extrema`) remain accepted as permanent aliases, since stored questions carry them and the server validates `graph_spec` with this same parser — see "Known limitations" below |
| `@point-labels` | `off`\|`coords` | `off` | print a detected feature point's coordinates next to its marker |
| `@labels` | `all`\|`coarse`\|`none` | `all` | tick-label density, independent of `@axes` — `coarse` labels only the major (every-5th) gridline, `none` gives a numberless graph with the axes and grid still drawn |
| `@label-every` | positive integer | `1` | label every nth gridline; overrides `@labels: coarse`'s implicit every-5th when set |
| `@step-mode` | `nice`\|`geometric`\|`fixed` | `nice` | how a fixed `@xstep`/`@ystep` rescales when the view is zoomed outside its 3-14 division comfort band — see mistake 5 below |
| `@asymptotes` | `on`\|`off` | `on` | dashed guide at a detected vertical asymptote (curve-splitting there always happens; this only toggles the guide line itself) |
| `@formulas` | `on`\|`off` | `off` | show a `table:` generator's formula alongside its table |
| `@givens` | `top-left`\|`top-right`\|`bottom-left`\|`bottom-right`\|`left`\|`right` | `top-left` | which corner or side of the figure the givens table sits on — always outside the drawing |
| `@givens-title` | text | none | a heading above the givens table's sections, e.g. `Problem 14` |
| `@scale` | `on`\|`off` | `on` | `off` is the "figure not drawn to scale" flag: it suppresses the check an asserting measure (`label: AB = 8`) performs |
| `@theme` | `light`\|`dark` | `light` | |
| `@hover` | `all`\|`points`\|`features`\|`none` | `all` | `features` restricts hover snapping to detected feature points only (skipping curves, segments, and plain plotted points); a snapped feature reports its exact analytic value, not an interpolated sample |
| `@hide` | `<name>[,<name>...]` | — | hide specific named statements/tables (by their `name:` clause) |
| `@show` | `<name>[,<name>...]` | — | un-hide — a later directive always wins for that specific name, regardless of order |
| `@param` | `<name> = <value> range [<min>, <max>] [step <s>] [integer]` | — | a named constant with a range, usable in every expression: `@param n = 3 range [0, 12] step 1 integer`. In a 2D graph every expression sees the authored value (there is no slider in the 2D viewer yet). A definition with the same name is an error on its line, and the `@param` is used |

## Declare `@mode`. Always. Including `@mode: graph`.

When a spec does not say, the mode is **inferred**: a spec whose drawable
content is entirely geometry (points, segments, polygons, circles,
constructions, marks) renders as a **figure** — bare paper, no axes or grid,
1:1 aspect, auto-fit; a spec containing any plotted function (`y = f(x)`, an
implicit curve, a region, polar, parametric, a field, scatter, a surface)
renders as a **graph**, constructions included.

**Inference is a safety net, not the recommended path.** Write the mode
anyway, and the reason is concrete: under inference, adding one plotted
function to a figure silently changes the entire presentation from paper to
plot. An explicit `@mode:` line makes that impossible and makes the author's
intent legible to the next reader. A spec that declares its mode cannot be
surprised by its own content.

This matters for **existing** questions too. A stored spec using `polygon:`,
`circle:`, `angle:` and `tick:` with no plotted function used to draw on the
graphing canvas with axes and grid; under inference it now renders as a bare
figure. That is usually the better picture — those specs were drawing
geometry onto a plot because there was nowhere else to draw it — but if the
axes were the point, `@mode: graph` restores the old presentation exactly.

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
4. **An `if <condition>` on the value being drawn.** An explicit statement's
   `if` may test only its independent variable: `y = x if y > 0` is an error on
   its line (`Unknown variable "y"`). A test on the dependent variable is a
   region — write `y > 0 if …`, or restrict the function by `x`: `y = x^2 if 0
   <= x <= 3`. See "2D functions and curves" above. (An `if` on a region or an
   implicit curve is fine: it was rejected before calc P1 and now restricts the
   drawing.)
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
- Expression grammar: `graph-engine/src/parser/parseExpr.ts`; evaluation: `graph-engine/src/math/compile.ts` (the shared kernel) through `graph-engine/src/plot/scope.ts` for 2D plots and tables. `parser/evalExpr.ts` (builtins/constants) still serves geometry constructions and `animate:`
- Config directives: `graph-engine/src/parser/parseConfig.ts`, `config.ts`
- Feature point / intersection detection: `graph-engine/src/scene/featurePoints.ts`,
  `graph-engine/src/scene/roots.ts` (the old `detectFeaturePoints.ts` sampled-array
  scan is gone, replaced by these two)
- Colors: `graph-engine/src/parser/colors.ts`
- Server-side validation entry point: `server/src/domain/questions.ts`'s `validateQuestionInput` (calls `parseSpec`)
- Condensed in-tool version Claude actually reads mid-session: `server/src/domain/bootstrap.ts`'s `GRAPH_DSL_REFERENCE`
