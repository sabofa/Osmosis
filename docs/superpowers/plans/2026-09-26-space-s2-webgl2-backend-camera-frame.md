# Space S2 — The WebGL2 Backend, Camera, Frame and Overlay

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a hand-written WebGL2 renderer that draws any `SpaceScene` inside a real chart frame.
- **Camera:** a turntable camera, orthographic by default.
- **Frame:** an axis box whose back walls flip as the camera orbits, with ticks and titles, or textbook axes through the origin.
- **Pipelines:** lit two-sided meshes, pixel-width lines with dashes, shaped points, and arrows.
- **Text:** a DOM overlay for all text.
- **Integration:** it replaces `SceneRenderer3D` in `GraphViewer`, and the old space code and its three.js dependency are deleted.
- **Review page:** `review/space.html` shows it on the review server at port 5182.

**Architecture:**
- **Pure modules** (`camera/`, `frame/`, `space/theme.ts`) compute everything testable in node.
- **`gl/`** is the only code touching WebGL. It is a small context wrapper, a program cache, and one pipeline per mark kind, uploading `Float32` positions relative to the box centre.
- **`ui/`** owns the DOM overlay and input.
- **`SpaceRenderer.ts`** orchestrates, renders on demand, and exposes `getView`/`setView`.
- **Build order.** Until S1 lands, the renderer is exercised with hand-built fixture scenes. Task 7 wires it to S1's kernel after S1 is merged into this branch.

**Tech Stack:** TypeScript, WebGL2 (GLSL ES 3.00), React only at the `GraphViewer` and review-page boundary, Vitest (node). **No new dependencies; three.js is not used by anything under `space/`.**

**Spec:** `docs/superpowers/specs/2026-09-21-graph-engine-v2-design.md`, Track 3 "Revised 2026-09-26 — space is a hand-made engine". Read SP1, SP3, SP4, SP5, SP7, SP10 and SP11. Read `docs/HANDOFF-2026-09-23-graph-engine-v2.md` first, especially lessons 1–4. **Lesson 2 is the one that bites here:** node tests cannot see WebGL or DOM bugs.

**The contract is committed. Build against it, do not redesign it:** `space/scene/types.ts`, `space/config.ts`, `space/kernel/api.ts`. S1 is being built in parallel in the `milestone-a/space` worktree, and it creates `space/frame/nice.ts` (`niceStep`, `stepFor`). **Do not create `space/frame/nice.ts` yourself.** Until the merge in Task 7, put a temporary `niceStep` in `space/frame/ticks.ts` marked `// replaced by frame/nice.ts at the S1 merge`, with the same definition: the value on the 1-2-5 × 10ⁿ ladder nearest to `span / target` in log scale, ties going to the larger.

## Global Constraints

- **No new runtime dependencies.** No three.js under `space/`. `space/gl/` is the only code that touches a WebGL context.
- **Do not edit `graph-engine/src/figure/**`.** Say "space" or "solid figures", never "3D engine" alone.
- **Shared files touched in this phase:** `GraphViewer.tsx` and `GraphViewer.css` (Task 7 only) and `review/index.html` (Task 6: one tab). Changes are additive except the sanctioned swap: **every space spec now renders through `SpaceRenderer`.** 2D and figure rendering are unchanged. Deleting `SceneRenderer3D.ts`, `buildScene3d.ts`, `types3d.ts` and their tests is sanctioned.
- **Errors are returned or shown, never thrown into React.** No WebGL2 means a legible message in the view. A shader compile or link failure is reported with the GL info log, into `onError`/the console, and never blanks the page.
- **Render on demand.** No standing `requestAnimationFrame` loop. A frame is drawn only after a scene, camera, size or theme change, or during inertia.
- **Proving a test means deleting the behaviour it covers.** Record which deletion proved which test in each commit body. Hand-compute expected values (the camera and frame tests below give them).
- **All three checks clean before every commit,** from the worktree root:
  - `npm run test --workspace=graph-engine`
  - `npx tsc -b graph-engine/tsconfig.json --noEmit`
  - `npm run lint --workspace=graph-engine`
