# Space S4a — Surfaces in Space, Vectors, Lines, Planes and Curve Frames

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the OpenStax Calc Vol. 3 ch. 2–3 vocabulary in space:
- implicit surfaces and level surfaces, which covers every quadric;
- lines and planes;
- dot-product projection and the cross product;
- cylindrical and spherical coordinate surfaces;
- TNB frames, the osculating circle, and velocity/acceleration with their tangential and normal parts.

**Architecture:**
- **Grammar.** Each statement is a keyword row, added in its own grammar module (`space/grammar/keywords/geometry.ts`, `…/curves.ts`) and registered in S1's keyword table.
- **Builders** live in `space/kernel/geometry/*.ts` and `space/kernel/curves/*.ts`, registered in `kernel/registry.ts`.
- **Implicit surfaces** are meshed by **marching tetrahedra** over the box: a consistent six-tetrahedron split per cube, so the surface is crack-free with no ambiguity table. Edge crossings are refined by bisection on the true F, and normals come from the symbolic ∇F.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** Track 3 "Revised 2026-09-26", SP9's differential table (rows 2.2–2.7 and 3.1–3.4) and SP2. Read the S1 and S3 plans for the modules consumed: `math/*`, the grammar hooks, the kernel registry and `setValue`, the picks, the E6 pick descriptors, and `PointMark`/`ArrowMark`/`LineMark`/`MeshMark`.

**Parallel work:** S4b (two-variable tools) and S5 (integrals) are built at the same time in sibling worktrees.
- **Shared files** are the keyword table, the registry index and `space/examples.ts`. Add rows and imports only, **one line each, at the end of the list**, so merges stay textual.
- **Do not create** `space/kernel/surfaceTools/` (S4b) or `space/kernel/integrals/` (S5).

## Global Constraints

- Everything in the S1 plan's Global Constraints still binds.
- The worktree is `.claude/worktrees/milestone-a-space-s4a`, branch `milestone-a/space-s4a`, cut from `milestone-a/space` after S3.
- **Every statement:**
  - carries `MarkSource` objects `s<line>.<part>`;
  - gets an example (`Space · …`);
  - refuses bad input legibly, naming the statement's own words;
  - takes the SP8 style clauses where they make sense (`color:` everywhere, `opacity:` on meshes, `width:` on lines).
- **Keyword ownership (agreed with the solid-figure side, 2026-09-26):**
  - **A uniform rule in `parseSpaceKeyword`,** for every keyword: never claim a statement whose operand is only a hyphenated list of point names (`A-B`, `A-B-C`, `A-B-C-D`, …), optionally followed by `dashed` or `plain`. Those stay solid-figure territory. A test covers `line: A-B`, `line: A-B dashed`, `plane: A-B-C` and `path: A-B-C-D`.
  - **Reserved for solid figures** (never use them at line start): `fill:`, `net:`, `shortest:`, `dihedral:`, `angle:`, `right-angle:`, `segment:`, `tick:`, `cut:`, `section:`. Tell the controller if any other keyword here could appear in a solid-figure spec; the controller relays it to the solid-figure agent.
- **Numbers shown to the reader** use `pick/format.ts` (S3). Nothing is inferred exact.
- **Looking at renders:** use a headless Edge screenshot from PowerShell, then Read the PNG:
  `Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -Wait -NoNewWindow -ArgumentList @("--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=$env:TEMP\claude-headless-edge","--window-size=1400,900","--virtual-time-budget=6000","--screenshot=<out.png>","<url>")`
  **Never open a review page in the in-app browser pane or Chrome.** Each load asks the user to approve the site, and they are away.
- **Example groups:** if `Example` has a required `group` (added on the geometry side), space examples use `group: 'Space'`.

## Load-bearing decisions

