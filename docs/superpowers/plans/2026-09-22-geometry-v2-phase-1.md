# Geometry v2, Phase 1 — The Construction Core

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make geometry figures authorable by *construction* rather than by hand-solved coordinates — points, lines and circles as first-class objects that can be intersected, derived from one another, and produced by closed-form triangle solvers.

**Architecture:** a geometry object model (point / line / circle) lives alongside the existing statement grammar. Named geometry objects bind into one namespace. Constructions are closed-form and deterministic; there is no numeric constraint solver. Everything is built on exact arithmetic over `Vec2`, not on sampling.

**Tech Stack:** TypeScript, Vitest (node). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 2 — Geometry v2". Read it before Task 1; the "Constructions" and "Non-goals" sections bind this plan.

**Note on plan style:** this plan specifies *decisions, interfaces, semantics and required test cases* rather than literal code. That is deliberate — it is written for a capable executor, and over-specified code would constrain a better implementation than the plan author had in mind. Where a decision is load-bearing it is stated as a decision and must not be varied without recording why.

## Global Constraints

- **No new runtime dependencies.** This is closed-form arithmetic.
- **No numeric constraint solver.** Per the spec's Non-goals. If a construction cannot be expressed in closed form, it is out of scope, not a reason to add a solver.
- **Determinism is the point of this design.** The same spec text must produce the identical figure on every run, because an AI tutor authors these and a figure that moves between runs is unusable. Any construction with multiple solutions needs a stated, tested ordering.
- **Failures must be local and legible.** "line B-C and circle O do not intersect" is actionable; "solver did not converge" is not. Every construction that can fail names the objects involved.
- **Existing behaviour is untouchable.** 202 tests currently pass. The existing `polygon:`, `circle:`, `angle:`, `tick:`, `right-angle:` statements keep working exactly as they do. This phase *adds* a construction layer; it does not rewrite what exists.
- **`@points: intercepts` / `vertices` must keep parsing** — stored questions carry them and the server validates `graph_spec` with this parser.
- Test command: `npm run test --workspace=graph-engine`. Also `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine` must be clean before any task is considered done.
- Commit per task, lowercase `type(scope): summary`, body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  A fixed repo convention, not a description of which model did the work.

---

## Load-bearing decisions

These are settled. Do not vary them without recording the reason in the task report.

**D1 — Three object kinds.** `point` (a `Vec2`), `line` (a pair of defining points plus an extent: `infinite | ray | segment`), `circle` (centre plus radius). Everything in this phase produces or consumes these.

**D2 — One namespace.** A geometry name binds to any of the three kinds. `intersect m, n` resolves both by name and dispatches on their kinds. Names follow the existing **point-label rule: letters only** (`A`, `P`, `m`, `AB`), which keeps them distinct from the general-identifier rule used by named constants (`a = 5`). A name that is already bound is an error naming the prior binding — silent rebinding would make figures order-dependent.

**D3 — Multi-solution ordering.** A line×circle or circle×circle intersection yields 0, 1 or 2 points. When it yields 2, they are returned **sorted by x ascending, then y ascending**. This is what makes `P, Q = intersect ...` reproducible. It must be tested directly, including a case where the two solutions share an x.

**D4 — Solution-count mismatch is an error.** Binding two names to a construction that produced one point, or one name to a construction that produced two, fails with a message stating how many were found. Silently dropping a solution is how a figure becomes subtly wrong.

**D5 — Triangle placement convention.** A solved triangle is placed deterministically: first named vertex at the origin, second on the positive x-axis, third in the upper half-plane (positive y). Without a fixed convention "deterministic" is not achievable, since the constraints fix the shape but not its position or orientation. State this in the DSL reference when documentation is written.

**D6 — Degenerate constructions fail, they do not approximate.** Parallel lines have no intersection; three collinear points have no circumcentre; a triangle with sides violating the triangle inequality is not constructible. Each reports what was wrong.

---

### Task 1: The geometry object model

**Files:** create `graph-engine/src/scene/geometry/types.ts`, `graph-engine/src/scene/geometry/objects.ts` and a test file. Nothing existing is modified.

**Produces:** the `GeometryObject` union (point / line / circle per D1), constructors, and a `GeometryScope` that binds names to objects with the D2 rules (letters-only names, no silent rebinding, lookup failure names the missing name).

Also provide the primitive predicates the later tasks need: are two lines parallel, is a point on a line, line direction and normal, and the foot of the perpendicular from a point to a line.

**Required tests:** binding and lookup; rebinding rejected with the prior binding named; unknown name lookup rejected; a non-letters name rejected; parallel detection including near-parallel-but-not; foot-of-perpendicular against hand-computed values for a non-axis-aligned line.

**Why this task is first:** every later task consumes this. Getting the namespace semantics wrong here propagates everywhere.

---

### Task 2: Intersections

**Files:** `graph-engine/src/scene/geometry/intersect.ts` plus tests.

**Consumes:** Task 1's object model.

**Produces:** `intersect(a: GeometryObject, b: GeometryObject): Vec2[]` dispatching on kind pairs — line×line, line×circle, circle×circle — returning 0, 1 or 2 points ordered per D3.

Line extent matters: an intersection lying outside a `segment`'s span, or behind a `ray`'s origin, is not a solution. This is a real source of wrong figures if skipped.

**Required tests:** each kind pair; the tangent case yielding exactly one point; the disjoint case yielding zero; concentric circles yielding zero; identical objects rejected rather than returning infinite solutions; **the D3 ordering, including two solutions sharing an x**; segment and ray extents excluding out-of-span hits. For the tangency case, verify the single point is correct rather than merely that the count is one.

