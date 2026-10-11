# Figure Styles, Part 1 — Styles and the Style Lab

> **For agentic workers:** execute task-by-task with TDD and a commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** figures can be drawn in distinct looks: clean (today), ink, pencil, and marker on notebook paper. That means six genuinely different line types, seven fills, nine papers, three lettering faces and a saturation control, each adjustable, plus a style lab and contact sheets so Ben can tune them by eye.

**Architecture:**
- **A renderer-independent style module,** `graph-engine/src/style/`, holding tokens, presets, resolution, a seeded random source, colour, and one file per line type, fill and paper. It is written so the graphing engine can adopt it later.
- **A pen seam in the figure renderer.** `render.ts` stops calling the SVG emitters directly and calls a pen. The clean pen forwards to today's emitters, byte-identically; the styled pen runs `style/`.
- **The style lab** is a review-harness page with live sliders. **Contact sheets** are rendered both in that page and headlessly.

**Tech Stack:** TypeScript, React (the review harness only), Vitest. **No new runtime dependencies.** Web fonts load only in the review harness pages, from Google Fonts, never as an engine dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-figure-styles-design.md`. **Read it in full first.** It is short and binding. Also read `docs/HANDOFF-2026-09-23-graph-engine-v2.md`: "Worktrees, milestones and parallel agents", "How the engine is put together", lesson 1 (tests that pass for the wrong reason), and lesson 2 (node-only tests can't see DOM or CSS bugs).

**Where you work:** branch `milestone-a/geometry`, worktree `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`. Other agents work in parallel in their own worktrees; follow the handoff's rules.

## Global Constraints

- **No new runtime dependencies.**
- **Clean is byte-identical.** With no `@style…` directive and no base style, every existing spec renders byte-for-byte as before under every view. Prove it with a before/after render sweep over every example and every spec string in the existing tests, under every `@view`, **after every task**. No existing test is weakened or deleted.
- **Deterministic.** The same spec and style give the same SVG. All randomness comes from `style/random.ts`, seeded by an identity string (statement, object, piece index) plus `seed`. **No `Math.random`, no `Date`.** Add a lint-style test that greps `style/` and `figure/` for `Math.random`.
- **Faithful at looseness 0,** for every line type: stroke ends are exact and arcs stay within half a stroke width of the true circle.
- **Readable.** A label is never moved off its placed position. Tilt is at most a few degrees.
- **Filters are texture only.** SVG filters and patterns never displace geometry; geometry comes from `style/lines/`. Filter and pattern ids are derived from a hash of the figure's content, so two figures on one page cannot collide.
- **Errors are returned, not thrown, past `renderFigure`.** An unknown style directive or value is a legible refusal, and the figure still draws.
- **Readable code, because the graphing engine may adopt `style/` later.**
  - One file per line type, fill and paper.
  - Each file opens with a short comment saying what the look is and how it is built.
  - `style/` imports nothing from `figure/`, `scene/` or `render/`.
- **All three checks clean per task:** `npm run test --workspace=graph-engine`, `npx tsc -b graph-engine/tsconfig.json --noEmit`, `npm run lint --workspace=graph-engine`.
- **Commits:** one per task, with explicit `git add <paths>` (never `-A` or `.`). The body ends EXACTLY with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Visual checks:** no browser pane and no browser page scripts. Render to SVG and HTML with `vite-node`, then to PNG with headless Edge (PowerShell `Start-Process -Wait -NoNewWindow`, with a fresh `--user-data-dir` per shot). Read the PNGs. **Never leave a review server running** when you finish: a stale one locked this worktree and broke it on Sep 28.
- **Proving a test can fail means deleting the behaviour it covers.** Record which deletion proved which test in each commit body.

## Load-bearing decisions (from the spec)

**D1: style tokens.** Five groups:
- line: `type`, `looseness`, `wobble`, `passes`, `width`, `variation`, `taper`, `grain`, `opacity`;
- fill: `type`, `angle`, `spacing`, `opacity`;
- paper: `type`, `tint`, `texture`, `grid`;
- lettering: `face`, `size`, `tilt`;
- colour: `ink`, `saturation`.

Plus `seed`. The ranges and the four preset tables are exactly as in the spec.

**D2: resolution.** Built-in clean, then base style (app or document, an optional `renderFigure` parameter), then figure directives. Each layer overrides only what it sets. The directives are `@style: <preset>` and `@style-<setting>: <value>`, using the spec's names: `@style-line`, `@style-looseness`, `@style-fill`, `@style-paper`, `@style-lettering`, `@style-saturation`, `@style-seed`, and so on. Put their parsing in its own block of `parseConfig.ts`. The space side adds its own directives to that file, so keep the change additive.

**D3: the pen.** A `FigurePen` interface with `stroke(path, attrs, id, layer)`, `fill(region, attrs, id, layer)`, `mark(…)`, `text(…)` and `paper(bounds)`.
- Paths are abstract chains of `line` / `arc` / `ellipticalArc` / `cubic` pieces in drawing coordinates.
- The **clean pen** reproduces today's exact emitter calls.
- `renderFigure(statements, config, palette, baseStyle?)` chooses the pen from the resolved style. **Clean resolves to the clean pen, no exceptions.**

**D4: line types as distinct algorithms.** Each is described in the spec:
- `technical`: uniform width;
- `ink`: pen wobble, pressure and doubling;
- `brush`: a filled calligraphic outline, direction-dependent;
- `pencil`: offset graphite passes with grain;
- `marker`: thick, round, translucent, darker at overlaps;
- `chalk`: broken, speckled and dusty.

Arcs in sketchy styles are Bézier paths through points on the true arc.

**D5: fills** (`flat`, `hatch`, `crosshatch`, `stipple`, `scribble`, `wash`, `none`) are clipped to the region outline. Hatch lines are drawn in the current line type.

**D6: papers** (`none`, `clean`, `paper`, `rough-paper`, `canvas`, `graph`, `rough-graph`, `dotted`, `ruled`) sit behind everything and cover the visible area **generously**, so panning never shows an edge.

**D7: lettering faces** are font stacks with fallbacks: `math`, a serif stack; `textbook`, a sans stack; `hand`, a handwriting stack led by a Google handwriting font such as "Caveat" or "Patrick Hand". Tilt is a seeded rotation about the label's anchor, at most 4°.

**D8: colour.** `saturation` scales OKLCH chroma on every colour the figure uses; saturation 1 is the identity.

---

### Task 1: The style foundation

**Files:**
- Create in `graph-engine/src/style/`: `tokens.ts`, `presets.ts`, `resolve.ts`, `random.ts`, `color.ts`, and their tests.
- Modify `parser/config.ts` (a resolved `style` on the config) and `parser/parseConfig.ts` (the D2 directives, in their own block).

- [ ] **Step 1: failing tests:**
  - **Presets:** each has every token, within range.
  - **Resolution:** default, then base, then directives, with overrides per setting. `@style: pencil` plus `@style-paper: graph` gives pencil with graph paper. An unknown preset, setting or value is refused, naming the valid ones, and the bad directive is ignored.
  - **Random:** the same seed string gives the same sequence and different strings give different sequences, with a documented algorithm (e.g. a string hash into mulberry32).
  - **Colour:** saturation 1 is the identity on sample colours; 0 gives greys of equal OKLCH lightness; hue is preserved at 0.5 and 1.5 (hand-check one colour).
  - **No stray randomness:** no `Math.random` anywhere in `style/` or `figure/`.
- [ ] **Step 2: implement.** Then run the byte sweep, which must be unchanged.
- [ ] **Step 3: prove it.** Break precedence (base over directive) and watch the resolution test go red.
- [ ] **Step 4:** run all three checks, then commit as `feat(graph-engine): the style model — tokens, presets, resolution, seeded randomness and colour`.

### Task 2: The pen seam

**Files:** create `figure/pen.ts` (the interface, the clean pen, and the stroke-path and region types). Modify `figure/render.ts`, so every drawing call goes through the pen, and add a `baseStyle?` parameter to `renderFigure`.

- [ ] **Step 1:** capture the full byte sweep first.
- [ ] **Step 2:** refactor mechanically. Every emitter call in `render.ts` becomes a pen call carrying identity and layer, in the same order. The clean pen reproduces the same bytes.
- [ ] **Step 3: tests.**
  - The byte sweep is identical.
  - A test double pen records its calls: a known figure produces the expected sequence of stroke and fill calls, with identities and layers.
  - No SVG emitter import remains in `render.ts` outside the clean pen.
- [ ] **Step 4:** run all three checks, then commit as `refactor(graph-engine): figures draw through a pen; the clean pen is today's output`.