**A1 — Marching tetrahedra** (`kernel/geometry/marchingTets.ts`).
- **Sampling region.** The implicit surface's region is `@bounds3d` where it is given, else [−5, 5]³. This is documented in the grammar header: an implicit surface cannot size the box from its own extent. The grid is `res`³ cubes (default 64; `res:` and `@resolution` override).
- **The split.** Each cube is split into 6 tetrahedra along its main diagonal (the Kuhn split), identically in every cube, so faces match.
- **Per tetrahedron**, the sign pattern of `F − c` at its 4 vertices gives 0, 1 or 2 triangles. Each crossing vertex is on the edge's **true** zero, refined by bisection to 1e-10 of the edge length, and **shared by global edge key**.
- **Winding.** Triangles are wound so their geometric normal agrees with ∇F; the normal therefore points toward increasing F.
- **Normals** come from compiled `simplify(diff)` of F, normalised, with the mesh-normal fallback where ∇F = 0 (a cone's apex).
- **Holes.** A non-finite sample voids the cubes touching it, which leaves a hole and no error.
- **Pick:** `{ kind: 'implicit', F, grad }`.
- **Default style:** flat colour by slot, opacity 1, `colormap: none`. A `contour:` of a three-variable F (S4b owns `contour:` of two variables; **this phase implements the three-variable branch of the same keyword**, coordinating with S4b via the shared rule below).

**A2 — `contour:` is shared with S4b. Split by arity.**
- **The grammar** for `contour:` is written **in this phase** (`grammar/keywords/contour.ts`). It parses `contour: <f or expr> levels <n> | levels a..b step s | levels a, b, c [floor] [labels]`, and emits `{ form: 'contour', target, levels, floor, labels }`.
- **The builder dispatches on the target's arity:** three variables → level surfaces (A1, **this phase**); two variables → level curves (**S4b**, which registers `contourCurves` in its own file).
- **Until S4b merges,** a two-variable contour is an error on its line: "level curves arrive with phase S4b".
- **Levels:**
  - `levels n` gives the multiples of `niceStep(range, n)` that lie strictly inside the sampled range of F. For three variables, the range is sampled on a 16³ grid over the box.
  - An explicit list or `a..b step s` is used as written.
- **Level-surface opacity** defaults to 0.45 when there is more than one level, and each level gets the colour of its value on the spec's colormap.

**A3 — Lines and planes.**
- **Lines:**
  ```
  line: through (1, 2, 3) direction <1, -1, 2>
  line: through P and Q
  line: through (1, 2, 3) and (0, 0, 1)
  ```
  - A line is a `LineMark` clipped exactly to the box (parametric slab clipping), so it spans the box.
  - Named points are points defined elsewhere in the spec (`P = (…)`). An unknown name is refused.
  - A zero direction is refused.
- **Planes:**
  ```
  plane: 2x + y - z = 3
  plane: through (1, 2, 3) normal <1, 1, 1>
  plane: through (1,0,0), (0,1,0), (0,0,1)
  plane: through P, Q, R
  ```
  - **The equation form** checks that the equation is affine in x, y, z by evaluating at (0,0,0), the unit points, and (1,1,1) and (2,−1,3), as the solid-figure side does. That is an independent re-implementation, not an import: the engines share no code. It refuses "not linear in x, y, z" and an all-zero normal.
  - **Drawn** as the exact polygon plane ∩ box (3–6 vertices, clipped by slab tests and ordered by angle about the centroid in the plane's frame), fan-triangulated. It is a `MeshMark` at opacity 0.35 by default, with an outline `LineMark` (1.5 px) and `pick` null.
  - **Refusals:** collinear points; a plane missing the box ("plane … does not meet the box — widen @bounds3d").
  - **Never claimed:** `plane: A-B-C` (point-list with dashes) returns null from the keyword hook.

**A4 — Vector operations.**
- **Vector operands** are vector constants (`u = <1, 2, 3>`), inline literals (`<1, 2, 3>`), or vector functions evaluated at a point (`F(1, 0, 2)`).
- **`cross: u x v`** (also `×`), optionally `at P` (default: the origin). It draws:
  - u and v as arrows from P;
  - the parallelogram P, P+u, P+u+v, P+v, as a mesh at opacity 0.3 with an outline;
  - u × v as an arrow from P, in its own slot colour;
  - small right-angle marks between u×v and u, and between u×v and v, as 3D squares of side 0.08 × the box span, in the planes they span.
  - **Readout:** |u × v| = area.
  - **Refusal:** parallel u and v → "u and v are parallel; u × v = 0".
- **`project: u onto v`** (optionally `at P`). It draws:
  - u and v;
  - proj_v u = (u·v / v·v) v, as a bold arrow (3 px);
  - the perpendicular part, dashed from the projection's tip to u's tip;
  - a right-angle mark at the projection's tip.
  - **Readout:** the scalar component u·v/|v|, and the angle between u and v in degrees or radians per `@angle`, as a decimal.

**A5 — Coordinate surfaces.**
- **Syntax:** `cylindrical: <r|theta|z> = <expr in the other two>` and `spherical: <rho|theta|phi> = <expr in the other two>`, each with optional `for` ranges.
- **Conventions:** θ is the azimuth from +x toward +y; φ is measured from +z (OpenStax).
- **Default ranges:**
  - θ ∈ [0, 2π], φ ∈ [0, π];
  - z ∈ the box z range;
  - r ∈ [0, R] and ρ ∈ [0, R], where R is the largest box half-span.
  - The box comes from `@bounds3d` or [−5, 5]³ here, for the same reason as A1.
- **Built** as parametric surfaces through the exact coordinate map, with `pick: parametric` and the coordinate names as the parameter names.
- **The readout** shows the point in the coordinate system as well: (r, θ, z) or (ρ, θ, φ).
- **Examples:**
  - `cylindrical: r = 2` is a cylinder;
  - `cylindrical: z = r` is a cone;
  - `spherical: phi = pi/4` is a cone;
  - `spherical: rho = 2 sin(phi)`;
  - `spherical: theta = pi/3` is a half-plane.

**A6 — Curve frames and motion.**
- **Curve operand:** a vector function `r` (`r(t) = <…>`), or an inline `<…>` with the parameter named in `at <param> = value`.
- **Derivatives** `r′` and `r″` come from symbolic `diff` per component.
- **The frame** (`frame: r at t = 1`):
  - T = r′/|r′|;
  - N = (r″ − (r″·T)T) / |that|;
  - B = T × N;
  - κ = |r′ × r″| / |r′|³.
  - **Drawn** as three unit arrows from r(t), scaled by `L = 0.18 × the largest box span` so they are visible, and labelled `T`, `N`, `B`, plus the point.
  - **Refusals:** |r′| = 0 → "r′(1) = 0: the curve has no tangent there"; κ = 0 → "the curvature is zero at t = 1; N and B are undefined", which still draws T.
- **`osculating: r at t = 1`:** the circle of radius 1/κ centred at r + N/κ in the plane of T and N (a 256-segment `LineMark`), the point, and the centre as a small ring. Readout κ and radius. κ = 0 is refused.
- **`motion: r at t = 1`:** v = r′ and a = r″ as arrows from r(t), at true length. With `components`: a_T = (a·T)T and a_N = a − a_T as dashed arrows. Readout |v|, a_T (signed scalar) and |a_N|.

---

### Task 1: Marching tetrahedra, implicit surfaces, and level surfaces

**Files:** Create `kernel/geometry/marchingTets.ts`, `kernel/geometry/implicit.ts` (the builder for S1's `implicitSurface` form, replacing S1's "arrives in S4" error), `grammar/keywords/contour.ts`, `kernel/geometry/levelSurfaces.ts`, and tests. Register them.

- [ ] **Failing tests:**
  - **Sphere.** `x^2 + y^2 + z^2 = 4` at `res: 24` over [−3, 3]³:
    - every vertex satisfies ||p| − 2| ≤ 1e-8, from the bisection;
    - every edge is shared by exactly two triangles (closed, no cracks);
    - normals point outward (n · p > 0 for every vertex);
    - the mesh area is within 2% of 16π.
  - **Hyperboloid.** `x^2 + y^2 - z^2 = 1` over [−2, 2]³: open at the box. Every vertex satisfies |x² + y² − z² − 1| ≤ 1e-8.
  - **Cone apex.** `x^2 + y^2 = z^2`: normals at vertices with ∇F = 0 are non-zero (the fallback).
  - **Forced reading.** `implicit: x^2 + y^2 = 4` is a cylinder: vertices at radius 2 across the whole box z range.
  - **Level surfaces.** `g(x, y, z) = x^2 + y^2 + z^2`, `contour: g levels 1, 4, 9`: three meshes of radii 1, 2, 3, each at opacity 0.45, coloured by value.
  - **`levels 3` on the same g** over [−3, 3]³: the range sampled on 16³ runs from ≈0 to 27. The levels are the multiples of `niceStep(27, 3)` = 10 strictly inside: 10, 20.
  - **Pending arity.** A two-variable contour gives the "arrives with phase S4b" error.
- [ ] **Prove it:**
  - delete the edge-key sharing → the closed-surface test fails;
  - delete the bisection → the 1e-8 test fails;
  - delete the winding rule → the outward-normal test fails.
- [ ] **Commit** `feat(graph-engine): space implicit and level surfaces by marching tetrahedra`.

### Task 2: Lines and planes

**Files:** Create `grammar/keywords/geometry.ts` (`line:`, `plane:`), `kernel/geometry/lines.ts`, `kernel/geometry/planes.ts`, and tests.

- [ ] **Failing tests:**
  - **A line in a cube.** `line: through (0,0,0) direction <1,1,1>` in the box [−2, 2]³ runs from (−2,−2,−2) to (2,2,2) exactly.
  - **A line along x.** `line: through (0, 5, 0) direction <1,0,0>` in [−2, 2]³ misses the box → error "does not meet the box".
  - **The x + y + z = 1 triangle.** `plane: x + y + z = 1` in [0, 2]³ is the triangle (1,0,0), (0,1,0), (0,0,1).
  - **A hexagon.** `plane: x + y + z = 0` in [−1, 1]³ is the regular hexagon with vertices at the permutations of (1, −1, 0): 6 vertices, all at distance √2 from the origin.
  - **Three points.** `plane: through (1,0,0), (0,1,0), (0,0,1)` equals the first plane test.
  - **Refusals:** collinear points; `plane: x^2 + y = 1` → "not linear"; `plane: 0x = 1` → an all-zero normal.
  - **Not claimed:** `plane: A-B-C` is not claimed (the solid-figure refusal still fires through `parseStatement`).
- [ ] **Prove it:** delete the angular ordering → the hexagon's triangulation self-intersects, which a test on the orientation of the fan triangles catches.
- [ ] **Commit** `feat(graph-engine): space lines and planes, clipped exactly to the box`.

### Task 3: Vector operations

**Files:** Create `grammar/keywords/vectors.ts` (`cross:`, `project:`), `kernel/geometry/vectorOps.ts`, and tests.

- [ ] **Failing tests:**
  - `cross: <1,0,0> x <0,1,0>` gives a result arrow (0, 0, 1) and area 1;
  - `cross: <1,2,3> x <4,5,6>` gives (−3, 6, −3), area √54 = 7.3485;
  - with `at (1,1,1)` the tails move;
  - parallel operands are refused;
  - `project: <3,4,0> onto <1,0,0>` gives projection (3, 0, 0), perpendicular part from (3,0,0) to (3,4,0), scalar component 3, angle ≈ 53.13° under `@angle: degrees`;
  - named operands: `u = <1, 2, 3>`, `v = <4, 5, 6>`, `cross: u x v`.
- [ ] **Prove it:** swap the cross-product order → the (−3, 6, −3) test fails.
- [ ] **Commit** `feat(graph-engine): space cross products and projections`.

### Task 4: Coordinate surfaces

**Files:** Create `grammar/keywords/coordinates.ts`, `kernel/geometry/coordinateSurfaces.ts`, and tests.

- [ ] **Failing tests:**
  - `cylindrical: r = 2`: every vertex has x² + y² = 4 within 1e-12, and z covers the box z range;
  - `spherical: phi = pi/4`: every vertex has z = √(x² + y²) within 1e-12, and z ≥ 0;
  - `spherical: rho = 2 sin(phi)`: every vertex satisfies x² + y² + z² = 2√(x² + y²), the torus-like sphere-of-revolution identity, within 1e-9;
  - `spherical: theta = pi/3`: every vertex has y = √3·x, with x ≥ 0;
  - the readout for a cylindrical pick at (0, 2, 1) is (r, θ, z) = (2, π/2 → 1.571, 1).
- [ ] **Prove it:** use φ from the xy-plane instead of from +z → the cone test fails.
- [ ] **Commit** `feat(graph-engine): space cylindrical and spherical coordinate surfaces`.

### Task 5: Curve frames, the osculating circle, and motion

**Files:** Create `grammar/keywords/curves.ts` (`frame:`, `osculating:`, `motion:`), `kernel/curves/frames.ts`, and tests.

- [ ] **Failing tests** (helix r = ⟨cos t, sin t, t⟩ at t = 0):
  - r′ = (0, 1, 1), so T = (0, 1, 1)/√2;
  - r″ = (−1, 0, 0), so N = (−1, 0, 0);
  - B = T × N = (0, −1, 1)/√2. Hand check: (0, 1/√2, 1/√2) × (−1, 0, 0) = (1/√2·0 − 1/√2·0, 1/√2·(−1) − 0·0, 0·0 − 1/√2·(−1)) = (0, −1/√2, 1/√2) ✓;
  - κ = |r′ × r″| / |r′|³ = |(0, −1, 1)| / (√2)³ = √2 / (2√2) = 1/2;
  - the osculating circle has radius 2, centre r + N/κ = (1,0,0) + 2(−1,0,0) = (−1, 0, 0), in the plane spanned by T and N;
  - `motion: r at t = 0 components`: v = (0, 1, 1), a = (−1, 0, 0), a_T = 0, |a_N| = 1;
  - a line `r(t) = <t, 2t, 3t>` has κ = 0: `frame:` draws T and reports the undefined N and B; `osculating:` is refused.
- [ ] **Prove it:** drop the removal of the tangential part of r″ in N → N is wrong on a non-unit-speed curve. Add that curve: r = ⟨t, t², 0⟩ at t = 1, where N = (−2, 1, 0)/√5, derived by hand in the test.
- [ ] **Commit** `feat(graph-engine): space curve frames, osculating circles, velocity and acceleration`.

### Task 6: Examples

- [ ] Add `Space · …` examples: the six quadrics (ellipsoid, the two hyperboloids, the cone, the elliptic and hyperbolic paraboloids); a plane and a line meeting at a point; the cross-product parallelogram; projection; a cylindrical and a spherical cone; the helix frame; the osculating circle; motion with components; nested level surfaces.
- [ ] **Look at it** on 5182, and list what to check.
- [ ] **Commit** `docs(graph-engine): space examples for surfaces in space, vectors and curve frames`.

## Verification

All three checks clean. Every new example builds. The byte-identity sweep for figure and 2D output. The controller looks.

## Out of scope

Two-variable contour curves, traces, tangent planes, gradients, directional derivatives, critical points, Lagrange (S4b); integrals (S5); vector fields (sub-project 3).
