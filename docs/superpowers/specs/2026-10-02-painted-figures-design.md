# Painted figures: the painter style, the paint lab, and integration

Status: approved by Ben on 2026-10-02 ("go, lets use that formula and general spec to create the final output").
Branch: `milestone-a/paint`, off `milestone-a/main` d1a8ef4.

## 1. Purpose

Ben is a painter. He wants figures painted the way a human oil painter paints them. The space engine (3D) comes first, and the 2D figures follow.

He settled the look over four mockup rounds. The reference implementation is the throwaway mockup in the session scratchpad:
- `scratchpad/paper-mockups/painted-figure.html`
- its sources `src/{paint-math,painter,mix,edges,figures,figures2,paint-page}.js`

The mockup's numbers are the starting defaults in this spec.

Two milestones:
- **M1, today: the Paint Lab.** A fully 3D viewing window where Ben orbits real figures and tunes every parameter with sliders, on his own time. His final tune is saved as data.
- **M2, after his tune: integration.** `@style: paint` renders through the space engine, with the shared paper generator in both engines, plus the hand-drawn styles for space. M2 gets its own plans. Section 10 outlines it.

## 2. Decisions (Ben's, verbatim where it matters)

1. **Paint the figure, not the background.** The ground is primed canvas. The oil-painted grounds were dropped.
2. **The process, in order:**
   1. "find the values of the figure": a value plan;
   2. "assign the lighting curve": the hue, saturation and luminance change over value, "not very randomized but not perfect";
   3. "find the object's colour", accounting for "colours that change midway through";
   4. "a variety of stroke types… not randomized but a little different… replicate human painting".
3. **Lighting lives inside the colour.** The local colour is transformed by the curve. Nothing may look painted on top.
4. **Edging.** Edges are hard, firm, soft or lost, chosen by a painter's logic, and form is built from "many gradients, not one". Strokes are distinct or blended depending on where they sit, and this must generalise to complicated shapes.
5. **Colour distortion = a fresh paint mix per brush load.** Within one base colour, each load is mixed slightly differently: a different hue at the same value, or a different hue and lightness at the same value. Default strength is medium. Regional temperature (warm light, cool shadow, bounce, sky) is secondary.
6. **Orbit.** Strokes ride the surface, the light follows the camera, density holds on screen, and the canvas stays fixed.
7. **Fully 3D tuning window**, with sliders and controls, then full integration.
8. **Everything is reversible.**

## 3. The painting model

The model is pure TypeScript in `graph-engine/src/space/paint/model/` and is renderer-independent. Its input is a space kernel scene: `parseSpec` → `createSpaceKernel(...).scene()`, giving MeshMarks (positions, normals, uv, scalars and colorScale), LineMarks, PointMarks and ArrowMarks. Its output, per frame, is a list of stroke instances for the GL layer.

### 3.1 Particles (anchoring)
- **Placement.** Each mesh gets seeded blue-noise particles (area-weighted Poisson disc) at a maximum density `density.max` per unit of world area, computed once per scene and parameter set.
- **Particle fields:** world position, normal, a tangent frame (from uv derivatives where uv exists, otherwise the principal-curvature direction estimated from the normals), local colour (the flat colour, or the colormap value at the interpolated scalar), a seeded rank `r ∈ [0, 1)`, a surface cell id (a 3D hash of position at `load.cell` world units), and a per-particle seed.
- **Seeding.** Every random number comes from FNV-1a(identity) → mulberry32, keyed by surface position and role. Never use `Math.random`, and never key on a frame or on time.

### 3.2 View selection (per frame)
- **Visibility:** test against the G-buffer depth.
- **Constant screen density:** draw a particle when `r < density.target × screenAreaFactor`, where the foreshortening factor uses |n·v|.
- **Silhouette fade:** strokes fade out over |n·v| ∈ [`fade.lo`, `fade.hi`].
- **Coherence target:** at least 80% of strokes are retained between views 12° apart. The mockup measured 212 of 256.

