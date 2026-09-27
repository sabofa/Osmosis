# Geometry v2, Phase 11 — Solid Figures: Nets and Shortest Paths over a Surface

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** unfold solids flat with the fold lines dashed, and find, draw and measure the shortest path over a solid's surface. Examples:
- the cube's cross net;
- a prism's strip;
- a pyramid's star;
- a cone's sector;
- the fly crawling over a cone (AIME: 625);
- Dudeney's spider and fly in a 30×12×12 room (40);
- the corner-to-corner path over a cube (√5).

**Architecture:**
- **A net is 2D geometry**, like a lifted section (H5): it is built by per-primitive templates (the spec's own design) and handed to the ordinary 2D figure path, beside the solid.
- **Polyhedra:** a shortest path comes from an exact, finite enumeration of face sequences, each unfolded into one plane and checked. The path is drawn on the solid as segments across faces, and optionally beside it on the unfolded strip of faces it crosses.
- **Round solids:** the path lies on the lateral surface and is closed-form in the unrolled surface, so it is drawn on the unrolling.

**Tech Stack:** TypeScript, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`:
- Track 2 "Solids": the capability table row "Nets — parameterized templates per primitive with fold lines dashed";
- "Cross-sections and nets produce 2D geometry";
- "Revised 2026-09-25" build step 11: "Nets — per-primitive unfolding with fold lines dashed, and the shortest-path-over-the-surface problems they exist for";
- the Non-goal "general polyhedron unfolding".

Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first: "Worktrees, milestones and parallel agents", lesson 1, and the phase 5–10 sections.

**Where you work:** branch `milestone-a/geometry`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`. Other agents work in parallel in their own worktrees; follow the handoff's rules. **Every new example needs a `group`.** Add `'Nets and paths'` to `EXAMPLE_GROUPS` after `'Measures in space'`.

**Prior work to consume:**
- `figure/solids.ts`: `SolidBody`, `labelOrder`, and the placement; each primitive's builder (`regular.ts`, `tetrahedron.ts`, `hull.ts`, and the prism/pyramid on points in `solidScope.ts`).
- `figure/crossSection.ts`: the H5 lift, meaning `liftOffset` and how a lifted section becomes 2D items.
- `figure/occlusion.ts` (`segmentSpans`), `figure/construct3d.ts`, `figure/authorFrame.ts`.
- `render.ts`: the Q5 `region` item (segments and elliptical arcs), whose circular-arc special case serves sectors.
- Phase 8's `net:` refusal in `parseStatement.ts` (`/^net(:|\s+[a-zA-Z][^=<>]*$)/`). This phase replaces it with the real statement. `net = 5` and other constants must still parse exactly as before.

## Global Constraints

- **No new runtime dependencies.**
- **Existing output is byte-identical:** every pre-existing spec renders byte-for-byte as before under every view. The only sanctioned change is to phase 8's `net:` refusal tests, rewritten to pin the new statement, and each rewrite says so.
- **No numeric solver, no sampling-as-answer.** Nets are templates. Shortest paths are an exact enumeration with closed-form unfolding and closed-form validity checks. Round-solid geodesics are closed-form in the unrolled surface.
- **Reuse `GEOM_EPS`,** the one Vec3 toolkit, and the number formatter. **Author frame is z-up.** **Placement never depends on the active view,** and net layout is fixed against the solid, never the camera.
- **Errors are returned, not thrown, past `renderFigure`.** They are legible and in the author's names. Anything outside the templates is refused, never approximated.
- **Every emitted element carries `data-statement` / `data-object`.** Every new capability has an example, with a `group`.
- **Proving a test can fail means deleting the behaviour it covers.** Record which deletion proved which test in each commit body. Hand-compute every expected value independently.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, with explicit `git add <paths>` (never `-A` or `.`). The body ends EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Visual checks:** no review server and no browser pane or page scripts. Use `vite-node` to write SVG, then headless Edge to PNG. The reliable route is PowerShell `Start-Process -Wait -NoNewWindow` with a fresh `--user-data-dir` per shot. Put output in `.superpowers/sdd/<plan>/scratch/`.

## Load-bearing decisions

**N1: nets are per-primitive templates, true size, lifted beside the solid.**
- `net: S` unfolds solid S into 2D at the solid's own scale and lifts it beside the drawing, exactly like `section:`.
- **Several lifted figures stack left to right in statement order**, each clear of the one before. This covers sections, nets and path unfoldings. Extend `liftOffset` to take the running right edge. **An existing single-lift output must stay byte-identical.**
- **Line styles:** fold lines are dashed. Cut edges (the net's boundary) are solid.
- **Letters:** each copy of a solid's vertex carries that vertex's letter; textbook nets repeat letters. These copies are **display labels only, not named points**, because the same letter appears several times. Say so in the grammar header.
- **Orientation:** the root face goes at the bottom, with its first edge horizontal and the face above it.

**N2: the templates.**

| Solid | Template |
|---|---|
| Prism (box, `cube`, `prism regular n`, prism on points) | The lateral faces in one strip, left to right in base order, starting with face AB. The bottom and top caps attach to lateral face number ⌈n/2⌉ − 1 (0-based), below and above it. For a box this is the cross. |
| Pyramid (square, regular, rectangle, on points) | The base as root, with each lateral triangle unfolded outward about its base edge: the star. |
| Tetrahedron (regular, six-edge, on points) | The face ABC as root and the star about it. |
| Octahedron | The zig-zag strip of eight triangles around the equator, alternating upper and lower faces. |
| Pyramidal frustum | The bottom base as root with the lateral trapezoids unfolded about its edges, and the top attached to trapezoid ⌈n/2⌉ − 1's top edge. |
| Cylinder | A rectangle 2πr wide and h tall, with circles of radius r tangent at the midpoints of its top and bottom edges. |
| Cone | A sector of radius l (the slant) and angle 2πr/l, symmetric about the vertical and opening downward, with the base circle tangent at the arc's midpoint. |
| Conical frustum | An annular sector (radii from the apex of the extended cone), with both rim circles tangent at the arc midpoints. |
| Sphere, `solid hull` | **Refused.** "A sphere has no net"; "nets are drawn for prisms, pyramids, tetrahedra, octahedra, frusta, cylinders and cones". The second one is the spec's non-goal of general unfolding. |

- **Round-solid seams** run along the generator **directly away from the default camera**, so the part of the surface facing the viewer lands in the middle of the net.
- **Overlap check:** every polyhedral template is checked, exactly, for self-overlap. That is a segment-intersection test between non-adjacent net edges, plus containment. Any overlap is refused: "this tetrahedron's star net overlaps itself". An obtuse six-edge tetrahedron can do this.

**N3: shortest paths over polyhedra, by exact enumeration.**
`shortest: P to Q over S` draws the shortest path over the surface of S between two named space points **on** its surface. A point not on the surface is refused, naming it.
- **Candidate faces.** A point on an edge or vertex is on every face that contains it; each is a start or end candidate.
- **Enumeration.** Enumerate **simple** face sequences (no face repeated) from a start face to an end face, depth-first in face order. This is complete for convex polyhedra, because a shortest path meets each face in at most one segment.
- **Unfolding.** For each sequence, unfold every face into the start face's plane by rotating about the shared edge (closed form). P' and Q' are then the unfolded endpoints.
- **Validity.** The straight segment P'Q' must cross each shared edge, **in order**, within that edge's extent. The test is closed-form segment–segment intersection.
- **Result.** The minimum-length valid candidate wins; ties go to the first found. On one face the path is just PQ.
- **Size cap.** Solids with more than **12 faces** are refused for shortest paths ("… at most 12 faces"), to keep the enumeration small. This covers the box, cube, prisms up to decagonal, pyramids up to 11 sides, tetrahedra, the octahedron, and frusta up to decagonal.
- **Drawing.**
  - The path is drawn **on the solid** as the polyline of its per-face segments. The crossing points are unfolded back into 3D. Visibility per segment uses `segmentSpans`, exactly.
  - `shortest: P to Q over S unfold` also lifts the **strip of faces the path crosses**, unfolded, with the path as one straight segment. It is laid out by N1's lift rules, with fold lines dashed.

**N4: shortest paths over round solids, on the lateral surface.**
Both points must be on the **lateral** surface; otherwise the path is refused ("… on the curved side only"). Everything is closed-form in the unrolled surface:
- **Cylinder:** unroll with arc position s and height y. The length is `min over k ∈ {−1, 0, 1} of hypot(Δs + k·2πr, Δy)`.
- **Cone:** unroll to polar form (ρ = distance from the apex along the surface, φ = θ·r/l). The angular separation is α = the wrapped |Δφ|, taken modulo the sector angle and the shorter way round.
  - If α < π, the length is √(ρ_P² + ρ_Q² − 2ρ_Pρ_Q cos α).
  - Otherwise the path goes through the apex: ρ_P + ρ_Q.
- **Conical frustum:** as for the cone, but the straight segment must stay outside the inner radius (the top rim). If it would cross it, refuse: "the shortest path would run along the top rim — not drawn".
- **Drawing:** a geodesic on a curved surface is not a conic in projection. So it is drawn **on the unrolling only**, which is always lifted (`unfold` is implied), with P and Q marked on the solid. Say so in the grammar header.

**N5: measures and grammar.**
```
net: S
shortest: P to Q over S          # drawn on the solid (polyhedra) and / or its unrolling (round solids)
shortest: P to Q over S unfold   # polyhedra: also lift the strip of faces crossed
label: shortest P to Q over S    # prints the length on the path; asserting "= value" form
given: shortest P to Q over S    # and find:
```
- `net:` and `shortest:` are geometry's reserved keywords (spec, "Keyword ownership").
- `net = 5`, `net(x) = x^2`, `shortest = 3` and the like must parse exactly as at base. Add them to the byte sweep.

**N6: out of scope.** General polyhedron unfolding (hulls), nets of spheres, geodesics over the caps of round solids, paths over solids with more than 12 faces, drawing geodesics on a curved surface in 3D, and areas. Refuse legibly.

---

### Task 1: Nets of polyhedra

**Files:** create `figure/nets.ts` and `figure/nets.test.ts`. Modify the parser (the `net:` statement, replacing phase 8's refusal), `figure/crossSection.ts` or `render.ts` (N1's multi-lift stacking), `render.ts` (net items through the 2D path, with fold and cut styles), and tests.

- [ ] **Step 1: failing tests:**
  - **Cube `edge 2`:** the net is the **cross**, 6 squares of side 2. There are **5 fold lines** (dashed) and **14 cut edges** (solid), and the boundary is 14 edges long, a total of 28. Vertex letters: 14 positions for the 8 letters, with A appearing three times. Hand-derive and assert.
  - **Box 8×5×6:** each face is at true size, so the strip's width is 2(8+6) = 28 and the caps attach to lateral face 1 (0-based).
  - **Square pyramid (all edges 4):** the base square plus four equilateral triangles of side 4, with 4 fold lines.
  - **Regular tetrahedron edge 6:** a star forming one large equilateral triangle of side 12, with 3 fold lines.
  - **Octahedron edge 6:** 8 triangles and 7 fold lines, non-overlapping.
  - **Refusals:**
    - A six-edge tetrahedron whose star overlaps. Construct an obtuse one and verify by hand that its star overlaps.
    - `net: H` on a hull, and on a sphere.
  - **Stacking:** a spec with `section:` then `net:` lifts both, the net to the right of the section, not overlapping. A spec with one `section:` is **byte-identical** to before.
  - **Constants still parse:** `net = 5`, `net(x) = x^2` and `net + x = y` behave exactly as at base.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Swap the fold and cut styles: the dashed-count test must go red.
  - Delete the overlap check: the refusal test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): nets of prisms, pyramids, tetrahedra, octahedra and frusta`.

### Task 2: Nets of round solids

**Files:** `figure/nets.ts` and tests.

- [ ] **Step 1: failing tests:**
  - **Cylinder r = 3, h = 10:** a rectangle 6π × 10 (18.850 × 10), with circles of radius 3 tangent at the midpoints of the top and bottom edges. The two rim fold lines are dashed.
  - **Cone R = 3, H = 4 (slant 5):** a sector of radius 5 and angle 2π·3/5 = 6π/5 (216°), drawn as an SVG circular arc plus two radii, with the base circle of radius 3 tangent at the arc's midpoint.
  - **Frustum r₁ = 4, r₂ = 1, h = 4:** the slant is 5 and the extended cone has slant 5·4/3 = 20/3. So the annular sector has radii 20/3 and 5/3, and angle 2π·4/(20/3) = 6π/5.
  - **Seam:** the net's centre column corresponds to the generator facing the default camera. Assert the generator through the net's midline maps to the solid point with the largest default-camera depth toward the viewer.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.**
  - Set the sector angle to 2πr/h instead of 2πr/l: the cone test must go red.
  - Put the seam at the front: the seam test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): nets of cylinders, cones and conical frusta`.

### Task 3: Shortest paths over polyhedra

**Files:** create `figure/shortestPath.ts` and `figure/shortestPath.test.ts`. Modify the parser (`shortest:`, the label/given/find subject), `render.ts` (path on the solid; the `unfold` strip through N1's lift), and tests.

- [ ] **Step 1: failing tests:**
  - **Cube edge 1:** from A (0,0,0) to G (1,1,1), the shortest path over the surface is **√5**. Two faces are crossed, and the crossing point is at the middle of an edge.
    - Assert the length.
    - Assert that both drawn segments lie on faces of the cube.
    - Assert that the path is not the space diagonal √3.
  - **Dudeney's spider and fly:** a box 30 long (Y), 12 wide (X) and 12 high (Z). The spider is on one end wall, on its centre line, 1 below the ceiling; the fly is on the opposite end wall, on its centre line, 1 above the floor. The shortest path is **40** and crosses **5 faces**. The naïve path over the ceiling and down is 1 + 30 + 11 = 42 and must lose. Place the box by points so the walls are unambiguous.
  - **Same face:** two points on one face give the straight distance.
  - **Refusals:**
    - A point not on the surface, naming it.
    - A solid with 14 faces: `prism regular 12` has 12 + 2 = 14 faces.
  - **`unfold`:** the lifted strip for the cube path has 2 faces, 1 fold line and one straight segment of length √5. Its placement follows N1's stacking.
  - **Visibility:** each drawn segment is classified by `segmentSpans`; the one on a hidden face is dashed.
- [ ] **Step 2: implement per N3.**
- [ ] **Step 3: prove it.**
  - Limit the enumeration to sequences of at most 3 faces: the Dudeney test must go red, finding 42 instead of 40.
  - Drop the in-order edge-crossing validity check: a test built so that an invalid shorter candidate exists must go red. Build that test.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): shortest paths over polyhedra, by exact enumeration of face sequences`.

### Task 4: Shortest paths over round solids

**Files:** `figure/shortestPath.ts`, `render.ts`, and tests.

- [ ] **Step 1: failing tests:**
  - **AIME fly on a cone.** Use a cone with apex V, base centre O and radius 600, height 200√7, so the slant is 800.
    - The fly starts at P on a generator, 125 from V. It ends at Q on the exactly opposite generator, 375√2 from V.
    - Build P and Q with `divide` along two opposite generators (V to rim points R and R').
    - The shortest path is **625**: the sector is 3π/2, the separation is 3π/4 < π, and √(125² + (375√2)² + 2·125·375√2·(√2/2)) = 625.
  - **Through the apex:** points on a cone whose unrolled separation is ≥ π take the length ρ_P + ρ_Q. Construct one: a cone whose sector exceeds 2π·(1/2) with the points half a turn apart.
  - **Cylinder:** r = 3, h = 10. P is at height 1 and Q at height 9 on the diametrically opposite generator, giving length hypot(3π, 8). Also test a wrap case where k = −1 wins.
  - **Frustum refusal:** a path whose straight segment would cross the top rim is refused with the N4 message.
  - **Refusals:** a point on a cap; a sphere.
  - **Drawing:** the unrolling is lifted, with the straight path drawn on it. P and Q are marked on the solid. No geodesic is drawn in 3D.
- [ ] **Step 2: implement per N4.**
- [ ] **Step 3: prove it.**
  - Remove the through-the-apex branch: that test must go red.
  - Remove the k = ±1 wraps: the wrap test must go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): shortest paths over cylinders, cones and conical frusta`.

### Task 5: Examples, reference and handoff

**Examples,** all in group `'Nets and paths'`:
1. **"Cube and its net":** a lettered cube with `net:`.
2. **"Prism, pyramid and cone nets":** or split into two or three examples if one figure would crowd. Prefer legibility.
3. **"Dudeney's spider and fly":** the 30×12×12 room, `shortest: … unfold`, and `label: shortest …` reading 40.
4. **"AIME: a fly on a cone":** the 600 / 200√7 cone, both points, the path on the unrolling, with the label reading 625.
5. **"Over a cube, corner to corner":** √5, with `unfold`.

**Reference:** the grammar header documents N1–N6, including that net letters are display-only, the 12-face cap, and that round-solid paths live on the unrolling.

**Handoff:**
- Add a phase 11 row.
- Record that **build step 11 completes the solids build order**.
- Update "Not started", open items and remaining Track 2 work: shading and boolean regions, competition constructions, and the unit circle, which is gated on exact values.

- [ ] **Step 1:** add the examples plus the `'Nets and paths'` group, and run `examples.test.ts`. Render each to PNG and inspect it.
- [ ] **Step 2:** update the reference and the handoff.
- [ ] **Step 3:** run all three checks, then commit as `docs: phase 11 nets and shortest paths — examples, reference, handoff`.

## Verification

1. All three checks clean, and every pre-existing spec is byte-identical under every view.
2. The cube's cross, the prism strip, the pyramid star, the cone sector and the cylinder rectangle are at true size, with fold lines dashed.
3. Dudeney's spider reads 40 over 5 faces; the AIME fly reads 625; the cube corner path reads √5.
4. Overlapping nets, hulls, spheres, cap points and oversized solids are refused legibly.
5. Every new example is drawn and inspected in PNG.

## Out of scope

Everything in N6, shading and boolean regions (next phase), exact values, and the tutor reference.