- **Commits:** one per task, subject lowercase `type(scope): summary`, body ending EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. That is a fixed repo convention, not which model ran. Stage explicit paths only (`git add <paths>`, never `-A` or `.`). Never `git stash`. Never push.
- **Worktree:** `.claude/worktrees/milestone-a-space-gl`, branch `milestone-a/space-gl`, cut from `milestone-a/space` at the commit that added this plan. Other agents' branches, worktrees and review servers exist; leave them alone. If a file in this worktree changes under you, stop and report it.
- **Look at it.** At the end of Tasks 4, 5, 6 and 7, run the review server from this worktree (`npm run review -- --port 5182 --host 100.90.203.2`) and state in the task report what the controller should look at. Restart the server after adding modules. The controller verifies with screenshots; **do not add page scripts** for verification.

## Load-bearing decisions

**G1 — World space is the box, normalised.**
- **Box.** The author box `B` (resolved in G3) maps to world coordinates by a per-axis affine map `w = (a − c) · k`. `c` is the box centre, and `k` is chosen so the box's half-extents in world are `h = (hx, hy, hz)`, the aspect ratios (G4) normalised so `max(h) = 1`.
- **Upload.** The GPU receives `Float32Array` positions **already relative to `c`** (`a − c`, computed in Float64 then cast), and the model matrix applies `k`. That is how a surface at x ≈ 4500 keeps its precision.
- **Normals** transform by the inverse of `k`, then renormalise: `n_w = normalise(n / k)`. Non-uniform scale makes this necessary; a test pins it.

**G2 — The camera is a pure turntable** (`camera/turntable.ts`, `camera/projection.ts`).
- **State:** `SpaceView` from `space/config.ts` (azimuth and elevation in degrees, zoom, target in **author** coordinates).
- **Direction.** The eye direction from the target is `d = (cos el · cos az, cos el · sin az, sin el)` in world axes. Up is world +z.
  - Screen right is `normalise(−d_y, d_x, 0)`, which is `(−sin az, cos az, 0)`.
  - Screen up is `right × (−d)`.
- **Projection.**
  - **Orthographic:** half-height `H = R / zoom`, where `R` is the radius of the box's bounding sphere in world (`|h|`) times 1.35, a margin for tick labels.
  - **Perspective:** vertical field of view 30°, and a distance that fits the same sphere, divided by `zoom`.
  - **Clipping:** near and far planes bracket the sphere with a margin. There is never a fixed `0.1 … 1000`.
- **Functions.** Pure functions return 4×4 `Float32Array` matrices (column-major, GL convention): `viewMatrix`, `projectionMatrix`, `viewProjection`, `project(p) → { x, y, depth }` in CSS pixels, and `rayAt(px, py) → { origin, direction }` in world coordinates.
- **Input mapping** lives in `camera/controls.ts`, as pure reducers over `SpaceView`:
  - `orbit(view, dx, dy)` turns 0.4° per pixel, clamps elevation to ±89.5°, and wraps azimuth to (−180, 180]. Dragging right **decreases** azimuth and dragging down **increases** elevation, so the content turns with the cursor, as if grabbed.
  - `pan(view, dx, dy, viewport)` moves the target so the point under the cursor follows it.
  - `zoomAt(view, factor, px, py, viewport)` keeps the author point under the cursor fixed in orthographic projection, and dollies toward it in perspective. One wheel notch is ×1.1, and zoom is clamped to [0.05, 50].
  - `reset(authored)`.
- **Inertia.** A release of an orbit drag continues it with exponential decay (τ = 120 ms, stopping below 0.02°/frame). It is disabled under `prefers-reduced-motion`.

**G3 — Bounds** (`frame/bounds.ts`: `resolveBox(space: SpaceConfig, extent: Box3 | null): Box3`).
- **Authored first.** Any `@bounds3d` axis wins, exactly as written, with no rounding.
- **Data next.** Otherwise the axis comes from `extent`, rounded outward to multiples of `niceStep(span, 8)`.
- **No data:** [-5, 5] on each axis.
- **Degenerate spans.** A span with `max − min < 1e-9 · max(1, |max|, |min|)` becomes `[v − s, v + s]`, where `s` is half the largest non-degenerate span among the other axes, or 1 if they are all degenerate. It is then rounded like the others.

**G4 — Aspect** (`frame/aspect.ts: boxHalfExtents(box, aspect: Aspect | null, scene: SpaceScene): [hx, hy, hz]`).
- `equal` gives half-extents proportional to the spans.
- `auto` gives (1, 1, 0.7).
- A ratio gives the ratio itself.
- **All three** are normalised so the maximum is 1.
- **When `aspect` is null**, choose `equal` if no `MeshMark` has `pick.kind === 'graph'` and the largest span is at most 4× the smallest; otherwise `auto`. This is the spec's SP5 default rule; state it in a comment.