### 3.3 Lighting and the value plan
- **Lights:**
  - The key light is camera-relative: `light.azimuth` and `light.elevation` relative to the view direction. The mockup uses upper left.
  - Ambient, plus a sky term on up-facing normals and a bounce term on down-facing normals.
  - A shadow map from the key light gives cast and self shadow.
- **Value.** `u` is in 0..1 and is grouped into five zones: light, half-tone, core shadow, reflected light and cast shadow. The structure of the plan (two families, the terminator, the soft turns) is §12, which supersedes the soft boundaries `value.soft` and the reflected ramp below.
- **Mockup defaults:**
  - half-tone ramp at u 0.52–0.72;
  - light ramp at 0.85–0.94;
  - plateaus: core 0.24, cast 0.32 (the reflected light is capped by §12);
  - a smooth seeded deviation of up to ±0.018.

### 3.4 Lighting curve (OKLCH)
With local colour (lc, cc, hc) and value u:
- `L = lc + 0.80·(u − 0.62) + dL(u)`
- `C = cc · (0.42 + 0.88·exp(−((u − 0.50)/0.25)²)) · (1 + dC(u))`. This is a bell that peaks in the half-tones.
- **H:**
  - **Base swing, relative to the local colour and capped (Ben, 2026-10-02: "a terracotta should have dark reds but nothing close to purple"):** `H = hc + clamp(k·|s|·arc(hc → 75° warm if s > 0, or 280° cool if s < 0), ±shiftMax)`, with `s = clamp((u − 0.5)/0.4, −1, 1)`, k_warm 0.40, k_cool 0.46 and `curve.shiftMax` 12° (slider 0–60, "Max hue shift (°)"). A colour moves toward its own warmer or cooler neighbour by at most `shiftMax`; it used to be pulled toward the ABSOLUTE 280°, which took a terracotta (38°) to about 345° in its shadows.
  - **Half-tone accent:** a clamped arc toward 95°, up to ±18°.
  - **Plane steps:** `10°·sin + 6°·sin`, so neighbouring planes differ by 8–20°.
  - **Tints, with L never touched:** a warm/cool OKLab tint of 0.018 or 0.022, a sky tint of 0.030 at 250° on up-facing normals, and a bounce tint of 0.034 at 68° on down-facing normals. These, the environment's absorption and the reflected-light mix keep the final hue within `shiftMax` + 3° of where the colour's own hue and its deliberate offsets (accent, plane step, deviation, the hue curve) put it, at every value: the hue is turned back, L and C are kept. A grey (local chroma under 0.005) has no hue to keep and takes the tints whole; the hold fades in to full strength by local chroma 0.02 (a muted terracotta of chroma 0.03 to 0.04 has a hue to keep). A colormapped colour keeps a third of the capped swing and of the hold's reach. The cap bounds the light-to-shadow swing only: the brush-load mix (§3.5, hue ±12–25°) varies hue on top of it, and so do the planes' hue steps (±16°); that is the colour distortion, by design.
- **Reflected light** mixes the bounce colour up to 0.55.
- **Smooth seeded deviation:** L ±0.010, 0.006 and 0.004; C ±6%, 4% and 2.5%; H ±2.2°, 1.4° and 0.8°.
- **Colormapped surfaces:** hue rotation and tints ×1/3. The colorbar is unchanged.

### 3.5 Brush-load mixing (colour distortion)
- **Loads.** A load is 3–8 consecutive strokes of one role in painting order. It breaks when the next stroke is more than 120 px away, and it is seeded per load. During orbit, loads are keyed to `load.cell` (0.5 world units) surface cells, so a stroke keeps its mix.
- **Per-load offset**, around the curve colour at that stroke:
  - hue ±12–25°, scaled by strength;
  - chroma ×0.7–1.35;
  - L held within ±0.012 of the target;
  - 25% of loads also take a value step of ±0.03.
- **Greys.** Below chroma 0.03–0.07, the offset is an a/b vector of 0.012–0.026 toward warm, cool, green-grey or violet-grey.
- **Anti-correlation.** Neighbouring loads flip the hue sign with probability 0.8 and the chroma direction with 0.75. The grey family steps to its opposite.
- **Drift.** Within a load, the offset fades to 45% by the last stroke.
- **Strength.** The master strength is 1.0 (medium; subtle is 0.45, strong is 1.5). Per role: block 1.0, form 0.7, scumble 0.85, glaze 0.6, line marks 0.75, edges 0.5, dabs 0.4.
- **Colormapped surfaces:** hue and chroma offsets ×1/3, and L at most ±0.004.

