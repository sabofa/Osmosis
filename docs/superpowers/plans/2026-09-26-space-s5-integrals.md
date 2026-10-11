# Space S5 — Regions, Volumes, Riemann Sums, Triple Integrals and Centroids

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the OpenStax Calc Vol. 3 ch. 5 vocabulary:
- 2D regions (type I, type II, polar, inequality), shaded on the floor, and named;
- the volume under a surface and between two surfaces, with ∬ in the readout;
- Riemann boxes for double integrals, with the sum beside the integral;
- iterated triple-integral regions in rectangular, cylindrical and spherical coordinates, drawn as the exact image of the unit cube, with ∭ and an optional integrand;
- centroids and centres of mass;
- `over R` named regions for S1's surface domains.

**Architecture:**
- **Grammar** in `space/grammar/keywords/integrals.ts`; **builders** in `space/kernel/integrals/*.ts`.
- **One idea carries it.** An iterated region is a map from the unit square or cube, `Φ(s, t[, w])`, built from the author's bounds exactly as S1's K10 builds iterated surface domains. The boundary of a 3D region is the image of the cube's six faces, each a parametric patch. Degenerate faces, those with zero area (e.g. `r` from 0), are dropped by measuring each face's area on a coarse grid.
- **Values** come from `math/quadrature`'s nested adaptive Gauss–Kronrod, with the Jacobian of the coordinate system (`r` for polar and cylindrical, `ρ² sin φ` for spherical). They are shown with `≈` and the digits their error estimate supports.
- **Riemann boxes** are `BoxMark`s, which gets **S2's deferred box pipeline built here** (in `gl/boxPipeline.ts`).

**Tech Stack:** TypeScript, WebGL2, Vitest. No new dependencies.

**Spec:** Track 3 "Revised 2026-09-26", the SP9 integral table (5.1–5.6) and SP2's domains. Read the S1 plan (K6 domains and K10 exact maps, which are reused, not re-implemented), the S2 plan (the pipeline pattern, for `BoxMark`), and the S3 plan (`pick/format.ts`, OIT for translucent volumes).

**Parallel work:** S4a and S4b are built at the same time.
- **Shared files** (the keyword table, the registry index, `space/examples.ts`, `gl/backend.ts` for registering the box pipeline): add lines at the end of lists only.
- **Keyword ownership.** `region:`, `volume:`, `riemann:` and `centroid:` are space keywords. The controller relays them to the solid-figure agent (`centroid` is a word in their construction grammar, as `G = centroid ABC`; `centroid:` with a colon is a different form, and their `NAME = centroid …` form must stay theirs. Test it).

## Global Constraints

- Everything in the S1 plan's Global Constraints still binds.
- The worktree is `.claude/worktrees/milestone-a-space-s5`, branch `milestone-a/space-s5`.
- **Every statement:** has an example; refuses legibly; takes `color:` and `opacity:`; names its marks `s<line>.<part>`.
- **Every numeric value** is `≈ <digits>`. **Nothing is inferred exact.** A reader seeing `≈ 4.18879` may know it is 4π/3; the engine never says so.
- **Looking at renders:** use a headless Edge screenshot from PowerShell, then Read the PNG:
  `Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -Wait -NoNewWindow -ArgumentList @("--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=$env:TEMP\claude-headless-edge","--window-size=1400,900","--virtual-time-budget=6000","--screenshot=<out.png>","<url>")`
  **Never open a review page in the in-app browser pane or Chrome.** Each load asks the user to approve the site, and they are away.
- **Example groups:** if `Example` has a required `group` (added on the geometry side), space examples use `group: 'Space'`.

## Load-bearing decisions

**C1 — Regions.**
- **Syntax:**
  ```
  region: x in [0, 1], y in [x^2, x]                # type I (bounds of y read x)
  region: y in [0, 2], x in [0, y/2]                # type II
  region: r in [0, 2], theta in [0, pi/2]           # polar
  region: x^2 + y^2 <= 4 and y >= 0                 # inequality
  R = region x in [0, 1], y in [x^2, x]             # named (claimed by parseSpaceUnkeyed: NAME = region …)
  ```