**G5 — The box frame** (`frame/box.ts: boxFrame(box, halfExtents, view): FrameModel`).
- **Back walls.** The x-wall is at `x = min` when `d_x > 0`, else `x = max`. The same holds for y. The floor is at `z = min` when `d_z ≥ 0`, else `z = max`.
- **Gridlines** run on each back wall at the tick values of that wall's two axes.
- **Wall outlines** are drawn in `gridStrong`, gridlines in `grid`.
- **Tick edges.**
  - **x ticks** run along the x-parallel edge at `z` = the floor and `y` = the **front** (`max` when `d_y > 0`, else `min`).
  - **y ticks** run along the y-parallel edge at the floor and the front `x`.
  - **z ticks** run along the vertical edge whose projected x is **smallest** (leftmost on screen), with ties broken toward the front.
- **Tick labels** anchor at the tick's projected position, pushed outward, perpendicular to the edge on screen and away from the projected box centre, by 10 px plus half the label's estimated extent.
- **Thinning.** If adjacent labels on an edge would overlap (widths estimated as `0.6 × fontSize × chars`), keep every 2nd, then every 3rd, and so on, always keeping the ones at the edge's ends when they fall on ticks.
- **Axis titles** sit at the edge midpoint, beyond the labels.
- **`FrameModel`** is `{ lines: { a: Vec3, b: Vec3, role: 'wall' | 'grid' | 'tick' | 'axis' }[], labels: { position: Vec3, screenOffset: [dx, dy], text: string, role: 'tick' | 'title' }[] }`, in **author** coordinates. It is pure and tested.

**G6 — The axes frame** (`frame/axes.ts: axesFrame(box, halfExtents, view): FrameModel`).
- **Axes** run through the origin, each clamped into the box when the origin lies outside it.
- **Each axis** runs from the box min to 8% beyond the box max, with an arrowhead there (role `'axis'`, drawn by the arrow pipeline) and its letter (the `@titles` text) beyond the tip.
- **Ticks** are short and perpendicular to the axis, in the plane that faces the camera best. Labels are small, skip the origin, and use the same thinning.
- **`@frame: none`** produces an empty model.

**G7 — Tick values and their text** (`frame/ticks.ts`).
- **Values.** `ticks(range, step)` returns every `k · step` within the range, inclusive with a 1e-9 relative tolerance, computed as `k * step` and never by accumulation.
- **`formatTick(value, step: TickStep | null, stepValue)`:**
  - **π-multiples** print when `step.pi` is set: `π/2`, `π`, `3π/2`, `2π`, `−π/2`, `0`. The multiple `k · num/den` is reduced by gcd, and a coefficient of 1 is omitted.
  - **Decimals** otherwise, with exactly as many as the step's own decimal representation needs: 0.25 → 2, 0.2 → 1, 5 → 0. Trailing-zero noise is never printed.
  - **Minus** is U+2212.
  - **Large and small steps.** When `|step| ≥ 1e5` or `|step| < 1e-4`, print `m×10ⁿ` with superscript digits (`2×10⁵`), `0` stays `0`.
- **Exactness.** π-multiples come **only** from `step.pi` (structural, never inferred).

**G8 — Colours** (`space/theme.ts`, pure).
- **`resolveSpaceColor(spec: ColorSpec, palette: Palette, theme): [r, g, b]`** returns linear floats in 0..1 for the shader. The shader does no gamma; the default framebuffer is sRGB-display, so resolve to the sRGB values and draw them as-is. Say this in a comment.
- **Author colours** go through `parser/colors.ts`.
- **Slot 0** is `palette.curve`, the accent.
- **Slots 1–7** are a fixed categorical series per theme, chosen to be distinguishable from each other and from the accent on the palette's backgrounds.
  - Light: `#2f6f9f`, `#4c7a4a`, `#8a4fa3`, `#b8860b`, `#1f8a8a`, `#a34b3f`, `#5b5b52`.
  - Dark: `#6fa8d6`, `#6fa06c`, `#b98ad0`, `#e0b64a`, `#4fc1c1`, `#c76a5c`, `#a8a597`.
- **Wrap.** Slots past 7 cycle through 1–7.
- **The frame** uses `axis`, `grid` and `gridStrong`, and the clear colour is `background`.