### 3.6 Planes and edge control
- **Planes.** Planes are cells of quantised normal direction (26° lat-long cells, with longitude widened near the poles) × value zone. Pieces under 70 px merge into their largest neighbour of the same value family (§12); a piece with none is kept. A stroke's value is the plane mean plus 0.45 of its own gradient. This gives many gradients, not one.
- **Edge hardness at a transition.** `H = Σ wᵢ·termᵢ`, with terms in 0..1:

  | term | meaning | internal | silhouette | shadow |
  |---|---|---|---|---|
  | c | value contrast | .32 | .52 | .36 |
  | k | curvature (the angle between normals 4 px either side) | .22 | .08 | .08 |
  | f | focal: exp(−(d/R)²) around the terminator point nearest the viewer and the brightest point, with R = 0.55·√(area/π) | .26 | .14 | .06 |
  | s | light side | .10 | .08 | .08 |
  | d | depth | .10 | .18 | .12 |
  | x | distance from the occluder (shadows only) | – | – | .30 |

  Smoothing and thresholds:
  - Contrast c uses smooth(0.04, 0.34) at outlines and shadows, and smooth(0.06, 0.60) inside a form.
  - Curvature k uses smooth(0.010, 0.060).
  - Shadow distance x is `1 − smooth(8, 110, px)`.
  - Add 0.12 × seeded noise along the edge, and take the median of 7 samples.
  - Force LOST when contrast is under 0.03.
  - An edge between a light-family plane (light, half-tone) and a form-shadow plane (core, reflected light) is the terminator's: its score is scaled by `clamp(0.1 / value.terminatorSoftness, 0.2, 1)` (§12). The scale is exactly 1 at the default 0.1 and for any crisper terminator, a third at 0.3 and a fifth from 0.5: a soft terminator's edges are soft or lost. A turn within one family and a cast shadow's edge are not the terminator's, and keep their scores.
- **Classes:** LOST below 0.24, SOFT below 0.46, FIRM below 0.68, HARD at 0.68 and above.
- **What each class does to the brush:**
  - HARD: no wet pickup, crisp ends, load ×1.12, impasto ×1.4.
  - FIRM: wet ×0.6, impasto ×1.15.
  - SOFT: wet ≥ 0.22, start pickup ≥ 0.45, ends at 0.78, impasto ×0.7, bristle variance ×0.6.
  - LOST: wet ≥ 0.32, ends at 0.66, impasto ×0.5.
- **Stopping at a plane edge:** a stroke stops at an edge with mean H ≥ 0.46, bleeds 60% at 0.24–0.46, and runs on below 0.24.
- **Strokes away from edges:** `hardness = 0.52 + 0.26·light − 0.28·shadow`.
- **Silhouette and crease edges** are CPU-extracted contour polylines (zero crossings of n·v), extracted each frame and segmented by a hash of surface position. Each is classed by contrast against the canvas: lost where the values match, found where they contrast.

### 3.7 Stroke roles (chosen by role, never at random)
1. **Block-in:** broad, flat, fairly opaque strokes laid along the planes, painted first.
2. **Form-turning:** curved strokes along a surface direction that crosses the terminator (meridians on a sphere, around the tube on a torus, the parameter line elsewhere). They stop below the core value.
3. **Half-tone scumble:** only where a transition zone is wide. It alternates the lighter and the darker neighbour by parity, semi-dry and broken.
4. **Shadow glaze:** thin, transparent, low impasto, where core and cast shadow dominate.
5. **Reflected light:** where the bounce zone is.
6. **Highlight dabs:** a few short, thick, loaded dabs at the highest values, painted last.
7. **Edges:** per §3.6.
8. **Line marks:** curves, traces, contours, axes, box edges, arrows and points. These are always FOUND: crisp, exact and readable, with a subtle per-load mix (umber toward burnt sienna, violet-umber or greenish umber).
9. **Translucent surfaces** (opacity < 1) are glazes: a few wide, heavily overlapped strokes at about 0.26 opacity, with no impasto, plus dry scumbles near the border. Anything behind them is painted first and tinted by the veil.

