# Geometry v2, Phase 9 — Solid Figures: Inscribed and Circumscribed Spheres, and Tangency

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** draw and measure the composite configurations competition 3D problems are built on:
- the insphere of a tetrahedron (AIME 2024 I: r = 20√21/63);
- the sphere in a cone, a cylinder or a frustum;
- the circumsphere of a box, a pyramid or any solid whose vertices lie on one sphere;
- spheres placed by tangency to a plane or to another sphere.

All are drawn under the glass rule the spec already fixed.

**Architecture:**
- **Every inscribed or circumscribed sphere is an ordinary sphere solid** (phase 7's placed sphere). This phase adds the *constructions* that produce its centre and radius, closed-form per primitive or by a fixed-order linear solve for polyhedra, **verified** against every face or vertex before anything is drawn.
- **No new drawing machinery.** The glass rule, segment occlusion and sections already treat a sphere like any other solid.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 2 "Solids", "Revised 2026-09-25":
- "Composites: the glass rule replaces the four arrangements";
- build step 9 ("inscribed and circumscribed solids under the glass rule — insphere, circumsphere, spheres in cones and cylinders, tangency");
- "Every construction needed is closed-form … a circumsphere as a 3×3 linear solve; an insphere as the face-area weighted mean of the vertices".

Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, **especially "Worktrees, milestones and parallel agents"**, lesson 1, and the phase 5–8 sections.

**Where you work:** branch `milestone-a/geometry`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`. Other agents work in parallel in their own worktrees (e.g. `milestone-a/space`); follow the handoff's rules for that.

**Prior work to consume:**
- `figure/solids.ts`: `SolidBody`, the placement (P1), `solidDimensions`, `drawnDimensionSegment`.
- `figure/solidScope.ts`: the by-points sphere (`solid sphere center M radius r`), names in space, how a named solid is resolved.
- `figure/hull.ts`: face planes and outward normals.
- `figure/construct3d.ts`: `Plane3`, `pointPlaneDistance`, and the Vec3 toolkit.
- `figure/plane.ts` (phase 8): plane operands and named planes.
- `figure/occlusion.ts`: the glass rule, unchanged.

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical:** every pre-existing spec renders byte-for-byte as before under every view. No existing test is weakened or deleted.
- **No numeric solver, no sampling-as-answer.** Centres and radii are closed-form per primitive, or a **fixed-order** 4×4 / 3×3 linear solve (Cramer or Gaussian elimination with a stated pivot order), which is exact arithmetic, not iteration. Every result is **verified** against all faces or vertices within a tolerance scaled from `GEOM_EPS`.
- **Reuse `GEOM_EPS`** and the one Vec3 toolkit. **Author frame is z-up**; conversion stays in `authorFrame.ts`. **Placement never depends on the active view.**
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and in the author's names. A configuration that does not exist is refused, never approximated: "T has no inscribed sphere — no point is equidistant from all six of its faces".
- **Every emitted element carries `data-statement` / `data-object`.** Every new capability has an example.
- **Proving a test can fail means deleting the behaviour it covers.** Record which deletion proved which test in each commit body. Hand-compute every expected value independently of the code.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, with explicit `git add <paths>` (never `-A` or `.`). The body ends EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, a fixed repo convention.
- **Vocabulary:** say "solid figure" or "space", never "3D engine" alone.

## Load-bearing decisions

**R1: an inscribed or circumscribed sphere is a sphere solid.**
- `I = solid insphere of T` and `O = solid circumsphere of T` bind a sphere body placed by its centre, exactly as `solid sphere center M radius r` would be. It draws, occludes and sections like one, and it is glass to T.
- Its centre is reachable as a point: `P = center of I` works for **any** sphere solid (and only spheres in this phase).

**R2: a sphere's radius is always a named dimension.**
- `label: S radius` works for every sphere, including by-points spheres (phase 7 refused it), insphere and circumsphere results. The reference line is phase 7's radius segment with its side-view fallback.
- This enables a label that used to be refused. It changes no existing bytes.

**R3: polyhedra, by a fixed-order linear solve and full verification.**
- **Circumsphere:** take the first four vertices in vertex order that are not coplanar (a stated scan order), solve the 3×3 system `2(Pᵢ − P₀)·c = |Pᵢ|² − |P₀|²` for the centre, then require **every** vertex to lie on the sphere. Otherwise refuse, naming the first vertex off it.
- **Insphere:**
  - Faces `nᵢ·x = dᵢ`, outward unit normals. Take the first four faces in face order whose normals give a non-singular system `dᵢ − nᵢ·c = r`, and solve it for (c, r).
  - Require r > 0, c strictly inside, and **every** face at distance r. Otherwise refuse, naming the first face that fails.
  - For a tetrahedron this equals the face-area weighted mean of the vertices. **Test that identity**; it is the spec's stated formula.
- **Four points:** `solid circumsphere A-B-C-D` is the circumsphere of four named space points. Coplanar points are refused.

**R4: round solids, closed-form per primitive, in the local frame** (so placed and tilted solids work through P1). In local coordinates the axis is y, the base is at −h/2 and the top at +h/2.

| Solid | Insphere | Circumsphere |
|---|---|---|
| Cylinder | exists iff h = 2r (within tolerance); radius r at the centre. Otherwise refused: "a sphere touches both ends and the side of C only when its height is twice its radius". | always; centre at the middle, radius √(r² + (h/2)²) |
| Cone | always: ρ = R·H / (R + √(R² + H²)), centre on the axis ρ above the base | always: through the apex and the base rim; centre on the axis at distance x = (H² − R²)/(2H) above the base, radius H − x |
| Frustum (bottom r₁, top r₂) | exists iff h = 2√(r₁ r₂); radius h/2 at mid-height. Otherwise refused with the condition. | always: centre on the axis at y = (h² + r₂² − r₁²)/(2h) above the base, radius √(y² + r₁²) |
| Sphere | refused ("S is already a sphere") | refused |

**R5: spheres by tangency.** The centre is given and the radius follows.
```
S = solid sphere center P tangent to plane A-B-C      # radius = distance from P to the plane
S = solid sphere center P externally tangent to T     # T a sphere: radius = |PT| − r_T
S = solid sphere center P internally tangent to T     # radius = r_T − |PT|  (P inside T)
```
- The plane operand is any phase 8 plane form, named planes included.
- A non-positive radius is refused, naming why: P lies on the plane; P is inside T for external tangency; P is outside T for internal tangency.

**R6: grammar summary.**
```
I = solid insphere of T
O = solid circumsphere of T
O = solid circumsphere A-B-C-D
S = solid sphere center P tangent to plane p
S = solid sphere center P externally tangent to T
S = solid sphere center P internally tangent to T
M = center of S
label: I radius
```
- `insphere` / `circumsphere` of something that is not a solid, or of an unknown name, is refused, naming it.
- `center of` a non-sphere is refused, saying that only spheres have a named centre in this phase.

**R7: out of scope.**
- Spheres tangent to several objects at once (e.g. three spheres and a plane). That is a solver; the author places them by computed centres and R5 checks the tangency.
- Contact circles drawn on a cone or cylinder.
- Inscribed cubes and other inscribed polyhedra.
- Tangency *assertions* in the givens table.
- Opaque coaxial stacking.

Refuse legibly where an author could ask for any of these.

---

### Task 1: Sphere radius, `center of`, and spheres by tangency

**Files:** the parser (R5 forms, `center of`), `figure/solidScope.ts`, `figure/solids.ts` (R2), and tests.

- [ ] **Step 1: failing tests:**
  - **R2:** `S = solid sphere center M radius 5` then `label: S radius = 5` passes. The drawn reference line has true length 5 (reuse phase 7's assertion style).
  - **`center of`:** `P = center of S` equals M. `center of C` on a cylinder is refused.
  - **Tangent to a plane:** the centre at (0, 0, 7) and `plane z = 2` give radius 5. Also test a tilted plane, `plane x + y + z = 3` with centre (3, 3, 3): radius 6/√3 = 2√3.
  - **External tangency:** T centred at the origin with radius 2, and P = (6, 8, 0): radius 8.
  - **Internal tangency:** T of radius 10 at the origin, and P = (3, 4, 0): radius 5.
  - **Refusals:** P on the plane; external tangency with P inside T; internal tangency with P outside T. Each message names the reason.
  - **Byte identity:** every pre-existing spec is unchanged, confirmed by the before/after sweep.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Swap external and internal: those tests must go red.
  - Delete R2's by-points sphere radius: the label test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): a sphere's radius and centre, and spheres placed by tangency`.

### Task 2: Circumspheres

**Files:** create `figure/spheres.ts` (insphere and circumsphere construction, used by both Task 2 and Task 3) and `figure/spheres.test.ts`. Modify the parser and `figure/solidScope.ts`.

- [ ] **Step 1: failing tests.** Hand-compute every expected value.
  - **Box:** the 8×5×6 box has R = √125/2 and centre at its centre.
  - **Cube:** edge 2 has R = √3.
  - **Regular tetrahedron:** edge a = 6 has R = a√6/4 = 3√6/2.
  - **Regular octahedron:** edge 6 has R = 6/√2 = 3√2.
  - **Right square pyramid, all edges 4** (the AIME pyramid): R = 2√2, centred at the base centre, because the apex height is also 2√2. Verify it by hand.
  - **Four points:** `solid circumsphere A-B-C-D` on (0,0,0), (2,0,0), (0,2,0), (0,0,2) has centre (1,1,1) and R = √3.
  - **Refusals:**
    - A hull that is **not** cyclic: a unit cube with one vertex moved outward along its diagonal. The message names the first vertex off the sphere.
    - Four coplanar points.
  - **Cylinder:** r = 3, h = 6 gives R = 3√2.
  - **Cone:** R = 3, H = 4 gives circumradius 25/8, centred 7/8 above the base.
  - **Frustum:** r₁ = 4, r₂ = 1, h = 4 gives y = 1/8 and R = √1025/8.
  - **Tilted:** a cylinder from A to B (the placed form) has its circumsphere centred at the midpoint of AB.
- [ ] **Step 2: implement per R3 and R4.**
- [ ] **Step 3: prove it.**
  - Delete the all-vertices verification: the non-cyclic refusal must go red. It must fail by drawing a wrong sphere, not by passing.
  - Swap the cone formula's sign: the cone test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): circumscribed spheres, verified against every vertex`.

### Task 3: Inspheres

**Files:** `figure/spheres.ts`, the parser, `figure/solidScope.ts`, and tests.

- [ ] **Step 1: failing tests.** Hand-compute every expected value.
  - **AIME 2024 I:** the tetrahedron `ABCD with AB = CD = √41, AC = BD = √80, AD = BC = √89` has insphere radius **20√21/63**.
    - Check: V = 160/3, each face has area 6√21, so r = 3V/(4·6√21).
    - `label: I radius` prints it formatted, and `P = center of I` lies inside T.
  - **Face-area-weighted identity:** on the AIME tetrahedron and on a non-regular one, the solved centre equals Σ(Aᵢ·Vᵢ)/ΣAᵢ, where Aᵢ is the area of the face **opposite** vertex Vᵢ, within `GEOM_EPS`.
  - **Regular solids:**
    - Regular tetrahedron, edge 6: r = 6/(2√6) = √6/2.
    - Cube, edge 2: r = 1.
    - Octahedron, edge 6: r = 6/√6 = √6.
    - The AIME pyramid (all edges 4): r = 3V / total area. Hand-compute both V and the area.
  - **Refusals:** the 8×5×6 box has no insphere, and the message names a face. A non-tangential hull is also refused.
  - **Cone:** R = 3, H = 4 gives ρ = 12/8 = 1.5, centred 1.5 above the base.
  - **Cylinder:** r = 3, h = 6 gives r = 3. The same cylinder with h = 8 is refused, with the h = 2r message.
  - **Frustum:** r₁ = 4, r₂ = 1, h = 4 gives radius 2. With h = 5 it is refused, with the h = 2√(r₁ r₂) message.
  - **Glass:** the AIME tetrahedron with its insphere. The tetrahedron's own edges are byte-identical to drawing it alone. A segment from a vertex to the insphere's centre is dashed where the tetrahedron hides it (glass: solids do not occlude each other; construction lines are occluded by solids).
- [ ] **Step 2: implement per R3 and R4.**
- [ ] **Step 3: prove it.**
  - Delete the every-face verification: the box refusal must go red.
  - Replace the linear solve with the vertex centroid: the AIME and identity tests must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): inscribed spheres, verified against every face`.

### Task 4: Examples, reference and handoff

**Examples:**
1. **"AIME tetrahedron and its insphere":** the √41/√80/√89 tetrahedron with its insphere, `label: I radius`, and the centre named.
2. **"Cube between two spheres":** a cube with both its insphere and its circumsphere, radii labelled.
3. **"Sphere in a cone":** R = 3, H = 4, with the insphere, its radius labelled, and the cone's height labelled.
4. **"Frustum with an insphere":** r₁ = 4, r₂ = 1, h = 4.
5. **"Spheres by tangency":** a sphere on a plane, a second sphere externally tangent to it, and a segment between the two centres labelled with its true length, which should equal the sum of the radii.

**Reference:** the grammar header documents R1–R6, including every refusal condition and the R4 formulas' conditions.

**Handoff:**
- Add a phase 9 row.
- Note that build step 9's "tangency" is scoped to R5, with the solver cases in R7 left out on purpose.
- Update the open items.

- [ ] **Step 1:** add the examples and run `examples.test.ts`. Render each to a scratch SVG and PNG, using `vite-node` plus headless Edge, and inspect it. Do not start a review server, and do not use browser page scripts.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 9 inscribed and circumscribed spheres — examples, reference, handoff`.

## Verification

1. All three checks clean, and every pre-existing spec is byte-identical under every view.
2. The AIME tetrahedron's insphere radius is 20√21/63, and its centre matches the face-area-weighted mean.
3. Every refusal names why the configuration does not exist.
4. Inspheres and circumspheres of placed and tilted round solids sit where the hand values say.
5. Every new example is drawn and inspected.

## Out of scope

Everything in R7, angle and dihedral marks (build step 10), nets (step 11), exact values, and the tutor reference.
