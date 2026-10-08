# Theming Foundation Implementation Plan

> **For agentic workers:** run this plan under Learn `build/osmosis/AGENT-SYSTEM.md` (subtasks → batches → one Sonnet 5.5 implementer per batch, one Sonnet review per task, two fix rounds each with its own re-review). Steps use checkbox syntax. The ledger is `.superpowers/sdd/2026-10-07-theming-foundation/progress.md`. Subtask ids (T3.2 …) are the unit of dispatch.

**Goal:** Build sub-project 1 of the theming overhaul: a pure-TypeScript `theme-core` package (manifest, three-tier token registry, resolution, light/dark/sun mode, emitters and engine contracts), plus server storage/sync/API, MCP tools, `/theme` commands and the web apply path, with the old token names kept as aliases so no existing CSS changes.

**Architecture:** `theme-core` is a new npm workspace beside `cli-core` (no DOM, no deps beyond TypeScript, built to `dist/`, NodeNext, `.js` import suffixes). Server, web and cli-core import it. A theme is a `ThemeManifest` (seeds + dials + fonts + overrides + css + graph + reserved slots). `resolve()` derives every registry token for both modes in OKLCH with provenance; emitters turn that into CSS vars (+ old-name aliases), the legacy 8-token shape, a graph `ThemeSource` and document tokens.

**Tech Stack:** TypeScript 5.7, vitest 3 (≤2 workers), node:sqlite (server), React 19 + Vite (web), zod (MCP).

**Spec:** Learn `spec/osmosis/theming/designs/2026-10-07-theming-overhaul-design.md` (call it **SPEC**; sections are quoted as SPEC §n). Read §0 and §3 of it. Learn lives at `C:\Users\benif\Learn`.

## Global Constraints