**Painting order:** block-in, form, scumble and glaze, reflected light, edges, line marks, highlights. Within each layer, strokes go back to front by depth.

Each role has its own parameters: length, width, curvature, load, pressure, impasto, bristle count and variance, dry-brush tail, and wet pickup. Each instance varies slightly, seeded.

### 3.8 Determinism
- The same scene, parameters, seed and view give an identical stroke list.
- Rotating away and back gives the identical image.

## 4. Rendering (WebGL2, `graph-engine/src/space/paint/gl/`)

Only `space/paint/gl/` touches WebGL. There are no new dependencies, and three.js is not used.

1. **G-buffer pass** over the meshes. It writes depth, normal, value u, plane id and local colour to textures. The CPU reads back the parts it needs, such as plane ids at stroke endpoints, through one `readPixels` per frame at reduced resolution (≤ 1/2).
2. **Shadow-map pass** from the key light.
3. **Stroke passes, one per layer.**
   - Each stroke is an instanced ribbon of N segments following its projected surface path.
   - The fragment shader is a procedural brush: bristle ridges with per-bristle load, a loaded start, and a dry tail gated by the canvas tooth.
   - Output goes to an accumulation target: premultiplied colour plus paint height.
   - Wet pickup samples the previous layer's colour texture, which is ping-ponged between layers.
4. **Composite.** The canvas tile (theme-coloured) shows where coverage is thin. Paint colour goes over it, and the height buffer gives impasto relief lit at a grazing angle. This writes to the screen.

**Performance target:** 30 fps or better while orbiting at 1280×800 with about 15k strokes on the review machine. A density-while-dragging parameter can trade quality for speed if needed.

## 5. Paper (canvas)

`graph-engine/src/style/papers/generate/` is a seeded, tileable tile generator: `(paperType, settings, seed) → { rgba, height, size }`, cached.
- **M1 ships canvas** (primed cotton duck, plus fine primed linen). It is ported from the mockup's `papers.js` and `painter.js` `getCanvasTile`.
- **Colour.** The structure is separate from the colour. The tile stores L/a/b offsets plus height, and the theme colour is applied at composite time.
- **Ownership.** `style/` belongs to the geometry agent. It reviews this module before anything reaches main.

## 6. The Paint Lab (M1 deliverable)

`review/paint-lab.html` and `review/src/paintLab.tsx`, served by the review harness from the paint worktree at `http://100.90.203.2:5182/paint-lab.html`.

- **View.** A full-window, fully 3D view: orbit by drag, zoom by wheel, reset by double-click, using the space camera (`space/camera/*`).
- **Figures.** These are real space specs:
  - a sphere on a table;
  - the saddle z = x² − y²;
  - the saddle coloured by height;
  - a torus;
  - ridges and valleys, z = 0.2·sin(5.4x)·cos(5.4y);
  - a tangent plane at P on a hill, with its slice traces and normal;
  - level curves projected onto the floor;
  - a helix through a translucent sheet;
  - a plane cutting a hill, showing the intersection curve.
- **Controls.** These are grouped, collapsible sliders, each with its numeric value and a reset:
  - **Light:** azimuth and elevation relative to the camera, intensity, warmth, sky and bounce.
  - **Colour:** a local colour picker, canvas tone, and the light/dark theme.
  - **Value plan:** thresholds, softness and plateaus.
  - **Lighting curve:** L slope and pivot; C base, peak, centre and width; H warm and cool targets and k; accent; plane steps; tints; and the curve's own deviation amounts. A live chart of H, C and L against value.
  - **Brush-load mix:** strength, hue range, chroma range, value hold, value-step fraction and size, flip probabilities, drift, and per-role multipliers.
  - **Edges:** every weight, the thresholds, the noise, and the stop and bleed levels.
  - **Stroke roles:** each role's density, size, length, curvature, load, impasto, bristles, dry tail and wet.
  - **Particles:** maximum and target density, and the fade.
  - **Impasto lighting:** strength and angle.
  - **Seed.**
