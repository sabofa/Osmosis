# Graph Styles A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundation every hand-drawn look draws with:
- the theme adapter;
- the seven media (colouring engines);
- the six-layer settings stack;
- the settings registry, with a measured sweep and a generated guide;
- the new presets and backgrounds;
- a Style Lab skeleton.

**Architecture:**
- Everything lives in `graph-engine/src/style/` (owned by the geometry session, which reviews this plan and signs off before merge), plus `review/` for the lab and `tools/`/`docs/styles/` for the sweep and guide.
- One adapter turns any theme into a complete `ThemeInput`. Media turn `ThemeInput` plus a role into a colour. One registry describes every setting. One stack resolves them per graph type.
- The figure renderer stays pure and deterministic. Anything GPU- or page-dependent (paper tiles) is a host step keyed by content.

**Tech stack:** TypeScript, React (review labs), vitest, Vite, OKLab/OKLCH (`style/color.ts`, `space/oklab.ts`), `randomFor` seeding (`style/random.ts`).

**Spec:** `docs/superpowers/specs/2026-10-04-graph-styles-design.md` (approved by Ben 2026-10-04, amended with geometry the same day). Implementers read §§2–7 and §10, and the amendments in the status line.

**Geometry's sign-off:** 2026-10-04, on the plan at 4cf1f66, with 8 fixes. They are folded in here: the precedence sentence, no-theme defaults per medium, generated papers only with a theme, `@style-set` refuses out-of-range values, `renderFigure`'s optional trailing `theme`, the full role list including authors' colours, a 512 tile with browser compression, and `host.ts` kept out of the index. Geometry reviews the branch before merge.

## Global Constraints

**Byte-identity and pins**
- **Clean stays byte-identical:** `graph-engine/src/figure/cleanGolden.test.ts` passes untouched.
- **The fill pins** at roughness 0 in `style/fills/fills.test.ts` and **the ink pins** in `style/lines/lines.test.ts` stay. Any task that would move a pin stops and reports to the controller, who asks geometry first.
- **The ink line has no grain:** no speckle, pinholes or dry-brush (Ben, 2026-09-30). `lines/ink.ts` `texture()` stays null.

**Compatibility**
- **Old names keep working:** the paper names `paper`, `rough-paper`, `canvas`, `graph`, `rough-graph`, `dotted`, `ruled`, and every existing preset name, are aliases. Refusal messages list the new names.
- **`checkLayer`'s behaviour is kept:** a bad directive is refused by name, and the figure still draws.
- **Changing `renderFigure`'s shape migrates every caller in the same commit:** `GraphViewer.tsx`, `figure/contactSheet.ts`, `scripts/contact-sheet.ts`, `review/src/styleLab.tsx` and the figure tests.
- **Everything that consumes `TOKENS` stays green:** `readToken`, `directivesFor`, the style lab's controls and `presets.test.ts`. Either they keep working, or they move onto the registry in the same change.

**Theme**
- **Only `style/theme/adapter.ts` reads Osmosis's theme** (CSS colours via `Palette`). Nothing else reads theme tokens.
- **Board colours (blackboard, greenboard, whiteboard) are identical in light and dark** for the same theme colours.

**Engineering rules**
- **Deterministic:** seeding goes through `randomFor`. Never `Math.random` or clocks in `style/`.
- **No new runtime dependencies.** A PNG writer, if one is needed, is in-repo.

**Commands**
- Tests: `npx vitest run --maxWorkers=2 <files>` while iterating, and the full suite once per task.
- Typecheck: `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` in `graph-engine/`. Bare `tsc --noEmit` checks nothing.
- The 49-scene space sweep stays identical: `scratchpad/verify-main/scenes.mts`.

