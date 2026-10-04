# Graph styles: media, themes, layers and the settings guide

*2026-10-04. Written by the space and paint session from Ben's brainstorm the same night. Status: draft for Ben's review. It builds on the figure styles design (`2026-09-30-figure-styles-design.md`), the painted figures design (`2026-10-02-painted-figures-design.md`) and graph engine v2 (`2026-09-21-graph-engine-v2-design.md`).*

## 0. What Ben asked for

Ben (2026-10-04): "what we're missing entirely is the other types of graphs, like for example ink drawing, clean, pencil, blackboard, marker, etc. … this includes other textures for backgrounds too."

His rulings in the brainstorm:

1. **Scope.** 3D first, with shared looks. The 2D graphs keep their place in the calc track's plan. Blackboard and the new backgrounds go into the shared style module, so every engine gets them.
2. **The stroke engine comes to the geometry engine unchanged.** "dont simplify the stroke engine … implement the stroke engine for the geometry engine." It is used **for fills only**, and "do not go outside the lines". The fill keeps "the opacity or value in tune so it doesnt stand out too much". The outlines stay a line type (whiteboard marker, pencil, …). There is no oil painting in the 3D figures engine.
3. **Colour belongs to the medium.** There are "separate coloring engines that match the theme (markers, colored pencils, chalk, clean, whatever else)". The media are clean, ink, graphite pencil, coloured pencil, marker, chalk (blackboard) and **whiteboard**. The oil painter stays the 3D painter.
4. **Whiteboard has its own brushes,** "not nearly as complex as the painting engine but still more than a basic colored pencil or ink", in **two types**: an outline, and a fill-in that fills in the colours.
5. **The theme.** "Osmosis has its own design engine … expect multiple colors, dark theme or light theme (shouldnt change blackboard), and custom colors, this involves backgrounds too so expect those to change colors."
6. **The theming engine will be overhauled.** "plan for the repo right now but make it easy to change and rewire up". The adapter must be "capable of everything but still works with the bare system."
7. **Everything is customisable per graph type and per theme.** That includes every Paint Lab setting. "give a guide for that so any claude code agent can understand what all the values mean and how much it effects it … a 2d figure can be customized to how rough the pencil strokes are, ect."
8. **Precedence.** A theme's setting for a graph type wins over the graph type's own default.
9. **Graph types** include a 2D table (real today, rough, will change) and a 2D flowchart (not real yet; reserve it).
10. **The tuning lab** gets a modest effort, "a little bit more than before". Ben will recycle it for the theme and design overhaul.

## 1. The pieces and their order

| # | Piece | Where it lives | Owner |
|---|---|---|---|
| A | **Foundation.** Covers the theme adapter, the media (colouring engines), the layer stack, the settings registry and its guide, the presets and the backgrounds. | `graph-engine/src/style/` | Shared. The style module belongs to the geometry session, and every change to it is agreed with that session before it lands. |
| B | **Geometry fills.** Brush fills by the stroke engine, and the whiteboard fill-in, for 2D and 3D figures. | `graph-engine/src/figure/`, plus a stroke-only mode in `space/paint/gl/` | Geometry's renderer. This session builds it, by agreement. |
| C | **3D looks.** Ink, graphite pencil, coloured pencil, marker, blackboard, whiteboard and clean, for the space engine. | `graph-engine/src/space/` | This session |
| D | **The Style Lab.** | `review/` | This session |

Each piece gets its own implementation plan, and B is planned only after the geometry session has agreed to it.

**Order.** A comes first. B and C follow in parallel. D grows alongside: its skeleton ships with A, and it gains each look as it lands. The baked painting (painted figures §14) finishes before any of this starts.

**Not in this spec.** Two things are left out:
- **Rendering hand-drawn 2D graphs and tables.** That belongs to the calc track's "goal 2" (the 2D visual pass) and the table's own rework. This spec gives them the layers, media, presets and backgrounds to draw with. It does not draw them.
- **Where a custom theme stores its style settings on the server.** That belongs to Ben's theming overhaul (§5.3).

## 2. Graph types

Each graph type is a key in the layer stack (§5) with its own defaults:

| Key | What | Status |
|---|---|---|
| `graph2d` | 2D function graphs (track 1) | Real |
| `table` | 2D tables | Real, rough, and expected to change. Keep its defaults thin. |
| `figure2d` | Geometry figures, flat | Real |
| `figure3d` | Geometry solid figures (projected SVG) | Real |
| `space` | The 3D calculus engine | Real. The oil painter is one of its looks. |
| `flowchart` | 2D flowcharts | Reserved. The key exists with an empty defaults slot. |