- **Debug views:** value plan, planes, edge classes (lost grey, soft blue, firm orange, hard red), roles, a greyscale value check, and paint only (no canvas).
- **Presets:**
  - named presets saved in localStorage;
  - Export and Import JSON;
  - "Save as defaults", which POSTs to a dev-only middleware in `review/vite.config.mts` (`POST /__paint/tuning`). The middleware writes `graph-engine/src/space/paint/tuning.json`, which M2 reads as the shipping defaults.
  - Reset to the spec defaults.
  - An A/B toggle between the current and the saved settings.
- **FPS readout.**

## 7. Honesty and reversibility

- **Data marks** (points, arrow tips, slice traces, contours and intersection curves) are exact and found. They are never smeared.
- **Colormapped surfaces** keep hue ×1/3, and value is held.
- **Clean is untouched.** M1 adds new modules only: `space/paint/**`, `style/papers/generate/**`, `review/paint-lab.*`, and one dev middleware. SpaceRenderer, the figure renderer and every existing output are unchanged.
- **The byte-identity sweep** checks this: the 49 space examples are scene-identical, and the figure SVGs are byte-identical.

## 8. Testing

- **Model unit tests**, with hand-computed values:
  - curve values at chosen u;
  - mixing holds L within ±0.012;
  - anti-correlation frequencies;
  - role selection by zone;
  - edge classes for constructed configurations;
  - determinism;
  - the orbit retention metric at 12° is at least 0.8.
- **Fake-GL tests:** pass order, resource lifecycle and dispose.
- **Paper:** determinism (hash), seamless tiling, and the structure versus colour split.
- **Lab:** a headless screenshot per figure, plus the debug views.
- **Checks:** `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit`, `npm run lint` and `npx vitest run`, all clean.

## 9. Out of scope for M1

- `@style: paint` inside SpaceRenderer.
- The 2D figure painter.
- Papers other than canvas.
- The hand-drawn ink, pencil and marker styles in 3D.
- Export.

## 10. M2 outline (after Ben's tune)

1. **Space renderer.** `@style: paint` resolves the paint passes inside SpaceRenderer, using `tuning.json` defaults overridden by `@style-*` directives. Clean stays byte-identical.
2. **Shared papers.** The shared paper generator covers every paper and follows the Osmosis theme, including custom themes. Geometry wires the SVG side.
3. **Hand-drawn space.** Phase 1 strokes and Phase 2 surfaces, per the 2026-10-01 research (`scratchpad/handdrawn-research/`).
4. **2D painter.** The 2D figure painter uses the same model, coordinated with geometry.

## 11. Addendum (Ben, 2026-10-02 01:30): more of the look in his hands

Ben wants to fine-tune "color curves, lighting curves, lighting strength, environment absorption, value curve, ± ratio for colors, brush stroke detection, etc." Added to the contract:
- `curves.ts` provides monotone-cubic curves, and `params.curves` holds them:
  - `lightResponse`: N·L → lit;
  - `value`: raw u → value;
  - `lAdjust`, `cAdjust`, `hAdjust`: adjustments to L, C and H over value;
  - `mixAmount`: mix strength over value.

  Their defaults are identity or flat, so the §3 formulas stay the look until he edits them. The lab draws `CURVE_SCHEMA` as draggable curve editors.
- `params.environment`: hue and chroma of the environment light, `absorption` (how much of the environment colour the object takes in, applied to the ambient share in OKLab with L untouched), and screen-space `occlusion` from the G-buffer depth with `occlusionRadiusPx`.
- `params.mix.hueBias`, `chromaBias`, `valueBias`: the ± balance of the brush-load mix. A bias b makes the + direction come up (1 + b)/2 of the time.
- `params.detect`: the thresholds that pick each stroke's role (form band, scumble gradient and width, dab fraction and spacing, glaze threshold, reflected minimum, edge minimum contrast and reach).
- The model computes its own value from the G-buffer normal and shadow flag, so the curves apply: N·L → `lightResponse` → the value plan (§12) → `value`, with the occlusion in the plan. (It first read: N·L → `lightResponse` → plus ambient, sky and bounce → minus occlusion → `value`; §12 replaced that.) `PaintDebug.value` carries it for the 'value' debug view. `GBuffer.value` remains the renderer's raw reference.

