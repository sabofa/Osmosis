# Figure Styles — Design (Visual Pass, Part 1)

*2026-09-30. The first real design pass for Track 5's "line treatments", "paper and background textures" and "preset looks" (see the graph spec's Track 5 sketch), scoped to the SVG figure renderer and written so the graphing engine can adopt the same model later.*

## What this is for

A figure can be drawn in different looks: crisp and clean as today, rough ink, pencil, marker on notebook paper, and more. Each look has adjustable settings. Ben tunes the looks by eye in a style lab, and the settings he settles on become the visual guideline for figures, the space engine and everything after.

Delivered in three parts, in this order:
1. **Styles and the style lab.** This document.
2. **Movement:** pan and zoom feel (momentum, zoom toward the cursor, eased steps, limits, a smooth reset) and pointing and focus (hover highlights an element and its label; click selects).
3. **The visual guideline:** written from the tuned settings, once parts 1 and 2 have been judged.

## Decisions already taken with Ben

- **Who picks the look:** both. The viewer's app theme sets a default, a document can set its own, and a figure can pin its look with directives. Most specific wins.
- **What a style controls:** lines, fills, paper and background (with texture), lettering and colour. Movement is part 2.
- **First presets:** clean, ink, pencil, marker on notebook.
- **Looseness:** a setting, tuned by eye in the lab. The defaults below are a first guess to be judged.
- **Variety:** several distinct line types, fill types and paper textures, not one "sketchy" line.
- **Reuse:** the style model must be readable and renderer-independent, so the graphing engine can take it on later.

## The rules that don't bend

1. **Clean is today's output, byte for byte.** With no style directive and no theme style, every existing figure renders exactly as now. All existing tests stand untouched.
2. **Deterministic.** The same figure with the same style gives the same SVG. Every random choice comes from a seeded generator keyed by the element's identity (statement, object, piece) plus an optional `seed` setting. No `Math.random`.
3. **Stable under movement.** Styled geometry is generated once, in the figure's own drawing coordinates. Pan and zoom transform the finished SVG, so the wobble never reshuffles or crawls.
4. **Faithful at the exact end.** At looseness 0, every stroke starts and ends exactly on its true endpoints, arcs stay on their circles to within half a stroke width, and nothing overshoots. Looseness only ever adds deviation on top of that.
5. **Readable.** Labels, measures and the givens table stay legible in every style. Lettering may change face and take a slight tilt, but a label is never moved off its placed position.
6. **Clean stays exact geometry.** Clean keeps drawing arcs as SVG arc commands. Sketchy styles may draw arcs as smooth Bézier paths through points on the true arc; that is a drawing choice, not a geometric answer, and it never applies to clean.

## The style model

A **style** is five groups of settings. A **preset** is a named, complete set of values for all five.

### Line

| Setting | Meaning |
|---|---|
| `type` | `technical` · `ink` · `brush` · `pencil` · `marker` · `chalk` (see below) |
| `looseness` | 0 to 1: how far the stroke may stray from the true geometry (endpoint offset, overshoot, bowing) |
| `wobble` | 0 to 1: small, fast waviness along the stroke |
| `passes` | 1 to 3: how many times the stroke is drawn over itself |
| `width` | stroke width multiplier on the current weights |
| `variation` | 0 to 1: how much the width swells and thins along the stroke (pressure) |
| `taper` | 0 to 1: how much the ends thin out |
| `grain` | 0 to 1: texture broken into the stroke (graphite, chalk dust) |
| `opacity` | 0 to 1 |

**The six line types are genuinely different**, not the same line with different numbers:
- **technical:** a uniform-width, crisp line with square-ish ends and no wobble. It is clean's line, and it lets other presets keep precise lines.
- **ink:** a brush-pen line in solid ink: its width swells and thins with the hand's pressure, it tapers to fine points at both ends, and its edges are slightly bumpy, each side in its own way. No grain and no texture (revised 2026-09-30, below).
- **brush:** a calligraphic stroke drawn as a filled outline. It swells in the middle, tapers to points, and its width depends on direction.
- **pencil:** two or three light, slightly offset graphite passes, broken by grain, grey, and lower opacity.
- **marker:** a thick felt-tip line with round ends and slight translucency. Overlaps darken where strokes cross, and the ends blot slightly.
- **chalk:** a dusty, broken, speckled stroke with soft edges.

### Fill

| Setting | Meaning |
|---|---|
| `type` | `flat` · `hatch` · `crosshatch` · `stipple` · `scribble` · `wash` · `none` |
| `angle` | hatch direction in degrees |
| `spacing` | gap between hatch lines or stipple dots |
| `opacity` | 0 to 1 |

The fill types:
- **Hatch and cross-hatch** draw real lines in the current line type, clipped to the region.
- **Stipple** is seeded dots.
- **Scribble** is a hand-shading zig-zag.
- **Wash** is a soft, uneven, watercolour-like tint that darkens slightly at its edges.

