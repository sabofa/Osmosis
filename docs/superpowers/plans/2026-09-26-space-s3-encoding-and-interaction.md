# Space S3 — Encoding and Interaction

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make a space plot readable and alive.
- **Readable:**
  - colormaps with a colorbar;
  - mesh lines that are traces at tick values;
  - a tinted back face, so a surface's orientation shows;
  - clipping at the axis box;
  - curves that go dashed where a surface hides them;
  - order-independent transparency;
  - depth cueing.
- **Alive:**
  - a hover probe that reads the true function (with f_x, f_y on a graph), with drop lines to the walls;
  - pins;
  - a parameter panel with sliders and play/loop;
  - dragging a point that is defined by parameters;
  - exposure events.

**Architecture:**
- **Shading** extends S2's mesh and line shaders.
- **The frame loop moves to an offscreen, multisampled framebuffer,** so transparency can composite and hidden parts can be depth-tested.
- **Picking is pure** (`space/pick/`): CPU rays against the scene's geometry, then refinement on the scene's compiled pick functions.
- **The interaction layer** (probe, pins, drop lines, drag handles) is transient geometry the renderer draws over the scene. It is never part of `SpaceScene`.
- **The parameter panel** drives `SpaceKernel.setValue`, and the renderer re-uploads only the marks whose identity changed.

**Tech Stack:** TypeScript, WebGL2 + GLSL ES 3.00 (`EXT_color_buffer_float` for OIT), Vitest (node). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 3 "Revised 2026-09-26". Read SP3–SP6, SP8 and SP11 (the S3 row). Read the S1 and S2 plans for the modules this consumes, and `docs/HANDOFF-2026-09-23-graph-engine-v2.md`, lessons 1–4.

**Carried from S1's review:**
- A compiled closure owns one evaluation frame and is not re-entrant. Never call a mark's pick functions from inside a kernel build. JS is single-threaded, so this holds as long as picking runs only from input handlers.
- Show only colour scales that some mark references; S1's fix round prunes the others.

**Carried from S2's Task 7:**
- Automatic bounds must round out to an authored `@ticks3d` step when one is given, not to `niceStep`. Today, `@ticks3d: x pi/2` with a surface over [−2π, 2π] draws a box out to ±5π/2. Fold this into E2 or E4's task as a small `frame/bounds.ts` change, with a test.
- Curves lying on surfaces win the depth test by a 1e-5 NDC bias, which a 16-bit depth buffer cannot resolve. Use polygon offset on meshes (`gl.polygonOffset`) in the offscreen loop instead, and keep the hidden-part pass (E4 step 4) consistent with it.
- At a box's shared front corner, the x and y end labels (e.g. `5` and `5`) sit side by side. Leave it for S6 unless it is trivial.

**Prior work to consume** (from S1 and S2, merged on `milestone-a/space`):
- the contract: `space/scene/types.ts`, `space/config.ts`, `space/kernel/api.ts`;
- `space/kernel/*`: the builders, `setValue` with identity reuse, and the compiled picks;
- `math/` (`compileScalar`, `diff`, `simplify`, `roots`);
- `space/camera/*` (`cameraMatrices`, `project`, `rayAt`, the reducers);
- `space/frame/*` (`resolveBox`, `boxHalfExtents`, `ticks`, `formatTick`, `FrameModel`);
- `space/gl/*` (`GlBackend`, the pipelines, `fakeGl`, `dash.ts`);
- `space/ui/*` (overlay, label pool, input);
- `space/SpaceRenderer.ts`;
- `review/space.html`.

## Global Constraints

- Everything in the S1/S2 plans' Global Constraints still binds:
  - no new dependencies; no three.js under `space/`;
  - only `space/gl/` touches WebGL; only `space/ui/` and `SpaceRenderer.ts` touch the DOM;
  - errors are returned or shown, never thrown into React;
  - render on demand;
  - proving a test means deleting the behaviour it covers;
  - all three checks clean before every commit;
  - one commit per task, subject lowercase `type(scope): summary`, body ending EXACTLY `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`;
  - stage explicit paths, never `git stash`, never push;
  - say "space" or "solid figures".