## 3. The theme adapter

`style/theme/adapter.ts` is **the only code that reads Osmosis's theme.** Everything else reads its output.

### 3.1 Its input: everything optional

`ThemeSource` describes everything a theme might provide, now or after the overhaul. **Every field is optional:**

```ts
interface ThemeSource {
  mode?: 'light' | 'dark'
  colours?: {                         // any subset; hex or OKLCH
    surface?, paper?, ink?, muted?, line?, lineStrong?, accent?, accentWash?, good?, bad?
    series?: string[]                 // categorical colours, any length
  }
  boards?: { blackboard?: string; greenboard?: string; whiteboard?: string }  // board colours
  media?: Partial<Record<MediumName, MediumColours>>   // per-medium colour overrides
  styles?: StyleLayers                // the theme's style settings: all graphs, and per graph type (§5)
  lettering?: { family?: string }
}
```

There are three ways in:
- `fromOsmosisTheme(palette, mode, preset?)` reads today's bare system: the resolved `Palette` from `render/palette.ts` (the app's 8 CSS colours for the mode) and, when present, a theme preset.
- `fromColours(source)` takes plain colours. The labs and the tests use it.
- After the overhaul, a new reader fills the same `ThemeSource`. Nothing downstream changes.

### 3.2 Its output: everything filled

`resolveTheme(source) → ThemeInput` fills every field. The values that are missing come from the bare system, derived in OKLCH:

- **`paper`** defaults to `surface`.
- **`series`** has 8 colours. The hues are spaced from the accent's hue (golden-angle steps), with lightness and chroma fitted to keep contrast with `surface` in this mode. `good` and `bad` take the nearest slots when the theme sets them. Today's hard-coded `SPACE_SERIES` becomes a fallback only.
- **Board colours** are derived from fixed board values (slate, green, white), tilted a little toward the theme's accent hue. The tilt is in hue only, with chroma capped low. **They are the same in light and in dark.**
- **Per-medium colours** are derived by each medium (§4). A theme may override any of them.

`ThemeInput` also carries a key: a hash of every resolved value. Caches (papers, baked fills) are keyed on it, so a theme change invalidates exactly what it should.

### 3.3 How a theme change reaches the engines

The host already rebuilds on any theme change: `GraphViewer` uses a `MutationObserver` on `<html>` plus the colour-scheme listener. That rebuild calls `fromOsmosisTheme`. The engines receive `ThemeInput`, never CSS.

This closes today's gap: `renderFigure` currently gets no base style from the app (`GraphViewer.tsx:151`).

## 4. The media (colouring engines)

`style/media/<name>.ts`, one module per medium. A medium decides how colour behaves in it. It turns `ThemeInput` and a role (a line, a fill, a point, a label, or series slot n) into that medium's colours and behaviour.

### 4.1 The contract

```ts
interface Medium {
  name: MediumName
  surface: 'paper' | 'blackboard' | 'greenboard' | 'whiteboard'   // board media bring their own surface
  colour(theme: ThemeInput, role: Role, settings): MediumColour   // fitted to the medium's own range and its surface
  overlap: 'normal' | 'multiply' | 'build' | 'lighten'             // how two strokes of it combine
  grain(settings): GrainSpec                                       // how it meets the paper's tooth: skips, speckle, streaks
  settings: SettingSpec[]                                          // its settings, in the registry (§6)
}
```

### 4.2 The seven media

| Medium | Colour range | Overlap | Grain and texture | Its line | Its fill |
|---|---|---|---|---|---|
| **clean** | Exact theme colours | normal | none | technical | flat |
| **ink** | Deep and dense, high contrast with the paper | multiply | slight feathering into rough paper | ink (wobble, taper, pressure) | hatch or crosshatch; brush fill (§8) |
| **graphite pencil** | Greys with a hint of the role's hue. Never saturated. | build (layers darken toward a graphite maximum) | strong tooth skips | pencil | hatch with grain |
| **coloured pencil** | The theme colour slightly desaturated and waxy, held a little light | build (layers deepen chroma first, then value) | tooth skips, with paper showing through | pencil, coloured | grainy layered hatch |
| **marker** | Saturated, mid lightness | multiply (overlaps darken) | streaks along the stroke, and ends that pool darker | marker | streaky flat tone |
| **chalk** (blackboard, greenboard) | Pastel and light: L 0.80–0.95, chroma ×0.5–0.7 of the theme colour | lighten (overlaps brighten, never darken) | speckled dusty edges and skips | chalk | side-of-the-chalk dusty tone, smudged |
| **whiteboard** | Dry-erase inks, saturated, mid to dark, fitted to the white board | multiply, lighter than marker | streaks, running dry, faint ghosting | **whiteboard outline** (§4.3) | **whiteboard fill-in** (§4.3) |