### Paper

| Setting | Meaning |
|---|---|
| `type` | `none` · `clean` · `paper` · `rough-paper` · `canvas` · `graph` · `rough-graph` · `dotted` · `ruled` |
| `tint` | paper colour |
| `texture` | 0 to 1: grain or weave strength |
| `grid` | grid, dot or ruling spacing |

The paper types:
- **none** is transparent, for embedding.
- **clean** is flat paper colour.
- **paper** has a fine grain; **rough-paper** has a coarse grain with fibres.
- **canvas** has a woven texture.
- **graph** has minor and major grid lines; **rough-graph** has hand-ruled, uneven grid lines on grainy paper.
- **dotted** is a dot grid.
- **ruled** is notebook ruling with a margin line.

Paper sits behind everything and covers the whole visible area, so panning never reveals an edge.

### Lettering

| Setting | Meaning |
|---|---|
| `face` | `math` (a clean serif for mathematics) · `textbook` (a clean sans) · `hand` (a handwritten face) |
| `size` | size multiplier |
| `tilt` | 0 to 1: slight seeded rotation for the handwritten feel, a few degrees at most |

Fonts are named with fallbacks: a font the page has not loaded degrades to a system serif or sans, never to nothing. The style lab loads the chosen web fonts.

### Colour

| Setting | Meaning |
|---|---|
| `ink` | the main line colour (the preset's own, or the theme's) |
| `saturation` | 0 to 1.5: muted to vivid, applied to every colour the figure uses (ink, fills, accents, author `color:` choices) through OKLCH chroma, so hue and lightness hold |

### First presets (defaults to be judged in the lab)

| Preset | Line | Fill | Paper | Lettering | Colour |
|---|---|---|---|---|---|
| **clean** | technical, exact | flat | clean | math | as today |
| **ink** | ink, looseness 0.25, wobble 0.3, variation 0.75, taper 0.8, width 1.7 | hatch | paper | math | blue-black ink, saturation 0.9 |
| **pencil** | pencil, looseness 0.3, passes 2, grain 0.6, opacity 0.85 | hatch (pencil) | rough-paper | hand | graphite, saturation 0.4 |
| **marker** | marker, looseness 0.2, width 1.8, variation 0.2 | scribble | ruled | hand | marker colours, saturation 1.1 |

## Where a style comes from

Settings layer from least to most specific; each layer overrides only what it sets:
1. **Built-in default:** clean.
2. **App theme:** the viewer's theme, passed to the renderer as a base style.
3. **Document:** a document's pinned theme, when the document engine exists. Today it is the same base-style parameter.
4. **Figure directives:**

```
@style: pencil                 # start from a preset
@style-line: brush             # any single setting overrides the preset
@style-looseness: 0.4
@style-fill: crosshatch
@style-paper: rough-graph
@style-lettering: hand
@style-saturation: 0.6
@style-seed: 3                 # reroll the randomness, still deterministic
```

- Directive names are the setting names above, prefixed `style-`.
- An unknown preset, setting or value is refused with a message naming the valid ones. The figure still draws, in the style resolved without the bad directive.

## Architecture

### A shared, renderer-independent style module: `graph-engine/src/style/`

The graphing engine can take this over later, so it knows nothing about figures or SVG layers:
- `tokens.ts`: the settings types and their ranges.
- `presets.ts`: the named presets.
- `resolve.ts`: layering (default → app → document → figure) and validation.
- `random.ts`: the seeded generator, keyed by identity strings.
- `color.ts`: OKLCH saturation scaling.
- `lines/`: **one file per line type.** Each takes an abstract stroke (a chain of line, arc and cubic pieces in drawing coordinates) plus settings and a random source, and returns drawing primitives: outlines, polylines and dots.
- `fills/`: one file per fill type.
- `papers/`: one file per paper type.
- `lettering.ts`: font stacks and tilt.

Each file is small, commented and independent, so a new line type is a new file, not a new branch in a large one.

### The figure's drawing seam: a "pen"

- Today `figure/render.ts` calls the SVG emitters directly. It will call a **pen** instead, with methods to stroke a path, fill a region, draw a mark, draw text and lay the paper. Each call carries its element identity and layer.
- **The clean pen** forwards to today's emitters unchanged, which is how rule 1 holds.
- **The styled pen** runs `style/` and emits the result.
- The refactor is mechanical: the same calls, in the same order, through one interface.

### Textures

Grain, bleed, chalk dust and paper textures use SVG filters (`feTurbulence` with displacement or masking) and patterns, defined once per figure in `<defs>`. Their ids are derived from the figure's content, so two figures on one page cannot collide. Filters are used only for **texture**: they never move geometry, which comes from `lines/`.

## The style lab and contact sheets