- **Readouts never infer exactness.** Numbers are decimals from `space/pick/format.ts` (K-S3-8). A numeric integral or root shows `≈`.
- **The contract may gain optional fields only:** `PointMark.drag` (E11). Record it in the ledger.
- **Worktree:** `.claude/worktrees/milestone-a-space`, branch `milestone-a/space`.
- **Look at it** after Tasks 2, 3, 5, 6 and 7 on the review server (`npm run review -- --port 5182 --host 100.90.203.2`, from the worktree), and say what to look at.
- **Looking at renders:** use a headless Edge screenshot from PowerShell, then Read the PNG:
  `Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -Wait -NoNewWindow -ArgumentList @("--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=$env:TEMP\claude-headless-edge","--window-size=1400,900","--virtual-time-budget=6000","--screenshot=<out.png>","<url>")`
  **Never open a review page in the in-app browser pane or Chrome.** Each load asks the user to approve the site, and they are away.
- **Example groups:** if `Example` has a required `group` (added on the geometry side), space examples use `group: 'Space'`.

## Load-bearing decisions

**E1 — Colormaps are built from anchor colours and interpolated in Oklab** (`space/colormaps.ts`, pure).
- **Sequential maps.** Each is defined by nine anchor colours at t = 0, 1/8, …, 1, the maps' published 9-step samples:
  - viridis: `#440154 #472D7B #3B528B #2C728E #21908C #27AD81 #5DC863 #AADC32 #FDE725`
  - magma: `#000004 #1D1147 #51127C #822681 #B63679 #E65164 #FB8861 #FEC287 #FCFDBF`
  - plasma: `#0D0887 #4C02A1 #7E03A8 #A92395 #CC4778 #E66C5C #F89540 #FDC328 #F0F921`
  - cividis: `#00204D #00336F #39486B #575C6D #707173 #8A8779 #A69D75 #C4B56C #E4CF5B`
  - gray: `#1A1A1A` → `#F2F2F2`, 2 anchors