## 12. Value plan (Ben, 2026-10-02)

Ben, on the painted figures: "bounce light is way too light. bounce light is only supposed to be darker than midtones but its the same value. and another thing, youre missing the terminal and the softness of the transition between midtone and light and also bounce light and shadow." This replaces the value plan of §3.3 (and the zone steps of §11: `value.halfAt`, `value.lightAt`, `value.soft`, `value.reflectedLo` and `value.reflectedHi` are gone). The painter's value structure is the classical form-shadow model.

- **Two families, divided by the terminator (N·L = 0).** Every value of the shadow family is darker than every value of the light family.
  - The LIGHT family is where the surface faces the key light (N·L > 0) and is not in cast shadow. From bright to dark: highlight, light, half-tone.
  - The SHADOW family is the form shadow (N·L ≤ 0) plus the cast shadow. The core shadow is its darkest band, and the reflected light lifts beyond it.
- **The plan is a function of the signed N·L**, not of a lit value with the fill light on top: `u = planSample(N·L, shadow flag, normal, occlusion)` in `model/value.ts`. `lightResponse` and the intensity scale N·L on the lit side; the `value` curve is applied last, to the finished plan value.
- **Light family.** The half-tone ramp runs from `halfLo` (its darkest value, at the terminator) to `halfHi`, then the light ramp from `lightLo` to `lightHi` (the highlight). They are joined by a SOFT turn:
  - `value.lightTurn`: the N·L where the half-tone turns to light (default 0.6);
  - `value.lightSoftness`: the width of that turn in N·L units (default 0.5: a wide, smooth gradation, not a step).
- **Terminator and core shadow.**
  - `value.terminatorSoftness`: the light-to-core edge, centred on N·L = 0 (default 0.1; the slider runs to 1, a terminator as wide as the lit half). It is softer on round forms but clearly defined, and crisper than the two other transitions. A wider edge is a gentler gradient (the plan's slope at the middle of the edge is 0.1 / softness of the default's) and the brushwork follows it: the underpainting's band and ring widen with it, and the edge strokes of the terminator go soft (§3.6, §12).
  - `value.coreWidth`: how far into the shadow the core band extends, from 0 down to −coreWidth (default 0.2).
  - `value.corePlateau`: the core's value (default 0.24).
- **Reflected (bounce) light.** Beyond the core the form shadow lightens with the bounce, but always stays darker than the darkest half-tone:
  - `reflectedMax = corePlateau + value.reflectedShare × (halfLo − corePlateau)`, with `reflectedShare` in 0..0.9 (default 0.4);
  - value = core + `bounceAmount` × (reflectedMax − core), where `bounceAmount` is 0..1, from the bounce light (normals facing the table), the sky (up-facing) and the ambient, less the occlusion;
  - the transition from the core to the reflected light is SOFT: `value.reflectedSoftness` (default 0.35, starting at −coreWidth).

  `light.bounce`, `light.sky`, `light.ambient` and the curve's `reflectedBounceMix` can never lift a shadow-family value above `reflectedMax`: the bounce tints the colour's hue and chroma (OKLab a and b), and never its L (`model/curve.ts`).