### Task 3: Line types and the styled pen

**Files:**
- Create in `style/lines/`: `technical.ts`, `ink.ts`, `brush.ts`, `pencil.ts`, `marker.ts`, `chalk.ts`, and a small `path.ts` for sampling arcs and building Bézier chains. Add tests.
- Create `figure/styledPen.ts`, for strokes and marks for now, with fills stubbed to flat and paper to clean.

- [ ] **Step 1: failing tests,** for every line type:
  - **Determinism:** the same identity gives the same output.
  - **Faithfulness at looseness 0:** the first and last points equal the true endpoints within `GEOM_EPS` scaled to the figure; points on an arc stroke lie within half a stroke width of the circle.
  - **Looseness 1** produces measurable deviation.
  - **Distinctness:** each type's output differs structurally from the others (outline versus polyline, pass count, dot texture), so the six types are not one algorithm with different numbers.
  - **Finiteness:** no NaN or Infinity in any output.
  - **End to end:** a spec with `@style: ink` renders with `renderFigure`, is deterministic, and every element keeps its `data-statement` / `data-object`.
- [ ] **Step 2: implement.** Textures such as pencil grain and chalk dust are filters defined once in `<defs>` with content-hashed ids.
- [ ] **Step 3: prove it.**
  - Seed ink by piece index only, without the statement: two figures' strokes collide and the determinism-by-identity test goes red.
  - Remove the endpoint pinning: the looseness-0 test goes red.