The oil painter (`paint`) stays the space engine's painted look (painted figures design). Its settings join the registry (§6).

### 4.3 The whiteboard brushes

These sit between pencil or ink and the full painter. They use the stroke engine (§8) with a **chisel-marker profile**:
- a flat chisel tip, so the stroke goes thick and thin with direction;
- no bristle spread;
- light streaks inside the stroke;
- ink that runs dry over a long stroke and comes back on a new one;
- darker where strokes overlap;
- a little ink pooling at the start and the end.

There are two types:
- **Outline:** a line type, the chisel-tip line along the figure's edges.
- **Fill-in:** a fill type. Back-and-forth chisel strokes colour a region, overlapping and darkening where they cross. They are clipped exactly to the region (§8.2).

The board shows **ghosting**: faint traces of erased marks. It is part of the whiteboard background (§7), seeded, never animated.

## 5. Layers and settings

### 5.1 The stack

Every setting resolves through one stack. The most specific value wins:

1. built-in defaults
2. the graph type's defaults
3. the theme, for all graph types
4. **the theme, for this graph type** (Ben's ruling: this beats the graph type's own default)
5. the document
6. the figure

The stack holds **every setting group**: line, fill, paper, lettering, the medium's colour settings, the 3D look's settings, the stroke engine's settings, and every Paint Lab setting under `paint.*`. `resolveStyle` (today `[base, figure]`) becomes this six-layer resolve. A layer may set a preset, which replaces the whole look below it, then any single settings. That keeps today's rule.

### 5.2 In documents

- `@style: blackboard` sets the preset.
- `@style-set: <setting path> <value>` sets any single setting. Examples: `@style-set: line.looseness 0.4` and `@style-set: paint.value.terminatorSoftness 0.4`.

The existing per-group directives (`@style-line: …`) stay as shorthands. Unknown names or values are refused with a message that names the valid ones, and the figure still draws, as in the figure styles design.

### 5.3 Where a theme keeps its style settings

The engine takes a theme's settings through `ThemeSource.styles`.

Until Ben's theming overhaul, the built-in themes (slate, forest, ember, plum) carry their style sets in code, and custom themes use the defaults. This avoids adding a server field that the overhaul would replace. The overhaul then supplies `styles` from wherever themes live.

## 6. The settings registry and the guide

### 6.1 One registry

Every setting in every engine is defined once. Each entry carries:
- `path`, `label`, `group`, `type`, `min`, `max`, `step`, `default`, `unit`;
- **`meaning`**: one plain sentence on what it does in the picture;
- **`interactions`**: the other settings it fights or amplifies, by path;
- **`appliesTo`**: the graph types and media it affects.

The Paint Lab's `PARAM_SCHEMA` and `CURVE_SCHEMA` and the figure styles' `TOKENS` become sections of the registry. They are not copied. A test fails when any setting lacks `meaning` or `appliesTo`.

### 6.2 Measured effect

`tools/settings-sweep` moves each setting across its range, in 9 steps, on standard test figures:
- the sphere on a table;
- the torus;
- the saddle;
- a 2D figure with a filled region;
- a 3D solid figure;
- a 2D graph, once its look exists.

At each step it records how far the picture moves:
- mean and 95th-percentile colour difference against the default;
- the value shift;
- the stroke count;
- the change in edge classes (painter only).

From those it writes, for each setting:
- an **effect rating**: *none* (mean ΔE < 0.005 across the range), *subtle* (< 0.02), *moderate* (< 0.06) or *strong*;
- **where the change happens**: the part of the range holding 80% of it;
- **where it saturates**, if it does.

The sweep is deterministic and seeded. It reruns when the registry changes. Its output is a committed JSON file the guide reads.

### 6.3 The guide

`docs/styles/GUIDE.md` and one page per engine are **generated** from the registry and the sweep:
- an overview of the layer stack and how to set things per graph type and per theme;
- one table per engine with the meaning, range, default, effect rating, where it works, and interactions;
- **recipes** for common asks: a softer terminator, rougher pencil, chalkier board, a calmer brush fill, more colour distortion;
- a **safe ranges** note per setting.

Hand-written prose (the recipes, the overview) lives in the registry or in small template files, so regeneration never loses it. The guide is copied to Learn (`spec/osmosis/graph-engine/`) whenever it changes.

## 7. Presets and backgrounds

### 7.1 Presets