- **Cast shadow.** It belongs to the shadow family. `value.castPlateau` is its value away from a contact, `value.castContact` at the contact (the occlusion, over `environment.occlusionRadiusPx`); neither is ever lighter than `reflectedMax`. The occlusion also takes the bounce away from the form shadow near a contact. It does not darken the light family.
- **The terminator edge is the one place where the families meet.** The strict ordering holds outside it (the edge is the width `terminatorSoftness` centred on the terminator), and a cast shadow is told from the terminator by its N·L (past the edge, then `CAST_FADE` more). Over that fade the light end of the blend is the cap, not the half-tone: a pixel is cast by the middle of the fade (its cast weight a half), and from there it is never lighter than `reflectedMax` (the fade used to blend from the half-tone, and lifted a cast shadow at N·L 0.05 to 0.13 above the cap). The family of a pixel is the light family where the weight of the light (the terminator's edge, less the cast weight) is over a half.
- **The structure is held whatever the sliders say** (`effectiveValues()` in `model/value.ts`, which the plan, the planes and the strokes read, and what a readout should show): `corePlateau` is held `CORE_GAP` (0.02) under `halfLo`, so the cap is always under the darkest half-tone; `halfHi`, `lightLo` and `lightHi` rise from `halfLo` (a ramp that would fall is flat); `castPlateau` and `castContact` are never lighter than `reflectedMax`. What stays Ben's own: a value curve that is not non-decreasing (it rises and then falls) can reorder the families, since the curve is applied last to the plan, and the model does not stop it.
- **Hue is the curve's, not the plan's.** The cap on the warm and cool swing (`curve.shiftMax`, §3.4) keeps a shadow's hue near the colour's own (a terracotta's shadows are dark reds, never purple, down to a muted chroma of 0.02); it bounds the light-to-shadow swing only. The brush-load mix's hue offsets (§3.5, 12–25°) and the planes' hue steps (±16°) vary hue on top of it, by design, so a painted shadow's hue is the capped swing plus Ben's colour distortion.
- **The rule holds in the FINAL picture, not only in the plan.** Everything after the plan keeps a value in its own family:
  - *Planes.* A small piece merges only into a neighbour of its own family (light, half-tone and highlight; or core, reflected light and cast shadow), and a piece with none is kept: a core sliver used to join a half-tone plane and take its value.
  - *Stepped values.* A stroke's value (the plane's mean plus `planeGradient` of its own gradient, the seeded deviation, and a role's own lightening) is held inside its pixel's family: a shadow stroke at most the cap, a light stroke at least the darkest half-tone, as plan values (the bounds go through the value curve, as the plan does), or the plan's own value where that is beyond them (the terminator's edge). The scumble's fixed ±0.1 is held the same way: its lighter variant stops at the cap in the shadow, its darker at the darkest half-tone in the light.
  - *The brush-load mix.* After the mix and the gamut fit a stroke's lightness is held on its family's side of the colour the same recipe has at the cap (shadow) or at the darkest half-tone (light): `mix.valueStep` and `mix.strength` at their maxima cannot lift a shadow stroke into the half-tones or drop a half-tone stroke into the shadow. A stroke inside its bound is untouched.
  - *The underpainting.* Its image is filled from the lattice samples bilinearly within a mark AND a family: the light and the shadow family are never blended into one another (the fill used to blur across the terminator, lifting shadow pixels at N·L −0.05 to −0.1 above the darkest half-tone pixel, worse on a small figure). The terminator is NOT blended that way: the pixels inside the plan's own soft band (±`terminatorSoftness`/2 about N·L = 0, the one place the families meet) are made at their own plan value (the plan at the pixel's own normal, at the full resolution), from the recipe of the nearest lattice sample on their side of the terminator, so the underpainting's value runs through the band as the plan's does, neither a step at N·L = 0 nor a 12 px blur. Lattice samples are taken from outside the band where a cell has any pixel of the family there. (No plane step: it would put the planes' own step across the terminator back.) A RING outside the band (a band's width in N·L, and three image pixels) is made the same way, at the plan's value, and blended into the lattice's colour by its distance from the band, so the band has no seam where the plan climbs fast (a limb with the light at its edge); a ring pixel is held to its family like a sample. The samples' colours are held by the same lightness bound as the strokes'.
  - *The outline.* A silhouette's colour comes from the stretch of outline a stroke lies on, not from one mean over the whole outline. The outline of a form in the shadow family against light canvas is a FOUND edge (class firm or hard, dark as its own side, never lighter than the cap, never bridged to the canvas); where the table across it is in the figure's own cast shadow the bridge is to that shadow's value. Only on the lit side, where the figure's values and the canvas's match, are lost edges bridged toward the canvas. Every edge stroke whose own side is in the shadow family (a silhouette stretch whose lowest value on the way in from the outline is under the cap, or an edge between two shadow planes) is held to the cap's lightness in the figure's own colour, whatever it is bridged to (the bridge to the table's cast shadow, whose colour is a light one, was lighter than the figure's half-tones): the hold's bound is the figure's side alone, not the blend. A stretch is of one family: the cut falls where the outline leaves the shadow family.
