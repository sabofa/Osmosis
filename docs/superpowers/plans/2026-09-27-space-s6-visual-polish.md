# Space S6 — Visual Polish

> **For agentic workers:** execute task-by-task with TDD where there is logic, and a before/after headless screenshot where there is only look. One commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make every space figure read the way a good textbook figure reads, in light and dark:
- nothing collides;
- nothing is illegible;
- nothing prints more digits than a reader wants;
- the interactive affordances are findable;
- the chrome (panel, colorbar, readouts, pins, error states) looks like one designed object that belongs to Osmosis.

The user asked for this phase as "a nice to have": the engine is functionally complete, and S6 is taste and finish.

**Architecture:** no new subsystems. Every change sits in the existing layers:
- `frame/` (flat boxes, label priorities);
- `ui/` (the label placer, halos, panel and readout styling, camera easing, states);
- `gl/` (OIT weighting, back-face handling, edge weights);
- `space/theme.ts` and `space/colormaps.ts` (dark-theme tuning);
- the kernel, for slivers and performance only.

**Tech Stack:** TypeScript, WebGL2, CSS in `ui/SpaceView.css`, Vitest. No new dependencies.

**Spec:** Track 3 "Revised 2026-09-26": SP4, SP5 and SP6, and SP11's S6 row, which says colours come from the host's theme tokens (`resolvePalette`) and are never hard-coded, so track 5 builds on this instead of redoing it. Read the handoff section "Open, for S6 and after", which is this plan's input list, and the "Parked" lines in the phase ledgers.

**Design direction:** paper and ink, consistent with the 2D graph and the solid-figure renderer in the same app:
- warm neutral backgrounds from the host tokens;
- ink-weight hierarchy (the data is strongest, then the frame, then the chrome);
- restrained colour;
- typography inherited from the host (Inter / Space Grotesk in the review harness);
- no gradients or drop shadows on chrome beyond a hairline border.

The implementer may load a frontend-design skill for judgement, but the tokens are the host's.