- **New:** `coloured-pencil`, `blackboard`, `greenboard`, `whiteboard`.
- **Updated:** `ink`, `pencil` and `marker` stop hard-coding their ink and paper colours (`style/presets.ts`). They take them from their medium, so they follow the theme, custom colours included.
- **Unchanged:** `clean` stays exact. `paint` is the space engine's painter.

### 7.2 Backgrounds

All backgrounds come from the one seeded generator (`style/papers/generate/`). It builds structure first: an OKLab offset field plus tooth height, tileable. It colours that by the theme last. **Every background recolours with the theme and with custom colours.**

| Background | Structure | Colour |
|---|---|---|
| fine paper, rough paper | grain; fibres on rough | `ThemeInput.paper` |
| kraft | fibres and flecks | `paper`, pulled toward kraft brown |
| ruled notebook, graph, dotted | grain plus lines or dots drawn by hand (slightly uneven) | `paper`, with the lines in `line` |
| canvas, linen | as built (Paint Lab) | `paper` |
| **blackboard** | slate grain, a faint haze of erased chalk, dust gathered at the lower edge | board colour (§3.2) |
| **greenboard** | as blackboard, on green | board colour |
| **whiteboard** | gloss sheen, seeded ghosts of erased marks | board colour |

**Board backgrounds ignore light/dark.** In the 2D engines a background zooms with the drawing. In 3D it stays fixed on screen (decided 2026-10-01). The SVG figures carry the background as a tiled pattern image; the space engine draws it as a texture.

## 8. Geometry figures: brush fills by the stroke engine

### 8.1 What

A new fill type, **`brush`**, plus the whiteboard **fill-in**. The strokes are painted by the stroke engine, unchanged: bristles, paint load, dry-brush tails, wet pickup, relief, and the brush-load colour mix (a fresh mix per load). This applies to 2D figures and to the faces of 3D figures.

**Outlines are never brush strokes.** They stay the style's line type. The 3D figures engine gets no painter model: no value plan, planes or roles.

### 8.2 Inside the lines, in tune

**Inside.** Strokes are laid inside the region's shape. The painted image is then **clipped exactly to the region's outline**, so no bristle, tail or dry edge crosses it.

**In tune.** A fill reads as tone under the drawing:
- its value is pulled toward the paper (`fill.brush.valuePull`, default 0.35);
- its opacity is capped (`fill.brush.opacity`, default 0.7);
- its chroma is capped relative to the outline's (`fill.brush.chromaCap`, default 0.8×).

On 3D figures each face keeps the lit and shaded relationship the figure already has, applied softly.

**Layout.** Strokes in a region (or face) run in one direction: the shape's main axis, or the face's own edge direction. Their spacing is set for even coverage, from the region's area and the stroke width. The whiteboard fill-in lays back-and-forth chisel strokes along the same direction.

### 8.3 How it gets into the SVG

- The figure's pen collects brush-fill regions and their strokes in figure coordinates (3D figures arrive already projected) instead of writing SVG for them.
- After drawing, the stroke engine paints each layer's brush fills offscreen into a **transparent image**. The paint renderer gains a stroke-only, transparent-output mode: no G-buffer, no underpainting, no canvas.
- That image goes into the SVG at its layer's place, clipped by the region's `clipPath`. A figure stays one self-contained SVG string that embeds and exports as now.
- **Resolution.** The image is painted at the displayed size × the device pixel ratio. When a zoom settles (debounced), it is re-painted at the new scale. Images are cached by figure hash, scale and `ThemeInput` key.
- **Fallback.** With no WebGL2 (server export, old devices), a brush fill falls back to today's `wash` or `hatch` fill in the medium's colours. A figure always draws.
- **Determinism.** The same figure, seed and theme give the same strokes. Only small GPU pixel differences remain.

## 9. The 3D looks (space)

The looks are ink, graphite pencil, coloured pencil, marker, blackboard, whiteboard and clean. The rules are full illustration, in phases, with the data near-exact and the frame wild (Ben, 2026-10-01). The method follows the 2026-10-01 research (`npr-3d.md` in the session scratchpad; its conclusions are restated here).

### 9.1 Lines

Curves, axes, the frame, the grid and surface outlines are drawn in the medium's line, in the line shader:
- graphite grain;
- coloured-pencil tooth;
- marker streaks;
- chalk skips and speckle;
- the whiteboard chisel.

**Wobble** comes from one seeded noise field **anchored to the object**. Its phase is fixed to world position, and its amplitude is set in screen px, shrinking when the figure shrinks and never growing. Every primitive takes the same field at a shared point, so points stay on their curves and lines on surfaces move with them.