**G9 — The GL layer** (`gl/`).
- **Context.**
  - `gl/context.ts` gets `webgl2` with `{ antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false }` and reports missing WebGL2.
  - It handles `webglcontextlost` (with `preventDefault`) and `webglcontextrestored`, recreating every program and buffer from the retained scene and frame.
  - `EXT_color_buffer_float` is queried and recorded for S3's OIT; it is unused in S2.
- **Programs.** `gl/program.ts` compiles and links. On failure it throws a `ShaderError` carrying the info log, caught at the renderer boundary. Programs are cached per pipeline.
- **Buffers** (`gl/buffers.ts`).
  - Uploading a mark creates its VAO and buffers. Positions are Float32, relative to the box centre (G1).
  - The mark is keyed by **object identity**, so a scene whose unchanged marks are the same objects (S1's `setValue` guarantee) re-uploads nothing for them.
  - Replacing a scene deletes the GPU resources of every mark not in the new scene.
- **Pipelines,** one each:
  - **Mesh** (`gl/meshPipeline.ts`).
    - Lighting is Blinn–Phong in view space: a key light from the upper left front, a fill light at about 30% from the opposite side, ambient about 0.25, and specular about 0.15 with shininess 24.
    - Back faces flip their normal (`gl_FrontFacing`), so both sides are lit correctly. S3 adds the back-face tint and colormaps.
    - Opacity below 1 draws in a second pass: depth-write off, blended, marks sorted back to front by centroid depth. This is the fallback S3's OIT replaces.
  - **Lines** (`gl/linePipeline.ts`). One instanced quad per segment, expanded in screen space in the vertex shader to `width` CSS px × `devicePixelRatio`.
    - Round caps come from the quad being extended by half a width at each end, with the fragment shader discarding outside the capsule. Consecutive segments therefore join round.
    - Depth uses the segment's own depth, minus a small bias (1e-5 in NDC z), so lines on surfaces win.
    - **Dashes** use a per-vertex **cumulative screen-space length** attribute, recomputed on the CPU when the camera, size or scene changes, **only for marks with `dash !== null`**, which keeps it cheap. A mark over 50,000 vertices instead falls back to a per-segment dash phase. S3's hidden-part pass reuses this attribute.
  - **Points** (`gl/pointPipeline.ts`). Instanced screen-aligned quads of `size` px, with the shape drawn by a signed distance in the fragment shader (dot, ring, cross, diamond, square) and antialiased. They are depth-tested at the point's depth.
  - **Arrows** (`gl/arrowPipeline.ts`).
    - The shaft is a line with `shaftWidth`, drawn by the line pipeline.
    - The head is a screen-space isosceles triangle of `headSize` px at the tip, pointing along the projected direction.
    - When the projected length is shorter than `headSize`, which means the vector points at the viewer, the head becomes a ring of `headSize` px. That is the textbook "vector out of the page".
  - **Boxes** are not drawn in S2. A `BoxMark` is skipped with one console warning per scene; S5 adds its pipeline.
- **Frame drawing.** The frame's lines are drawn through the line pipeline (1 px grid, 1.5 px walls and ticks). Axis-frame arrowheads go through the arrow pipeline. The frame is drawn **before** the marks.

**G10 — The overlay** (`ui/overlay.ts`, `ui/SpaceView.css`).
- **One layer.** A single absolutely positioned `div` covers the canvas, and each label is a `span` from a keyed pool.
- **Positioning.** Every frame, each label is positioned with `transform: translate(x, y)`, from `project()` plus its `screenOffset`. A label outside the viewport is hidden.
- **Sources.** Tick labels and titles come from the `FrameModel`; point labels come from `scene.labels`, offset up-right by 6 px.
- **Font.** Inherited from the host at 12 px for ticks, 13 px for titles and labels, with `font-variant-numeric: tabular-nums`.
- **Pointer events** are off on the overlay (`pointer-events: none`), so the canvas receives input.
- **Contract with `GraphViewer`.** The renderer creates the overlay as a sibling of the canvas inside the canvas's parent element, requires that parent to be `position: relative` (Task 7 sets this in `GraphViewer.css`), and removes the overlay in `dispose()`.

**G11 — `SpaceRenderer`** (`space/SpaceRenderer.ts`).
```ts
class SpaceRenderer {
  constructor(canvas: HTMLCanvasElement, options: {
    palette: Palette; theme: 'light' | 'dark'
    onError?: (message: string) => void
    onContextLost?: () => void
    onViewChange?: (view: SpaceView) => void
  })
  setScene(scene: SpaceScene, config: GraphConfig): void   // resolves box, aspect, frame; uploads; draws
  setSpec(statements: Statement[], config: GraphConfig, lines: readonly number[]): SceneError[]   // Task 7: builds the kernel, then setScene
  setPalette(palette: Palette, theme: 'light' | 'dark'): void
  getView(): SpaceView
  setView(view: SpaceView): void
  dispose(): void
}
```
- **The initial view** comes from `config.space.camera`, with the target at the box centre.
- **Double-click** returns to that authored view.
- **Keyboard,** when the canvas has focus (`tabIndex = 0`): the arrow keys orbit 5°, `+`/`-` zoom, `0` resets.
- **`ResizeObserver`** tracks the canvas's CSS size. The backing store is CSS size × `min(devicePixelRatio, 2)`.

---

### Task 1: The camera (`space/camera/`)

**Files:** Create `camera/mat4.ts` (only what is needed: multiply, invert, lookAt, ortho, perspective, and transforming a point), `camera/turntable.ts`, `camera/projection.ts`, `camera/controls.ts`, and tests.

**Interfaces:**
- Produces `eyeDirection(view)`, `screenBasis(view) → { right, up, forward }`, `cameraMatrices(view, halfExtents, viewport, projection) → { view, proj, viewProj, invViewProj }`, `project(matrices, p) → { x, y, depth }`, `rayAt(matrices, px, py)`, and `orbit`/`pan`/`zoomAt`/`reset`.
- `Viewport = { width, height }` in CSS px.

- [ ] **Failing tests** (hand-computed):
  - **Screen right.** At azimuth 40°, elevation 25°, screen right = (−sin 40°, cos 40°, 0) = (−0.6427876, 0.7660444, 0).
    - Projected, relative to the origin's projection: world +x moves left (negative screen x), +y moves right, and +z moves up (negative CSS y).
    - Orthographic, equal half-extents: the ratio of screen-x displacements of unit +x and unit +y is −0.6427876 / 0.7660444 = −0.8390996.
  - **Elevation 90** clamps to 89.5 in `orbit`, and the basis stays finite and orthonormal.
  - **Round trip.** `rayAt` of the projection of (0.3, −0.2, 0.5) passes within 1e-9 of that point, in both projections.
  - **Zoom about the cursor.** `zoomAt` in orthographic keeps the author point under the cursor fixed: project it before and after, and the result is equal to within 1e-9 px.
  - **Pan.** `pan` by (+50, 0) px moves the projection of the target by −50 px, so the content follows the cursor.
  - **Azimuth wrap.** Orbiting 400 px right from azimuth 170 gives azimuth wrapped into (−180, 180].
- [ ] **Prove it:**
  - swap the sign of right → the +x-is-left test fails;
  - delete the elevation clamp → the basis test produces NaN.
- [ ] **Commit** `feat(graph-engine): space camera — turntable, projections, rays, zoom about the cursor`.

### Task 2: The frame (`space/frame/`)

**Files:** Create `frame/bounds.ts`, `frame/aspect.ts`, `frame/ticks.ts` (ticks, `formatTick`, and the temporary `niceStep`), `frame/box.ts`, `frame/axes.ts`, `frame/types.ts` (`FrameModel`), and tests.

**Interfaces:** Produces `resolveBox`, `boxHalfExtents`, `ticks`, `formatTick`, `boxFrame`, `axesFrame`, `FrameModel`.

- [ ] **Failing tests:**
  - **`resolveBox`:**
    - extent x [−0.3, 2.7] gives x [−0.5, 3], with `niceStep(3, 8)` = 0.5 (nearest in log scale to 0.375);
    - `@bounds3d x [-3, 3]` is kept exactly;
    - no extent gives [−5, 5]³;
    - a degenerate z at 0, with x and y spans of 4, gives z [−2, 2].
  - **`boxHalfExtents`:**
    - `equal` with spans (4, 2, 1) gives (1, 0.5, 0.25);
    - `auto` gives (1, 1, 0.7);
    - `1:1:0.5` gives (1, 1, 0.5);
    - null with a graph surface gives auto;
    - null with only a parametric sphere, spans (2, 2, 2), gives equal (1, 1, 1);
    - null with spans (10, 1, 1) and no graph surface gives auto.
  - **`ticks`:** [0, 1] step 0.1 yields 11 values, the last exactly 1 (computed as `10 * 0.1`, which is 1 in doubles). [−π, π] step π/2 yields 5 values.
  - **`formatTick`:**
    - 0.25 with step 0.25 → `0.25`;
    - 0.5 with step 0.25 → `0.50`. Decimals come from the step, as matplotlib does, so a column of labels has a consistent width;
    - 3 with step 1 → `3`;
    - −2 → `−2` (U+2212);
    - π/2 with pi step {1, 2} → `π/2`; 3π/2 → `3π/2`; −π → `−π`; 0 → `0`;
    - 200000 with step 100000 → `2×10⁵`.
  - **`boxFrame` at azimuth 40, elevation 25** over the box [−1, 1]³ with equal extents:
    - the back walls are x = −1, y = −1, z = −1;
    - x ticks lie on the edge y = +1, z = −1;
    - y ticks lie on the edge x = +1, z = −1;
    - z ticks lie on the vertical edge x = +1, y = −1 (projected screen x of the four vertical edges is −0.643x + 0.766y, and the minimum is at (1, −1));
    - every tick label's anchor plus its offset lies outside the projected box hull.
  - **`boxFrame` at azimuth 130:** back walls x = +1, y = −1.
  - **Looking from below** (elevation −30): the floor is z = +1.
  - **Thinning:** 41 ticks on a 300 px edge get thinned, and the first and last survive.
  - **`axesFrame`:** the origin inside the box gives three axes through (0, 0, 0). With the origin outside, x ∈ [2, 5], the axes run at x = 2.
- [ ] **Prove it:**
  - delete the wall flip (always min) → the azimuth-130 test fails;
  - delete the leftmost-edge choice → the z-edge test fails;
  - delete the step-derived decimals → `0.50` becomes `0.5`.
- [ ] **Commit** `feat(graph-engine): space frame — bounds, aspect, ticks, flipping walls, textbook axes`.

### Task 3: The GL core, colours, and the mesh pipeline (`space/gl/`, `space/theme.ts`)

**Files:** Create `space/theme.ts`, `gl/context.ts`, `gl/program.ts`, `gl/buffers.ts`, `gl/meshPipeline.ts`, `gl/shaders/mesh.ts` (GLSL as template strings), `gl/fakeGl.ts` (test helper), `gl/backend.ts` (`GlBackend`: owns the context, programs and per-mark resources; `setScene`, `setFrame`, `draw(matrices, viewport)`, `dispose`), and tests.

**Interfaces:**
- **`GlBackend`:**
  ```ts
  constructor(canvas, { onError, onContextLost, onContextRestored })
  setScene(scene, boxCentre, halfExtents, colors)
  setFrame(frame, colors)
  draw(camera)
  dispose()
  ```
  where `colors` is the resolved palette in G8's form.
- **`resolveSpaceColor`** and `FAKE_GL`, from `gl/fakeGl.ts`.

- [ ] **The recording fake context,** `gl/fakeGl.ts`. It implements every `WebGL2RenderingContext` member the backend calls, returning handles such as `{ id: n }`. It records `create*`, `delete*`, `bufferData` sizes, `useProgram`, `drawArrays*` and `drawElements*` calls. It can simulate context loss (`isContextLost() → true`; subsequent calls are recorded as errors) and restoration.
- [ ] **Failing tests:**
  - **Colours:**
    - slot 0 resolves to `palette.curve`;
    - slot 3 in light resolves to `#8a4fa3`;
    - slot 9 wraps to slot 2;
    - `author: 'purple'` resolves to the parser's purple.
  - **Upload:**
    - a mesh mark with 4 vertices and 2 triangles uploads Float32 positions equal to `position − boxCentre`, checked on one vertex at x = 4500.25 with centre 4500 → 0.25 exactly;
    - uploads 6 indices;
    - the normal transform: a normal (0, 0, 1) with half-extent scale k = (1, 1, 0.5) stays (0, 0, 1). A normal normalise(1, 0, 1) with the same k becomes normalise(1, 0, 2).
  - **Identity reuse:** `setScene` twice with the second scene sharing one mark object and replacing another → exactly one new buffer set is created, and exactly one is deleted.
  - **`dispose()`:** every created program, shader, buffer, VAO and texture has been deleted (created − deleted = 0 per kind).
  - **Context loss:** after simulated loss there are no draw calls. After restoration, programs and buffers are recreated for the current scene, and a draw issues the same number of draw calls as before the loss.
  - **Shader failure:** a failed compile surfaces through `onError` with the info log, and `draw` becomes a no-op without throwing.
- [ ] **Prove it:**
  - delete the deletion of stale marks in `setScene` → the reuse test fails;
  - delete the restore path → the context-loss test fails;
  - delete the centre subtraction → the 4500.25 test fails.
- [ ] **Commit** `feat(graph-engine): space GL core — context, programs, buffers, lit two-sided meshes, colours`.

### Task 4: Lines, points, arrows, and the frame drawn (`space/gl/`)

**Files:** Create `gl/linePipeline.ts`, `gl/pointPipeline.ts`, `gl/arrowPipeline.ts`, `gl/shaders/*.ts`, `gl/dash.ts` (cumulative screen length, pure), and tests. Wire `setFrame` into `GlBackend`.

**Interfaces:**
- Produces `cumulativeScreenLength(positions, starts, project) → Float32Array`, which is pure.
- The pipelines' upload and draw functions are used by `GlBackend`.

- [ ] **Failing tests:**
  - **Dash lengths.** `cumulativeScreenLength` on a polyline (0,0,0) → (1,0,0) → (1,1,0), under a projection that maps world units to 100 px, gives [0, 100, 200]. It restarts at 0 for each polyline in `starts`.
  - **Line uploads.** The line pipeline, via the fake GL, uploads one instance per segment: a 513-vertex curve is 512 instances, and 2 polylines of 3 vertices are 4 instances, with no segment bridging the two polylines.
  - **Arrow head as ring.** `arrowHeadKind(projectedLength, headSize)` returns `'ring'` below `headSize` and `'triangle'` otherwise.
  - **Frame drawing.** The frame's grid lines all go through the line pipeline, and draw order puts the frame before the marks (assert the order of draw calls in the fake).
- [ ] **Look at it.** Temporarily mount a fixture in the review page (Task 6 formalises this): a helix, a few points of each shape, arrows including one pointing at the camera, and a dashed segment. Report what to look for.
- [ ] **Prove it:**
  - delete the per-polyline restart → the dash test fails;
  - delete the `starts` split → the bridging test fails.
- [ ] **Commit** `feat(graph-engine): space lines, points and arrows — pixel widths, round joins, dashes, shapes`.

### Task 5: The overlay, input, and `SpaceRenderer`

**Files:** Create `ui/overlay.ts`, `ui/labelPool.ts`, `ui/input.ts` (pointer, wheel, touch, keyboard → `controls.ts` reducers), `ui/SpaceView.css`, and `space/SpaceRenderer.ts` (without `setSpec` yet). Tests go against the pure parts. `ui/layout.ts` computes which labels show and where, from the frame model, scene labels and camera. The DOM application stays a thin loop.

**Interfaces:**
- Produces `SpaceRenderer` per G11, except `setSpec` (Task 7).
- `layoutLabels(frame, sceneLabels, matrices, viewport) → { key, text, x, y, role, visible }[]`, which is pure.

- [ ] **Failing tests** (pure):
  - `layoutLabels` hides a label whose anchor projects outside the viewport;
  - it keeps keys stable across two camera positions, so the pool reuses spans;
  - it offsets point labels by (6, −6) px.
  - The input reducers: a synthetic sequence of pointer down/move/up with (dx, dy) = (10, 0) takes azimuth from 40 to 36. The wheel with `deltaY < 0` zooms in.
- [ ] **Render on demand.** Assert that `SpaceRenderer` requests a frame only after a change. Use a stubbed `requestAnimationFrame` counter in a test that constructs the renderer with the fake GL and a minimal fake canvas and parent. If constructing it in node proves impractical, make the scheduler an injected dependency and test the scheduler alone.
- [ ] **Look at it** on the review page: orbit, pan, zoom about the cursor, double-click reset, the walls flipping as you orbit past each face, and tick labels that never overlap.
- [ ] **Prove it:** delete the viewport check in `layoutLabels` → its test fails.
- [ ] **Commit** `feat(graph-engine): space overlay, input and SpaceRenderer — labels, orbit/pan/zoom, render on demand`.

### Task 6: The review page (`review/space.html`)

**Files:** Create `review/space.html`, `review/src/space.tsx`, `review/src/spaceFixtures.ts` (hand-built `SpaceScene`s until Task 7), and `review/src/space.css`. Modify `review/index.html`: one tab, "Space", pointing at `space.html`, alongside the existing ones, following the file's own pattern.

**The page:**
- A full-height space view on the right.
- On the left, a list of examples (fixtures now; `SPACE_EXAMPLES` plus the old `3D` example after Task 7) and a spec textarea. The textarea does nothing until Task 7, and is labelled so.
- A theme toggle (light/dark).
- The current `SpaceView` printed small, so the controller can report a camera position.

**The fixtures,** built with small helpers that fill the typed arrays:
- a saddle mesh on [−2, 2]² with its height as `scalars`;
- a unit sphere (parametric), translucent at 0.6;
- a helix line;
- points of every shape;
- arrows along the axes, plus one at the camera;
- a dashed segment;
- a mesh at x ≈ 4500 (the precision case);
- a scene with both a big surface and small arrows under `@frame: axes`.

- [ ] **No new tests** beyond `tsc` and lint. This is a page.
- [ ] **Look at it:** start the server on 5182 from this worktree and report which fixture shows what.
- [ ] **Commit** `feat(review): the space review page on the shared harness`.

### Task 7: Integration with the kernel (after S1 is merged)

**Precondition:** S1's seven tasks are committed on `milestone-a/space`. The controller merges `milestone-a/space` into `milestone-a/space-gl` (resolving only `space/frame/ticks.ts`'s temporary `niceStep` in favour of `frame/nice.ts`) before this task starts.