## Global Constraints
- Everything in the earlier space plans' Global Constraints still binds:
  - no three.js under `space/`; only `space/gl/` touches WebGL; only `space/ui/` and `SpaceRenderer.ts` touch the DOM;
  - errors are shown, never thrown;
  - render on demand;
  - proving a test means deleting the behaviour it covers;
  - all three checks clean before every commit, and the trailer EXACTLY `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Honesty never regresses.** Fewer digits is always allowed; more digits than the error supports never is. No readout may round to a prettier number than the error allows.
- **Colours come from the theme** (`resolvePalette`, `space/theme.ts`). No new hard-coded hex outside the documented categorical and colormap tables.
- **`prefers-reduced-motion` disables every animation.**
- **Every visual change has a before/after headless screenshot** (light and dark) in the task report. **Never use a browser tool.**
- **The byte-identity sweep:** figure SVGs and 2D scenes are untouched.

## Load-bearing decisions

**V1 — Flat scenes get a flat box.**
- A scene whose data z span is degenerate (all data at one z, e.g. a lone `region:`, or vectors in the z = 0 plane) gets a thin box:
  - z half-extent ratio 0.15 under `auto` aspect;
  - z range `v ± s`, with `s = 0.05 ×` the larger x/y span;
  - a single z tick labelled at the data's z.
- An authored `@bounds3d z` always wins. Test the rule and the precedence.

**V2 — One label placer for all overlay text** (`ui/labelPlacer.ts`, pure).
- **Candidates:**
  - tick labels at their fixed offsets;
  - point labels (8 candidate offsets);
  - annotation readouts (8 offsets, then a leader line up to 60 px);
  - contour labels (along their curve).
- **Placement order** is by priority: readouts, then point labels, then contour labels, then tick labels; within a priority, by source order. Deterministic.
- **Overlap** is tested on estimated text boxes (the existing width estimate).
- **Dropped labels:** a label that fits nowhere is dropped, except readouts, which always show via a leader line. Tick-label thinning keeps its end-label rule, and the corner duplicate is resolved here.
- **Tests:**
  - the two gradient readouts plus x ticks: no overlap;
  - the half-disc centroid plus area readouts: no overlap;
  - saddle-point contour labels: at most one per curve, no overlap;
  - determinism.

**V3 — Display digits.**
- `formatApprox` gains a display cap: at most 6 significant digits in on-figure annotations, and 4 in hover readouts (already the case). The error still bounds the digits from above, so `∬ ≈ 25.1327412287` becomes `≈ 25.1327`.
- The pinned readout box may show the full supported digits on demand (a click toggles), and the text stays honest either way.

**V4 — Translucent closed surfaces under OIT.**
- Back faces contribute at half weight in the OIT accumulate, and the back-face tint is reduced under OIT, so a translucent sphere reads as its colour, not grey.
- Normalise the OIT depth weight's z by the box's depth range (S3 M10), so nearer layers dominate as intended.
- Before and after on the three-variable Lagrange sphere and the helix-through-sphere example.

**V5 — Findable interactive affordances.**
- A draggable point draws 1.5× its size, with a 2 px halo in the theme background colour and a thin ink ring. The cursor becomes `grab`/`grabbing` over it.
- Hovered and pinned markers get the same halo.
- Every point gets a 1 px background-coloured outline, so points read on any surface.

**V6 — Mesh and edge weights.**
- Mesh lines mix toward the theme's ink in light and toward the background in dark, at a strength tuned per theme, so they are "present, not loud".
- Translucent Riemann boxes draw their edges at 0.35 opacity and 1 px, and those edges are excluded from the hidden pass, so the lattice quiets down.

**V7 — Dark theme.**
- The balance map's neutral centre becomes theme-aware (Oklab L ≈ 0.62 in dark, 0.92 in light), keeping symmetry.
- Operand and construction grey (`project:`, `cross:`) uses a theme token with at least 3:1 contrast against the background. Test the contrast numerically, with the WCAG relative-luminance formula, in both themes.

**V8 — Sliver triangles at holes.**
- Near a removed (non-finite) vertex, drop triangles whose smallest angle in parameter space is below 3°, or whose area is below 1e-4 of a cell, after the hole is cut.
- Test on `x*y/(x^2+y^2)` at the origin (the "Limits along two paths" example): no sliver survives, and the mesh stays manifold elsewhere.

**V9 — Camera easing and states.**
- **Easing:** double-click and `0` animate back to the authored view over 280 ms with ease-out cubic (none under reduced motion). Azimuth takes the shortest way round.
- **States,** styled with the theme tokens and centred in the view, each with a one-line reason and, where useful, a next step:
  - no WebGL2;
  - context lost ("restoring…", which clears on restore);
  - shader compile failure;
  - an empty scene ("nothing to draw yet: add a statement").

**V10 — Chrome styling:** the parameter panel, colorbar, readout box, pins and the event log on the review page.
- One visual language: hairline border in `--line`, surface `--surface`, ink `--ink`, muted `--muted`, radius 6, 8/12 px spacing rhythm, tabular numerals.
- The panel collapses to a chip when it isn't hovered and no parameter is playing.
- The colorbar title sits above the bar, with ticks aligned to it.
- Nothing overlaps the frame's tick labels: V2's placer knows the chrome's rectangles.

**V11 — Performance.**
- **Parametric `setValue`** ≤ 8 ms at 128² on the review machine (S1's parked item). Share subexpressions across r, r_u and r_v through the existing register program (`compileMany`), and profile `finishMesh` and the extent.
- **Implicit surfaces during a drag or play** (S4a: about 0.5 s at res 64) use progressive refinement: while held, rebuild at res/2; on release, rebuild at full res once.
- **Tests:** the rebuild counts and the resolution used while held versus released. Measure the timings with a script and report the medians.

---

### Task 1: Flat boxes and the label placer (V1, V2)
- [ ] Failing tests: the V1 rules; the V2 scenarios, determinism, and a readout always shown.
- [ ] Headless before/after shots: A polar region; The centroid of a half-disc; Projection of u onto v; The gradient and its level curve; Level curves of a saddle.
- [ ] **Carried, from the integration review:** `gradients.ts` and `tangentPlanes.ts` call `requireInside(..., 'the box')`, but when `over` is authored the check is against the tool's own rectangle. So "(3, 0, 0) is outside the box" is misleading for a point inside the drawn frame. Say "outside the domain" when `over` is authored, and keep "the box" when it isn't. Update `gradients.test.ts`'s `over` case to pin the new wording.
- [ ] Commit `feat(graph-engine): space flat boxes, and one collision-free placer for every label`.

### Task 2: Digits, OIT surfaces, halos, weights, dark theme (V3–V7)
- [ ] Failing tests: the V3 caps; the V4 weighting (fake-GL uniforms, and the OIT weight function's normalisation); the V5 draggable flag reaching the point pipeline and the cursor; the V6 edge opacity; the V7 contrast ratios and balance symmetry.
- [ ] Headless before/after in light AND dark: every example that shows a readout, a translucent surface, a draggable point, Riemann boxes, or a colormap.
- [ ] Commit `feat(graph-engine): space finish — readable digits, translucent solids, findable points, quieter lines, a legible dark theme`.

### Task 3: Slivers, easing and states (V8, V9)
- [ ] Failing tests: V8 on the limit example; V9's easing curve (pure: the eased view at t = 0, 0.5 and 1, shortest azimuth, none under reduced motion); a state per condition.
- [ ] Headless shots: the limit example, and each state (inject the no-WebGL and shader-failure states in a review-page fixture).
- [ ] Commit `feat(graph-engine): space mesh holes without slivers, an eased camera reset, and designed empty and error states`.

### Task 4: Chrome styling (V10)
- [ ] Headless before/after of the review page with a parameter spec: the panel, colorbar, pins, readout, and the event log.
- [ ] No logic tests beyond the collapse behaviour (pure state).
- [ ] Commit `style(graph-engine): space chrome in one visual language`.

### Task 5: Performance (V11)
- [ ] Failing tests: rebuild resolution while held versus on release; sharing across r, r_u and r_v (the register count shrinks).
- [ ] Measure and report the timing table.
- [ ] Commit `perf(graph-engine): space parametric surfaces within budget, progressive implicit surfaces while dragging`.

### Task 6: Gallery pass
- [ ] Headless-shoot every space example in light and dark, and assemble the shots into a single HTML contact sheet in the scratchpad (not committed).
- [ ] Fix anything still off.
- [ ] List what remains for track 5 in the handoff.
- [ ] Commit `docs: handoff — space S6 polish`.

## Verification
- All three checks clean, and the byte-identity sweep clean.
- The contact sheet is sent to the controller.

## Out of scope
- Track 5's customisation UI (theme editor, textures).
- Critical curves (S4b M4).
- A jsdom test layer for GraphViewer (milestone review).
- Sub-projects 3 and 4.