- **A soft terminator reaches the brushwork.** `value.terminatorSoftness` runs to N·L 1. At 0.6 the plan turns from the shadow to the light six times more gently than at 0.1 (a tenth as steeply at 1.0), and what is made from the plan turns as gently. The underpainting's band (|N·L| under half the softness, made at the plan's own value) and its ring (a band's width, and three pixels) widen with it and stay seamless: at 1.0 the band is half the figure and the step across its edge is no steeper than the plan's own. The family order holds outside the band, in strokes and in pixels (at 0.6 and 1.0 by 0.1 and more in the grid). An edge between a light plane and a form-shadow plane has its hardness scaled by `clamp(0.1 / terminatorSoftness, 0.2, 1)` (§3.6): the default's soft and firm edges at the terminator are soft or lost from 0.3, and every one of them lost from 0.5, where the plane and the underpainting have no step for a hard stroke to sit on. The scale is exactly 1 at 0.1 and under: the default picture is as it was.
- **Detection follows.**
  - `detect.formBandNL` (it was `formBand`, in u units, before the plan was a function of N·L: a saved preset's old key is ignored) is in N·L units from the terminator, and a form stroke stops where the plan value falls under the middle of the terminator's soft edge (the value at N·L = 0, through the value curve);
  - the zone weights classify a pixel for the roles, the planes and the zones view (a pixel is reflected light only where the bounce or sky really reaches it);
  - scumble now exists on a lit sphere, on the wide soft turns, and so follows the light as form strokes do (the coherence target of §3.2 covers the steady roles: block, glaze, reflected).
- **Old saved presets** that still carry `reflectedLo`, `reflectedHi`, `halfAt`, `lightAt` or `soft` resolve without errors: `resolvePaintParams` ignores unknown keys.

## 13. Orbit: the model keeps painting while you drag, and the light stays in the world (Ben, 2026-10-02)

Ben, orbiting a sphere: the half that turns into view was bare (the warped underpainting as a flat fill with streaks), and a stale silhouette stroke hung inside the form. "The paint strokes should render as I move around." And: "fixed lighting would be cool." This supersedes §2.6's "the light follows the camera" and the "re-project the last frame, run the model once on release" rule of the orbit.

- **The model runs under the drag**, in the worker: one request at a time, always for the newest view, never interrupted (the views that came while it ran are skipped for the newest). The main thread never waits for it: every animation frame still re-projects the newest base (~2 ms).
- **The newest model frame becomes the base** at once, re-projected from the view it was made for to the view the camera has now. An answer for an older request than the base is never adopted. The release still makes one frame at full quality.
- **No popping.** The old and new bases are matched by particle seed and role (the spatial mix keeps these the same in every view). A stroke both have is eased from the old frame's numbers to the new one's, one that appeared fades in and one that went fades out, over 120 ms (at once under prefers-reduced-motion). An edge stroke is never matched.
- **Edges are view-dependent.** An edge stroke fades out as its base ages, over 200 ms from when the camera left the view the base was made for.
- **Mid-drag frames** are analysed at the model's coarse drag stride (`analysisStride`, about 28k pixels), with the particle density as it is. Measured against the still frame of the same view, the median stroke's colour differs by 0.001 to 0.004 (linear light) and its path by under 0.1 px.
- **`light.worldFixed`** (default 1): `light.azimuth` and `light.elevation` place the key light in the WORLD (z up, the azimuth about z from +x, the elevation above the xy-plane: (0, 90) is straight down). At 0 the light is relative to the view as before. The lab builds `PaintView.lightDir` from it; the shadow map, the G-buffer and the model follow. The canvas's relief light stays on the screen. The default azimuth and elevation, -35 and 39, are the mockup's light (56 left, 27 up) at a typical authored camera, so a figure at its authored view is lit as it was.