---

### Task 3: Derived points

**Files:** `graph-engine/src/scene/geometry/derive.ts` plus tests.

**Produces:** `midpoint`, `foot` (of the perpendicular from a point to a line), `divide` (a segment in a ratio `m:n`), `reflect` (a point over a line), `rotate` (about a centre by an angle, honouring `config.angle`'s degrees/radians setting), `translate`, `dilate`.

**Required tests:** each construction against hand-computed values on non-axis-aligned inputs — axis-aligned cases hide sign and ordering errors. `divide` at `2:3` and at `1:1` (which must agree with `midpoint`). `reflect` over a non-axis-aligned line, and the invariant that reflecting twice returns the original. `rotate` in both angle modes, and that a 360° rotation is the identity.

---

### Task 4: Triangle centres and their circles

**Files:** `graph-engine/src/scene/geometry/centres.ts` plus tests.

**Produces:** `centroid`, `circumcentre`, `incentre`, `orthocentre`, and crucially **`incircle` and `circumcircle` returning actual circles** — centre *and* radius (`r = Area/s`, `R = abc/(4·Area)`), plus the incircle's three tangent points.

The spec is explicit that a centre point without its circle is not usable, which is why this task produces circles rather than only points.

**Required tests:** each centre on a scalene triangle against hand-computed values (an equilateral triangle hides errors — all four centres coincide). The known invariant that centroid, circumcentre and orthocentre are collinear on the Euler line, and that the centroid divides the segment from orthocentre to circumcentre in a 2:1 ratio — this single test catches a large class of arithmetic errors at once. Incircle radius verified by checking the distance from the incentre to each of the three sides is equal. Collinear points rejected per D6.

---

### Task 5: Line constructions

**Files:** extend `graph-engine/src/scene/geometry/` plus tests.

**Produces:** `line through P parallel to A-B`, `line through P perpendicular to A-B`, `perpendicular bisector of A-B`, `bisector of angle A-B-C`.

These four are the constructions the spec names as structurally impossible in v1 — they produce *lines*, and v1 had nowhere for a line to live. They are what makes the common similar-triangle and angle-bisector setups authorable.

**Required tests:** each against hand-computed values on non-axis-aligned inputs. The parallel line is genuinely parallel (Task 1's predicate) and genuinely passes through P. The perpendicular bisector is equidistant from both endpoints. The angle bisector's two half-angles are equal to within tolerance. A degenerate angle (`A`, `B`, `C` collinear) rejected per D6.

---

### Task 6: Solved triangles

**Files:** `graph-engine/src/scene/geometry/solveTriangle.ts` plus tests.

**Produces:** the five classic closed-form cases — SSS, SAS, ASA, AAS, RHS — placed per **D5**.

**SSA is deliberately excluded** and must be rejected with a message explaining that it is ambiguous and pointing at the circle-intersection construction as the way to draw both solutions. Per the spec, the ambiguous case is a *strength* of this model: intersecting a circle with a ray yields both triangles, which is precisely the picture that answers "why can't this be determined?" The error message should teach that, not merely refuse.

**Required tests:** each of the five cases against hand-computed vertices, including the D5 placement. A 3-4-5 triangle via SSS with the right angle verified. Triangle-inequality violation rejected per D6. Angles summing to 180° or more in ASA/AAS rejected. SSA rejected with the message naming the circle-intersection alternative. Both angle modes exercised.

---

### Task 7: Grammar and scene wiring

**Files:** `graph-engine/src/parser/parseStatement.ts`, `types.ts`, `graph-engine/src/scene/buildScene.ts`, plus tests in the existing parser and scene test files.

**Produces:** the DSL surface for everything above, and the scene objects that render it.

Grammar to support, per the spec:
```
m = line through P parallel to A-B
n = line through P perpendicular to A-B
b = bisector of angle A-B-C
p = perpendicular bisector of A-B
M = midpoint A-B
D = foot C to A-B
X = intersect m, n
P, Q = intersect circle O, line B-C
triangle ABC: AB = 8, angle A = 90, AC = 6
incircle of ABC
circumcircle of ABC
```

Two things to get right:
- **Construction order independence.** The existing grammar collects function and point definitions in a pass before use, so a statement may reference a name defined later in the spec. Decide whether constructions follow that rule or require definition-before-use, and state which in the task report. Definition-before-use is defensible here — constructions form a dependency chain and a cycle must be detectable — but it must be a decision, and a cycle must produce a legible error rather than hanging.
- **Rendering.** An infinite `line` must be clipped to the view bounds at render time, not stored clipped, so it stays correct under pan and zoom.

**Required tests:** each grammar form parses; a full worked figure end-to-end (the spec's own example: a right triangle with the altitude drawn to the hypotenuse, which is unauthorable in v1); a reference to an undefined name errors legibly; a construction cycle errors rather than hanging; an infinite line renders clipped to bounds and re-clips when bounds change.

---

## Verification

1. All three checks clean: tests, `tsc -b --noEmit`, lint.
2. Every one of the 202 pre-existing tests still passes.
3. The spec's motivating example authors in a handful of lines and produces a correct figure:
   ```
   triangle ABC: angle A = 90, AB = 6, AC = 8
   D = foot A to B-C
   segment: A-D dashed
   ```
   with `AD` computing to 4.8.
4. The regular hexagon from the spec's "before" example is expressible without trigonometry by hand.

## Out of scope for this phase

Circle vocabulary (chord, arc, sector, tangent), figure mode (`@mode: figure`), label layout, shading and boolean regions, and all solid-figure work. Those are later phases of track 2 and each gets its own plan. Do not start them.
