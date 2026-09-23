# Handoff — Graph Engine v2, 2026-09-23

Written at a clean checkpoint for whoever picks this up next, including a
future me with none of this in context. It records the things that are **not**
recoverable from the code: why decisions went the way they did, what has
already been tried and failed, and which traps cost real time.

## Where things stand

**Branch `graph-engine-track-1`**, in the worktree
`.claude/worktrees/graph-track-1`. 55 commits ahead of `main`. Working tree
clean. **807 tests passing**, `tsc -b graph-engine/tsconfig.json --noEmit`
clean, `oxlint` clean.

Nothing is merged to `main`. Another agent works on `main` directly, which is
why this lives in a worktree — their commits were interleaving with mine and
breaking test runs mid-task.

### The two specs are the authority

- `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — graph engine.
  **Also owns the shared document format** (pages, bindings, overlays,
  container, classification) because it was specified there first.
- `docs/superpowers/specs/2026-09-22-document-engine-v2-design.md` — document
  engine (mode matrix, markdown editor, spreadsheet, code pages).

Plans live in `docs/superpowers/plans/`. Every plan argues from a spec; where
they disagree, **the spec wins**.

### Build order (revised 2026-09-22, in the graph spec)

1. **Milestone A — tracks 1–4** ← in flight
2. 2a — retention loop and identity backfill *(Osmosis app)*
3. Graph theme tokens; **exact/symbolic values**; decide sandbox ownership
4. D1–D3 *(document engine)*
5. Sandbox build *(Osmosis app)*
6. Shell docs, then shell + item presentation *(Osmosis app)*
7. Container / multi-page — the tie-in
8. Track 6, track 7, D4
9. Track 5 + D5 as one pass
10. Homework and the rest

Engine work **pauses after Milestone A** while the sandbox, shell and items get
built.

### Done

- **Track 1 — reading the graph.** Feature points derived from statement maths
  (roots by bisection, extrema as roots of f′ classified by f″, intersections
  as roots of f−g), typed and distinctly marked, hover snapping, `@labels` /
  `@label-every`, `@step-mode`, chained inequalities.
- **Track 2 — geometry, phases 1–4.** Construction core (lines/points/circles
  as intersectable objects, derived points, triangle solvers, centres with
  their circles); the SVG figure renderer; measures, notation, navigation and
  panels; circle vocabulary and the givens table.

### Not started

Tracks 3 (3D/multivariable) and 4 (calc-proofing) — the bulk of Milestone A.
All of D1–D5. Track 2 phases beyond 4 (shading/boolean regions, solids
vocabulary, 3D grammar, competition constructions).

---

## Lessons that cost real time

### 1. Five tests shipped passing for the wrong reason

This is the single most expensive recurring failure in the project. Instances:

- `1/x` pole test passed because a sample landed **exactly** on x=0, so the
  pole discriminator never ran.
- Dedupe test never reached the comparison with a non-empty accumulator.
- Feature-marker inequality test pinned nothing — two shapes could be swapped.
- Hover "outside the snap radius" test placed the point 333px away, so the
  outer cutoff rejected it before the snap logic was reached.
- **D3 intersection ordering**: deleting the sort left all 336 tests green.

**The rule, learned the hard way:** proving a test can fail means **deleting
the behaviour it covers**, not perturbing its inputs. The D3 case is the
clearest — the builder *did* mutation-test it, using `hits.reverse()`, which
catches an inverted comparator but not a missing sort.

Put this in every implementation dispatch. Phase 2's builder applied it and
caught three of its own; Phase 3's caught three more.

### 2. Node-only tests cannot see DOM or CSS bugs

Two bugs reached the user with a fully green suite:

- **React compares the `dangerouslySetInnerHTML` object, not the string**, so
  the `<svg>` was replaced every pan frame and labels grew with the zoom.
- **`.graph-viewer` was only a flex container when split**, so a single
  `.graph-viewer-panel` with `flex: 1 1 0` collapsed to zero height. Figures
  rendered invisibly; the canvas fell back to its attribute height and looked
  cut off.

vitest here is node-only (`include: ['src/**/*.test.ts']`, environment node).
If this area grows, it wants a jsdom layer or a standing "load it in a real
browser before calling it done" step.

### 3. The preview pane is pinned to the main checkout

`preview_start` / the Claude preview pane launch the dev server in
`C:/Users/benif/Osmosis`, **not** the worktree — so it serves main's code and
every "verify in the harness" step verifies nothing. Run instead:

```
npm run review -- --port 5181 --host 100.90.203.2
```

from the worktree. `100.90.203.2` is the machine's Tailscale IP; binding to it
specifically (not `0.0.0.0`) keeps it on the tailnet only. The user reviews
from another machine over Tailscale.

**Restart it after big changes.** Vite HMR does not survive a new React
component plus a new module directory; a stale server is what made the user
report the engine as broken.

### 4. Features nobody can find are features that do not exist

Three separate times, work shipped with no way to reach it from the review
harness, and the user reasonably concluded it was broken. Now guarded:
`graph-engine/src/examples.test.ts` asserts **every** example parses *and*
draws. It caught three of five new examples on its first run.

If you add engine capability, add an example in `graph-engine/src/examples.ts`.

### 5. The commit trailer is a fixed string

Every commit body ends with exactly:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

It is a repo convention, **not** a description of which model did the work. A
haiku implementer substituted its own name and had to amend; a reviewer later
flagged the *correct* trailer as wrong for the same reason. Say so explicitly
in dispatches, and do not let a reviewer's objection to it stand.

---

## Design decisions and why (expensive to rediscover)

**Geometry is constructive with closed-form solvers, never a numeric constraint
solver.** An AI tutor authors these specs. A general solver can return a
different-but-valid figure between runs and fails in ways nobody can act on.
Determinism and legible local failure — *"line B-C and circle O do not
intersect"* — matter more than expressive generality. This is a spec Non-goal;
do not add a solver.

**Determinism needs a fixed convention, not just deterministic code.**
Constraints fix a triangle's *shape* but neither its position nor orientation,
and a line×circle intersection has two solutions. Hence D5 (first vertex at
origin, second on +x, third in upper half-plane) and D3 (solutions sorted x
then y). Without those, "deterministic" is unachievable.

**Figures are a separate SVG renderer, not the plot renderer with axes off.**
The deciding argument is text: a figure is mostly labels, and in three.js those
are sprite atlases with hand-computed metrics. SVG text is native with real
metrics. A figure is tens of elements, so canvas's throughput advantage does
not apply. Also: crisp at print resolution, dashed strokes and arcs as
primitives, no WebGL context, and DOM nodes so track 7's tutor tools get
hit-testing free (emitted elements carry `data-statement` / `data-object`
identity for exactly that).

**Constructions are shared maths, consumed by *both* renderers.** "Geometry has
no graphing interface" constrains the figure renderer only — `M = midpoint A-B`
still works in graph mode beside `y = x^2`. This was nearly lost twice; it is
the commitment that keeps coordinate geometry working.

**Mode is inferred but should always be declared.** Inference is a safety net;
under it, adding one plotted function to a figure silently changes the whole
presentation. The house rule — state `@mode:` explicitly, *including
`@mode: graph`* — must land in the tutor-facing reference, not just the human
one.

**`@step-mode: geometric` doubles upward and floors at its base.** 8 → 16 → 32
→ 64, and zooming in never goes below 8. The floor is the *feature*: the mode
exists so an author can withhold coordinates, and a grid that returns to single
units hands back exactly what the question was hiding. I removed that floor
once during preflight to satisfy my own bad test — do not remove it again.

**Measure assertions and `@scale: false` are designed together.** `label: AB = 8`
fails if the side is not 8; `@scale: false` suppresses it. Without the
assertion the flag is meaningless; without the flag the assertion makes
deliberately-not-to-scale figures unauthorable.

**Exactness is structural, never inferred.** An exact value exists only when
whatever produced it knows it — a literal `sqrt(3)/2`, a π-scaled axis, a
closed-form solver. The engine must **not** inspect a float and guess `0.333…`
was `1/3`. That inference is cheap and tempting and asserts something false
whenever it is wrong. Form set is `(p/q)·√r·πᵉ`; sums are out of scope.

---

## Open items, roughly by value

1. **`server/src/domain/bootstrap.ts` still documents the v1 directive
   surface.** This is the highest-value item. It is the condensed reference the
   MCP tutor actually reads, so **the tutor cannot reach any of this work** —
   not `@labels`, `@step-mode`, `roots`/`extrema`, chained inequalities, nor
   any geometry construction, figure mode, measure or circle vocabulary. The
   declare-your-mode rule landed there; nothing else has.
2. **Migration sweep of stored geometry questions.** Mode inference changes how
   v1 `polygon:`/`circle:`/`angle:` specs render — bare figure instead of a
   plot with axes. Almost certainly better, but it is live content and the spec
   asks for a sweep. `@mode: graph` restores the old rendering.
3. **`r = bisector of angle A-B-C` silently parses as a polar curve.** The
   polar grammar claims any `r = <expr>`. Any construction bound to a name the
   plotting grammar reserves is silently misread — no error, wrong figure.
   Pre-existing; the grammar should disambiguate or reject.
4. **Scientific notation fails silently.** `y = 1e6 * x` lexes `1e6` as
   `1 * e6` with `e6` unbound, producing **no curve and no error**. Pre-existing,
   and it will bite quant work.
5. **The `Vector` example now infers figure mode**, so it draws with no axes —
   arguably wrong, since a vector's meaning is its coordinates. A
   classification question about whether `vector:` is plot or figure content.
6. **Exact/symbolic values** — specced, scheduled at build-order step 3. Until
   then measures print decimals; everything routes through one formatter so it
   becomes a one-place change.
7. **Phase 5: 3D grammar.** The projection pipeline exists and is tested
   (`figure/project3d.ts`, fixed axonometric camera, hidden-edge
   classification, rectangular prism). **There is no `solid:` statement** — it
   is unreachable from the DSL by design, Task 6 having been scoped to prove
   the path. The vocabulary (prisms, pyramids, cylinders, cones, spheres,
   tetrahedra), cross-sections and nets all follow.
8. Minor, recorded: intersections have no secondary sort key;
   `conic-vertex`/`local-max` and `focus`/`intersection` share marker shapes
   (latent — nothing emits the conic kinds); `x = f(y)` gets no feature points;
   tangencies are not detected by intersection finding (sign-change based), and
   **track 7's "show me where these cross" will inherit that silent miss**.

---

## Working practice that worked

- **Subagent-driven execution** with a plan per phase, one Opus agent owning a
  whole phase end to end, then an independent review agent. Cheaper and better
  than driving task-by-task once plans got good.
- **Write plans for the executor you have.** Track 1's plan contained literal
  code for cheap transcribers. The geometry plans specify *decisions,
  interfaces and required test cases* instead, because over-specified code
  constrains a capable executor into a worse implementation.
- **The ledger at `.superpowers/sdd/<plan>/progress.md` is gitignored** and
  does not survive. Anything that matters belongs in a spec, a plan, a commit
  message, or this file.
- **Verify headline claims personally.** Several reports were accurate but the
  two that were not (a "hollow ring marker" that was actually a hole punched in
  the curve; "byte-identical output" measured from a cleared WebGL buffer) were
  only caught by looking.