- [ ] **Step 4:** run all three checks and the byte sweep (clean unchanged), then commit as `feat(graph-engine): six line types, drawn through the styled pen`.

### Task 4: Fills

**Files:** create in `style/fills/`: `flat.ts`, `hatch.ts`, `crosshatch.ts`, `stipple.ts`, `scribble.ts`, `wash.ts`, `none.ts`, and tests. Wire them into `figure/styledPen.ts` so every filled item uses them: phase 12 fills, polygons, sectors and segments, cut faces and regions.

- [ ] **Step 1: failing tests:**
  - Every hatch, stipple and scribble mark lies inside the region, through a `clipPath` of the exact outline and, for dots, their centres inside the region.
  - Hatch lines follow `angle` and `spacing`; cross-hatch has two families.
  - The annulus's hole stays empty under every fill.
  - Deterministic.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.** Drop the clip: the inside-the-region test goes red.
- [ ] **Step 4:** run all three checks and the byte sweep, then commit as `feat(graph-engine): seven fills, clipped to their regions`.

### Task 5: Papers, lettering and colour

**Files:**
- Create in `style/papers/`: `none.ts`, `clean.ts`, `paper.ts`, `roughPaper.ts`, `canvas.ts`, `graph.ts`, `roughGraph.ts`, `dotted.ts`, `ruled.ts`.
- Create `style/lettering.ts`.
- Wire papers, lettering and colour into `figure/styledPen.ts`. Add tests.

- [ ] **Step 1: failing tests:**
  - Each paper emits its defs and a background covering at least 3× the figure's view box in every direction, for panning.
  - Graph, dotted and ruled spacing follows `grid`.
  - `none` emits no background.
  - Lettering: the `hand` face uses the handwriting stack, and tilt is at most 4° and deterministic. **Labels' anchor positions are unchanged from clean**; assert this on a labelled figure.
  - Colour: saturation applies to ink, fills and an author's `color:`.
- [ ] **Step 2: implement.**
- [ ] **Step 3: prove it.** Let tilt move the anchor: the anchor test goes red.
- [ ] **Step 4:** run all three checks and the byte sweep, then commit as `feat(graph-engine): nine papers, three lettering faces and saturation`.

### Task 6: The style lab, contact sheets, examples

**Files:**
- Create `review/style-lab.html` and `review/src/styleLab.tsx`, and link the lab from `review/index.html`.
- Create `graph-engine/scripts/contact-sheet.ts` (vite-node).
- Add a `'Styles'` example group in `examples.ts`, with a few figures pinned to each preset.

**The lab page:**
- An example picker grouped like the harness, and preset buttons.
- A slider or picker for every token, plus seed and a reset.
- The figure drawn with today's pan and zoom through `FigureView`.
- A "copy directives" box showing the `@style-…` lines for the current settings.
- Settings kept in the URL hash, so a look can be shared as a link.
- A **sheet** tab: 8 representative examples (a triangle with measures, circle vocabulary, the cube with its net, a shaded region, a cone and sphere, an oblique section, the AIME tetrahedron, a graph-free construction), each in every preset, in one grid.
- Web fonts load here, via Google Fonts links.

**The contact-sheet script** renders the same sheet to an HTML file, for headless PNG.

- [ ] **Step 1:** build the lab and the sheet. Add the Styles examples; `examples.test.ts` covers them.
- [ ] **Step 2: visual check.**
  - Render the sheet to PNG and read it.
  - Check the six line types look genuinely different, fills stay inside their regions, papers read correctly, and labels stay legible.
  - Fix what looks wrong, and note each judgement call in the report.
- [ ] **Step 3: tests.** The contact-sheet script renders every example in every preset with no errors and no non-finite numbers.
- [ ] **Step 4:** run all three checks and the byte sweep, then commit as `feat(review): the style lab and contact sheets`.

### Task 7: Reference and handoff

- **Grammar header** (`parser/types.ts` or wherever directives are documented): document the `@style…` directives.
- **Handoff, "How the engine is put together":** add a section on `style/` and the pen, including **how to add a line type, fill or paper**: one file plus a registry entry.
- **Handoff, phase table:** add the visual pass part 1.
- [ ] **Step 1:** write both.
- [ ] **Step 2:** run all three checks, then commit as `docs: figure styles part 1 — reference and handoff`.

## Verification

1. All three checks clean, and the clean byte sweep identical to base after every task.
2. Six line types, seven fills, nine papers and three lettering faces are visibly distinct on the contact sheet.
3. Styled output is deterministic and exact at looseness 0.
4. The lab runs on the review harness, and no server is left running at the end.

## Out of scope

Movement (part 2), the written guideline (part 3), chalkboard and blueprint presets, styling the space or graphing engines, export and print, and legends.