- **Existing CSS stays untouched** except `web/src/index.css` (SPEC §0.18, §3.11). Old names `--bg --surface --ink --muted --line --line-strong --accent --accent-wash --good --bad --danger --heat-0..4` keep working as aliases.
- **`builtin:osmosis` renders exactly like today's default** (all 8 tokens + `--heat-0..4` + `--good` + `--bad`, both modes; values in Task 6).
- **A converted legacy custom theme resolves to exactly its old 8 values in both modes**; its `custom_css` survives as `css` (SPEC §3.1).
- **theme-core is pure**: no DOM, no node-only APIs, no network; `tsconfig` has `types: []`, lib ES2022 only.
- **The contrast guard warns, never blocks** (SPEC §3.5). Only structural/type errors refuse a save.
- **Do not touch** `graph-engine/src/style|figure|space` (not on `main` anyway), `document-engine` internals, or any CSS file but `index.css`.
- Reserved manifest slots (`ambience`, `sounds`, `assets`, `graph.papers`, font `{asset}`) are **stored and returned unchanged, never interpreted**.
- Slate and plum built-ins are deleted; an active id naming them reads as `builtin:osmosis`.
- Tests: `vitest run --maxWorkers=2`; typecheck per package (`tsc -p … --noEmit`; web: `npx tsc -p tsconfig.app.json --noEmit`). Commit on `theming/foundation`; **stage only your own paths** (`git add <paths>`, never `-A`); no push, no merge, no deploy. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never kill processes you did not start. Heavy agents ≤2 at once (Ben's PC).

## Decisions made in this plan (deltas from SPEC, to log in DELTA-FROM-SPEC when built)

1. **Legacy columns are kept, not dropped.** SPEC §3.6 says migration 024 drops `theme.tokens`/`custom_css`. Instead they stay and are rewritten on every save as a **mirror** (`toLegacyTokens(resolved)` + `manifest.css`). Old local nodes then sync from the new canonical with no protocol branching; `PROTOCOL_VERSION` still bumps to 2 as information. The TS conversion step runs inside `migrate()` after the SQL loop, idempotent (`WHERE manifest IS NULL`).
2. **Location lives in `theme_setting`** (new column `location TEXT`, synced in the pull as `theme_location`), not in a generic config store. Route `PUT /api/themes/location`.
3. **cli-core depends on theme-core** (for sun times and `resolve` in `theme show` / `theme tokens`). Build order becomes theme-core → cli-core → cli → web → server.
4. **`Ui` grows three methods** (`setThemeBlend`, `requestLocation`, `themeState`) and `setThemeMode` widens to include `'sun'`.

## Package map

| Path | Responsibility |
|---|---|
| `theme-core/src/colour.ts` | OKLCH parse/format, mix, contrast, `fitLightness` |
| `theme-core/src/sun.ts` | sun position, `sunTimes`, `season`, `altitudeAt` |
| `theme-core/src/manifest.ts` | `ThemeManifest` & seed/dial/font types, defaults, `THEME_SCHEMA` |
| `theme-core/src/migrate.ts` | legacy row → manifest; `toLegacyTokens` |
| `theme-core/src/registry/*.ts` | `TokenDef` type + the token tables (colour, type, shape…, graph, doc, component); `index.ts` exports `TOKENS`, `tokenByName` |
| `theme-core/src/resolve.ts` | `resolve(manifest)` → `ResolvedTheme` (both modes, provenance, key) |
| `theme-core/src/mode.ts` | `modeAt`, `blendMaps` |
| `theme-core/src/emit.ts` | `toCssVars`, `toStylesheet`, `ALIASES` |
| `theme-core/src/contracts.ts` | `toGraphThemeSource`, `toDocumentTokens` |
| `theme-core/src/builtins/*.ts` | `osmosis`, `forest`, `ocean`, `ember` manifests; `BUILTINS` |
| `theme-core/src/validate.ts` | `validate(manifest)` → `Report` |
| `theme-core/scripts/gen-docs.ts` | writes `docs/theming/TOKENS.md` from the registry |
| `server/src/domain/themes.ts` | storage/sync (rewritten) |
| `server/src/db/migrate.ts` + `migrations/024_theme_manifest.sql` | schema + legacy conversion hook |
| `web/src/theme/*` | `ThemeProvider`, `applyTheme` (pure builder), hooks shims |

---

## Task 0: Scaffold `theme-core` and wire the workspace

**Files:** Create `theme-core/package.json`, `theme-core/tsconfig.json`, `theme-core/src/index.ts`, `theme-core/src/smoke.test.ts`; Modify root `package.json` (workspaces), `deploy/install.sh:56,72-73`, `DEPLOY.md:153`, `server/package.json`, `web/package.json`, `cli-core/package.json` (deps `"theme-core": "*"`).
**Interfaces — Produces:** workspace `theme-core`, scripts `build`, `typecheck`, `test`.

### T0.1 — package, workspace, install (≤60 lines)
- [ ] `theme-core/package.json`: copy `cli-core/package.json` (type module, `main ./dist/index.js`, `types ./dist/index.d.ts`, `exports`), name `theme-core`, scripts `build: tsc -p tsconfig.json`, `typecheck: tsc -p tsconfig.json --noEmit`, `test: vitest run --maxWorkers=2`; devDeps `typescript ^5.7.3`, `vitest ^3.0.0`.
- [ ] `theme-core/tsconfig.json`: copy `cli-core/tsconfig.json` verbatim (NodeNext, `types: []`, `rootDir src`, excludes `*.test.ts`; also exclude `scripts`).
- [ ] Root `package.json` workspaces: add `"theme-core"` before `"cli-core"`. Add dep `"theme-core": "*"` to `server`, `web`, `cli-core`.
- [ ] `deploy/install.sh`: build `theme-core` before `cli-core` (`npm run build --workspace=theme-core`); add to the workspace list at line 56. `DEPLOY.md:153`: add `--workspace=theme-core`.
- [ ] `src/index.ts`: `export const THEME_SCHEMA = 1`. `src/smoke.test.ts`: `expect(THEME_SCHEMA).toBe(1)`.
- [ ] In the worktree run `npm install`, then `npm run build --workspace=theme-core` and `npm run test --workspace=theme-core`. Expected: 1 test passes, `dist/index.js` exists, and `node -e "import('theme-core')"` from `server/` resolves.
- [ ] Commit: `feat(theme-core): scaffold the package and wire the workspace`.
**Acceptance:** build + test + typecheck green; `server`, `web`, `cli-core` can `import 'theme-core'`.

---

## Task 1: Colour maths and the sun (pure)

**Files:** Create `theme-core/src/colour.ts`, `colour.test.ts`, `sun.ts`, `sun.test.ts`.

### T1.1 — OKLCH colour module (~150 lines)
**Produces (exact):**
```ts
export interface Oklch { l: number; c: number; h: number; a: number }   // l 0..1, c ≥0, h degrees 0..360, a 0..1
export function parseColour(s: string): Oklch            // '#rgb' '#rrggbb' '#rrggbbaa' 'oklch(0.7 0.1 140)' 'oklch(70% 0.1 140 / 0.5)'; throws Error on junk
export function toHex(c: Oklch): string                  // '#rrggbb', or '#rrggbbaa' when a<1; out-of-gamut → reduce chroma by bisection until in sRGB
export function mix(a: Oklch, b: Oklch, t: number): Oklch   // OKLab interpolation (not hue-lerp); t=0→a, t=1→b; alpha lerped
export function withL(c: Oklch, l: number): Oklch
export function withC(c: Oklch, k: (c: number) => number): Oklch
export function withH(c: Oklch, h: number): Oklch
export function withA(c: Oklch, a: number): Oklch
export function luminance(c: Oklch): number              // WCAG relative luminance of the sRGB colour (alpha ignored)
export function contrast(a: Oklch, b: Oklch): number     // WCAG ratio 1..21
export function fitLightness(c: Oklch, against: Oklch, min: number): Oklch
//   returns c with only L changed so contrast(result, against) ≥ min; moves L away from `against`'s lightness; if impossible returns the L extreme (0 or 1)
export function isHex(s: string): boolean
export function hexToOklch(h: string): Oklch             // = parseColour for hex
```
Conversion constants (Ottosson): linear sRGB→LMS `l=.4122214708r+.5363325363g+.0514459929b; m=.2119034982r+.6806995451g+.0883024619…` — use these exact matrices:
```
l = 0.4122214708 r + 0.5363325363 g + 0.0514459929 b
m = 0.2119034982 r + 0.6806995451 g + 0.1073969566 b
s = 0.0883024619 r + 0.2817188376 g + 0.6299787005 b      (then cbrt each → l_ m_ s_)
L = 0.2104542553 l_ + 0.7936177850 m_ − 0.0040720468 s_
a = 1.9779984951 l_ − 2.4285922050 m_ + 0.4505937099 s_
b = 0.0259040371 l_ + 0.7827717662 m_ − 0.8086757660 s_
inverse: l_=L+0.3963377774a+0.2158037573b ; m_=L−0.1055613458a−0.0638541728b ; s_=L−0.0894841775a−1.2914855480b ; cube each
r= 4.0767416621l −3.3077115913m +0.2309699292s ; g=−1.2684380046l +2.6097574011m −0.3413193965s ; b=−0.0041960863l −0.7034186147m +1.7076147010s
sRGB transfer: lin→srgb v<=0.0031308 ? 12.92v : 1.055 v^(1/2.4) − 0.055 ; inverse v<=0.04045 ? v/12.92 : ((v+0.055)/1.055)^2.4
```
- [ ] Write failing tests (`colour.test.ts`):
```ts
it('hex round-trips for 8-bit colours', () => {
  for (const h of ['#000000','#ffffff','#c65d22','#17170f','#eef1e5','#2f7a4f','#6fbf8a','#ff8a3d'])
    expect(toHex(parseColour(h))).toBe(h)
})
it('white vs black contrast is 21', () => expect(contrast(parseColour('#fff'), parseColour('#000'))).toBeCloseTo(21, 1))
it('mix endpoints', () => { const a=parseColour('#c65d22'), b=parseColour('#eef1e5')
  expect(toHex(mix(a,b,0))).toBe('#c65d22'); expect(toHex(mix(a,b,1))).toBe('#eef1e5') })
it('out-of-gamut oklch comes back in gamut', () => expect(toHex(parseColour('oklch(0.7 0.4 140)'))).toMatch(/^#[0-9a-f]{6}$/))
it('fitLightness reaches the target ratio', () => {
  const bg = parseColour('#fbfcf8'); const f = fitLightness(parseColour('#9aa09a'), bg, 4.5)
  expect(contrast(f, bg)).toBeGreaterThanOrEqual(4.5) })
it('8-digit hex carries alpha', () => expect(parseColour('#00000080').a).toBeCloseTo(0.502, 2))
```
- [ ] Run (fail) → implement → run (pass) → commit `feat(theme-core): OKLCH colour module`.
**Acceptance:** tests above pass; typecheck green; module exports exactly the names above.

### T1.2 — Sun maths (~140 lines)
**Produces (exact):**
```ts
export interface Location { lat: number; lon: number; label?: string }   // lon east-positive
export function altitudeAt(date: Date, loc: Location): number            // solar altitude, degrees, incl. no refraction
export interface SunTimes { sunrise: Date | null; sunset: Date | null; civilDawn: Date | null; civilDusk: Date | null; polar: 'day' | 'night' | null }
export function sunTimes(date: Date, loc: Location): SunTimes           // for the solar day containing `date`
export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter'
export function season(date: Date, lat: number): { name: SeasonName; phase: number }   // astronomical (solar longitude quadrants), phase 0..1 within the season, flipped for lat<0
```
Algorithm (specified so two implementers agree): Julian day `jd = ms/86400000 + 2440587.5`; `n = jd − 2451545.0`; mean longitude `L = (280.460 + 0.9856474n) mod 360`; anomaly `g = (357.528 + 0.9856003n) mod 360`; ecliptic longitude `λ = L + 1.915 sin g + 0.020 sin 2g`; obliquity `ε = 23.439 − 4e-7 n`; declination `δ = asin(sin ε sin λ)`; right ascension `α = atan2(cos ε sin λ, cos λ)`; equation of time (minutes) `E = 4·(L − α_deg)` normalised to (−180,180)·4 min; true solar time (min) `T = utcMinutesOfDay + 4·lon + E`; hour angle `H = T/4 − 180`; `sin(alt) = sin φ sin δ + cos φ cos δ cos H`. **`sunTimes` scans** the 24 h window centred on solar noon (`12:00 UTC − lon/15 h` of the date's UTC day) in 1-minute steps and linearly interpolates the crossings of −0.833° (rise/set) and −6° (civil dawn/dusk). Neither crossing in the window: `polar = altitude(noon) > 0 ? 'day' : 'night'` and the four times are `null`. `season` uses the sun's ecliptic longitude `λ` (degrees, March equinox = 0): spring λ∈[0,90), summer [90,180), autumn [180,270), winter [270,360); `phase = (λ mod 90)/90`; for `lat < 0` the name shifts by two seasons (spring↔autumn, summer↔winter).
- [ ] Tests (`sun.test.ts`). **Reference values:** fetch NOAA/timeanddate sunrise & sunset for Champaign IL (40.1164, −88.2434) on 2026-06-21, 2026-12-21 and 2026-03-20 and record them in the test with the source URL in a comment (tolerance 2 minutes). Plus:
```ts
it('polar day and night', () => {
  const tromso = { lat: 69.65, lon: 18.96 }
  expect(sunTimes(new Date('2026-06-21T12:00:00Z'), tromso).polar).toBe('day')
  expect(sunTimes(new Date('2026-12-21T12:00:00Z'), tromso).polar).toBe('night') })
it('seasons flip in the south', () => {
  expect(season(new Date('2026-07-15Z'), 40).name).toBe('summer')
  expect(season(new Date('2026-07-15Z'), -34).name).toBe('winter') })
it('noon altitude at the equinox on the equator is ~90', () =>
  expect(altitudeAt(new Date('2026-03-20T12:00:00Z'), { lat: 0, lon: 0 })).toBeGreaterThan(85))
```
- [ ] Fail → implement → pass → commit `feat(theme-core): sun position, times and season`.
**Acceptance:** all pass; no `Intl`, no `Date` local-time getters (UTC only).

**Task 1 review point:** one Sonnet review over T1.1–T1.2.

---

## Task 2: The manifest and legacy migration (SPEC §3.1–3.2)

**Files:** Create `theme-core/src/manifest.ts`, `migrate.ts`, `manifest.test.ts`, `migrate.test.ts`.

### T2.1 — Manifest types and defaults (~140 lines)
**Produces (exact — this is the format the design chat reads):**
```ts
export const THEME_SCHEMA = 1
export type Mode = 'light' | 'dark'
export interface ColourSeeds {
  canvas?: string; surface?: string; ink?: string; accent?: string; secondary?: string
  good?: string; bad?: string; warn?: string; info?: string; series?: string[]
}
export interface Seeds { light?: ColourSeeds; dark?: ColourSeeds }
export interface Dials {
  contrast: number; warmth: number; saturation: number; roundness: number; density: number
  elevation: number; borders: number; translucency: number; texture: number; motion: number   // 0..1
  typeScale: number      // 1.125..1.333
  baseSize: number       // px 13..18
  twilightBlend: boolean
}
export const DEFAULT_DIALS: Dials = { contrast: .5, warmth: .5, saturation: .5, roundness: .5, density: .5,
  elevation: .5, borders: .5, translucency: 0, texture: 0, motion: .5, typeScale: 1.2, baseSize: 14, twilightBlend: false }
export type FontRole = 'display' | 'body' | 'mono' | 'math'
export type FontRef = { stack: StackName } | { asset: string }       // {asset} reserved
export type StackName = 'space-grotesk' | 'inter' | 'system-sans' | 'system-serif' | 'system-mono' | 'stix-two' | 'latin-modern-math'
export const FONT_STACKS: Record<StackName, string>   // CSS font-family values, each ending in a generic family
export type FontSeeds = Partial<Record<FontRole, FontRef>>
export const DEFAULT_FONTS: Record<FontRole, FontRef> =
  { display: { stack: 'space-grotesk' }, body: { stack: 'inter' }, mono: { stack: 'system-mono' }, math: { stack: 'stix-two' } }
export interface ThemeManifest {
  schema: 1
  id: string; name: string; description?: string; author?: 'human' | 'claude'
  seeds: Seeds; dials: Partial<Dials>; fonts: FontSeeds
  overrides?: { any?: Record<string, string>; light?: Record<string, string>; dark?: Record<string, string> }
  css?: string
  graph?: { styles?: unknown; boards?: Partial<Record<'blackboard' | 'greenboard' | 'whiteboard', string>>; media?: Record<string, unknown>; papers?: unknown }
  ambience?: unknown; sounds?: unknown; assets?: unknown      // RESERVED
}
export const DEFAULT_SEEDS: Required<Pick<ColourSeeds,'canvas'|'surface'|'ink'|'accent'>> per mode   // = today's values:
//  light: canvas #eef1e5 surface #ffffff ink #17170f accent #c65d22 ; dark: canvas #17160f surface #201e15 ink #f2efe2 accent #e2803f
export function normalise(m: Partial<ThemeManifest> & { id: string; name: string }): ThemeManifest   // fills seeds/dials/fonts {}, schema 1
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
```
`FONT_STACKS` values: space-grotesk `'Space Grotesk', system-ui, sans-serif`; inter `'Inter', system-ui, sans-serif`; system-sans `system-ui, -apple-system, 'Segoe UI', sans-serif`; system-serif `ui-serif, Georgia, 'Times New Roman', serif`; system-mono `ui-monospace, 'Cascadia Mono', Consolas, monospace`; stix-two `'STIX Two Text', 'STIX Two Math', Georgia, serif`; latin-modern-math `'Latin Modern Math', 'STIX Two Math', serif`.
- [ ] Test: `normalise({id:'a',name:'A'})` equals `{schema:1,id:'a',name:'A',seeds:{},dials:{},fonts:{}}`; `DEFAULT_DIALS` ranges in bounds; every `FONT_STACKS` value contains a generic family.
- [ ] Implement, pass, commit `feat(theme-core): manifest types and defaults`.

### T2.2 — Legacy migration (~100 lines)
**Produces:**
```ts
export interface LegacyThemeRow { id: string; name: string; tokens: { light: Record<string,string>; dark: Record<string,string> }; custom_css?: string }
export function migrate(raw: unknown): ThemeManifest          // accepts LegacyThemeRow-like OR a manifest (schema 1); throws MigrateError(code,message) on bad input
export class MigrateError extends Error { code: string }
export const LEGACY_TOKEN_MAP: Record<string, string>         // '--bg'→'color-canvas' '--surface'→'color-surface' '--ink'→'color-text' '--muted'→'color-text-muted' '--line'→'color-border' '--line-strong'→'color-border-strong' '--accent'→'color-accent' '--accent-wash'→'color-accent-wash'
```
Rules: for each mode, `--bg/--surface/--ink/--accent` become **both a seed and an override** (`seeds[mode].canvas|surface|ink|accent` and `overrides[mode]['color-…']`); the other mapped keys become overrides only. `LEGACY_TOKEN_MAP` also maps `--good`→`color-good`, `--bad`→`color-bad`, `--danger`→`color-bad` and `--heat-0..4`→`color-heat-0..4`. Any key not in the map is appended to `css` as `:root[data-theme="light"]{…}` / `:root[data-theme="dark"]{…}`. `custom_css` → `css` (after those). A manifest input is validated for shape (`schema===1`, `id`, `name`) and returned `normalise`d with reserved slots untouched; unknown top-level fields throw `MigrateError('unknown_field')`.

- [ ] Tests: old forest row → manifest whose seeds/overrides carry the 8 values; `custom_css` preserved in `css`; a manifest with `ambience:{foo:1}` returns `ambience` identical; `{x:1}` top-level field throws; non-object throws.
- [ ] Implement, pass, commit `feat(theme-core): migrate legacy themes to manifests`.
**Task 2 review point.**

---

## Task 3: Registry and resolution (SPEC §3.3–3.4)

**Files:** Create `theme-core/src/registry/{types,colour,type,shape,graph,doc,component,index}.ts`, `resolve.ts`, tests beside each.

### T3.1 — Registry types and the derive context (~120 lines)
**Produces (exact):**
```ts
export type TokenType = 'color' | 'length' | 'number' | 'font' | 'shadow' | 'duration' | 'easing' | 'string'
export type Tier = 'semantic' | 'component'
export type Group = 'colour' | 'type' | 'shape' | 'space' | 'elevation' | 'motion' | 'surface' | 'graph' | 'document' | 'component'
export interface DeriveCtx {
  mode: Mode
  dials: Dials
  fonts: Record<FontRole, FontRef>
  seed(k: 'canvas' | 'surface' | 'ink' | 'accent' | 'secondary' | 'good' | 'bad' | 'warn' | 'info'): Oklch   // mode-resolved, mirrored from the other mode if only that has it (T3.6), else defaults/derived
  seriesSeed(i: number): Oklch | null
  hasSeed(k: string): boolean
  get(name: string): string        // final value (override-aware) of another token — enables dependents to follow overrides
  col(name: string): Oklch         // parseColour(get(name))
}
export interface TokenDef { name: string; tier: Tier; group: Group; type: TokenType; modeDependent: boolean; meaning: string; derive(ctx: DeriveCtx): string }
export const TOKENS: readonly TokenDef[]; export const tokenByName: ReadonlyMap<string, TokenDef>
export function parseTokenValue(type: TokenType, v: string): boolean   // color: parseColour ok; length: /^-?\d*\.?\d+(px|rem|em|%|ch)$|^0$/ ; number: finite; duration /ms$|s$/; shadow/easing/font/string: non-empty string
```
Helpers exported for table authors: `def(name, group, type, meaning, derive, opts?)` building a `TokenDef` (`tier` default `'semantic'`, `modeDependent` default `type==='color'`), and tiny colour helpers (`mixTo`, `toward`, `onColour(bg): Oklch` = whichever of near-black `oklch(0.2 0.01 90)` / white has higher contrast).
- [ ] Test: `parseTokenValue` accept/reject table; `def` defaults; duplicate token names throw at module load (assert `TOKENS.length === tokenByName.size`).
- [ ] Commit `feat(theme-core): token registry types`.

### T3.2 — Colour tokens (~150 lines)
Register every colour token of SPEC §3.3 **with these derivations** (`ink/canvas/surface` = ctx seeds; `s` = surface colour token; `contrast`/`borders` are dials 0..1, 0.5 default):

| token | derive |
|---|---|
| `color-canvas` | `toHex(seed canvas)` |
| `color-surface` | seed surface if `hasSeed('surface')`, else canvas with L +0.05 (light, cap 1) / +0.03 (dark), chroma ×0.4 |
| `color-surface-raised` | surface L +0.02 (light) / +0.04 (dark), plus `elevation×0.02` |
| `color-surface-sunken` | `mix(canvas, ink, 0.04)` |
| `color-surface-overlay` | = `color-surface-raised` |
| `color-scrim` | ink, alpha 0.45 |
| `color-text` | seed ink |
| `color-text-muted` | `mix(ink, surface, 0.42 − 0.3(contrast−0.5))` |
| `color-text-faint` | `mix(ink, surface, 0.62 − 0.3(contrast−0.5))` |
| `color-text-on-accent` | `onColour(accent)` |
| `color-link` | = accent |
| `color-border` | `mix(ink, canvas, 0.86 − 0.2(borders−0.5))` |
| `color-border-strong` | `mix(ink, canvas, 0.74 − 0.2(borders−0.5))` |
| `color-divider` | `mix(color-border, canvas, 0.4)` |
| `color-focus` | `fitLightness(accent, canvas, 3)` |
| `color-accent` / `color-secondary` | seed accent / seed secondary (secondary default: accent hue +40°, chroma ×0.9) |
| `color-{accent,secondary}-hover` | L −0.04 light / +0.04 dark |
| `color-{accent,secondary}-active` | L −0.08 light / +0.08 dark |
| `color-{accent,secondary}-wash` | `mix(base, canvas, 0.90 light / 0.85 dark)` |
| `color-{accent,secondary}-text` | `fitLightness(base, surface, 4.5)` |
| `color-{good,bad,warn,info}` | seed if present else hue 145/30/85/240 pulled 10% toward accent hue; L = clamp(accent L, .50–.70 light / .65–.80 dark); C = clamp(accent C, .10–.16) |
| `color-<s>-wash` / `-text` | as accent-wash / accent-text |
| `color-series-1..8` | `seriesSeed(i)` else hue = accentHue + i·137.508 (i from 0), C 0.12, L fitted so `contrast ≥ 3` vs surface (start .62 light / .72 dark); series-1 uses the accent hue |
| `color-heat-0..4` | `mix(color-border, accent, i/4)` |
| `color-selection` | accent, alpha 0.25 |
| `color-highlight-1..4` | hues 95/145/240/350, C 0.1, L .85 light / .45 dark, mixed 20% into canvas |
| `color-shadow` | ink, alpha 0.18 light / 0.5 dark |
| `color-syntax-{keyword,string,number,function,type}` | hues 300/145/55/240/190, C .12, `fitLightness(…, surface, 4.5)` |
| `color-syntax-{comment,operator,punctuation}` | faint / muted / muted text |

- [ ] Test (`registry/colour.test.ts`) using a stub ctx built from the default seeds: every colour token `derive` returns a valid colour string; for default light and dark: `contrast(color-text, color-surface) ≥ 7`, `contrast(color-text-muted, color-surface) ≥ 3`, series-1..8 each `≥ 3` vs surface, `color-accent-hover` L differs from accent in the right direction per mode.
- [ ] Implement, pass, commit.

### T3.3 — Type, shape, space, elevation, motion, surface tokens (~130 lines)
Derivations (`d` = dials):
- `font-display|body|mono|math` → `FONT_STACKS[stack]` (asset refs fall back to the role default stack — reserved).
- `text-2xs|xs|sm|md|lg|xl|2xl|3xl`: `base = d.baseSize`, `r = d.typeScale`; px values `base·0.72, base·0.82, base·0.92, base, base·r, base·r², base·r³, base·r⁴`, each rounded to 0.5px and emitted as `Npx`.
- `leading-tight|normal|loose` = `1.25|1.5|1.75`; `weight-regular|medium|bold` = `400|500|700`.
- `radius-*`: `r = round05(16·roundness·1.5)` → at the 0.5 default `r=12px`; `xs=0.3r sm=0.6r md=r lg=1.4r xl=2r`; `radius-pill` = `'999px'` (or `'0px'` when `roundness===0`). `border-width` = `borders<0.1 ? '0px' : '1px'`, `border-width-strong` = `'2px'`.
- `space-1..8` = `unit·[1,2,3,4,6,8,12,16]`, `unit = 4·(0.6+0.8·density)` px, rounded to 0.5.
- `shadow-1|2|3`: if `elevation===0` → `'none'`; else `0 {k}px {3k+2}px <shadow colour with alpha·(0.4+elevation·1.2)>` for k=1,2,3, two stacked layers (second half the offset, half the alpha). Colour comes from `col('color-shadow')`.
- `motion-fast|normal|slow` = `120|200|360 · f` ms where `f = motion·2` (0 → `0ms`); `ease-standard` = `cubic-bezier(0.2, 0, 0, 1)`; `ease-emphasis` = `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- `surface-alpha` = `String(1 − 0.5·translucency)` (type `number`); `surface-blur` = `${24·translucency}px`.
- [ ] Tests: default dials give `text-md='14px'`, `radius-md='12px'`, `space-3='12px'`, `motion-normal='200ms'`; `roundness:0` gives `radius-md='0px'` and `radius-pill='0px'`; `elevation:0` gives `shadow-2='none'`; every value passes `parseTokenValue` for its type.
- [ ] Implement, pass, commit.

### T3.4 — Graph and document tokens (~90 lines)
- Graph (SPEC §3.3, G2 step 3): `graph-paper`=surface, `graph-ink`=ink, `graph-grid`=border, `graph-grid-strong`=border-strong, `graph-axis`=`mix(ink, surface, .25)`, `graph-segment`=good, `graph-point`=bad, `graph-hover`=accent, `graph-region-alpha`=`'0.18'` (number), and `graph-marker-<kind>` for each kind in `FEATURE_KINDS = ['x-intercept','y-intercept','local-max','local-min','inflection','center','focus','conic-vertex','intersection']` assigned `color-series-((index % 8)+1)`. **`FEATURE_KINDS` is copied from `milestone-a/main` `graph-engine/src/parser/config.ts:22` and is not on `main`; leave a comment saying so.**
- Document: `doc-page`=surface, `doc-text`=ink, `doc-rule`=border, `doc-code-bg`=surface-sunken, `doc-code-text`=ink, `doc-table-header`=surface-sunken, `doc-table-stripe`=`mix(surface, ink, .03)`, `doc-measure`=`'68ch'`.
- [ ] Tests: 9 marker tokens exist; all values valid; `graph-paper` follows an override of `color-surface` (use the resolve test harness once T3.6 lands; for now assert derive from a stub ctx).
- [ ] Commit.

### T3.5 — Component tokens (~100 lines)
All `tier:'component'`, `group:'component'`, naming `<component>-<part>[-<state>]`, defaults referencing semantic tokens via `ctx.get/col`:
`sidebar-bg`(=surface), `sidebar-border`(=border), `sidebar-row-hover`(=`mix(surface, accent, .06)`), `sidebar-row-active-bg`(=accent-wash), `sidebar-row-active-text`(=accent-text); `tab-bg`(=canvas), `tab-text`(=text-muted), `tab-active-bg`(=surface), `tab-active-text`(=text), `tab-border`(=border); `panel-bg`(=surface), `panel-border`(=border), `panel-radius`(=radius-lg), `panel-shadow`(=shadow-1); `card-bg`(=surface-raised), `card-border`(=border), `card-radius`(=radius-lg), `card-shadow`(=shadow-1); `input-bg`(=surface), `input-border`(=border-strong), `input-border-focus`(=focus), `input-text`(=text), `input-placeholder`(=text-faint), `input-radius`(=radius-md); `button-primary-bg`(=accent), `button-primary-hover-bg`(=accent-hover), `button-primary-text`(=text-on-accent), `button-secondary-bg`(=surface), `button-secondary-hover-bg`(=surface-sunken), `button-secondary-text`(=text), `button-secondary-border`(=border-strong), `button-radius`(=radius-md); `chip-bg`(=accent-wash), `chip-text`(=accent-text), `chip-radius`(=radius-pill); `menu-bg`(=surface-overlay), `menu-border`(=border), `menu-hover`(=surface-sunken), `menu-shadow`(=shadow-3), `menu-radius`(=radius-md); `modal-bg`(=surface-overlay), `modal-scrim`(=scrim), `modal-radius`(=radius-xl), `modal-shadow`(=shadow-3); `code-bg`(=surface-sunken), `code-text`(=text), `code-border`(=border); `table-header-bg`(=surface-sunken), `table-stripe-bg`(=doc-table-stripe), `table-border`(=border); `toast-bg`(=text), `toast-text`(=canvas); `badge-good-bg`(=good-wash), `badge-bad-bg`(=bad-wash).
- [ ] Test: each component token resolves under the default theme; overriding `color-surface` flows into `panel-bg`, `input-bg`, `sidebar-bg`; overriding `panel-bg` does not change `card-bg`.
- [ ] Commit.

### T3.6 — `resolve()` with overrides, provenance, other-mode derivation, key (~150 lines)
**Produces (exact):**
```ts
export type Provenance = { source: 'default' | 'seed' | 'dial' | 'override'; tier: Tier; from?: string }
export interface ResolvedTheme { id: string; light: TokenMap; dark: TokenMap; provenance: { light: Record<string, Provenance>; dark: Record<string, Provenance> }; key: string }
export type TokenMap = Record<string, string>      // token name (no '--') → value
export function resolve(m: ThemeManifest): ResolvedTheme
export function mirrorSeed(role: keyof ColourSeeds, c: Oklch, to: Mode): Oklch
```
Rules: **seed for field `f` in mode `m`** = `seeds[m][f]` ?? `mirrorSeed(f, parse(seeds[other][f]), m)` ?? `DEFAULT_SEEDS[m][f]` (for fields that have no default — secondary, good, bad, warn, info, series — absent ⇒ the token's own derivation). `mirrorSeed`: for `canvas|surface|ink`: `l' = clamp(1 − l, 0.08, 0.97)`, hue kept, chroma ×0.8; for accent/secondary/status/series items: `l' = clamp(l ± 0.08, .35, .85)` (+ going to dark, − going to light), chroma ×0.95 (to dark) / ×1.05 (to light). **Token value for mode `m`:** `overrides.light|dark[m]?.[name]` ?? `overrides.any?.[name]` ?? `def.derive(ctx)`; every override is checked with `parseTokenValue(def.type, v)` — a bad one throws `ResolveError(token, message)`; an unknown token name throws too (the validator catches these first). `ctx.get` memoises per mode and detects cycles (throw). Provenance: `override` if from overrides (`from: 'light'|'dark'|'any'`), `seed` when the token is a direct seed pass-through (`color-canvas`, `color-surface` with seed, `color-text`, `color-accent`, …), `dial` when any dial ≠ default affects it (derive functions record by calling `ctx.dialUsed('roundness')` — simplest implementation: compare the value against the same token resolved with `DEFAULT_DIALS`; differing ⇒ `dial`), else `default`. `key` = FNV-1a 32-bit hex of `JSON.stringify([light, dark])`.
- [ ] Tests (`resolve.test.ts`):
```ts
const empty = normalise({ id: 't', name: 'T' })
it('an empty manifest resolves every registry token in both modes', () => {
  const r = resolve(empty)
  for (const t of TOKENS) { expect(r.light[t.name]).toBeTruthy(); expect(r.dark[t.name]).toBeTruthy() } })
it('an override replaces exactly what it names and dependents follow', () => {
  const m = { ...empty, overrides: { any: { 'color-surface': '#ff00aa' } } }
  const r = resolve(m)
  expect(r.light['color-surface']).toBe('#ff00aa'); expect(r.light['panel-bg']).toBe('#ff00aa')
  expect(r.light['color-canvas']).toBe(resolve(empty).light['color-canvas']) })
it('a component override does not leak', () => { /* panel-bg override leaves card-bg alone */ })
it('light-only seeds derive the dark mode (hue kept, lightness mirrored)', () => {
  const m = { ...empty, seeds: { light: { canvas: '#f4efe6', ink: '#201a14', accent: '#b3411f' } } }
  const r = resolve(m); const c = parseColour(r.dark['color-canvas'])
  expect(c.l).toBeLessThan(0.3); expect(Math.abs(c.h - parseColour('#f4efe6').h)).toBeLessThan(8) })
it('provenance', () => { /* override→'override', color-canvas with seed→'seed', untouched→'default', roundness 0.9 → radius-md 'dial' */ })
it('key changes with any colour and is stable otherwise', () => { /* two resolves equal; changing accent changes key */ })
it('a bad override value throws ResolveError', () => expect(() => resolve({ ...empty, overrides: { any: { 'color-accent': 'nope' } } })).toThrow())
```
- [ ] Implement, pass, commit. Also export `resolveMode(m, mode)` (single mode) for the live apply path.
**Acceptance:** resolution of the empty manifest is deterministic; `typecheck` green.

**Task 3 review point:** review T3.1–T3.6 together (diff + SPEC §3.3 paragraphs + the table above).

---

## Task 4: Mode resolution and blend (SPEC §3.4)

**Files:** Create `theme-core/src/mode.ts`, `mode.test.ts`.
**Produces:**
```ts
export type ModeSource = 'light' | 'dark' | 'system' | 'sun'
export function modeAt(source: ModeSource, now: Date, loc: Location | null, systemDark: boolean, twilightBlend: boolean):
  { mode: Mode; blend: number /* 0 light … 1 dark */; effectiveSource: ModeSource /* 'system' when sun had no location */ }
export function blendMaps(light: TokenMap, dark: TokenMap, t: number): TokenMap
```
Rules: `light|dark` → blend 0|1. `system` → by `systemDark`. `sun` without `loc` → behaves as `system`, `effectiveSource:'system'`. `sun` with `loc`: `alt = altitudeAt(now, loc)`; if `twilightBlend`: `blend = smoothstep(1 − clamp((alt − (−6)) / (2 − (−6)), 0, 1))` i.e. 1 at alt ≤ −6°, 0 at alt ≥ +2°; else `blend = alt < −0.833 ? 1 : 0`. `mode = blend ≥ 0.5 ? 'dark' : 'light'`. `blendMaps`: for each token, if both values parse as colours → `mix` in OKLab at `t` → `toHex` (alpha kept); non-colour values: `t < 0.5 ? light : dark`. `t=0` returns exactly the light map; `t=1` the dark map.
- [ ] Tests: Champaign at 2026-06-21T18:00Z (noon local) with the sun source → light; at 2026-12-21T03:00Z → dark; no location → `effectiveSource 'system'`; blend monotonic across a dusk sweep (sample every 5 min, blend never decreases after sunset); `blendMaps(l,d,0)` deep-equals `l`, `(…,1)` deep-equals `d`; mid blend lightness of `color-canvas` strictly between the two.
- [ ] Implement, pass, commit `feat(theme-core): mode resolution and twilight blend`.
**Acceptance:** tests pass.

---

## Task 5: Emitters and engine contracts (SPEC §3.9–3.10)

**Files:** Create `theme-core/src/emit.ts`, `contracts.ts`, tests.

### T5.1 — CSS emitter and legacy mirror (~110 lines)
**Produces:**
```ts
export const ALIASES: Record<string, string>   // '--bg':'color-canvas' '--surface':'color-surface' '--ink':'color-text' '--muted':'color-text-muted' '--line':'color-border' '--line-strong':'color-border-strong' '--accent':'color-accent' '--accent-wash':'color-accent-wash' '--good':'color-good' '--bad':'color-bad' '--danger':'color-bad' '--heat-0'…'--heat-4':'color-heat-0'…'color-heat-4'
export function toCssVars(map: TokenMap): Record<string, string>      // '--<token>': value for every token, then every alias → the value of its target
export function toStylesheet(map: TokenMap, mode: Mode, css?: string): string
//   ':root{--…;…}\n' + `:root{color-scheme:${mode}}` + '\n' + (css ?? '')
export function toLegacyTokens(r: ResolvedTheme): { light: Record<string,string>; dark: Record<string,string> }   // the 8 old keys per mode
```
`--font-display`, `--font-body`, `--font-mono` are emitted from the `font-*` tokens (same names; the aliases table does not list them).
- [ ] Tests: `toCssVars` contains `--bg` equal to `color-canvas`; every ALIASES target exists in the registry; `toStylesheet` starts with `:root{`, ends with the css; `toLegacyTokens(resolve(migrate(oldRow)))` deep-equals the old row's 8 tokens in both modes (**exactness requirement**).
- [ ] Commit.

### T5.2 — Graph and document contracts (~120 lines)
**Produces:**
```ts
// Structural mirror of GS §3.1 ThemeSource (graph styles branch milestone-a/styles: graph-engine/src/style/theme/types.ts). Keep field names identical.
export interface GraphThemeSource {
  mode: Mode
  colours: { surface: string; paper: string; ink: string; muted: string; line: string; lineStrong: string; accent: string; accentWash: string; good: string; bad: string; series: string[] }
  lightColours?: GraphThemeSource['colours']        // the OTHER mode's colours (ends the INTERIM stopgap)
  boards?: Partial<Record<'blackboard' | 'greenboard' | 'whiteboard', string>>
  media?: Record<string, unknown>
  styles?: unknown
  lettering?: { family?: string }
}
export function toGraphThemeSource(r: ResolvedTheme, manifest: ThemeManifest, mode: Mode): GraphThemeSource
export interface DocumentTokens {
  mode: Mode
  colors: { page: string; text: string; textMuted: string; link: string; rule: string; selection: string; highlight: [string,string,string,string]; codeBg: string; codeText: string; syntax: Record<'keyword'|'string'|'number'|'comment'|'function'|'type'|'operator'|'punctuation', string>; tableHeader: string; tableStripe: string; accent: string }
  fonts: { body: string; display: string; mono: string; math: string; cjk: string }
  scale: { base: string; ratio: number; leading: string; measure: string }
  key: string
}
export function toDocumentTokens(r: ResolvedTheme, manifest: ThemeManifest, mode: Mode): DocumentTokens
```
Mapping: graph `surface`=`color-surface`, `paper`=`graph-paper`, `ink`=`graph-ink`, `muted`=`color-text-muted`, `line`=`graph-grid`, `lineStrong`=`graph-grid-strong`, `accent`, `accentWash`, `good`, `bad` from `color-*`, `series` = `color-series-1..8`, `lightColours` = the other mode's set, `boards|media|styles` copied from `manifest.graph`, `lettering.family` = the `font-display` value. Document `fonts.cjk` = `"'Noto Sans JP', 'Noto Serif JP', system-ui, sans-serif"` (DE font chain), `scale.ratio` = `dials.typeScale` (default 1.2), `scale.base` = `text-md`, `leading` = `leading-normal`, `measure` = `doc-measure`, `key` = `r.key`.
- [ ] Tests: every field filled (no undefined/empty) for all builtins in both modes; `series.length === 8`; `lightColours.surface` differs from `colours.surface`; board overrides pass through; snapshot `Object.keys` of both shapes (pins the contract).
- [ ] Commit.
**Task 5 review point.**

---

## Task 6: Built-in themes (SPEC §0.16)

**Files:** Create `theme-core/src/builtins/{osmosis,forest,ocean,ember,index}.ts`, `builtins.test.ts`.
**Produces:** `export const BUILTINS: readonly ThemeManifest[]`, ids `builtin:osmosis`, `builtin:forest`, `builtin:ocean`, `builtin:ember`; `export const DEFAULT_THEME_ID = 'builtin:osmosis'`; `export function isBuiltinId(id: string): boolean` (`startsWith('builtin:')`); `export const REMOVED_BUILTINS = ['builtin:slate','builtin:plum']`.
- **`builtin:osmosis`** — seeds = today's four colours per mode; overrides (both modes, exact) so it equals today:
  - light: `color-text-muted #6b6b5f`, `color-border #e4e2d4`, `color-border-strong #c9c6b3`, `color-accent-wash #faf1e9`, `color-good #4c7a4a`, `color-bad #a34b3f`, `color-heat-0 #e4e2d4`, `-1 #e9c9a6`, `-2 #e3a468`, `-3 #d97a35`, `-4 #c65d22`
  - dark: `color-text-muted #a19d8c`, `color-border #34311e`, `color-border-strong #4a4530`, `color-accent-wash #2c2113`, `color-good #6fa06c`, `color-bad #c76a5c`, `color-heat-0 #2a2819`, `-1 #4a3a20`, `-2 #7a4e24`, `-3 #a85f2a`, `-4 #e2803f`
  - (`light` overrides go under `overrides.light`, dark under `overrides.dark`.)
- **`builtin:forest`** — seeds from today's forest. light: canvas `#ecf0e6` surface `#fbfcf8` ink `#141a13` accent `#2f7a4f`; dark: canvas `#0f1511` surface `#161f18` ink `#e6efe6` accent `#6fbf8a`. Overrides both modes for `color-text-muted`/`color-border`/`color-border-strong`/`color-accent-wash` = today's `#5d6b5c #d8e0d2 #b8c6b0 #e8f3ea` (light) and `#92a394 #25332a #36473c #16261b` (dark). Heat/good/bad: light `heat #d8e0d2 #b3d3b8 #86bc93 #57a06d #2f7a4f`, `good #2f7a4f`, `bad #a6553c`; same values in dark (the old CSS applied them to both). `css`: `.panel { border-color: color-mix(in srgb, var(--accent) 18%, var(--line)); }`.
- **`builtin:ember`** — light: canvas `#f2ebe0` surface `#fffaf3` ink `#1c1410` accent `#b3411f`; dark: canvas `#0d0b09` surface `#16110d` ink `#f6ece0` accent `#ff8a3d`. Overrides: muted/border/border-strong/accent-wash light `#75655a #e6d9c8 #cdb9a2 #f8e9df`, dark `#a89583 #2b2119 #443426 #2e1a0f`; heat `#e6d9c8 #f0c29e #eea16a #e0753a #b3411f` both modes, `good #6e7f3c`, `bad #b3411f`. `css`: `body { background-image: radial-gradient(ellipse at top left, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%); }`.
- **`builtin:ocean`** (new) — light: canvas `#e9f1f4` surface `#fafdfe` ink `#10202a` accent `#1f7a8c`, secondary `#3a5a9b`; dark: canvas `#0a1419` surface `#10202a` ink `#e2eef2` accent `#4fb3c8`, secondary `#7d9ad6`. No overrides (fully derived); `dials: { roundness: .6, elevation: .35 }`; fonts `display: system-serif`? **No** — keep `space-grotesk`/`inter` (font choice is for the ambience pass).
- [ ] Tests (`builtins.test.ts`): unique ids; each resolves with no throw; **parity**: for osmosis, light & dark, `toLegacyTokens` equals `DEFAULT_LIGHT_TOKENS`/`DEFAULT_DARK_TOKENS` of `web/src/lib/themeTokens.ts` (copy the 16 values into the test as constants) and `color-heat-0..4`, `color-good`, `color-bad` equal the index.css values listed above; forest and ember legacy tokens equal their old values; contrast warnings: `validate` (Task 8) not yet available → assert directly `contrast(text, surface) ≥ 4.5` and `contrast(text-muted, surface) ≥ 3` for all four built-ins in both modes.
- [ ] Commit `feat(theme-core): built-in themes osmosis, forest, ocean, ember`.
**Task 6 review point — then PUBLISH CHECKPOINT (T7).** Review T5+T6 together if cheaper; this is the READY gate that unlocks FORMAT.md.

---

## Task 7: Docs for the design chat (publish checkpoint)

**Files:** Create `theme-core/scripts/gen-docs.ts`, `docs/theming/TOKENS.md` (generated, in Osmosis), and **Learn `spec/osmosis/theming/FORMAT.md`** (hand-written; commit in Learn).

### T7.1 — TOKENS.md generator (~80 lines)
- [ ] Script (run with `npx vite-node theme-core/scripts/gen-docs.ts` or `tsx`) walks `TOKENS` and prints one table per `group`: `| token | tier | type | modes | meaning | default (light / dark, built-in osmosis) |`. Add `npm run docs --workspace=theme-core`.
- [ ] Test: generated file lists every token (`TOKENS.length` rows) — assert in a vitest that imports the generator's `render()` function.
- [ ] Commit `docs(theme-core): generate TOKENS.md`.

### T7.2 — FORMAT.md for the design chat (~150 lines of prose; no code to test)
Content (Learn `spec/osmosis/theming/FORMAT.md`): (1) what a theme file is (manifest JSON example = `builtin:forest`, shown in full); (2) the three tiers, with 8 sample chains seed → semantic → component; (3) how to **consume** tokens in a component (always `var(--color-…)`, `var(--radius-…)`, `var(--space-…)`, `var(--text-…)`, `var(--shadow-…)`, `var(--motion-…)`; component tokens when a part has its own look; never literal colours/sizes; old names are deprecated aliases); (4) dials and what they do; (5) light/dark/sun; (6) the full token index (link to `TOKENS.md` in the Osmosis worktree, and the group list); (7) rules for new UI ("never layout from a theme", state tokens for hover/active/focus/disabled use `-hover/-active`, `color-focus` for rings); (8) what is reserved (ambience etc.).
- [ ] Commit in Learn: `spec(theming): FORMAT.md — the theme format for design`.
- [ ] **Message the Osmosis projects inventory session** (summary line: FORMAT.md exists, path, and the branch/commit with the manifest, registry and contracts).
**Acceptance:** FORMAT.md exists and its JSON example validates against `normalise` and resolves; TOKENS.md generated and committed.

---

## Task 8: Validation (SPEC §3.5)

**Files:** Create `theme-core/src/validate.ts`, `validate.test.ts`.
**Produces:**
```ts
export interface Issue { path: string; message: string; suggestion?: string }
export interface Report { ok: boolean; errors: Issue[]; warnings: Issue[] }
export function validate(raw: unknown): Report
```
Errors (refuse save): not an object; `schema !== 1`; bad `id` (`ID_RE`) or `id` starting `builtin`; empty `name`; unknown top-level field; seed value not a colour; seeds `series` not an array of colours; dial out of range (0..1; `typeScale` 1.125..1.333; `baseSize` 13..18; `twilightBlend` boolean); font ref neither `{stack: known}` nor `{asset: string}`; override naming an unknown token; override value failing `parseTokenValue`; `css` > 64 KB; `graph.boards` value not a colour. Warnings (allowed): per mode — `color-text` vs `color-canvas` and `color-surface` < 4.5; `color-text-muted` vs surface < 3; each `color-series-i` vs surface < 3; `color-focus` vs canvas < 3; two series with OKLab ΔE < 0.08; a seed clamped on mirroring. Every contrast warning's `suggestion` names the nearest passing value, e.g. `"set color-text-muted to #6b6f78 (raises contrast to 4.6)"`, computed with `fitLightness`.
- [ ] Tests: one per error class (table-driven); a theme with `ink` very close to `canvas` yields a contrast warning whose suggested hex, once applied as an override, makes the warning disappear; reserved slots pass untouched; all four built-ins have `ok:true` and zero warnings for text/surface contrast.
- [ ] Commit `feat(theme-core): validate`.
**Task 8 review point.**

---

## Task 9: Server storage and the migration hook (SPEC §3.6)

**Files:** Create `server/migrations/024_theme_manifest.sql`; Modify `server/src/db/migrate.ts`, `server/src/domain/themes.ts` (rewrite), `server/src/protocol.ts`; Tests `server/tests/themes.test.ts` (rewrite), `server/tests/themeMigration.test.ts` (new).

### T9.1 — Migration 024 and the conversion step (~90 lines)
- [ ] `024_theme_manifest.sql`: `ALTER TABLE theme ADD COLUMN manifest TEXT; ALTER TABLE theme ADD COLUMN schema_version INTEGER; ALTER TABLE theme_setting ADD COLUMN location TEXT;`
- [ ] In `migrate.ts`, after the loop: `convertLegacyThemes(db)` — for each `theme` row with `manifest IS NULL`, `migrate({id,name,tokens: JSON.parse(tokens), custom_css})` → `UPDATE theme SET manifest=?, schema_version=1 WHERE id=?` (do **not** touch `updated_at`; rows that fail conversion are left `NULL` and logged with the id). Import `migrate as migrateTheme` from `theme-core`. Idempotent.
- [ ] Test (`themeMigration.test.ts`): seed a DB at 023 state (create DB with `openTestDb()`, insert a legacy row with `manifest NULL`, re-run `migrate(db)`), assert `manifest` populated, `updated_at` unchanged, running twice changes nothing, and `resolve` of the stored manifest gives the old 8 values.
- [ ] Commit.

### T9.2 — `themes.ts` on manifests (~150 lines)
**Produces (exact):**
```ts
export interface ThemeRow { id: string; name: string; manifest: ThemeManifest; tokens: { light: Record<string,string>; dark: Record<string,string> }; custom_css: string; updated_at: string; deleted_at: string | null }
export interface SaveResult { theme: ThemeRow; report: Report }
export function listThemes(db): ThemeRow[]; export function listThemesForSync(db): ThemeRow[]
export function getTheme(db, id: string): ThemeRow | null
export function getActiveThemeId(db): string | null      // maps REMOVED_BUILTINS → 'builtin:osmosis'
export function saveTheme(db, input: { manifest: ThemeManifest } | { id: string; name: string; tokens: …; custom_css?: string }): SaveResult
export function patchTheme(db, id: string, patch: unknown): SaveResult          // RFC 7386 merge-patch onto the stored manifest; null deletes a key; arrays replace
export function deleteTheme(db, id): { id: string }; export function setActiveTheme(db, id: string | null): { active_theme_id: string | null }
export function getLocation(db): Location | null; export function setLocation(db, loc: Location | null): { location: Location | null }
export function applyThemesFromPull(db, themes: PulledTheme[], active: string | null | undefined, location?: Location | null): number
```
`saveTheme`: legacy input → `migrate`; `validate(manifest)`; errors → `DomainError('invalid_theme', first error message)` with `details: report`; builtin ids rejected (`builtin_theme`); store `manifest` JSON, `schema_version`, and the **mirror** `tokens = JSON(toLegacyTokens(resolve(manifest)))`, `custom_css = manifest.css ?? ''`. `ThemeRow.tokens/custom_css` are read from the mirror columns. `applyThemesFromPull`: row with `manifest` → store as is; row without (old canonical) → `migrate` legacy. Newer-wins by `updated_at` as before. `setActiveTheme('builtin:slate'|'builtin:plum')` stores `builtin:osmosis`. `getActiveThemeId` also maps those two.
- [ ] Rewrite the three theme test files' server-side assertions in `themes.test.ts` (save/list/delete/active/patch/location/pull) — failing first. Add: legacy-shaped save equals manifest-shaped save; merge-patch deleting an override with `null`; invalid manifest rejected with a report; active id `builtin:plum` reads `builtin:osmosis`.
- [ ] Bump `server/src/protocol.ts` `PROTOCOL_VERSION = 2`.
- [ ] Commit.
**Acceptance:** `npm test --workspace=@osmosis/server -- themes` green; typecheck green.
**Task 9 review point.**

---

## Task 10: HTTP routes and sync (SPEC §3.6)

**Files:** Modify `server/src/http/apiRoutes.ts:897-985`, `server/src/domain/sync.ts` (pull assembly ~470-480, client apply ~705, response type ~69), Tests `server/tests/themeRoutes.test.ts`, a sync test.
Routes (all via the existing `forwardOrLocal` pattern for writes):
- `GET /api/themes` → `{ themes: [{id,name,manifest,updated_at}], builtins: [{id,name,manifest}], active_theme_id, location }` (legacy `tokens`/`custom_css` also included on each theme row for old clients).
- `PUT /api/themes/:id` body `{ manifest }` **or** legacy `{ name, tokens, custom_css }` → `{ theme, report }`; 400 `invalid_theme` with the report on errors.
- `PATCH /api/themes/:id` body = merge patch → `{ theme, report }`.
- `POST /api/themes/validate` body `{ manifest }` → `report`; nothing stored; works offline on local nodes (pure).
- `PUT /api/themes/active`, `DELETE /api/themes/:id` unchanged. `PUT /api/themes/location` body `{ lat, lon, label? } | null` → `{ location }` (forwarded to canonical like the others).
Sync: pull response adds `theme_location`; client calls `applyThemesFromPull(db, themes, active_theme_id, theme_location)`.
- [ ] Tests (write first): GET returns builtins incl. `builtin:ocean` and not `builtin:slate`; PUT legacy body round-trips to a manifest; PUT invalid → 400 + report; PATCH merges; validate endpoint stores nothing; local node offline → 503 `theme_requires_connection` for PUT; pull carries `manifest` and `theme_location`.
- [ ] Implement, pass, commit.
**Acceptance:** `themeRoutes.test.ts` and the sync tests green.

---

## Task 11: MCP tools (SPEC §3.7)

**Files:** Modify `server/src/mcp/tools.ts:24,1125-1195`, `server/src/protocol.ts` (`TOOLS_VERSION` 9→10), `MCP-SPEC.md`; Tests `server/tests/themeTools.test.ts`.
Tools: `list_themes`, `get_theme {id, resolved?}`, `theme_tokens {group?}`, `save_theme {manifest, make_active?}`, `patch_theme {id, patch, make_active?}`, `validate_theme {manifest}`, `set_active_theme {id|null}`, `delete_theme {id}`. `manifest`/`patch` inputs are `z.record(z.string(), z.unknown())` (the real validation is `validate`, returned as `report`). `theme_tokens` returns `[{name,tier,group,type,modeDependent,meaning}]` filtered by group. `get_theme resolved:true` returns `{manifest, resolved:{light,dark,provenance}}`. The tool descriptions must tell an AI author to: start from a handful of seeds + dials, call `theme_tokens` for names, apply `report.warnings[].suggestion`, and use `patch_theme` to refine. Remove `THEME_TOKEN_KEYS`, `themeTokenSetShape` and the hard-coded built-in list (read `BUILTINS`).
- [ ] Tests (write first, `connectedClient`/`callTool` pattern): save a 6-seed manifest → `report.ok`, active; `patch_theme` changes one dial; `theme_tokens` includes `color-surface` and `graph-marker-focus`; `get_theme resolved` has both modes; an invalid manifest returns `isError:false` with `report.errors` populated **or** the tool error carrying the report (pick: `fail` with `details`); `list_themes` shows the four built-ins and not slate/plum.
- [ ] Update `MCP-SPEC.md` theme section and `TOOLS_VERSION`.
- [ ] Commit.
**Task 10–11 review point:** one review over T10 + T11.

---

## Task 12: `/theme` commands (SPEC §3.8)

**Files:** Modify `cli-core/src/types.ts` (Ui), `cli-core/src/commands.ts:135,422-455`, `cli-core/src/registry.test.ts` (fakeCtx + tests), `web/src/App.tsx:132-139`, `cli/src/terminal.ts:116-117`.
**Ui additions (exact):**
```ts
setThemeMode(mode: 'light' | 'dark' | 'system' | 'sun'): Promise<boolean>
setThemeBlend(on: boolean): Promise<boolean>
requestLocation(): Promise<{ lat: number; lon: number } | null>          // browser geolocation, app only
themeState(): Promise<{ source: 'light'|'dark'|'system'|'sun'; effectiveSource: 'light'|'dark'|'system'|'sun'; mode: 'light'|'dark'; blend: number; twilightBlend: boolean } | null>
```
Commands: `theme <name>` (unchanged behaviour; `light|dark|system|sun` call `setThemeMode`), `theme list`, `theme show`, `theme mode <light|dark|system|sun>`, `theme blend <on|off>`, `theme location <lat,lon | here | clear>` (`here` → `ui.requestLocation()`; app-only, terminal says "open the app"; stored via `PUT /api/themes/location`), `theme tokens [filter]` (fetches `/api/themes`, finds the active manifest incl. builtins, `resolve()`s it, prints `name | value | source` for the device's current mode from `themeState()` or `light` + a note when null; `filter` is a substring on the name), `theme edit [name]` (unchanged). `theme show` prints: active theme name/id, source/effective source/mode/blend, and — when a location is set — today's `sunTimes` (sunrise, sunset, civil dusk) in local time, or "no location set; sun mode follows the system". The `theme` completer also offers `sun`, plus `list show mode blend location tokens edit` as subcommands (follow how existing multi-word commands such as `theme edit` register).
- [ ] Tests (registry.test.ts, using the existing `fakeCtx`; extend its `get` to answer `/api/themes` with one builtin + one custom manifest): `theme mode sun` calls `setThemeMode('sun')`; `theme blend on` calls `setThemeBlend(true)`; `theme location 40.11,-88.24` PUTs `/api/themes/location`; `theme location here` with `requestLocation` returning null prints the app hint; `theme tokens accent` prints rows all containing `accent`; `theme list` marks the active one; `theme show` mentions sunrise when a location is set.
- [ ] App implements the four Ui methods through the new theme provider (Task 13 supplies `useTheme` extensions: `setSource`, `setTwilightBlend`, `location`, `state`); the terminal returns `false`/`null`. **If Task 13 is not done yet, the App stubs compile against the old hook and Task 13 replaces them** — keep the commit buildable.
- [ ] Commit.
**Acceptance:** `npm test --workspace=cli-core` green; `tsc` green for `cli-core`, `cli`, and `web`.

---

## Task 13: Web apply path (SPEC §3.9)

**Files:** Create `web/src/theme/{applyTheme.ts,applyTheme.test.ts,ThemeProvider.tsx,index.ts}`; Modify `web/src/hooks/useTheme.ts`, `web/src/hooks/useThemePresets.ts`, `web/src/lib/api.ts:709-760`, `web/src/main.tsx` (wrap in provider), `web/src/index.css` (palette → fallback only), `web/src/lib/themeTokens.ts` + `builtinThemes.ts` (delete after migrating imports; `isBuiltinThemeId` re-exported from theme-core as `isBuiltinId`), `web/src/App.tsx`.

### T13.1 — Pure apply builder (~90 lines)
**Produces:**
```ts
export interface ApplyInput { manifest: ThemeManifest; mode: Mode; blend: number }
export function buildThemeSheet(i: ApplyInput): { css: string; mode: Mode; key: string }
//   resolve(manifest) (memoised by manifest identity + JSON length), blendMaps(light, dark, blend) when 0<blend<1 else the mode's map, then toStylesheet(map, mode, manifest.css)
```
- [ ] Tests (node env): sheet for `builtin:osmosis` light contains `--bg:#eef1e5` and `--accent:#c65d22`; dark contains `--bg:#17160f`; `blend 0.5` produces a `--bg` strictly between the two; the sheet ends with the manifest `css`; two calls with the same input return equal `key`.
- [ ] Commit.

### T13.2 — Provider, hooks and API client (~150 lines)
- `ThemeProvider` holds: themes list + active id + location (from `getThemes()`, 5-minute refresh, `localStorage['osmosis:theme-cache']` as before), the **mode source** (`localStorage['osmosis:theme']`, now `'light'|'dark'|'system'|'sun'`) and `twilightBlend` (`localStorage['osmosis:theme-blend']`). Every 60 s — and immediately on change — it runs `modeAt(source, new Date(), location, matchMedia dark, twilightBlend)`, sets `data-theme` (`light|dark`) on `<html>`, and writes `<style id="osmosis-theme">` with `buildThemeSheet(...)`. It removes the old `<style id="osmosis-preset-css">`, and any inline `style` token properties left on `<html>` by previous versions. The 1-minute tick is only active while the source is `sun`.
- `useTheme()` keeps `{ theme, setTheme, resolvedMode }` (theme = source) and adds `blend`, `twilightBlend`, `setTwilightBlend`, `location`, `state()`. `useThemePresets(mode)` keeps `{ themes, activeId, setActiveId, saveTheme, deleteTheme, error, refresh }` but `themes` are `{ id, name, manifest, builtin? }` and `saveTheme(manifest)` PUTs `{ manifest }`. Both read from the provider (so `GraphPanel`/`DocumentPanel` stop having separate state). `api.ts`: `getThemes()` returns `{ themes, builtins, active_theme_id, location }`; add `putThemeManifest`, `patchThemeApi`, `validateThemeApi`, `putThemeLocation`. Old `putTheme` stays for the editor until T14 changes it.
- `index.css`: delete the palette blocks **but keep a static fallback block equal to `builtin:osmosis`** (the `:root`, `@media (prefers-color-scheme: dark)` and `[data-theme]` blocks stay as they are today — they are the pre-JS first paint and the fallback; only add a comment saying the theme sheet overrides them). Do not touch anything else in the file.
- [ ] Tests: pure parts only (already in T13.1); `modeAt` is covered in Task 4. Typecheck `npx tsc -p tsconfig.app.json --noEmit` and `npm run lint --workspace=web` (oxlint) green.
- [ ] Manual verify (headless, per the screenshot rule): start the dev server, open Settings, switch Slate-era theme → falls to Osmosis; switch to Forest/Ember/Ocean; light/dark/system/sun toggles; check the console is clean via `read_console_messages`.
- [ ] Commit.

### T13.3 — Alias coverage check (~40 lines)
- [ ] A vitest in `web/src/theme/aliases.test.ts` reads `web/src/**/*.css` and `*.tsx` as text, collects every `var(--name)` name, and asserts each is either a `--<token>` of the registry, an `ALIASES` key, or in a small allow-list (`--de-font-mono`, `--font-*`…); fails listing the unknown names. Expected today: passes with the documented allow-list; it guards the "no existing CSS breaks" promise.
- [ ] Commit.
**Task 13 review point.**

---

## Task 14: Minimal editor update (SPEC §3.9)

**Files:** Modify `web/src/components/ThemeEditor.tsx` (+ its css only if essential), `web/src/components/Settings.tsx:625-660`.
Props become `{ initial: ThemePresetView | null; onSave(manifest: ThemeManifest): void; onCancel(): void }`. The editor edits the manifest: name; **per-mode colour seeds** (canvas, surface, ink, accent, secondary, good, bad) with a "derive the other mode" toggle (when on, only the current tab's seeds are written and the other mode is omitted); the dials as range inputs (typeScale/baseSize numeric); font stack `<select>`s from `FONT_STACKS`; the `css` textarea. A live preview applies via the provider's `previewManifest(manifest | null)`. A report strip shows `validateThemeApi` warnings (debounced) with their suggestions; errors disable Save. Other overrides are untouched when editing an existing theme (the editor spreads the existing manifest).
- [ ] Settings swatches read `resolve(manifest)[mode]` (`color-canvas`, `color-surface`, `color-accent`, `color-text`).
- [ ] Verify with headless screenshots + console check; typecheck + lint green. Commit.

---

## Task 15: Acceptance, docs, final review (SPEC §3.11)

### T15.1 — Parity and acceptance
- [ ] Add `scripts/theme-parity/` (PowerShell) that, given two base URLs (main dev server vs this branch's), takes headless-Edge screenshots (fresh `--user-data-dir`, `--virtual-time-budget`, hard timeout + kill of **its own** msedge only) of Home, Library, Settings, workspace shell and Take, in light and dark, into a chosen folder. Use the WebGL-free invocation from the graph-engine handoff.
- [ ] Run for `builtin:osmosis`: compare the pairs by eye (read the PNGs) and note any difference; for Forest, Ocean, Ember: no contrast errors in `validate`, screenshots look right. `/theme mode sun` with a set location shows the expected mode (use `theme show`).
- [ ] Check a converted custom theme: create a legacy-shaped theme through the old PUT body, confirm identical 8 values.

### T15.2 — Done-means checklist (SPEC §3.11)
- [ ] `tsc` clean for theme-core, server, web, cli-core, cli. All suites green: `theme-core`, `server`, `cli-core`, `web`.
- [ ] `docs/theming/TOKENS.md` regenerated; `MCP-SPEC.md` + `TOOLS_VERSION` updated; `DEPLOY.md` notes the theme-core build step and migration 024 (**and: check canonical has no stray old 023/024 before deploy**).
- [ ] `git diff main --stat` shows no CSS changes except `index.css`; nothing under `graph-engine/src/style|figure|space`.
- [ ] Learn: `build/osmosis/core/DELTA-FROM-SPEC.md` logs the four deltas in "Decisions made in this plan"; CHECKLIST tick for sub-project 1; handoff written if context is high.
- [ ] Final single Sonnet review of the whole branch vs `main` (diff + SPEC §3), two fix rounds each re-reviewed; leftovers go into the handoff.
- [ ] **Do not merge or deploy.** Report to the inventory session that the branch is ready and that deploy needs the `tools_version` bump + migration 024 (Ben's go required).

## Self-review (against SPEC)

- §3.1 manifest → T2.1/T2.2; §3.2 seeds/dials/fonts → T2.1, mirror in T3.6; §3.3 registry/semantic/graph/doc/component → T3.2–T3.5, overrides + provenance → T3.6; §3.4 mode/sun/blend/location → T1.2, T4, T9.2 (location), T12; §3.5 validation → T8; §3.6 storage/sync/API → T9–T10 (delta 1, 2); §3.7 MCP → T11; §3.8 commands → T12; §3.9 web apply/aliases/editor → T13–T14; §3.10 contracts → T5.2; §3.11 testing → per-task tests + T15; §0.16 built-ins → T6; FORMAT.md request from the inventory session → T7.
- Preview-snapshot tool, ambience, sounds, uploaded fonts, papers: reserved only (SPEC §3.7, §4).