**Never**
- Port 5182 (Ben's pinned view) or the `milestone-a-paint-view` worktree.
- Browser tools. Visual checks are headless Edge from PowerShell, with a timeout and a process-tree kill.

**Git**
- Stage with explicit `git add` paths. Never stage `cli/bin/osmosis.js`. No bare `git stash`. No push, no merge.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `style/theme/types.ts` | `GraphType`, `MediumName`, `BoardName`, `ThemeSource`, `ThemeInput` | 1 |
| `style/theme/derive.ts` | Fills missing fields: paper, accentWash, series, boards, key | 1 |
| `style/theme/adapter.ts` | `fromOsmosisTheme`, `fromColours`, `resolveTheme` (the only theme reader) | 1 |
| `style/theme/contrast.ts` | WCAG contrast and OKLCH lightness fitting | 1 |
| `style/media/types.ts` | `Medium`, `Role`, `MediumColour`, `GrainSpec`, `MediumSettings` | 2 |
| `style/media/{clean,ink,graphite,colouredPencil,marker,chalk,whiteboard}.ts` | One medium each | 2 |
| `style/media/index.ts` | `MEDIA`, `mediumOf(name)` | 2 |
| `style/settings/types.ts` | `SettingSpec`, `SettingValue` | 3 |
| `style/settings/registry.ts` | `REGISTRY` assembled from `TOKENS`, `PARAM_SCHEMA`/`CURVE_SCHEMA`, media, boards and papers | 3 |
| `style/settings/meanings/*.ts` | Prose: `meaning` and `interactions` per path, per section | 3 |
| `style/layers.ts` | `SettingsLayer`, `StyleStack`, `resolveSettings`, `toStyle`, `toPaintParams` | 4 |
| `style/theme/builtinStyles.ts` | Style sets of the built-in themes (empty to start) | 4 |
| `style/resolve.ts` (modify) | `resolveStyle` becomes a wrapper over `resolveSettings`; `@style-set` | 4 |
| `parser/parseConfig.ts` (modify) | `@style-set:` parsing beside the `style-` branch | 4 |
| `style/presets.ts`, `style/tokens.ts` (modify) | New presets; `colour.medium`; aliases | 5 |
| `figure/styledPen.ts`, `figure/render.ts` (modify) | Role colours from the medium (replaces `paperPalette`) | 5 |
| `style/papers/generate/structures/*.ts` | New tile structures | 6 |
| `style/papers/generated.ts` | SVG paper: keyed `<pattern>` over a flat rect | 6 |
| `style/papers/host.ts` | DOM-only: fills keyed tiles with blob URLs; `inlinePaperTiles` for export | 6 |
| `style/papers/png.ts` | Minimal PNG writer (stored deflate, CRC32, Adler-32) | 6 |
| `graph-engine/tools/settings-sweep.mts` | The measured sweep, writing `docs/styles/sweep.json` | 7 |
| `graph-engine/tools/build-guide.mts` | Generates `docs/styles/*.md` from the registry and the sweep | 7 |
| `docs/styles/recipes/*.md`, `docs/styles/overview.md` | Hand-written prose the generator includes | 7 |
| `review/styles.html`, `review/src/styles/*` | The Style Lab skeleton (reusable components) | 8 |

## Order

```
1 → 2 → 3 → 4 → 5
1 → 6 (may run alongside 2–5)
3, 4 → 7
1, 3, 4 → 8
```

Never more than two heavy agents at once. Geometry signs off on this plan before Task 1 starts, and on the whole branch before it merges.

---

### Task 1: The theme adapter

**Files:**
- Create: `style/theme/types.ts`, `style/theme/derive.ts`, `style/theme/contrast.ts`, `style/theme/adapter.ts`.
- Test: `style/theme/adapter.test.ts`.

**Interfaces it produces:**
```ts
// style/theme/types.ts
export const GRAPH_TYPES = ['graph2d', 'table', 'figure2d', 'figure3d', 'space', 'flowchart'] as const
export type GraphType = (typeof GRAPH_TYPES)[number]
export const MEDIUM_NAMES = ['clean', 'ink', 'graphite', 'colouredPencil', 'marker', 'chalk', 'whiteboard'] as const
export type MediumName = (typeof MEDIUM_NAMES)[number]
export const BOARD_NAMES = ['blackboard', 'greenboard', 'whiteboard'] as const
export type BoardName = (typeof BOARD_NAMES)[number]
export type Hex = string // '#rrggbb'
export interface ThemeColours {
  surface: Hex; paper: Hex; ink: Hex; muted: Hex; line: Hex; lineStrong: Hex
  accent: Hex; accentWash: Hex; good: Hex; bad: Hex
  series: Hex[] // exactly SERIES_COUNT = 8 after resolving
}
export interface ThemeSource {
  mode?: 'light' | 'dark'
  colours?: Partial<ThemeColours>       // series may be any length here
  boards?: Partial<Record<BoardName, Hex>>
  media?: Partial<Record<MediumName, Partial<Record<RoleKey, Hex>>>>
  styles?: ThemeStyles                  // defined in Task 4 (style/layers.ts); typed as unknown here and narrowed there
  lettering?: { family?: string }
}
export type RoleKey = 'line' | 'hidden' | 'auxiliary' | 'point' | 'label' | 'measure' | 'caption' | 'givens' | 'highlight' | 'focus' | 'fill' | 'region' | 'shading'
export interface ThemeInput {
  mode: 'light' | 'dark'
  colours: ThemeColours
  boards: Record<BoardName, Hex>
  media: Partial<Record<MediumName, Partial<Record<RoleKey, Hex>>>>
  styles: unknown                       // passed through; Task 4 reads it
  lettering: { family: string | null }
  key: string                           // FNV-1a hex of every resolved value
}
// style/theme/adapter.ts
export function resolveTheme(source: ThemeSource): ThemeInput
export function fromColours(source: ThemeSource): ThemeInput            // = resolveTheme; the labs' and tests' door
export function fromOsmosisTheme(palette: Palette, mode: 'light' | 'dark', preset?: { id: string } | null): ThemeInput
```

**Rules:**
- **`fromOsmosisTheme` maps the palette.** `surface` = `palette.background`, `ink` = `axis`, `muted` = `muted`, `line` = `grid`, `lineStrong` = `gridStrong`, `accent` = `curve`, `good` = `segment`, `bad` = `point`. Hex numbers become `#rrggbb`. The style set for `preset.id` comes from `builtinStyles` (Task 4; until Task 4 lands, pass none).
- **`derive.ts` fills what is missing:**
  - `paper` = `surface`.
  - `accentWash` = `accent` mixed 85% toward `surface`, in OKLab.
  - **`series`** has 8 colours:
    - Hue n is the accent's OKLCH hue + n × 137.508°.
    - L starts at 0.55 (light) or 0.75 (dark). C is min(0.16, max(0.08, accent C)).
    - Then L moves away from `surface` in steps of 0.01 until the WCAG contrast is ≥ 3:1 (`contrast.ts`).
    - Where `good` or `bad` is set, it replaces the slot whose hue is nearest. When both pick the same slot, `bad` takes the next nearest.
  - **Boards** are fixed bases in OKLCH:
    - blackboard L 0.27, C 0.012, h 230;
    - greenboard L 0.33, C 0.050, h 160;
    - whiteboard L 0.97, C 0.004, h 250.

    Each is tilted toward the accent hue: Δh = clamp(the shortest signed angle from the board's hue to the accent's, −40°, 40°) × `BOARD_TILT` (0.5). Then C += 0.012 × min(1, accent C / 0.15), capped at 0.03, 0.07 and 0.012 respectively. **Mode is never read here.** An explicit `boards.*` in the source wins.
  - `key`: FNV-1a over a canonical JSON of every resolved field, including `mode` and the styles JSON.
- **`resolveTheme`** fills `mode` with `'light'` when absent, and takes explicit fields over derived ones.

**Tests** (each one written first, run to see it fail, then implemented):
- The bare system: `fromOsmosisTheme(LIGHT_PALETTE, 'light')` and `fromOsmosisTheme(DARK_PALETTE, 'dark')` resolve every field, with 8 hex series and 3 board hexes.
- **Board invariance:** the same `colours` with `mode` light against dark give byte-equal `boards`. A test across 20 seeded random themes.
- Series contrast is ≥ 3:1 against `surface` for 20 random themes in both modes.
- Each optional field overrides exactly what it names: setting `colours.accent` changes `accent`, `series` and `boards`, and leaves `ink`.
- `good` and `bad` take the nearest hue slots, with no duplicates.
- `key` changes when any colour changes by one unit, and is stable across calls.
- A source with only `mode` resolves, using the built-in palette for that mode.

- [ ] Write the tests above in `style/theme/adapter.test.ts`. Run them: they fail (no module).
- [ ] Implement `types.ts`, `contrast.ts`, `derive.ts` and `adapter.ts` as specified.
- [ ] Run the tests (pass), both tsc commands, and the full suite.
- [ ] Commit: `git add graph-engine/src/style/theme/` and `git commit -m "feat(style): the theme adapter — one reader of the Osmosis theme, every field derived from the bare system"`.

---

### Task 2: The media

**Files:**
- Create: `style/media/types.ts`, the 7 medium files, and `style/media/index.ts`.
- Test: `style/media/media.test.ts`.

**Interfaces it consumes:** `ThemeInput`, `MediumName`, `RoleKey`, `Hex` (Task 1). From `style/color.ts`: `toOklch`, `fromOklch`.

**Interfaces it produces:**
```ts
export interface Role { key: RoleKey; slot?: number; colour?: Hex }   // slot: a series index; colour: the author's own
export interface MediumColour { hex: Hex; opacity: number }           // opacity 0..1 of one stroke of it
export type Overlap = 'normal' | 'multiply' | 'build' | 'lighten'
export interface GrainSpec { skips: number; speckle: number; streaks: number; softEdge: number } // each 0..1
export type MediumSettings = Record<string, number>                    // keyed by the setting's short name
export interface MediumSettingSpec { key: string; label: string; min: number; max: number; step: number; default: number }
export interface Medium {
  name: MediumName
  surface: 'paper' | 'blackboard' | 'greenboard' | 'whiteboard'
  settings: readonly MediumSettingSpec[]
  colour(theme: ThemeInput, role: Role, settings: MediumSettings): MediumColour
  surfaceColour(theme: ThemeInput): Hex          // paper media: theme.colours.paper; board media: theme.boards[...]
  overlap: Overlap
  grain(settings: MediumSettings): GrainSpec
}
export const MEDIA: Record<MediumName, Medium>
export function defaultMediumSettings(name: MediumName): MediumSettings
```

**Rules:**
- **The base colour, before fitting:**
  - an explicit `role.colour`;
  - else `theme.media[name][role.key]`;
  - else `series[slot]` when `slot` is given;
  - else, by role:
    - line, hidden, label, measure, caption and givens take `ink`;
    - auxiliary takes `muted`;
    - point takes `bad`;
    - highlight, focus, fill, region and shading take `accent`.
  - **An author's own colour** (`color: red`) is a base colour like any other: it goes through the medium's fitting, so red on a blackboard comes out as a pastel chalk red.
- **Fitting:** each medium fits the base in OKLCH against its `surfaceColour` with these defaults (the per-medium settings in brackets):

| Medium | L | C | Contrast vs surface | Opacity | Overlap | Grain |
|---|---|---|---|---|---|---|
| clean | unchanged | unchanged | — | 1 | normal | all 0 |
| ink | moved away from the surface until ≥ 7:1 | ×0.9 [`chroma`] | ≥ 7:1 [`contrast`] | 1 | multiply | all 0, `softEdge` 0.15 [`edge`] |
| graphite | L away from the surface, to ≥ 4.5:1 | min(C, 0.02) [`hint`] | ≥ 4.5:1 | 0.85 | build | skips 0.5, speckle 0.2 [`grain`] |
| colouredPencil | L +0.05 toward the surface, then ≥ 3:1 | ×0.8 [`chroma`] | ≥ 3:1 | 0.8 | build | skips 0.45 |
| marker | clamp 0.45–0.65 | max(C, 0.12), in gamut | ≥ 3:1 | 0.9 | multiply | streaks 0.4 [`streaks`] |
| chalk | clamp 0.80–0.95 | ×0.6 [`chroma`, 0.5–0.7] | ≥ 4.5:1 vs the board | 0.9 | lighten | skips 0.4, speckle 0.6 |
| whiteboard | clamp 0.35–0.55 | max(C, 0.10) | ≥ 4.5:1 vs the board | 0.95 | multiply | streaks 0.35, dryness 0.3 [`dry`] |

- **Board media ignore `theme.mode`.** Chalk and whiteboard colours are byte-equal across light and dark for the same theme colours.
- **Every role gets a readable colour**, so B can retire `paperPalette`. That means everything a figure draws: lines, hidden and dashed lines, auxiliary lines, points, labels, measures, angle captions, the givens table, highlights and focus, region fills and shading, and authors' own colours.
- **No-theme defaults** (geometry, fix 2). Each medium carries the exact colours today's presets hard-code, used when the pen has no `ThemeInput`: ink `#1f2a44` on `#fbf8f0`, graphite `#232327` on `#f6f3ec`, marker `#1b3f8f` on `#fdfdf8`. clean uses the palette as today. New media pick their own defaults. Expose them as `noThemeColours(name): { ink: Hex; paper: Hex } | null`.

**Tests:**
- For 20 seeded random themes × 2 modes × all roles × 7 media: each output sits in its medium's L and C ranges (±0.005) and meets its contrast floor.
- Chalk and whiteboard: light and dark give byte-equal outputs.
- Clean is the identity: its output equals the base hex exactly.
- An explicit `role.colour` is fitted, never replaced, by a non-clean medium. `theme.media` overrides beat the series.
- `defaultMediumSettings` covers every spec key, and the defaults lie inside their ranges.

- [ ] Write the tests (red), implement, run them (green), then both tsc commands and the full suite.
- [ ] Commit `style/media/`: `feat(style): the media — seven colouring engines that fit theme colours to each medium and its surface`.

---

### Task 3: The settings registry

**Files:**
- Create: `style/settings/types.ts`, `style/settings/registry.ts`, `style/settings/meanings/style.ts`, `meanings/paint.ts`, `meanings/media.ts`, `meanings/boards.ts`.
- Test: `style/settings/registry.test.ts`.

**Interfaces it consumes:** `TOKENS` (`style/tokens.ts`), `PARAM_SCHEMA` and `CURVE_SCHEMA` (`space/paint/params.ts`), `DEFAULT_PAINT_PARAMS` and `getParam` (`space/paint/params.ts`), `MEDIA` (Task 2), `GRAPH_TYPES` and `MediumName` (Task 1).

**Interfaces it produces:**
```ts
export type SettingValue = number | string | number[][]          // number[][]: a curve's points
export interface SettingSpec {
  path: string            // 'style.line.looseness', 'paint.value.terminatorSoftness', 'media.chalk.chroma', 'board.tilt'
  label: string; group: string
  type: 'number' | 'choice' | 'colour' | 'curve'
  min?: number; max?: number; step?: number; choices?: readonly string[]
  default: SettingValue
  unit?: string
  meaning: string          // one plain sentence: what it does in the picture
  interactions: string[]   // other paths it fights or amplifies
  appliesTo: { graphTypes: readonly GraphType[]; media: readonly MediumName[] | 'all' }
}
export const REGISTRY: readonly SettingSpec[]
export function settingAt(path: string): SettingSpec | undefined
```

**Rules:**
- **Assembled, never copied.** Each `TOKENS` entry becomes `style.<group>.<key>` (the seed becomes `style.seed`), with its range and choices read from the token. Each `PARAM_SCHEMA` entry becomes `paint.<path>`, with its default read from `getParam(DEFAULT_PAINT_PARAMS, path)`. `CURVE_SCHEMA` entries become `paint.<path>` with type `curve`. Each medium's settings become `media.<name>.<key>`. The board settings become `board.tilt` and `board.<name>.chromaCap`.
- **Meanings.** `meaning` and `interactions` come from the `meanings/*.ts` tables, keyed by path, written by reading the code that consumes each setting.
  - A setting generated in a loop (the paint roles × their fields, the edge kinds × their weights) may take a templated meaning with the role or kind filled in.
  - Each meaning says what changes on screen, in Ben's terms: value, edge, stroke, colour, roughness. Not in code terms.
- **`appliesTo`:**
  - `style.*`: `figure2d` and `figure3d`, with `graph2d`, `table` and `space` added where the setting is generic (paper, colour, lettering).
  - `paint.*`: `space` only, media `'all'`.
  - `media.<name>.*`: every type, media `[name]`.
- **Duplicates.** Paths are unique; a test pins that.

**Tests:**
- Every `TOKENS`, `PARAM_SCHEMA`, `CURVE_SCHEMA` and media setting has exactly one registry entry. The counts match the sources, which proves nothing is dropped or doubled.
- Every entry has a non-empty `meaning` (at least 20 characters, not equal to its label), `appliesTo.graphTypes` with at least one type, and `interactions` that name only real paths.
- Numeric defaults lie inside [min, max].
- `settingAt` finds a deep paint path, a curve path and a media path.

- [ ] Write the tests (red), implement, then run tests, both tsc commands and the full suite.
- [ ] In the report, list the 10 meanings you were least sure of. The reviewer checks those against the code.
- [ ] Commit `style/settings/`: `feat(style): one settings registry — every setting in every engine, with what it means and what it touches`.

---

### Task 4: The six-layer stack and `@style-set`

**Files:**
- Create: `style/layers.ts`, `style/theme/builtinStyles.ts`.
- Modify: `style/resolve.ts`, `parser/parseConfig.ts` (beside the existing `style-` branch), and `figure/render.ts` (only what calling the stack requires).
- Test: `style/layers.test.ts`. Also keep `style/resolve.test.ts`, `style/presets.test.ts` and `figure/cleanGolden.test.ts` green.

**Interfaces it consumes:** `REGISTRY`, `settingAt` (Task 3), `ThemeInput` and `GraphType` (Task 1), `PRESETS` (`style/presets.ts`), `setParam` and `DEFAULT_PAINT_PARAMS` (`space/paint/params.ts`).

**Interfaces it produces:**
```ts
export interface SettingsLayer { preset?: string; set?: Record<string, SettingValue> }   // set: registry path → value
export interface ThemeStyles { all?: SettingsLayer; byType?: Partial<Record<GraphType, SettingsLayer>> }
export interface StyleStack {
  typeDefaults?: Partial<Record<GraphType, SettingsLayer>>   // built-in per-type defaults (empty to start)
  theme?: ThemeStyles                                       // from ThemeInput.styles
  document?: SettingsLayer
  figure?: SettingsLayer
}
export type ResolvedSettings = ReadonlyMap<string, SettingValue>   // every registry path → its value
export function resolveSettings(stack: StyleStack, graphType: GraphType): ResolvedSettings
export function toStyle(resolved: ResolvedSettings): Style          // the figure styles' Style
export function toPaintParams(resolved: ResolvedSettings): PaintParams
export function mediumSettingsOf(resolved: ResolvedSettings, name: MediumName): MediumSettings
export function layerFromStyleLayer(layer: StyleLayer): SettingsLayer   // compatibility
export const BUILTIN_THEME_STYLES: Record<string, ThemeStyles>           // builtin:slate|forest|ember|plum → {} to start
```

**Rules:**
- **Order:**
  1. registry defaults;
  2. `typeDefaults[type]`;
  3. `theme.all`;
  4. `theme.byType[type]`;
  5. `document`;
  6. `figure`.

  A layer's `preset` replaces every `style.*` value below it with that preset's look, then the layer's own `set` applies. That keeps today's rule. A preset never touches `paint.*` or `media.*`.
- **`resolveStyle([base, figure])` keeps its exact results.** It becomes: build a stack with `document = base`, `figure = figure`, resolve for `figure2d`, then `toStyle`. Existing tests pin this.
- **`@style-set: <path> <value>`.** Validate it against `settingAt`. Unknown paths and bad values are refused with a message naming the nearest valid paths, as `checkLayer` does, and the figure still draws. **An out-of-range number is refused, not clamped,** with the range in the message. That matches `applyStyleDirective` (`resolve.ts:103`), so the two directive forms agree. If clamping is ever wanted, change both together.
- **`renderFigure`.** Do NOT change its shape in this task unless the stack requires it. If it does, migrate every caller in the same commit (Global Constraints).

**Tests:**
- One precedence test per adjacent pair of layers, in the order above: `theme.byType[space]` beats `theme.all`, which beats `typeDefaults[space]`. Ben's rule is that a theme's setting beats a graph type's default. With all six layers setting `style.line.looseness`, the figure's value wins over everything.
- A preset at the document layer resets `style.*` from the layers below and leaves `paint.*` alone.
- The `resolveStyle` compatibility: every existing `resolve.test.ts` case passes unchanged.
- `@style-set` round trip. A valid paint path lands in `toPaintParams`. An unknown path gives an error naming a near path. An out-of-range value is refused, with the range in the error, and the figure still draws without it.
- `figure/cleanGolden.test.ts` passes untouched.

- [ ] Write the tests (red), implement, then run tests, both tsc commands and the full suite. Confirm the fill and ink pins are unchanged.
- [ ] Commit: `feat(style): the six-layer settings stack — defaults, graph type, theme, theme per type, document, figure — and @style-set`.

---

### Task 5: Presets, the medium in the look, and role colours in the figure pen

**Files:**
- Modify: `style/tokens.ts` (add `colour.medium`; aliases), `style/presets.ts` (new presets; ink, pencil and marker take their colours from their medium), `figure/styledPen.ts` (role colours from `MEDIA`), and `figure/render.ts` (`paperPalette` replaced by the medium's role colours).
- Test: `style/presets.test.ts`, `figure/styledPen.test.ts` (create if absent), and `figure/cleanGolden.test.ts` (untouched, green).

**Interfaces it consumes:** `MEDIA`, `Role` (Task 2), `ThemeInput` (Task 1), `toStyle` (Task 4).

**Interfaces it produces:**
- `ColourSettings.medium: MediumName`, default `'clean'`. It is a new token: `style.colour.medium`, a choice of `MEDIUM_NAMES`, with directive `medium`.
- `PRESET_NAMES` gains `colouredPencil`, `blackboard`, `greenboard` and `whiteboard`.
- **`renderFigure(statements, config, palette, baseStyle?, theme?: ThemeInput)`.** The new optional trailing parameter is additive, so no caller migrates. Do not route the theme through `baseStyle`.
- `styledPen(style, palette, theme?: ThemeInput)`: when `theme` is given and `style.colour.medium` is not `'clean'`, every role colour comes from `MEDIA[medium].colour(theme, role, settings)`, and the background comes from `surfaceColour(theme)`. When `theme` is absent, the medium's `noThemeColours` (Task 2) stand in for the theme, so the presets render exactly as today.

**Rules:**
- **The new presets:**

| Preset | Line | Fill | Paper | Medium | Lettering |
|---|---|---|---|---|---|
| colouredPencil | pencil | hatch | paper | colouredPencil | hand |
| blackboard | chalk | scribble | blackboard (Task 6; until it lands, `clean`) | chalk | hand |
| greenboard | chalk | scribble | greenboard | chalk | hand |
| whiteboard | marker (the chisel outline arrives in B) | scribble (the fill-in arrives in B) | whiteboard | whiteboard | hand |

  The `ink`, `pencil` and `marker` presets keep every line, fill and lettering value. Their `colour.ink` and `paper.tint` become `'theme'`, and their medium is set (`ink`, `graphite`, `marker`), so the colours now follow the theme through the medium.
- **When the pen has no `ThemeInput`** (node tests, old callers), it uses today's behaviour exactly. Without a theme, the existing presets' rendering is byte-identical to before.
- **`paperPalette`'s light/dark fallback** is replaced by the medium's role colours only when a `ThemeInput` is present.
- **Aliases.** Old paper and preset names keep parsing. `directivesFor` and the refusal messages list the new names.

**Tests:**
- `cleanGolden` untouched and green. The fill and ink pins unchanged.
- With no `ThemeInput`, `ink`, `pencil` and `marker` render byte-identically to before (a golden of the three presets × 3 examples, captured before the change in its own commit).
- With a `ThemeInput`:
  - on a blackboard, every role colour (line, label, point, measure, auxiliary) is light (L ≥ 0.75) and meets ≥ 4.5:1 against the board;
  - light and dark modes give byte-equal SVG for blackboard, greenboard and whiteboard;
  - an author's named colour (`color: red`) on a blackboard comes out as a pastel chalk red (L >= 0.80, hue within 25 degrees of red's).
- Adding `colour.medium` (and Task 6's `paper.tile`) to TOKENS changes `directivesFor`'s output. Expect `presets.test.ts` and lab snapshots to move. Re-pin them in this commit, with the reason in the message.
- Old names parse. An unknown preset's refusal lists `blackboard`.

- [ ] Commit the pre-change golden first: `test(figure): pin ink/pencil/marker without a theme before media`.
- [ ] Then the tests (red), the implementation, tests, both tsc commands, the full suite and the contact sheet (`scripts/contact-sheet.ts`), which must run. Commit: `feat(style): coloured pencil, blackboard, greenboard and whiteboard presets; every role coloured by its medium`.

---

### Task 6: Backgrounds — tile structures, keyed SVG papers, the host fill-in

**Files:**
- Create:
  - `style/papers/generate/structures/{paperFine,paperRough,kraft,notebook,graphPaper,dotted,blackboard,greenboard,whiteboard}.ts`;
  - `style/papers/generated.ts`;
  - `style/papers/host.ts` (DOM only);
  - `style/papers/png.ts`.
- Modify: `style/papers/generate/types.ts` (`GeneratedPaperType` grows), `style/papers/generate/index.ts`, `style/papers/index.ts` (new paper types; old names aliased), `style/tokens.ts` (`PAPER_TYPES` grows).
- Test: `style/papers/generate/structures.test.ts`, `style/papers/generated.test.ts`, `style/papers/png.test.ts`.

**Interfaces it consumes:** `ThemeInput` (Task 1). The generator's `PaperTile`, `colourisePaper` and `generatePaper`.

**Interfaces it produces:**
```ts
export type GeneratedPaperType = 'canvas' | 'linen' | 'paperFine' | 'paperRough' | 'kraft' | 'notebook' | 'graphPaper' | 'dotted' | 'blackboard' | 'greenboard' | 'whiteboard'
export function paperKey(type: GeneratedPaperType, seed: number, theme: ThemeInput, size: number): string
export function paperBaseColour(type: GeneratedPaperType, theme: ThemeInput): [number, number, number] // OKLab: boards from theme.boards, kraft pulled toward OKLCH(0.62, 0.06, 70) by 70%, others theme.colours.paper
// generated.ts (SVG, pure): <pattern id data-paper-key="<key>" width height patternUnits="userSpaceOnUse"><image data-paper-key href="" .../></pattern> over a <rect fill=paper colour>
// host.ts (browser only):
export function fillPaperTiles(root: ParentNode, theme: ThemeInput): Promise<void>   // generates each distinct key once per page (canvas → blob URL) and sets href
export function inlinePaperTiles(svg: string, theme: ThemeInput): Promise<string>    // for export: data URLs, each tile once
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray, deflate?: (raw: Uint8Array) => Uint8Array): Uint8Array  // png.ts: stored deflate by default; a zlib deflater may be passed in. CRC32 and Adler-32 are in-repo
```

**Rules:**
- **Structures** are seeded, tileable OKLab offset fields plus height, following the canvas and linen ones already built:
  - fine paper: low-amplitude grain;
  - rough paper: coarse grain plus fibres (reuse `fibres.ts`);
  - kraft: fibres plus sparse dark flecks;
  - notebook, graph and dotted: a grain tile only. Their rulings are SVG lines drawn over the tile with a slight hand waver (reuse the rough-graph code), coloured `theme.colours.line`;
  - blackboard and greenboard: slate grain plus low-frequency "erased haze" blotches (L +0.02–0.05, seeded);
  - whiteboard: a faint large-scale gloss gradient plus 3–6 seeded ghost marks per tile (faint arcs and scribbles, L −0.01 to −0.03).
- **Board tray dust** is not in the tile. It is a separate gradient in the SVG paper at the bottom of the figure's view box (`generated.ts`), seeded.
- **Board papers never read `theme.mode`.**
- **The SVG output is pure:** the same inputs give a byte-identical string. Every keyed tile sits over a flat rect in the paper or board colour, so node output is complete without the host.
- **Generated papers apply only when a `ThemeInput` is present** (geometry, fix 3, option a). With no theme, the old names (`paper`, `rough-paper`, `ruled`, ...) keep today's SVG papers exactly, so Task 5's no-theme golden holds, and node output stays stable until the host wiring exists. With a theme, the old names resolve to the generated types. The new names (`kraft`, `blackboard`, ...) with no theme draw their flat rect only.
- **Tile size.** It defaults to **512** (range 256–1024), as a setting (`style.paper.tile`) added to `TOKENS` and the registry. A figure spans about 640 units, so smaller tiles repeat visibly in their low-frequency features: haze, ghosts, flecks. The pattern scales with the figure, so it zooms with the drawing. Check by eye for visible repeats in a headless shot at real zoom (Task 8).
- **Encoding.** For an export, `inlinePaperTiles` compresses with `CompressionStream('deflate')` where the browser has it, with `png.ts`'s stored deflate as the fallback. A stored 512 tile is about 1.4 MB.

**Tests:**
- Each structure: deterministic (the same seed gives byte-equal tiles), tileable (the edge columns and rows continue across the wrap within a tolerance), and an offset mean ≈ 0.
- Board base colours: light and dark give byte-equal tiles. `paperBaseColour` follows `ThemeInput` (a changed `paper` colour changes paper tiles but not board tiles; a changed accent tilts boards slightly).
- `generated.ts`: a pure, byte-stable SVG string with the right key. Old paper names resolve to the new types.
- `png.ts`: `encodePng` output decodes. Verify with a tiny in-test decoder for stored blocks; the CRC and Adler checksums are correct.
- `host.ts`: run under jsdom if the repo's vitest supports it (check `vitest.config`). Otherwise, unit-test its pure key-collection helper only, and verify by headless shot in Task 8. **`host.ts` is DOM code: keep it out of `style/index.ts`'s exports,** so node imports never pull it in.
- With no `ThemeInput`, the figure SVG for every old paper name is byte-identical to before (the papers' existing tests, plus Task 5's golden).

- [ ] Write the tests (red), implement, then run tests, both tsc commands, the full suite and the contact sheet.
- [ ] Commit: `feat(style): backgrounds — paper, kraft, notebook, graph, dotted and the three boards, from the seeded generator, referenced by key`.

---

### Task 7: The settings sweep and the generated guide

**Files:**
- Create: `graph-engine/tools/settings-sweep.mts`, `graph-engine/tools/build-guide.mts`, `docs/styles/overview.md`, and `docs/styles/recipes/{softer-terminator,rougher-pencil,chalkier-board,calmer-brush-fill,more-colour-distortion}.md`.
- Generated (committed): `docs/styles/sweep.json`, `docs/styles/GUIDE.md`, `docs/styles/paint.md`, `docs/styles/figures.md`, `docs/styles/media.md`, `docs/styles/backgrounds.md`.
- Test: `style/settings/guide.test.ts`.

**Interfaces it consumes:**
- `REGISTRY` (Task 3), `resolveSettings`, `toPaintParams` and `toStyle` (Task 4), `MEDIA` (Task 2), `generatePaper` and `colourisePaper` (Task 6).
- For paint: `paintFrame` and the fixture G-buffers in `space/paint/model/valueFinalFixture.ts` and `testing.ts`.
- For figures: `renderFigure` on the figure examples (`figure/contactSheet.ts`, `SHEET_EXAMPLES`).

**Rules (the sweep, per engine):**
- **`paint.*`:** at 9 evenly spaced values (curves: 3 shapes: identity, raised and lowered), run `paintFrame` on the sphere-on-table fixture plus two more fixture views, and compare against the defaults:
  - mean and p95 OKLab ΔE of the stroke colours, matched by particle and role;
  - the mean value shift;
  - the stroke-count ratio;
  - the change in edge-class histogram (L1).
- **`style.*` (figures):** at 9 values, render 3 examples to SVG and compare with the default:
  - path-point displacement (mean px, sampled along every path);
  - ΔE of every distinct fill and stroke colour;
  - the element-count ratio.
- **`media.*`:** at 9 values, compute ΔE of each role's colour across 6 fixed themes (the light, dark and 4 built-in palettes).
- **`board.*` and `style.paper.*`:** at 9 values, ΔE of the tile's mean colour and change in its L standard deviation.
- **Rating:**
  - colour engines: *none* (max mean ΔE < 0.005), *subtle* (< 0.02), *moderate* (< 0.06), otherwise *strong*;
  - geometry settings: *none* < 0.1 px, *subtle* < 0.75, *moderate* < 2.5, otherwise *strong*;
  - per setting, also: the "active range" (the smallest sub-range holding 80% of the cumulative change) and "saturates" (the last 2 steps add < 5% of the change).
- **Seeded and deterministic.** It writes `docs/styles/sweep.json`, sorted by path. It runs single-threaded (it is a script, not a test), and its run time is reported.
- **`build-guide.mts`:**
  - `GUIDE.md` holds the overview: the layer stack, how to set a value per graph type and per theme, and `@style-set` examples.
  - One page per engine: a table of path, label, meaning, range, default, unit, rating, active range, interactions and applies-to.
  - The recipes are included verbatim.
  - A "safe range" column equals the active range widened by one step.
  - The output is deterministic, sorted by group then path.

**Tests:**
- `build-guide` on the committed `sweep.json` reproduces the committed `docs/styles/*.md` byte for byte, so the guide can't drift from the registry.
- Every registry path appears in exactly one engine page.
- The rating function is checked against hand cases.

- [ ] Write the tests (red), then the scripts. Run the sweep, and record its time in the report. Run the guide. Tests, both tsc commands, full suite.
- [ ] Commit `tools/`, `docs/styles/` and `style/settings/guide.test.ts`: `feat(style): the settings sweep and the generated guide — what every value means and how much it moves the picture`.

---

### Task 8: The Style Lab skeleton

**Files:**
- Create: `review/styles.html`, `review/src/styles/StylesPage.tsx`, `review/src/styles/SettingsPanel.tsx`, `review/src/styles/ThemeSwitcher.tsx`, `review/src/styles/LayerSelector.tsx`, `review/src/styles/Showcase.tsx`, `review/src/styles/styleSets.ts`.
- Modify: `review/vite.config.mts` (the page input, plus a dev-only `POST /__styles/save` with the same origin and media-type checks as `/__paint/tuning`), and `review/index.html` (a tab).
- Test: `review/src/styles/styleSets.test.ts`, plus a headless shot.

**Interfaces it consumes:** `REGISTRY`, `resolveSettings`, `toStyle` and `StyleStack` (Tasks 3–4), `fromColours` and `fromOsmosisTheme` (Task 1), `PRESETS`, `renderFigure`, `fillPaperTiles` (Task 6), the space engine's clean renderer, and `docs/styles/sweep.json` (Task 7, optional: show ratings when present).

**Rules:**
- **`SettingsPanel`** renders controls for any list of `SettingSpec`: number sliders, choices, colours, and curves as a read-only preview for now. It groups by `group` and shows `meaning`, plus the rating when the sweep is present, on hover. It holds NO lab state: it takes `values` and `onChange` props. It is reused by the theme designer later.
- **`ThemeSwitcher`:** light and dark, the 4 built-in themes (`web/src/lib/builtinThemes.ts` tokens through the adapter), and custom colours (pickers for every `ThemeColours` field plus boards). It produces a `ThemeInput` via `fromColours`. Also props-in, events-out.
- **`LayerSelector`** picks which layer is being edited: theme (all), theme for one graph type, or document. Values outside the edited layer show as inherited.
- **`Showcase`** is a grid: graph types as rows, presets as columns.
  - `figure2d` and `figure3d` use `renderFigure` on two examples each, with `fillPaperTiles` run on the result.
  - `space` uses clean only, until C.
  - `graph2d`, `table` and `flowchart` show a labelled placeholder cell.
- **Save** writes the edited layer as JSON to `graph-engine/src/style/theme/builtinStyles/<themeId>.json`, or downloads a document layer. Through the dev endpoint only.
- **Served by the review app.** Shots use port 5191: `npx vite --config review/vite.config.mts --port 5191 --strictPort`. Never 5182.

**Tests:**
- `styleSets` round trip: save then load gives an equal layer, and an invalid file is refused with a message.
- A headless Edge shot of the page in light, dark and one custom theme, with a blackboard and a whiteboard column visible, saved to `.superpowers/sdd/2026-10-04-graph-styles-a/shots/task8-*.png`. Each run gets a timeout and a process-tree kill.

- [ ] Write the tests (red), implement, then run tests, both tsc commands, the full suite and the shots.
- [ ] Commit `review/` (explicit paths): `feat(review): the Style Lab — every setting from the registry, any theme through the adapter, every look on every graph type`.

---

## Self-review (done at writing)

- **Spec coverage:**

  | Spec | Plan |
  |---|---|
  | §2 graph types | Task 1 |
  | §3 adapter | Task 1 |
  | §4 media | Task 2 |
  | §5 layers | Task 4 |
  | §5.2 directives | Task 4 |
  | §5.3 built-in theme styles | Task 4 |
  | §6 registry | Task 3 |
  | §6.2–6.3 sweep and guide | Task 7 |
  | §7.1 presets | Task 5 |
  | §7.2 backgrounds | Task 6 |
  | §10 lab | Task 8 |
  | §11 tests | spread across the tasks |

  §8 (geometry fills) and §9 (3D looks) are pieces B and C, with their own plans. The whiteboard outline, the fill-in and the brush fill are B; the presets name their placeholders.
- **Type consistency:** `ThemeInput`, `MediumName`, `GraphType`, `RoleKey`, `SettingValue`, `SettingsLayer`, `ThemeStyles` and `paperKey` are used with the same names throughout.
- **Placeholder scan:** none left. The "until B" items are named fallbacks, not TODOs.