**Honesty.** Data curves wobble by at most 0.36 × stroke width, with endpoints pinned. Points, colormaps and readouts are exact. The frame and grid may go wild.

Nothing reseeds or swims under orbit. There is no per-frame jitter.

### 9.2 Surface outlines

The outlines are where the surface turns away from the eye: the zero crossings of n·v on the mesh, as the baked painting's silhouettes find them. Creases and borders are added. All are drawn as medium lines with the same wobble, so they inherit the hidden-line dashing.

### 9.3 Surface tone

Tone follows the scene's light. It is quantized into the medium's tone steps and laid by the medium's fill, anchored to the surface:
- **ink and graphite:** hatching in 2–3 tone layers that thicken toward shadow. It is built on the engine's existing per-fragment surface-grid code (a tonal art map without textures), with a fade as the spacing shrinks on screen.
- **coloured pencil:** grainy layered hatch.
- **marker:** streaky flat tone with darker overlaps.
- **chalk:** side-of-the-chalk dusty shading, lighter where lit (chalk adds light on a dark board).
- **whiteboard:** fill-in chisel strokes by the stroke engine, native in 3D.

### 9.4 Background and phases

- **Background:** the board or paper is fixed on screen and coloured by the theme (§7.2).
- **Phase 1:** lines, outlines and backgrounds.
- **Phase 2:** surface tone.
- **Phase 3:** the whiteboard and chalk stroke fills.

Clean stays today's look. The painter stays its own look.

## 10. The Style Lab

This is a modest build. Ben will recycle it as the viewer for his theme and design overhaul, so its pieces are kept general.

- **One page, every graph type.** It covers 2D graph (once its look exists), table, 2D figure, 3D figure and 3D space, with a flowchart placeholder.
- **Sliders are generated from the registry (§6).** There is no hand-built control per setting, so a new setting appears by itself. Each slider shows its `meaning` and effect rating on hover.
- **Theme switcher:**
  - light and dark;
  - the four built-in themes;
  - a **custom-colour picker** that feeds `fromColours` (§3.1);
  - a layer selector to edit the theme's settings for all graph types or for one.
- **Showcase grid:** every look on every graph type, in the current theme.
- **Save.** It writes the current layer as a style set (JSON): a built-in theme's set, or a document's.
- **Serving.** It runs on its own port. Ben's pinned 5182 is untouched.

Its parts (the registry-driven panel, the theme switcher, the showcase grid) are separate components with no lab-only state inside them, so the theme designer can reuse them.

## 11. Testing and verification

- **Theme adapter.**
  - The bare system (8 colours plus mode) resolves every field.
  - Each optional field overrides exactly what it names.
  - Board colours are equal in light and dark.
  - Series colours keep at least 3:1 contrast with `surface`.
  - The `ThemeInput` key changes with any colour.
- **Media.** For each medium:
  - its colours stay in its range for 20 random custom themes in both modes;
  - its overlap rule holds (a multiply medium darkens, chalk lightens).
- **Layers.** The six-layer precedence is tested per pair of layers, including Ben's rule that the theme's per-type setting beats the type default.
- **Registry.** Every setting has `meaning` and `appliesTo`. The sweep is deterministic, and its ratings are committed.
- **Brush fills.**
  - No painted pixel lies outside its region (a clip test against the region's path on rasterized output).
  - The value pull, opacity and chroma caps are measured.
  - The fallback is exercised with no WebGL2.
  - Figures without brush fills are byte-identical to today, under a golden test.
- **3D looks.**
  - Wobble is world-anchored: a 1° orbit moves no stroke's seed.
  - Data honesty: lateral wobble on data curves stays ≤ 0.36 × width.
  - Clean stays byte-identical.
- **Visual checks** are headless shots (never the browser pane), checked by eye at zoom (hand-drawn means imperfect).
- **Load.** `vitest --maxWorkers=2`, and every headless run is timed out and killed.

## 12. Later, not now

- **Media:** watercolour, blueprint, charcoal and pastel. Each would add as one medium module, one preset and one background.
- **The flowchart:** its looks, once it exists.
- **Hand-drawn 2D graphs:** the calc track's goal 2. **Table looks:** after the table rework.
- **Server storage of theme style settings:** with the theming overhaul.
- **An "alive" boiling mode:** off by design. Revisit only if Ben asks.

## 13. Open questions

1. **The kraft and greenboard colours** under custom themes. How far should a theme's hue pull them? This spec caps the tilt low. Ben tunes it in the lab.
2. **Brush fills and the paper's tooth.** Should paint catch on rough paper as dry-brush? This spec says yes, through the stroke engine's `dry`, on rough backgrounds only. Ben judges it.
