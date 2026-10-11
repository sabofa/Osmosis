# Geometry v2, Phase 5 — Solids: Grammar, Curved Primitives, Cross-sections

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make solids reachable from the DSL and draw the ones a test figure actually asks for. The projection pipeline exists and is tested; there is no `solid:` statement, and the only primitive is a rectangular prism.

**Architecture:** the 3D layer is a **producer feeding the existing SVG figure renderer**, not a second renderer. It emits either a projected drawing (hidden edges dashed) or a true-shape 2D figure (a cross-section, a net) handed back to the ordinary 2D figure path.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md` — "Track 2 — Geometry v2", the "Solids" section and especially its 2026-09-23 sub-sections ("How solids are actually represented", "Cross-sections and nets produce 2D geometry"). Read them before Task 1.

**Prior work:** `graph-engine/src/figure/project3d.ts` — `Solid3D` (`{vertices, faces}`), the fixed isometric camera, `projectSolid`, and `rectangularPrism`. Consume it; Task 3 widens it.

## Global Constraints

- **No new runtime dependencies.**
- **All 807 existing tests keep passing**, none weakened or deleted.
- **Determinism.** Byte-identical SVG for the same input at the same view state. `projectSolid` already depends on this (edges emitted in first-seen order over the face list); do not regress it.
- **Reuse `GEOM_EPS`.** No second tolerance.
- **No free camera.** These are drawings. Named viewpoints only.
- Test command: `npm run test --workspace=graph-engine`, plus `npx tsc -b graph-engine/tsconfig.json --noEmit` and `npm run lint --workspace=graph-engine`. All three clean per task.
- Commit per task, lowercase `type(scope): summary`, body ending EXACTLY with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  A fixed repo convention, not a description of which model did the work.

## Load-bearing decisions

**H1 — Every primitive states its placement.** Constraints fix a solid's shape, not where it sits. `rectangularPrism` is already centred on the origin; extend that convention (or state a different one) to every primitive, and document it. Without this, "deterministic" fails exactly as it would have for triangles.

**H2 — Two representations, one interface.** Polyhedra keep `{vertices, faces}`. Curved primitives carry parameters and emit an **analytic silhouette**. Both satisfy one outline contract. Do **not** facet curved solids into fine polyhedra: silhouettes go visibly polygonal under the figure view's zoom, faceting generates spurious edges to suppress, and it discards the crispness that chose SVG.

**H3 — The drawn-edge type carries arcs.** `ProjectedEdge` is `{a, b}` — segments only. A cylinder outline is two lines and two elliptical arcs. Widen it, and make arcs emit as SVG path arcs, never sampled polylines.

**H4 — Hidden-line removal is convex-only, and says so.** The existing rule (hidden when every adjacent face turns away) is correct for convex polyhedra and wrong otherwise. A non-convex solid must **fail with a legible message**, not draw something plausible and wrong. Composite arrangements are out of scope for this phase.

**H5 — Cross-sections hand back 2D geometry.** A section is a plane figure. It returns to the ordinary 2D figure path, where measures, notation and label layout already work — rather than growing a parallel pipeline inside the 3D layer.

---

### Task 1: Solid grammar for polyhedra

Extend `parseStatement.ts`, `types.ts`, and the figure render path plus tests.

Grammar, following the existing statement style:
```
solid: prism 8 by 5 by 6
solid: pyramid square base 6, height 9
solid: tetrahedron edge 5
S = solid prism 8 by 5 by 6      # named, referenceable later
```
Plus a named-viewpoint directive (`@view:`), with `isometric` the default and the value set stated.

Placement per **H1**. Vertex labelling for solids whose vertices a problem names (tetrahedra especially).

**Tests:** each form parses; an unknown primitive fails naming the ones that exist; the viewpoint directive parses and rejects unknown values; a prism's projected vertex positions match hand-computed values under the default camera; **deterministic output across two renders**.

---

### Task 2: Dimension labels with leaders

Extend the measure and notation work from Phase 3 plus tests.

```
label: S height = 5
label: S width
```
A dimension label attaches to an edge of the projected solid and needs a **leader line** when it cannot sit on the edge itself. It participates in the existing label-collision layout rather than bypassing it.

**Tests:** a dimension label attaches to the right projected edge; the leader is drawn when the label is displaced and omitted when it is not; labels on a solid do not collide with each other or with the drawing; the asserting form (`= 5` failing when the solid is not 5) behaves as it does in 2D.

---

### Task 3: Arcs in the projected edge type

Modify `figure/project3d.ts` and the figure emitter plus tests.

Per **H3**: widen the drawn-edge type so an outline can carry elliptical arcs alongside segments, and emit arcs as SVG path arcs. Existing polyhedron output must be unchanged — this is a widening, not a rewrite.

**Tests:** a segment edge emits exactly as before (assert the existing prism output is byte-identical to its pre-change form); an arc edge emits a path arc, not a polyline; hidden arcs dash like hidden segments.

---

### Task 4: Curved primitives

Add cylinder, cone and sphere plus tests.

Per **H2**, each emits an analytic silhouette under the camera: a cylinder as two lines plus a front and a back elliptical arc (back dashed); a cone as two lines plus an ellipse; a sphere as a circle. State the placement convention for each (**H1**).

**Tests:** each silhouette against hand-computed geometry — the cylinder's tangent lines genuinely tangent to its end ellipses, the cone's lines genuinely through the apex and tangent to its base, the sphere's outline the correct radius. The back arc of a cylinder is dashed and the front is not. **Prove the dashing test can fail by deleting the visibility assignment**, not by flipping it.

---

### Task 5: Cross-sections

Add plane ∩ solid plus tests.

```
cut: S by plane z = 3        # shaded on the solid, in place
section: S by plane z = 3    # lifted out as a true-shape 2D figure
```
Per **H5**, `section:` returns ordinary 2D geometry to the existing figure path. Supported planes: axis-perpendicular at minimum; state whether oblique planes are included or deferred.

For curved primitives, the section is solved analytically — a plane through a cylinder gives a circle, an ellipse or a rectangle depending on orientation; through a cone, the conic sections.

**Tests:** section of a prism by an axis-perpendicular plane is the expected polygon, with hand-computed vertices; section of a cylinder perpendicular to its axis is a circle of the right radius; a plane missing the solid entirely fails legibly; a lifted section carries measures and labels through the normal 2D path (this is the **H5** integration test and the one most worth writing carefully).

---

### Task 6: Examples and the non-convex guard

Extend `graph-engine/src/examples.ts`; add the **H4** guard.

Examples: a labelled prism, a tetrahedron with named vertices, a cylinder with dimensions, and a cross-section shown both ways. `examples.test.ts` already asserts every example parses and draws — it will cover these automatically.

The guard: a non-convex polyhedron must fail with a message saying hidden-line removal is only solved for convex solids, rather than drawing a wrong figure.

**Tests:** the guard fires on a genuinely non-convex solid and does **not** fire on any convex one, including the primitives added here.

---

## Verification

1. All three checks clean; all 807 pre-existing tests still passing.
2. A prism, a pyramid, a tetrahedron, a cylinder, a cone and a sphere all render with correct hidden-edge treatment.
3. Cylinder outlines use path arcs, not polylines.
4. A cross-section renders both shaded in place and lifted as a true-shape figure, and the lifted one carries a measure label.
5. A non-convex solid fails legibly.
6. Byte-identical output at a fixed view state.

## Out of scope

Composite solids (the four constrained arrangements), nets, oblique cross-sections if deferred in Task 5, free camera or orbit, non-convex hidden-line removal, exact/symbolic values, and every competition-specific 2D construction. Build none of them.