- **The style lab** (`review/style-lab.html`, served by the review harness): pick any example (grouped as in the harness), pick a preset, and adjust every setting with sliders and pickers, including looseness and seed. The figure redraws live and keeps today's pan and zoom.
  - A "copy directives" box shows the `@style-…` lines for the current settings, so a tuned look pastes straight into a spec.
  - The URL records the settings, so a look can be sent as a link.
- **The contact sheet:** the same page has a "sheet" view drawing a set of representative figures in every preset side by side. A node script renders the same sheet to HTML, and headless Edge renders it to PNG, for Claude's checks. No browser pane and no page scripts are needed.

## Testing

- **Clean is byte-identical:** a before/after render sweep over every example and test spec under every view.
- **Determinism:** the same input and style give identical SVG; a different seed gives different SVG.
- **Faithfulness at looseness 0,** for every line type: strokes start and end exactly at their endpoints, and arc strokes stay within half a stroke width of the true circle.
- **Fills stay inside their regions:** hatch, stipple and scribble geometry is clipped to the region outline.
- **Resolution:** layering precedence, and refusal of an unknown directive while still drawing.
- **Colour:** saturation keeps hue and lightness; saturation 1 is the identity.
- **Every example renders** in every preset without errors or non-finite numbers.
- **Visual:** contact sheets rendered to PNG and inspected.

## Out of scope for part 1

- Movement (part 2) and the written guideline (part 3).
- Chalkboard and blueprint presets. Their line types and papers exist, and adding them later is a preset entry, not new machinery.
- Styling the space engine or the graphing engine. The shared module is built for them, but adoption is later.
- Exporting to PNG or PDF, and the print theme. Clean already serves print.
- Legends.

## Revised 2026-09-30 — imperfection (Ben's first look)

Ben's notes on the first contact sheets: *scribble is far too clean, it should be a little wild and unpredictable; ink looks fine but should have texture of its own, like a rough ink brush; and hatching, filling, basically everything should be a little less perfect.*

What changes:

1. **Fills get their own looseness: `roughness`** (fill group, 0 to 1, directive `@style-fill-roughness`, alias `@style-roughness`). Lines already have looseness; fills had nothing, which is why a hand-drawn outline sat around machine-perfect shading. At roughness 0 every fill draws exactly as before, byte for byte. Roughness only adds imperfection on top.
   - **Hatch and crosshatch:** each line strays a little from its place and its angle. Its ends fall short of the edge or run past it (the pen clips the overrun, so nothing leaves the region). Now and then a line is skipped or broken, and the spacing bunches and opens slowly across the family. Crosshatch's second family is not quite a quarter turn from the first.
   - **Scribble** is the wild one. Its turns overshoot and fall short unevenly, and its legs are uneven in spacing and bend. The turns are rounded, sometimes with a small loop, and the direction drifts across the region. At higher roughness, a second, sparser scribble at another angle goes over a patch of it.
   - **Stipple** clumps: its density varies in slow patches, and dot sizes vary more widely.
   - **Flat and wash** are laid slightly off register: the colour misses the line on one side and runs under it on the other. Flat also takes a faint mottle.
2. **Ink gets its rough-brush texture from `grain`,** which the ink line did not use before.
   - Its edges are ragged, each side independently.
   - Many strokes run dry toward their end: the tail splits into a few bristle strands with gaps between them, some running out early.
   - The ink texture knocks a few pinholes out of the line.
   - At least one strand always reaches the true end, so the faithfulness rule holds.
3. **Presets:** fill roughness ink 0.45, pencil 0.5, marker 0.6, clean 0 (not read; clean stays byte-identical).
4. **Rule 4 (faithful at the exact end) for fills:** at roughness 0, hatch and scribble marks lie inside the region as before. Above 0 they may run past its edge, and the pen's clip keeps what is drawn inside. Stipple centres are always inside.
5. **The contact sheet gains an "Imperfection" page:** hatch, crosshatch, scribble, stipple and flat at roughness 0, 0.5 and 1, and the ink line at variation 0, 0.5 and 1.

### Revised again, same day: ink has variance, not grain

Ben, with a reference sheet of brush-pen strokes: *"the pen should not have grain, it should have varience."* Item 2 above is withdrawn.
- Ink carries no texture: no pinholes, speckle or halo. There are no dry-brush strands, no end blots and no second pass. `grain` is not read by ink.
- The ink line is one solid outline whose width does the work, all following `variation`:
  - it swells and thins slowly with the hand's pressure, a few fat stretches and thin necks per stroke;
  - its ends taper to fine points over up to 30% of the stroke at each end (`taper`);
  - each edge has its own small bumps.
- At variation 0 and taper 0 it is an even ribbon. The spine is still the hand's, so the faithfulness rule is unchanged.
- The retired pinhole texture (`bleed`) is removed from `textures.ts`.