- **Diverging `balance`:** anchors blue `#2F5AA8`, neutral (the theme's background lightened or darkened to Oklab L 0.92 in light and 0.30 in dark), red `#B8322A`. Each half is interpolated in Oklab, and the two halves are equalised in L so the map is symmetric in lightness about the centre.
- **Tables.** `colormapTable(name, theme) → Uint8Array(256 * 4)`, interpolating between anchors in Oklab.
- **Pinned by tests:**
  - every sequential map's Oklab L is non-decreasing across its 256 entries (cividis, viridis and magma are monotone in L by design);
  - entry 0 and entry 255 equal the first and last anchors exactly;
  - `balance` has |L(i) − L(255 − i)| ≤ 0.01.

**E2 — Normalising a colour value.** `normalise(v, scale)` is `(v − min)/(max − min)` for a sequential scale. For a diverging scale it is `0.5 + v / (2 · max(|min|, |max|))`. Values are clamped to [0, 1], and a non-finite value maps to the "no data" colour (the palette's `grid`). The same function runs in the shader, as GLSL, and on the CPU for the colorbar and readouts. A test pins that the two agree on 20 values: evaluate the GLSL string's arithmetic by a tiny interpreter, or keep the formula in one template shared by both.

**E3 — Surface shading, added to S2's mesh shader:**
- **Colour.** When `style.colorScale` is set, the fragment colour is the LUT sample at the normalised scalar, then lit.
- **Mesh lines** from `uv`, at `u0 + k·du` and `v0 + k·dv`: 1 CSS px wide (`fwidth`-based, antialiased), the surface colour mixed 45% toward the palette's `axis` ink. Lines fade out when a line's on-screen spacing drops below 5 px (`fwidth(u)/du`), so a zoomed-out surface is not all lines.
- **Back faces** (`!gl_FrontFacing`): the lit colour mixed 30% toward a fixed cool tint (`#5a6b8c` light, `#8fa2c9` dark), then darkened ×0.85.
- **Depth cue:** `mix(color, background, 0.35 · smoothstep(0, 1, depthT))`, where `depthT` is the fragment's view depth normalised across the box's bounding sphere. It applies to meshes, lines, points and arrows, and `@depthcue: off` sets the 0.35 to 0.
- **Box clipping:** every mark fragment whose author-space position lies outside the resolved box by more than 1e-6 of the box span is discarded. The frame is never clipped. The shader receives the box in the same centre-relative coordinates as the positions.

**E4 — The frame loop, offscreen** (`gl/frameLoop.ts`).
1. Render into a **multisampled FBO** (4×, or `MAX_SAMPLES` if lower): an RGBA8 colour buffer and a DEPTH24 depth buffer.
2. The frame.
3. Opaque meshes.
4. **The hidden-part pass:** every `LineMark` and `ArrowMark` with `hidden: 'dashed'`, drawn with `depthFunc(GREATER)` and depth writes off, at 45% alpha, dashed 4 px on and 4 px off along the cumulative screen length (S2's `dash.ts`). It runs before any line has written depth, so it tests against surfaces only.
5. Lines, points and arrows, normally.
6. **Transparent meshes, by weighted blended OIT** (McGuire and Bavoil 2013), when `EXT_color_buffer_float` exists.
   - Resolve the MSAA buffer to a single-sample colour texture and depth texture by `blitFramebuffer`.
   - Render the transparent meshes into an accumulation target (RGBA16F) and a revealage target (R16F), depth-tested against the resolved depth, with no depth write, using the standard weight function `w = α · clamp(0.03 / (1e-5 + (z/200)^4), 1e-2, 3e3)`.
   - Composite over the resolved colour into the default framebuffer.
7. **Without the extension:** S2's sorted per-mark blending, drawn into the MSAA buffer, then blitted. A test covers both paths with the fake context.
8. **Resize** reallocates every target. **Context restore** recreates them. `dispose()` deletes them; the lifecycle test covers it.

**E5 — The colorbar** (`ui/colorbar.ts`, DOM).
- **Layout:** a vertical 12 × 160 px strip on the right edge, inset 16 px, drawn as a CSS `linear-gradient` of 16 stops sampled from the same table.
- **Contents:** ticks from `frame/ticks.ts` over the scale's domain (target 5), labels through `formatTick`, and the title (`scale.title`) above.
- **At most two scales,** stacked. If a scene has more, the first two are shown and one console note is printed per scene.
- **Diverging scales** mark zero with a tick of their own.

**E6 — Picking** (`space/pick/`, pure).
- **Input:** `pickAt(scene, matrices, viewport, px, py, box) → Hit | null`.
- **Graph surfaces** (`pick.kind === 'graph'`). Clip the ray to the box, march 256 steps on `g(s) = ray_z(s) − f(ray_x(s), ray_y(s))` to the first sign change, then refine by bisection to `1e-12` of the box span. The hit is exact on the true `f`. Report `x, y, z = f(x, y)`, `f_x` and `f_y` from the compiled picks.
- **Parametric and implicit surfaces.**
  - Intersect a lazily built BVH (median split on triangle centroids, leaves of at most 8 triangles, built on first pick of a mark and cached by mark identity).
  - **Parametric:** refine with 4 Newton steps on `r(u, v) − (o + s·d) = 0` for `(u, v, s)`, starting from the barycentric (u, v) of the hit triangle, with a 3×3 solve from `math/linalg`. The Jacobian comes from `r_u` and `r_v`, compiled from `diff`; if the kernel lacks them, S3 adds `ru`/`rv` to the parametric pick as optional fields.
  - **Implicit:** Newton along the ray on `F`, using `grad` for the derivative.
- **Curves, points and arrows:** screen-space distance (curves ≤ 8 px, points ≤ half their size + 4, arrows ≤ 6 px). A curve's `t` is interpolated from `params`, then the point is re-evaluated from `pick.r(t)`.
- **Priority:** thin things win over surfaces when both are within their tolerance, since you are pointing at the curve. Otherwise the nearest in depth wins.
- **`Hit`** is `{ source: MarkSource, kind: 'graph' | 'parametric' | 'implicit' | 'curve' | 'point' | 'arrow', position: Vec3, values: ReadoutRow[] }`.

**E7 — The readout** (`pick/readout.ts`, pure).
- **Rows** are `{ label, value }`.
  - **Graph:** `x`, `y`, `z` (= f), then `∂f/∂x` and `∂f/∂y`.
  - **Parametric:** the point, then `u` and `v` under the statement's own parameter names.
  - **Implicit:** the point, and `|∇F|`.
  - **Curve:** the point, `t` (its own name), and speed `|r′(t)|`.
  - **Point:** its label and coordinates.
  - **Arrow:** tail, components, and magnitude.
- **The title** is the statement's `name:` when it has one, else the source text trimmed to 40 characters.

**E8 — Number formatting** (`pick/format.ts`).
- 4 significant digits, trailing zeros trimmed, U+2212 minus.
- `|v| ≥ 1e5` or `0 < |v| < 1e-4` prints as `m×10ⁿ`.
- −0 prints `0`.
- It **never** rounds to a "nice" rational or prints π: no inference.

**E9 — Probe and drop lines** (`ui/probe.ts`, plus an interaction layer in `SpaceRenderer`).
- **Hover** runs `pickAt`, throttled to one per animation frame.
- **What it shows:** a marker (a ring, 10 px, in the `hover` colour) at the hit, dashed drop lines (1 px) from the hit to the frame's floor and to each back wall, small dots at the three feet, and a readout box (DOM, pointer-events off) offset from the cursor.
- **Hover off** removes them.
- **`@hover: none`** disables the probe. `@hover` otherwise keeps its meaning.

**E10 — Pins** (`ui/pins.ts`, a pure reducer plus DOM).
- **Adding.** A click (pointer up within 4 px of pointer down, and under 400 ms) on a hit pins it: the marker, the drop lines and the readout stay.
- **Removing.** A click within 8 px of a pin's marker removes that pin. Esc clears all pins.
- **Re-evaluation.** Pins store the hit's source and parameters (`x, y` for a graph, `u, v`, `t`, and so on), not pixels. After a `setValue`, a pin is re-evaluated through the new scene's picks, so a pinned point on `z = a x²` follows `a`. A pin whose mark no longer exists is dropped.
- **Events:** `onEvent({ type: 'pin', action: 'add' | 'remove' | 'clear', hit })`.

**E11 — Parameters and drag.**
- **The panel** (`ui/params.ts`, DOM, pointer-events on). A compact panel, top left, one row per binding: name, a range slider, a number input (committing on Enter or blur), and a play button with a loop toggle.
  - **Play** sweeps `min → max` in 6 s, linearly. An integer binding steps.
  - **Loop** ping-pongs.
  - The timeline is a pure function, `valueAt(binding, t0, now, mode)`, and is tested.
  - Every change calls `kernel.setValue` then `renderer.setScene`, coalesced to one per animation frame.
- **Drag.** The kernel's point builder adds an optional `drag` to a `PointMark` when the point's coordinate expressions reference one or two bindings:
  ```ts
  drag: { params: string[]; position(values: Float64Array): Vec3; jacobian(values: Float64Array): Float64Array }  // 3 x params, from diff
  ```
  - **Solving.** Pointer down on such a point (within its pick tolerance) starts a drag. Pointer move solves for the params by damped Gauss–Newton, minimising the screen distance between `project(position(p))` and the cursor, with the Jacobian chained through the projection. It starts from the current values, runs at most 8 iterations, and clamps to the ranges.
  - **Effect.** The result is written by `setValue`, and the probe is suppressed while dragging.
  - **With 3 or more referenced params,** the point is not draggable.
- **Events:** `onEvent({ type: 'param', name, value, source: 'slider' | 'play' | 'drag' })`.

**E12 — Events and API.**
- `SpaceRenderer` gains `onEvent` in its options, and `setValue(name, value)` for hosts. Track 7 will drive this.
- `GraphViewer` passes nothing new yet. The review page shows the event log (the last 10) in a small panel, for verification.

---

### Task 1: Colormaps and the colorbar model

**Files:** Create `space/colormaps.ts` (with `oklab.ts` helpers, if separate), `space/pick/format.ts`, and tests. Add the colorbar's pure layout (ticks and stops) in `ui/colorbarModel.ts`.

- [ ] **Failing tests:**
  - the E1 monotone-L, endpoint and symmetry tests;
  - Oklab round trip: sRGB `#21908C` → Oklab → sRGB within 1/255;
  - `normalise`: a sequential scale over [2, 6] maps 4 → 0.5. A diverging scale over [−1, 3] maps 0 → 0.5, 3 → 1, and −1 → 0.5 − 1/6 = 0.3333333333333333;
  - a non-finite value maps to "no data";
  - E8 formatting:
    - `0.000123456` → `1.235×10⁻⁴`;
    - `2.5` → `2.5`;
    - `-3` → `−3`;
    - `123456` → `1.235×10⁵`;
    - `-0` → `0`;
    - `1/3` → `0.3333` (never `1/3`);
  - colorbar stops: 16 stops, first equal to entry 0 and last to entry 255.
- [ ] **Prove it:**
  - interpolate in sRGB instead of Oklab → the viridis monotone-L test fails at some entry (verify it does; if it does not, pin the Oklab midpoint of the first segment instead);
  - delete the diverging branch of `normalise` → the diverging test fails.
- [ ] **Commit** `feat(graph-engine): space colormaps in Oklab, colour normalisation, readout number format`.

### Task 2: Surface shading and box clipping

**Files:** Modify `gl/shaders/mesh.ts`, `gl/meshPipeline.ts` (the LUT texture per map and theme, the scalar and uv attributes, mesh lines, the back tint, the depth cue, clip uniforms), and the line, point and arrow shaders (depth cue and clipping). Create `ui/colorbar.ts` (DOM, wired into `SpaceRenderer`).

- [ ] **Failing tests** (fake GL):
  - a mesh with a colour scale uploads a 256×1 RGBA8 texture exactly once per (map, theme), shared by marks;
  - a theme switch replaces it;
  - `scalars` and `uv` become vertex attributes only when present;
  - clip uniforms equal the box relative to its centre;
  - `@depthcue: off` sets the cue uniform to 0.
- [ ] **Look at it:**
  - a saddle with viridis and mesh lines at the x/y ticks;
  - a diverging `colormap: x*y`;
  - `z = 1/(x^2 + y^2)` cut cleanly at the box ceiling;
  - a sphere's inside showing the tinted back face through a cut (`@bounds3d z [-1, 0.3]`);
  - the colorbar with ticks and title.
- [ ] **Prove it:**
  - delete the texture cache → the once-per-map test fails;
  - delete the clip uniforms → their test fails.
- [ ] **Commit** `feat(graph-engine): space surface shading — colormaps, mesh lines, back tint, depth cue, box clipping, colorbar`.

### Task 3: The offscreen frame loop, hidden parts and OIT

**Files:** Create `gl/frameLoop.ts` and `gl/targets.ts` (MSAA FBO, resolve textures, OIT targets), plus the OIT accumulate and composite shaders and tests. Modify `gl/backend.ts` to draw through the loop.

- [ ] **Failing tests** (fake GL):
  - with the extension, the pass order is frame → opaque meshes → hidden pass (`depthFunc(GREATER)`, depth mask false) → lines, points, arrows → resolve blit → OIT accumulate → composite;
  - without the extension, there are no float targets and there are sorted blended draws;
  - resize reallocates every target and deletes the old ones;
  - `dispose` leaves zero live resources of every kind;
  - after context restore, the targets exist again.
- [ ] **Look at it:**
  - a helix threading a translucent sphere: the parts behind or inside the sphere read through it;
  - a helix passing behind an opaque saddle draws faint and dashed there;
  - two intersecting translucent surfaces show no sort popping while orbiting.
- [ ] **Prove it:**
  - remove the hidden pass → its order test fails;
  - remove the fallback branch → the no-extension test fails.
- [ ] **Commit** `feat(graph-engine): space frame loop — MSAA, dashed hidden parts, order-independent transparency`.

### Task 4: Picking and readouts (pure)

**Files:** Create `pick/pick.ts`, `pick/heightfield.ts`, `pick/bvh.ts`, `pick/refine.ts`, `pick/screen.ts`, `pick/readout.ts`, and tests. If the parametric Jacobian is missing, modify `kernel/parametric.ts` to add optional `ru`/`rv` to the parametric pick, and extend the contract type with those optional fields (ledger it).

- [ ] **Failing tests:**
  - **Graph hit.** A ray straight down through (0.3, −0.7) onto `z = x^2 − y^2` hits (0.3, −0.7, −0.4) with z exact to 1e-12. Readout ∂f/∂x = 0.6 and ∂f/∂y = 1.4.
  - **Grazing ray.** A ray that crosses a ridge twice returns the first crossing.
  - **Parametric sphere.** The unit sphere, hit along the ray from (3, 0.2, 0.1) toward the origin: `|p| = 1` within 1e-12, and the hit is on the near side (x > 0).
  - **Implicit.** `x^2 + y^2 + z^2 = 4` via F and grad gives a hit with |p| = 2 within 1e-12. (Building an implicit surface is S4; construct the pick descriptor by hand.)
  - **BVH.** It agrees with brute-force ray–triangle intersection on 200 deterministic pseudo-random rays (a seeded LCG) over a 40×40 parametric torus.
  - **Screen picks.** A curve 5 px from the cursor wins over a surface under the cursor. A point outside its tolerance does not.
  - **Readout rows** for each hit kind, with the E8 formatting.
- [ ] **Prove it:**
  - delete bisection refinement → the 1e-12 test fails;
  - delete the first-crossing rule → the ridge test fails;
  - delete the Newton refinement → the sphere test fails;
  - delete the thin-first priority → the curve-wins test fails.
- [ ] **Commit** `feat(graph-engine): space picking — exact hits on the true surface, BVH, readouts`.

### Task 5: The probe, drop lines and pins

**Files:** Create `ui/probe.ts`, `ui/pins.ts` (a pure reducer plus DOM), and `ui/interactionLayer.ts` (transient marks for markers and drop lines, drawn through the existing pipelines after the scene, excluded from the hidden pass and from clipping). Modify `SpaceRenderer.ts` for events.

- [ ] **Failing tests:**
  - the pins reducer: add, remove near a marker, and clear on Esc;
  - re-evaluation after `setValue`: a pin on `z = a*x^2` at x = 1 reads z = 2 after `a` goes 1 → 2;
  - a pin on a vanished mark is dropped;
  - drop-line geometry: from (1, 2, 3) in the box [0, 4]³ with back walls x = 0, y = 0 and floor z = 0, the feet are (1, 2, 0), (0, 2, 3) and (1, 0, 3);
  - a click versus a drag: a 5 px move is not a click.
- [ ] **Look at it:** hover a saddle and see the readout with partials; pin two points and orbit, and the pins stay attached.
- [ ] **Prove it:**
  - delete re-evaluation → the pin-follows-`a` test fails;
  - delete the click threshold → the 5 px test fails.
- [ ] **Commit** `feat(graph-engine): space probe, drop lines and pins`.

### Task 6: The parameter panel, play and drag

**Files:** Create `ui/params.ts` (DOM) and `ui/timeline.ts` (pure `valueAt`). Modify `kernel/primitives.ts` (the optional `PointMark.drag`, with `jacobian` from `diff`), `scene/types.ts` (the optional `drag` field; ledger it), and `SpaceRenderer.ts` (the panel, `setValue`, drag handling). Create `pick/drag.ts` (the pure Gauss–Newton solver).

- [ ] **Failing tests:**
  - `valueAt`: once mode at 3 s of 6 s on [0, 10] gives 5; loop at 9 s gives 5 (ping-pong: at 6 s it is 10, at 9 s it is back to 5); an integer binding at 3.2 s of 6 on [1, 30] gives round(1 + 29·3.2/6) = 16;
  - drag descriptor: `P = (a, b, a^2 + b^2)` with bindings `a`, `b` gets `drag.params = ['a', 'b']`; `A = (1, 2, 3)` gets none; a point referencing three bindings gets none;
  - drag solver: in the orthographic default view, the cursor at the projection of (1, 2, 5) from starting values (0, 0) converges to a = 1, b = 2 within 1e-6 in at most 8 iterations;
  - the clamp to range holds when the cursor is beyond the range;
  - panel coalescing: 10 slider inputs in one frame produce one `setValue` call per frame, with the last value.
- [ ] **Look at it:**
  - drag the tangent-point stand-in `P = (a, b, a^2 + b^2)` across a paraboloid; it stays on the surface;
  - play `a` in `z = a*x^2 + y^2` and watch the surface morph smoothly.
- [ ] **Prove it:**
  - delete the clamp → the range test fails;
  - delete coalescing → the one-call-per-frame test fails.
- [ ] **Commit** `feat(graph-engine): space parameters — sliders, play and loop, dragging points on surfaces`.

### Task 7: Examples and the review page

**Files:** Modify `space/examples.ts` (add, each labelled `Space · …`: `colormap: x*y diverging`, a parameterised surface with play, a draggable point on a paraboloid, a translucent sphere with a helix through it, and a pole cut by the box) and `review/src/space.tsx` (the event log panel).

- [ ] **Failing tests:** `examples.test.ts` builds every new example with no errors.
- [ ] **Look at it,** every S3 example in light and dark. List what to check.
- [ ] **Commit** `docs(graph-engine): space examples for colour, transparency, parameters and drag`.

## Verification

- All three checks clean.
- The byte-identity sweep for figure and 2D output against S3's base.
- The controller looks at every S3 example on 5182 and screenshots the saddle probe with partials, the translucent sphere with its helix, and a drag.

## Out of scope

- Implicit-surface meshing and every keyword statement (S4, S5).
- Snap views and export.
- The 2D renderer's use of `@param` (track 4).