- **Named regions.** A named region binds `R` and draws nothing on its own. `region: R` draws it. **`z = f over R` (S1's named domain) resolves to it here,** which replaces S1's "arrives with region:" error.
- **Drawn:** the region on the box floor, as a flat mesh (opacity 0.35, slot colour, reusing S1's domain meshing at z = floor), with its boundary as a `LineMark` (the exact bounding curves, sampled at 256 segments each).
- **Readout:** the area, `≈ …`, by `integrate2`.
- **Domain rules** are exactly S1 K6/K10, reused through the same functions: the outer variable is the one with constant bounds; crossing bounds are refused; mutual dependence is refused.
- **Inequality regions** get their area by quadrature over a grid-clipped mesh: the mesh area is the value, with `≈` and 4 significant digits. They are not integrated by `integrate2`, which cannot follow an implicit boundary. State this in a comment.

**C2 — Volumes under and between.**
- **Syntax:** `volume: under f over R` and `volume: between g and f over R`. f and g are targets (a two-variable name or expression); R is a named region or an inline region (C1 syntax after `over`).
- **Drawn** (all translucent at 0.45 unless styled, through OIT):
  - the top z = f over R (with S1's surface domain machinery);
  - the bottom z = g over R, or z = 0 for `under`;
  - the side walls: vertical ruled patches between bottom and top along each boundary curve of R, a parametric patch per boundary piece, (s, w) ↦ (γ(s), (1 − w)·g(γ(s)) + w·f(γ(s))).
- **Crossing surfaces.** Where f < g somewhere, the region between is drawn as written and the readout says "f < g on part of R; the integral counts that part negatively".
- **Readout:** `∬_R f dA ≈ …` (or `∬_R (f − g) dA ≈ …`), by `integrate2`, in the region's own coordinates with the polar Jacobian `r` where applicable.

**C3 — Riemann sums.**
- **Syntax:** `riemann: under f over x in [a, b], y in [c, d], n = 4` (or `n = 4 by 3`), with `sample: mid | lower-left | upper-right | lower-right | upper-left | random`. The default is `mid`.
- **Rectangles only.** A non-rectangular R is refused: "Riemann boxes need a rectangle; use x in [a, b], y in [c, d]".
- **`random`** uses a fixed-seed LCG (seed 1), for determinism.
- **Drawn:** each cell [xᵢ, xᵢ₊₁] × [yⱼ, yⱼ₊₁] is a box from z = 0 to f(sample), as a `BoxMark` (opacity 0.6, `edges: true`), plus the sample points as small dots on the box tops.
- **Readout:** `Σ f(x*, y*) ΔA = …` (exact arithmetic on the samples, printed with the formatter) and `∬ f dA ≈ …`, so the approximation reads against the integral.
- **Parameters:** `n` may be a binding (`n = n`), so a slider or play refines the sum, which is the point of the figure.
- **The box pipeline** (`gl/boxPipeline.ts`): instanced unit cubes scaled and offset per box, lit like meshes, and translucent through OIT. Edges are drawn by the line pipeline from each box's 12 edges, generated on the CPU into one `LineMark`-shaped batch for the instance.

**C4 — Triple integrals.**
- **Syntax:**
  ```
  volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]                 # rectangular, any order
  volume: r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical
  volume: rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi] spherical
  volume: … integrand <expr>        # computes ∭ g dV instead of the volume
  V = volume …                      # named, for centroid:
  ```
- **The order** is read from the bound dependencies: the innermost variable is the one whose bounds may read the others. Given as written, the dependencies must form a chain. Anything else is refused and names the offending bound.
- **The map.** `Φ(s, t, w)` = the three variables, each interpolated between its bounds as functions of the outer variables, followed by the coordinate map to Cartesian.
- **Drawn:** the six faces of the unit cube, mapped, as parametric patches (res 48 per face). A face whose sampled area is below `1e-9 ×` the box area² is dropped. Degenerate faces (r = 0, φ = 0, a collapsed bound) vanish that way. Opacity 0.4, edges along the cube's 12 edges where they are not degenerate.
- **Readout:** `∭ dV ≈ …`, or `∭ g dV ≈ …`, by `integrate3` with the coordinate Jacobian.

**C5 — Centroids.**
- **Syntax:** `centroid: R` or `centroid: V`, optionally `density <expr>`, where R and V are named regions or volumes.
- **Computation:** mass M = ∫ δ, and moments ∫ x δ, ∫ y δ, (∫ z δ), by the same quadrature. The centroid is the moments / M.
- **Drawn:** a diamond point labelled `centroid` (or `centre of mass` with a density), with drop lines to the walls, always shown.
- **Readout:** M and the coordinates, all `≈`.
- **Refusal:** M = 0 → "the mass is zero; the centre is undefined".

---

### Task 1: Regions, and `over R`

**Files:** Create `grammar/keywords/integrals.ts` (`region:` and the `NAME = region` unkeyed rule; add to S1's `parseSpaceUnkeyed` a claim for `NAME = region …`, **after** its solid-figure exclusions), `kernel/integrals/regions.ts`, and tests. Modify S1's named-domain resolution.

- [ ] **Failing tests:**
  - `region: x in [0, 1], y in [x^2, x]`: area ≈ 1/6 to 1e-10; the boundary contains points on y = x² and y = x;
  - polar `r in [0, 2], theta in [0, pi/2]`: area ≈ π;
  - inequality `x^2 + y^2 <= 4 and y >= 0`: mesh area within 0.5% of 2π at `res: 128`;
  - `R = region x in [0, 1], y in [0, x]` followed by `z = x + y over R`: the surface has every vertex with 0 ≤ y ≤ x ≤ 1;
  - the unkeyed claim: `R = region …` is claimed, but `G = centroid ABC` is **not** (it stays the solid-figure construction), and `centroid: V` is claimed by the keyword hook.
- [ ] **Prove it:** delete the named-domain resolution → the `over R` test fails with S1's old error.
- [ ] **Commit** `feat(graph-engine): space regions — type I and II, polar, inequalities, and named regions`.

### Task 2: Volumes under and between surfaces

**Files:** Create `kernel/integrals/volumes2.ts` and tests.

- [ ] **Failing tests:**
  - `volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, 2*pi]`: ∬ = ∫∫ (4 − r²) r dr dθ = 2π·(8 − 4) = 8π ≈ 25.13274 to 1e-8;
  - the walls: the side is the cylinder r = 2 from z = 0 to 0, which is degenerate, so the dome meets the floor and **no wall patch has area** (dropped);
  - `volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]`: ∬ (2 − x² − y²) dA = 8 − 8/3 = 16/3 ≈ 5.33333;
  - four wall patches, each with every vertex on the square's boundary;
  - f < g somewhere → the note in the readout.
- [ ] **Prove it:** drop the polar Jacobian `r` → 8π becomes 2π·(8 − 8/3) and the test fails.
- [ ] **Commit** `feat(graph-engine): space volumes under and between surfaces`.

### Task 3: Riemann boxes and the box pipeline

**Files:** Create `kernel/integrals/riemann.ts`, `gl/boxPipeline.ts`, its shaders, and tests (fake GL for the pipeline).

- [ ] **Failing tests:**
  - `riemann: under x*y over x in [0, 2], y in [0, 2], n = 2` with `sample: mid`: samples at (0.5, 0.5), (1.5, 0.5), (0.5, 1.5), (1.5, 1.5); heights 0.25, 0.75, 0.75, 2.25; Σ·ΔA = (0.25 + 0.75 + 0.75 + 2.25)·1 = 4; ∬ = 4. With `upper-right`: heights 1, 2, 2, 4 → 9;
  - `n = 4 by 3` gives 12 boxes;
  - `random` is deterministic across two builds;
  - a non-rectangle is refused;
  - `n` from a binding rebuilds on `setValue`;
  - the pipeline, via the fake GL: one instanced draw per `BoxMark`, and resources freed on dispose.
- [ ] **Prove it:** use the lower-left corner for `mid` → the Σ = 4 test gives 1 and fails.
- [ ] **Commit** `feat(graph-engine): space Riemann boxes, with the box pipeline`.

### Task 4: Triple integrals

**Files:** Create `kernel/integrals/volumes3.ts` and tests.

- [ ] **Failing tests:**
  - the tetrahedron `x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]`: ∭ ≈ 1/6. The faces: the x = 1 face and the y-top face collapse, so exactly 4 faces survive (the tetrahedron's four);
  - `integrand x` on the tetrahedron: ∭ x dV = 1/24;
  - `cylindrical` `r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2]`: ∭ = 8π (the same as C2's dome). The r = 0 face and the θ = 0 / θ = 2π seam faces are dropped (degenerate, or coincident and interior: state the rule — a face whose image coincides with another face's image is interior; for θ spanning exactly 2π, drop both θ faces). The surviving faces are the dome and the floor disc;
  - `spherical` `rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi]` (the ice-cream cone): ∭ = (2π)(1 − cos(π/4))(8/3) = (16π/3)(1 − √2/2) ≈ 4.90737;
  - an order that is not a chain is refused.
- [ ] **Prove it:** drop the spherical Jacobian → the cone test fails.
- [ ] **Commit** `feat(graph-engine): space triple-integral regions in three coordinate systems`.

### Task 5: Centroids

**Files:** Create `kernel/integrals/centroids.ts` and tests.

- [ ] **Failing tests:**
  - the centroid of the triangle region `x in [0, 1], y in [0, x]` is (2/3, 1/3);
  - of the tetrahedron, (1/4, 1/4, 1/4);
  - of the upper half-disc `r in [0, 1], theta in [0, pi]`, (0, 4/(3π)) ≈ (0, 0.42441);
  - with `density x` on the triangle: M = ∫₀¹∫₀ˣ x dy dx = 1/3, and x̄ = (∫∫ x² dA)/M = (1/4)/(1/3) = 3/4;
  - zero mass is refused.
- [ ] **Prove it:** swap the moments → the (2/3, 1/3) test fails.
- [ ] **Commit** `feat(graph-engine): space centroids and centres of mass`.

### Task 6: Examples

- [ ] Add `Space · …` examples:
  - a type I region with its surface over it;
  - a polar region;
  - the volume under a dome;
  - between two surfaces;
  - a Riemann sum with `@param n` and play;
  - the tetrahedron;
  - the ice-cream cone in spherical coordinates;
  - a cylindrical region;
  - the centroid of the half-disc.
- [ ] **Look at it** on 5182, and list what to check.
- [ ] **Commit** `docs(graph-engine): space examples for double and triple integrals`.

## Verification

All three checks clean. Every example builds. The byte-identity sweep for figure and 2D output. The controller looks.

## Out of scope

Change of variables (track 4); line and surface integrals, flux, Green, Stokes, divergence (sub-project 3).