**Files:**
- **Modify** `space/SpaceRenderer.ts`: `setSpec` builds `createSpaceKernel(statements, config, lines)` and calls `setScene`. It returns the scene's errors.
- **Modify** `GraphViewer.tsx`: the `'3d'` branch constructs `SpaceRenderer`, calls `setSpec(parsed.statements, parsed.config, parsed.statementLines)`, and reports `[...parsed.errors, ...errors]`. Hover for 3D is dropped until S3 (the readout returns there), so `HoverInfo3D` goes.
- **Modify** `GraphViewer.css`: the canvas parent is `position: relative`.
- **Delete** `scene/buildScene3d.ts`, `render/SceneRenderer3D.ts`, `scene/types3d.ts` and their tests. Update any importer (`App.tsx` and others: grep).
- **Modify** `review/src/space.tsx`: the example list is `SPACE_EXAMPLES` plus `EXAMPLES`' `3D`, and the textarea is live.

- [ ] **Failing tests:** a test that `GraphViewer`'s 3D branch no longer imports `three`: extend S1's boundary test with a check that `GraphViewer.tsx` does not import `SceneRenderer3D` or `buildScene3d`, and that those files do not exist. `examples.test.ts` already builds every space example through the kernel (S1 Task 7).
- [ ] **Look at it.** Every space example on the review page, in light and dark:
  - the paraboloid over a disk has a clean circular edge;
  - the type I region's edges lie on y = x² and y = x;
  - `@frame: axes` reads like a textbook figure;
  - the π ticks read `π/2`, `π`;
  - the old `3D` example (surface, sphere, helix, point, segment, ray) looks strictly better than before.
- [ ] **Prove it:** restore the `SceneRenderer3D` import in `GraphViewer.tsx` → the boundary test fails.
- [ ] **Commit** `feat(graph-engine): space renders every 3D spec — SpaceRenderer replaces SceneRenderer3D`.

## Verification

- All three checks clean. `git grep -n "three" graph-engine/src/space` finds nothing.
- **The byte-identity sweep for everything not space:**
  - every figure-mode example's `renderFigure` SVG is identical to the merge base under every `@view`;
  - 2D graph scenes (`buildScene`) for every 2D example are identical.
- **The controller looks at the review page on 5182** and records screenshots of three things: the `3D` example, a paraboloid over a disk, and `@frame: axes`.

## Out of scope

- Colormap LUTs and the colorbar, mesh lines, the back-face tint, box clipping, the hidden-part dashed pass, OIT and depth cueing (S3).
- Probing, pins, drop lines, the parameter panel, drag and events (S3).
- Box marks (S5), and implicit surfaces and keyword vocabulary (S4, S5).
- Snap views and export (owned by the document-format work).
- Moving the 2D plot renderer off three.js.
